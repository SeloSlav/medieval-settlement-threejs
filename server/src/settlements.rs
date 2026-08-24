//! Persistent on-map communities and their temporary founding cohorts.
//!
//! Settlement identity is deliberately porous: it scopes housing, civic
//! administration, and diagnostics, but never partitions the owner's resource,
//! logistics, or workforce ledgers.

use spacetimedb::{Identity, ReducerContext};

use crate::balance_generated::{OFFROAD_DELIVERY_SPEED_MULTIPLIER, STARTING_POPULATION};
use crate::db::*;
use crate::roads::{load_owner_road_network, RoadNetwork};
use crate::tables::{Building, PlayerResources, Settlement};

const EPSILON: f64 = 1e-6;
/// New residential frontage must remain within a practical travel-time
/// catchment of an existing community source: 260 m by road, with open ground
/// scaled by the authored off-road speed. Occupied homes then extend that
/// catchment organically; a distant cluster needs its own Founders' Camp seed.
pub const RESIDENTIAL_SETTLEMENT_REACH: f64 = 260.0;

fn direct_distance(ax: f64, az: f64, bx: f64, bz: f64) -> f64 {
    (bx - ax).hypot(bz - az)
}

fn travel_effort(network: Option<&RoadNetwork>, ax: f64, az: f64, bx: f64, bz: f64) -> f64 {
    network
        .and_then(|roads| roads.road_path_distance(ax, az, bx, bz))
        .filter(|distance| distance.is_finite())
        .unwrap_or_else(|| {
            direct_distance(ax, az, bx, bz) / OFFROAD_DELIVERY_SPEED_MULTIPLIER.max(EPSILON)
        })
}

fn current_sim_tick(ctx: &ReducerContext) -> u64 {
    ctx.db
        .world_config()
        .id()
        .find(&0)
        .map_or(0, |config| config.sim_tick)
}

fn next_settlement_name(ctx: &ReducerContext, owner: Identity) -> String {
    let ordinal = ctx.db.settlement().owner().filter(&owner).count() + 1;
    format!("Town {ordinal}")
}

fn settlement_row(
    ctx: &ReducerContext,
    resources: &PlayerResources,
    owner: Identity,
    x: f64,
    z: f64,
    founding_camp_id: u64,
    active: bool,
    founder_population: u32,
    unhoused_founders: u32,
) -> Settlement {
    Settlement {
        id: 0,
        owner,
        name: next_settlement_name(ctx, owner),
        anchor_x: x,
        anchor_z: z,
        founding_camp_id,
        founder_population,
        unhoused_founders,
        active,
        town_hall_id: 0,
        created_tick: current_sim_tick(ctx),
        economic_activity_tax_rate: resources.economic_activity_tax_rate,
        pantry_safeguard_policy: resources.pantry_safeguard_policy,
        land_levy_rate: resources.land_levy_rate,
        import_duty_rate: resources.import_duty_rate,
        export_duty_rate: resources.export_duty_rate,
        seasonal_labor_steward_enabled: resources.seasonal_labor_steward_enabled,
        construction_labor_steward_enabled: resources.construction_labor_steward_enabled,
        production_labor_steward_enabled: resources.production_labor_steward_enabled,
        labor_steward_reserve: resources.labor_steward_reserve,
        night_watch_policy: resources.night_watch_policy,
        night_gathering_policy: resources.night_gathering_policy,
        night_work_policy: resources.night_work_policy,
        night_lighting_policy: resources.night_lighting_policy,
        night_curfew_policy: resources.night_curfew_policy,
        land_levy_assessed_total: 0.0,
        land_levy_collected_total: 0.0,
        import_duty_collected_total: 0.0,
        export_duty_collected_total: 0.0,
        last_night_report_day: 0,
        last_night_households: 0,
        last_night_well_rested_households: 0,
        last_night_cold_households: 0,
        last_night_social_households: 0,
        last_night_workers: 0,
        last_night_watch_strength: 0.0,
        last_night_incidents: 0,
        last_night_theft_gold: 0.0,
        last_night_wildlife_sightings: 0,
        last_night_lighting_fuel_used: 0.0,
        last_night_lighting_fuel_shortfall: 0.0,
        night_community_cohesion: 0.5,
        night_labor_fatigue: 0.0,
    }
}

