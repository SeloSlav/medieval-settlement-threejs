use spacetimedb::ReducerContext;

use crate::balance_generated::{TIMBER_DELIVERY_SPEED_MPS, TIMBER_DELIVERY_UNLOAD_SEC};
use crate::db::*;
use crate::devotional_candle_policy::{
    chapel_candle_use_due, devotional_candle_contract_ready,
    monastery_candle_use_due, DEVOTIONAL_CANDLE_CONTRACT_GOLD,
    DEVOTIONAL_CANDLE_CONTRACT_UNITS,
};
use crate::economy::{
    building_commodity_room, building_commodity_stock, chapel_coffer_gold,
    deposit_building_commodity, withdraw_building_commodity, withdraw_coffer_in_place,
    CommodityKind,
};
use crate::resource_units::whole_units;
use crate::simulation::delivery_trips::{
    building_has_active_trip, building_has_inbound_commodity_trip, onsite_building_labor,
    try_start_origin_rostered_building_supply_trip,
};
use crate::simulation::game_calendar::{calendar_day_started, GameClock};
use crate::simulation::road_logistics::local_delivery_distance;
use crate::simulation::tick_context::SimTickContext;
use crate::tables::Building;

fn institution_available_gold(institution: &Building) -> f64 {
    match institution.kind.as_str() {
        "chapel" => chapel_coffer_gold(institution),
        "monastery" => whole_units(
            (institution.gold - institution.civic_receipts_gold.max(0.0)).max(0.0),
        ),
        _ => 0.0,
    }
}

fn institution_is_eligible(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    institution: &Building,
) -> bool {
    matches!(institution.kind.as_str(), "chapel" | "monastery")
        && institution.construction_complete
        && institution.assigned_labor > 0
        && !tick.building_disabled_by_fire(ctx, institution.id)
}

fn same_local_settlement(source: &Building, target: &Building) -> bool {
    source.owner == target.owner
        && (source.settlement_id == 0
            || target.settlement_id == 0
            || source.settlement_id == target.settlement_id)
}

fn consume_daily_devotional_candle(institution: &mut Building, clock: &GameClock) -> bool {
    if !calendar_day_started(clock) || institution.candles < 1.0 {
        return false;
    }
    let due = match institution.kind.as_str() {
        "chapel" => chapel_candle_use_due(clock.is_sunday),
        "monastery" => monastery_candle_use_due(institution.id, clock.total_days),
        _ => false,
    };
    if !due {
        return false;
    }
    withdraw_building_commodity(institution, CommodityKind::Candles, 1.0) >= 1.0
}

fn dispatch_devotional_contract(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    institution: &Building,
) -> bool {
    if building_has_inbound_commodity_trip(ctx, institution.id, CommodityKind::Candles) {
        return false;
    }
    let candle_stock = building_commodity_stock(institution, CommodityKind::Candles);
    let candle_room = building_commodity_room(institution, CommodityKind::Candles);
    if !devotional_candle_contract_ready(
        &institution.kind,
        candle_stock,
        candle_room,
        institution_available_gold(institution),
    ) {
        return false;
    }
    let Some(network) = tick.road_network(institution.owner) else {
        return false;
    };

    let mut candidates = tick
        .building_ids_for_kinds(ctx, institution.owner, &["trading_post"])
        .into_iter()
        .filter_map(|id| ctx.db.building().id().find(&id))
        .filter(|source| {
            source.kind == "trading_post"
                && source.construction_complete
                && source.assigned_labor > 0
                && onsite_building_labor(ctx, source) > 0
                && !tick.building_disabled_by_fire(ctx, source.id)
                && !building_has_active_trip(ctx, source.id)
                && same_local_settlement(source, institution)
                && building_commodity_stock(source, CommodityKind::Candles) + 1e-6
                    >= DEVOTIONAL_CANDLE_CONTRACT_UNITS
        })
        .filter_map(|source| {
            local_delivery_distance(network, source.x, source.z, institution.x, institution.z)
                .map(|distance| (distance, source))
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        left.0
            .total_cmp(&right.0)
            .then_with(|| left.1.id.cmp(&right.1.id))
    });
    let Some((_, mut source)) = candidates.into_iter().next() else {
        return false;
    };

    try_start_origin_rostered_building_supply_trip(
        ctx,
        tick,
        clock,
        network,
        &mut source,
        institution,
        1,
        CommodityKind::Candles,
        TIMBER_DELIVERY_SPEED_MPS,
        TIMBER_DELIVERY_UNLOAD_SEC,
        DEVOTIONAL_CANDLE_CONTRACT_UNITS,
        DEVOTIONAL_CANDLE_CONTRACT_UNITS,
    )
}

