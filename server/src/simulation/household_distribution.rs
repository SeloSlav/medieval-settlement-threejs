//! Abstract household distribution from physical market stalls and wells.
//!
//! The physical logistics chain ends at a shared distribution point. Stock is
//! still conserved and road topology still decides coverage, but routine
//! household provisioning does not reserve a worker or create a delivery trip.

use std::collections::{BTreeMap, HashMap};

use spacetimedb::{Identity, ReducerContext};

use crate::balance_generated::{
    CALENDAR_SECONDS_PER_DAY, MARKETPLACE_HOUSEHOLD_ISSUE_CHECKS_PER_DAY,
    RESIDENCE_ALE_UNITS_PER_MONTH, RESIDENCE_FIREWOOD_UNITS_PER_MONTH,
    RESIDENCE_FOOD_UNITS_PER_SLOT_PER_MONTH, RESIDENCE_LUXURY_UNITS_PER_MONTH, TICK_DT,
};
use crate::db::*;
use crate::economy::{
    building_commodity_stock, deposit_building_commodity, deposit_residence_commodity,
    residence_food_progression_required_slots, withdraw_building_commodity,
    CommodityKind,
};
use crate::pantry_safeguard_policy::{
    daily_market_issue_target_days, emergency_pantry_rule, normalize_pantry_safeguard_policy,
};
use crate::season_policy::EnvironmentState;
use crate::simulation::delivery_cargo::{
    delivery_stock_room, residence_commodity_delivery_room,
    selected_food_delivery_commodity_for_residence, withdraw_delivery_cargo,
};
use crate::simulation::residence_needs::state::{migrate_and_sync_food_inventory, persist_needs};
use crate::simulation::residence_needs::{
    apply_need_delivery, load_needs, need_stock, sync_food_need_rows, ResidenceNeedKind,
};
use crate::simulation::tick_context::SimTickContext;
use crate::tables::{Building, Residence};

const MARKET_NEEDS: [ResidenceNeedKind; 8] = [
    ResidenceNeedKind::Food,
    ResidenceNeedKind::Firewood,
    ResidenceNeedKind::PreservedFood,
    ResidenceNeedKind::Cloth,
    ResidenceNeedKind::Shoes,
    ResidenceNeedKind::Pottery,
    ResidenceNeedKind::Ale,
    ResidenceNeedKind::Luxury,
];