fn owner_resources(ctx: &ReducerContext, owner: Identity) -> Result<PlayerResources, String> {
    ctx.db
        .player_resources()
        .owner()
        .find(&owner)
        .ok_or_else(|| "Player resources are unavailable.".to_string())
}

/// Creates the first active community and its five-person founding cohort.
pub fn create_initial_settlement(
    ctx: &ReducerContext,
    owner: Identity,
    camp_id: u64,
    x: f64,
    z: f64,
) -> Result<Settlement, String> {
    let resources = owner_resources(ctx, owner)?;
    Ok(ctx.db.settlement().insert(settlement_row(
        ctx,
        &resources,
        owner,
        x,
        z,
        camp_id,
        true,
        STARTING_POPULATION,
        STARTING_POPULATION,
    )))
}

/// Creates civic identity for a paid expedition while its camp is built. The
/// people arrive only when construction completes.
pub fn create_planned_settlement(
    ctx: &ReducerContext,
    owner: Identity,
    x: f64,
    z: f64,
) -> Result<Settlement, String> {
    let resources = owner_resources(ctx, owner)?;
    Ok(ctx
        .db
        .settlement()
        .insert(settlement_row(ctx, &resources, owner, x, z, 0, false, 0, 0)))
}

pub fn attach_founding_camp(
    ctx: &ReducerContext,
    settlement_id: u64,
    camp_id: u64,
) -> Result<(), String> {
    let mut settlement = ctx
        .db
        .settlement()
        .id()
        .find(&settlement_id)
        .ok_or_else(|| "Founding settlement is unavailable.".to_string())?;
    settlement.founding_camp_id = camp_id;
    ctx.db.settlement().id().update(settlement);
    Ok(())
}

/// Activates a paid expedition exactly once. Re-running completion logic is an
/// idempotent no-op and cannot duplicate its people.
pub fn activate_founding_settlement(
    ctx: &ReducerContext,
    settlement_id: u64,
    camp_id: u64,
) -> bool {
    let Some(mut settlement) = ctx.db.settlement().id().find(&settlement_id) else {
        return false;
    };
    if settlement.active {
        return false;
    }
    settlement.active = true;
    settlement.founding_camp_id = camp_id;
    settlement.founder_population = STARTING_POPULATION;
    settlement.unhoused_founders = STARTING_POPULATION;
    ctx.db.settlement().id().update(settlement);
    true
}

/// Atomically consumes one founder from a residence's own community. The
/// caller updates that same residence in the current reducer transaction.
pub fn take_unhoused_founder(ctx: &ReducerContext, settlement_id: u64) -> bool {
    if settlement_id == 0 {
        return false;
    }
    let Some(mut settlement) = ctx.db.settlement().id().find(&settlement_id) else {
        return false;
    };
    if !settlement.active || settlement.unhoused_founders == 0 {
        return false;
    }
    settlement.unhoused_founders -= 1;
    ctx.db.settlement().id().update(settlement);
    true
}

pub fn owner_unhoused_founders(ctx: &ReducerContext, owner: Identity) -> u32 {
    ctx.db
        .settlement()
        .owner()
        .filter(&owner)
        .filter(|settlement| settlement.active)
        .map(|settlement| settlement.unhoused_founders)
        .sum()
}

pub fn active_settlement_founder_origins(
    ctx: &ReducerContext,
    owner: Identity,
) -> Vec<(u64, f64, f64, u32)> {
    let mut origins = ctx
        .db
        .settlement()
        .owner()
        .filter(&owner)
        .filter(|settlement| settlement.active && settlement.unhoused_founders > 0)
        .filter_map(|settlement| {
            let camp = ctx.db.building().id().find(&settlement.founding_camp_id)?;
            (camp.kind == "founders_camp" && camp.construction_complete).then_some((
                settlement.id,
                camp.x,
                camp.z,
                settlement.unhoused_founders,
            ))
        })
        .collect::<Vec<_>>();
    origins.sort_by_key(|origin| origin.0);
    origins
}

