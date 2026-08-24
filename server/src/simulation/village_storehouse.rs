use std::collections::HashMap;

use spacetimedb::{Identity, ReducerContext};

use crate::balance_generated::{
    CHARCOAL_HOUSEHOLD_FUEL_VALUE, FIREWOOD_DELIVERY_SPEED_MPS, FIREWOOD_DELIVERY_UNLOAD_SEC,
    STOREHOUSE_FIREWOOD_PER_DELIVERY, STOREHOUSE_HAUL_PER_WORKER, STOREHOUSE_OVERFLOW_THRESHOLD,
    TIMBER_DELIVERY_SPEED_MPS, TIMBER_DELIVERY_UNLOAD_SEC,
};
use crate::db::*;
use crate::economy::{
    building_commodity_cap, building_commodity_stock, storage_accepts_commodity, CommodityKind,
};
use crate::fuel_reserve_policy::{
    combined_fuel_equivalent, fuel_runway_days, household_fuel_demand_for_households_per_day,
    marketplace_fuel_reserve_target_for_households,
};
use crate::season_policy::EnvironmentState;
use crate::simulation::delivery_trips::{
    building_has_active_trip, building_has_inbound_commodity_trip,
    building_has_inbound_supply_trip, try_start_building_supply_trip,
};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::residence_needs::ResidenceNeedKind;
use crate::simulation::road_logistics::local_delivery_distance;
use crate::simulation::tick_context::SimTickContext;
use crate::storehouse_policy::{
    compare_storehouse_destination, compare_storehouse_source_priority,
    storehouse_filtered_collection_headroom,
};
use crate::tables::Building;

const STOREHOUSE_OVERFLOW_SOURCE_KINDS: &[&str] = &[
    "lumber_mill",
    "stone_quarry",
    "large_quarry",
    "woodcutters_lodge",
    "mine",
    "clay_pit",
];
const MINE_OVERFLOW_COMMODITIES: &[CommodityKind] = &[CommodityKind::Iron, CommodityKind::Salt];

struct MarketFuelTarget {
    market: Building,
    commodity: CommodityKind,
    requested_units: f64,
    runway_days: f64,
    distance: f64,
}

struct OverflowSource {
    building: Building,
    commodity: CommodityKind,
    excess: f64,
    fill_ratio: f64,
}

