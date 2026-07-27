//! Chapel gold is stored on `Building.gold`. The ordinary coffer is the portion
//! available to parish expenses; `chapel_monastery_tithe_due` is a physically
//! colocated but sealed purse that must leave by cart.

use spacetimedb::ReducerContext;

use crate::balance_generated::CHAPEL_COFFER_CAPACITY;
use crate::db::*;
use crate::economy::credit_treasury_gold;
use crate::economy::parish_accounting::{record_parish_ledger, ParishLedgerKind};
use crate::tables::Building;

pub fn chapel_coffer_gold(building: &Building) -> f64 {
    if building.kind == "chapel" {
        (building.gold - chapel_monastery_tithe_due(building)).max(0.0)
    } else {
        0.0
    }
}

pub fn chapel_monastery_tithe_due(building: &Building) -> f64 {
    if building.kind == "chapel" {
        building
            .chapel_monastery_tithe_due
            .max(0.0)
            .min(building.gold.max(0.0))
    } else {
        0.0
    }
}

pub fn chapel_coffer_capacity() -> f64 {
    CHAPEL_COFFER_CAPACITY
}

/// Maximum gross tithe that can be accepted without disembodied overflow.
/// The monastic share occupies its own sealed purse; only the parish share
/// consumes ordinary coffer capacity.
pub fn chapel_tithe_payment_room(
    ctx: &ReducerContext,
    chapel_id: u64,
    monastery_share: f64,
) -> f64 {
    let Some(chapel) = ctx.db.building().id().find(&chapel_id) else {
        return 0.0;
    };
    if chapel.kind != "chapel" {
        return 0.0;
    }
    let parish_fraction = 1.0 - monastery_share.clamp(0.0, 0.8);
    let parish_room = (chapel_coffer_capacity() - chapel_coffer_gold(&chapel)).max(0.0);
    if parish_fraction <= 1e-9 {
        f64::MAX
    } else {
        parish_room / parish_fraction
    }
}

/// Deposits one household payment into the physical chapel chest, separating
/// the pledged monastery purse from parish-operating funds. Returns
/// `(parish_gold, monastery_gold)` actually stored.
pub fn deposit_chapel_tithe(
    ctx: &ReducerContext,
    chapel_id: u64,
    paid: f64,
    monastery_share: f64,
) -> (f64, f64) {
    if paid <= 1e-9 {
        return (0.0, 0.0);
    }
    let Some(mut chapel) = ctx.db.building().id().find(&chapel_id) else {
        return (0.0, 0.0);
    };
    if chapel.kind != "chapel" {
        return (0.0, 0.0);
    }

    chapel.chapel_monastery_tithe_due = chapel_monastery_tithe_due(&chapel);
    let monastery_gold = paid * monastery_share.clamp(0.0, 0.8);
    let parish_gold = deposit_coffer_in_place(&mut chapel, (paid - monastery_gold).max(0.0));
    chapel.gold += monastery_gold;
    chapel.chapel_monastery_tithe_due += monastery_gold;
    ctx.db.building().id().update(chapel);
    (parish_gold, monastery_gold)
}

pub fn deposit_coffer_in_place(chapel: &mut Building, amount: f64) -> f64 {
    if chapel.kind != "chapel" || amount <= 1e-9 {
        return 0.0;
    }

    let room = (chapel_coffer_capacity() - chapel_coffer_gold(chapel)).max(0.0);
    let deposited = amount.min(room);
    if deposited <= 1e-9 {
        return 0.0;
    }

    chapel.gold += deposited;
    deposited
}

pub fn withdraw_coffer_in_place(chapel: &mut Building, amount: f64) -> f64 {
    if chapel.kind != "chapel" || amount <= 1e-9 {
        return 0.0;
    }

    let withdrawn = amount.min(chapel_coffer_gold(chapel).max(0.0));
    if withdrawn <= 1e-9 {
        return 0.0;
    }

    chapel.gold -= withdrawn;
    withdrawn
}

pub fn clear_coffer_in_place(chapel: &mut Building) -> f64 {
    let collected = chapel_coffer_gold(chapel);
    if chapel.kind == "chapel" {
        chapel.chapel_monastery_tithe_due = chapel_monastery_tithe_due(chapel);
        chapel.gold = chapel.chapel_monastery_tithe_due;
    }
    collected
}

pub fn collect_chapel_coffer(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    chapel_id: u64,
) -> Result<f64, String> {
    let chapel = ctx
        .db
        .building()
        .id()
        .find(&chapel_id)
        .ok_or_else(|| "Chapel not found.".to_string())?;

    validate_chapel_owner(&chapel, owner)?;

    let collected = chapel_coffer_gold(&chapel);
    if collected <= 1e-9 {
        return Ok(0.0);
    }

    let mut updated = chapel;
    clear_coffer_in_place(&mut updated);
    ctx.db.building().id().update(updated);
    credit_treasury_gold(ctx, owner, collected);
    record_parish_ledger(ctx, owner, ParishLedgerKind::ManualCollect, collected);
    Ok(collected)
}