fn is_community_influence_building(building: &Building) -> bool {
    building.kind == "founders_camp"
        || (building.construction_complete
            && matches!(
                building.kind.as_str(),
                "marketplace" | "chapel" | "town_hall"
            ))
}

/// Deterministic nearest-community claim for new rows. Existing non-zero
/// membership is never recomputed, so later roads and civic growth cannot move
/// an occupied household between towns.
pub fn settlement_for_position(
    ctx: &ReducerContext,
    owner: Identity,
    x: f64,
    z: f64,
) -> Option<u64> {
    scored_settlements_for_position(ctx, owner, x, z)
        .into_iter()
        .next()
        .map(|(_, settlement_id)| settlement_id)
}

/// Residential claims use the same deterministic influence field as ordinary
/// affiliation but reject neutral wilderness beyond practical community reach.
pub fn residential_settlement_for_position(
    ctx: &ReducerContext,
    owner: Identity,
    x: f64,
    z: f64,
) -> Option<u64> {
    scored_settlements_for_position(ctx, owner, x, z)
        .into_iter()
        .find(|(effort, _)| *effort <= RESIDENTIAL_SETTLEMENT_REACH + EPSILON)
        .map(|(_, settlement_id)| settlement_id)
}

fn scored_settlements_for_position(
    ctx: &ReducerContext,
    owner: Identity,
    x: f64,
    z: f64,
) -> Vec<(f64, u64)> {
    let mut settlements = ctx
        .db
        .settlement()
        .owner()
        .filter(&owner)
        .collect::<Vec<_>>();
    settlements.sort_by_key(|settlement| settlement.id);
    if settlements.is_empty() {
        return Vec::new();
    }

    let network = load_owner_road_network(ctx, owner);
    let mut scored = settlements
        .into_iter()
        .map(|settlement| {
            let mut best = travel_effort(
                network.as_ref(),
                x,
                z,
                settlement.anchor_x,
                settlement.anchor_z,
            );
            for building in ctx
                .db
                .building()
                .settlement_id()
                .filter(&settlement.id)
                .filter(is_community_influence_building)
            {
                best = best.min(travel_effort(
                    network.as_ref(),
                    x,
                    z,
                    building.x,
                    building.z,
                ));
            }
            for residence in ctx
                .db
                .residence()
                .settlement_id()
                .filter(&settlement.id)
                .filter(|residence| !residence.abandoned && residence.population > 0)
            {
                best = best.min(travel_effort(
                    network.as_ref(),
                    x,
                    z,
                    residence.x,
                    residence.z,
                ));
            }
            (best, settlement.id)
        })
        .collect::<Vec<_>>();
    scored.sort_by(|a, b| a.0.total_cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    scored
}

fn paid_founding_camp(building: &Building) -> bool {
    building.kind == "founders_camp"
        && [
            building.construction_required_timber,
            building.construction_required_stone,
            building.construction_required_ironwork,
            building.construction_required_roof_tiles,
        ]
        .into_iter()
        .any(|amount| amount > EPSILON)
}

fn bootstrap_founding_camp(building: &Building) -> bool {
    building.kind == "founders_camp" && !paid_founding_camp(building)
}

/// Additive migration for saves created before settlements were authoritative.
/// Existing physical rows are never deleted and population is not fabricated
/// for a mature community whose original camp has already retired.
pub fn ensure_owner_settlements(ctx: &ReducerContext, owner: Identity) {
    let mut settlements = ctx
        .db
        .settlement()
        .owner()
        .filter(&owner)
        .collect::<Vec<_>>();
    let buildings = ctx.db.building().owner().filter(&owner).collect::<Vec<_>>();
    let has_residences = ctx.db.residence().owner().filter(&owner).next().is_some();
    if settlements.is_empty() && buildings.is_empty() && !has_residences {
        return;
    }

    if settlements.is_empty() {
        let Ok(resources) = owner_resources(ctx, owner) else {
            return;
        };
        let bootstrap = buildings
            .iter()
            .find(|building| bootstrap_founding_camp(building));
        let anchor = bootstrap
            .map(|camp| (camp.x, camp.z))
            .or_else(|| {
                buildings
                    .iter()
                    .find(|building| building.kind == "town_hall")
                    .map(|building| (building.x, building.z))
            })
            .or_else(|| {
                ctx.db
                    .residence()
                    .owner()
                    .filter(&owner)
                    .next()
                    .map(|residence| (residence.x, residence.z))
            })
            .or_else(|| buildings.first().map(|building| (building.x, building.z)))
            .unwrap_or((0.0, 0.0));
        let housed: u32 = ctx
            .db
            .residence()
            .owner()
            .filter(&owner)
            .filter(|residence| !residence.abandoned)
            .map(|residence| residence.population)
            .sum();
        let inferred_unhoused =
            if bootstrap.is_some() && !resources.legacy_unhoused_population_bonus_enabled {
                STARTING_POPULATION.saturating_sub(housed)
            } else {
                0
            };
        let base = ctx.db.settlement().insert(settlement_row(
            ctx,
            &resources,
            owner,
            anchor.0,
            anchor.1,
            bootstrap.map_or(0, |camp| camp.id),
            true,
            if bootstrap.is_some() {
                STARTING_POPULATION
            } else {
                0
            },
            inferred_unhoused,
        ));
        settlements.push(base);

        let mut paid_camps = buildings
            .iter()
            .filter(|building| paid_founding_camp(building))
            .collect::<Vec<_>>();
        paid_camps.sort_by_key(|camp| camp.id);
        for camp in paid_camps {
            let active = camp.construction_complete;
            settlements.push(ctx.db.settlement().insert(settlement_row(
                ctx,
                &resources,
                owner,
                camp.x,
                camp.z,
                camp.id,
                active,
                if active { STARTING_POPULATION } else { 0 },
                if active { STARTING_POPULATION } else { 0 },
            )));
        }
    }

    // Camps have an unambiguous one-to-one relation; stamp those first.
    for settlement in &settlements {
        if settlement.founding_camp_id == 0 {
            continue;
        }
        if let Some(mut camp) = ctx.db.building().id().find(&settlement.founding_camp_id) {
            if camp.settlement_id == 0 {
                camp.settlement_id = settlement.id;
                ctx.db.building().id().update(camp);
            }
        }
    }

    for mut building in ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| building.settlement_id == 0)
        .collect::<Vec<_>>()
    {
        if let Some(settlement_id) = settlement_for_position(ctx, owner, building.x, building.z) {
            building.settlement_id = settlement_id;
            ctx.db.building().id().update(building);
        }
    }
    for mut zone in ctx
        .db
        .burgage_zone()
        .owner()
        .filter(&owner)
        .filter(|zone| zone.settlement_id == 0)
        .collect::<Vec<_>>()
    {
        let x = (zone.corner_ax + zone.corner_bx + zone.corner_cx + zone.corner_dx) * 0.25;
        let z = (zone.corner_az + zone.corner_bz + zone.corner_cz + zone.corner_dz) * 0.25;
        if let Some(settlement_id) = settlement_for_position(ctx, owner, x, z) {
            zone.settlement_id = settlement_id;
            ctx.db.burgage_zone().id().update(zone);
        }
    }
    for mut residence in ctx
        .db
        .residence()
        .owner()
        .filter(&owner)
        .filter(|residence| residence.settlement_id == 0)
        .collect::<Vec<_>>()
    {
        let settlement_id = ctx
            .db
            .burgage_zone()
            .id()
            .find(&residence.zone_id)
            .map(|zone| zone.settlement_id)
            .filter(|settlement_id| *settlement_id != 0)
            .or_else(|| settlement_for_position(ctx, owner, residence.x, residence.z));
        if let Some(settlement_id) = settlement_id {
            residence.settlement_id = settlement_id;
            ctx.db.residence().id().update(residence);
        }
    }

    let completed_halls = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| {
            building.kind == "town_hall"
                && building.construction_complete
                && building.settlement_id != 0
        })
        .collect::<Vec<_>>();
    for hall in completed_halls {
        link_completed_town_hall(ctx, &hall);
    }
}

