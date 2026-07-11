use spacetimedb::ReducerContext;

use crate::building_defs::building_def;
use crate::constants::{RESIDENCE_FOOD_CAPACITY, RESIDENCE_FIREWOOD_CAPACITY, RESIDENCE_WATER_CAPACITY};
use crate::db::*;
use crate::tables::Building;

#[derive(Clone, Copy, Debug, Default)]
pub struct StorageCaps {
    pub timber: f64,
    pub firewood: f64,
    pub stone: f64,
    pub food: f64,
}

pub fn building_storage_caps(kind: &str) -> StorageCaps {
    let Some(def) = building_def(kind) else {
        return StorageCaps::default();
    };
    StorageCaps {
        timber: def.storage_timber,
        firewood: def.storage_firewood,
        stone: def.storage_stone,
        food: def.storage_food,
    }
}

pub fn residence_firewood_capacity() -> f64 {
    RESIDENCE_FIREWOOD_CAPACITY
}

pub fn residence_water_capacity() -> f64 {
    RESIDENCE_WATER_CAPACITY
}

pub fn residence_food_capacity() -> f64 {
    RESIDENCE_FOOD_CAPACITY
}

pub fn total_timber(ctx: &ReducerContext, owner: spacetimedb::Identity) -> f64 {
    treasury_timber(ctx, owner)
        + building_sum(ctx, owner, |building| building.timber)
}

pub fn total_stone(ctx: &ReducerContext, owner: spacetimedb::Identity) -> f64 {
    treasury_stone(ctx, owner) + building_sum(ctx, owner, |building| building.stone)
}

pub fn total_firewood(ctx: &ReducerContext, owner: spacetimedb::Identity) -> f64 {
    treasury_firewood(ctx, owner)
        + building_sum(ctx, owner, |building| building.firewood)
        + residence_need_sum(ctx, owner, 0)
}

pub fn total_food(ctx: &ReducerContext, owner: spacetimedb::Identity) -> f64 {
    treasury_food(ctx, owner)
        + building_sum(ctx, owner, |building| building.food)
        + residence_need_sum(ctx, owner, 2)
}

pub fn deposit_building(
    building: &Building,
    caps: StorageCaps,
    timber: f64,
    firewood: f64,
    stone: f64,
) -> (f64, f64, f64, Building) {
    let mut next = building.clone();
    let timber_room = (caps.timber - next.timber).max(0.0);
    let firewood_room = (caps.firewood - next.firewood).max(0.0);
    let stone_room = (caps.stone - next.stone).max(0.0);
    let timber_deposited = timber.min(timber_room);
    let firewood_deposited = firewood.min(firewood_room);
    let stone_deposited = stone.min(stone_room);
    next.timber += timber_deposited;
    next.firewood += firewood_deposited;
    next.stone += stone_deposited;
    (timber_deposited, firewood_deposited, stone_deposited, next)
}

pub fn deposit_building_food(building: &Building, cap: f64, amount: f64) -> (f64, Building) {
    let mut next = building.clone();
    let room = (cap - next.food).max(0.0);
    let deposited = amount.min(room);
    next.food += deposited;
    (deposited, next)
}

pub fn withdraw_building_food(building: &Building, amount: f64) -> (f64, Building) {
    let mut next = building.clone();
    let withdrawn = amount.min(next.food);
    next.food -= withdrawn;
    (withdrawn, next)
}

pub fn withdraw_building(building: &Building, timber: f64, firewood: f64, stone: f64) -> (f64, f64, f64, Building) {
    let mut next = building.clone();
    let timber_withdrawn = timber.min(next.timber);
    let firewood_withdrawn = firewood.min(next.firewood);
    let stone_withdrawn = stone.min(next.stone);
    next.timber -= timber_withdrawn;
    next.firewood -= firewood_withdrawn;
    next.stone -= stone_withdrawn;
    (timber_withdrawn, firewood_withdrawn, stone_withdrawn, next)
}

pub fn deposit_building_water(building: &Building, cap: f64, amount: f64) -> (f64, Building) {
    let mut next = building.clone();
    let room = (cap - next.water).max(0.0);
    let deposited = amount.min(room);
    next.water += deposited;
    (deposited, next)
}

pub fn withdraw_building_water(building: &Building, amount: f64) -> (f64, Building) {
    let mut next = building.clone();
    let withdrawn = amount.min(next.water);
    next.water -= withdrawn;
    (withdrawn, next)
}

pub fn building_water_storage_cap(kind: &str) -> f64 {
    building_def(kind).map(|def| def.storage_water).unwrap_or(0.0)
}

