//! Material reservations, construction hauling, and builder progress.

use std::collections::HashMap;

use spacetimedb::ReducerContext;

use crate::balance_generated::{
    CONSTRUCTION_TREASURY_TRANSFER_PER_SEC, CONSTRUCTION_WORK_PER_WORKER_PER_SEC,
    FARMSTEAD_STARTER_BARLEY_SEED, FARMSTEAD_STARTER_SEED_GRAIN, STARTING_BREAD, STARTING_FIREWOOD,
    STARTING_IRONWORK, TICK_DT,
};
use crate::construction_priority::{
    construction_labor_queue_callup, construction_labor_ready, construction_priority_bucket,
    ConstructionLaborSite, CONSTRUCTION_PRIORITY_HOLD, CONSTRUCTION_PRIORITY_LEVELS,
    CONSTRUCTION_PRIORITY_NORMAL,
};
use crate::db::*;
use crate::economy::{
    available_building_labor, building_commodity_stock, queued_construction_callup_labor,
    CommodityKind,
};
use crate::resource_units::whole_units;
use crate::roads::RoadNetwork;
use crate::simulation::delivery_trips::{
    available_free_haulers, building_has_inbound_supply_trip, construction_source_cart_busy,
    onsite_building_labor, try_start_construction_supply_trip,
};
use crate::simulation::road_logistics::local_delivery_distance;
use crate::simulation::{labor_and_logistics_paused, GameClock, SimTickContext};
use crate::supply_policy::{
    construction_source_available_stock, construction_source_priority,
    select_supply_route_candidate,
};
use crate::tables::Building;

pub fn step_construction_sites(ctx: &ReducerContext, tick: &SimTickContext, clock: &GameClock) {
    let mut site_buckets: [Vec<u64>; CONSTRUCTION_PRIORITY_LEVELS] =
        std::array::from_fn(|_| Vec::new());
    let mut owner_sites: HashMap<spacetimedb::Identity, Vec<ConstructionLaborSite>> =
        HashMap::new();
    for building in ctx
        .db
        .building()
        .iter()
        .filter(|building| !building.construction_complete)
    {
        let bucket = construction_priority_bucket(building.construction_priority);
        if bucket > CONSTRUCTION_PRIORITY_HOLD as usize {
            site_buckets[bucket].push(building.id);
            owner_sites
                .entry(building.owner)
                .or_default()
                .push(ConstructionLaborSite {
                    building_id: building.id,
                    priority: building.construction_priority,
                    assigned_labor: building.assigned_labor,
                    max_labor: crate::balance_generated::CONSTRUCTION_MAX_BUILDERS,
                    work_ready: construction_labor_ready(
                        building.construction_required_timber,
                        building.construction_required_stone,
                        building.construction_required_ironwork,
                        building.construction_delivered_timber,
                        building.construction_delivered_stone,
                        building.construction_delivered_ironwork,
                        building.construction_progress,
                        building.construction_treasury_timber,
                        building.construction_treasury_stone,
                        building.construction_treasury_ironwork,
                        building.construction_required_roof_tiles, building.construction_delivered_roof_tiles, building.construction_treasury_roof_tiles,
 building.construction_required_dressed_stone, building.construction_delivered_dressed_stone, building.construction_treasury_dressed_stone,
                    ),
                    // The baseline queue never recalls crews, so inbound state
                    // is intentionally irrelevant here. The Town Hall rotation
                    // remains responsible for safe blocked-crew reassignment.
                    inbound_supply: false,
                });
        }
    }

    call_up_queued_builders(ctx, owner_sites);

    // Four fixed buckets keep dispatch linear while urgent sites get first
    // claim on busy carts and scarce physical stores.
    for site_id in site_buckets.into_iter().rev().flatten() {
        let Some(mut site) = ctx.db.building().id().find(&site_id) else {
            continue;
        };

        transfer_treasury_reserve(ctx, tick, clock, &mut site);
        dispatch_reserved_stock(ctx, tick, clock, &mut site, CommodityKind::Stone);
        dispatch_reserved_stock(ctx, tick, clock, &mut site, CommodityKind::Timber);
        dispatch_reserved_stock(ctx, tick, clock, &mut site, CommodityKind::Ironwork);
        dispatch_reserved_stock(ctx, tick, clock, &mut site, CommodityKind::RoofTiles);
        dispatch_reserved_stock(ctx, tick, clock, &mut site, CommodityKind::DressedStone);
        advance_builder_work(ctx, tick, clock, site);
    }
}