/// Staffed storehouse workers stock shared market stalls with fuel and durable
/// household goods. Each rostered keeper owns one goods category at one
/// nearest connected Marketplace and contributes one handcart load.
pub fn step_storehouse_market_stalls(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    environment: EnvironmentState,
    storehouses: Vec<Building>,
) {
    let mut covered_households_by_market = HashMap::<u64, u32>::new();
    for residence in ctx.db.residence().iter().filter(|residence| {
        !residence.abandoned
            && residence.population > 0
            && !tick.residence_disabled_by_fire(ctx, residence.id)
    }) {
        if let Some(market_id) = tick.local_marketplace_for_residence_deposit(
            ctx,
            residence.owner,
            residence.id,
            ResidenceNeedKind::Firewood,
        ) {
            let household_count = covered_households_by_market.entry(market_id).or_default();
            *household_count = household_count.saturating_add(1);
        }
    }

    for mut storehouse in storehouses {
        if storehouse.kind != "village_storehouse"
            || !storehouse.construction_complete
            || tick.building_disabled_by_fire(ctx, storehouse.id)
            || storehouse.assigned_labor == 0
            || labor_and_logistics_paused(ctx, tick, storehouse.owner, clock)
            || building_has_active_trip(ctx, storehouse.id)
            || building_has_inbound_supply_trip(ctx, storehouse.id)
        {
            continue;
        }
        let Some(network) = tick.road_network(storehouse.owner) else {
            continue;
        };
        let fuel_target = tick
            .building_ids_for_kinds(ctx, storehouse.owner, &["marketplace"])
            .into_iter()
            .filter_map(|id| ctx.db.building().id().find(&id))
            .filter(|market| {
                market.construction_complete
                    && !tick.building_disabled_by_fire(ctx, market.id)
                    && !building_has_inbound_commodity_trip(ctx, market.id, CommodityKind::Firewood)
                    && !building_has_inbound_commodity_trip(ctx, market.id, CommodityKind::Charcoal)
            })
            .flat_map(|market| {
                let household_count = covered_households_by_market
                    .get(&market.id)
                    .copied()
                    .unwrap_or(0);
                let daily_demand = household_fuel_demand_for_households_per_day(
                    household_count,
                    environment.firewood_demand_multiplier(),
                );
                let target_equivalent = marketplace_fuel_reserve_target_for_households(
                    household_count,
                    environment.firewood_demand_multiplier(),
                    building_commodity_cap(&market.kind, CommodityKind::Firewood),
                    building_commodity_cap(&market.kind, CommodityKind::Charcoal),
                );
                let current_equivalent = combined_fuel_equivalent(market.firewood, market.charcoal);
                let needed_equivalent = (target_equivalent - current_equivalent).max(0.0);
                let runway_days = fuel_runway_days(current_equivalent, daily_demand);
                let distance = local_delivery_distance(
                    network,
                    storehouse.x,
                    storehouse.z,
                    market.x,
                    market.z,
                );
                let mut candidates = Vec::new();
                for commodity in [CommodityKind::Charcoal, CommodityKind::Firewood] {
                    if !tick.marketplace_stall_accepts_commodity_from(
                        ctx,
                        &market,
                        storehouse.id,
                        commodity,
                    ) {
                        continue;
                    }
                    let source_stock = building_commodity_stock(&storehouse, commodity);
                    let fuel_value = if commodity == CommodityKind::Charcoal {
                        CHARCOAL_HOUSEHOLD_FUEL_VALUE
                    } else {
                        1.0
                    };
                    let room = (building_commodity_cap(&market.kind, commodity)
                        - building_commodity_stock(&market, commodity))
                    .max(0.0);
                    let requested_units = (needed_equivalent / fuel_value.max(1e-9))
                        .min(source_stock)
                        .min(room);
                    if requested_units > 1e-6 {
                        if let Some(distance) = distance {
                            candidates.push(MarketFuelTarget {
                                market: market.clone(),
                                commodity,
                                requested_units,
                                runway_days,
                                distance,
                            });
                        }
                    }
                }
                candidates
            })
            .min_by(|a, b| {
                a.runway_days
                    .total_cmp(&b.runway_days)
                    .then_with(|| a.distance.total_cmp(&b.distance))
                    .then_with(|| {
                        let a_rank = u8::from(a.commodity != CommodityKind::Charcoal);
                        let b_rank = u8::from(b.commodity != CommodityKind::Charcoal);
                        a_rank.cmp(&b_rank)
                    })
                    .then_with(|| a.market.id.cmp(&b.market.id))
            });
        if let Some(target) = fuel_target {
            let workers = 1;
            if try_start_building_supply_trip(
                ctx,
                tick,
                clock,
                network,
                &mut storehouse,
                &target.market,
                workers,
                target.commodity,
                FIREWOOD_DELIVERY_SPEED_MPS,
                FIREWOOD_DELIVERY_UNLOAD_SEC,
                STOREHOUSE_FIREWOOD_PER_DELIVERY,
                target.requested_units,
            ) {
                ctx.db.building().id().update(storehouse);
                continue;
            }
        }

        for (commodity, stock, speed_mps, unload_seconds, per_delivery) in [
            (
                CommodityKind::Cloth,
                storehouse.cloth,
                TIMBER_DELIVERY_SPEED_MPS,
                TIMBER_DELIVERY_UNLOAD_SEC,
                2.0,
            ),
            (
                CommodityKind::Pottery,
                storehouse.pottery,
                TIMBER_DELIVERY_SPEED_MPS,
                TIMBER_DELIVERY_UNLOAD_SEC,
                2.0,
            ),
            (
                CommodityKind::Shoes,
                storehouse.shoes,
                TIMBER_DELIVERY_SPEED_MPS,
                TIMBER_DELIVERY_UNLOAD_SEC,
                2.0,
            ),
            (
                CommodityKind::Remedies,
                storehouse.remedies,
                TIMBER_DELIVERY_SPEED_MPS,
                TIMBER_DELIVERY_UNLOAD_SEC,
                2.0,
            ),
        ] {
            if stock <= 1e-6 || building_has_active_trip(ctx, storehouse.id) {
                continue;
            }
            let target = tick
                .building_ids_for_kinds(ctx, storehouse.owner, &["marketplace"])
                .into_iter()
                .filter_map(|id| ctx.db.building().id().find(&id))
                .filter(|market| {
                    market.construction_complete
                        && !tick.building_disabled_by_fire(ctx, market.id)
                        && !building_has_inbound_commodity_trip(ctx, market.id, commodity)
                })
                .filter_map(|market| {
                    if !tick.marketplace_stall_accepts_commodity_from(
                        ctx,
                        &market,
                        storehouse.id,
                        commodity,
                    ) {
                        return None;
                    }
                    let cap = building_commodity_cap(&market.kind, commodity);
                    let desired = cap * 0.75;
                    let needed = (desired - building_commodity_stock(&market, commodity)).max(0.0);
                    let distance = local_delivery_distance(
                        network,
                        storehouse.x,
                        storehouse.z,
                        market.x,
                        market.z,
                    )?;
                    (needed > 1e-6).then_some((market, needed, distance))
                })
                .min_by(|a, b| a.2.total_cmp(&b.2).then_with(|| a.0.id.cmp(&b.0.id)));
            let Some((market, needed, _)) = target else {
                continue;
            };
            let workers = 1;
            if try_start_building_supply_trip(
                ctx,
                tick,
                clock,
                network,
                &mut storehouse,
                &market,
                workers,
                commodity,
                speed_mps,
                unload_seconds,
                per_delivery,
                needed,
            ) {
                ctx.db.building().id().update(storehouse.clone());
            }
        }
    }
}

