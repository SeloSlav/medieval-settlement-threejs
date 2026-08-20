use crate::balance_generated::TradeResource;

use super::CommodityKind;

pub fn trade_resource_for_commodity(commodity: CommodityKind) -> Option<TradeResource> {
    Some(match commodity {
        CommodityKind::Timber => TradeResource::Timber,
        CommodityKind::Stone => TradeResource::Stone,
        CommodityKind::Firewood => TradeResource::Firewood,
        CommodityKind::Water => TradeResource::Water,
        CommodityKind::Food => TradeResource::Food,
        CommodityKind::RyeSheaves => TradeResource::RyeSheaves,
        CommodityKind::OatSheaves => TradeResource::OatSheaves,
        CommodityKind::BarleySheaves => TradeResource::BarleySheaves,
        CommodityKind::MaslinSheaves => TradeResource::MaslinSheaves,
        CommodityKind::RyeGrain => TradeResource::RyeGrain,
        CommodityKind::OatGrain => TradeResource::OatGrain,
        CommodityKind::MaslinGrain => TradeResource::MaslinGrain,
        CommodityKind::RyeFlour => TradeResource::RyeFlour,
        CommodityKind::MaslinFlour => TradeResource::MaslinFlour,
        CommodityKind::RyeBread => TradeResource::RyeBread,
        CommodityKind::MaslinBread => TradeResource::MaslinBread,
        CommodityKind::Ale => TradeResource::Ale,
        CommodityKind::Cider | CommodityKind::Mead => return None,
        CommodityKind::PreservedFood => TradeResource::PreservedFood,
        CommodityKind::Honey => TradeResource::Honey,
        CommodityKind::Wine => TradeResource::Wine,
        CommodityKind::Ironwork => TradeResource::Ironwork,
        CommodityKind::Polearms => TradeResource::Polearms,
        CommodityKind::Wool => TradeResource::Wool,
        CommodityKind::Cloth => TradeResource::Cloth,
        CommodityKind::Barley => TradeResource::Barley,
        CommodityKind::Malt => TradeResource::Malt,
        CommodityKind::Flax => TradeResource::Flax,
        CommodityKind::Iron => TradeResource::Iron,
        CommodityKind::Clay => TradeResource::Clay,
        CommodityKind::Salt => TradeResource::Salt,
        CommodityKind::Charcoal => TradeResource::Charcoal,
        CommodityKind::Pottery => TradeResource::Pottery,
        CommodityKind::Manure => TradeResource::Manure,
        CommodityKind::Remedies => TradeResource::Remedies,
        CommodityKind::RoofTiles => TradeResource::RoofTiles,
        CommodityKind::Meat => TradeResource::Meat,
        CommodityKind::Fish => TradeResource::Fish,
        CommodityKind::Berries => TradeResource::Berries,
        CommodityKind::Mushrooms => TradeResource::Mushrooms,
        CommodityKind::Milk => TradeResource::Milk,
        CommodityKind::Apples => TradeResource::Apples,
        CommodityKind::Cherries => TradeResource::Cherries,
        CommodityKind::Vegetables => TradeResource::Vegetables,
        CommodityKind::Eggs => TradeResource::Eggs,
        CommodityKind::Grapes => TradeResource::Grapes,
        CommodityKind::Porridge => TradeResource::Porridge,
        CommodityKind::CuredMeat => TradeResource::CuredMeat,
        CommodityKind::SmokedFish => TradeResource::SmokedFish,
        CommodityKind::Cheese => TradeResource::Cheese,
        CommodityKind::Gold => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_non_gold_commodity_has_a_unique_trade_resource() {
        let mut resources = std::collections::HashSet::new();
        for code in 0..=54 {
            let Some(commodity) = CommodityKind::from_u8(code) else {
                continue;
            };
            if commodity == CommodityKind::Gold {
                assert!(trade_resource_for_commodity(commodity).is_none());
            } else {
                let resource = trade_resource_for_commodity(commodity).expect("trade resource");
                assert!(resources.insert(resource as u8), "duplicate resource: {resource:?}");
            }
        }
    }
}