/// Starts ready queued sites whenever genuinely free villagers exist. This is
/// baseline construction behavior and does not require a Town Hall: the clerk
/// steward still adds the distinct ability to recall blocked crews. The budget
/// starts every zero-builder site it can, then preserves a small free cart pool
/// before expanding crews beyond one worker.
fn call_up_queued_builders(
    ctx: &ReducerContext,
    owner_sites: HashMap<spacetimedb::Identity, Vec<ConstructionLaborSite>>,
) {
    for (owner, sites) in owner_sites {
        let available_labor = available_building_labor(ctx, owner);
        if available_labor == 0 {
            continue;
        }
        let ready_unstaffed_sites = sites
            .iter()
            .filter(|site| site.work_ready && site.assigned_labor == 0)
            .count() as u32;
        let callup_labor = queued_construction_callup_labor(available_labor, ready_unstaffed_sites);
        if callup_labor == 0 {
            continue;
        }
        let callup = construction_labor_queue_callup(&sites, callup_labor);
        for (building_id, target_labor) in callup.targets {
            let Some(mut building) = ctx.db.building().id().find(&building_id) else {
                continue;
            };
            if building.owner != owner
                || building.construction_complete
                || building.construction_priority == CONSTRUCTION_PRIORITY_HOLD
                || target_labor <= building.assigned_labor
            {
                continue;
            }
            building.assigned_labor =
                target_labor.min(crate::balance_generated::CONSTRUCTION_MAX_BUILDERS);
            ctx.db.building().id().update(building);
        }
    }
}

fn transfer_treasury_reserve(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    site: &mut Building,
) {
    let onsite_labor = onsite_building_labor(ctx, site);
    if onsite_labor == 0 || labor_and_logistics_paused(ctx, tick, site.owner, clock) {
        return;
    }
    let Some(mut treasury) = ctx.db.player_resources().owner().find(&site.owner) else {
        return;
    };
    // The legacy treasury handoff had no persisted carry, so a sub-unit tick
    // could only create fractional material ledgers. Move at least one whole
    // unit per staffed tick; builder progress remains continuous.
    let mut transfer_budget =
        whole_units(CONSTRUCTION_TREASURY_TRANSFER_PER_SEC * onsite_labor as f64 * TICK_DT)
            .max(1.0);

    let stone = transfer_budget
        .min(whole_units(site.construction_treasury_stone))
        .min(whole_units(treasury.stone));
    if stone > 1e-6 {
        treasury.stone -= stone;
        site.construction_treasury_stone -= stone;
        site.construction_reserved_stone = (site.construction_reserved_stone - stone).max(0.0);
        site.construction_delivered_stone += stone;
        transfer_budget -= stone;
    }

    let timber = transfer_budget
        .min(whole_units(site.construction_treasury_timber))
        .min(whole_units(treasury.timber));
    if timber > 1e-6 {
        treasury.timber -= timber;
        site.construction_treasury_timber -= timber;
        site.construction_reserved_timber = (site.construction_reserved_timber - timber).max(0.0);
        site.construction_delivered_timber += timber;
        transfer_budget -= timber;
    }

    let ironwork = transfer_budget
        .min(whole_units(site.construction_treasury_ironwork))
        .min(whole_units(treasury.ironwork));
    if ironwork > 1e-6 {
        treasury.ironwork -= ironwork;
        site.construction_treasury_ironwork -= ironwork;
        site.construction_reserved_ironwork =
            (site.construction_reserved_ironwork - ironwork).max(0.0);
        site.construction_delivered_ironwork += ironwork;
        transfer_budget -= ironwork;
    }

    let roof_tiles = transfer_budget
        .min(whole_units(site.construction_treasury_roof_tiles))
        .min(whole_units(treasury.roof_tiles));
    if roof_tiles > 1e-6 {
        treasury.roof_tiles -= roof_tiles;
        site.construction_treasury_roof_tiles -= roof_tiles;
        site.construction_reserved_roof_tiles =
            (site.construction_reserved_roof_tiles - roof_tiles).max(0.0);
        site.construction_delivered_roof_tiles += roof_tiles;
        transfer_budget -= roof_tiles;
    }
    let dressed_stone = transfer_budget.min(whole_units(site.construction_treasury_dressed_stone)).min(whole_units(treasury.dressed_stone));
    if dressed_stone > 1e-6 {
        treasury.dressed_stone -= dressed_stone;
        site.construction_treasury_dressed_stone -= dressed_stone;
        site.construction_reserved_dressed_stone =
            (site.construction_reserved_dressed_stone - dressed_stone).max(0.0);
        site.construction_delivered_dressed_stone += dressed_stone;
    }

    ctx.db.player_resources().owner().update(treasury);
    ctx.db.building().id().update(site.clone());
}

