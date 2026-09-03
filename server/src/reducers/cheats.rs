use spacetimedb::{reducer, ReducerContext};

use crate::db::*;
use crate::balance_generated::{
    CALENDAR_DAYS_PER_MONTH, CALENDAR_DAY_START_OFFSET_SECONDS, CALENDAR_MONTHS_PER_YEAR,
    CALENDAR_SECONDS_PER_DAY, CALENDAR_START_MONTH, TICK_DT,
};
use crate::economy::{building_commodity_stock, CommodityKind, ALL_COMMODITIES};
use crate::lifecycle::ensure_player_resources;
use crate::raid_agent_policy::playable_half_for_map_size;
use crate::reducers::bandits::deploy_debug_military_company;
use crate::simulation::{
    materialize_physical_resource_stock, spawn_debug_bandit_camp, spawn_debug_wild_animals,
    start_debug_live_raid, ReclamationStock,
};
use crate::tables::PlayerResources;

const MAX_CHEAT_RESOURCE_AMOUNT: f64 = 1_000_000_000.0;

fn validated_cheat_amount(amount: f64) -> Result<f64, String> {
    if !amount.is_finite() || amount < 1.0 {
        return Err("Cheat resource amount must be a finite number of at least 1.".to_string());
    }
    Ok(amount.min(MAX_CHEAT_RESOURCE_AMOUNT).floor())
}

fn missing_balance(in_ledger: f64, on_map: f64, target: f64) -> f64 {
    (target - in_ledger.max(0.0) - on_map.max(0.0)).max(0.0)
}

fn physical_resource_stock(ctx: &ReducerContext, owner: spacetimedb::Identity) -> ReclamationStock {
    let mut stock = ReclamationStock::default();
    for building in ctx.db.building().owner().filter(&owner) {
        for commodity in ALL_COMMODITIES.iter().copied() {
            let amount = if commodity == CommodityKind::Gold
                && !matches!(
                    building.kind.as_str(),
                    "founders_camp" | "salvage_pile" | "town_hall"
                ) {
                0.0
            } else {
                building_commodity_stock(&building, commodity).max(0.0)
            };
            stock = stock.merged(ReclamationStock::from_commodity(commodity, amount));
        }
    }
    stock
}

fn cheat_top_up_stock(
    in_ledger: ReclamationStock,
    on_map: ReclamationStock,
    target: f64,
) -> ReclamationStock {
    ALL_COMMODITIES
        .iter()
        .copied()
        .fold(ReclamationStock::default(), |stock, commodity| {
            stock.merged(ReclamationStock::from_commodity(
                commodity,
                missing_balance(
                    in_ledger.amount(commodity),
                    on_map.amount(commodity),
                    target,
                ),
            ))
        })
}