pub fn retire_founding_camp(ctx: &ReducerContext, settlement_id: u64, camp_id: u64) {
    let Some(mut settlement) = ctx.db.settlement().id().find(&settlement_id) else {
        return;
    };
    if settlement.founding_camp_id != camp_id || settlement.unhoused_founders > 0 {
        return;
    }
    settlement.founding_camp_id = 0;
    ctx.db.settlement().id().update(settlement);
}

/// Cancels an unfinished paid expedition without leaving a ghost community.
/// Once any other row has joined it, cancellation is rejected rather than
/// silently transferring sticky household membership.
pub fn cancel_planned_settlement(
    ctx: &ReducerContext,
    owner: Identity,
    settlement_id: u64,
    camp_id: u64,
    x: f64,
    z: f64,
) -> Result<Option<u64>, String> {
    let settlement = ctx
        .db
        .settlement()
        .id()
        .find(&settlement_id)
        .ok_or_else(|| "The planned community is unavailable.".to_string())?;
    if settlement.owner != owner || settlement.active || settlement.founding_camp_id != camp_id {
        return Err("An active Founders' Camp disbands only after its people are housed and its stock is moved.".to_string());
    }
    let has_other_buildings = ctx
        .db
        .building()
        .settlement_id()
        .filter(&settlement_id)
        .any(|building| building.id != camp_id);
    let has_homes = ctx
        .db
        .residence()
        .settlement_id()
        .filter(&settlement_id)
        .next()
        .is_some()
        || ctx
            .db
            .burgage_zone()
            .settlement_id()
            .filter(&settlement_id)
            .next()
            .is_some();
    if has_other_buildings || has_homes {
        return Err(
            "Remove this planned community's other buildings and homes before cancelling its expedition."
                .to_string(),
        );
    }
    ctx.db.settlement().id().delete(settlement_id);
    Ok(settlement_for_position(ctx, owner, x, z))
}

