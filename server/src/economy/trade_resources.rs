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
        CommodityKind::OatFlour => TradeResource::OatFlour,
        CommodityKind::MaslinFlour => TradeResource::MaslinFlour,
        CommodityKind::RyeBread => TradeResource::RyeBread,
        CommodityKind::OatBread => TradeResource::OatBread,
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

pub fn commodity_for_trade_resource(resource: TradeResource) -> CommodityKind {
    match resource {
        TradeResource::Timber => CommodityKind::Timber,
        TradeResource::Stone => CommodityKind::Stone,
        TradeResource::Firewood => CommodityKind::Firewood,
        TradeResource::Water => CommodityKind::Water,
        TradeResource::Food => CommodityKind::Food,
        TradeResource::RyeSheaves => CommodityKind::RyeSheaves,
        TradeResource::OatSheaves => CommodityKind::OatSheaves,
        TradeResource::BarleySheaves => CommodityKind::BarleySheaves,
        TradeResource::MaslinSheaves => CommodityKind::MaslinSheaves,
        TradeResource::RyeGrain => CommodityKind::RyeGrain,
        TradeResource::OatGrain => CommodityKind::OatGrain,
        TradeResource::MaslinGrain => CommodityKind::MaslinGrain,
        TradeResource::RyeFlour => CommodityKind::RyeFlour,
        TradeResource::OatFlour => CommodityKind::OatFlour,
        TradeResource::MaslinFlour => CommodityKind::MaslinFlour,
        TradeResource::RyeBread => CommodityKind::RyeBread,
        TradeResource::OatBread => CommodityKind::OatBread,
        TradeResource::MaslinBread => CommodityKind::MaslinBread,
        TradeResource::Ale => CommodityKind::Ale,
        TradeResource::PreservedFood => CommodityKind::PreservedFood,
        TradeResource::Honey => CommodityKind::Honey,
        TradeResource::Wine => CommodityKind::Wine,
        TradeResource::Ironwork => CommodityKind::Ironwork,
        TradeResource::Polearms => CommodityKind::Polearms,
        TradeResource::Wool => CommodityKind::Wool,
        TradeResource::Cloth => CommodityKind::Cloth,
        TradeResource::Barley => CommodityKind::Barley,
        TradeResource::Malt => CommodityKind::Malt,
        TradeResource::Flax => CommodityKind::Flax,
        TradeResource::Iron => CommodityKind::Iron,
        TradeResource::Clay => CommodityKind::Clay,
        TradeResource::Salt => CommodityKind::Salt,
        TradeResource::Charcoal => CommodityKind::Charcoal,
        TradeResource::Pottery => CommodityKind::Pottery,
        TradeResource::Manure => CommodityKind::Manure,
        TradeResource::Remedies => CommodityKind::Remedies,
        TradeResource::RoofTiles => CommodityKind::RoofTiles,
        TradeResource::Meat => CommodityKind::Meat,
        TradeResource::Fish => CommodityKind::Fish,
        TradeResource::Berries => CommodityKind::Berries,
        TradeResource::Mushrooms => CommodityKind::Mushrooms,
        TradeResource::Milk => CommodityKind::Milk,
        TradeResource::Apples => CommodityKind::Apples,
        TradeResource::Cherries => CommodityKind::Cherries,
        TradeResource::Vegetables => CommodityKind::Vegetables,
        TradeResource::Eggs => CommodityKind::Eggs,
        TradeResource::Grapes => CommodityKind::Grapes,
        TradeResource::Porridge => CommodityKind::Porridge,
        TradeResource::CuredMeat => CommodityKind::CuredMeat,
        TradeResource::SmokedFish => CommodityKind::SmokedFish,
        TradeResource::Cheese => CommodityKind::Cheese,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_non_gold_commodity_has_a_trade_resource() {
        for code in 0..=54 {
            let Some(commodity) = CommodityKind::from_u8(code) else {
                continue;
            };
            if commodity == CommodityKind::Gold {
                assert!(trade_resource_for_commodity(commodity).is_none());
            } else {
                let resource = trade_resource_for_commodity(commodity).expect("trade resource");
                assert_eq!(commodity_for_trade_resource(resource), commodity);
            }
        }
    }
}
