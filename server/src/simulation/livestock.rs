use std::collections::HashMap;

use spacetimedb::{Identity, ReducerContext};

use crate::balance_generated::{
    CATTLE_AREA_PER_HEAD, CATTLE_BREEDING_PER_CYCLE, CATTLE_DAIRY_PRODUCTIVE_SHARE,
    CATTLE_FOOD_PER_CYCLE_PER_HEAD, CATTLE_GRAIN_PER_UNSUPPORTED_HEAD,
    CATTLE_HAY_PER_UNSUPPORTED_HEAD, CATTLE_HAY_YIELD_PER_RESERVED_CAPACITY_PER_CYCLE,
    CATTLE_HEADS_PER_WORKER, CATTLE_HEALTH_LOSS_PER_CYCLE, CATTLE_HEALTH_RECOVERY_PER_CYCLE,
    CATTLE_MAX_HERD, CATTLE_MAX_PLOUGH_SUPPORTED_FIELDS, CATTLE_MAX_SLOPE_DEGREES,
    CATTLE_MOISTURE_IDEAL, CATTLE_MOISTURE_TOLERANCE, CATTLE_PRESERVED_FOOD_PER_CYCLE_PER_HEAD,
    CATTLE_SLAUGHTER_FOOD_PER_HEAD, CATTLE_SLAUGHTER_PRESERVED_FOOD_PER_HEAD,
    CATTLE_WATER_PER_HEAD_PER_CYCLE, LIVESTOCK_ANIMAL_FEED_FODDER_VALUE,
    LIVESTOCK_ANIMAL_FEED_PER_CYCLE, LIVESTOCK_FARMSTEAD_PRESERVATION_SALT_PER_OUTPUT,
    LIVESTOCK_FEED_OAT_GRAIN_PER_CYCLE, LIVESTOCK_HAY_STORAGE_CAPACITY,
    LIVESTOCK_MANURE_TRANSFER_PER_TRIP, LIVESTOCK_MINIMUM_BREEDING_HEADS,
    PANNAGE_WINTER_CAPACITY_MULTIPLIER, SHEEP_AREA_PER_HEAD, SHEEP_BREEDING_PER_CYCLE,
    SHEEP_DAIRY_PRODUCTIVE_SHARE, SHEEP_FOOD_PER_CYCLE_PER_HEAD, SHEEP_GRAIN_PER_UNSUPPORTED_HEAD,
    SHEEP_HAY_PER_UNSUPPORTED_HEAD, SHEEP_HAY_YIELD_PER_RESERVED_CAPACITY_PER_CYCLE,
    SHEEP_HEADS_PER_WORKER, SHEEP_HEALTH_LOSS_PER_CYCLE, SHEEP_HEALTH_RECOVERY_PER_CYCLE,
    SHEEP_MAX_HERD, SHEEP_MAX_SLOPE_DEGREES, SHEEP_MOISTURE_IDEAL, SHEEP_MOISTURE_TOLERANCE,
    SHEEP_PRESERVED_FOOD_PER_CYCLE_PER_HEAD, SHEEP_SLAUGHTER_FOOD_PER_HEAD,
    SHEEP_SLAUGHTER_PRESERVED_FOOD_PER_HEAD, SHEEP_WATER_PER_HEAD_PER_CYCLE, SWINE_AREA_PER_HEAD,
    SWINE_BREEDING_PER_CYCLE, SWINE_DAIRY_PRODUCTIVE_SHARE, SWINE_FOOD_PER_CYCLE_PER_HEAD,
    SWINE_GRAIN_PER_UNSUPPORTED_HEAD, SWINE_HEADS_PER_WORKER, SWINE_HEALTH_LOSS_PER_CYCLE,
    SWINE_HEALTH_RECOVERY_PER_CYCLE, SWINE_MATURE_TREES_PER_HEAD, SWINE_MAX_HERD,
    SWINE_SLAUGHTER_FOOD_PER_HEAD, SWINE_SLAUGHTER_PRESERVED_FOOD_PER_HEAD,
    SWINE_WATER_PER_HEAD_PER_CYCLE, TICK_DT, TIMBER_DELIVERY_SPEED_MPS, TIMBER_DELIVERY_UNLOAD_SEC,
    WINTER_PASTURE_CAPACITY_MULTIPLIER,
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
    can_cull_one, cattle_manure_output, essential_livestock_care_labor, haymaking_share,
    is_haymaking_month, is_shearing_month, livestock_cycles_per_calendar_day,
    livestock_milk_allocation, projected_winter_animal_feed, retain_priority_candidate,
    sheep_fleece_output, storage_secured_pending_cull_heads,
};
use crate::ox_policy::ox_amplified_worker_count;
use crate::reducers::livestock::{
    management_headroom, management_units_per_head, SPECIES_CATTLE, SPECIES_SHEEP, SPECIES_SWINE,
};
use crate::resident_welfare_policy::deterministic_unit;
use crate::resource_units::{whole_cost, whole_units};
use crate::season_policy::{EnvironmentState, Season};
use crate::simulation::delivery_trips::{
    building_has_active_trip, building_has_inbound_supply_trip, onsite_building_labor,
    try_start_building_supply_trip,
};
use crate::simulation::expanded_economy::{dispatch_to_building, request_connected_commodity};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::road_logistics::local_delivery_distance;
use crate::simulation::tick_context::SimTickContext;
use crate::tables::{farm_field, Building, FarmField, Pasture, PastureHerd};

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
    let mut parcels = ctx
        .db
        .pasture_herd()
        .farmstead_id()
        .filter(&building.id)
        .filter_map(|herd| {
            ctx.db
                .pasture()
                .id()
                .find(&herd.pasture_id)
                .map(|pasture| HerdParcel {
                    pasture,
                    herd,
                    base_capacity: 0.0,
                })
        })
        .collect::<Vec<_>>();
    parcels.sort_unstable_by_key(|parcel| parcel.pasture.id);
    if parcels.is_empty() {
        ctx.db.building().id().update(building);
        return;
    }

    // Migrate any legacy fractional livestock stores as soon as the holding is
    // stepped, including paused or storage-blocked holdings.
    normalize_livestock_building_stocks(&mut building);
    for parcel in &mut parcels {
        if swine_building && parcel.herd.species != SPECIES_SWINE {
            parcel.herd.species = SPECIES_SWINE;
        }
        normalize_livestock_herd_stocks(&mut parcel.herd);
        parcel.base_capacity = tick.livestock_grazing_capacity(ctx, &parcel.pasture, &parcel.herd);
        let summer_hay_share = if parcel.herd.species != SPECIES_SWINE
            && is_haymaking_month(clock.month)
            && parcel.herd.hay_stock + 1e-6 < LIVESTOCK_HAY_STORAGE_CAPACITY
        {
            haymaking_share(parcel.herd.haymaking_percent)
        } else {
            0.0
        };
        let seasonal_capacity_multiplier = if parcel.herd.species == SPECIES_SWINE {
            environment.pannage_capacity_multiplier()
        } else {
            environment.pasture_capacity_multiplier()
        };
        parcel.herd.pasture_capacity =
            parcel.base_capacity * seasonal_capacity_multiplier * (1.0 - summer_hay_share);
        // Supplemental feed and trough water are resolved on the fixed
        // husbandry cycle. Do not erase that support between cycles.
        parcel.herd.supplied_capacity = parcel
            .herd
            .supplied_capacity
            .max(
                parcel
                    .herd
                    .pasture_capacity
                    .min(f64::from(parcel.herd.head_count)),
            )
            .min(f64::from(parcel.herd.head_count));
    }

    let paused = labor_and_logistics_paused(ctx, tick, building.owner, clock);
    let onsite_labor = onsite_building_labor(ctx, &building);
    let care_labor = essential_livestock_care_labor(
        onsite_labor,
        tick.owner_has_active_raider_threat(ctx, building.owner),
    );
    if !paused && onsite_labor > 0 {
        let winter_feed_target = if matches!(environment.season, Season::Autumn | Season::Winter) {
            let cycles_per_day = building_def(&building.kind)
                .map(|def| livestock_cycles_per_calendar_day(def.action_interval))
                .unwrap_or(0.0);
            let mut cull_food_room = building_commodity_room(&building, CommodityKind::Meat);
            let mut cull_preserved_room =
                building_commodity_room(&building, CommodityKind::CuredMeat);
            let mut cull_salted_output_capacity = farmstead_salted_output_capacity(&building);
            parcels
                .iter()
                .map(|parcel| {
                    let projected_head_count = if environment.season == Season::Autumn {
                        let (slaughter_food, slaughter_preserved) =
                            species_slaughter_yields(parcel.herd.species);
                        let secured_culls = storage_secured_pending_cull_heads(
                            parcel.herd.head_count,
                            parcel.herd.breeding_reserve,
                            species_max_herd(parcel.herd.species),
                            cull_food_room,
                            cull_preserved_room,
                            cull_salted_output_capacity,
                            slaughter_food,
                            slaughter_preserved,
                        );

                        // Every parcel at this holding shares the same stores.
                        // Debit the capacity secured for earlier parcels before
                        // projecting later ones so it cannot be counted twice.
                        let secured_cull_count = f64::from(secured_culls);
                        let preserved_used = (secured_cull_count * slaughter_preserved)
                            .min(cull_preserved_room)
                            .min(cull_salted_output_capacity);
                        let food_used = secured_cull_count * (slaughter_food + slaughter_preserved)
                            - preserved_used;
                        cull_food_room = (cull_food_room - food_used).max(0.0);
                        cull_preserved_room = (cull_preserved_room - preserved_used).max(0.0);
                        cull_salted_output_capacity =
                            (cull_salted_output_capacity - preserved_used).max(0.0);

                        parcel.herd.head_count.saturating_sub(secured_culls)
                    } else {
                        parcel.herd.head_count
                    };
                    projected_winter_animal_feed(
                        projected_head_count,
                        parcel.base_capacity,
                        parcel.herd.hay_stock,
                        species_hay_per_unsupported_head(parcel.herd.species),
                        species_grain_per_unsupported_head(parcel.herd.species),
                        cycles_per_day,
                        if parcel.herd.species == SPECIES_SWINE {
                            PANNAGE_WINTER_CAPACITY_MULTIPLIER
                        } else {
                            WINTER_PASTURE_CAPACITY_MULTIPLIER
                        },
                    )
                })
                .sum::<f64>()
                .min(building_commodity_cap(
                    &building.kind,
                    CommodityKind::AnimalFeed,
                ))
        } else {
            0.0
        };
        let desired_feed = whole_cost(winter_feed_target);
        if swine_building && desired_feed >= 1.0 {
            request_connected_commodity(
                ctx,
                tick,
                clock,
                &building,
                CommodityKind::AnimalFeed,
                &["pastoral_farmstead"],
                desired_feed,
            );
        } else if !swine_building && desired_feed >= 1.0 {
            let feed_shortfall = (desired_feed - whole_units(building.animal_feed)).max(0.0);
            let desired_oats = if LIVESTOCK_ANIMAL_FEED_PER_CYCLE > 1e-9 {
                whole_cost(
                    feed_shortfall * LIVESTOCK_FEED_OAT_GRAIN_PER_CYCLE
                        / LIVESTOCK_ANIMAL_FEED_PER_CYCLE,
                )
            } else {
                0.0
            };
            if desired_oats >= 1.0 {
                request_connected_commodity(
                    ctx,
                    tick,
                    clock,
                    &building,
                    CommodityKind::OatGrain,
                    &["threshing_barn", "granary"],
                    desired_oats,
                );
            }
        }
    }

    // Animal time is not worker throughput. A fixed daytime husbandry clock
    // advances even when the holding is unstaffed or work is interrupted;
    // labor instead determines how many heads receive active care and how much
    // hay can be cut. This prevents both immortal abandoned herds and workers
    // accelerating gestation, thirst, or milk production.
    if clock.is_work_hours {
        building.action_cooldown = (building.action_cooldown - TICK_DT).max(0.0);
        if building.action_cooldown <= 1e-6 {
            let (cycle_care_labor, cycle_productive_labor) = if paused {
                (care_labor, 0)
            } else {
                let paired_oxen = crate::simulation::paired_production_ox_count(
                    ctx,
                    tick,
                    &building,
                    onsite_labor,
                );
                let amplified_labor = ox_amplified_worker_count(onsite_labor, paired_oxen);
                (
                    essential_livestock_care_labor(amplified_labor, false),
                    amplified_labor,
                )
            };
            let mut next_building = building.clone();
            let mut next_parcels = parcels.clone();
            prepare_animal_feed(&mut next_building, cycle_productive_labor);
            let cycle_inputs = allocate_holding_cycle_inputs(
                &mut next_building,
                &next_parcels,
                environment,
                cycle_care_labor,
            );
            let mut management_used = next_parcels
                .iter()
                .map(|parcel| {
                    parcel
                        .herd
                        .head_count
                        .saturating_mul(management_units_per_head(parcel.herd.species))
                })
                .sum::<u32>();
            let mut cull_available = cycle_productive_labor > 0;
            let mut committed = true;
            for (parcel, inputs) in next_parcels.iter_mut().zip(cycle_inputs) {
                let units_per_head = management_units_per_head(parcel.herd.species);
                let before_heads = parcel.herd.head_count;
                let management_room_heads =
                    management_headroom(&next_building.kind, management_used, parcel.herd.species);
                let local_limit = species_max_herd(parcel.herd.species)
                    .min(parcel.base_capacity.floor().clamp(0.0, u32::MAX as f64) as u32);
                let breeding_limit =
                    local_limit.min(before_heads.saturating_add(management_room_heads));
                committed &= run_livestock_cycle(
                    clock,
                    environment,
                    parcel.pasture.id,
                    parcel.base_capacity,
                    inputs,
                    cycle_productive_labor,
                    breeding_limit,
                    cull_available,
                    &mut next_building,
                    &mut parcel.herd,
                );
                management_used = management_used
                    .saturating_sub(before_heads.saturating_mul(units_per_head))
                    .saturating_add(parcel.herd.head_count.saturating_mul(units_per_head));
                if parcel.herd.last_culled > 0 {
                    cull_available = false;
                }
            }
            if committed {
                building = next_building;
                parcels = next_parcels;
                building.action_cooldown = building_def(&building.kind)
                    .map(|def| def.action_interval)
                    .unwrap_or(10.0);
            } else {
                // Keep the complete husbandry transaction due. Inputs and
                // outputs were evaluated on clones, so a blocked barn cannot
                // consume feed or mint a partial production lot.
                building.action_cooldown = 0.0;
            }
        }
    }

    if !paused && onsite_labor > 0 {
        if !swine_building {
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
            dispatch_manure_to_crop_farmstead(ctx, tick, clock, &mut building);
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

    for parcel in parcels {
        ctx.db.pasture_herd().pasture_id().update(parcel.herd);
    }
    ctx.db.building().id().update(building);
}

#[derive(Clone)]
struct HerdParcel {
    pasture: Pasture,
    herd: PastureHerd,
    base_capacity: f64,
}

#[derive(Clone, Copy, Default)]
struct HerdCycleInputs {
    hay_units: f64,
    animal_feed_units: f64,
    water_units: f64,
    care_ratio: f64,
}

fn allocate_holding_cycle_inputs(
    building: &mut Building,
    parcels: &[HerdParcel],
    environment: EnvironmentState,
    care_labor: u32,
) -> Vec<HerdCycleInputs> {
    let mut inputs = vec![HerdCycleInputs::default(); parcels.len()];
    let mut feed_demands = Vec::with_capacity(parcels.len());
    let mut water_demands = Vec::with_capacity(parcels.len());
    let mut total_care_effort = 0.0;

    for (index, parcel) in parcels.iter().enumerate() {
        let heads = f64::from(parcel.herd.head_count);
        let unsupported = (heads - parcel.herd.pasture_capacity).max(0.0);
        let hay_per_head = species_hay_per_unsupported_head(parcel.herd.species);
        let hay_units = if environment.season == Season::Winter && hay_per_head > 1e-9 {
            whole_cost(unsupported * hay_per_head).min(whole_units(parcel.herd.hay_stock))
        } else {
            0.0
        };
        inputs[index].hay_units = hay_units;
        let hay_supported_heads = if hay_per_head > 1e-9 {
            (hay_units / hay_per_head).min(unsupported)
        } else {
            0.0
        };
        let feed_unsupported = (unsupported - hay_supported_heads).max(0.0);
        let feed_per_head = species_grain_per_unsupported_head(parcel.herd.species);
        let feed_units = if environment.season == Season::Winter && feed_per_head > 1e-9 {
            whole_cost(
                feed_unsupported * feed_per_head / LIVESTOCK_ANIMAL_FEED_FODDER_VALUE.max(1e-9),
            )
        } else {
            0.0
        };
        feed_demands.push(feed_units);

        let water_per_head = species_water_per_head_per_cycle(parcel.herd.species);
        water_demands.push(if water_per_head > 1e-9 {
            whole_cost(heads * water_per_head)
        } else {
            0.0
        });
        if heads > 0.0 {
            total_care_effort += heads / species_heads_per_worker(parcel.herd.species).max(1e-9);
        }
    }

    let feed_allocations = fair_whole_allocations(whole_units(building.animal_feed), &feed_demands);
    let water_allocations = fair_whole_allocations(whole_units(building.water), &water_demands);
    let feed_used: f64 = feed_allocations.iter().sum();
    let water_used: f64 = water_allocations.iter().sum();
    if feed_used >= 1.0 {
        withdraw_building_commodity(building, CommodityKind::AnimalFeed, feed_used);
    }
    if water_used >= 1.0 {
        withdraw_building_commodity(building, CommodityKind::Water, water_used);
    }
    let care_ratio = if total_care_effort <= 1e-9 {
        1.0
    } else {
        (f64::from(care_labor) / total_care_effort).clamp(0.0, 1.0)
    };
    for (index, input) in inputs.iter_mut().enumerate() {
        input.animal_feed_units = feed_allocations[index];
        input.water_units = water_allocations[index];
        input.care_ratio = care_ratio;
    }
    inputs
}

/// Distributes indivisible shared stock proportionally to demand. The caller
/// supplies parcels in stable pasture-id order, which is also the deterministic
/// tie-breaker for the final largest-remainder units.
fn fair_whole_allocations(available: f64, demands: &[f64]) -> Vec<f64> {
    let demands = demands
        .iter()
        .map(|demand| whole_units(*demand).max(0.0))
        .collect::<Vec<_>>();
    let total_demand: f64 = demands.iter().sum();
    let grant = whole_units(available).min(total_demand);
    if grant < 1.0 || total_demand < 1.0 {
        return vec![0.0; demands.len()];
    }
    let exact = demands
        .iter()
        .map(|demand| grant * *demand / total_demand)
        .collect::<Vec<_>>();
    let mut allocations = exact
        .iter()
        .zip(&demands)
        .map(|(share, demand)| share.floor().min(*demand))
        .collect::<Vec<_>>();
    let mut remainder = (grant - allocations.iter().sum::<f64>()).round() as u32;
    let mut order = (0..demands.len()).collect::<Vec<_>>();
    order.sort_unstable_by(|left, right| {
        let left_fraction = exact[*left] - exact[*left].floor();
        let right_fraction = exact[*right] - exact[*right].floor();
        right_fraction
            .total_cmp(&left_fraction)
            .then_with(|| left.cmp(right))
    });
    for index in order {
        if remainder == 0 {
            break;
        }
        if allocations[index] + 1.0 <= demands[index] + 1e-9 {
            allocations[index] += 1.0;
            remainder -= 1;
        }
    }
    allocations
}

fn run_livestock_cycle(
    clock: &GameClock,
    environment: EnvironmentState,
    pasture_id: u64,
    base_pasture_capacity: f64,
    inputs: HerdCycleInputs,
    productive_labor: u32,
    breeding_limit: u32,
    allow_cull: bool,
    building: &mut Building,
    herd: &mut PastureHerd,
) -> bool {
    normalize_livestock_building_stocks(building);
    normalize_livestock_herd_stocks(herd);
    herd.last_culled = 0;
    herd.last_hay_output = 0.0;
    herd.last_wool_output = 0.0;
    let heads = herd.head_count as f64;
    if heads <= 0.0 {
        herd.supplied_capacity = 0.0;
        herd.last_food_output = 0.0;
        herd.last_preserved_output = 0.0;
        herd.last_wool_gold = 0.0;
        return true;
    }

    if herd.species != SPECIES_SWINE && productive_labor > 0 && is_haymaking_month(clock.month) {
        let reserved_capacity =
            base_pasture_capacity.max(0.0) * haymaking_share(herd.haymaking_percent);
        let expected_hay = reserved_capacity
            * species_hay_yield_per_reserved_capacity(herd.species)
            * environment.pasture_capacity_multiplier()
            * f64::from(productive_labor);
        let hay = discrete_expected_units(expected_hay, pasture_id, clock.total_days, 0x4841_59);
        let hay_room = (whole_units(LIVESTOCK_HAY_STORAGE_CAPACITY) - herd.hay_stock).max(0.0);
        let hay = storable_whole_output(hay, hay_room);
        herd.hay_stock += hay;
        herd.last_hay_output = hay;
    }

    let unsupported = (heads - herd.pasture_capacity).max(0.0);
    let hay_per_head = species_hay_per_unsupported_head(herd.species);
    let hay_units_used = inputs.hay_units.min(whole_units(herd.hay_stock));
    let hay_supplement = if hay_per_head > 1e-9 {
        (hay_units_used / hay_per_head).min(unsupported)
    } else {
        0.0
    };
    if hay_units_used >= 1.0 {
        herd.hay_stock -= hay_units_used;
    }
    let feed_unsupported = (unsupported - hay_supplement).max(0.0);
    let feed_per_head = species_grain_per_unsupported_head(herd.species);
    let feed_value_used = inputs.animal_feed_units * LIVESTOCK_ANIMAL_FEED_FODDER_VALUE;
    let feed_supplement = if feed_per_head > 1e-9 {
        (feed_value_used / feed_per_head).min(feed_unsupported)
    } else {
        0.0
    };
    let feed_supported_heads =
        (herd.pasture_capacity + hay_supplement + feed_supplement).min(heads);
    let water_per_head = species_water_per_head_per_cycle(herd.species);
    let water_supported_heads = if water_per_head <= 1e-9 {
        heads
    } else {
        (inputs.water_units / water_per_head).min(heads)
    };
    let care_supported_heads = heads * inputs.care_ratio.clamp(0.0, 1.0);
    herd.supplied_capacity = feed_supported_heads
        .min(water_supported_heads)
        .min(care_supported_heads);
    let support_ratio = (herd.supplied_capacity / heads).clamp(0.0, 1.0);
    let (health_recovery, health_loss) = species_health_rates(herd.species);
    herd.health = (herd.health + health_recovery * support_ratio
        - health_loss * (1.0 - support_ratio))
        .clamp(0.12, 1.0);

    let productive_heads = heads * support_ratio * herd.health;
    // Cattle and sheep provide a shared gross milk yield. Only the aggregate
    // mature, lactating share produces it; young stock, males, and dry animals
    // still consume land, water, fodder, and care. The holding's milk
    // policy chooses how much becomes fresh milk or salted cheese; cheese is a
    // conversion, not a parallel free output. Pigs provide
    // meat only when actual surplus animals are culled below.
    let dairy_heads = productive_heads * species_dairy_productive_share(herd.species);
    let base_milk = dairy_heads * species_food_per_cycle(herd.species);
    let base_cheese = dairy_heads * species_preserved_per_cycle(herd.species);
    let cheese_capacity = whole_units(
        building_commodity_room(building, CommodityKind::Cheese)
            .min(farmstead_salted_output_capacity(building)),
    );
    let (_, expected_cheese) = livestock_milk_allocation(
        building.processor_output_target_percent,
        base_milk,
        base_cheese,
        cheese_capacity,
    );
    let expected_gross_milk = base_milk.max(0.0) + base_cheese.max(0.0);
    let gross_milk = discrete_expected_units(
        expected_gross_milk,
        pasture_id,
        clock.total_days,
        0x4d49_4c4b,
    );
    let cheese_share = if expected_gross_milk > 1e-9 {
        (expected_cheese / expected_gross_milk).clamp(0.0, 1.0)
    } else {
        0.0
    };
    let cheese = discrete_expected_units(
        gross_milk * cheese_share,
        pasture_id,
        clock.total_days,
        0x4348_4545_5345,
    )
    .min(gross_milk)
    .min(cheese_capacity);
    let stored_cheese = if try_store_exact_salted_output(building, CommodityKind::Cheese, cheese) {
        cheese
    } else {
        0.0
    };
    // Cheese that cannot be made falls back to fresh milk. Any routine output
    // beyond the holding's remaining room is lost, but husbandry still
    // advances: full stores must never suspend feeding, health, or mortality.
    let fresh_milk = gross_milk - stored_cheese;
    let milk_to_store = storable_whole_output(
        fresh_milk,
        building_commodity_room(building, CommodityKind::Milk),
    );
    let stored_milk = deposit_building_commodity(building, CommodityKind::Milk, milk_to_store);
    herd.last_preserved_output = stored_cheese;
    herd.last_food_output = stored_milk;
    if herd.species == SPECIES_CATTLE {
        let manure = discrete_expected_units(
            cattle_manure_output(productive_heads, environment.season),
            pasture_id,
            clock.total_days,
            0x4d41_4e55_5245,
        );
        let manure_to_store = storable_whole_output(
            manure,
            building_commodity_room(building, CommodityKind::Manure),
        );
        deposit_building_commodity(building, CommodityKind::Manure, manure_to_store);
    }

    // A flock is shorn once in the early-summer window. The old implementation
    // minted gold every livestock cycle; keeping a physical annual fleece makes
    // storage, road hauling, workshop labor, and market capacity consequential.
    herd.last_wool_gold = 0.0;
    if herd.species == SPECIES_SHEEP
        && productive_labor > 0
        && herd.last_shearing_year != clock.year
        && is_shearing_month(clock.month)
    {
        let fleece = discrete_expected_units(
            sheep_fleece_output(productive_heads),
            pasture_id,
            u64::from(clock.year),
            0x574f_4f4c,
        );
        let wool_room = whole_units(building_commodity_room(building, CommodityKind::Wool));
        // A fleece is one deliberate annual lot. If the loft cannot hold the
        // complete clip, defer shearing without rolling back this cycle's
        // feeding, water, health, breeding, or mortality.
        if fleece >= 1.0 && wool_room + 1e-9 >= fleece {
            let stored = deposit_building_commodity(building, CommodityKind::Wool, fleece);
            if (stored - fleece).abs() <= 1e-9 {
                herd.last_wool_output = stored;
                herd.last_shearing_year = clock.year;
            }
        }
    }

    if environment.season == Season::Spring
        && herd.head_count >= LIVESTOCK_MINIMUM_BREEDING_HEADS
        && support_ratio >= 0.9
        && herd.health >= 0.72
    {
        if herd.head_count < breeding_limit {
            herd.breeding_progress += productive_heads
                * species_breeding_per_cycle(herd.species)
                * environment.breeding_multiplier();
            while herd.breeding_progress >= 1.0 && herd.head_count < breeding_limit {
                herd.head_count += 1;
                herd.breeding_progress -= 1.0;
            }
            if herd.head_count >= breeding_limit {
                herd.breeding_progress = herd.breeding_progress.min(0.999);
            }
        } else {
            // Do not bank years of unborn animals while a holding is full.
            herd.breeding_progress = herd.breeding_progress.min(0.999);
        }
    } else if support_ratio < 0.45 {
        herd.breeding_progress = (herd.breeding_progress - 0.08).max(0.0);
        if herd.health <= 0.2 && herd.head_count > 0 {
            herd.head_count -= 1;
            herd.supplied_capacity = herd.supplied_capacity.min(f64::from(herd.head_count));
            herd.health = if herd.head_count > 0 { 0.36 } else { 0.12 };
        }
    }

    let maximum_herd = species_max_herd(herd.species);
    let (expected_slaughter_food, expected_slaughter_preserved) =
        species_slaughter_yields(herd.species);
    let slaughter_food = discrete_expected_units(
        expected_slaughter_food,
        pasture_id,
        clock.total_days,
        0x534c_4155_4748_5446,
    );
    let slaughter_preserved = discrete_expected_units(
        expected_slaughter_preserved,
        pasture_id,
        clock.total_days,
        0x534c_4155_4748_5450,
    );
    let preserve_full_lot =
        can_store_exact_salted_output(building, CommodityKind::CuredMeat, slaughter_preserved);
    let cured_slaughter = if preserve_full_lot {
        slaughter_preserved
    } else {
        0.0
    };
    let fresh_slaughter = slaughter_food
        + if preserve_full_lot {
            0.0
        } else {
            slaughter_preserved
        };
    if allow_cull
        && productive_labor > 0
        && can_cull_one(
            clock.month,
            herd.head_count,
            herd.breeding_reserve,
            maximum_herd,
            building_commodity_room(building, CommodityKind::Meat),
            building_commodity_room(building, CommodityKind::CuredMeat),
            fresh_slaughter,
            cured_slaughter,
        )
    {
        // Unsalted meat enters the vulnerable fresh-food store instead of
        // becoming free cured provisions. No animal is discarded merely
        // because an imported salt cart has not reached the holding.
        let mut cull_building = building.clone();
        let stored_meat =
            deposit_building_commodity(&mut cull_building, CommodityKind::Meat, fresh_slaughter);
        if (stored_meat - fresh_slaughter).abs() <= 1e-9
            && try_store_exact_salted_output(
                &mut cull_building,
                CommodityKind::CuredMeat,
                cured_slaughter,
            )
        {
            *building = cull_building;
            herd.head_count -= 1;
            herd.last_culled = 1;
            herd.supplied_capacity = herd.supplied_capacity.min(herd.head_count as f64);
            herd.last_food_output += fresh_slaughter;
            herd.last_preserved_output += cured_slaughter;
        }
    }
    true
}

fn farmstead_salted_output_capacity(building: &Building) -> f64 {
    if LIVESTOCK_FARMSTEAD_PRESERVATION_SALT_PER_OUTPUT <= 1e-9 {
        f64::INFINITY
    } else {
        whole_units(building.salt) / LIVESTOCK_FARMSTEAD_PRESERVATION_SALT_PER_OUTPUT
    }
}

fn salted_output_salt_cost(output_units: f64) -> f64 {
    if output_units < 1.0 || LIVESTOCK_FARMSTEAD_PRESERVATION_SALT_PER_OUTPUT <= 1e-9 {
        0.0
    } else {
        whole_cost(output_units * LIVESTOCK_FARMSTEAD_PRESERVATION_SALT_PER_OUTPUT)
    }
}

fn can_store_exact_salted_output(
    building: &Building,
    output: CommodityKind,
    output_units: f64,
) -> bool {
    let output_units = whole_units(output_units);
    building_commodity_room(building, output) + 1e-9 >= output_units
        && whole_units(building.salt) + 1e-9 >= salted_output_salt_cost(output_units)
}

fn try_store_exact_salted_output(
    building: &mut Building,
    output: CommodityKind,
    output_units: f64,
) -> bool {
    let output_units = whole_units(output_units);
    if output_units < 1.0 {
        return true;
    }
    if !can_store_exact_salted_output(building, output, output_units) {
        return false;
    }
    let salt_cost = salted_output_salt_cost(output_units);
    let salt_used = withdraw_building_commodity(building, CommodityKind::Salt, salt_cost);
    if (salt_used - salt_cost).abs() > 1e-9 {
        return false;
    }
    let stored = deposit_building_commodity(building, output, output_units);
    (stored - output_units).abs() <= 1e-9
}

fn prepare_animal_feed(building: &mut Building, productive_labor: u32) {
    if building.kind != "pastoral_farmstead" || productive_labor == 0 {
        return;
    }
    let oat_cost = whole_cost(LIVESTOCK_FEED_OAT_GRAIN_PER_CYCLE);
    let feed_output = whole_units(LIVESTOCK_ANIMAL_FEED_PER_CYCLE);
    if oat_cost < 1.0
        || feed_output < 1.0
        || whole_units(building.oat_grain) + 1e-9 < oat_cost
        || whole_units(building_commodity_room(building, CommodityKind::AnimalFeed)) + 1e-9
            < feed_output
    {
        return;
    }
    let oats_used = withdraw_building_commodity(building, CommodityKind::OatGrain, oat_cost);
    if (oats_used - oat_cost).abs() <= 1e-9 {
        deposit_building_commodity(building, CommodityKind::AnimalFeed, feed_output);
    }
}

fn normalize_livestock_building_stocks(building: &mut Building) {
    building.water = whole_units(building.water);
    building.oat_grain = whole_units(building.oat_grain);
    building.animal_feed = whole_units(building.animal_feed);
    building.rye_grain = whole_units(building.rye_grain);
    building.maslin_grain = whole_units(building.maslin_grain);
    building.salt = whole_units(building.salt);
    building.milk = whole_units(building.milk);
    building.cheese = whole_units(building.cheese);
    building.manure = whole_units(building.manure);
    building.wool = whole_units(building.wool);
    building.meat = whole_units(building.meat);
    building.cured_meat = whole_units(building.cured_meat);
}

fn normalize_livestock_herd_stocks(herd: &mut PastureHerd) {
    herd.hay_stock = whole_units(herd.hay_stock);
    herd.last_food_output = whole_units(herd.last_food_output);
    herd.last_preserved_output = whole_units(herd.last_preserved_output);
    herd.last_hay_output = whole_units(herd.last_hay_output);
    herd.last_wool_output = whole_units(herd.last_wool_output);
    herd.last_wool_gold = whole_units(herd.last_wool_gold);
}

fn discrete_expected_units(expected: f64, entity_id: u64, day: u64, salt: u64) -> f64 {
    if !expected.is_finite() || expected <= 0.0 {
        return 0.0;
    }
    let base = expected.floor();
    let remainder = expected - base;
    base + if remainder > 1e-9
        && deterministic_unit(entity_id ^ 0x517c_c1b7, day, entity_id, salt) < remainder
    {
        1.0
    } else {
        0.0
    }
}

fn storable_whole_output(output_units: f64, available_room: f64) -> f64 {
    whole_units(output_units).min(whole_units(available_room))
}

pub(crate) fn grazing_capacity_for_pasture(
    ctx: &ReducerContext,
    pasture: &Pasture,
    herd: &PastureHerd,
) -> f64 {
    grazing_capacity_for_pasture_with_mature_tree_points(ctx, pasture, herd, None)
}

pub(crate) fn grazing_capacity_for_pasture_with_mature_tree_points(
    ctx: &ReducerContext,
    pasture: &Pasture,
    herd: &PastureHerd,
    mature_tree_points: Option<&[(f64, f64)]>,
) -> f64 {
    if herd.species == SPECIES_SWINE {
        let area_capacity = pasture.area / SWINE_AREA_PER_HEAD.max(1.0);
        let inside_pasture =
            |x: f64, z: f64| point_in_field(Point2 { x, z }, &pasture_points(pasture));
        let mature_trees = mature_tree_points.map_or_else(
            || {
                ctx.db
                    .tree_entity()
                    .iter()
                    .filter(|tree| tree.phase == "mature" && inside_pasture(tree.x, tree.z))
                    .count()
            },
            |points| {
                points
                    .iter()
                    .filter(|(x, z)| inside_pasture(*x, *z))
                    .count()
            },
        ) as f64;
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
    let slope_quality =
        (1.0 - 0.35 * pasture.average_slope_degrees / max_slope.max(1.0)).clamp(0.5, 1.0);
    let moisture_quality = (1.0
        - 0.45 * (pasture.moisture - moisture_ideal).abs() / moisture_tolerance.max(0.01))
    .clamp(0.45, 1.0);
    pasture.area / area_per_head.max(1.0) * slope_quality * moisture_quality
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

    let mut cattle_pastures_by_farmstead: HashMap<u64, Vec<u64>> = HashMap::new();
    for herd in ctx
        .db
        .pasture_herd()
        .owner()
        .filter(&owner)
        .filter(|herd| herd.species == SPECIES_CATTLE)
    {
        cattle_pastures_by_farmstead
            .entry(herd.farmstead_id)
            .or_default()
            .push(herd.pasture_id);
    }

    for (farmstead_id, mut pasture_ids) in cattle_pastures_by_farmstead {
        let Some(building) = ctx.db.building().id().find(&farmstead_id) else {
            continue;
        };
        pasture_ids.sort_unstable();
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
            sources
                .entry(field_id)
                .or_default()
                .extend(pasture_ids.iter().copied());
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
    source.manure = whole_units(source.manure);
    if source.manure < 1.0 || building_has_active_trip(ctx, source.id) {
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
        let desired = whole_units(requirement).min(whole_units(building_commodity_cap(
            &target.kind,
            CommodityKind::Manure,
        )));
        let needed = (desired - whole_units(target.manure)).max(0.0);
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
            (whole_units(target.manure) / desired).clamp(0.0, 1.0)
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

fn species_dairy_productive_share(species: u8) -> f64 {
    match species {
        SPECIES_CATTLE => CATTLE_DAIRY_PRODUCTIVE_SHARE,
        SPECIES_SHEEP => SHEEP_DAIRY_PRODUCTIVE_SHARE,
        _ => SWINE_DAIRY_PRODUCTIVE_SHARE,
    }
    .clamp(0.0, 1.0)
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

fn species_heads_per_worker(species: u8) -> f64 {
    match species {
        SPECIES_CATTLE => CATTLE_HEADS_PER_WORKER,
        SPECIES_SHEEP => SHEEP_HEADS_PER_WORKER,
        _ => SWINE_HEADS_PER_WORKER,
    }
}

fn species_water_per_head_per_cycle(species: u8) -> f64 {
    match species {
        SPECIES_CATTLE => CATTLE_WATER_PER_HEAD_PER_CYCLE,
        SPECIES_SHEEP => SHEEP_WATER_PER_HEAD_PER_CYCLE,
        _ => SWINE_WATER_PER_HEAD_PER_CYCLE,
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

#[cfg(test)]
mod tests {
    use super::{
        discrete_expected_units, fair_whole_allocations, salted_output_salt_cost,
        storable_whole_output,
    };

    #[test]
    fn livestock_expected_yields_commit_only_whole_units() {
        for expected in [0.0, 0.02, 0.99, 1.25, 8.75, 12.0] {
            let output = discrete_expected_units(expected, 77, 300, 5);
            assert_eq!(output.fract(), 0.0);
            assert!(output == expected.floor() || output == expected.ceil());
        }
    }

    #[test]
    fn salted_lots_pay_whole_salt_units() {
        for output in [0.0, 1.0, 7.0, 8.0, 9.0] {
            assert_eq!(salted_output_salt_cost(output).fract(), 0.0);
        }
        assert_eq!(salted_output_salt_cost(0.0), 0.0);
        assert!(salted_output_salt_cost(1.0) >= 1.0);
    }

    #[test]
    fn routine_livestock_output_caps_to_room_without_blocking_upkeep() {
        assert_eq!(storable_whole_output(9.0, 3.0), 3.0);
        assert_eq!(storable_whole_output(2.0, 12.0), 2.0);
        assert_eq!(storable_whole_output(4.0, 0.0), 0.0);
    }

    #[test]
    fn shared_husbandry_stock_is_conserved_and_split_fairly() {
        assert_eq!(fair_whole_allocations(6.0, &[5.0, 5.0]), vec![3.0, 3.0]);
        assert_eq!(fair_whole_allocations(5.0, &[5.0, 5.0]), vec![3.0, 2.0]);
        let capped = fair_whole_allocations(20.0, &[2.0, 7.0, 1.0]);
        assert_eq!(capped, vec![2.0, 7.0, 1.0]);
        assert_eq!(capped.iter().sum::<f64>(), 10.0);
    }
}