fn dispatch_reserved_stock(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    site: &mut Building,
    commodity: CommodityKind,
) {
    let physical_reserved = match commodity {
        CommodityKind::Timber => {
            (site.construction_reserved_timber - site.construction_treasury_timber).max(0.0)
        }
        CommodityKind::Stone => {
            (site.construction_reserved_stone - site.construction_treasury_stone).max(0.0)
        }
        CommodityKind::Ironwork => {
            (site.construction_reserved_ironwork - site.construction_treasury_ironwork).max(0.0)
        }
        CommodityKind::RoofTiles => {
            (site.construction_reserved_roof_tiles - site.construction_treasury_roof_tiles).max(0.0)
        }
        CommodityKind::DressedStone => {
            (site.construction_reserved_dressed_stone - site.construction_treasury_dressed_stone).max(0.0)
        }
        _ => 0.0,
    };
    // Every departure atomically withdraws stock and reduces this physical
    // reservation before its trip is inserted. Do not serialize an entire
    // material stream behind one distant cart: distinct available crews may
    // carry distinct reserved loads concurrently without double spending.
    if physical_reserved <= 1e-6 {
        return;
    }
    if labor_and_logistics_paused(ctx, tick, site.owner, clock) {
        return;
    }
    let Some(network) = tick.road_network(site.owner) else {
        return;
    };
    let free_haulers = available_free_haulers(ctx, site.owner);
    let mut source_groups: [Vec<Building>; 8] = std::array::from_fn(|_| Vec::new());
    for source_id in tick.construction_source_ids(ctx, site.owner, commodity) {
        let Some(source) = ctx.db.building().id().find(&source_id) else {
            continue;
        };
        if source.id == site.id
            || !source.construction_complete
            || tick.building_disabled_by_fire(ctx, source.id)
            || construction_source_cart_busy(ctx, &source)
            || (source.kind == "village_storehouse"
                && building_has_inbound_supply_trip(ctx, source.id))
            || construction_source_stock(&source, commodity) <= 1e-6
        {
            continue;
        }
        source_groups[construction_source_priority(&source.kind, source.assigned_labor) as usize]
            .push(source);
    }

    // Preserve the existing storehouse/specialist preference, but compare
    // candidates inside each priority class by time-weighted local distance. Only the
    // first reachable class performs a dispatch, so no whole-set sort or route
    // polyline construction is needed for candidates that cannot win.
    for sources in source_groups {
        let selected = select_supply_route_candidate(
            sources.into_iter().filter_map(|source| {
                construction_route_distance(&network, &source, site)
                    .map(|distance| (source, distance))
            }),
            |candidate| candidate.1,
            |candidate| candidate.0.id,
        );
        let Some((mut source, _distance)) = selected else {
            continue;
        };
        if try_start_construction_supply_trip(
            ctx,
            tick,
            clock,
            &network,
            &mut source,
            site,
            commodity,
            free_haulers,
        ) {
            return;
        }
    }
}

fn construction_source_stock(source: &Building, commodity: CommodityKind) -> f64 {
    let commodity_name = match commodity {
        CommodityKind::Timber => "timber",
        CommodityKind::Stone => "stone",
        CommodityKind::Ironwork => "ironwork",
        CommodityKind::RoofTiles => "roofTiles",
        CommodityKind::DressedStone => "dressedStone",
        _ => "",
    };
    construction_source_available_stock(
        &source.kind,
        source.carpenter_cart_service_target_trips,
        commodity_name,
        building_commodity_stock(source, commodity),
    )
}

