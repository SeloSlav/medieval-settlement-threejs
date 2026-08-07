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
    debit_residence_wealth, deposit_building_commodity, withdraw_building_commodity, CommodityKind,
};
use crate::residence_settlement_policy::settlement_buffers_ready;
use crate::simulation::chapel_community::recovery_stock_min;
use crate::simulation::game_calendar::GameClock;
use crate::simulation::residence_needs::{load_needs, ResidenceNeedKind};
use crate::simulation::tick_context::SimTickContext;
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
        if !basic_buffers_are_safe(ctx, &residence) {
            continue;
        }
        let Some(trading_post_id) =
            tick.marketplace_for_residence(ctx, residence.owner, residence.id)
        else {
            continue;
        };
        let Some(mut trading_post) = ctx.db.building().id().find(&trading_post_id) else {
            continue;
        };
        if try_purchase_one_good(ctx, &residence, &mut trading_post, day_marker) {
            ctx.db.building().id().update(trading_post);
        }
    }
}

fn basic_buffers_are_safe(ctx: &ReducerContext, residence: &Residence) -> bool {
    let needs = load_needs(ctx, residence.id);
    let basic = needs
        .iter()
        .filter(|need| {
            matches!(
                need.kind,
                ResidenceNeedKind::Food | ResidenceNeedKind::Firewood | ResidenceNeedKind::Water
            ) && need.kind.is_active_for_tier(residence.tier)
        })
        .map(|need| (need.stock, recovery_stock_min(need.kind, false, false)));
    needs
        .iter()
        .filter(|need| need.kind.is_active_for_tier(residence.tier))
        .all(|need| need.deficit_ticks == 0)
        && settlement_buffers_ready(residence.population, basic)
}

fn try_purchase_one_good(
    ctx: &ReducerContext,
    residence: &Residence,
    trading_post: &mut Building,
    day_marker: u64,
) -> bool {
    let spendable = (residence.household_wealth - HOUSEHOLD_DISCRETIONARY_WEALTH_RESERVE)
        .max(0.0)
        .min(HOUSEHOLD_DISCRETIONARY_BUDGET_PER_PERSON_DAY * residence.population as f64);
    let unit_limit = HOUSEHOLD_DISCRETIONARY_UNITS_PER_PERSON_DAY * residence.population as f64;
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
        let price = local_unit_price(commodity);
        let stock = building_commodity_stock(trading_post, commodity);
        let units = stock
            .min(unit_limit)
            .min(spendable / price)
            .min(receipt_room / price);
        if units <= 1e-9 {
            continue;
        }

        let withdrawn = withdraw_building_commodity(trading_post, commodity, units);
        let intended_payment = withdrawn * price;
        let paid = debit_residence_wealth(ctx, residence, intended_payment);
        if paid <= 1e-9 {
            deposit_building_commodity(trading_post, commodity, withdrawn);
            return false;
        }
        if paid + 1e-9 < intended_payment {
            let unpaid_units = withdrawn * (1.0 - paid / intended_payment);
            deposit_building_commodity(trading_post, commodity, unpaid_units);
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
}
