use crate::balance_generated::{
    MarketplaceTradeKind, MarketplaceTradeOffer, TradeResource,
    MARKETPLACE_BULK_TRADE_COOLDOWN_SECONDS, STOREHOUSE_HAUL_PER_WORKER,
};
use crate::raid_agent_policy::{
    raid_entry_point_for_approach, RAID_APPROACH_SOUTH, RAID_APPROACH_WEST,
};

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

pub fn manual_trade_ready(
    assigned_labor: u32,
    action_cooldown: f64,
    has_road_access: bool,
) -> bool {
    assigned_labor > 0 && action_cooldown <= 1e-6 && has_road_access
}

/// Regional caravans capture current pass and road conditions when the trade
/// starts. More brokers still shorten the settlement work, while wet or frozen
/// routes make repeated import dependence less reliable.
pub fn manual_trade_cooldown_seconds(assigned_labor: u32, road_speed_multiplier: f64) -> f64 {
    let road_speed = if road_speed_multiplier.is_finite() && road_speed_multiplier > 0.0 {
        road_speed_multiplier.clamp(0.05, 1.0)
    } else {
        1.0
    };
    MARKETPLACE_BULK_TRADE_COOLDOWN_SECONDS / assigned_labor.max(1) as f64 / road_speed
}

/// Manual treasury imports may remain as marketplace stock, but a household or
/// parish order is a sale to one named home and only commits when its cart starts.
pub fn market_order_should_commit(requires_immediate_delivery: bool, dispatched: bool) -> bool {
    !requires_immediate_delivery || dispatched
}

/// Export proceeds leave a marketplace in one small broker handcart. Keeping
/// the load bounded makes a remote trade quarter a real logistics choice
/// instead of teleporting arbitrarily large sale income into the treasury.
pub fn marketplace_proceeds_cart_load(held_gold: f64) -> f64 {
    if !held_gold.is_finite() {
        return 0.0;
    }
    held_gold.clamp(0.0, STOREHOUSE_HAUL_PER_WORKER)
}

/// Regional merchants use the same bounded handcart envelope as local market
/// proceeds. Discrete loads make route length and a second market matter.
pub fn regional_export_cart_load(available: f64) -> f64 {
    if !available.is_finite() {
        return 0.0;
    }
    available.clamp(0.0, STOREHOUSE_HAUL_PER_WORKER)
}

/// Only cargo that reaches the regional exchange earns a receipt. This also
/// handles food spoiled on the road and partial live-agent raid losses.
pub fn proportional_regional_trade_receipt(
    contracted_load: f64,
    surviving_load: f64,
    full_receipt: f64,
) -> f64 {
    if !contracted_load.is_finite()
        || contracted_load <= 1e-9
        || !surviving_load.is_finite()
        || !full_receipt.is_finite()
    {
        return 0.0;
    }
    full_receipt.max(0.0) * (surviving_load.max(0.0) / contracted_load).clamp(0.0, 1.0)
}