/// Legacy abstract-resource saves do not have physical holders for manure,
/// remedies, or prepared feed. Every other canonical commodity still has a
/// treasury slot, and this exhaustive match makes a new enum variant a compile
/// error here until the cheat path deliberately handles it.
fn resource_ledger_slot(
    resources: &mut PlayerResources,
    commodity: CommodityKind,
) -> Option<&mut f64> {
    match commodity {
        CommodityKind::Firewood => Some(&mut resources.firewood),
        CommodityKind::Water => Some(&mut resources.water),
        CommodityKind::Timber => Some(&mut resources.timber),
        CommodityKind::Ale => Some(&mut resources.ale),
        CommodityKind::Honey => Some(&mut resources.honey),
        CommodityKind::Wine => Some(&mut resources.wine),
        CommodityKind::Stone => Some(&mut resources.stone),
        CommodityKind::Ironwork => Some(&mut resources.ironwork),
        CommodityKind::Polearms => Some(&mut resources.polearms),
        CommodityKind::Wool => Some(&mut resources.wool),
        CommodityKind::Cloth => Some(&mut resources.cloth),
        CommodityKind::Gold => Some(&mut resources.gold),
        CommodityKind::Barley => Some(&mut resources.barley),
        CommodityKind::Malt => Some(&mut resources.malt),
        CommodityKind::Flax => Some(&mut resources.flax),
        CommodityKind::Iron => Some(&mut resources.iron),
        CommodityKind::Clay => Some(&mut resources.clay),
        CommodityKind::Salt => Some(&mut resources.salt),
        CommodityKind::Charcoal => Some(&mut resources.charcoal),
        CommodityKind::Pottery => Some(&mut resources.pottery),
        CommodityKind::Manure => None,
        CommodityKind::Remedies => None,
        CommodityKind::RoofTiles => Some(&mut resources.roof_tiles),
        CommodityKind::Meat => Some(&mut resources.meat),
        CommodityKind::Fish => Some(&mut resources.fish),
        CommodityKind::Berries => Some(&mut resources.berries),
        CommodityKind::Mushrooms => Some(&mut resources.mushrooms),
        CommodityKind::Milk => Some(&mut resources.milk),
        CommodityKind::Apples => Some(&mut resources.apples),
        CommodityKind::Cherries => Some(&mut resources.cherries),
        CommodityKind::Eggs => Some(&mut resources.eggs),
        CommodityKind::Grapes => Some(&mut resources.grapes),
        CommodityKind::CuredMeat => Some(&mut resources.cured_meat),
        CommodityKind::SmokedFish => Some(&mut resources.smoked_fish),
        CommodityKind::Cheese => Some(&mut resources.cheese),
        CommodityKind::RyeSheaves => Some(&mut resources.rye_sheaves),
        CommodityKind::OatSheaves => Some(&mut resources.oat_sheaves),
        CommodityKind::BarleySheaves => Some(&mut resources.barley_sheaves),
        CommodityKind::MaslinSheaves => Some(&mut resources.maslin_sheaves),
        CommodityKind::RyeGrain => Some(&mut resources.rye_grain),
        CommodityKind::OatGrain => Some(&mut resources.oat_grain),
        CommodityKind::MaslinGrain => Some(&mut resources.maslin_grain),
        CommodityKind::RyeFlour => Some(&mut resources.rye_flour),
        CommodityKind::MaslinFlour => Some(&mut resources.maslin_flour),
        CommodityKind::RyeBread => Some(&mut resources.rye_bread),
        CommodityKind::MaslinBread => Some(&mut resources.maslin_bread),
        CommodityKind::Cider => Some(&mut resources.cider),
        CommodityKind::Mead => Some(&mut resources.mead),
        CommodityKind::Hides => Some(&mut resources.hides),
        CommodityKind::Leather => Some(&mut resources.leather),
        CommodityKind::Shoes => Some(&mut resources.shoes),
        CommodityKind::Pears => Some(&mut resources.pears),
        CommodityKind::Aronia => Some(&mut resources.aronia),
        CommodityKind::Rosehips => Some(&mut resources.rosehips),
        CommodityKind::Cabbage => Some(&mut resources.cabbage),
        CommodityKind::Carrots => Some(&mut resources.carrots),
        CommodityKind::Beetroot => Some(&mut resources.beetroot),
        CommodityKind::AroniaJam => Some(&mut resources.aronia_jam),
        CommodityKind::RosehipJam => Some(&mut resources.rosehip_jam),
        CommodityKind::PearCider => Some(&mut resources.pear_cider),
        CommodityKind::AnimalFeed => None,
        CommodityKind::Wax => Some(&mut resources.wax),
        CommodityKind::Candles => Some(&mut resources.candles),
        CommodityKind::Pelts => Some(&mut resources.pelts),
        CommodityKind::Yarn => Some(&mut resources.yarn),
        CommodityKind::Linen => Some(&mut resources.linen),
        CommodityKind::Sidearms => Some(&mut resources.sidearms),
        CommodityKind::Shields => Some(&mut resources.shields),
        CommodityKind::Bows => Some(&mut resources.bows),
        CommodityKind::Crossbows => Some(&mut resources.crossbows),
        CommodityKind::PaddedArmor => Some(&mut resources.padded_armor),
        CommodityKind::MailArmor => Some(&mut resources.mail_armor),
        CommodityKind::Ammunition => Some(&mut resources.ammunition),
    }
}

