use spacetimedb::ReducerContext;

use crate::balance_generated::{
    CAVALRY_HORSE_DAILY_ANIMAL_FEED, CAVALRY_HORSE_DAILY_OATS, CAVALRY_HORSE_DAILY_WATER,
    CAVALRY_HORSE_TRAINING_DAYS,
};
use crate::db::*;
use crate::economy::{building_commodity_stock, withdraw_building_commodity, CommodityKind};
use crate::tables::cavalry_horse;

use super::GameClock;

/// Advances remount schooling one calendar day at a time. Every productive
/// horse-day is physical: a groom slot plus feed, oats, and water must all be
/// present in the same Cavalry Yard. A shortage pauses training.
pub fn step_cavalry_yards(ctx: &ReducerContext, clock: &GameClock) {
    let total_day = clock.total_days;
    let yards = ctx
        .db
        .building()
        .iter()
        .filter(|building| {
            building.kind == "cavalry_yard"
                && building.construction_complete
                && building.assigned_labor > 0
                && super::building_fire_state(ctx, building.id).is_none()
        })
        .collect::<Vec<_>>();
    for mut yard in yards {
        let mut horses = ctx
            .db
            .cavalry_horse()
            .cavalry_yard_id()
            .filter(&yard.id)
            .filter(|horse| {
                horse.assigned_company_id == 0
                    && horse.training_days < CAVALRY_HORSE_TRAINING_DAYS
                    && horse.last_training_day < total_day
            })
            .collect::<Vec<_>>();
        horses.sort_by_key(|horse| (horse.slot, horse.id));
        let daily_capacity = yard.assigned_labor.min(horses.len() as u32) as usize;
        let mut building_changed = false;
        for mut horse in horses.into_iter().take(daily_capacity) {
            let elapsed = total_day.saturating_sub(horse.last_training_day);
            for _ in 0..elapsed {
                let supplied = building_commodity_stock(&yard, CommodityKind::AnimalFeed) + 1e-6
                    >= CAVALRY_HORSE_DAILY_ANIMAL_FEED
                    && building_commodity_stock(&yard, CommodityKind::OatGrain) + 1e-6
                        >= CAVALRY_HORSE_DAILY_OATS
                    && building_commodity_stock(&yard, CommodityKind::Water) + 1e-6
                        >= CAVALRY_HORSE_DAILY_WATER;
                if !supplied {
                    break;
                }
                withdraw_building_commodity(
                    &mut yard,
                    CommodityKind::AnimalFeed,
                    CAVALRY_HORSE_DAILY_ANIMAL_FEED,
                );
                withdraw_building_commodity(
                    &mut yard,
                    CommodityKind::OatGrain,
                    CAVALRY_HORSE_DAILY_OATS,
                );
                withdraw_building_commodity(
                    &mut yard,
                    CommodityKind::Water,
                    CAVALRY_HORSE_DAILY_WATER,
                );
                horse.training_days = horse
                    .training_days
                    .saturating_add(1)
                    .min(CAVALRY_HORSE_TRAINING_DAYS);
                building_changed = true;
                if horse.training_days >= CAVALRY_HORSE_TRAINING_DAYS {
                    break;
                }
            }
            horse.last_training_day = total_day;
            ctx.db.cavalry_horse().id().update(horse);
        }
        if building_changed {
            ctx.db.building().id().update(yard);
        }
    }
}
