use spacetimedb::ReducerContext;
use std::collections::HashSet;

use crate::balance_generated::CAVALRY_HORSE_TRAINING_DAYS;
use crate::cavalry_policy::cavalry_daily_ration;
use crate::db::*;
use crate::economy::{building_commodity_stock, withdraw_building_commodity, CommodityKind};
use crate::tables::cavalry_horse;

use super::GameClock;

/// Advances remount care and schooling one calendar day at a time. Every horse
/// physically on site consumes seasonal fodder and water; assigned hands set
/// how many untrained mounts can also gain a training day. Winter feed replaces
/// oats rather than stacking with it. A shortage pauses both care and training.
pub fn step_cavalry_yards(ctx: &ReducerContext, clock: &GameClock) {
    let total_day = clock.total_days;
    let ration = cavalry_daily_ration(clock.month);
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
                horse.last_training_day < total_day
                    && (horse.assigned_company_id == 0
                        || ctx
                            .db
                            .military_company()
                            .id()
                            .find(&horse.assigned_company_id)
                            .is_some_and(|company| company.state == 0))
            })
            .collect::<Vec<_>>();
        horses.sort_by_key(|horse| (horse.slot, horse.id));
        let training_horses = horses
            .iter()
            .filter(|horse| {
                horse.assigned_company_id == 0 && horse.training_days < CAVALRY_HORSE_TRAINING_DAYS
            })
            .take(yard.assigned_labor as usize)
            .map(|horse| horse.id)
            .collect::<HashSet<_>>();
        let mut building_changed = false;
        for mut horse in horses {
            let elapsed = total_day.saturating_sub(horse.last_training_day);
            for _ in 0..elapsed {
                let supplied = building_commodity_stock(&yard, CommodityKind::AnimalFeed) + 1e-6
                    >= ration.animal_feed
                    && building_commodity_stock(&yard, CommodityKind::OatGrain) + 1e-6
                        >= ration.oats
                    && building_commodity_stock(&yard, CommodityKind::Water) + 1e-6 >= ration.water;
                if !supplied {
                    break;
                }
                withdraw_building_commodity(
                    &mut yard,
                    CommodityKind::AnimalFeed,
                    ration.animal_feed,
                );
                withdraw_building_commodity(&mut yard, CommodityKind::OatGrain, ration.oats);
                withdraw_building_commodity(&mut yard, CommodityKind::Water, ration.water);
                if training_horses.contains(&horse.id) {
                    horse.training_days = horse
                        .training_days
                        .saturating_add(1)
                        .min(CAVALRY_HORSE_TRAINING_DAYS);
                }
                building_changed = true;
            }
            horse.last_training_day = total_day;
            ctx.db.cavalry_horse().id().update(horse);
        }
        if building_changed {
            ctx.db.building().id().update(yard);
        }
    }
}
