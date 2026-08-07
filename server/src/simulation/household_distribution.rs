//! Abstract household distribution from physical market stalls and wells.
//!
//! The physical logistics chain ends at a shared distribution point. Stock is
//! still conserved and road topology still decides coverage, but routine
//! household provisioning does not reserve a worker or create a delivery trip.

use std::collections::{BTreeMap, HashMap};

use spacetimedb::{Identity, ReducerContext};

use crate::db::*;
use crate::economy::{
    building_commodity_stock, deposit_building_commodity, deposit_residence_commodity,
    withdraw_building_commodity,
};
use crate::simulation::delivery_cargo::{
    delivery_stock_room, residence_commodity_delivery_room, selected_food_delivery_commodity_for_residence,
    withdraw_delivery_cargo,
};
use crate::simulation::residence_needs::state::{migrate_and_sync_food_inventory, persist_needs};
use crate::simulation::residence_needs::{
    apply_need_delivery, load_needs, need_stock, sync_food_need_rows, ResidenceNeedKind,
};
use crate::simulation::tick_context::SimTickContext;
use crate::tables::{Building, Residence};

const MARKET_NEEDS: [ResidenceNeedKind; 6] = [
    ResidenceNeedKind::Firewood,
    ResidenceNeedKind::Food,
    ResidenceNeedKind::PreservedFood,
    ResidenceNeedKind::Ale,
    ResidenceNeedKind::Cloth,
    ResidenceNeedKind::Pottery,
];

#[derive(Clone, Copy, Debug, PartialEq)]
struct DistributionTarget {
    residence_id: u64,
    preferred_source_id: u64,
    x: f64,
    z: f64,
    distance: f64,
}

/// Recalculate local market availability immediately from the stock currently
/// on stalls. Each compatible market serves its claimed road-connected homes;
/// scarce stock reaches the closest homes first, with stable id ordering for
/// equal routes.
pub fn step_market_household_distribution(ctx: &ReducerContext, tick: &SimTickContext) {
    for need_kind in MARKET_NEEDS {
        // Scan residences once per need and group the cached claims by source.
        // This keeps distribution proportional to homes plus active stalls,
        // rather than multiplying a whole residence scan by every market.
        let residences: Vec<Residence> = ctx
            .db
            .residence()
            .iter()
            .filter(|residence| {
                !residence.abandoned
                    && residence.population > 0
                    && need_kind.is_active_for_tier(residence.tier)
                    && !tick.residence_disabled_by_fire(ctx, residence.id)
                    && residence_has_distribution_room(ctx, residence.id, need_kind)
            })
            .collect();
        let mut residences_by_market: BTreeMap<u64, Vec<Residence>> = BTreeMap::new();
        for residence in residences {
            let Some(market_id) =
                tick.local_marketplace_for_residence(ctx, residence.owner, residence.id, need_kind)
            else {
                continue;
            };
            residences_by_market
                .entry(market_id)
                .or_default()
                .push(residence);
        }

        let mut targets_by_owner: HashMap<Identity, Vec<DistributionTarget>> = HashMap::new();
        for (market_id, residences) in residences_by_market {
            let Some(market) = ctx.db.building().id().find(&market_id) else {
                continue;
            };
            if market.kind != "marketplace"
                || !market.construction_complete
                || tick.building_disabled_by_fire(ctx, market.id)
                || market_stock(&market, need_kind) <= 1e-9
            {
                continue;
            }
            let Some(network) = tick.road_network(market.owner) else {
                continue;
            };
            let positions: Vec<(f64, f64)> = residences
                .iter()
                .map(|residence| (residence.x, residence.z))
                .collect();
            let distances = network.road_path_distances_from(market.x, market.z, &positions);
            targets_by_owner
                .entry(market.owner)
                .or_default()
                .extend(distribution_targets(&residences, market.id, distances));
        }

        let market_candidates: Vec<Building> = ctx
            .db
            .building()
            .iter()
            .filter(|building| {
                building.kind == "marketplace"
                    && building.construction_complete
                    && !tick.building_disabled_by_fire(ctx, building.id)
                    && market_stock(building, need_kind) > 1e-9
            })
            .collect();
        let mut sources_by_owner: HashMap<Identity, Vec<Building>> = HashMap::new();
        for market in market_candidates {
            let Some(network) = tick.road_network(market.owner) else {
                continue;
            };
            if tick.marketplace_has_stall_workers(ctx, network, &market, need_kind) {
                sources_by_owner
                    .entry(market.owner)
                    .or_default()
                    .push(market);
            }
        }

        for (owner, mut targets) in targets_by_owner {
            let Some(network) = tick.road_network(owner) else {
                continue;
            };
            let Some(sources) = sources_by_owner.get_mut(&owner) else {
                continue;
            };
            sources.sort_by_key(|market| market.id);
            sort_distribution_targets(&mut targets);

            for target in targets {
                if let Some(preferred_index) = sources.iter().position(|market| {
                    market.id == target.preferred_source_id
                        && market_stock(market, need_kind) > 1e-9
                }) {
                    distribute_to_residence(
                        ctx,
                        &mut sources[preferred_index],
                        target.residence_id,
                        need_kind,
                    );
                }
                if !residence_has_distribution_room(ctx, target.residence_id, need_kind) {
                    continue;
                }
                // Markets form one abstract supply network per connected road
                // branch. If the nearest stall empties, another stocked stall
                // can cover the home without waiting for the next tick.
                for source in sources.iter_mut() {
                    if source.id == target.preferred_source_id
                        || market_stock(source, need_kind) <= 1e-9
                        || !network.road_connected(source.x, source.z, target.x, target.z)
                    {
                        continue;
                    }
                    distribute_to_residence(ctx, source, target.residence_id, need_kind);
                    if !residence_has_distribution_room(ctx, target.residence_id, need_kind) {
                        break;
                    }
                }
            }
            for market in sources.iter().cloned() {
                ctx.db.building().id().update(market);
            }
        }
    }
}

