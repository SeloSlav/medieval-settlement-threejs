use spacetimedb::{reducer, ReducerContext};

use crate::db::*;

#[reducer]
pub fn marketplace_trade(
    ctx: &ReducerContext,
    building_id: u64,
    trade_id: String,
) -> Result<(), String> {
    let owner = ctx.sender();

    let building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Trading Post not found.".to_string())?;

    if building.owner != owner {
        return Err("You do not own this Trading Post.".to_string());
    }

    if building.kind != "trading_post" {
        return Err("Only Trading Posts can broker regional trade.".to_string());
    }

    let _ = trade_id;
    Err("Immediate regional trade has been retired. Set this commodity's monthly Import or Export rule at the Trading Post instead.".to_string())
}

#[reducer]
pub fn cancel_marketplace_trade_order(
    ctx: &ReducerContext,
    building_id: u64,
) -> Result<(), String> {
    let owner = ctx.sender();
    let mut building = ctx
        .db
        .building()
        .id()
        .find(&building_id)
        .ok_or_else(|| "Trading Post not found.".to_string())?;

    if building.owner != owner {
        return Err("You do not own this Trading Post.".to_string());
    }
    if building.kind != "trading_post" {
        return Err("Only Trading Posts can hold bulk trade orders.".to_string());
    }
    if building.marketplace_pending_trade_code == 0 {
        return Err("This Trading Post has no pending bulk trade order.".to_string());
    }

    // Cargo already withdrawn into a delivery trip remains physical and will
    // unload at the post; cancellation only releases the broker's order.
    building.marketplace_pending_trade_code = 0;
    ctx.db.building().id().update(building);
    Ok(())
}
