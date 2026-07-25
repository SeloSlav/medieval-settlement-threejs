use crate::balance_generated::{MarketplaceTradeKind, MarketplaceTradeOffer, TradeResource};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TradeLeg {
    pub resource: TradeResource,
    pub amount: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TradeSpend {
    Gold(f64),
    Resource(TradeLeg),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TradeReceive {
    Gold(f64),
    Resource(TradeLeg),
}

pub fn trade_spend(offer: &MarketplaceTradeOffer) -> TradeSpend {
    match offer.kind {
        MarketplaceTradeKind::GoldBuy { gold_cost, .. } => TradeSpend::Gold(gold_cost),
        MarketplaceTradeKind::GoldSell {
            resource, amount, ..
        } => TradeSpend::Resource(TradeLeg { resource, amount }),
        MarketplaceTradeKind::Barter {
            give, give_amount, ..
        } => TradeSpend::Resource(TradeLeg {
            resource: give,
            amount: give_amount,
        }),
    }
}

pub fn trade_receive(offer: &MarketplaceTradeOffer) -> TradeReceive {
    match offer.kind {
        MarketplaceTradeKind::GoldBuy {
            resource, amount, ..
        } => TradeReceive::Resource(TradeLeg { resource, amount }),
        MarketplaceTradeKind::GoldSell { gold_yield, .. } => TradeReceive::Gold(gold_yield),
        MarketplaceTradeKind::Barter {
            receive,
            receive_amount,
            ..
        } => TradeReceive::Resource(TradeLeg {
            resource: receive,
            amount: receive_amount,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::balance_generated::marketplace_trade_offer;

    #[test]
    fn buy_timber_costs_gold() {
        let offer = marketplace_trade_offer("buy_timber").expect("buy_timber");
        assert_eq!(trade_spend(offer), TradeSpend::Gold(16.0));
        assert_eq!(
            trade_receive(offer),
            TradeReceive::Resource(TradeLeg {
                resource: TradeResource::Timber,
                amount: 10.0,
            })
        );
    }

    #[test]
    fn sell_stone_yields_gold() {
        let offer = marketplace_trade_offer("sell_stone").expect("sell_stone");
        assert_eq!(
            trade_spend(offer),
            TradeSpend::Resource(TradeLeg {
                resource: TradeResource::Stone,
                amount: 10.0,
            })
        );
        assert_eq!(trade_receive(offer), TradeReceive::Gold(14.0));
    }

    #[test]
    fn barter_timber_for_stone() {
        let offer = marketplace_trade_offer("timber_for_stone").expect("timber_for_stone");
        assert_eq!(
            trade_spend(offer),
            TradeSpend::Resource(TradeLeg {
                resource: TradeResource::Timber,
                amount: 25.0,
            })
        );
        assert_eq!(
            trade_receive(offer),
            TradeReceive::Resource(TradeLeg {
                resource: TradeResource::Stone,
                amount: 10.0,
            })
        );
    }

    #[test]
    fn unknown_offer_is_none() {
        assert!(marketplace_trade_offer("not_a_trade").is_none());
    }
}