/// Tops every treasury resource up to the requested amount for sandbox building.
/// Existing resources are never removed, so this can safely be used again later.
#[reducer]
pub fn grant_cheat_resources(ctx: &ReducerContext, amount: f64) -> Result<(), String> {
    let amount = validated_cheat_amount(amount)?;
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);

    let Some(mut resources) = ctx.db.player_resources().owner().find(&owner) else {
        return Err("Player resources not found.".to_string());
    };

    if resources.physical_founding_site_enabled {
        let additional_stock = cheat_top_up_stock(
            ReclamationStock::from_resource_ledger(&resources),
            physical_resource_stock(ctx, owner),
            amount,
        );
        if !materialize_physical_resource_stock(ctx, owner, additional_stock)? {
            return Err("Could not place cheat resources in physical storage.".to_string());
        }
    } else {
        for commodity in ALL_COMMODITIES.iter().copied() {
            if let Some(slot) = resource_ledger_slot(&mut resources, commodity) {
                *slot = (*slot).max(amount);
            }
        }
        ctx.db.player_resources().owner().update(resources);
    }
    Ok(())
}

fn debug_date_sim_tick(
    current_sim_tick: u64,
    year: u32,
    month: u32,
    month_day: u32,
) -> Result<u64, String> {
    if !(1..=9_999).contains(&year) {
        return Err("Debug year must be from 1 to 9,999.".into());
    }
    if !(1..=CALENDAR_MONTHS_PER_YEAR).contains(&month) {
        return Err(format!(
            "Debug month must be from 1 to {CALENDAR_MONTHS_PER_YEAR}."
        ));
    }
    if !(1..=CALENDAR_DAYS_PER_MONTH).contains(&month_day) {
        return Err(format!(
            "Debug day must be from 1 to {CALENDAR_DAYS_PER_MONTH}."
        ));
    }
    let days_per_year = u64::from(CALENDAR_DAYS_PER_MONTH * CALENDAR_MONTHS_PER_YEAR);
    let start_day = u64::from(
        CALENDAR_START_MONTH.saturating_sub(1) * CALENDAR_DAYS_PER_MONTH,
    );
    let requested_day = u64::from(year - 1)
        .saturating_mul(days_per_year)
        .saturating_add(u64::from((month - 1) * CALENDAR_DAYS_PER_MONTH + month_day - 1));
    if requested_day < start_day {
        return Err(format!(
            "The playable calendar begins on 1/{CALENDAR_START_MONTH}/1."
        ));
    }
    let current_calendar_seconds = current_sim_tick as f64 * TICK_DT
        + CALENDAR_DAY_START_OFFSET_SECONDS;
    let seconds_into_day = current_calendar_seconds.rem_euclid(CALENDAR_SECONDS_PER_DAY);
    let requested_total_days = requested_day - start_day;
    let requested_elapsed_seconds = requested_total_days as f64 * CALENDAR_SECONDS_PER_DAY
        + seconds_into_day
        - CALENDAR_DAY_START_OFFSET_SECONDS;
    if requested_elapsed_seconds < 0.0 {
        return Err("That opening-date time is earlier than the playable calendar start.".into());
    }
    Ok((requested_elapsed_seconds / TICK_DT).round().max(0.0) as u64)
}

/// Replaces only the rational-calendar date. The current displayed time of
/// day is retained to make seasonal and holiday testing predictable.
#[reducer]
pub fn set_debug_date(
    ctx: &ReducerContext,
    year: u32,
    month: u32,
    month_day: u32,
) -> Result<(), String> {
    let Some(mut config) = ctx.db.world_config().id().find(&0) else {
        return Err("World configuration not found.".into());
    };
    config.sim_tick = debug_date_sim_tick(config.sim_tick, year, month, month_day)?;
    ctx.db.world_config().id().update(config);
    Ok(())
}

