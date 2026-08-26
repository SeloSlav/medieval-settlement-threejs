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
        stock.ale += building.ale.max(0.0);
        stock.preserved_food += building.preserved_food.max(0.0);
        stock.honey += building.honey.max(0.0);
        stock.wine += building.wine.max(0.0);
        stock.ironwork += building.ironwork.max(0.0);
        stock.polearms += building.polearms.max(0.0);
        stock.wool += building.wool.max(0.0);
        stock.flax += building.flax.max(0.0);
        stock.yarn += building.yarn.max(0.0);
        stock.linen += building.linen.max(0.0);
        stock.cloth += building.cloth.max(0.0);
        stock.pelts += building.pelts.max(0.0);
        stock.meat += building.meat.max(0.0);
        stock.fish += building.fish.max(0.0);
        stock.berries += building.berries.max(0.0);
        stock.mushrooms += building.mushrooms.max(0.0);
        stock.milk += building.milk.max(0.0);
        stock.apples += building.apples.max(0.0);
        stock.cherries += building.cherries.max(0.0);
        stock.vegetables += building.vegetables.max(0.0);
        stock.eggs += building.eggs.max(0.0);
        stock.grapes += building.grapes.max(0.0);
        stock.cured_meat += building.cured_meat.max(0.0);
        stock.smoked_fish += building.smoked_fish.max(0.0);
        stock.cheese += building.cheese.max(0.0);
        stock.rye_sheaves += building.rye_sheaves.max(0.0);
        stock.oat_sheaves += building.oat_sheaves.max(0.0);
        stock.barley_sheaves += building.barley_sheaves.max(0.0);
        stock.maslin_sheaves += building.maslin_sheaves.max(0.0);
        stock.rye_grain += building.rye_grain.max(0.0);
        stock.oat_grain += building.oat_grain.max(0.0);
        stock.maslin_grain += building.maslin_grain.max(0.0);
        stock.rye_flour += building.rye_flour.max(0.0);
        stock.maslin_flour += building.maslin_flour.max(0.0);
        stock.rye_bread += building.rye_bread.max(0.0);
        stock.maslin_bread += building.maslin_bread.max(0.0);
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
    resources.flax = top_up_ledger(resources.flax, physical.map_or(0.0, |s| s.flax), amount);
    resources.yarn = top_up_ledger(resources.yarn, physical.map_or(0.0, |s| s.yarn), amount);
    resources.linen = top_up_ledger(resources.linen, physical.map_or(0.0, |s| s.linen), amount);
    resources.cloth = top_up_ledger(resources.cloth, physical.map_or(0.0, |s| s.cloth), amount);
    resources.pelts = top_up_ledger(resources.pelts, physical.map_or(0.0, |s| s.pelts), amount);
    resources.meat = top_up_ledger(resources.meat, physical.map_or(0.0, |s| s.meat), amount);
    resources.fish = top_up_ledger(resources.fish, physical.map_or(0.0, |s| s.fish), amount);
    resources.berries = top_up_ledger(
        resources.berries,
        physical.map_or(0.0, |s| s.berries),
        amount,
    );
    resources.mushrooms = top_up_ledger(
        resources.mushrooms,
        physical.map_or(0.0, |s| s.mushrooms),
        amount,
    );
    resources.milk = top_up_ledger(resources.milk, physical.map_or(0.0, |s| s.milk), amount);
    resources.apples = top_up_ledger(resources.apples, physical.map_or(0.0, |s| s.apples), amount);
    resources.cherries = top_up_ledger(
        resources.cherries,
        physical.map_or(0.0, |s| s.cherries),
        amount,
    );
    resources.vegetables = top_up_ledger(
        resources.vegetables,
        physical.map_or(0.0, |s| s.vegetables),
        amount,
    );
    resources.eggs = top_up_ledger(resources.eggs, physical.map_or(0.0, |s| s.eggs), amount);
    resources.grapes = top_up_ledger(resources.grapes, physical.map_or(0.0, |s| s.grapes), amount);
    resources.cured_meat = top_up_ledger(
        resources.cured_meat,
        physical.map_or(0.0, |s| s.cured_meat),
        amount,
    );
    resources.smoked_fish = top_up_ledger(
        resources.smoked_fish,
        physical.map_or(0.0, |s| s.smoked_fish),
        amount,
    );
    resources.cheese = top_up_ledger(resources.cheese, physical.map_or(0.0, |s| s.cheese), amount);
    resources.rye_sheaves = top_up_ledger(
        resources.rye_sheaves,
        physical.map_or(0.0, |s| s.rye_sheaves),
        amount,
    );
    resources.oat_sheaves = top_up_ledger(
        resources.oat_sheaves,
        physical.map_or(0.0, |s| s.oat_sheaves),
        amount,
    );
    resources.barley_sheaves = top_up_ledger(
        resources.barley_sheaves,
        physical.map_or(0.0, |s| s.barley_sheaves),
        amount,
    );
    resources.maslin_sheaves = top_up_ledger(
        resources.maslin_sheaves,
        physical.map_or(0.0, |s| s.maslin_sheaves),
        amount,
    );
    resources.rye_grain = top_up_ledger(
        resources.rye_grain,
        physical.map_or(0.0, |s| s.rye_grain),
        amount,
    );
    resources.oat_grain = top_up_ledger(
        resources.oat_grain,
        physical.map_or(0.0, |s| s.oat_grain),
        amount,
    );
    resources.maslin_grain = top_up_ledger(
        resources.maslin_grain,
        physical.map_or(0.0, |s| s.maslin_grain),
        amount,
    );
    resources.rye_flour = top_up_ledger(
        resources.rye_flour,
        physical.map_or(0.0, |s| s.rye_flour),
        amount,
    );
    resources.maslin_flour = top_up_ledger(
        resources.maslin_flour,
        physical.map_or(0.0, |s| s.maslin_flour),
        amount,
    );
    resources.rye_bread = top_up_ledger(
        resources.rye_bread,
        physical.map_or(0.0, |s| s.rye_bread),
        amount,
    );
    resources.maslin_bread = top_up_ledger(
        resources.maslin_bread,
        physical.map_or(0.0, |s| s.maslin_bread),
        amount,
    );
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