/// Allocate an operational well's stored water to every home in its service
/// territory before industry can claim the remainder. This is the water
/// equivalent of market availability and never creates a household cart.
pub fn distribute_well_water(ctx: &ReducerContext, tick: &SimTickContext, well: &mut Building) {
    if well.water <= 1e-9 {
        return;
    }
    let Some(network) = tick.road_network(well.owner) else {
        return;
    };
    let residences: Vec<Residence> = ctx
        .db
        .residence()
        .owner()
        .filter(&well.owner)
        .filter(|residence| {
            !residence.abandoned
                && residence.population > 0
                && ResidenceNeedKind::Water.is_active_for_tier(residence.tier)
                && !tick.residence_disabled_by_fire(ctx, residence.id)
                && residence_has_distribution_room(ctx, residence.id, ResidenceNeedKind::Water)
                && tick.well_supplier_for(ctx, well.owner, residence.id) == Some(well.id)
        })
        .collect();
    let positions: Vec<(f64, f64)> = residences
        .iter()
        .map(|residence| (residence.x, residence.z))
        .collect();
    let distances = network.road_path_distances_from(well.x, well.z, &positions);
    let mut targets = distribution_targets(&residences, well.id, distances);
    sort_distribution_targets(&mut targets);
    for target in targets {
        if well.water <= 1e-9 {
            break;
        }
        distribute_to_residence(ctx, well, target.residence_id, ResidenceNeedKind::Water);
    }
}

fn distribution_targets(
    residences: &[Residence],
    preferred_source_id: u64,
    distances: Vec<Option<f64>>,
) -> Vec<DistributionTarget> {
    residences
        .iter()
        .zip(distances)
        .filter_map(|(residence, distance)| {
            let distance = distance.filter(|distance| distance.is_finite())?;
            Some(DistributionTarget {
                residence_id: residence.id,
                preferred_source_id,
                x: residence.x,
                z: residence.z,
                distance,
            })
        })
        .collect()
}

fn sort_distribution_targets(targets: &mut [DistributionTarget]) {
    targets.sort_by(|left, right| {
        left.distance
            .total_cmp(&right.distance)
            .then_with(|| left.residence_id.cmp(&right.residence_id))
    });
}

fn residence_has_distribution_room(
    ctx: &ReducerContext,
    residence_id: u64,
    need_kind: ResidenceNeedKind,
) -> bool {
    delivery_stock_room(
        need_kind,
        need_stock(&load_needs(ctx, residence_id), need_kind),
    ) > 1e-9
}

