//! Lifecycle for the temporary founders' shelter and its open stockyard.

use spacetimedb::ReducerContext;

use crate::balance_generated::{
    STOREHOUSE_HAUL_PER_WORKER, TIMBER_DELIVERY_SPEED_MPS, TIMBER_DELIVERY_UNLOAD_SEC,
};
use crate::db::*;
use crate::economy::{
    building_commodity_cap, building_commodity_room, building_commodity_stock,
    storage_accepts_commodity, CommodityKind, ALL_COMMODITIES,
};
use crate::residence_upgrade_policy::residence_project_active;
use crate::simulation::delivery_trips::{
    available_free_haulers, building_has_active_trip, building_has_conflicting_inbound_supply_trip,
    try_start_free_building_supply_trip,
};
use crate::simulation::reclamation::reclamation_destination_priority;
use crate::simulation::road_logistics::local_delivery_distance;
use crate::simulation::{GameClock, SimTickContext};
use crate::storehouse_policy::storehouse_filtered_collection_headroom;
use crate::tables::Building;

const EPSILON: f64 = 1e-6;
/// While founders still occupy the shelter, move a household food load before
/// draining the much larger fuel pile. Ironwork remains eligible so the
/// maintenance chain can bootstrap before every founder is housed.
const OCCUPIED_SHELTER_RELOCATION_COMMODITIES: [CommodityKind; 5] = [
    CommodityKind::Food,
    CommodityKind::RyeBread,
    CommodityKind::MaslinBread,
    CommodityKind::Firewood,
    CommodityKind::Ironwork,
];

fn founding_relocation_commodities(starter_supplies_only: bool) -> &'static [CommodityKind] {
    if starter_supplies_only {
        &OCCUPIED_SHELTER_RELOCATION_COMMODITIES
    } else {
        ALL_COMMODITIES
    }
}

fn founding_relocation_load_amount(relocatable: f64, target_room: f64) -> f64 {
    if !relocatable.is_finite() || !target_room.is_finite() {
        return 0.0;
    }
    relocatable
        .max(0.0)
        .min(target_room.max(0.0))
        .min(STOREHOUSE_HAUL_PER_WORKER)
}

pub fn step_founding_sites(ctx: &ReducerContext, tick: &SimTickContext, clock: &GameClock) {
    let site_ids = ctx
        .db
        .building()
        .iter()
        .filter(|building| {
            building.kind == "founders_camp"
                && building.construction_complete
                && building.settlement_id != 0
        })
        .map(|building| building.id)
        .collect::<Vec<_>>();

    for site_id in site_ids {
        let Some(mut site) = ctx.db.building().id().find(&site_id) else {
            continue;
        };
        let Some(settlement) = ctx.db.settlement().id().find(&site.settlement_id) else {
            continue;
        };
        if !settlement.active || settlement.founding_camp_id != site.id {
            continue;
        }
        let mut site_changed = false;

        let shelter_should_be_active = settlement.unhoused_founders > 0;
        if site.founding_shelter_active != shelter_should_be_active {
            site.founding_shelter_active = shelter_should_be_active;
            site_changed = true;
        }

        let town_hall =
            first_completed_building(ctx, site.owner, site.settlement_id, "town_hall");
        if let Some(ref town_hall) = town_hall {
            if site.gold > EPSILON
                && !building_has_active_trip(ctx, site.id)
                && available_free_haulers(ctx, site.owner) > 0
            {
                if let Some(network) = tick.road_network(site.owner) {
                    let gold = site.gold;
                    if try_start_free_building_supply_trip(
                        ctx,
                        tick,
                        clock,
                        network,
                        &mut site,
                        town_hall,
                        CommodityKind::Gold,
                        TIMBER_DELIVERY_SPEED_MPS,
                        TIMBER_DELIVERY_UNLOAD_SEC,
                        STOREHOUSE_HAUL_PER_WORKER,
                        gold,
                    ) {
                        site_changed = true;
                    }
                }
            }
        }

        let starter_supplies_only = site.founding_shelter_active;
        if !building_has_active_trip(ctx, site.id)
            && available_free_haulers(ctx, site.owner) > 0
            && try_start_stockyard_relocation(ctx, tick, clock, &mut site, starter_supplies_only)
        {
            site_changed = true;
        }

        if site_changed {
            ctx.db.building().id().update(site.clone());
        }
        if site.founding_shelter_active
            || founding_camp_has_active_trip(ctx, site.id)
            || has_portable_stock(&site)
        {
            continue;
        }

        // Community identity outlives its temporary camp. A Town Hall is not a
        // prerequisite: it matters only when physical gold still needs a civic
        // lockbox and therefore keeps `has_portable_stock` true.
        crate::settlements::retire_founding_camp(ctx, site.settlement_id, site.id);
        ctx.db.building().id().delete(site.id);
    }
}

