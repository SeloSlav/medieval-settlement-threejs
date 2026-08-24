use spacetimedb::ReducerContext;

use crate::balance_generated::{RESIDENCE_CLOTH_CAPACITY, RESIDENCE_POTTERY_CAPACITY};
use crate::db::*;
use crate::economy::{residence_edible_food_stock, residence_preserved_food_stock};
use crate::resource_units::whole_units;
use crate::simulation::residence_needs::kinds::ResidenceNeedKind;
use crate::tables::{Residence, ResidenceNeed};

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
                stock: whole_units(row.stock),
                deficit_ticks: row.deficit_ticks,
            })
        })
        .collect();

    let missing_cloth = !needs
        .iter()
        .any(|need| need.kind == ResidenceNeedKind::Cloth);
    let missing_pottery = !needs
        .iter()
        .any(|need| need.kind == ResidenceNeedKind::Pottery);
    let missing_progression_rows = !needs
        .iter()
        .any(|need| need.kind == ResidenceNeedKind::Church)
        || !needs
            .iter()
            .any(|need| need.kind == ResidenceNeedKind::FoodVariety);
    let legacy_tier = if missing_cloth || missing_pottery || missing_progression_rows {
        ctx.db
            .residence()
            .id()
            .find(&residence_id)
            .map(|residence| residence.tier)
            .unwrap_or(1)
    } else {
        1
    };
    if missing_progression_rows && legacy_tier >= 2 {
        if let Some(cloth) = needs
            .iter_mut()
            .find(|need| need.kind == ResidenceNeedKind::Cloth)
        {
            cloth.stock = cloth.stock.max(RESIDENCE_CLOTH_CAPACITY);
        }
    }
    for kind in ResidenceNeedKind::ALL {
        if !needs.iter().any(|need| need.kind == kind) {
            let mut initial = NeedState::initial(kind);
            // Established tier-2+ homes from before textiles became a level-2
            // transition buffer. New residences already have a zero-stock
            // cloth row, so this does not create free exportable production.
            if kind == ResidenceNeedKind::Cloth && legacy_tier >= 2 {
                initial.stock = RESIDENCE_CLOTH_CAPACITY;
            }
            // Established prosperous homes receive one transition cupboard of
            // wares. New homes already have a zero-stock row and must be
            // supplied by a real potter.
            if kind == ResidenceNeedKind::Pottery && legacy_tier >= 4 {
                initial.stock = RESIDENCE_POTTERY_CAPACITY;
            }
            needs.push(initial);
        }
    }

    needs.sort_by_key(|need| need.kind.as_u8());
    needs
}

pub fn persist_need(ctx: &ReducerContext, residence_id: u64, need: &NeedState) {
    let stock = whole_units(need.stock);
    if let Some(existing) = find_row(ctx, residence_id, need.kind) {
        ctx.db.residence_need().id().update(ResidenceNeed {
            stock,
            deficit_ticks: need.deficit_ticks,
            ..existing
        });
        return;
    }

    ctx.db.residence_need().insert(ResidenceNeed {
        id: 0,
        residence_id,
        need_kind: need.kind.as_u8(),
        stock,
        deficit_ticks: need.deficit_ticks,
    });
}

pub fn persist_needs(ctx: &ReducerContext, residence_id: u64, needs: &[NeedState]) {
    for need in needs {
        persist_need(ctx, residence_id, need);
    }
}

/// Move old pantry values out of need rows exactly once, then make the Food
/// and PreservedFood rows derived read models over physical commodities.
pub fn migrate_and_sync_food_inventory(
    _ctx: &ReducerContext,
    residence: &mut Residence,
    needs: &mut [NeedState],
) {
    if !residence.food_inventory_migrated {
        residence.food = whole_units(residence.food)
            + whole_units(need_stock(needs, ResidenceNeedKind::Food));
        residence.preserved_food = whole_units(residence.preserved_food)
            + whole_units(need_stock(needs, ResidenceNeedKind::PreservedFood));
        residence.food_inventory_migrated = true;
    }
    if let Some(food_need) = find_need_mut(needs, ResidenceNeedKind::Food) {
        food_need.stock = residence_edible_food_stock(residence);
    }
    if let Some(preserved_need) = find_need_mut(needs, ResidenceNeedKind::PreservedFood) {
        preserved_need.stock = residence_preserved_food_stock(residence);
    }
}

pub fn sync_food_need_rows(ctx: &ReducerContext, residence: &Residence) {
    let mut needs = load_needs(ctx, residence.id);
    if let Some(food_need) = find_need_mut(&mut needs, ResidenceNeedKind::Food) {
        food_need.stock = residence_edible_food_stock(residence);
    }
    if let Some(preserved_need) = find_need_mut(&mut needs, ResidenceNeedKind::PreservedFood) {
        preserved_need.stock = residence_preserved_food_stock(residence);
    }
    persist_needs(ctx, residence.id, &needs);
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
