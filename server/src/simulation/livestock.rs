use spacetimedb::ReducerContext;

use crate::balance_generated::{
    CATTLE_AREA_PER_HEAD, CATTLE_BREEDING_PER_CYCLE, CATTLE_FERTILITY_BONUS,
    CATTLE_FOOD_PER_CYCLE_PER_HEAD, CATTLE_GRAIN_PER_UNSUPPORTED_HEAD,
    CATTLE_HEALTH_LOSS_PER_CYCLE, CATTLE_HEALTH_RECOVERY_PER_CYCLE, CATTLE_MAX_FERTILIZED_FIELDS,
    CATTLE_MAX_HERD, CATTLE_MAX_SLOPE_DEGREES, CATTLE_MOISTURE_IDEAL, CATTLE_MOISTURE_TOLERANCE,
    CATTLE_PLOUGH_WORK_MULTIPLIER, CATTLE_PRESERVED_FOOD_PER_CYCLE_PER_HEAD, SHEEP_AREA_PER_HEAD,
    SHEEP_BREEDING_PER_CYCLE, SHEEP_FOOD_PER_CYCLE_PER_HEAD, SHEEP_GRAIN_PER_UNSUPPORTED_HEAD,
    SHEEP_HEALTH_LOSS_PER_CYCLE, SHEEP_HEALTH_RECOVERY_PER_CYCLE, SHEEP_MAX_HERD,
    SHEEP_MAX_SLOPE_DEGREES, SHEEP_MOISTURE_IDEAL, SHEEP_MOISTURE_TOLERANCE,
    SHEEP_PRESERVED_FOOD_PER_CYCLE_PER_HEAD, SHEEP_WOOL_GOLD_PER_CYCLE_PER_HEAD,
    SWINE_AREA_PER_HEAD, SWINE_BREEDING_PER_CYCLE, SWINE_FOOD_PER_CYCLE_PER_HEAD,
    SWINE_GRAIN_PER_UNSUPPORTED_HEAD, SWINE_HEALTH_LOSS_PER_CYCLE, SWINE_HEALTH_RECOVERY_PER_CYCLE,
    SWINE_MATURE_TREES_PER_HEAD, SWINE_MAX_HERD, TICK_DT,
};
use crate::building_defs::building_def;
use crate::burgage::{Point2, ZoneCorners};
use crate::db::*;
use crate::economy::{
    building_commodity_room, credit_treasury_gold, deposit_building_commodity,
    withdraw_building_commodity, CommodityKind,
};
use crate::farming::{centroid, point_in_field};
use crate::reducers::livestock::{SPECIES_CATTLE, SPECIES_SHEEP, SPECIES_SWINE};
use crate::season_policy::{EnvironmentState, Season};
use crate::simulation::expanded_economy::{
    dispatch_need, dispatch_to_building, request_connected_commodity,
};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::residence_needs::ResidenceNeedKind;
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
    herd.pasture_capacity =
        grazing_capacity(ctx, &building, &herd) * environment.pasture_capacity_multiplier();
    herd.supplied_capacity = herd.pasture_capacity.min(herd.head_count as f64);

    let paused = labor_and_logistics_paused(ctx, building.owner, clock);
    building.action_cooldown = (building.action_cooldown - TICK_DT).max(0.0);
    if !paused && building.assigned_labor > 0 {
        let unsupported = (herd.head_count as f64 - herd.pasture_capacity).max(0.0);
        if unsupported > 0.05 {
            let grain_per_head = species_grain_per_unsupported_head(herd.species);
            request_connected_commodity(
                ctx,
                tick,
                clock,
                &building,
                CommodityKind::Grain,
                &["threshing_barn", "granary"],
                unsupported * grain_per_head * 2.0,
            );
        }

        if building.action_cooldown <= 1e-6 {
            run_livestock_cycle(ctx, clock, environment, &mut building, &mut herd);
            let labor = building.assigned_labor.max(1) as f64;
            building.action_cooldown = building_def(&building.kind)
                .map(|def| def.action_interval / labor)
                .unwrap_or(10.0);
        }

        if herd.species == SPECIES_SWINE {
            dispatch_to_building(
                ctx,
                tick,
                clock,
                &mut building,
                CommodityKind::Food,
                &["smokehouse"],
            );
        }
        dispatch_need(
            ctx,
            tick,
            clock,
            &mut building,
            ResidenceNeedKind::Food,
            if herd.species == SPECIES_SWINE {
                3.0
            } else {
                2.0
            },
        );
        if herd.species != SPECIES_SWINE {
            dispatch_need(
                ctx,
                tick,
                clock,
                &mut building,
                ResidenceNeedKind::PreservedFood,
                2.0,
            );
        }
    }

    ctx.db.livestock_herd().building_id().update(herd);
    ctx.db.building().id().update(building);
}

