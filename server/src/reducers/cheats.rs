use spacetimedb::{reducer, ReducerContext};

use crate::db::*;
use crate::lifecycle::ensure_player_resources;
use crate::simulation::{materialize_physical_resource_ledger, ReclamationStock};

const MAX_CHEAT_RESOURCE_AMOUNT: f64 = 1_000_000_000.0;

fn validated_cheat_amount(amount: f64) -> Result<f64, String> {
    if !amount.is_finite() || amount < 1.0 {
        return Err("Cheat resource amount must be a finite number of at least 1.".to_string());
    }
    Ok(amount.min(MAX_CHEAT_RESOURCE_AMOUNT).floor())
}

fn top_up_ledger(existing: f64, on_map: f64, target: f64) -> f64 {
    existing.max((target - on_map.max(0.0)).max(0.0))
}

fn physical_resource_stock(ctx: &ReducerContext, owner: spacetimedb::Identity) -> ReclamationStock {
    let mut stock = ReclamationStock::default();
    for building in ctx.db.building().owner().filter(&owner) {
        stock.timber += building.timber.max(0.0);
        stock.firewood += building.firewood.max(0.0);
        stock.stone += building.stone.max(0.0);
        stock.water += building.water.max(0.0);
        stock.food += building.food.max(0.0);
        stock.grain += building.grain.max(0.0);
        stock.flour += building.flour.max(0.0);
        stock.ale += building.ale.max(0.0);
        stock.preserved_food += building.preserved_food.max(0.0);
        stock.honey += building.honey.max(0.0);
        stock.wine += building.wine.max(0.0);
        stock.ironwork += building.ironwork.max(0.0);
        stock.polearms += building.polearms.max(0.0);
        stock.wool += building.wool.max(0.0);
        stock.cloth += building.cloth.max(0.0);
        if matches!(
            building.kind.as_str(),
            "founders_camp" | "salvage_pile" | "town_hall"
        ) {
            stock.gold += building.gold.max(0.0);
        }
    }
    stock
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

    let physical = resources
        .physical_founding_site_enabled
        .then(|| physical_resource_stock(ctx, owner));
    resources.timber = top_up_ledger(resources.timber, physical.map_or(0.0, |s| s.timber), amount);
    resources.stone = top_up_ledger(resources.stone, physical.map_or(0.0, |s| s.stone), amount);
    resources.firewood = top_up_ledger(
        resources.firewood,
        physical.map_or(0.0, |s| s.firewood),
        amount,
    );
    resources.water = top_up_ledger(resources.water, physical.map_or(0.0, |s| s.water), amount);
    resources.gold = top_up_ledger(resources.gold, physical.map_or(0.0, |s| s.gold), amount);
    resources.food = top_up_ledger(resources.food, physical.map_or(0.0, |s| s.food), amount);
    resources.grain = top_up_ledger(resources.grain, physical.map_or(0.0, |s| s.grain), amount);
    resources.flour = top_up_ledger(resources.flour, physical.map_or(0.0, |s| s.flour), amount);
    resources.ale = top_up_ledger(resources.ale, physical.map_or(0.0, |s| s.ale), amount);
    resources.preserved_food = top_up_ledger(
        resources.preserved_food,
        physical.map_or(0.0, |s| s.preserved_food),
        amount,
    );
    resources.honey = top_up_ledger(resources.honey, physical.map_or(0.0, |s| s.honey), amount);
    resources.wine = top_up_ledger(resources.wine, physical.map_or(0.0, |s| s.wine), amount);
    resources.ironwork = top_up_ledger(
        resources.ironwork,
        physical.map_or(0.0, |s| s.ironwork),
        amount,
    );
    resources.polearms = top_up_ledger(
        resources.polearms,
        physical.map_or(0.0, |s| s.polearms),
        amount,
    );
    resources.wool = top_up_ledger(resources.wool, physical.map_or(0.0, |s| s.wool), amount);
    resources.cloth = top_up_ledger(resources.cloth, physical.map_or(0.0, |s| s.cloth), amount);
    ctx.db.player_resources().owner().update(resources);
    materialize_physical_resource_ledger(ctx, owner)?;
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
        assert_eq!(top_up_ledger(0.0, 70.0, 100.0), 30.0);
        assert_eq!(top_up_ledger(0.0, 100.0, 100.0), 0.0);
        assert_eq!(top_up_ledger(12.0, 100.0, 100.0), 12.0);
    }
}
