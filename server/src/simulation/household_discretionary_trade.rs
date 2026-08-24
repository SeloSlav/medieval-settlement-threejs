//! Optional household purchases that circulate existing savings through real
//! Trading Post stock. Survival distribution remains free and happens through
//! the normal needs system; only comfortable households enter this market.

use spacetimedb::ReducerContext;

use crate::balance_generated::{
    HOUSEHOLD_DISCRETIONARY_BUDGET_PER_PERSON_DAY, HOUSEHOLD_DISCRETIONARY_MIN_TIER,
    HOUSEHOLD_DISCRETIONARY_UNITS_PER_PERSON_DAY, HOUSEHOLD_DISCRETIONARY_WEALTH_RESERVE,
    HOUSEHOLD_LOCAL_POTTERY_GOLD_PER_UNIT, SPECIALTY_EXPORT_GOLD_PER_ALE,
    SPECIALTY_EXPORT_GOLD_PER_CHEESE, SPECIALTY_EXPORT_GOLD_PER_CLOTH,
    SPECIALTY_EXPORT_GOLD_PER_HONEY, SPECIALTY_EXPORT_GOLD_PER_WINE,
};
use crate::db::*;
use crate::economy::{
    building_commodity_room, building_commodity_stock, credit_local_purchase_receipt,
    credit_residence_wealth, debit_residence_wealth, deposit_building_commodity,
    withdraw_building_commodity, CommodityKind,
};
use crate::residence_service_policy::{
    scale_discretionary_limits, tier_four_non_vital_discretionary_multiplier,
};
use crate::residence_settlement_policy::settlement_buffers_ready;
use crate::resource_units::{whole_cost, whole_units};
use crate::simulation::chapel_community::recovery_stock_min;
use crate::simulation::game_calendar::GameClock;
use crate::simulation::residence_needs::load_needs;
use crate::simulation::tick_context::SimTickContext;
use crate::simulation::trading_post_exports_commodity;
use crate::tables::{Building, Residence};

const OPTIONAL_GOODS: [CommodityKind; 6] = [
    CommodityKind::Ale,
    CommodityKind::Wine,
    CommodityKind::Honey,
    CommodityKind::Cheese,
    CommodityKind::Cloth,
    CommodityKind::Pottery,
];

pub fn step_household_discretionary_trade(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
) {
    // One short market-call window per day avoids turning a household scan
    // into per-tick work while still allowing a newly arrived evening cart to
    // find a buyer before nightfall.
    if clock.hour != 18 || clock.minute >= 5 {
        return;
    }
    let day_marker = clock.total_days.saturating_add(1);
    let mut residences: Vec<Residence> = ctx
        .db
        .residence()
        .iter()
        .filter(|residence| {
            !residence.abandoned
                && residence.population > 0
                && residence.tier >= HOUSEHOLD_DISCRETIONARY_MIN_TIER
                && residence.last_discretionary_market_day != day_marker
                && residence.household_wealth > HOUSEHOLD_DISCRETIONARY_WEALTH_RESERVE + 1e-9
                && !tick.residence_disabled_by_fire(ctx, residence.id)
        })
        .collect();
    residences.sort_by_key(|residence| residence.id);

    for residence in residences {
        let Some(spending_multiplier) = discretionary_spending_multiplier(ctx, &residence) else {
            continue;
        };
        let Some(trading_post_id) =
            tick.marketplace_for_residence(ctx, residence.owner, residence.id)
        else {
            continue;
        };
        let Some(mut trading_post) = ctx.db.building().id().find(&trading_post_id) else {
            continue;
        };
        if try_purchase_one_good(
            ctx,
            &residence,
            &mut trading_post,
            day_marker,
            spending_multiplier,
        ) {
            ctx.db.building().id().update(trading_post);
        }
    }
}

fn discretionary_spending_multiplier(ctx: &ReducerContext, residence: &Residence) -> Option<f64> {
    let needs = load_needs(ctx, residence.id);
    let vital_deficit = needs
        .iter()
        .any(|need| need.kind.is_vital_for_tier(residence.tier, true) && need.deficit_ticks > 0);
    if vital_deficit {
        return None;
    }

    let basic = needs
        .iter()
        .filter(|need| need.kind.is_vital_for_tier(residence.tier, true))
        .map(|need| (need.stock, recovery_stock_min(need.kind, false, false)));
    if !settlement_buffers_ready(residence.population, basic) {
        return None;
    }

    let non_vital_deficit_ticks = needs
        .iter()
        .filter(|need| {
            need.kind.is_active_for_tier(residence.tier)
                && !need.kind.is_vital_for_tier(residence.tier, true)
        })
        .map(|need| need.deficit_ticks)
        .max()
        .unwrap_or(0);

    // Lower-tier households retain the established all-needs-safe rule.
    // Tier 4 instead gets a logistics grace window followed by a modest,
    // explicit reduction in optional purchases and the tax they generate.
    if residence.tier < 4 && non_vital_deficit_ticks > 0 {
        return None;
    }
    Some(tier_four_non_vital_discretionary_multiplier(
        residence.tier,
        non_vital_deficit_ticks,
    ))
}