/// Once Marketplace-stall and industrial firewood duties have run, remaining
/// idle depots clear producer overflow in one owner-wide pass. Fullest producers
/// claim the nearest compatible depot, so database iteration and construction
/// order cannot silently distort the logistics layout. Food and grain remain
/// excluded so the granary and marketplace keep their specialized roles.
pub fn step_village_storehouse_overflow_collection(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    storehouses: Vec<Building>,
) {
    let mut idle_by_owner: HashMap<Identity, Vec<Building>> = HashMap::new();
    for storehouse in storehouses {
        if !storehouse.construction_complete
            || tick.building_disabled_by_fire(ctx, storehouse.id)
            || storehouse.assigned_labor == 0
            || labor_and_logistics_paused(ctx, tick, storehouse.owner, clock)
            || building_has_active_trip(ctx, storehouse.id)
            || building_has_inbound_supply_trip(ctx, storehouse.id)
            || tick.road_network(storehouse.owner).is_none()
        {
            continue;
        }
        idle_by_owner
            .entry(storehouse.owner)
            .or_default()
            .push(storehouse);
    }

    for (owner, idle_storehouses) in idle_by_owner {
        dispatch_overflow_collection_for_owner(ctx, tick, clock, owner, idle_storehouses);
    }
}

fn dispatch_overflow_collection_for_owner(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    owner: Identity,
    mut idle_storehouses: Vec<Building>,
) {
    let Some(network) = tick.road_network(owner) else {
        return;
    };
    let mut sources: Vec<OverflowSource> = Vec::new();
    for building_id in tick.building_ids_for_kinds(ctx, owner, STOREHOUSE_OVERFLOW_SOURCE_KINDS) {
        let Some(source) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        if !source.construction_complete
            || tick.building_disabled_by_fire(ctx, source.id)
            || building_has_active_trip(ctx, source.id)
        {
            continue;
        }
        for &commodity in overflow_source_commodities(&source) {
            let capacity = building_commodity_cap(&source.kind, commodity);
            if capacity <= 1e-6 {
                continue;
            }
            let stock = building_commodity_stock(&source, commodity);
            let excess = stock - capacity * STOREHOUSE_OVERFLOW_THRESHOLD;
            if excess <= 1e-6 {
                continue;
            }
            sources.push(OverflowSource {
                building: source.clone(),
                commodity,
                excess,
                fill_ratio: stock / capacity,
            });
        }
    }
    sources.sort_by(|a, b| {
        compare_storehouse_source_priority(a.fill_ratio, a.building.id, b.fill_ratio, b.building.id)
    });

    for mut source in sources {
        let Some((storehouse_index, _)) = idle_storehouses
            .iter()
            .enumerate()
            .filter_map(|(index, storehouse)| {
                if storehouse_collection_room(storehouse, source.commodity) <= 1e-6 {
                    return None;
                }
                let distance = local_delivery_distance(
                    network,
                    source.building.x,
                    source.building.z,
                    storehouse.x,
                    storehouse.z,
                )?;
                Some((index, distance))
            })
            .min_by(|(index_a, distance_a), (index_b, distance_b)| {
                compare_storehouse_destination(
                    *distance_a,
                    idle_storehouses[*index_a].id,
                    *distance_b,
                    idle_storehouses[*index_b].id,
                )
            })
        else {
            continue;
        };

        let storehouse = &idle_storehouses[storehouse_index];
        let room = storehouse_collection_room(storehouse, source.commodity);
        let requested = source.excess.min(room);
        let workers = storehouse.assigned_labor.min(2).max(1);
        if try_start_building_supply_trip(
            ctx,
            tick,
            clock,
            network,
            &mut source.building,
            storehouse,
            workers,
            source.commodity,
            TIMBER_DELIVERY_SPEED_MPS,
            TIMBER_DELIVERY_UNLOAD_SEC,
            STOREHOUSE_HAUL_PER_WORKER,
            requested,
        ) {
            ctx.db.building().id().update(source.building);
            idle_storehouses.swap_remove(storehouse_index);
            if idle_storehouses.is_empty() {
                break;
            }
        }
    }
}

