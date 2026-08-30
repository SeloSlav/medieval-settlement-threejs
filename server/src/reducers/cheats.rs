use spacetimedb::{reducer, ReducerContext};

use crate::db::*;
use crate::economy::{building_commodity_stock, CommodityKind, ALL_COMMODITIES};
use crate::lifecycle::ensure_player_resources;
use crate::simulation::{materialize_physical_resource_stock, ReclamationStock};
use crate::tables::PlayerResources;

const MAX_CHEAT_RESOURCE_AMOUNT: f64 = 1_000_000_000.0;

fn validated_cheat_amount(amount: f64) -> Result<f64, String> {
    if !amount.is_finite() || amount < 1.0 {
        return Err("Cheat resource amount must be a finite number of at least 1.".to_string());
    }
    Ok(amount.min(MAX_CHEAT_RESOURCE_AMOUNT).floor())
}

fn missing_balance(in_ledger: f64, on_map: f64, target: f64) -> f64 {
    (target - in_ledger.max(0.0) - on_map.max(0.0)).max(0.0)
}

fn physical_resource_stock(ctx: &ReducerContext, owner: spacetimedb::Identity) -> ReclamationStock {
    let mut stock = ReclamationStock::default();
    for building in ctx.db.building().owner().filter(&owner) {
        for commodity in ALL_COMMODITIES.iter().copied() {
            let amount = if commodity == CommodityKind::Gold
                && !matches!(
                    building.kind.as_str(),
                    "founders_camp" | "salvage_pile" | "town_hall"
                ) {
                0.0
            } else {
                building_commodity_stock(&building, commodity).max(0.0)
            };
            stock = stock.merged(ReclamationStock::from_commodity(commodity, amount));
        }
    }
    stock
}

fn cheat_top_up_stock(
    in_ledger: ReclamationStock,
    on_map: ReclamationStock,
    target: f64,
) -> ReclamationStock {
    ALL_COMMODITIES
        .iter()
        .copied()
        .fold(ReclamationStock::default(), |stock, commodity| {
            stock.merged(ReclamationStock::from_commodity(
                commodity,
                missing_balance(
                    in_ledger.amount(commodity),
                    on_map.amount(commodity),
                    target,
                ),
            ))
        })
}

