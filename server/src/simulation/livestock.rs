use std::collections::HashMap;

use spacetimedb::{Identity, ReducerContext};

use crate::balance_generated::{
    CATTLE_AREA_PER_HEAD, CATTLE_BREEDING_PER_CYCLE, CATTLE_FOOD_PER_CYCLE_PER_HEAD,
    CATTLE_GRAIN_PER_UNSUPPORTED_HEAD, CATTLE_HAY_PER_UNSUPPORTED_HEAD,
    CATTLE_HAY_YIELD_PER_RESERVED_CAPACITY_PER_CYCLE, CATTLE_HEALTH_LOSS_PER_CYCLE,
    CATTLE_HEALTH_RECOVERY_PER_CYCLE, CATTLE_MAX_HERD, CATTLE_MAX_PLOUGH_SUPPORTED_FIELDS,
    CATTLE_MAX_SLOPE_DEGREES, CATTLE_MOISTURE_IDEAL, CATTLE_MOISTURE_TOLERANCE,
    CATTLE_PRESERVED_FOOD_PER_CYCLE_PER_HEAD, CATTLE_SLAUGHTER_FOOD_PER_HEAD,
    CATTLE_SLAUGHTER_PRESERVED_FOOD_PER_HEAD, LIVESTOCK_FARMSTEAD_PRESERVATION_SALT_PER_OUTPUT,
    LIVESTOCK_HAY_STORAGE_CAPACITY, LIVESTOCK_MANURE_TRANSFER_PER_TRIP, SHEEP_AREA_PER_HEAD,
    SHEEP_BREEDING_PER_CYCLE, SHEEP_FOOD_PER_CYCLE_PER_HEAD, SHEEP_GRAIN_PER_UNSUPPORTED_HEAD,
    SHEEP_HAY_PER_UNSUPPORTED_HEAD, SHEEP_HAY_YIELD_PER_RESERVED_CAPACITY_PER_CYCLE,
    SHEEP_HEALTH_LOSS_PER_CYCLE, SHEEP_HEALTH_RECOVERY_PER_CYCLE, SHEEP_MAX_HERD,
    SHEEP_MAX_SLOPE_DEGREES, SHEEP_MOISTURE_IDEAL, SHEEP_MOISTURE_TOLERANCE,
    SHEEP_PRESERVED_FOOD_PER_CYCLE_PER_HEAD, SHEEP_SLAUGHTER_FOOD_PER_HEAD,
    SHEEP_SLAUGHTER_PRESERVED_FOOD_PER_HEAD, SWINE_AREA_PER_HEAD, SWINE_BREEDING_PER_CYCLE,
    SWINE_FOOD_PER_CYCLE_PER_HEAD, SWINE_GRAIN_PER_UNSUPPORTED_HEAD, SWINE_HEALTH_LOSS_PER_CYCLE,
    SWINE_HEALTH_RECOVERY_PER_CYCLE, SWINE_MATURE_TREES_PER_HEAD, SWINE_MAX_HERD,
    SWINE_SLAUGHTER_FOOD_PER_HEAD, SWINE_SLAUGHTER_PRESERVED_FOOD_PER_HEAD, TICK_DT,
    TIMBER_DELIVERY_SPEED_MPS, TIMBER_DELIVERY_UNLOAD_SEC,
};
use crate::building_defs::building_def;
use crate::burgage::{Point2, ZoneCorners};
use crate::db::*;
use crate::economy::{
    building_commodity_cap, building_commodity_room, deposit_building_commodity,
    withdraw_building_commodity, CommodityKind,
};
use crate::farming::{centroid, point_in_field};
use crate::livestock_policy::{
    can_cull_one, can_store_full_sheep_clip, cattle_manure_output, effective_breeding_reserve,
    haymaking_share, is_haymaking_month, is_shearing_month, livestock_cycles_per_calendar_day,
    livestock_milk_allocation, projected_winter_fodder_grain, retain_priority_candidate,
    sheep_fleece_output,
};
use crate::reducers::livestock::{SPECIES_CATTLE, SPECIES_SHEEP, SPECIES_SWINE};
use crate::season_policy::{EnvironmentState, Season};
use crate::simulation::delivery_trips::{
    building_has_active_trip, building_has_inbound_supply_trip, onsite_building_labor,
    try_start_building_supply_trip,
};
use crate::simulation::expanded_economy::{
    dispatch_to_building, request_connected_commodity,
};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::road_logistics::local_delivery_distance;
use crate::simulation::tick_context::SimTickContext;
use crate::tables::{farm_field, Building, FarmField, LivestockHerd, Pasture};

