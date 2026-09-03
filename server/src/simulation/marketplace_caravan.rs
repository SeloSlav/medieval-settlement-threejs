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
    building_savory_preserves_stock, mark_local_civic_receipts_dispatched,
    marketplace_proceeds_cart_load, physical_treasury_seat_for_settlement, private_export_proceeds,
    CommodityKind,
};
use crate::resource_units::whole_units;
use crate::season_policy::EnvironmentState;
use crate::simulation::delivery_cargo::{
    delivery_stock_room, has_delivery_stock_room, residence_commodity_delivery_room,
    selected_food_delivery_commodity,
};
use crate::simulation::delivery_supplier::{dispatch_delivery_if_ready, DeliveryDispatchConfig};
use crate::simulation::delivery_trips::{
    building_has_active_trip, building_has_inbound_commodity_trip, onsite_building_labor,
    residence_has_inbound_remedy_trip, residence_has_inbound_wealth_trip,
    try_start_building_supply_trip, try_start_free_building_supply_trip,
    try_start_market_stall_delivery_trip, try_start_market_stall_remedy_trip,
    try_start_private_export_income_trip,
};
use crate::simulation::game_calendar::{calendar_day_started, GameClock};
use crate::simulation::residence_needs::{load_needs, need_stock, ResidenceNeedKind};
use crate::simulation::road_logistics::{
    local_delivery_distance, select_residence_for_need_delivery,
    select_residence_for_remedy_delivery,
};
use crate::simulation::tick_context::SimTickContext;
use crate::simulation::trading_post_exports_commodity;
use crate::tables::{Building, Residence};
use crate::trading_post_policy::{
    trading_post_service_cursor_after_success, trading_post_service_route_order,
};

#[derive(Clone, Copy, Debug, Default)]
pub struct MarketCaravanDispatch {
    pub include_abandoned: bool,
    pub priority_residence_id: Option<u64>,
    /// A paid household or relief lot must fit and load in full. Routine
    /// marketplace distribution keeps its worker-scaled carrying capacity.
    pub exact_load_amount: Option<f64>,
}

const TRADING_POST_SERVICE_ROUTES: [(ResidenceNeedKind, Option<CommodityKind>); 13] = [
    (ResidenceNeedKind::Food, None),
    (ResidenceNeedKind::PreservedFood, None),
    (ResidenceNeedKind::Firewood, None),
    (ResidenceNeedKind::Water, None),
    (ResidenceNeedKind::Ale, Some(CommodityKind::Ale)),
    (ResidenceNeedKind::Ale, Some(CommodityKind::Cider)),
    (ResidenceNeedKind::Ale, Some(CommodityKind::PearCider)),
    (ResidenceNeedKind::Cloth, None),
    (ResidenceNeedKind::Shoes, None),
    (ResidenceNeedKind::Pottery, None),
    (ResidenceNeedKind::Luxury, Some(CommodityKind::Candles)),
    (ResidenceNeedKind::Luxury, Some(CommodityKind::Wine)),
    (ResidenceNeedKind::Luxury, Some(CommodityKind::Honey)),
];

fn trading_post_service_destination_kind(need_kind: ResidenceNeedKind) -> Option<&'static str> {
    match need_kind {
        ResidenceNeedKind::Water => Some("well"),
        ResidenceNeedKind::Ale => Some("tavern"),
        ResidenceNeedKind::Food
        | ResidenceNeedKind::Firewood
        | ResidenceNeedKind::PreservedFood
        | ResidenceNeedKind::Cloth
        | ResidenceNeedKind::Shoes
        | ResidenceNeedKind::Pottery
        | ResidenceNeedKind::Luxury => Some("marketplace"),
        ResidenceNeedKind::Church | ResidenceNeedKind::FoodVariety => None,
    }
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
        ResidenceNeedKind::PreservedFood => building_savory_preserves_stock(building),
        ResidenceNeedKind::Ale => building.ale,
        ResidenceNeedKind::Cloth => building.cloth,
        ResidenceNeedKind::Shoes => building.shoes,
        ResidenceNeedKind::Pottery => building.pottery,
        ResidenceNeedKind::Church | ResidenceNeedKind::FoodVariety | ResidenceNeedKind::Luxury => {
            return false
        }
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
        marketplace_stall_workplace(ctx, tick, building, need_kind, delivery_commodity)
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
        ResidenceNeedKind::Cloth | ResidenceNeedKind::Shoes | ResidenceNeedKind::Pottery => {
            (TIMBER_DELIVERY_SPEED_MPS, TIMBER_DELIVERY_UNLOAD_SEC)
        }
        ResidenceNeedKind::Church | ResidenceNeedKind::FoodVariety | ResidenceNeedKind::Luxury => {
            return false
        }
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
    delivery_commodity: Option<CommodityKind>,
) -> Option<(u64, u32)> {
    let workplace_id = delivery_commodity
        .and_then(|commodity| {
            tick.marketplace_stall_workplace_id_for_commodity(ctx, marketplace, commodity)
        })
        .or_else(|| tick.marketplace_stall_workplace_id(ctx, marketplace, need_kind))?;
    let workplace = ctx.db.building().id().find(&workplace_id)?;
    (onsite_building_labor(ctx, &workplace) > 0).then_some((workplace_id, 1))
}

