//! Chapel gold is stored on `Building.gold`. The ordinary coffer is the portion
//! available to parish expenses; `chapel_monastery_tithe_due` is a physically
//! colocated but sealed purse that must leave by cart.

use spacetimedb::ReducerContext;

#[cfg(test)]
use crate::balance_generated::CHAPEL_COFFER_CAPACITY;
use crate::chapel_upgrade_policy::chapel_coffer_capacity_for_tier;
use crate::db::*;
use crate::resource_units::{whole_request, whole_room, whole_transfer, whole_units};
use crate::tables::Building;

pub fn chapel_coffer_gold(building: &Building) -> f64 {
    if building.kind == "chapel" {
        whole_units(building.gold - chapel_monastery_tithe_due(building))
    } else {
        0.0
    }
}

pub fn chapel_monastery_tithe_due(building: &Building) -> f64 {
    if building.kind == "chapel" {
        whole_units(building.chapel_monastery_tithe_due).min(whole_units(building.gold))
    } else {
        0.0
    }
}

#[cfg(test)]
pub fn chapel_coffer_capacity() -> f64 {
    CHAPEL_COFFER_CAPACITY
}

pub fn chapel_coffer_capacity_for(chapel: &Building) -> f64 {
    if chapel.kind == "chapel" {
        whole_units(chapel_coffer_capacity_for_tier(chapel.chapel_tier))
    } else {
        0.0
    }
}

/// Split one aggregate household payment without minting half-coins. Rounding
/// favors the local parish coffer; every paid coin is assigned exactly once.
pub fn chapel_tithe_split(payment: f64, monastery_share: f64) -> (f64, f64) {
    let payment = whole_units(payment);
    let monastery_gold = whole_units(payment * monastery_share.clamp(0.0, 0.8));
    ((payment - monastery_gold).max(0.0), monastery_gold)
}

fn chapel_tithe_payment_room_for(chapel: &Building, monastery_share: f64) -> f64 {
    let parish_room = whole_room(
        chapel_coffer_capacity_for(chapel),
        chapel_coffer_gold(chapel),
    );
    let parish_fraction = 1.0 - monastery_share.clamp(0.0, 0.8);
    if parish_room < 1.0 || parish_fraction <= 0.0 {
        return 0.0;
    }

    // With the monastery share floored to a whole coin, the parish receives
    // ceil(gross * parish_fraction). This quotient is therefore the largest
    // gross whole payment that can fit in the remaining ordinary coffer room.
    whole_units(parish_room / parish_fraction)
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
    chapel_tithe_payment_room_for(&chapel, monastery_share)
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
    let paid = whole_request(paid);
    if paid < 1.0 {
        return (0.0, 0.0);
    }
    let Some(mut chapel) = ctx.db.building().id().find(&chapel_id) else {
        return (0.0, 0.0);
    };
    if chapel.kind != "chapel" {
        return (0.0, 0.0);
    }

    chapel.gold = whole_units(chapel.gold);
    chapel.chapel_monastery_tithe_due = chapel_monastery_tithe_due(&chapel);
    let accepted = paid.min(chapel_tithe_payment_room_for(&chapel, monastery_share));
    let (parish_payment, monastery_gold) = chapel_tithe_split(accepted, monastery_share);
    let parish_gold = deposit_coffer_in_place(&mut chapel, parish_payment);
    chapel.gold += monastery_gold;
    chapel.chapel_monastery_tithe_due += monastery_gold;
    ctx.db.building().id().update(chapel);
    (parish_gold, monastery_gold)
}

pub fn deposit_coffer_in_place(chapel: &mut Building, amount: f64) -> f64 {
    if chapel.kind != "chapel" {
        return 0.0;
    }

    chapel.gold = whole_units(chapel.gold);
    chapel.chapel_monastery_tithe_due = chapel_monastery_tithe_due(chapel);
    let deposited = whole_room(
        chapel_coffer_capacity_for(chapel),
        chapel_coffer_gold(chapel),
    )
    .min(whole_request(amount));
    if deposited < 1.0 {
        return 0.0;
    }

    chapel.gold += deposited;
    deposited
}

pub fn withdraw_coffer_in_place(chapel: &mut Building, amount: f64) -> f64 {
    if chapel.kind != "chapel" {
        return 0.0;
    }

    chapel.gold = whole_units(chapel.gold);
    chapel.chapel_monastery_tithe_due = chapel_monastery_tithe_due(chapel);
    let withdrawn = whole_transfer(chapel_coffer_gold(chapel), amount);
    if withdrawn < 1.0 {
        return 0.0;
    }

    chapel.gold -= withdrawn;
    withdrawn
}