pub fn step_pastoral_farmstead(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    environment: EnvironmentState,
    building: Building,
) {
    step_livestock_building(ctx, tick, clock, environment, building, false);
}

pub fn step_swineherd(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    environment: EnvironmentState,
    building: Building,
) {
    step_livestock_building(ctx, tick, clock, environment, building, true);
}

fn step_livestock_building(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    environment: EnvironmentState,
    mut building: Building,
    swine_building: bool,
) {
    let Some(mut herd) = ctx.db.livestock_herd().building_id().find(&building.id) else {
        ctx.db.building().id().update(building);
        return;
    };

    if swine_building && herd.species != SPECIES_SWINE {
        herd.species = SPECIES_SWINE;
    }
    let base_pasture_capacity = grazing_capacity(ctx, &building, &herd);
    let summer_hay_share = if herd.species != SPECIES_SWINE && is_haymaking_month(clock.month) {
        haymaking_share(herd.haymaking_percent)
    } else {
        0.0
    };
    herd.pasture_capacity = base_pasture_capacity
        * environment.pasture_capacity_multiplier()
        * (1.0 - summer_hay_share);
    herd.supplied_capacity = herd.pasture_capacity.min(herd.head_count as f64);

    let paused = labor_and_logistics_paused(ctx, tick, building.owner, clock);
    let onsite_labor = onsite_building_labor(ctx, &building);
    if !paused && onsite_labor > 0 {
        building.action_cooldown = (building.action_cooldown - TICK_DT).max(0.0);
        let unsupported = (herd.head_count as f64 - herd.pasture_capacity).max(0.0);
        let grain_per_head = species_grain_per_unsupported_head(herd.species);
        let immediate_grain_buffer = unsupported * grain_per_head * 2.0;
        let winter_grain_target = if matches!(environment.season, Season::Autumn | Season::Winter) {
            let projected_head_count = if environment.season == Season::Autumn {
                herd.head_count.min(effective_breeding_reserve(
                    herd.breeding_reserve,
                    species_max_herd(herd.species),
                ))
            } else {
                herd.head_count
            };
            let sabbath_observed = tick.sabbath_observance_enabled(ctx, building.owner)
                && tick.owner_has_staffed_chapel(ctx, building.owner);
            let cycles_per_day = building_def(&building.kind)
                .map(|def| {
                    livestock_cycles_per_calendar_day(
                        building.assigned_labor,
                        def.action_interval,
                        sabbath_observed,
                    )
                })
                .unwrap_or(0.0);
            projected_winter_fodder_grain(
                projected_head_count,
                base_pasture_capacity,
                herd.hay_stock,
                species_hay_per_unsupported_head(herd.species),
                grain_per_head,
                cycles_per_day,
            )
            .min(building_commodity_cap(&building.kind, CommodityKind::Grain))
        } else {
            0.0
        };
        let desired_grain = immediate_grain_buffer.max(winter_grain_target);
        if desired_grain > 0.05 {
            request_connected_commodity(
                ctx,
                tick,
                clock,
                &building,
                CommodityKind::Grain,
                &["threshing_barn", "granary"],
                desired_grain,
            );
        }

        if building.action_cooldown <= 1e-6 {
            run_livestock_cycle(
                clock,
                environment,
                base_pasture_capacity,
                &mut building,
                &mut herd,
            );
            let labor = onsite_labor as f64;
            building.action_cooldown = building_def(&building.kind)
                .map(|def| def.action_interval / labor)
                .unwrap_or(10.0);
        }

        if herd.species == SPECIES_SHEEP {
            // Shearing briefly takes the holding's only cart away from food
            // deliveries, making nearby weaving capacity matter in early summer.
            dispatch_to_building(
                ctx,
                tick,
                clock,
                &mut building,
                CommodityKind::Wool,
                &["weaver"],
            );
        }
        if herd.species == SPECIES_CATTLE {
            dispatch_manure_to_crop_farmstead(ctx, tick, clock, &mut building);
        }
        if herd.species != SPECIES_SWINE {
            // Household provisions and cattle manure keep priority. Any cured
            // surplus left after those duties can be centralized rather than
            // blocking the next livestock cycle in a full holding.
            dispatch_to_building(
                ctx,
                tick,
                clock,
                &mut building,
                CommodityKind::Cheese,
                &["granary"],
            );
            dispatch_to_building(
                ctx,
                tick,
                clock,
                &mut building,
                CommodityKind::Cheese,
                &["trading_post"],
            );
        }
        // All livestock species can create cured meat when surplus animals
        // are culled; pigs must not strand that stock at the holding.
        dispatch_to_building(
            ctx,
            tick,
            clock,
            &mut building,
            CommodityKind::CuredMeat,
            &["granary"],
        );
    }

    ctx.db.livestock_herd().building_id().update(herd);
    ctx.db.building().id().update(building);
}