/// Regional imports approach from the Adriatic-facing south or west edge.
///
/// The seed and marketplace id choose one stable corridor, while map size
/// controls the actual edge. Keeping the entry aligned with the destination
/// avoids an arbitrary cross-map diagonal before the caravan joins the
/// settlement's connected road branch.
pub fn adriatic_trade_entry_point(
    entropy: u64,
    market_x: f64,
    market_z: f64,
    playable_half: f64,
) -> Option<(f64, f64)> {
    if !market_x.is_finite()
        || !market_z.is_finite()
        || !playable_half.is_finite()
        || playable_half <= 0.0
    {
        return None;
    }
    let mixed =
        entropy.wrapping_mul(0x9e37_79b9_7f4a_7c15).rotate_left(23) ^ entropy.rotate_right(11);
    let approach = if mixed & 1 == 0 {
        RAID_APPROACH_WEST
    } else {
        RAID_APPROACH_SOUTH
    };
    let offset = if approach == RAID_APPROACH_WEST {
        market_z
    } else {
        market_x
    };
    raid_entry_point_for_approach(approach, offset, playable_half)
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
    fn buy_ironwork_imports_a_physical_market_shipment() {
        let offer = marketplace_trade_offer("buy_ironwork").expect("buy_ironwork");
        assert_eq!(trade_spend(offer), TradeSpend::Gold(12.0));
        assert_eq!(
            trade_receive(offer),
            TradeReceive::Resource(TradeLeg {
                resource: TradeResource::Ironwork,
                amount: 6.0,
            })
        );
    }

    #[test]
    fn buy_rye_grain_restarts_one_efficient_field() {
        let offer = marketplace_trade_offer("buy_rye_grain").expect("buy_rye_grain");
        assert_eq!(trade_spend(offer), TradeSpend::Gold(16.0));
        assert_eq!(
            trade_receive(offer),
            TradeReceive::Resource(TradeLeg {
                resource: TradeResource::RyeGrain,
                amount: 24.0,
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

    #[test]
    fn manual_trade_requires_a_broker_road_and_ready_desk() {
        assert!(!manual_trade_ready(0, 0.0, true));
        assert!(!manual_trade_ready(1, 0.0, false));
        assert!(!manual_trade_ready(1, 0.1, true));
        assert!(manual_trade_ready(1, 0.0, true));
    }

    #[test]
    fn additional_brokers_reduce_trade_turnaround() {
        assert_eq!(manual_trade_cooldown_seconds(1, 1.0), 8.0);
        assert_eq!(manual_trade_cooldown_seconds(2, 1.0), 4.0);
        assert_eq!(manual_trade_cooldown_seconds(4, 1.0), 2.0);
    }

    #[test]
    fn poor_roads_slow_regional_caravan_turnaround() {
        let rain_speed = crate::balance_generated::SPRING_RAIN_ROAD_SPEED_MULTIPLIER;
        let dry = manual_trade_cooldown_seconds(1, 1.0);
        let rain = manual_trade_cooldown_seconds(1, rain_speed);
        assert!((rain - dry / rain_speed).abs() < 1e-9);
        assert!(rain > dry);
    }

    #[test]
    fn treasury_import_can_wait_in_market_storage() {
        assert!(market_order_should_commit(false, false));
    }

    #[test]
    fn named_household_order_waits_without_committing_when_cart_cannot_leave() {
        assert!(!market_order_should_commit(true, false));
    }

    #[test]
    fn named_household_order_commits_when_its_cart_leaves() {
        assert!(market_order_should_commit(true, true));
    }

    #[test]
    fn export_proceeds_use_one_bounded_broker_cart() {
        assert_eq!(marketplace_proceeds_cart_load(-5.0), 0.0);
        assert_eq!(marketplace_proceeds_cart_load(f64::NAN), 0.0);
        assert_eq!(marketplace_proceeds_cart_load(8.5), 8.5);
        assert_eq!(
            marketplace_proceeds_cart_load(200.0),
            STOREHOUSE_HAUL_PER_WORKER
        );
    }

    #[test]
    fn regional_exports_use_bounded_discrete_cart_loads() {
        assert_eq!(regional_export_cart_load(-2.0), 0.0);
        assert_eq!(regional_export_cart_load(f64::NAN), 0.0);
        assert_eq!(regional_export_cart_load(7.5), 7.5);
        assert_eq!(regional_export_cart_load(200.0), STOREHOUSE_HAUL_PER_WORKER);
    }

    #[test]
    fn regional_receipts_scale_with_the_load_that_physically_survives() {
        assert_eq!(proportional_regional_trade_receipt(20.0, 20.0, 14.0), 14.0);
        assert_eq!(proportional_regional_trade_receipt(20.0, 5.0, 14.0), 3.5);
        assert_eq!(proportional_regional_trade_receipt(20.0, 0.0, 14.0), 0.0);
        assert_eq!(proportional_regional_trade_receipt(20.0, 40.0, 14.0), 14.0);
        assert_eq!(proportional_regional_trade_receipt(0.0, 1.0, 14.0), 0.0);
    }

    #[test]
    fn adriatic_imports_enter_from_a_stable_south_or_west_map_edge() {
        for map_half in [
            crate::raid_agent_policy::playable_half_for_map_size(0),
            crate::raid_agent_policy::playable_half_for_map_size(1),
            crate::raid_agent_policy::playable_half_for_map_size(2),
        ] {
            let first = adriatic_trade_entry_point(17, 42.0, -31.0, map_half).expect("trade entry");
            let repeated =
                adriatic_trade_entry_point(17, 42.0, -31.0, map_half).expect("trade entry");
            assert_eq!(first, repeated);
            let edge = map_half - crate::raid_agent_policy::MAP_EDGE_INSET_METERS;
            assert!(
                (first.0 + edge).abs() < 1e-9 || (first.1 - edge).abs() < 1e-9,
                "Adriatic access must use the west or south edge"
            );
        }
        assert!(adriatic_trade_entry_point(1, f64::NAN, 0.0, 410.0).is_none());
    }
}