#[derive(Clone, Copy, Debug, PartialEq)]
struct DistributionTarget {
    residence_id: u64,
    preferred_source_id: u64,
    x: f64,
    z: f64,
    distance: f64,
    runway_days: f64,
    target_stock: f64,
    daily_lot: f64,
    pantry_rounds: usize,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MarketIssueCycle {
    Daily,
}

impl MarketIssueCycle {
    fn ration_rounds(self, pantry_policy: u8) -> usize {
        match self {
            Self::Daily => emergency_pantry_rule(pantry_policy)
                .map(|rule| rule.target_days.ceil() as usize)
                .unwrap_or(1)
                .max(1),
        }
    }
}

/// Check household lots from stock held at local markets several times per
/// day. Each check fills only to the same monthly-bill buffer, so frequent
/// checks reduce the wait after stock arrives without multiplying household
/// demand. An optional Town Hall safeguard adds a deeper buffer for critically
/// low food and fuel without turning every bill into a separate haul.
/// Replenishment remains physical, and scarce stock is shared one household
/// bill at a time before any pantry receives an extra safeguard lot.
pub fn step_market_household_distribution(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    sim_tick: u64,
    environment: EnvironmentState,
) {
    let Some(issue_cycle) = market_issue_cycle(sim_tick) else {
        return;
    };
    for need_kind in MARKET_NEEDS {
        let distribution_kind = if need_kind == ResidenceNeedKind::Ale {
            "tavern"
        } else {
            "marketplace"
        };
        // Scan residences once per need and group the cached claims by source.
        // This keeps distribution proportional to homes plus active stalls,
        // rather than multiplying a whole residence scan by every market.
        let residences: Vec<(Residence, f64, f64)> = ctx
            .db
            .residence()
            .iter()
            .filter_map(|residence| {
                if residence.abandoned
                    || residence.population == 0
                    || !need_kind.is_active_for_tier(residence.tier)
                    || tick.residence_disabled_by_fire(ctx, residence.id)
                {
                    return None;
                }
                let pantry_policy =
                    normalize_pantry_safeguard_policy(crate::settlement_policy::pantry_safeguard(
                        ctx,
                        residence.owner,
                        residence.settlement_id,
                    ));
                let (target_stock, daily_lot) = household_issue_target(
                    ctx,
                    &residence,
                    need_kind,
                    issue_cycle,
                    environment,
                    pantry_policy,
                )?;
                Some((residence, target_stock, daily_lot))
            })
            .collect();
        let mut residences_by_market: BTreeMap<u64, Vec<(Residence, f64, f64)>> = BTreeMap::new();
        for (residence, target_stock, daily_lot) in residences {
            let Some(market_id) =
                tick.local_marketplace_for_residence(ctx, residence.owner, residence.id, need_kind)
            else {
                continue;
            };
            residences_by_market.entry(market_id).or_default().push((
                residence,
                target_stock,
                daily_lot,
            ));
        }

        let mut targets_by_owner: HashMap<Identity, Vec<DistributionTarget>> = HashMap::new();
        for (market_id, residences) in residences_by_market {
            let Some(market) = ctx.db.building().id().find(&market_id) else {
                continue;
            };
            if market.kind != distribution_kind
                || !market.construction_complete
                || (need_kind == ResidenceNeedKind::Ale && market.assigned_labor == 0)
                || tick.building_disabled_by_fire(ctx, market.id)
                || market_stock(ctx, tick, &market, need_kind) <= 1e-9
            {
                continue;
            }
            let Some(network) = tick.road_network(market.owner) else {
                continue;
            };
            let positions: Vec<(f64, f64)> = residences
                .iter()
                .map(|(residence, _, _)| (residence.x, residence.z))
                .collect();
            let distances = network.road_path_distances_from(market.x, market.z, &positions);
            targets_by_owner
                .entry(market.owner)
                .or_default()
                .extend(distribution_targets(
                    ctx,
                    need_kind,
                    &residences,
                    market.id,
                    distances,
                ));
        }

        let market_candidates: Vec<Building> = ctx
            .db
            .building()
            .iter()
            .filter(|building| {
                building.kind == distribution_kind
                    && building.construction_complete
                    && (need_kind != ResidenceNeedKind::Ale || building.assigned_labor > 0)
                    && !tick.building_disabled_by_fire(ctx, building.id)
                    && market_stock(ctx, tick, building, need_kind) > 1e-9
            })
            .collect();
        let mut sources_by_owner: HashMap<Identity, Vec<Building>> = HashMap::new();
        for market in market_candidates {
            if tick.road_network(market.owner).is_none() {
                continue;
            }
            sources_by_owner
                .entry(market.owner)
                .or_default()
                .push(market);
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
            let max_rounds = targets
                .iter()
                .map(|target| target.pantry_rounds)
                .max()
                .unwrap_or(1);

            // Allocate one household bill per pass. When stock is scarce this
            // gives every connected home some cover before any one pantry
            // receives an extra safeguard lot.
            for round in 0..max_rounds {
                for target in &targets {
                    if round >= target.pantry_rounds {
                        continue;
                    }
                    let current = need_stock(&load_needs(ctx, target.residence_id), need_kind);
                    let round_target = target.target_stock.min(current + target.daily_lot);
                    if let Some(preferred_index) = sources.iter().position(|market| {
                        market.id == target.preferred_source_id
                            && market_stock(ctx, tick, market, need_kind) > 1e-9
                    }) {
                        distribute_to_residence(
                            ctx,
                            tick,
                            &mut sources[preferred_index],
                            target.residence_id,
                            need_kind,
                            round_target,
                        );
                    }
                    if !residence_has_distribution_room(
                        ctx,
                        target.residence_id,
                        need_kind,
                        round_target,
                    ) {
                        continue;
                    }
                    // Markets form one abstract supply network per connected
                    // road branch. Another stocked square may finish this
                    // day's ration when the preferred stall runs dry.
                    for source in sources.iter_mut() {
                        if source.id == target.preferred_source_id
                            || market_stock(ctx, tick, source, need_kind) <= 1e-9
                            || !network.road_connected(source.x, source.z, target.x, target.z)
                        {
                            continue;
                        }
                        distribute_to_residence(
                            ctx,
                            tick,
                            source,
                            target.residence_id,
                            need_kind,
                            round_target,
                        );
                        if !residence_has_distribution_room(
                            ctx,
                            target.residence_id,
                            need_kind,
                            round_target,
                        ) {
                            break;
                        }
                    }
                }
            }
            for market in sources.iter().cloned() {
                ctx.db.building().id().update(market);
            }
        }
    }
}

fn market_issue_cycle(sim_tick: u64) -> Option<MarketIssueCycle> {
    let ticks_per_day = (CALENDAR_SECONDS_PER_DAY / TICK_DT).round().max(1.0) as u64;
    let checks_per_day = u64::from(MARKETPLACE_HOUSEHOLD_ISSUE_CHECKS_PER_DAY.max(1));
    let ticks_per_check = ticks_per_day.div_ceil(checks_per_day).max(1);
    if sim_tick == 0 || sim_tick % ticks_per_check != 0 {
        return None;
    }
    Some(MarketIssueCycle::Daily)
}

fn household_issue_target(
    ctx: &ReducerContext,
    residence: &Residence,
    need_kind: ResidenceNeedKind,
    issue_cycle: MarketIssueCycle,
    _environment: EnvironmentState,
    pantry_policy: u8,
) -> Option<(f64, f64)> {
    let monthly_lot = match need_kind {
        ResidenceNeedKind::Food => {
            f64::from(residence_food_progression_required_slots(residence.tier))
                * RESIDENCE_FOOD_UNITS_PER_SLOT_PER_MONTH
        }
        ResidenceNeedKind::Firewood => RESIDENCE_FIREWOOD_UNITS_PER_MONTH,
        ResidenceNeedKind::PreservedFood => f64::from(residence.tier >= 4),
        ResidenceNeedKind::Ale => RESIDENCE_ALE_UNITS_PER_MONTH,
        ResidenceNeedKind::Cloth | ResidenceNeedKind::Shoes | ResidenceNeedKind::Pottery => 1.0,
        ResidenceNeedKind::Luxury => RESIDENCE_LUXURY_UNITS_PER_MONTH,
        ResidenceNeedKind::Water | ResidenceNeedKind::Church | ResidenceNeedKind::FoodVariety => {
            return None
        }
    };
    if monthly_lot < 1.0 {
        return None;
    }
    let stock = need_stock(&load_needs(ctx, residence.id), need_kind);
    let reserve_months = match issue_cycle {
        MarketIssueCycle::Daily => daily_market_issue_target_days(
            matches!(
                need_kind,
                ResidenceNeedKind::Firewood
                    | ResidenceNeedKind::Food
                    | ResidenceNeedKind::PreservedFood
            ),
            stock,
            monthly_lot,
            pantry_policy,
        ),
    };
    let capacity = delivery_stock_room(need_kind, 0.0);
    let target_stock = (monthly_lot * reserve_months).min(capacity);
    (stock + 1e-9 < target_stock).then_some((target_stock, monthly_lot))
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
    let residences: Vec<(Residence, f64, f64)> = ctx
        .db
        .residence()
        .owner()
        .filter(&well.owner)
        .filter(|residence| {
            !residence.abandoned
                && residence.population > 0
                && ResidenceNeedKind::Water.is_active_for_tier(residence.tier)
                && !tick.residence_disabled_by_fire(ctx, residence.id)
                && delivery_stock_room(
                    ResidenceNeedKind::Water,
                    need_stock(&load_needs(ctx, residence.id), ResidenceNeedKind::Water),
                ) > 1e-9
                && tick.well_supplier_for(ctx, well.owner, residence.id) == Some(well.id)
        })
        .map(|residence| {
            let stock = need_stock(&load_needs(ctx, residence.id), ResidenceNeedKind::Water);
            let target = stock + delivery_stock_room(ResidenceNeedKind::Water, stock);
            (residence, target, target)
        })
        .collect();
    let positions: Vec<(f64, f64)> = residences
        .iter()
        .map(|(residence, _, _)| (residence.x, residence.z))
        .collect();
    let distances = network.road_path_distances_from(well.x, well.z, &positions);
    let mut targets = distribution_targets(
        ctx,
        ResidenceNeedKind::Water,
        &residences,
        well.id,
        distances,
    );
    sort_distribution_targets(&mut targets);
    for target in targets {
        if well.water <= 1e-9 {
            break;
        }
        distribute_to_residence(
            ctx,
            tick,
            well,
            target.residence_id,
            ResidenceNeedKind::Water,
            target.target_stock,
        );
    }
}

fn distribution_targets(
    ctx: &ReducerContext,
    need_kind: ResidenceNeedKind,
    residences: &[(Residence, f64, f64)],
    preferred_source_id: u64,
    distances: Vec<Option<f64>>,
) -> Vec<DistributionTarget> {
    residences
        .iter()
        .zip(distances)
        .filter_map(|((residence, target_stock, daily_lot), distance)| {
            let distance = distance.filter(|distance| distance.is_finite())?;
            Some(DistributionTarget {
                residence_id: residence.id,
                preferred_source_id,
                x: residence.x,
                z: residence.z,
                distance,
                runway_days: need_stock(&load_needs(ctx, residence.id), need_kind)
                    / daily_lot.max(1e-9),
                target_stock: *target_stock,
                daily_lot: *daily_lot,
                pantry_rounds: MarketIssueCycle::Daily.ration_rounds(
                    normalize_pantry_safeguard_policy(crate::settlement_policy::pantry_safeguard(
                        ctx,
                        residence.owner,
                        residence.settlement_id,
                    )),
                ),
            })
        })
        .collect()
}

fn sort_distribution_targets(targets: &mut [DistributionTarget]) {
    targets.sort_by(|left, right| {
        left.runway_days
            .total_cmp(&right.runway_days)
            .then_with(|| left.distance.total_cmp(&right.distance))
            .then_with(|| left.residence_id.cmp(&right.residence_id))
    });
}

fn residence_has_distribution_room(
    ctx: &ReducerContext,
    residence_id: u64,
    need_kind: ResidenceNeedKind,
    target_stock: f64,
) -> bool {
    let stock = need_stock(&load_needs(ctx, residence_id), need_kind);
    delivery_stock_room(need_kind, stock).min((target_stock - stock).max(0.0)) > 1e-9
}

fn distribute_to_residence(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    source: &mut Building,
    residence_id: u64,
    need_kind: ResidenceNeedKind,
    target_stock: f64,
) {
    if matches!(
        need_kind,
        ResidenceNeedKind::Food | ResidenceNeedKind::PreservedFood
    ) {
        distribute_food_to_residence(ctx, source, residence_id, need_kind, target_stock);
        return;
    }
    let stock = need_stock(&load_needs(ctx, residence_id), need_kind);
    let room = delivery_stock_room(need_kind, stock).min((target_stock - stock).max(0.0));
    if room <= 1e-9 {
        return;
    }
    let delivered = if need_kind == ResidenceNeedKind::Luxury {
        withdraw_staffed_market_luxury(ctx, tick, source, room)
    } else {
        withdraw_delivery_cargo(source, need_kind, room)
    };
    if delivered > 1e-9 {
        apply_need_delivery(ctx, residence_id, need_kind, delivered);
    }
}

fn distribute_food_to_residence(
    ctx: &ReducerContext,
    source: &mut Building,
    residence_id: u64,
    need_kind: ResidenceNeedKind,
    target_stock: f64,
) {
    let Some(mut residence) = ctx.db.residence().id().find(&residence_id) else {
        return;
    };
    let mut needs = load_needs(ctx, residence_id);
    migrate_and_sync_food_inventory(ctx, &mut residence, &mut needs);
    persist_needs(ctx, residence_id, &needs);
    ctx.db.residence().id().update(residence);

    loop {
        let Some(mut residence) = ctx.db.residence().id().find(&residence_id) else {
            return;
        };
        let need_stock_now = need_stock(&load_needs(ctx, residence_id), need_kind);
        let need_room = delivery_stock_room(need_kind, need_stock_now)
            .min((target_stock - need_stock_now).max(0.0));
        if need_room <= 1e-9 {
            return;
        }
        let Some(commodity) =
            selected_food_delivery_commodity_for_residence(source, &residence, need_kind)
        else {
            return;
        };
        let commodity_room = residence_commodity_delivery_room(&residence, commodity);
        let amount = (need_room / commodity.meal_value().max(1e-9))
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

fn market_stock(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    building: &Building,
    need_kind: ResidenceNeedKind,
) -> f64 {
    if need_kind != ResidenceNeedKind::Luxury {
        return crate::simulation::delivery_cargo::building_delivery_stock(building, need_kind);
    }
    let candle_stock = tick
        .marketplace_stall_workplace_id_for_commodity(ctx, building, CommodityKind::Candles)
        .is_some()
        .then_some(building.candles)
        .unwrap_or(0.0);
    let food_luxury_stock = tick
        .marketplace_stall_workplace_id(ctx, building, ResidenceNeedKind::Luxury)
        .is_some()
        .then_some(building.wine + building.honey)
        .unwrap_or(0.0);
    candle_stock + food_luxury_stock
}

fn withdraw_staffed_market_luxury(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    source: &mut Building,
    amount: f64,
) -> f64 {
    let mut remaining = amount.max(0.0);
    let mut withdrawn = 0.0;
    if tick
        .marketplace_stall_workplace_id_for_commodity(ctx, source, CommodityKind::Candles)
        .is_some()
    {
        let candles = withdraw_building_commodity(source, CommodityKind::Candles, remaining);
        withdrawn += candles;
        remaining = (remaining - candles).max(0.0);
    }
    if remaining > 1e-9
        && tick
            .marketplace_stall_workplace_id(ctx, source, ResidenceNeedKind::Luxury)
            .is_some()
    {
        for commodity in [CommodityKind::Wine, CommodityKind::Honey] {
            let used = withdraw_building_commodity(source, commodity, remaining);
            withdrawn += used;
            remaining = (remaining - used).max(0.0);
            if remaining <= 1e-9 {
                break;
            }
        }
    }
    withdrawn
}

#[cfg(test)]
mod tests {
    use super::{
        market_issue_cycle, sort_distribution_targets, DistributionTarget, MarketIssueCycle,
    };
    use crate::pantry_safeguard_policy::{
        PANTRY_DAILY_ISSUE_ONLY, PANTRY_ONE_DAY_SAFEGUARD, PANTRY_TWO_DAY_SAFEGUARD,
    };

    #[test]
    fn household_market_checks_repeat_at_the_configured_daily_cadence() {
        let ticks_per_day = (crate::balance_generated::CALENDAR_SECONDS_PER_DAY
            / crate::balance_generated::TICK_DT)
            .round() as u64;
        let checks_per_day =
            u64::from(crate::balance_generated::MARKETPLACE_HOUSEHOLD_ISSUE_CHECKS_PER_DAY);
        let ticks_per_check = ticks_per_day.div_ceil(checks_per_day);
        assert!(checks_per_day > 1);
        assert_eq!(market_issue_cycle(0), None);
        assert_eq!(market_issue_cycle(ticks_per_check - 1), None);
        assert_eq!(
            market_issue_cycle(ticks_per_check),
            Some(MarketIssueCycle::Daily)
        );
        assert_eq!(market_issue_cycle(ticks_per_check + 1), None);
        assert_eq!(
            market_issue_cycle(ticks_per_check * 2),
            Some(MarketIssueCycle::Daily)
        );
        assert_eq!(
            market_issue_cycle(ticks_per_day),
            Some(MarketIssueCycle::Daily)
        );
    }

    #[test]
    fn daily_issue_rations_base_lots_before_safeguard_buffers() {
        assert_eq!(
            MarketIssueCycle::Daily.ration_rounds(PANTRY_DAILY_ISSUE_ONLY),
            1,
        );
        assert_eq!(
            MarketIssueCycle::Daily.ration_rounds(PANTRY_ONE_DAY_SAFEGUARD),
            2,
        );
        assert_eq!(
            MarketIssueCycle::Daily.ration_rounds(PANTRY_TWO_DAY_SAFEGUARD),
            3,
        );
    }

    #[test]
    fn scarce_distribution_prioritizes_nearest_home_then_stable_id() {
        let mut ordered = vec![
            DistributionTarget {
                residence_id: 30,
                preferred_source_id: 1,
                x: 0.0,
                z: 0.0,
                distance: 40.0,
                runway_days: 0.0,
                target_stock: 7.0,
                daily_lot: 1.0,
                pantry_rounds: 1,
            },
            DistributionTarget {
                residence_id: 10,
                preferred_source_id: 1,
                x: 0.0,
                z: 0.0,
                distance: 12.0,
                runway_days: 0.0,
                target_stock: 7.0,
                daily_lot: 1.0,
                pantry_rounds: 1,
            },
            DistributionTarget {
                residence_id: 20,
                preferred_source_id: 1,
                x: 0.0,
                z: 0.0,
                distance: 12.0,
                runway_days: 0.0,
                target_stock: 7.0,
                daily_lot: 1.0,
                pantry_rounds: 1,
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
                    runway_days: 0.0,
                    target_stock: 7.0,
                    daily_lot: 1.0,
                    pantry_rounds: 1,
                },
                DistributionTarget {
                    residence_id: 20,
                    preferred_source_id: 1,
                    x: 0.0,
                    z: 0.0,
                    distance: 12.0,
                    runway_days: 0.0,
                    target_stock: 7.0,
                    daily_lot: 1.0,
                    pantry_rounds: 1,
                },
                DistributionTarget {
                    residence_id: 30,
                    preferred_source_id: 1,
                    x: 0.0,
                    z: 0.0,
                    distance: 40.0,
                    runway_days: 0.0,
                    target_stock: 7.0,
                    daily_lot: 1.0,
                    pantry_rounds: 1,
                },
            ]
        );
    }
}