fn run_livestock_cycle(
    clock: &GameClock,
    environment: EnvironmentState,
    base_pasture_capacity: f64,
    building: &mut Building,
    herd: &mut LivestockHerd,
) {
    herd.last_culled = 0;
    herd.last_hay_output = 0.0;
    let heads = herd.head_count as f64;
    if heads <= 0.0 {
        herd.last_food_output = 0.0;
        herd.last_preserved_output = 0.0;
        herd.last_wool_gold = 0.0;
        return;
    }

    if herd.species != SPECIES_SWINE && is_haymaking_month(clock.month) {
        let reserved_capacity =
            base_pasture_capacity.max(0.0) * haymaking_share(herd.haymaking_percent);
        let hay = reserved_capacity
            * species_hay_yield_per_reserved_capacity(herd.species)
            * environment.pasture_capacity_multiplier();
        let stored = hay.min((LIVESTOCK_HAY_STORAGE_CAPACITY - herd.hay_stock).max(0.0));
        herd.hay_stock += stored;
        herd.last_hay_output = stored;
    }

    let unsupported = (heads - herd.pasture_capacity).max(0.0);
    let hay_per_head = species_hay_per_unsupported_head(herd.species);
    let hay_supplement = if environment.season == Season::Winter && hay_per_head > 0.0 {
        (herd.hay_stock / hay_per_head).min(unsupported)
    } else {
        0.0
    };
    if hay_supplement > 0.0 {
        herd.hay_stock = (herd.hay_stock - hay_supplement * hay_per_head).max(0.0);
    }
    let grain_unsupported = (unsupported - hay_supplement).max(0.0);
    let grain_per_head = species_grain_per_unsupported_head(herd.species);
    let supplement = if grain_per_head > 0.0 {
        (building.grain / grain_per_head).min(grain_unsupported)
    } else {
        0.0
    };
    if supplement > 0.0 {
        withdraw_building_commodity(building, CommodityKind::Grain, supplement * grain_per_head);
    }
    herd.supplied_capacity = (herd.pasture_capacity + hay_supplement + supplement).min(heads);
    let support_ratio = (herd.supplied_capacity / heads).clamp(0.0, 1.0);
    let (health_recovery, health_loss) = species_health_rates(herd.species);
    herd.health = (herd.health + health_recovery * support_ratio
        - health_loss * (1.0 - support_ratio))
        .clamp(0.12, 1.0);

    let productive_heads = heads * support_ratio * herd.health;
    // Cattle and sheep provide a shared gross milk yield. The holding's milk
    // policy chooses how much becomes fresh milk or salted cheese; cheese is a
    // conversion, not a parallel free output. Pigs provide
    // meat only when actual surplus animals are culled below.
    let base_milk = productive_heads * species_food_per_cycle(herd.species);
    let base_cheese = productive_heads * species_preserved_per_cycle(herd.species);
    let (_, desired_cheese) = livestock_milk_allocation(
        building.processor_output_target_percent,
        base_milk,
        base_cheese,
        f64::INFINITY,
    );
    let stored_cheese =
        store_salted_farmstead_output(building, CommodityKind::Cheese, desired_cheese);
    herd.last_preserved_output = stored_cheese;
    let gross_milk = base_milk.max(0.0) + base_cheese.max(0.0);
    herd.last_food_output = deposit_building_commodity(
        building,
        CommodityKind::Milk,
        (gross_milk - stored_cheese).max(0.0),
    );
    if herd.species == SPECIES_CATTLE {
        deposit_building_commodity(
            building,
            CommodityKind::Manure,
            cattle_manure_output(productive_heads, environment.season),
        );
    }

    // A flock is shorn once in the early-summer window. The old implementation
    // minted gold every livestock cycle; keeping a physical annual fleece makes
    // storage, road hauling, workshop labor, and market capacity consequential.
    herd.last_wool_gold = 0.0;
    if herd.species == SPECIES_SHEEP
        && herd.last_shearing_year != clock.year
        && is_shearing_month(clock.month)
    {
        let fleece = sheep_fleece_output(productive_heads);
        let wool_room = building_commodity_room(building, CommodityKind::Wool);
        if can_store_full_sheep_clip(productive_heads, wool_room) {
            let stored = deposit_building_commodity(building, CommodityKind::Wool, fleece);
            herd.last_wool_output = stored;
            herd.last_shearing_year = clock.year;
        }
    }

    if support_ratio >= 0.9 && herd.health >= 0.72 {
        let max_herd = species_max_herd(herd.species);
        if herd.head_count < max_herd {
            herd.breeding_progress += productive_heads
                * species_breeding_per_cycle(herd.species)
                * environment.breeding_multiplier();
            while herd.breeding_progress >= 1.0 && herd.head_count < max_herd {
                herd.head_count += 1;
                herd.breeding_progress -= 1.0;
            }
        } else {
            // Do not bank years of unborn animals while a holding is full.
            herd.breeding_progress = herd.breeding_progress.min(0.999);
        }
    } else if support_ratio < 0.45 {
        herd.breeding_progress = (herd.breeding_progress - 0.08).max(0.0);
        if herd.health <= 0.2 && herd.head_count > 1 {
            herd.head_count -= 1;
            herd.health = 0.36;
        }
    }

    let maximum_herd = species_max_herd(herd.species);
    let (slaughter_food, slaughter_preserved) = species_slaughter_yields(herd.species);
    let saltable_slaughter =
        slaughter_preserved.min(farmstead_salted_output_capacity(building).min(
            building_commodity_room(building, CommodityKind::CuredMeat),
        ));
    let unsalted_slaughter = (slaughter_preserved - saltable_slaughter).max(0.0);
    if can_cull_one(
        clock.month,
        herd.head_count,
        herd.breeding_reserve,
        maximum_herd,
        building_commodity_room(building, CommodityKind::Meat),
        building_commodity_room(building, CommodityKind::CuredMeat),
        slaughter_food + unsalted_slaughter,
        saltable_slaughter,
    ) {
        herd.head_count -= 1;
        herd.last_culled = 1;
        herd.supplied_capacity = herd.supplied_capacity.min(herd.head_count as f64);
        // Unsalted meat enters the vulnerable fresh-food store instead of
        // becoming free cured provisions. No animal is discarded merely
        // because an imported salt cart has not reached the holding.
        herd.last_food_output += deposit_building_commodity(
            building,
            CommodityKind::Meat,
            slaughter_food + unsalted_slaughter,
        );
        herd.last_preserved_output += store_salted_farmstead_output(
            building,
            CommodityKind::CuredMeat,
            saltable_slaughter,
        );
    }
}