fn distribute_to_residence(
    ctx: &ReducerContext,
    source: &mut Building,
    residence_id: u64,
    need_kind: ResidenceNeedKind,
) {
    if matches!(
        need_kind,
        ResidenceNeedKind::Food | ResidenceNeedKind::PreservedFood
    ) {
        distribute_food_to_residence(ctx, source, residence_id, need_kind);
        return;
    }
    let stock = need_stock(&load_needs(ctx, residence_id), need_kind);
    let room = delivery_stock_room(need_kind, stock);
    if room <= 1e-9 {
        return;
    }
    let delivered = withdraw_delivery_cargo(source, need_kind, room);
    if delivered > 1e-9 {
        apply_need_delivery(ctx, residence_id, need_kind, delivered);
    }
}

fn distribute_food_to_residence(
    ctx: &ReducerContext,
    source: &mut Building,
    residence_id: u64,
    need_kind: ResidenceNeedKind,
) {
    let Some(mut residence) = ctx.db.residence().id().find(&residence_id) else {
        return;
    };
    let mut needs = load_needs(ctx, residence_id);
    migrate_and_sync_food_inventory(&mut residence, &mut needs);
    persist_needs(ctx, residence_id, &needs);
    ctx.db.residence().id().update(residence);

    loop {
        let Some(mut residence) = ctx.db.residence().id().find(&residence_id) else {
            return;
        };
        let need_stock_now = need_stock(&load_needs(ctx, residence_id), need_kind);
        let need_room = delivery_stock_room(need_kind, need_stock_now);
        if need_room <= 1e-9 {
            return;
        }
        let Some(commodity) = selected_food_delivery_commodity_for_residence(
            source,
            &residence,
            need_kind,
        ) else {
            return;
        };
        let commodity_room = residence_commodity_delivery_room(&residence, commodity);
        let amount = need_room
            .min(commodity_room)
            .min(building_commodity_stock(source, commodity));
        if amount <= 1e-9 {
            return;
        }
        let withdrawn = withdraw_building_commodity(source, commodity, amount);
        let deposited = deposit_residence_commodity(
            &mut residence,
            commodity,
            withdrawn,
            crate::simulation::residence_needs::food::stock_capacity(),
            crate::simulation::residence_needs::provisions::stock_capacity(
                ResidenceNeedKind::PreservedFood,
            ),
        );
        if deposited + 1e-9 < withdrawn {
            // Defensive conservation if a concurrently refreshed row exposes
            // less pantry room than the allocation snapshot.
            deposit_building_commodity(source, commodity, withdrawn - deposited);
        }
        if deposited <= 1e-9 {
            return;
        }
        ctx.db.residence().id().update(residence.clone());
        sync_food_need_rows(ctx, &residence);
    }
}

fn market_stock(building: &Building, need_kind: ResidenceNeedKind) -> f64 {
    crate::simulation::delivery_cargo::building_delivery_stock(building, need_kind)
}

#[cfg(test)]
mod tests {
    use super::{sort_distribution_targets, DistributionTarget};

    #[test]
    fn scarce_distribution_prioritizes_nearest_home_then_stable_id() {
        let mut ordered = vec![
            DistributionTarget {
                residence_id: 30,
                preferred_source_id: 1,
                x: 0.0,
                z: 0.0,
                distance: 40.0,
            },
            DistributionTarget {
                residence_id: 10,
                preferred_source_id: 1,
                x: 0.0,
                z: 0.0,
                distance: 12.0,
            },
            DistributionTarget {
                residence_id: 20,
                preferred_source_id: 1,
                x: 0.0,
                z: 0.0,
                distance: 12.0,
            },
        ];
        sort_distribution_targets(&mut ordered);
        assert_eq!(
            ordered,
            vec![
                DistributionTarget {
                    residence_id: 10,
                    preferred_source_id: 1,
                    x: 0.0,
                    z: 0.0,
                    distance: 12.0,
                },
                DistributionTarget {
                    residence_id: 20,
                    preferred_source_id: 1,
                    x: 0.0,
                    z: 0.0,
                    distance: 12.0,
                },
                DistributionTarget {
                    residence_id: 30,
                    preferred_source_id: 1,
                    x: 0.0,
                    z: 0.0,
                    distance: 40.0,
                },
            ]
        );
    }
}