#[cfg(test)]
mod tests {
    use super::{
        chapel_coffer_capacity, chapel_coffer_capacity_for, chapel_coffer_gold, chapel_tithe_split,
        deposit_coffer_in_place, withdraw_coffer_in_place,
    };
    use crate::tables::Building;

    fn sample_chapel(gold: f64) -> Building {
        Building {
            id: 1,
            owner: spacetimedb::Identity::ZERO,
            kind: "chapel".to_string(),
            x: 0.0,
            z: 0.0,
            placement_yaw: 0.0,
            placement_yaw_locked: true,
            work_radius: 0.0,
            tree_work_area_x: 0.0,
            tree_work_area_z: 0.0,
            tree_work_area_radius: 0.0,
            action_cooldown: 0.0,
            timber: 0.0,
            firewood: 0.0,
            stone: 0.0,
            water: 0.0,
            food: 0.0,
            rye_sheaves: 0.0,
            oat_sheaves: 0.0,
            barley_sheaves: 0.0,
            maslin_sheaves: 0.0,
            rye_grain: 0.0,
            oat_grain: 0.0,
            maslin_grain: 0.0,
            rye_flour: 0.0,
            maslin_flour: 0.0,
            ale: 0.0,
            honey: 0.0,
            wine: 0.0,
            ironwork: 0.0,
            polearms: 0.0,
            wool: 0.0,
            cloth: 0.0,
            hides: 0.0,
            leather: 0.0,
            shoes: 0.0,
            water_capacity: 0.0,
            assigned_labor: 1,
            construction_complete: true,
            construction_progress: 1.0,
            construction_required_timber: 0.0,
            construction_required_stone: 0.0,
            construction_required_ironwork: 0.0,
            construction_delivered_timber: 0.0,
            construction_delivered_stone: 0.0,
            construction_delivered_ironwork: 0.0,
            construction_reserved_timber: 0.0,
            construction_reserved_stone: 0.0,
            construction_reserved_ironwork: 0.0,
            construction_treasury_timber: 0.0,
            construction_treasury_stone: 0.0,
            construction_treasury_ironwork: 0.0,
            construction_required_roof_tiles: 0.0,
            construction_delivered_roof_tiles: 0.0,
            construction_reserved_roof_tiles: 0.0,
            construction_treasury_roof_tiles: 0.0,
            gold,
            storehouse_accepts_timber: true,
            storehouse_accepts_stone: true,
            storehouse_accepts_firewood: true,
            storehouse_timber_target_percent: 100,
            storehouse_stone_target_percent: 100,
            storehouse_firewood_target_percent: 100,
            processor_output_target_percent: 100,
            production_rate_percent: crate::production_rate_policy::DEFAULT_PRODUCTION_RATE_PERCENT,
            production_maintenance_progress: 0.0,
            granary_accepts_fresh_food: true,
            granary_households_first: false,
            granary_grain_reserve: 0.0,
            granary_fresh_food_target_percent: 100,
            harvest_reserve_percent: 0,
            construction_priority: 2,
            woodcutter_timber_reserve: 0.0,
            carpenter_polearm_reserve: 0,
            guardhouse_muster_watchtower_id: 0,
            weaver_input_policy: 0,
            marketplace_ironwork_target: 0,
            marketplace_seed_grain_target: 0,
            marketplace_pending_trade_code: 0,
            marketplace_gold_reserve_target:
                crate::marketplace_procurement_policy::MARKETPLACE_GOLD_RESERVE_DEFAULT,
            marketplace_specialty_export_policy: 0,
            founding_shelter_active: false,
            chapel_monastery_tithe_due: 0.0,
            civic_receipts_gold: 0.0,
            private_export_proceeds_gold: 0.0,
            barley: 0.0,
            malt: 0.0,
            flax: 0.0,
            iron: 0.0,
            clay: 0.0,
            salt: 0.0,
            charcoal: 0.0,
            pottery: 0.0,
            manure: 0.0,
            marketplace_iron_target: 0,
            marketplace_salt_target: 0,
            remedies: 0.0,
            pottery_dispatch_policy: 0,
            carpenter_cart_service_target_trips: 0,
            storehouse_accepts_iron: true,
            storehouse_accepts_clay: true,
            storehouse_accepts_salt: true,
            storehouse_accepts_charcoal: true,
            storehouse_iron_target_percent: 100,
            storehouse_clay_target_percent: 100,
            storehouse_salt_target_percent: 100,
            storehouse_charcoal_target_percent: 25,
            roof_tiles: 0.0,
            potter_firing_policy: 0,
            remote_work_camp_enabled: false,
            linked_worksite_id: 0,
            commute_efficiency: 1.0,
            chapel_tier: 2,
            rye_bread: 0.0,
            maslin_bread: 0.0,
            threshing_priority: crate::farm_work_policy::THRESHING_PRIORITY_DEFAULT,
            meat: 0.0,
            fish: 0.0,
            berries: 0.0,
            mushrooms: 0.0,
            milk: 0.0,
            apples: 0.0,
            pears: 0.0,
            cherries: 0.0,
            aronia: 0.0,
            rosehips: 0.0,
            cabbage: 0.0,
            carrots: 0.0,
            beetroot: 0.0,
            eggs: 0.0,
            grapes: 0.0,
            cured_meat: 0.0,
            smoked_fish: 0.0,
            cheese: 0.0,
            vineyard_fermenting_grapes: 0.0,
            vineyard_fermentation_progress: 0.0,
            apiary_harvest_policy: 1,
            apiary_colony_health: 1.0,
            apiary_last_winter_year: 0,
            apiary_forage_score: 0.75,
            marketplace_drink_export_policy: 255,
            marketplace_provision_export_policy: 255,
            marketplace_wares_export_policy: 255,
            fire_repair_active: false,
            cider: 0.0,
            mead: 0.0,
            jam: 0.0,
            brewery_recipe_policy: crate::brewery_recipe_policy::BREWERY_RECIPE_ALE,
            monastery_orchard_planting: crate::monastery_estate_policy::MONASTERY_ORCHARD_APPLES,
            monastery_croft_planting: crate::monastery_estate_policy::MONASTERY_CROFT_VEGETABLES,
            monastery_extensions: 0,
            monastery_next_extension: 0,
            monastery_orchard_planted_year: 0,
            monastery_orchard_maturity:
                crate::monastery_estate_policy::MONASTERY_ORCHARD_MATURITY_MATURE,
            monastery_croft_choice_year: 0,
            monastery_service_funding: 1.0,
            monastery_last_service_day: 0,
            storage_acceptance_mask: u64::MAX,
            settlement_id: 1,
            animal_feed: 0.0,
            storage_acceptance_mask_high: u64::MAX,
            wax: 0.0,
            candles: 0.0,
            apiary_wax_cycle_progress: 0,
            pelts: 0.0,
            yarn: 0.0,
            linen: 0.0,
            milk_use_policy: crate::livestock_policy::MILK_USE_BALANCED,
            smokehouse_recipe_policy: 0,
            apiary_accumulated_honey: 0.0,
            sidearms: 0.0,
            shields: 0.0,
            bows: 0.0,
            crossbows: 0.0,
            padded_armor: 0.0,
            mail_armor: 0.0,
            ammunition: 0.0,
        }
    }