fn farmstead_salted_output_capacity(building: &Building) -> f64 {
    if LIVESTOCK_FARMSTEAD_PRESERVATION_SALT_PER_OUTPUT <= 1e-9 {
        f64::INFINITY
    } else {
        building.salt.max(0.0) / LIVESTOCK_FARMSTEAD_PRESERVATION_SALT_PER_OUTPUT
    }
}

fn store_salted_farmstead_output(
    building: &mut Building,
    output: CommodityKind,
    desired_output: f64,
) -> f64 {
    let stored = desired_output
        .max(0.0)
        .min(building_commodity_room(
            building,
            output,
        ))
        .min(farmstead_salted_output_capacity(building));
    if stored <= 1e-9 {
        return 0.0;
    }
    withdraw_building_commodity(
        building,
        CommodityKind::Salt,
        stored * LIVESTOCK_FARMSTEAD_PRESERVATION_SALT_PER_OUTPUT,
    );
    deposit_building_commodity(building, output, stored)
}

fn grazing_capacity(ctx: &ReducerContext, building: &Building, herd: &LivestockHerd) -> f64 {
    let pastures: Vec<Pasture> = ctx
        .db
        .pasture()
        .farmstead_id()
        .filter(&building.id)
        .collect();
    if pastures.is_empty() {
        return 0.0;
    }
    if herd.species == SPECIES_SWINE {
        let area_capacity =
            pastures.iter().map(|pasture| pasture.area).sum::<f64>() / SWINE_AREA_PER_HEAD.max(1.0);
        let mature_trees = ctx
            .db
            .tree_entity()
            .iter()
            .filter(|tree| {
                tree.phase == "mature"
                    && pastures.iter().any(|pasture| {
                        point_in_field(
                            Point2 {
                                x: tree.x,
                                z: tree.z,
                            },
                            &pasture_points(pasture),
                        )
                    })
            })
            .count() as f64;
        return area_capacity.min(mature_trees / SWINE_MATURE_TREES_PER_HEAD.max(0.1));
    }

    let (area_per_head, max_slope, moisture_ideal, moisture_tolerance) =
        if herd.species == SPECIES_SHEEP {
            (
                SHEEP_AREA_PER_HEAD,
                SHEEP_MAX_SLOPE_DEGREES,
                SHEEP_MOISTURE_IDEAL,
                SHEEP_MOISTURE_TOLERANCE,
            )
        } else {
            (
                CATTLE_AREA_PER_HEAD,
                CATTLE_MAX_SLOPE_DEGREES,
                CATTLE_MOISTURE_IDEAL,
                CATTLE_MOISTURE_TOLERANCE,
            )
        };
    pastures
        .iter()
        .map(|pasture| {
            let slope_quality =
                (1.0 - 0.35 * pasture.average_slope_degrees / max_slope.max(1.0)).clamp(0.5, 1.0);
            let moisture_quality = (1.0
                - 0.45 * (pasture.moisture - moisture_ideal).abs() / moisture_tolerance.max(0.01))
            .clamp(0.45, 1.0);
            pasture.area / area_per_head.max(1.0) * slope_quality * moisture_quality
        })
        .sum()
}