/// Legacy abstract-resource saves do not have physical holders for manure,
/// remedies, or prepared feed. Every other canonical commodity still has a
/// treasury slot, and this exhaustive match makes a new enum variant a compile
/// error here until the cheat path deliberately handles it.
fn resource_ledger_slot(
    resources: &mut PlayerResources,
    commodity: CommodityKind,
) -> Option<&mut f64> {
    match commodity {
        CommodityKind::Firewood => Some(&mut resources.firewood),
        CommodityKind::Water => Some(&mut resources.water),
        CommodityKind::Timber => Some(&mut resources.timber),
        CommodityKind::Ale => Some(&mut resources.ale),
        CommodityKind::PreservedFood => Some(&mut resources.preserved_food),
        CommodityKind::Honey => Some(&mut resources.honey),
        CommodityKind::Wine => Some(&mut resources.wine),
        CommodityKind::Stone => Some(&mut resources.stone),
        CommodityKind::Ironwork => Some(&mut resources.ironwork),
        CommodityKind::Polearms => Some(&mut resources.polearms),
        CommodityKind::Wool => Some(&mut resources.wool),
        CommodityKind::Cloth => Some(&mut resources.cloth),
        CommodityKind::Gold => Some(&mut resources.gold),
        CommodityKind::Barley => Some(&mut resources.barley),
        CommodityKind::Malt => Some(&mut resources.malt),
        CommodityKind::Flax => Some(&mut resources.flax),
        CommodityKind::Iron => Some(&mut resources.iron),
        CommodityKind::Clay => Some(&mut resources.clay),
        CommodityKind::Salt => Some(&mut resources.salt),
        CommodityKind::Charcoal => Some(&mut resources.charcoal),
        CommodityKind::Pottery => Some(&mut resources.pottery),
        CommodityKind::Manure => None,
        CommodityKind::Remedies => None,
        CommodityKind::RoofTiles => Some(&mut resources.roof_tiles),
        CommodityKind::Meat => Some(&mut resources.meat),
        CommodityKind::Fish => Some(&mut resources.fish),
        CommodityKind::Berries => Some(&mut resources.berries),
        CommodityKind::Mushrooms => Some(&mut resources.mushrooms),
        CommodityKind::Milk => Some(&mut resources.milk),
        CommodityKind::Apples => Some(&mut resources.apples),
        CommodityKind::Cherries => Some(&mut resources.cherries),
        CommodityKind::Vegetables => Some(&mut resources.vegetables),
        CommodityKind::Eggs => Some(&mut resources.eggs),
        CommodityKind::Grapes => Some(&mut resources.grapes),
        CommodityKind::CuredMeat => Some(&mut resources.cured_meat),
        CommodityKind::SmokedFish => Some(&mut resources.smoked_fish),
        CommodityKind::Cheese => Some(&mut resources.cheese),
        CommodityKind::RyeSheaves => Some(&mut resources.rye_sheaves),
        CommodityKind::OatSheaves => Some(&mut resources.oat_sheaves),
        CommodityKind::BarleySheaves => Some(&mut resources.barley_sheaves),
        CommodityKind::MaslinSheaves => Some(&mut resources.maslin_sheaves),
        CommodityKind::RyeGrain => Some(&mut resources.rye_grain),
        CommodityKind::OatGrain => Some(&mut resources.oat_grain),
        CommodityKind::MaslinGrain => Some(&mut resources.maslin_grain),
        CommodityKind::RyeFlour => Some(&mut resources.rye_flour),
        CommodityKind::MaslinFlour => Some(&mut resources.maslin_flour),
        CommodityKind::RyeBread => Some(&mut resources.rye_bread),
        CommodityKind::MaslinBread => Some(&mut resources.maslin_bread),
        CommodityKind::Cider => Some(&mut resources.cider),
        CommodityKind::Mead => Some(&mut resources.mead),
        CommodityKind::Hides => Some(&mut resources.hides),
        CommodityKind::Leather => Some(&mut resources.leather),
        CommodityKind::Shoes => Some(&mut resources.shoes),
        CommodityKind::Pears => Some(&mut resources.pears),
        CommodityKind::Aronia => Some(&mut resources.aronia),
        CommodityKind::Rosehips => Some(&mut resources.rosehips),
        CommodityKind::Cabbage => Some(&mut resources.cabbage),
        CommodityKind::Carrots => Some(&mut resources.carrots),
        CommodityKind::Beetroot => Some(&mut resources.beetroot),
        CommodityKind::AroniaJam => Some(&mut resources.aronia_jam),
        CommodityKind::RosehipJam => Some(&mut resources.rosehip_jam),
        CommodityKind::PearCider => Some(&mut resources.pear_cider),
        CommodityKind::AnimalFeed => None,
        CommodityKind::Wax => Some(&mut resources.wax),
        CommodityKind::Candles => Some(&mut resources.candles),
        CommodityKind::Pelts => Some(&mut resources.pelts),
        CommodityKind::Yarn => Some(&mut resources.yarn),
        CommodityKind::Linen => Some(&mut resources.linen),
        CommodityKind::Sidearms => Some(&mut resources.sidearms),
        CommodityKind::Shields => Some(&mut resources.shields),
        CommodityKind::Bows => Some(&mut resources.bows),
        CommodityKind::Crossbows => Some(&mut resources.crossbows),
        CommodityKind::PaddedArmor => Some(&mut resources.padded_armor),
        CommodityKind::MailArmor => Some(&mut resources.mail_armor),
        CommodityKind::Ammunition => Some(&mut resources.ammunition),
    }
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

    if resources.physical_founding_site_enabled {
        let additional_stock = cheat_top_up_stock(
            ReclamationStock::from_resource_ledger(&resources),
            physical_resource_stock(ctx, owner),
            amount,
        );
        if !materialize_physical_resource_stock(ctx, owner, additional_stock)? {
            return Err("Could not place cheat resources in physical storage.".to_string());
        }
    } else {
        for commodity in ALL_COMMODITIES.iter().copied() {
            if let Some(slot) = resource_ledger_slot(&mut resources, commodity) {
                *slot = (*slot).max(amount);
            }
        }
        ctx.db.player_resources().owner().update(resources);
    }
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
        assert_eq!(missing_balance(0.0, 70.0, 100.0), 30.0);
        assert_eq!(missing_balance(0.0, 100.0, 100.0), 0.0);
        assert_eq!(missing_balance(12.0, 80.0, 100.0), 8.0);
    }

    #[test]
    fn physical_cheat_top_up_includes_every_canonical_commodity() {
        let target = 250.0;
        let top_up = cheat_top_up_stock(
            ReclamationStock::default(),
            ReclamationStock::default(),
            target,
        );
        for commodity in ALL_COMMODITIES.iter().copied() {
            assert_eq!(
                top_up.amount(commodity),
                target,
                "cheat top-up omitted {commodity:?}",
            );
        }
    }
}