/// Stage routine imported household goods at their local serving outlet. Food
/// and wares go to a Marketplace, water to a well, and distinct beverages to a
/// staffed Tavern. Every leg remains a conserved building-to-building cart.
fn try_dispatch_trading_post_stock_to_local_service(
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

    for route_index in trading_post_service_route_order(
        trading_post.action_cooldown,
        TRADING_POST_SERVICE_ROUTES.len(),
    ) {
        let (need_kind, routed_commodity) = TRADING_POST_SERVICE_ROUTES[route_index];
        let commodity = routed_commodity.or_else(|| match need_kind {
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
            ResidenceNeedKind::Shoes => Some(CommodityKind::Shoes),
            ResidenceNeedKind::Pottery => Some(CommodityKind::Pottery),
            _ => None,
        });
        let Some(commodity) = commodity.filter(|commodity| {
            building_commodity_stock(trading_post, *commodity) > 1e-6
                && !trading_post_exports_commodity(ctx, trading_post.id, *commodity)
        }) else {
            continue;
        };
        let Some(destination_kind) = trading_post_service_destination_kind(need_kind) else {
            continue;
        };
        let target = tick
            .building_ids_for_kinds(ctx, trading_post.owner, &[destination_kind])
            .into_iter()
            .filter_map(|id| ctx.db.building().id().find(&id))
            .filter(|market| {
                market.construction_complete
                    && !tick.building_disabled_by_fire(ctx, market.id)
                    && (market.kind != "tavern" || onsite_building_labor(ctx, market) > 0)
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
            ResidenceNeedKind::Food
            | ResidenceNeedKind::PreservedFood
            | ResidenceNeedKind::Luxury => (
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
            ResidenceNeedKind::Shoes => (
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
            trading_post.action_cooldown = trading_post_service_cursor_after_success(
                route_index,
                TRADING_POST_SERVICE_ROUTES.len(),
            );
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
        tick.marketplace_any_goods_stall_workplace_id(ctx, marketplace)
            .and_then(|workplace_id| {
                let workplace = ctx.db.building().id().find(&workplace_id)?;
                (onsite_building_labor(ctx, &workplace) > 0).then_some((workplace_id, 1))
            })
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
                            || building.cider > 1e-6
                            || building.pear_cider > 1e-6
                            || building.honey > 1e-6
                            || building.candles > 1e-6
                            || building.wine > 1e-6
                            || building.cloth > 1e-6
                            || building.shoes > 1e-6
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
        // to their serving outlet: markets, wells, and staffed Taverns. No cart
        // targets an individual home.
        if is_trading_post && !building_has_active_trip(ctx, building.id) {
            changed |=
                try_dispatch_trading_post_stock_to_local_service(ctx, tick, clock, &mut building);
        }
        // The regional exchange is bounded and abstract. Only local stock
        // movement and local receipts create visible trips here.
        if is_trading_post && private_export_proceeds(&building) > 1e-6 {
            changed |= try_dispatch_private_export_income(ctx, tick, clock, &mut building);
        }
        let unpledged_gold =
            whole_units(whole_units(building.gold) - private_export_proceeds(&building));
        let collectible_gold = if is_trading_post {
            unpledged_gold
        } else if unpledged_gold + 1e-9 >= LOCAL_MARKET_TAX_CART_THRESHOLD
            || calendar_day_started(clock)
        {
            // Batch local tolls into useful carts, with one date-boundary
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
    let load = whole_units(marketplace_proceeds_cart_load(whole_units(
        collectible_gold,
    )));
    if load < 1.0 {
        return false;
    }
    let Some(target) =
        physical_treasury_seat_for_settlement(ctx, marketplace.owner, marketplace.settlement_id)
    else {
        return false;
    };
    if target.id == marketplace.id {
        return false;
    }
    let Some(network) = tick.road_network(marketplace.owner) else {
        return false;
    };
    let before = whole_units(marketplace.gold);
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
        mark_local_civic_receipts_dispatched(
            marketplace,
            whole_units(before - whole_units(marketplace.gold)),
        );
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
        whole_units(PRIVATE_EXPORT_INCOME_CART_LOAD),
    ) > 1e-6
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imported_household_goods_have_their_serving_outlet_route() {
        for route in [
            (ResidenceNeedKind::Food, None),
            (ResidenceNeedKind::PreservedFood, None),
            (ResidenceNeedKind::Firewood, None),
            (ResidenceNeedKind::Water, None),
            (ResidenceNeedKind::Ale, Some(CommodityKind::Ale)),
            (ResidenceNeedKind::Ale, Some(CommodityKind::Cider)),
            (ResidenceNeedKind::Ale, Some(CommodityKind::PearCider)),
            (ResidenceNeedKind::Cloth, None),
            (ResidenceNeedKind::Shoes, None),
            (ResidenceNeedKind::Pottery, None),
        ] {
            assert!(TRADING_POST_SERVICE_ROUTES.contains(&route));
        }
        for commodity in [
            CommodityKind::Candles,
            CommodityKind::Wine,
            CommodityKind::Honey,
        ] {
            assert!(TRADING_POST_SERVICE_ROUTES
                .contains(&(ResidenceNeedKind::Luxury, Some(commodity),)));
        }
        assert_eq!(
            trading_post_service_destination_kind(ResidenceNeedKind::Luxury),
            Some("marketplace")
        );
        assert_eq!(
            trading_post_service_destination_kind(ResidenceNeedKind::Ale),
            Some("tavern")
        );
        assert_eq!(
            trading_post_service_destination_kind(ResidenceNeedKind::Water),
            Some("well")
        );
    }
}