fn pasture_points(pasture: &Pasture) -> ZoneCorners {
    ZoneCorners {
        a: Point2 {
            x: pasture.corner_ax,
            z: pasture.corner_az,
        },
        b: Point2 {
            x: pasture.corner_bx,
            z: pasture.corner_bz,
        },
        c: Point2 {
            x: pasture.corner_cx,
            z: pasture.corner_cz,
        },
        d: Point2 {
            x: pasture.corner_dx,
            z: pasture.corner_dz,
        },
    }
}

pub fn cattle_field_support_sources(
    ctx: &ReducerContext,
    owner: Identity,
) -> HashMap<u64, Vec<u64>> {
    let owner_fields: Vec<FarmField> = ctx.db.farm_field().owner().filter(&owner).collect();
    let mut sources: HashMap<u64, Vec<u64>> = HashMap::new();

    for herd in ctx
        .db
        .livestock_herd()
        .owner()
        .filter(&owner)
        .filter(|herd| herd.species == SPECIES_CATTLE)
    {
        let Some(building) = ctx.db.building().id().find(&herd.building_id) else {
            continue;
        };
        let mut selected = Vec::with_capacity(CATTLE_MAX_PLOUGH_SUPPORTED_FIELDS);
        for candidate in &owner_fields {
            let center = centroid(&field_corners(candidate));
            if (building.x - center.x).hypot(building.z - center.z) > building.work_radius {
                continue;
            }
            retain_priority_candidate(
                &mut selected,
                candidate.priority,
                candidate.id,
                CATTLE_MAX_PLOUGH_SUPPORTED_FIELDS,
            );
        }
        for (_, field_id) in selected {
            sources.entry(field_id).or_default().push(herd.building_id);
        }
    }
    for field_sources in sources.values_mut() {
        field_sources.sort_unstable();
        field_sources.dedup();
    }
    sources
}

