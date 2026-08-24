//! Monthly burgage assessments and physical civic lockbox receipts.

use std::collections::{HashMap, HashSet};

use spacetimedb::ReducerContext;

use crate::balance_generated::{CALENDAR_SECONDS_PER_DAY, TICK_DT};
use crate::db::*;
use crate::economy::{credit_local_civic_receipts, debit_residence_wealth};
use crate::fiscal_policy::{land_levy_assessed_value, monthly_land_levy};
use crate::resource_units::{whole_cost, whole_units};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::road_logistics::local_delivery_distance;
use crate::simulation::tick_context::SimTickContext;
use crate::tables::{Building, BurgageZone};

fn land_levy_assessment_due(clock: &GameClock) -> bool {
    let ticks_per_day = (CALENDAR_SECONDS_PER_DAY / TICK_DT).round().max(1.0) as u64;
    clock.total_days > 0 && clock.month_day == 1 && clock.sim_tick % ticks_per_day == 0
}

fn burgage_zone_area(zone: &BurgageZone) -> f64 {
    let points = [
        (zone.corner_ax, zone.corner_az),
        (zone.corner_bx, zone.corner_bz),
        (zone.corner_cx, zone.corner_cz),
        (zone.corner_dx, zone.corner_dz),
    ];
    let mut doubled_area = 0.0;
    for index in 0..points.len() {
        let (ax, az) = points[index];
        let (bx, bz) = points[(index + 1) % points.len()];
        doubled_area += ax * bz - bx * az;
    }
    doubled_area.abs() * 0.5
}

fn nearest_land_levy_lockbox<'a>(
    tick: &SimTickContext,
    owner: spacetimedb::Identity,
    residence_x: f64,
    residence_z: f64,
    marketplaces: &'a [&Building],
) -> Option<&'a Building> {
    let network = tick.road_network(owner)?;
    marketplaces
        .iter()
        .copied()
        .filter_map(|marketplace| {
            local_delivery_distance(
                network,
                residence_x,
                residence_z,
                marketplace.x,
                marketplace.z,
            )
            .map(|distance| (marketplace, distance))
        })
        .min_by(|(market_a, distance_a), (market_b, distance_b)| {
            distance_a
                .partial_cmp(distance_b)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| market_a.id.cmp(&market_b.id))
        })
        .map(|(marketplace, _)| marketplace)
}

/// Assesses one annual-rate installment on the first morning of each rational
/// month. Households never go negative; unpaid assessment remains private
/// wealth and is exposed only as the assessed-versus-collected ledger gap.
/// Paid coin is aggregated at each road-linked Marketplace lockbox so one
/// free-hauler cart can carry it to the civic treasury.
pub fn step_land_levies(ctx: &ReducerContext, tick: &SimTickContext, clock: &GameClock) {
    if !land_levy_assessment_due(clock) {
        return;
    }

    let zones = ctx
        .db
        .burgage_zone()
        .iter()
        .map(|zone| {
            let plot_area = burgage_zone_area(&zone) / zone.plot_count.max(1) as f64;
            (zone.id, plot_area)
        })
        .collect::<HashMap<_, _>>();
    let backyard_residences = ctx
        .db
        .backyard_garden()
        .iter()
        .map(|garden| garden.residence_id)
        .collect::<HashSet<_>>();
    let marketplace_rows = ctx
        .db
        .building()
        .iter()
        .filter(|building| {
            building.kind == "marketplace"
                && building.construction_complete
                && !tick.building_disabled_by_fire(ctx, building.id)
        })
        .collect::<Vec<_>>();

    let owners = ctx
        .db
        .player_resources()
        .iter()
        .map(|resources| resources.owner)
        .collect::<Vec<_>>();
    for owner in owners {
        let Some(resources) = ctx.db.player_resources().owner().find(&owner) else {
            continue;
        };
        let rate = crate::fiscal_policy::clamp_land_levy_rate(resources.land_levy_rate);
        if rate <= 1e-9 {
            continue;
        }
        let collection_multiplier = crate::economy::town_hall_tax_collection_multiplier(ctx, owner);
        let owner_markets = marketplace_rows
            .iter()
            .filter(|marketplace| marketplace.owner == owner)
            .collect::<Vec<_>>();
        let mut assessed_total = 0.0;
        let mut collected_total = 0.0;
        let mut receipts_by_market: HashMap<u64, f64> = HashMap::new();
        let residences = ctx
            .db
            .residence()
            .owner()
            .filter(&owner)
            .filter(|residence| residence.population > 0 && !residence.abandoned)
            .collect::<Vec<_>>();
        for residence in residences {
            let plot_area = zones.get(&residence.zone_id).copied().unwrap_or(0.0);
            let assessed_value = land_levy_assessed_value(
                residence.tier,
                plot_area,
                backyard_residences.contains(&residence.id),
            );
            let assessment = monthly_land_levy(assessed_value, rate);
            assessed_total += assessment;
            let Some(lockbox) =
                nearest_land_levy_lockbox(tick, owner, residence.x, residence.z, &owner_markets)
            else {
                continue;
            };
            let requested = whole_cost(assessment * collection_multiplier);
            let paid = debit_residence_wealth(ctx, &residence, requested);
            if paid <= 1e-9 {
                continue;
            }
            collected_total += paid;
            *receipts_by_market.entry(lockbox.id).or_default() += paid;
        }

        for (market_id, amount) in receipts_by_market {
            if let Some(mut marketplace) = ctx.db.building().id().find(&market_id) {
                credit_local_civic_receipts(ctx, &mut marketplace, amount);
                ctx.db.building().id().update(marketplace);
            }
        }
        if let Some(mut ledger) = ctx.db.player_resources().owner().find(&owner) {
            ledger.land_levy_assessed_total =
                whole_units(ledger.land_levy_assessed_total) + whole_units(assessed_total);
            ledger.land_levy_collected_total =
                whole_units(ledger.land_levy_collected_total) + whole_units(collected_total);
            ctx.db.player_resources().owner().update(ledger);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::burgage_zone_area;
    use crate::tables::BurgageZone;

    #[test]
    fn burgage_area_is_stable_for_clockwise_or_counterclockwise_corners() {
        let zone = BurgageZone {
            id: 1,
            owner: spacetimedb::Identity::ZERO,
            corner_ax: 0.0,
            corner_az: 0.0,
            corner_bx: 20.0,
            corner_bz: 0.0,
            corner_cx: 20.0,
            corner_cz: 10.0,
            corner_dx: 0.0,
            corner_dz: 10.0,
            frontage_edge: 0,
            plot_count: 1,
        };
        assert!((burgage_zone_area(&zone) - 200.0).abs() < 1e-9);
    }
}
