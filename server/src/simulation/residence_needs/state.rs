use spacetimedb::ReducerContext;

use crate::balance_generated::{RESIDENCE_CLOTH_CAPACITY, RESIDENCE_POTTERY_CAPACITY};
use crate::db::*;
use crate::economy::{residence_edible_food_stock, residence_savory_preserves_stock};
use crate::resource_units::whole_units;
use crate::simulation::residence_needs::kinds::ResidenceNeedKind;
use crate::tables::{Residence, ResidenceNeed};

pub const NEED_SOURCE_FLOWER_LUXURY: u16 = u16::MAX - 1;
pub const NEED_SOURCE_NONE: u16 = u16::MAX;

#[derive(Clone, Copy, Debug)]
pub struct NeedState {
    pub kind: ResidenceNeedKind,
    pub stock: f64,
    pub deficit_ticks: u32,
    pub source_kind: u16,
}

impl NeedState {
    pub fn initial(kind: ResidenceNeedKind) -> Self {
        Self {
            kind,
            stock: 0.0,
            deficit_ticks: 0,
            source_kind: NEED_SOURCE_NONE,
        }
    }
}

thread_local! {
    static TICK_NEED_ROWS: std::cell::RefCell<Option<CachedTickNeeds>> = const { std::cell::RefCell::new(None) };
}
struct CachedTickNeeds {
    rows: std::collections::HashMap<u64, Vec<ResidenceNeed>>,
    input_tick: u64,
    output_tick: u64,
}
pub struct TickNeedCache;
/// Read-through/write-through cache with the same lifetime as one economy
/// transaction. All need mutations below update or invalidate its rows.
pub fn cache_tick_needs(input_tick: u64, output_tick: u64) -> TickNeedCache {
    TICK_NEED_ROWS.with(|cache| *cache.borrow_mut() = Some(CachedTickNeeds { rows: Default::default(), input_tick, output_tick }));
    TickNeedCache
}
pub fn input_household_tick(ctx: &ReducerContext) -> u64 {
    TICK_NEED_ROWS.with(|cache| cache.borrow().as_ref().map(|cache| cache.input_tick))
        .unwrap_or_else(|| ctx.db.world_config().id().find(0).map_or(0, |c| c.household_tick))
}
pub fn output_household_tick(ctx: &ReducerContext) -> u64 {
    TICK_NEED_ROWS.with(|cache| cache.borrow().as_ref().map(|cache| cache.output_tick))
        .unwrap_or_else(|| ctx.db.world_config().id().find(0).map_or(0, |c| c.household_tick))
}
impl Drop for TickNeedCache {
    fn drop(&mut self) { TICK_NEED_ROWS.with(|cache| *cache.borrow_mut() = None); }
}
fn read_rows(ctx: &ReducerContext, residence_id: u64) -> Vec<ResidenceNeed> {
    TICK_NEED_ROWS.with(|cache| {
        let mut cache = cache.borrow_mut();
        match cache.as_mut() {
            Some(cache) => cache.rows.entry(residence_id).or_insert_with(|| ctx.db.residence_need().residence_id().filter(residence_id).collect()).clone(),
            None => ctx.db.residence_need().residence_id().filter(residence_id).collect(),
        }
    })
}
fn cache_written_row(row: ResidenceNeed) {
    TICK_NEED_ROWS.with(|cache| {
        if let Some(rows) = cache.borrow_mut().as_mut().and_then(|cache| cache.rows.get_mut(&row.residence_id)) {
            if let Some(previous) = rows.iter_mut().find(|previous| previous.id == row.id) { *previous = row; }
            else { rows.push(row); }
        }
    });
}