fn try_purchase_one_good(
    ctx: &ReducerContext,
    residence: &Residence,
    trading_post: &mut Building,
    day_marker: u64,
    spending_multiplier: f64,
) -> bool {
    let (spendable, unit_limit) = discretionary_limits(
        residence.household_wealth,
        residence.population,
        spending_multiplier,
    );
    if spendable <= 1e-9 || unit_limit <= 1e-9 {
        return false;
    }

    let physical = ctx
        .db
        .player_resources()
        .owner()
        .find(&residence.owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled);
    let receipt_room = if physical {
        building_commodity_room(trading_post, CommodityKind::Gold)
    } else {
        f64::INFINITY
    };
    if receipt_room <= 1e-9 {
        return false;
    }

    let start = (residence.id.wrapping_add(day_marker) as usize) % OPTIONAL_GOODS.len();
    for offset in 0..OPTIONAL_GOODS.len() {
        let commodity = OPTIONAL_GOODS[(start + offset) % OPTIONAL_GOODS.len()];
        // Once a commodity is marked for export, stock staged in this post is
        // committed to the monthly exchange rather than the local shopfront.
        if trading_post_exports_commodity(ctx, trading_post.id, commodity) {
            continue;
        }
        let price = local_unit_price(commodity);
        let units = affordable_whole_purchase_units(
            building_commodity_stock(trading_post, commodity),
            unit_limit,
            spendable,
            receipt_room,
            price,
        );
        if units < 1.0 {
            continue;
        }

        let withdrawn = withdraw_building_commodity(trading_post, commodity, units);
        if withdrawn + 1e-6 < units {
            deposit_building_commodity(trading_post, commodity, withdrawn);
            return false;
        }
        let payment = whole_cost(withdrawn * price);
        let paid = debit_residence_wealth(ctx, residence, payment);
        if paid + 1e-6 < payment {
            deposit_building_commodity(trading_post, commodity, withdrawn);
            credit_residence_wealth(ctx, residence.id, paid);
            return false;
        }
        credit_local_purchase_receipt(ctx, trading_post, paid);
        if let Some(mut updated) = ctx.db.residence().id().find(&residence.id) {
            updated.last_discretionary_market_day = day_marker;
            ctx.db.residence().id().update(updated);
        }
        return true;
    }
    false
}

fn affordable_whole_purchase_units(
    stock: f64,
    unit_limit: f64,
    coin_budget: f64,
    receipt_room: f64,
    unit_price: f64,
) -> f64 {
    if !unit_price.is_finite() || unit_price <= 0.0 {
        return 0.0;
    }
    let budget = whole_units(coin_budget);
    if budget < 1.0 {
        return 0.0;
    }
    let room = if receipt_room.is_infinite() {
        f64::INFINITY
    } else {
        whole_units(receipt_room)
    };
    let mut units = whole_units(stock)
        .min(whole_units(unit_limit))
        .min((budget / unit_price).floor());
    if room.is_finite() {
        units = units.min((room / unit_price).floor());
    }
    while units >= 1.0
        && (whole_cost(units * unit_price) > budget
            || (room.is_finite() && whole_cost(units * unit_price) > room))
    {
        units -= 1.0;
    }
    units.max(0.0)
}

fn discretionary_limits(wealth: f64, population: u32, spending_multiplier: f64) -> (f64, f64) {
    let spendable = (wealth - HOUSEHOLD_DISCRETIONARY_WEALTH_RESERVE)
        .max(0.0)
        .min(HOUSEHOLD_DISCRETIONARY_BUDGET_PER_PERSON_DAY * population as f64);
    let unit_limit = HOUSEHOLD_DISCRETIONARY_UNITS_PER_PERSON_DAY * population as f64;
    scale_discretionary_limits(spendable, unit_limit, spending_multiplier)
}

fn local_unit_price(commodity: CommodityKind) -> f64 {
    match commodity {
        CommodityKind::Ale => SPECIALTY_EXPORT_GOLD_PER_ALE,
        CommodityKind::Wine => SPECIALTY_EXPORT_GOLD_PER_WINE,
        CommodityKind::Honey => SPECIALTY_EXPORT_GOLD_PER_HONEY,
        CommodityKind::Cheese => SPECIALTY_EXPORT_GOLD_PER_CHEESE,
        CommodityKind::Cloth => SPECIALTY_EXPORT_GOLD_PER_CLOTH,
        CommodityKind::Pottery => HOUSEHOLD_LOCAL_POTTERY_GOLD_PER_UNIT,
        _ => 0.0,
    }
    .max(0.01)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_optional_prices_are_positive_and_not_all_equal() {
        let ale = local_unit_price(CommodityKind::Ale);
        let wine = local_unit_price(CommodityKind::Wine);
        let pottery = local_unit_price(CommodityKind::Pottery);
        assert!(ale > 0.0 && wine > 0.0 && pottery > 0.0);
        assert_ne!(ale, wine);
        assert_ne!(wine, pottery);
    }

    #[test]
    fn shortage_multiplier_scales_spending_and_taxable_purchase_volume() {
        let wealth = HOUSEHOLD_DISCRETIONARY_WEALTH_RESERVE + 10_000.0;
        let (full_spend, full_units) = discretionary_limits(wealth, 4, 1.0);
        let (reduced_spend, reduced_units) = discretionary_limits(
            wealth,
            4,
            crate::balance_generated::HOUSEHOLD_TIER4_SHORTAGE_DISCRETIONARY_MULTIPLIER,
        );

        assert!((reduced_spend - full_spend * 0.75).abs() < 1e-9);
        assert!((reduced_units - full_units * 0.75).abs() < 1e-9);
    }

    #[test]
    fn purchases_move_only_whole_goods_for_a_full_whole_coin_payment() {
        assert_eq!(
            affordable_whole_purchase_units(4.8, 3.9, 5.9, 9.0, 1.6),
            3.0
        );
        assert_eq!(whole_cost(3.0 * 1.6), 5.0);
        assert_eq!(
            affordable_whole_purchase_units(4.0, 4.0, 0.9, 9.0, 0.2),
            0.0
        );
        assert_eq!(
            affordable_whole_purchase_units(4.0, 4.0, 1.0, 1.0, 0.4),
            2.0
        );
    }
}