fn dispatch_manure_to_crop_farmstead(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    source: &mut Building,
) {
    if source.manure <= 1e-6 || building_has_active_trip(ctx, source.id) {
        return;
    }
    let Some(network) = tick.road_network(source.owner) else {
        return;
    };
    let mut best: Option<(Building, f64, u8, f64, f64)> = None;
    for target_id in tick.building_ids_for_kinds(ctx, source.owner, &["threshing_barn"]) {
        let Some(target) = ctx.db.building().id().find(&target_id) else {
            continue;
        };
        let (requirement, priority) =
            tick.farmstead_manure_requirement_for(ctx, source.owner, target.id);
        let desired = requirement.min(building_commodity_cap(&target.kind, CommodityKind::Manure));
        let needed = (desired - target.manure.max(0.0)).max(0.0);
        if !target.construction_complete
            || needed <= 1e-6
            || building_has_inbound_supply_trip(ctx, target.id)
        {
            continue;
        }
        let Some(distance) =
            local_delivery_distance(network, source.x, source.z, target.x, target.z)
        else {
            continue;
        };
        let coverage = if desired > 1e-9 {
            (target.manure.max(0.0) / desired).clamp(0.0, 1.0)
        } else {
            1.0
        };
        let replace = best.as_ref().is_none_or(
            |(incumbent, incumbent_coverage, incumbent_priority, incumbent_distance, _)| {
                coverage < *incumbent_coverage - 1e-9
                    || ((coverage - *incumbent_coverage).abs() <= 1e-9
                        && (priority > *incumbent_priority
                            || (priority == *incumbent_priority
                                && (distance < *incumbent_distance - 1e-9
                                    || ((distance - *incumbent_distance).abs() <= 1e-9
                                        && target.id < incumbent.id)))))
            },
        );
        if replace {
            best = Some((target, coverage, priority, distance, needed));
        }
    }
    let Some((target, _, _, _, needed)) = best else {
        return;
    };
    try_start_building_supply_trip(
        ctx,
        tick,
        clock,
        network,
        source,
        &target,
        1,
        CommodityKind::Manure,
        TIMBER_DELIVERY_SPEED_MPS,
        TIMBER_DELIVERY_UNLOAD_SEC,
        LIVESTOCK_MANURE_TRANSFER_PER_TRIP,
        needed,
    );
}

fn field_corners(field: &FarmField) -> ZoneCorners {
    ZoneCorners {
        a: Point2 {
            x: field.corner_ax,
            z: field.corner_az,
        },
        b: Point2 {
            x: field.corner_bx,
            z: field.corner_bz,
        },
        c: Point2 {
            x: field.corner_cx,
            z: field.corner_cz,
        },
        d: Point2 {
            x: field.corner_dx,
            z: field.corner_dz,
        },
    }
}