pub fn link_completed_town_hall(ctx: &ReducerContext, building: &Building) {
    if building.kind != "town_hall"
        || !building.construction_complete
        || building.settlement_id == 0
    {
        return;
    }
    let Some(mut settlement) = ctx.db.settlement().id().find(&building.settlement_id) else {
        return;
    };
    settlement.town_hall_id = building.id;
    ctx.db.settlement().id().update(settlement);
}

pub fn unlink_town_hall(ctx: &ReducerContext, settlement_id: u64, building_id: u64) {
    let Some(mut settlement) = ctx.db.settlement().id().find(&settlement_id) else {
        return;
    };
    if settlement.town_hall_id != building_id {
        return;
    }
    settlement.town_hall_id = 0;
    ctx.db.settlement().id().update(settlement);
}

#[cfg(test)]
mod tests {
    use super::{direct_distance, travel_effort};
    use crate::balance_generated::OFFROAD_DELIVERY_SPEED_MULTIPLIER;

    #[test]
    fn direct_distance_is_deterministic() {
        assert_eq!(direct_distance(0.0, 0.0, 3.0, 4.0), 5.0);
    }

    #[test]
    fn open_ground_reach_uses_the_same_time_weight_as_local_logistics() {
        assert_eq!(
            travel_effort(None, 0.0, 0.0, 3.0, 4.0),
            5.0 / OFFROAD_DELIVERY_SPEED_MULTIPLIER,
        );
    }
}
