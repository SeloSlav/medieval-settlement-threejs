use spacetimedb::ReducerContext;

use crate::db::*;
use crate::reducers::livestock::SPECIES_HORSE;
use crate::tables::{cavalry_horse, CavalryHorse, Pasture};

/// Keeps the aggregate pasture ledger aligned with the individually tracked
/// horses. `head_count` reserves every owned horse's home capacity even while
/// it is campaigning; `present_head_count` drives only physical pasture care.
pub(crate) fn sync_horse_pasture_herd(ctx: &ReducerContext, pasture_id: u64) {
    if pasture_id == 0 {
        return;
    }
    let horses = ctx
        .db
        .cavalry_horse()
        .pasture_id()
        .filter(&pasture_id)
        .collect::<Vec<_>>();
    let Some(mut herd) = ctx.db.pasture_herd().pasture_id().find(&pasture_id) else {
        return;
    };
    if herd.species != SPECIES_HORSE {
        return;
    }
    herd.head_count = horses.len().min(u32::MAX as usize) as u32;
    herd.present_head_count = horses
        .iter()
        .filter(|horse| horse.at_pasture)
        .count()
        .min(u32::MAX as usize) as u32;
    herd.supplied_capacity = herd
        .supplied_capacity
        .min(f64::from(herd.present_head_count));
    ctx.db.pasture_herd().pasture_id().update(herd);
}

pub(crate) fn set_horse_at_pasture(
    ctx: &ReducerContext,
    mut horse: CavalryHorse,
    at_pasture: bool,
) -> CavalryHorse {
    horse.at_pasture = at_pasture;
    let pasture_id = horse.pasture_id;
    ctx.db.cavalry_horse().id().update(horse.clone());
    sync_horse_pasture_herd(ctx, pasture_id);
    horse
}

pub(crate) fn pasture_center(pasture: &Pasture) -> (f64, f64) {
    (
        (pasture.corner_ax + pasture.corner_bx + pasture.corner_cx + pasture.corner_dx) * 0.25,
        (pasture.corner_az + pasture.corner_bz + pasture.corner_cz + pasture.corner_dz) * 0.25,
    )
}