/// Burns due liturgical stock and lets cash-secure institutions place one
/// road-bound local order at a time. Household Marketplace stock is excluded:
/// the player routes candles to homes through a Storehouse/Marketplace, or to
/// devotional contracts and export through a Trading Post.
pub fn step_devotional_candles(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    institution_ids: &[u64],
) {
    let mut ordered_ids = institution_ids.to_vec();
    ordered_ids.sort_unstable();
    for institution_id in ordered_ids {
        let Some(mut institution) = ctx.db.building().id().find(&institution_id) else {
            continue;
        };
        if !institution_is_eligible(ctx, tick, &institution) {
            continue;
        }
        if consume_daily_devotional_candle(&mut institution, clock) {
            ctx.db.building().id().update(institution.clone());
        }
        dispatch_devotional_contract(ctx, tick, clock, &institution);
    }
}

/// Exchanges a complete candle lot for a complete institutional payment at
/// the destination door. The caller leaves the payment on the same cart for
/// its physical return to the Trading Post.
pub(super) fn settle_devotional_candle_delivery(
    institution: &mut Building,
    delivered_candles: f64,
) -> Option<f64> {
    if (delivered_candles - DEVOTIONAL_CANDLE_CONTRACT_UNITS).abs() > 1e-6 {
        return None;
    }
    if !devotional_candle_contract_ready(
        &institution.kind,
        building_commodity_stock(institution, CommodityKind::Candles),
        building_commodity_room(institution, CommodityKind::Candles),
        institution_available_gold(institution),
    ) {
        return None;
    }

    let previous_private_proceeds = institution.private_export_proceeds_gold;
    let paid = match institution.kind.as_str() {
        "chapel" => withdraw_coffer_in_place(institution, DEVOTIONAL_CANDLE_CONTRACT_GOLD),
        "monastery" => {
            let paid = withdraw_building_commodity(
                institution,
                CommodityKind::Gold,
                DEVOTIONAL_CANDLE_CONTRACT_GOLD,
            );
            institution.private_export_proceeds_gold = institution
                .private_export_proceeds_gold
                .min((institution.gold - institution.civic_receipts_gold.max(0.0)).max(0.0));
            paid
        }
        _ => 0.0,
    };
    if paid + 1e-6 < DEVOTIONAL_CANDLE_CONTRACT_GOLD {
        if institution.kind == "chapel" {
            crate::economy::deposit_coffer_in_place(institution, paid);
        } else {
            deposit_building_commodity(institution, CommodityKind::Gold, paid);
            institution.private_export_proceeds_gold = previous_private_proceeds;
        }
        return None;
    }

    let deposited = deposit_building_commodity(
        institution,
        CommodityKind::Candles,
        DEVOTIONAL_CANDLE_CONTRACT_UNITS,
    );
    if deposited + 1e-6 < DEVOTIONAL_CANDLE_CONTRACT_UNITS {
        if institution.kind == "chapel" {
            crate::economy::deposit_coffer_in_place(institution, paid);
        } else {
            deposit_building_commodity(institution, CommodityKind::Gold, paid);
            institution.private_export_proceeds_gold = previous_private_proceeds;
        }
        return None;
    }
    Some(paid)
}