fn founding_camp_has_active_trip(ctx: &ReducerContext, camp_id: u64) -> bool {
    ctx.db
        .delivery_trip()
        .building_id()
        .filter(&camp_id)
        .next()
        .is_some()
        || ctx
            .db
            .delivery_trip()
            .target_building_id()
            .filter(&camp_id)
            .next()
            .is_some()
        || ctx
            .db
            .delivery_trip()
            .labor_building_id()
            .filter(&camp_id)
            .next()
            .is_some()
}

/// While the shelter is occupied, one free villager may move starter bread to
/// a completed Granary and firewood to a completed Storehouse. A depot worker
/// then owns the corresponding Marketplace table. Ironwork can still enter its
/// maintenance chain. Once every founder has a home, the same route clears all
/// other uncommitted stock.
fn try_start_stockyard_relocation(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    site: &mut Building,
    starter_supplies_only: bool,
) -> bool {
    let Some(network) = tick.road_network(site.owner) else {
        return false;
    };

    for &commodity in founding_relocation_commodities(starter_supplies_only) {
        let relocatable = relocatable_stock(ctx, site, commodity);
        if relocatable <= EPSILON {
            continue;
        }

        let target = ctx
            .db
            .building()
            .owner()
            .filter(&site.owner)
            .filter(|candidate| {
                candidate.id != site.id
                    && candidate.settlement_id == site.settlement_id
                    && candidate.construction_complete
                    && !tick.building_disabled_by_fire(ctx, candidate.id)
                    && !building_has_conflicting_inbound_supply_trip(ctx, candidate, commodity)
            })
            .filter_map(|candidate| {
                let (priority, room) =
                    founding_destination_room(&candidate, commodity, starter_supplies_only)?;
                let distance =
                    local_delivery_distance(&network, site.x, site.z, candidate.x, candidate.z)?;
                Some((candidate, priority, room, distance))
            })
            .min_by(|a, b| {
                a.1.cmp(&b.1)
                    .then_with(|| a.3.total_cmp(&b.3))
                    .then_with(|| a.0.id.cmp(&b.0.id))
            })
            .map(|(candidate, _, room, _)| (candidate, room));
        let Some((target, target_room)) = target else {
            continue;
        };
        let requested = founding_relocation_load_amount(relocatable, target_room);
        if try_start_free_building_supply_trip(
            ctx,
            tick,
            clock,
            network,
            site,
            &target,
            commodity,
            TIMBER_DELIVERY_SPEED_MPS,
            TIMBER_DELIVERY_UNLOAD_SEC,
            STOREHOUSE_HAUL_PER_WORKER,
            requested,
        ) {
            return true;
        }
    }
    false
}

/// Construction materials retain the player's explicit storehouse filters and
/// collection ceilings. Other portable stock uses the same destination
/// hierarchy as demolition recovery, but may not bounce back into another
/// temporary camp or reclamation pile.
fn founding_destination_room(
    candidate: &Building,
    commodity: CommodityKind,
    starter_supplies_only: bool,
) -> Option<(u8, f64)> {
    let starter_household_supply = starter_supplies_only
        && matches!(
            commodity,
            CommodityKind::Firewood | CommodityKind::RyeBread | CommodityKind::MaslinBread
        );
    if matches!(
        commodity,
        CommodityKind::Timber | CommodityKind::Stone | CommodityKind::Firewood
    ) {
        if candidate.kind != "village_storehouse" {
            return None;
        }
        let room = founding_storehouse_room(candidate, commodity);
        let priority = u8::from(starter_household_supply);
        return (room > EPSILON).then_some((priority, room));
    }
    if matches!(candidate.kind.as_str(), "founders_camp" | "salvage_pile") {
        return None;
    }
    if !storage_accepts_commodity(candidate, commodity) {
        return None;
    }
    let priority =
        founding_destination_priority(commodity, &candidate.kind, starter_supplies_only)?;
    let room = building_commodity_room(candidate, commodity);
    (room > EPSILON).then_some((priority, room))
}

fn founding_destination_priority(
    commodity: CommodityKind,
    kind: &str,
    starter_supplies_only: bool,
) -> Option<u8> {
    if matches!(
        commodity,
        CommodityKind::RyeBread | CommodityKind::MaslinBread
    ) {
        return (kind == "granary").then_some(u8::from(starter_supplies_only));
    }
    reclamation_destination_priority(commodity, kind)
}

