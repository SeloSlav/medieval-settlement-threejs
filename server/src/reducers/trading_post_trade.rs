use spacetimedb::{reducer, ReducerContext};

use crate::db::*;
use crate::economy::{trade_resource_for_commodity, CommodityKind};
use crate::lifecycle::ensure_player_resources;
use crate::tables::TradingPostTradeRule;
use crate::trading_post_policy::{clamp_trade_surplus, regional_exchange_sequence, valid_trade_mode};

#[reducer]
pub fn set_trading_post_trade_rule(
    ctx: &ReducerContext,
    building_id: u64,
    commodity_kind: u8,
    mode: u8,
    target_surplus: f64,
) -> Result<(), String> {
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
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
        return Err("Trade rules belong to a Trading Post.".to_string());
    }
    let commodity = CommodityKind::from_u8(commodity_kind)
        .filter(|kind| trade_resource_for_commodity(*kind).is_some())
        .ok_or_else(|| "That commodity cannot be traded.".to_string())?;
    if !valid_trade_mode(mode) {
        return Err("Trade mode must be no trade, import, or export.".to_string());
    }
    if !target_surplus.is_finite() {
        return Err("Desired surplus must be a finite number.".to_string());
    }

    let id = format!("{}:{}", building_id, commodity.as_u8());
    let current_exchange = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .map(|config| regional_exchange_sequence(config.sim_tick))
        .unwrap_or(0);
    let next = TradingPostTradeRule {
        id: id.clone(),
        owner,
        building_id,
        commodity_kind: commodity.as_u8(),
        mode,
        target_surplus: clamp_trade_surplus(target_surplus),
        // A newly changed rule begins with the following bounded exchange.
        // Keep the legacy field name so existing save/schema rows remain valid.
        last_settled_month: current_exchange,
        last_trade_amount: 0.0,
        last_trade_gold: 0.0,
    };
    if ctx.db.trading_post_trade_rule().id().find(&id).is_some() {
        ctx.db.trading_post_trade_rule().id().update(next);
    } else {
        ctx.db.trading_post_trade_rule().insert(next);
    }
    Ok(())
}