/// Runs one of the authoritative click-placement playtest actions.
/// 0 wildlife, 1 bandit camp, 2 Ottoman raid, 3 player company.
#[reducer]
pub fn run_debug_map_action(
    ctx: &ReducerContext,
    action: u8,
    x: f64,
    z: f64,
    company_kind: u8,
) -> Result<(), String> {
    if !x.is_finite() || !z.is_finite() {
        return Err("Debug placement must be a finite map position.".into());
    }
    let Some(mut config) = ctx.db.world_config().id().find(&0) else {
        return Err("World configuration not found.".into());
    };
    let playable_half = playable_half_for_map_size(config.map_size);
    if x.abs() > playable_half || z.abs() > playable_half {
        return Err("Debug placement is outside the playable map.".into());
    }
    let owner = ctx.sender();
    let tick = config.sim_tick;
    let seed = config.seed;
    let map_size = config.map_size;
    match action {
        0 => {
            config.wild_animal_attacks_enabled = true;
            ctx.db.world_config().id().update(config);
            spawn_debug_wild_animals(ctx, owner, tick, x, z)?;
        }
        1 => {
            config.bandit_camps_enabled = true;
            ctx.db.world_config().id().update(config);
            spawn_debug_bandit_camp(ctx, owner, tick, x, z);
        }
        2 => {
            config.conflict_enabled = true;
            config.enemy_pressure = config.enemy_pressure.max(65);
            ctx.db.world_config().id().update(config);
            start_debug_live_raid(
                ctx,
                owner,
                tick,
                seed,
                map_size,
                x,
                z,
            )?;
        }
        3 => {
            deploy_debug_military_company(ctx, owner, company_kind, x, z)?;
        }
        _ => return Err("Unknown debug map action.".into()),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_and_caps_cheat_resource_amounts() {
        assert_eq!(validated_cheat_amount(125_000.9).unwrap(), 125_000.0);
        assert_eq!(
            validated_cheat_amount(MAX_CHEAT_RESOURCE_AMOUNT * 2.0).unwrap(),
            MAX_CHEAT_RESOURCE_AMOUNT,
        );
        assert!(validated_cheat_amount(0.0).is_err());
        assert!(validated_cheat_amount(f64::NAN).is_err());
    }

    #[test]
    fn physical_cheat_top_up_only_grants_the_missing_balance() {
        assert_eq!(missing_balance(0.0, 70.0, 100.0), 30.0);
        assert_eq!(missing_balance(0.0, 100.0, 100.0), 0.0);
        assert_eq!(missing_balance(12.0, 80.0, 100.0), 8.0);
    }

    #[test]
    fn physical_cheat_top_up_includes_every_canonical_commodity() {
        let target = 250.0;
        let top_up = cheat_top_up_stock(
            ReclamationStock::default(),
            ReclamationStock::default(),
            target,
        );
        for commodity in ALL_COMMODITIES.iter().copied() {
            assert_eq!(
                top_up.amount(commodity),
                target,
                "cheat top-up omitted {commodity:?}",
            );
        }
    }

    #[test]
    fn debug_date_replaces_date_but_preserves_time_of_day() {
        let current = debug_date_sim_tick(0, 2, 7, 14).unwrap();
        let clock = crate::simulation::game_clock(current);
        assert_eq!((clock.year, clock.month, clock.month_day), (2, 7, 14));
        assert_eq!((clock.hour, clock.minute), (8, 0));

        let midday_tick = (CALENDAR_SECONDS_PER_DAY * 0.25 / TICK_DT).round() as u64;
        let moved = debug_date_sim_tick(midday_tick, 3, 12, 30).unwrap();
        let moved_clock = crate::simulation::game_clock(moved);
        let original_clock = crate::simulation::game_clock(midday_tick);
        assert_eq!((moved_clock.hour, moved_clock.minute), (original_clock.hour, original_clock.minute));
    }
}