fn construction_route_distance(
    network: &RoadNetwork,
    source: &Building,
    site: &Building,
) -> Option<f64> {
    local_delivery_distance(network, source.x, source.z, site.x, site.z)
        .filter(|distance| *distance > 1e-6)
}

fn advance_builder_work(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    mut site: Building,
) {
    let onsite_labor = onsite_building_labor(ctx, &site);
    if onsite_labor == 0 || labor_and_logistics_paused(ctx, tick, site.owner, clock) {
        return;
    }
    let required_total = site.construction_required_timber
        + site.construction_required_stone
        + site.construction_required_ironwork
        + site.construction_required_roof_tiles
        + site.construction_required_dressed_stone;
    let delivered_total = site.construction_delivered_timber
        + site.construction_delivered_stone
        + site.construction_delivered_ironwork
        + site.construction_delivered_roof_tiles
        + site.construction_delivered_dressed_stone;
    let material_readiness = if required_total <= 1e-6 {
        1.0
    } else {
        (delivered_total / required_total).clamp(0.0, 1.0)
    };
    let work_step = if required_total <= 1e-6 {
        1.0
    } else {
        CONSTRUCTION_WORK_PER_WORKER_PER_SEC * onsite_labor as f64 * TICK_DT / required_total
    };
    site.construction_progress = (site.construction_progress + work_step).min(material_readiness);

    let timber_ready =
        site.construction_delivered_timber + 1e-6 >= site.construction_required_timber;
    let stone_ready = site.construction_delivered_stone + 1e-6 >= site.construction_required_stone;
    let ironwork_ready =
        site.construction_delivered_ironwork + 1e-6 >= site.construction_required_ironwork;
    let roof_tiles_ready =
        site.construction_delivered_roof_tiles + 1e-6 >= site.construction_required_roof_tiles;
    let dressed_stone_ready =
        site.construction_delivered_dressed_stone + 1e-6 >= site.construction_required_dressed_stone;
    if timber_ready
        && stone_ready
        && ironwork_ready
        && roof_tiles_ready
        && dressed_stone_ready
        && site.construction_progress >= 1.0 - 1e-6
    {
        complete_site(ctx, &mut site);
        if site.kind == "chapel" {
            tick.invalidate_staffed_chapel(site.owner);
        }
    }
    ctx.db.building().id().update(site);
}

fn complete_site(ctx: &ReducerContext, site: &mut Building) {
    site.construction_complete = true;
    site.fire_repair_active = false;
    site.construction_progress = 1.0;
    site.construction_reserved_timber = 0.0;
    site.construction_reserved_stone = 0.0;
    site.construction_reserved_ironwork = 0.0;
    site.construction_reserved_roof_tiles = 0.0;
    site.construction_reserved_dressed_stone = 0.0;
    site.construction_treasury_timber = 0.0;
    site.construction_treasury_stone = 0.0;
    site.construction_treasury_ironwork = 0.0;
    site.construction_treasury_roof_tiles = 0.0;
    site.construction_treasury_dressed_stone = 0.0;
    site.construction_priority = CONSTRUCTION_PRIORITY_NORMAL;
    site.assigned_labor = 0;

    if site.kind == "founders_camp"
        && crate::settlements::activate_founding_settlement(ctx, site.settlement_id, site.id)
    {
        // The large commissioning cost funds a modest physical expedition
        // package. It must be carted into this town's permanent stores before
        // the temporary stockyard can disband.
        site.founding_shelter_active = true;
        site.firewood += STARTING_FIREWOOD;
        site.rye_bread += STARTING_BREAD;
        site.ironwork += STARTING_IRONWORK;
    }

    crate::settlements::link_completed_town_hall(ctx, site);

    if site.kind == "threshing_barn" {
        // A newly established holding arrives with enough seed for roughly one
        // efficient field. Later expansion must come from its own harvest or a
        // road-linked granary, avoiding a first-crop grain deadlock.
        site.rye_grain += FARMSTEAD_STARTER_SEED_GRAIN;
        site.oat_grain += FARMSTEAD_STARTER_SEED_GRAIN;
        site.maslin_grain += FARMSTEAD_STARTER_SEED_GRAIN;
        site.flax += FARMSTEAD_STARTER_SEED_GRAIN;
        site.barley += FARMSTEAD_STARTER_BARLEY_SEED;
    }
}