pub fn load_needs(ctx: &ReducerContext, residence_id: u64) -> Vec<NeedState> {
    let input_tick = input_household_tick(ctx);
    let mut needs: Vec<NeedState> = read_rows(ctx, residence_id).into_iter()
        .filter_map(|row| {
            ResidenceNeedKind::from_u8(row.need_kind).map(|kind| NeedState {
                kind,
                stock: whole_units(row.stock),
                deficit_ticks: crate::household_timer_policy::counter_at(row.deficit_ticks, row.deficit_tick,
                    i8::from(row.deficit_running), input_tick),
                source_kind: row.source_kind,
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
    persist_need_with_clock(ctx, residence_id, need, None, false);
}

fn persist_need_with_clock(ctx: &ReducerContext, residence_id: u64, need: &NeedState, running: Option<bool>, stepped: bool) {
    let stock = whole_units(need.stock);
    let input_tick = input_household_tick(ctx);
    let output_tick = output_household_tick(ctx);
    if let Some(existing) = find_row(ctx, residence_id, need.kind) {
        let deficit_tick = crate::household_timer_policy::write_tick(input_tick, output_tick, existing.deficit_tick, stepped);
        let deficit_running = need.deficit_ticks > 0 && running.unwrap_or(existing.deficit_running);
        let continuous = crate::household_timer_policy::retain_anchor(existing.deficit_ticks, existing.deficit_tick,
            i8::from(existing.deficit_running), deficit_tick, need.deficit_ticks, i8::from(deficit_running));
        let row = ResidenceNeed { stock, deficit_ticks: need.deficit_ticks, deficit_tick, deficit_running,
            source_kind: need.source_kind, ..existing.clone() };
        if existing.stock == stock && continuous && existing.source_kind == need.source_kind {
            // Cache the evaluated value for later work in this transaction,
            // while the database keeps the equivalent original anchor.
            cache_written_row(row); return;
        }
        ctx.db.residence_need().id().update(row.clone()); cache_written_row(row); return;
    }
    let Some(residence) = ctx.db.residence().id().find(residence_id) else { return; };
    let deficit_tick = if stepped { output_tick } else { input_tick };
    let row = ctx.db.residence_need().insert(ResidenceNeed { id: 0, owner: residence.owner, residence_id, need_kind: need.kind.as_u8(), stock,
        deficit_ticks: need.deficit_ticks, deficit_tick, deficit_running: need.deficit_ticks > 0 && running.unwrap_or(residence.population > 0),
        source_kind: need.source_kind });
    cache_written_row(row);
}

pub fn persist_needs(ctx: &ReducerContext, residence_id: u64, needs: &[NeedState]) {
    let running = ctx.db.residence().id().find(residence_id).is_some_and(|r| r.population > 0);
    for need in needs {
        persist_need_with_clock(ctx, residence_id, need, Some(running), false);
    }
}
pub fn persist_needs_running(ctx: &ReducerContext, residence_id: u64, needs: &[NeedState], running: bool) {
    for need in needs {
        persist_need_with_clock(ctx, residence_id, need, Some(running), true);
    }
}

/// Move the retired mixed-food pantry into rye bread exactly once, then keep
/// the food and savory-preserve need rows as derived read models.
pub fn migrate_and_sync_food_inventory(
    _ctx: &ReducerContext,
    residence: &mut Residence,
    needs: &mut [NeedState],
) {
    let legacy_food = whole_units(residence.food)
        + if residence.food_inventory_migrated {
            0.0
        } else {
            whole_units(need_stock(needs, ResidenceNeedKind::Food))
        };
    if legacy_food > 0.0 {
        residence.rye_bread = whole_units(residence.rye_bread) + legacy_food;
    }
    residence.food = 0.0;
    residence.food_inventory_migrated = true;
    if let Some(food_need) = find_need_mut(needs, ResidenceNeedKind::Food) {
        food_need.stock = residence_edible_food_stock(residence);
    }
    if let Some(preserved_need) = find_need_mut(needs, ResidenceNeedKind::SavoryPreserves) {
        preserved_need.stock = residence_savory_preserves_stock(residence);
    }
}

pub fn sync_food_need_rows(ctx: &ReducerContext, residence: &Residence) {
    let mut needs = load_needs(ctx, residence.id);
    if let Some(food_need) = find_need_mut(&mut needs, ResidenceNeedKind::Food) {
        food_need.stock = residence_edible_food_stock(residence);
    }
    if let Some(preserved_need) = find_need_mut(&mut needs, ResidenceNeedKind::SavoryPreserves) {
        preserved_need.stock = residence_savory_preserves_stock(residence);
    }
    persist_needs(ctx, residence.id, &needs);
}

pub fn init_needs(ctx: &ReducerContext, residence_id: u64) {
    for kind in ResidenceNeedKind::ALL {
        persist_need(ctx, residence_id, &NeedState::initial(kind));
    }
}

pub fn delete_needs(ctx: &ReducerContext, residence_id: u64) {
    TICK_NEED_ROWS.with(|cache| { if let Some(cache) = cache.borrow_mut().as_mut() { cache.rows.remove(&residence_id); } });
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
    TICK_NEED_ROWS.with(|cache| {
        let mut cache = cache.borrow_mut();
        match cache.as_mut() {
            Some(cache) => cache.rows.entry(residence_id)
                .or_insert_with(|| ctx.db.residence_need().residence_id().filter(residence_id).collect())
                .iter().find(|row| row.need_kind == kind.as_u8()).cloned(),
            None => ctx.db.residence_need().residence_id().filter(residence_id)
                .find(|row| row.need_kind == kind.as_u8()),
        }
    })
}
