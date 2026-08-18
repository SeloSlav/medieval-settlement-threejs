//! Local Marketplace stall deliveries and Trading Post distribution logistics.

use spacetimedb::ReducerContext;

use crate::balance_generated::{
    FIREWOOD_DELIVERY_SPEED_MPS, FIREWOOD_DELIVERY_UNLOAD_SEC, FOOD_DELIVERY_SPEED_MPS,
    FOOD_DELIVERY_UNLOAD_SEC, HOUSEHOLD_MAX_WEALTH, LOCAL_MARKET_TAX_CART_THRESHOLD,
    MARKET_CARAVAN_FOOD_PER_DELIVERY, MARKET_CARAVAN_WATER_PER_DELIVERY,
    PRIVATE_EXPORT_INCOME_CART_LOAD, STOREHOUSE_HAUL_PER_WORKER, TIMBER_DELIVERY_SPEED_MPS,
    TIMBER_DELIVERY_UNLOAD_SEC, WATER_DELIVERY_SPEED_MPS, WATER_DELIVERY_UNLOAD_SEC,
};
use crate::db::*;
use crate::economy::{
    building_commodity_room, building_commodity_stock, building_edible_food_stock,
    building_preserved_food_stock, mark_local_civic_receipts_dispatched,
    marketplace_proceeds_cart_load, physical_treasury_seat, private_export_proceeds,
    CommodityKind,
};
use crate::season_policy::EnvironmentState;
use crate::simulation::delivery_cargo::{
    delivery_stock_room, has_delivery_stock_room, residence_commodity_delivery_room,
    selected_food_delivery_commodity,
};
use crate::simulation::delivery_supplier::{dispatch_delivery_if_ready, DeliveryDispatchConfig};
use crate::simulation::delivery_trips::{
    building_has_active_trip, building_has_inbound_commodity_trip,
    onsite_building_labor, residence_has_inbound_remedy_trip, residence_has_inbound_wealth_trip,
    try_start_building_supply_trip, try_start_free_building_supply_trip,
    try_start_market_stall_delivery_trip, try_start_market_stall_remedy_trip,
    try_start_private_export_income_trip,
};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::residence_needs::{load_needs, need_stock, ResidenceNeedKind};
use crate::simulation::road_logistics::{
    local_delivery_distance, select_residence_for_need_delivery,
    select_residence_for_remedy_delivery,
};
use crate::simulation::tick_context::SimTickContext;
use crate::simulation::trading_post_exports_commodity;
use crate::tables::{Building, Residence};

#[derive(Clone, Copy, Debug, Default)]
pub struct MarketCaravanDispatch {
    pub include_abandoned: bool,
    pub priority_residence_id: Option<u64>,
    /// A paid household or relief lot must fit and load in full. Routine
    /// marketplace distribution keeps its worker-scaled carrying capacity.
    pub exact_load_amount: Option<f64>,
}