pub fn building_food_storage_cap(kind: &str) -> f64 {
    building_def(kind).map(|def| def.storage_food).unwrap_or(0.0)
}

pub fn credit_treasury_timber(ctx: &ReducerContext, owner: spacetimedb::Identity, amount: f64) {
    if amount <= 0.0 {
        return;
    }
    if let Some(mut treasury) = ctx.db.player_resources().owner().find(&owner) {
        treasury.timber += amount;
        ctx.db.player_resources().owner().update(treasury);
    }
}

pub fn credit_treasury_stone(ctx: &ReducerContext, owner: spacetimedb::Identity, amount: f64) {
    if amount <= 0.0 {
        return;
    }
    if let Some(mut treasury) = ctx.db.player_resources().owner().find(&owner) {
        treasury.stone += amount;
        ctx.db.player_resources().owner().update(treasury);
    }
}

pub fn credit_treasury_firewood(ctx: &ReducerContext, owner: spacetimedb::Identity, amount: f64) {
    if amount <= 0.0 {
        return;
    }
    if let Some(mut treasury) = ctx.db.player_resources().owner().find(&owner) {
        treasury.firewood += amount;
        ctx.db.player_resources().owner().update(treasury);
    }
}

pub fn credit_treasury_water(ctx: &ReducerContext, owner: spacetimedb::Identity, amount: f64) {
    if amount <= 0.0 {
        return;
    }
    if let Some(mut treasury) = ctx.db.player_resources().owner().find(&owner) {
        treasury.water += amount;
        ctx.db.player_resources().owner().update(treasury);
    }
}

pub fn credit_treasury_food(ctx: &ReducerContext, owner: spacetimedb::Identity, amount: f64) {
    if amount <= 0.0 {
        return;
    }
    if let Some(mut treasury) = ctx.db.player_resources().owner().find(&owner) {
        treasury.food += amount;
        ctx.db.player_resources().owner().update(treasury);
    }
}

pub fn credit_treasury_gold(ctx: &ReducerContext, owner: spacetimedb::Identity, amount: f64) {
    if amount <= 0.0 {
        return;
    }
    if let Some(mut treasury) = ctx.db.player_resources().owner().find(&owner) {
        treasury.gold += amount;
        ctx.db.player_resources().owner().update(treasury);
    }
}

pub fn spend_treasury_gold(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    amount: f64,
) -> Result<(), String> {
    if amount <= 0.0 {
        return Ok(());
    }
    let Some(mut treasury) = ctx.db.player_resources().owner().find(&owner) else {
        return Err("Not enough gold.".to_string());
    };
    if treasury.gold + 1e-6 < amount {
        return Err(format!(
            "Not enough gold (need {} more).",
            (amount - treasury.gold).round() as i64
        ));
    }
    treasury.gold -= amount;
    ctx.db.player_resources().owner().update(treasury);
    Ok(())
}

fn treasury_timber(ctx: &ReducerContext, owner: spacetimedb::Identity) -> f64 {
    ctx.db
        .player_resources()
        .owner()
        .find(&owner)
        .map(|row| row.timber)
        .unwrap_or(0.0)
}

fn treasury_stone(ctx: &ReducerContext, owner: spacetimedb::Identity) -> f64 {
    ctx.db
        .player_resources()
        .owner()
        .find(&owner)
        .map(|row| row.stone)
        .unwrap_or(0.0)
}

fn treasury_firewood(ctx: &ReducerContext, owner: spacetimedb::Identity) -> f64 {
    ctx.db
        .player_resources()
        .owner()
        .find(&owner)
        .map(|row| row.firewood)
        .unwrap_or(0.0)
}

fn treasury_food(ctx: &ReducerContext, owner: spacetimedb::Identity) -> f64 {
    ctx.db
        .player_resources()
        .owner()
        .find(&owner)
        .map(|row| row.food)
        .unwrap_or(0.0)
}

fn residence_need_sum(ctx: &ReducerContext, owner: spacetimedb::Identity, need_kind: u8) -> f64 {
    let mut total = 0.0;
    for residence in ctx.db.residence().owner().filter(&owner) {
        for need in ctx.db.residence_need().residence_id().filter(&residence.id) {
            if need.need_kind == need_kind {
                total += need.stock;
            }
        }
    }
    total
}

fn building_sum<F>(ctx: &ReducerContext, owner: spacetimedb::Identity, pick: F) -> f64
where
    F: Fn(&Building) -> f64,
{
    ctx.db
        .building()
        .owner()
        .filter(&owner)
        .map(|building| pick(&building))
        .sum()
}