    #[test]
    fn coffer_capacity_is_positive() {
        assert!(chapel_coffer_capacity() > 0.0);
    }

    #[test]
    fn upgraded_churches_hold_larger_coffers() {
        let mut chapel = sample_chapel(0.0);
        chapel.chapel_tier = 1;
        let timber_capacity = chapel_coffer_capacity_for(&chapel);
        chapel.chapel_tier = 3;
        assert!(chapel_coffer_capacity_for(&chapel) > timber_capacity);
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
    fn aggregate_tithe_split_assigns_only_whole_coins() {
        assert_eq!(chapel_tithe_split(17.0, 0.25), (13.0, 4.0));
        assert_eq!(chapel_tithe_split(3.9, 0.25), (3.0, 0.0));
    }

    #[test]
    fn coffer_operations_normalize_legacy_fractional_gold() {
        let mut chapel = sample_chapel(9.75);
        chapel.chapel_monastery_tithe_due = 2.4;
        assert_eq!(withdraw_coffer_in_place(&mut chapel, 2.8), 2.0);
        assert_eq!(chapel.gold, 7.0);
        assert_eq!(chapel.chapel_monastery_tithe_due, 2.0);
        assert_eq!(deposit_coffer_in_place(&mut chapel, 1.9), 1.0);
        assert_eq!(chapel.gold, 8.0);
    }
}