pub fn try_dispatch_marketplace_caravan(
    ctx: &ReducerContext,
    clock: &GameClock,
    tick: &SimTickContext,
    building: &mut Building,
    need_kind: ResidenceNeedKind,
    per_delivery_amount: f64,
    dispatch: MarketCaravanDispatch,
) -> bool {
    if !matches!(building.kind.as_str(), "marketplace" | "trading_post")
        || !building.construction_complete
        || tick.building_disabled_by_fire(ctx, building.id)
    {
        return false;
    }

    let stock = match need_kind {
        ResidenceNeedKind::Firewood => building.firewood,
        ResidenceNeedKind::Food => building_edible_food_stock(building),
        ResidenceNeedKind::Water => building.water,
        ResidenceNeedKind::PreservedFood => building_preserved_food_stock(building),
        ResidenceNeedKind::Ale => building.ale,
        ResidenceNeedKind::Cloth => building.cloth,
        ResidenceNeedKind::Pottery => building.pottery,
        ResidenceNeedKind::Church | ResidenceNeedKind::FoodVariety => return false,
    };
    if stock <= 1e-6
        || (building.kind == "trading_post" && building_has_active_trip(ctx, building.id))
    {
        return false;
    }

    let Some(network) = tick.road_network(building.owner) else {
        return false;
    };
    let delivery_commodity = selected_food_delivery_commodity(building, need_kind);

    let residence_is_eligible = |residence: &Residence| {
        if residence.owner != building.owner || !need_kind.is_active_for_tier(residence.tier) {
            return false;
        }
        dispatch.include_abandoned || (!residence.abandoned && residence.population > 0)
    };
    let eligible: Vec<Residence> = match dispatch.priority_residence_id {
        Some(residence_id) => ctx
            .db
            .residence()
            .id()
            .find(&residence_id)
            .filter(residence_is_eligible)
            .into_iter()
            .collect(),
        None => ctx
            .db
            .residence()
            .owner()
            .filter(&building.owner)
            .filter(residence_is_eligible)
            .collect(),
    };
    let targets: Vec<Residence> = select_residence_for_need_delivery(
        network,
        building,
        eligible,
        dispatch.priority_residence_id,
        None,
        |residence| need_stock(&load_needs(ctx, residence.id), need_kind),
        |residence, stock| {
            let physical_room = delivery_commodity
                .map(|commodity| residence_commodity_delivery_room(residence, commodity));
            dispatch.exact_load_amount.map_or_else(
                || {
                    physical_room.map_or_else(
                        || has_delivery_stock_room(need_kind, stock),
                        |room| room > 1e-6,
                    )
                },
                |amount| {
                    physical_room.unwrap_or_else(|| delivery_stock_room(need_kind, stock)) + 1e-6
                        >= amount
                },
            )
        },
    )
    .into_iter()
    .collect();
    if targets.is_empty() {
        return false;
    }

    let stall_workplace = if building.kind == "marketplace" {
        marketplace_stall_workplace(ctx, tick, building, need_kind)
    } else {
        let workers = onsite_building_labor(ctx, building);
        (workers > 0).then_some((building.id, workers))
    };
    let Some((stall_workplace_id, delivery_workers)) = stall_workplace else {
        return false;
    };
    let per_worker_amount = match dispatch.exact_load_amount {
        Some(amount) if amount.is_finite() && amount > 1e-6 => {
            amount / delivery_workers.max(1) as f64
        }
        Some(_) => return false,
        None => per_delivery_amount,
    };
    let (speed_mps, unload_seconds) = match need_kind {
        ResidenceNeedKind::Firewood => (FIREWOOD_DELIVERY_SPEED_MPS, FIREWOOD_DELIVERY_UNLOAD_SEC),
        ResidenceNeedKind::Food => (FOOD_DELIVERY_SPEED_MPS, FOOD_DELIVERY_UNLOAD_SEC),
        ResidenceNeedKind::Water => (WATER_DELIVERY_SPEED_MPS, WATER_DELIVERY_UNLOAD_SEC),
        ResidenceNeedKind::PreservedFood | ResidenceNeedKind::Ale => {
            (FOOD_DELIVERY_SPEED_MPS, FOOD_DELIVERY_UNLOAD_SEC)
        }
        ResidenceNeedKind::Cloth | ResidenceNeedKind::Pottery => {
            (TIMBER_DELIVERY_SPEED_MPS, TIMBER_DELIVERY_UNLOAD_SEC)
        }
        ResidenceNeedKind::Church | ResidenceNeedKind::FoodVariety => return false,
    };

    if building.kind == "marketplace" {
        try_start_market_stall_delivery_trip(
            ctx,
            tick,
            clock,
            network,
            building,
            stall_workplace_id,
            delivery_workers,
            &targets,
            need_kind,
            speed_mps,
            unload_seconds,
            per_worker_amount,
        )
    } else {
        dispatch_delivery_if_ready(
            ctx,
            tick,
            clock,
            network,
            building,
            delivery_workers,
            &targets,
            DeliveryDispatchConfig {
                need_kind,
                speed_mps,
                unload_seconds,
                per_delivery: per_worker_amount,
            },
        )
    }
}