fn relocatable_stock(ctx: &ReducerContext, site: &Building, commodity: CommodityKind) -> f64 {
    let stock = building_commodity_stock(site, commodity).max(0.0);
    let reserved = match commodity {
        CommodityKind::Timber
        | CommodityKind::Stone
        | CommodityKind::Ironwork
        | CommodityKind::RoofTiles => {
            let construction_reserved: f64 = ctx
                .db
                .building()
                .owner()
                .filter(&site.owner)
                .filter(|building| !building.construction_complete)
                .map(|building| match commodity {
                    CommodityKind::Timber => (building.construction_reserved_timber
                        - building.construction_treasury_timber)
                        .max(0.0),
                    CommodityKind::Stone => (building.construction_reserved_stone
                        - building.construction_treasury_stone)
                        .max(0.0),
                    CommodityKind::Ironwork => (building.construction_reserved_ironwork
                        - building.construction_treasury_ironwork)
                        .max(0.0),
                    CommodityKind::RoofTiles => (building.construction_reserved_roof_tiles
                        - building.construction_treasury_roof_tiles)
                        .max(0.0),
                    _ => 0.0,
                })
                .sum();
            let residence_reserved: f64 = if matches!(
                commodity,
                CommodityKind::Ironwork | CommodityKind::RoofTiles
            ) {
                if commodity == CommodityKind::RoofTiles {
                    ctx.db
                        .residence()
                        .owner()
                        .filter(&site.owner)
                        .filter(|residence| {
                            residence_project_active(
                                residence.upgrade_target_tier,
                                residence.tier,
                                residence.backyard_project_kind,
                                residence.fire_repair_active,
                                residence.decay_repair_active,
                                residence.roof_tile_retrofit_active,
                            )
                        })
                        .map(|residence| residence.upgrade_reserved_roof_tiles.max(0.0))
                        .sum()
                } else {
                    0.0
                }
            } else {
                ctx.db
                    .residence()
                    .owner()
                    .filter(&site.owner)
                    .filter(|residence| {
                        residence_project_active(
                            residence.upgrade_target_tier,
                            residence.tier,
                            residence.backyard_project_kind,
                            residence.fire_repair_active,
                            residence.decay_repair_active,
                            residence.roof_tile_retrofit_active,
                        )
                    })
                    .map(|residence| match commodity {
                        CommodityKind::Timber => residence.upgrade_reserved_timber.max(0.0),
                        CommodityKind::Stone => residence.upgrade_reserved_stone.max(0.0),
                        _ => 0.0,
                    })
                    .sum()
            };
            construction_reserved + residence_reserved
        }
        _ => 0.0,
    };
    (stock - reserved).max(0.0)
}

fn founding_storehouse_room(storehouse: &Building, commodity: CommodityKind) -> f64 {
    let accepts = storage_accepts_commodity(storehouse, commodity);
    let target_percent = match commodity {
        CommodityKind::Timber => storehouse.storehouse_timber_target_percent,
        CommodityKind::Stone => storehouse.storehouse_stone_target_percent,
        CommodityKind::Firewood => storehouse.storehouse_firewood_target_percent,
        _ => return 0.0,
    };
    storehouse_filtered_collection_headroom(
        accepts,
        building_commodity_stock(storehouse, commodity),
        building_commodity_cap(&storehouse.kind, commodity),
        target_percent,
    )
}

fn first_completed_building(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    settlement_id: u64,
    kind: &str,
) -> Option<Building> {
    ctx.db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| {
            building.settlement_id == settlement_id
                && building.kind == kind
                && building.construction_complete
        })
        .min_by_key(|building| building.id)
}

fn has_portable_stock(building: &Building) -> bool {
    ALL_COMMODITIES
        .iter()
        .copied()
        .any(|commodity| building_commodity_stock(building, commodity) > EPSILON)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starter_breads_prefer_the_market_and_keep_granary_fallback() {
        for bread in [CommodityKind::RyeBread, CommodityKind::MaslinBread] {
            assert_eq!(
                founding_destination_priority(bread, "marketplace", true),
                None,
            );
            assert_eq!(
                founding_destination_priority(bread, "granary", true),
                Some(1)
            );
            assert_eq!(
                founding_destination_priority(bread, "granary", false),
                Some(0)
            );
            for kind in ["foragers_shed", "hunters_hall", "fishing_camp", "bakery"] {
                assert_eq!(
                    founding_destination_priority(bread, kind, true),
                    None,
                    "starter bread must not relocate into {kind}",
                );
            }
        }
    }

    #[test]
    fn occupied_shelter_moves_edible_stock_before_bulk_fuel() {
        assert_eq!(
            founding_relocation_commodities(true),
            &[
                CommodityKind::Food,
                CommodityKind::RyeBread,
                CommodityKind::MaslinBread,
                CommodityKind::Firewood,
                CommodityKind::Ironwork,
            ],
        );
        assert_eq!(
                founding_relocation_commodities(false),
                ALL_COMMODITIES,
        );
    }

    #[test]
    fn founding_cart_load_is_bounded_and_conservative() {
        let stock = 240.0;
        let load = founding_relocation_load_amount(stock, 100.0);
        let remaining = stock - load;
        assert_eq!(load, STOREHOUSE_HAUL_PER_WORKER);
        assert!(load <= stock && load <= 100.0);
        assert!((remaining + load - stock).abs() <= EPSILON);
        assert_eq!(founding_relocation_load_amount(10.0, 4.0), 4.0);
        assert_eq!(founding_relocation_load_amount(f64::NAN, 4.0), 0.0);
    }
}
