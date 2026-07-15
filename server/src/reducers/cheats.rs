use spacetimedb::{reducer, ReducerContext};

use crate::db::*;
use crate::lifecycle::ensure_player_resources;

const MAX_CHEAT_RESOURCE_AMOUNT: f64 = 1_000_000_000.0;

fn validated_cheat_amount(amount: f64) -> Result<f64, String> {
    if !amount.is_finite() || amount < 1.0 {
        return Err("Cheat resource amount must be a finite number of at least 1.".to_string());
    }
    Ok(amount.min(MAX_CHEAT_RESOURCE_AMOUNT).floor())
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

    resources.timber = resources.timber.max(amount);
    resources.stone = resources.stone.max(amount);
    resources.firewood = resources.firewood.max(amount);
    resources.water = resources.water.max(amount);
    resources.gold = resources.gold.max(amount);
    resources.food = resources.food.max(amount);
    resources.grain = resources.grain.max(amount);
    resources.flour = resources.flour.max(amount);
    resources.ale = resources.ale.max(amount);
    resources.preserved_food = resources.preserved_food.max(amount);
    resources.honey = resources.honey.max(amount);
    resources.wine = resources.wine.max(amount);
    ctx.db.player_resources().owner().update(resources);
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
}