fn marketplace_stall_workplace(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    marketplace: &Building,
    need_kind: ResidenceNeedKind,
) -> Option<(u64, u32)> {
    let workplace_kind = match need_kind {
        ResidenceNeedKind::Food | ResidenceNeedKind::PreservedFood | ResidenceNeedKind::Ale => {
            "granary"
        }
        ResidenceNeedKind::Firewood | ResidenceNeedKind::Cloth | ResidenceNeedKind::Pottery => {
            "village_storehouse"
        }
        ResidenceNeedKind::Water | ResidenceNeedKind::Church | ResidenceNeedKind::FoodVariety => {
            return None
        }
    };
    let network = tick.road_network(marketplace.owner)?;
    tick.building_ids_for_kinds(ctx, marketplace.owner, &[workplace_kind])
        .into_iter()
        .filter_map(|id| ctx.db.building().id().find(&id))
        .filter(|workplace| {
            workplace.construction_complete
                && workplace.assigned_labor > 0
                && !tick.building_disabled_by_fire(ctx, workplace.id)
        })
        .filter_map(|workplace| {
            let workers = onsite_building_labor(ctx, &workplace);
            let distance = crate::simulation::road_logistics::local_delivery_distance(
                network,
                workplace.x,
                workplace.z,
                marketplace.x,
                marketplace.z,
            )?;
            (workers > 0).then_some((workplace.id, workers, distance))
        })
        .min_by(|a, b| a.2.total_cmp(&b.2).then_with(|| a.0.cmp(&b.0)))
        .map(|(id, workers, _)| (id, workers))
}

/// Stage routine imported household goods at a local Marketplace. The Trading
/// Post trip is building-to-building and may carry a useful batch; individual
/// homes receive their share later through the daily abstract market issue.
fn try_dispatch_trading_post_stock_to_marketplace(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    trading_post: &mut Building,
) -> bool {
    let Some(network) = tick.road_network(trading_post.owner) else {
        return false;
    };
    let workers = onsite_building_labor(ctx, trading_post);
    if workers == 0 || building_has_active_trip(ctx, trading_post.id) {
        return false;
    }

    let needs = [
        ResidenceNeedKind::Food,
        ResidenceNeedKind::PreservedFood,
        ResidenceNeedKind::Firewood,
        ResidenceNeedKind::Water,
        ResidenceNeedKind::Ale,
        ResidenceNeedKind::Cloth,
        ResidenceNeedKind::Pottery,
    ];
    let start = (clock.sim_tick as usize) % needs.len();
    for offset in 0..needs.len() {
        let need_kind = needs[(start + offset) % needs.len()];
        let commodity = match need_kind {
            ResidenceNeedKind::Food | ResidenceNeedKind::PreservedFood => {
                selected_food_delivery_commodity(trading_post, need_kind)
            }
            ResidenceNeedKind::Firewood if trading_post.firewood > 1e-6 => {
                Some(CommodityKind::Firewood)
            }
            ResidenceNeedKind::Firewood if trading_post.charcoal > 1e-6 => {
                Some(CommodityKind::Charcoal)
            }
            ResidenceNeedKind::Water => Some(CommodityKind::Water),
            ResidenceNeedKind::Ale => Some(CommodityKind::Ale),
            ResidenceNeedKind::Cloth => Some(CommodityKind::Cloth),
            ResidenceNeedKind::Pottery => Some(CommodityKind::Pottery),
            _ => None,
        };
        let Some(commodity) = commodity.filter(|commodity| {
            building_commodity_stock(trading_post, *commodity) > 1e-6
                && !trading_post_exports_commodity(ctx, trading_post.id, *commodity)
        }) else {
            continue;
        };
        let destination_kind = if need_kind == ResidenceNeedKind::Water {
            "well"
        } else {
            "marketplace"
        };
        let target = tick
            .building_ids_for_kinds(ctx, trading_post.owner, &[destination_kind])
            .into_iter()
            .filter_map(|id| ctx.db.building().id().find(&id))
            .filter(|market| {
                market.construction_complete
                    && !tick.building_disabled_by_fire(ctx, market.id)
                    && !building_has_inbound_commodity_trip(ctx, market.id, commodity)
                    && building_commodity_room(market, commodity) > 1e-6
            })
            .filter_map(|market| {
                let distance = local_delivery_distance(
                    network,
                    trading_post.x,
                    trading_post.z,
                    market.x,
                    market.z,
                )?;
                Some((market, distance))
            })
            .min_by(|(left, left_distance), (right, right_distance)| {
                left_distance
                    .total_cmp(right_distance)
                    .then_with(|| left.id.cmp(&right.id))
            })
            .map(|(market, _)| market);
        let Some(target) = target else {
            continue;
        };
        let (speed_mps, unload_seconds, per_worker) = match need_kind {
            ResidenceNeedKind::Firewood => (
                FIREWOOD_DELIVERY_SPEED_MPS,
                FIREWOOD_DELIVERY_UNLOAD_SEC,
                crate::balance_generated::MARKET_CARAVAN_FIREWOOD_PER_DELIVERY,
            ),
            ResidenceNeedKind::Food | ResidenceNeedKind::PreservedFood => (
                FOOD_DELIVERY_SPEED_MPS,
                FOOD_DELIVERY_UNLOAD_SEC,
                MARKET_CARAVAN_FOOD_PER_DELIVERY,
            ),
            ResidenceNeedKind::Water => (
                WATER_DELIVERY_SPEED_MPS,
                WATER_DELIVERY_UNLOAD_SEC,
                MARKET_CARAVAN_WATER_PER_DELIVERY,
            ),
            ResidenceNeedKind::Ale => (
                FOOD_DELIVERY_SPEED_MPS,
                FOOD_DELIVERY_UNLOAD_SEC,
                crate::balance_generated::MARKET_CARAVAN_ALE_PER_DELIVERY,
            ),
            ResidenceNeedKind::Cloth => (
                TIMBER_DELIVERY_SPEED_MPS,
                TIMBER_DELIVERY_UNLOAD_SEC,
                crate::balance_generated::MARKET_CARAVAN_CLOTH_PER_DELIVERY,
            ),
            ResidenceNeedKind::Pottery => (
                TIMBER_DELIVERY_SPEED_MPS,
                TIMBER_DELIVERY_UNLOAD_SEC,
                crate::balance_generated::MARKET_CARAVAN_POTTERY_PER_DELIVERY,
            ),
            _ => continue,
        };
        let needed = building_commodity_room(&target, commodity);
        if try_start_building_supply_trip(
            ctx,
            tick,
            clock,
            network,
            trading_post,
            &target,
            workers,
            commodity,
            speed_mps,
            unload_seconds,
            per_worker,
            needed,
        ) {
            return true;
        }
    }
    false
}