fn species_grain_per_unsupported_head(species: u8) -> f64 {
    match species {
        SPECIES_CATTLE => CATTLE_GRAIN_PER_UNSUPPORTED_HEAD,
        SPECIES_SHEEP => SHEEP_GRAIN_PER_UNSUPPORTED_HEAD,
        _ => SWINE_GRAIN_PER_UNSUPPORTED_HEAD,
    }
}

fn species_hay_per_unsupported_head(species: u8) -> f64 {
    match species {
        SPECIES_CATTLE => CATTLE_HAY_PER_UNSUPPORTED_HEAD,
        SPECIES_SHEEP => SHEEP_HAY_PER_UNSUPPORTED_HEAD,
        _ => 0.0,
    }
}

fn species_hay_yield_per_reserved_capacity(species: u8) -> f64 {
    match species {
        SPECIES_CATTLE => CATTLE_HAY_YIELD_PER_RESERVED_CAPACITY_PER_CYCLE,
        SPECIES_SHEEP => SHEEP_HAY_YIELD_PER_RESERVED_CAPACITY_PER_CYCLE,
        _ => 0.0,
    }
}

fn species_food_per_cycle(species: u8) -> f64 {
    match species {
        SPECIES_CATTLE => CATTLE_FOOD_PER_CYCLE_PER_HEAD,
        SPECIES_SHEEP => SHEEP_FOOD_PER_CYCLE_PER_HEAD,
        _ => SWINE_FOOD_PER_CYCLE_PER_HEAD,
    }
}

fn species_preserved_per_cycle(species: u8) -> f64 {
    match species {
        SPECIES_CATTLE => CATTLE_PRESERVED_FOOD_PER_CYCLE_PER_HEAD,
        SPECIES_SHEEP => SHEEP_PRESERVED_FOOD_PER_CYCLE_PER_HEAD,
        _ => 0.0,
    }
}

fn species_breeding_per_cycle(species: u8) -> f64 {
    match species {
        SPECIES_CATTLE => CATTLE_BREEDING_PER_CYCLE,
        SPECIES_SHEEP => SHEEP_BREEDING_PER_CYCLE,
        _ => SWINE_BREEDING_PER_CYCLE,
    }
}

fn species_slaughter_yields(species: u8) -> (f64, f64) {
    match species {
        SPECIES_CATTLE => (
            CATTLE_SLAUGHTER_FOOD_PER_HEAD,
            CATTLE_SLAUGHTER_PRESERVED_FOOD_PER_HEAD,
        ),
        SPECIES_SHEEP => (
            SHEEP_SLAUGHTER_FOOD_PER_HEAD,
            SHEEP_SLAUGHTER_PRESERVED_FOOD_PER_HEAD,
        ),
        _ => (
            SWINE_SLAUGHTER_FOOD_PER_HEAD,
            SWINE_SLAUGHTER_PRESERVED_FOOD_PER_HEAD,
        ),
    }
}

fn species_health_rates(species: u8) -> (f64, f64) {
    match species {
        SPECIES_CATTLE => (
            CATTLE_HEALTH_RECOVERY_PER_CYCLE,
            CATTLE_HEALTH_LOSS_PER_CYCLE,
        ),
        SPECIES_SHEEP => (SHEEP_HEALTH_RECOVERY_PER_CYCLE, SHEEP_HEALTH_LOSS_PER_CYCLE),
        _ => (SWINE_HEALTH_RECOVERY_PER_CYCLE, SWINE_HEALTH_LOSS_PER_CYCLE),
    }
}

fn species_max_herd(species: u8) -> u32 {
    match species {
        SPECIES_CATTLE => CATTLE_MAX_HERD,
        SPECIES_SHEEP => SHEEP_MAX_HERD,
        _ => SWINE_MAX_HERD,
    }
}