fn storehouse_collection_room(storehouse: &Building, commodity: CommodityKind) -> f64 {
    let percent = match commodity {
        CommodityKind::Timber => storehouse.storehouse_timber_target_percent,
        CommodityKind::Stone => storehouse.storehouse_stone_target_percent,
        CommodityKind::Firewood => storehouse.storehouse_firewood_target_percent,
        CommodityKind::Charcoal => storehouse.storehouse_charcoal_target_percent,
        CommodityKind::Iron => storehouse.storehouse_iron_target_percent,
        CommodityKind::Clay => storehouse.storehouse_clay_target_percent,
        CommodityKind::Salt => storehouse.storehouse_salt_target_percent,
        _ => return 0.0,
    };
    storehouse_filtered_collection_headroom(
        storage_accepts_commodity(storehouse, commodity),
        building_commodity_stock(storehouse, commodity),
        building_commodity_cap(&storehouse.kind, commodity),
        percent,
    )
}

fn overflow_source_commodities(source: &Building) -> &'static [CommodityKind] {
    match source.kind.as_str() {
        "lumber_mill" => &[CommodityKind::Timber],
        "stone_quarry" | "large_quarry" => &[CommodityKind::Stone],
        "woodcutters_lodge" => &[CommodityKind::Firewood],
        "mine" => MINE_OVERFLOW_COMMODITIES,
        "clay_pit" => &[CommodityKind::Clay],
        _ => &[],
    }
}