fn try_dispatch_marketplace_remedies(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    marketplace: &mut Building,
) -> bool {
    let workplace = if marketplace.kind == "trading_post" {
        let workers = onsite_building_labor(ctx, marketplace);
        (workers > 0).then_some((marketplace.id, workers))
    } else {
        marketplace_stall_workplace(ctx, tick, marketplace, ResidenceNeedKind::Cloth)
    };
    let Some((stall_workplace_id, delivery_workers)) = workplace else {
        return false;
    };
    let Some(network) = tick.road_network(marketplace.owner) else {
        return false;
    };
    let residences: Vec<Residence> = ctx
        .db
        .residence()
        .owner()
        .filter(&marketplace.owner)
        .filter(|residence| !tick.residence_disabled_by_fire(ctx, residence.id))
        .collect();
    let Some(target) =
        select_residence_for_remedy_delivery(network, marketplace, residences, |residence_id| {
            residence_has_inbound_remedy_trip(ctx, residence_id)
        })
    else {
        return false;
    };
    try_start_market_stall_remedy_trip(
        ctx,
        tick,
        clock,
        network,
        marketplace,
        stall_workplace_id,
        delivery_workers,
        &target,
    )
}

pub fn step_marketplace_caravans(
    ctx: &ReducerContext,
    clock: &GameClock,
    tick: &SimTickContext,
    _environment: EnvironmentState,
) {
    let marketplace_ids: Vec<u64> = ctx
        .db
        .building()
        .iter()
        .filter(|building| {
            matches!(building.kind.as_str(), "marketplace" | "trading_post")
                && building.construction_complete
                && !tick.building_disabled_by_fire(ctx, building.id)
                && ((building.kind == "marketplace"
                    && (building.firewood > 1e-6
                        || building_edible_food_stock(building) > 1e-6
                        || building.ale > 1e-6
                        || building.cloth > 1e-6
                        || building.pottery > 1e-6
                        || building.remedies > 1e-6
                        || building.gold > 1e-6))
                    || (building.kind == "trading_post"
                        && building.assigned_labor > 0
                        && (building_edible_food_stock(building) > 1e-6
                            || building.water > 1e-6
                            || building.firewood > 1e-6
                            || building.remedies > 1e-6
                            || building.ale > 1e-6
                            || building.honey > 1e-6
                            || building.wine > 1e-6
                            || building.cloth > 1e-6
                            || building.cheese > 1e-6
                            || building.pottery > 1e-6
                            || building.gold > 1e-6)))
        })
        .map(|building| building.id)
        .collect();

    for building_id in marketplace_ids {
        let is_trading_post = ctx
            .db
            .building()
            .id()
            .find(&building_id)
            .is_some_and(|building| building.kind == "trading_post");
        let Some(mut building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        let mut changed = false;
        // Routine household goods are allocated from Marketplace stock in one
        // owner-wide availability pass. No market-to-home cart departs here.
        if building.remedies > 1e-6 {
            changed |= try_dispatch_marketplace_remedies(ctx, tick, clock, &mut building);
        }
        // Imported household goods move in useful building-to-building lots
        // from the Trading Post to a local Marketplace; imported water can
        // replenish a connected well. No cart targets an individual home.
        if is_trading_post && !building_has_active_trip(ctx, building.id) {
            changed |=
                try_dispatch_trading_post_stock_to_marketplace(ctx, tick, clock, &mut building);
        }
        // The regional exchange is monthly and abstract. Only local stock
        // movement and local receipts create visible trips here.
        if is_trading_post && private_export_proceeds(&building) > 1e-6 {
            changed |= try_dispatch_private_export_income(ctx, tick, clock, &mut building);
        }
        let unpledged_gold = (building.gold - private_export_proceeds(&building)).max(0.0);
        let collectible_gold = if is_trading_post {
            unpledged_gold
        } else if unpledged_gold + 1e-9 >= LOCAL_MARKET_TAX_CART_THRESHOLD
            || (clock.hour == 18 && clock.minute < 15)
        {
            // Batch local tolls into useful carts, with one early-evening
            // sweep so a quiet market never strands its final small balance.
            unpledged_gold
        } else {
            0.0
        };
        if collectible_gold > 1e-6 && !building_has_active_trip(ctx, building.id) {
            changed |= try_dispatch_marketplace_proceeds(
                ctx,
                tick,
                clock,
                &mut building,
                collectible_gold,
            );
        }
        if changed {
            ctx.db.building().id().update(building);
        }
    }
}

fn try_dispatch_marketplace_proceeds(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    marketplace: &mut Building,
    collectible_gold: f64,
) -> bool {
    if building_has_active_trip(ctx, marketplace.id) {
        return false;
    }
    let load = marketplace_proceeds_cart_load(collectible_gold);
    if load <= 1e-6 {
        return false;
    }
    let Some(target) = physical_treasury_seat(ctx, marketplace.owner) else {
        return false;
    };
    if target.id == marketplace.id {
        return false;
    }
    let Some(network) = tick.road_network(marketplace.owner) else {
        return false;
    };
    let before = marketplace.gold;
    let started = try_start_free_building_supply_trip(
        ctx,
        tick,
        clock,
        network,
        marketplace,
        &target,
        CommodityKind::Gold,
        TIMBER_DELIVERY_SPEED_MPS,
        TIMBER_DELIVERY_UNLOAD_SEC,
        STOREHOUSE_HAUL_PER_WORKER,
        load,
    );
    if started {
        mark_local_civic_receipts_dispatched(marketplace, (before - marketplace.gold).max(0.0));
    }
    started
}

fn try_dispatch_private_export_income(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    trading_post: &mut Building,
) -> bool {
    if building_has_active_trip(ctx, trading_post.id)
        || private_export_proceeds(trading_post) <= 1e-6
    {
        return false;
    }
    let Some(network) = tick.road_network(trading_post.owner) else {
        return false;
    };
    let target = ctx
        .db
        .residence()
        .owner()
        .filter(&trading_post.owner)
        .filter(|residence| {
            residence.population > 0
                && !residence.abandoned
                && residence.household_wealth < HOUSEHOLD_MAX_WEALTH - 1e-9
                && !tick.residence_disabled_by_fire(ctx, residence.id)
                && !residence_has_inbound_wealth_trip(ctx, residence.id)
        })
        .filter_map(|residence| {
            local_delivery_distance(
                network,
                trading_post.x,
                trading_post.z,
                residence.x,
                residence.z,
            )
            .map(|distance| (residence, distance))
        })
        .min_by(|(residence_a, distance_a), (residence_b, distance_b)| {
            residence_a
                .household_wealth
                .partial_cmp(&residence_b.household_wealth)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| {
                    distance_a
                        .partial_cmp(distance_b)
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .then_with(|| residence_a.id.cmp(&residence_b.id))
        })
        .map(|(residence, _)| residence);
    let Some(residence) = target else {
        return false;
    };
    try_start_private_export_income_trip(
        ctx,
        tick,
        clock,
        network,
        trading_post,
        &residence,
        PRIVATE_EXPORT_INCOME_CART_LOAD,
    ) > 1e-6
}
