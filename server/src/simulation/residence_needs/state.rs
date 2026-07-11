use spacetimedb::ReducerContext;

use crate::db::*;
use crate::simulation::residence_needs::kinds::ResidenceNeedKind;
use crate::tables::ResidenceNeed;

#[derive(Clone, Copy, Debug)]
pub struct NeedState {
    pub kind: ResidenceNeedKind,
    pub stock: f64,
    pub deficit_ticks: u32,
}

impl NeedState {
    pub fn initial(kind: ResidenceNeedKind) -> Self {
        Self {
            kind,
            stock: 0.0,
            deficit_ticks: 0,
        }
    }
}

pub fn load_needs(ctx: &ReducerContext, residence_id: u64) -> Vec<NeedState> {
    let mut needs: Vec<NeedState> = ctx
        .db
        .residence_need()
        .residence_id()
        .filter(&residence_id)
        .filter_map(|row| {
            ResidenceNeedKind::from_u8(row.need_kind).map(|kind| NeedState {
                kind,
                stock: row.stock,
                deficit_ticks: row.deficit_ticks,
            })
        })
        .collect();

    for kind in ResidenceNeedKind::ALL {
        if !needs.iter().any(|need| need.kind == kind) {
            needs.push(NeedState::initial(kind));
        }
    }

    needs.sort_by_key(|need| need.kind.as_u8());
    needs
}

pub fn persist_need(ctx: &ReducerContext, residence_id: u64, need: &NeedState) {
    if let Some(existing) = find_row(ctx, residence_id, need.kind) {
        ctx.db.residence_need().id().update(ResidenceNeed {
            stock: need.stock,
            deficit_ticks: need.deficit_ticks,
            ..existing
        });
        return;
    }

    ctx.db.residence_need().insert(ResidenceNeed {
        id: 0,
        residence_id,
        need_kind: need.kind.as_u8(),
        stock: need.stock,
        deficit_ticks: need.deficit_ticks,
    });
}

pub fn persist_needs(ctx: &ReducerContext, residence_id: u64, needs: &[NeedState]) {
    for need in needs {
        persist_need(ctx, residence_id, need);
    }
}

pub fn init_needs(ctx: &ReducerContext, residence_id: u64) {
    for kind in ResidenceNeedKind::ALL {
        persist_need(ctx, residence_id, &NeedState::initial(kind));
    }
}

pub fn delete_needs(ctx: &ReducerContext, residence_id: u64) {
    let rows: Vec<ResidenceNeed> = ctx
        .db
        .residence_need()
        .residence_id()
        .filter(&residence_id)
        .collect();
    for row in rows {
        ctx.db.residence_need().id().delete(row.id);
    }
}

pub fn need_stock(needs: &[NeedState], kind: ResidenceNeedKind) -> f64 {
    find_need(needs, kind).map(|need| need.stock).unwrap_or(0.0)
}

pub fn find_need<'a>(needs: &'a [NeedState], kind: ResidenceNeedKind) -> Option<&'a NeedState> {
    needs.iter().find(|need| need.kind == kind)
}

pub fn find_need_mut<'a>(
    needs: &'a mut [NeedState],
    kind: ResidenceNeedKind,
) -> Option<&'a mut NeedState> {
    needs.iter_mut().find(|need| need.kind == kind)
}

pub fn max_deficit_ticks(needs: &[NeedState]) -> u32 {
    needs
        .iter()
        .map(|need| need.deficit_ticks)
        .max()
        .unwrap_or(0)
}

fn find_row(
    ctx: &ReducerContext,
    residence_id: u64,
    kind: ResidenceNeedKind,
) -> Option<ResidenceNeed> {
    ctx.db
        .residence_need()
        .residence_id()
        .filter(&residence_id)
        .find(|row| row.need_kind == kind.as_u8())
}