fn run_livestock_cycle(
    ctx: &ReducerContext,
    clock: &GameClock,
    environment: EnvironmentState,
    building: &mut Building,
    herd: &mut LivestockHerd,
) {
    let heads = herd.head_count as f64;
    if heads <= 0.0 {
        return;
    }

    let unsupported = (heads - herd.pasture_capacity).max(0.0);
    let grain_per_head = species_grain_per_unsupported_head(herd.species);
    let supplement = if grain_per_head > 0.0 {
        (building.grain / grain_per_head).min(unsupported)
    } else {
        0.0
    };
    if supplement > 0.0 {
        withdraw_building_commodity(building, CommodityKind::Grain, supplement * grain_per_head);
    }
    herd.supplied_capacity = (herd.pasture_capacity + supplement).min(heads);
    let support_ratio = (herd.supplied_capacity / heads).clamp(0.0, 1.0);
    let (health_recovery, health_loss) = species_health_rates(herd.species);
    herd.health = (herd.health + health_recovery * support_ratio
        - health_loss * (1.0 - support_ratio))
        .clamp(0.12, 1.0);

    let productive_heads = heads * support_ratio * herd.health;
    let season_multiplier = if herd.species == SPECIES_SWINE {
        if matches!(clock.month, 10..=12) {
            1.35
        } else {
            0.45
        }
    } else {
        1.0
    };
    let food = productive_heads * species_food_per_cycle(herd.species) * season_multiplier;
    let preserved = productive_heads * species_preserved_per_cycle(herd.species);
    herd.last_food_output = food.min(building_commodity_room(building, CommodityKind::Food));
    herd.last_preserved_output = preserved.min(building_commodity_room(
        building,
        CommodityKind::PreservedFood,
    ));
    deposit_building_commodity(building, CommodityKind::Food, food);
    deposit_building_commodity(building, CommodityKind::PreservedFood, preserved);

    herd.last_wool_gold = if herd.species == SPECIES_SHEEP && environment.season != Season::Winter {
        productive_heads * SHEEP_WOOL_GOLD_PER_CYCLE_PER_HEAD
    } else {
        0.0
    };
    if herd.last_wool_gold > 0.0 {
        credit_treasury_gold(ctx, building.owner, herd.last_wool_gold);
    }

    if support_ratio >= 0.9 && herd.health >= 0.72 {
        herd.breeding_progress += productive_heads
            * species_breeding_per_cycle(herd.species)
            * environment.breeding_multiplier();
        let max_herd = species_max_herd(herd.species);
        while herd.breeding_progress >= 1.0 && herd.head_count < max_herd {
            herd.head_count += 1;
            herd.breeding_progress -= 1.0;
        }
    } else if support_ratio < 0.45 {
        herd.breeding_progress = (herd.breeding_progress - 0.08).max(0.0);
        if herd.health <= 0.2 && herd.head_count > 1 {
            herd.head_count -= 1;
            herd.health = 0.36;
        }
    }
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

pub fn cattle_support_for_field(ctx: &ReducerContext, field: &FarmField) -> (f64, f64) {
    let corners = ZoneCorners {
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
    };
    let field_center = centroid(&corners);
    for herd in ctx
        .db
        .livestock_herd()
        .owner()
        .filter(&field.owner)
        .filter(|herd| {
            herd.species == SPECIES_CATTLE
                && herd.head_count >= 2
                && herd.health >= 0.65
                && herd.supplied_capacity >= 2.0
        })
    {
        let Some(building) = ctx.db.building().id().find(&herd.building_id) else {
            continue;
        };
        if (building.x - field_center.x).hypot(building.z - field_center.z) > building.work_radius {
            continue;
        }
        let mut supported: Vec<FarmField> = ctx
            .db
            .farm_field()
            .owner()
            .filter(&field.owner)
            .filter(|candidate| {
                let center = centroid(&ZoneCorners {
                    a: Point2 {
                        x: candidate.corner_ax,
                        z: candidate.corner_az,
                    },
                    b: Point2 {
                        x: candidate.corner_bx,
                        z: candidate.corner_bz,
                    },
                    c: Point2 {
                        x: candidate.corner_cx,
                        z: candidate.corner_cz,
                    },
                    d: Point2 {
                        x: candidate.corner_dx,
                        z: candidate.corner_dz,
                    },
                });
                (building.x - center.x).hypot(building.z - center.z) <= building.work_radius
            })
            .collect();
        supported.sort_by(|a, b| b.priority.cmp(&a.priority).then_with(|| a.id.cmp(&b.id)));
        if supported
            .iter()
            .take(CATTLE_MAX_FERTILIZED_FIELDS)
            .any(|candidate| candidate.id == field.id)
        {
            return (CATTLE_PLOUGH_WORK_MULTIPLIER, CATTLE_FERTILITY_BONUS);
        }
    }
    (1.0, 0.0)
}

fn species_grain_per_unsupported_head(species: u8) -> f64 {
    match species {
        SPECIES_CATTLE => CATTLE_GRAIN_PER_UNSUPPORTED_HEAD,
        SPECIES_SHEEP => SHEEP_GRAIN_PER_UNSUPPORTED_HEAD,
        _ => SWINE_GRAIN_PER_UNSUPPORTED_HEAD,
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