fn validate_chapel_owner(chapel: &Building, owner: spacetimedb::Identity) -> Result<(), String> {
    if chapel.owner != owner {
        return Err("You do not own this chapel.".to_string());
    }
    if chapel.kind != "chapel" {
        return Err("Building is not a chapel.".to_string());
    }
    if !chapel.construction_complete {
        return Err("The chapel is still under construction.".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        chapel_coffer_capacity, chapel_coffer_gold, clear_coffer_in_place, deposit_coffer_in_place,
        withdraw_coffer_in_place,
    };
    use crate::tables::Building;

    fn sample_chapel(gold: f64) -> Building {
        Building {
            id: 1,
            owner: spacetimedb::Identity::ZERO,
            kind: "chapel".to_string(),
            x: 0.0,
            z: 0.0,
            work_radius: 0.0,
            action_cooldown: 0.0,
            timber: 0.0,
            firewood: 0.0,
            stone: 0.0,
            water: 0.0,
            food: 0.0,
            grain: 0.0,
            flour: 0.0,
            ale: 0.0,
            preserved_food: 0.0,
            honey: 0.0,
            wine: 0.0,
            ironwork: 0.0,
            polearms: 0.0,
            wool: 0.0,
            cloth: 0.0,
            water_capacity: 0.0,
            assigned_labor: 1,
            construction_complete: true,
            construction_progress: 1.0,
            construction_required_timber: 0.0,
            construction_required_stone: 0.0,
            construction_delivered_timber: 0.0,
            construction_delivered_stone: 0.0,
            construction_reserved_timber: 0.0,
            construction_reserved_stone: 0.0,
            construction_treasury_timber: 0.0,
            construction_treasury_stone: 0.0,
            gold,
            storehouse_accepts_timber: true,
            storehouse_accepts_stone: true,
            storehouse_accepts_firewood: true,
            storehouse_timber_target_percent: 100,
            storehouse_stone_target_percent: 100,
            storehouse_firewood_target_percent: 100,
            processor_output_target_percent: 100,
            granary_accepts_fresh_food: true,
            granary_households_first: false,
            granary_grain_reserve: 0.0,
            granary_fresh_food_target_percent: 100,
            harvest_reserve_percent: 0,
            construction_priority: 2,
            woodcutter_timber_reserve: 0.0,
            carpenter_polearm_reserve: 0,
            guardhouse_pay_priority: 0,
            guardhouse_food_reserve: 0,
            marketplace_ironwork_target: 0,
            marketplace_seed_grain_target: 0,
            marketplace_pending_trade_code: 0,
            marketplace_specialty_export_policy: 0,
            founding_shelter_active: false,
            chapel_monastery_tithe_due: 0.0,
        }
    }

    #[test]
    fn coffer_capacity_is_positive() {
        assert!(chapel_coffer_capacity() > 0.0);
    }

    #[test]
    fn non_chapel_reads_zero() {
        let mut building = sample_chapel(12.0);
        building.kind = "well".to_string();
        assert_eq!(chapel_coffer_gold(&building), 0.0);
        assert_eq!(withdraw_coffer_in_place(&mut building, 5.0), 0.0);
    }

    #[test]
    fn withdraw_caps_at_balance() {
        let mut chapel = sample_chapel(3.0);
        assert!((withdraw_coffer_in_place(&mut chapel, 10.0) - 3.0).abs() < 1e-9);
        assert!((chapel_coffer_gold(&chapel)).abs() < 1e-9);
    }

    #[test]
    fn deposit_respects_capacity() {
        let mut chapel = sample_chapel(chapel_coffer_capacity() - 2.0);
        assert!((deposit_coffer_in_place(&mut chapel, 10.0) - 2.0).abs() < 1e-9);
    }

    #[test]
    fn monastery_purse_is_not_spendable_parish_gold() {
        let mut chapel = sample_chapel(30.0);
        chapel.chapel_monastery_tithe_due = 12.0;
        assert!((chapel_coffer_gold(&chapel) - 18.0).abs() < 1e-9);
        assert!((withdraw_coffer_in_place(&mut chapel, 40.0) - 18.0).abs() < 1e-9);
        assert!((chapel.gold - 12.0).abs() < 1e-9);
    }

    #[test]
    fn clearing_coffer_leaves_monastery_purse_in_place() {
        let mut chapel = sample_chapel(30.0);
        chapel.chapel_monastery_tithe_due = 12.0;
        assert!((clear_coffer_in_place(&mut chapel) - 18.0).abs() < 1e-9);
        assert!((chapel.gold - 12.0).abs() < 1e-9);
        assert!((chapel.chapel_monastery_tithe_due - 12.0).abs() < 1e-9);
    }
}
