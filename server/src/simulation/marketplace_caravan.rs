//! Local Marketplace stall deliveries and Trading Post regional logistics.

use spacetimedb::ReducerContext;

use crate::balance_generated::{
    BUILDING_ROAD_ACCESS_DISTANCE, FIREWOOD_DELIVERY_SPEED_MPS, FIREWOOD_DELIVERY_UNLOAD_SEC,
    FOOD_DELIVERY_SPEED_MPS, FOOD_DELIVERY_UNLOAD_SEC, HOUSEHOLD_MAX_WEALTH,
    LOCAL_MARKET_TAX_CART_THRESHOLD, MARKET_CARAVAN_FOOD_PER_DELIVERY,
    MARKET_CARAVAN_WATER_PER_DELIVERY, PRIVATE_EXPORT_INCOME_CART_LOAD,
    SPECIALTY_EXPORT_GOLD_PER_ALE, SPECIALTY_EXPORT_GOLD_PER_CHEESE,
    SPECIALTY_EXPORT_GOLD_PER_CLOTH, SPECIALTY_EXPORT_GOLD_PER_HONEY,
    SPECIALTY_EXPORT_GOLD_PER_POTTERY, SPECIALTY_EXPORT_GOLD_PER_WINE, STOREHOUSE_HAUL_PER_WORKER,
    TICK_DT, TIMBER_DELIVERY_SPEED_MPS, TIMBER_DELIVERY_UNLOAD_SEC, WATER_DELIVERY_SPEED_MPS,
    WATER_DELIVERY_UNLOAD_SEC,
};
use crate::db::*;
use crate::economy::{
    building_commodity_stock, building_edible_food_stock, building_preserved_food_stock,
    credit_private_export_receipt, mark_local_civic_receipts_dispatched,
    marketplace_proceeds_cart_load, physical_treasury_seat, private_export_proceeds,
    record_specialty_market_export, regional_export_cart_load, specialty_family_for_commodity,
    specialty_price_multiplier_for_commodity, treasury_gold, try_advance_pending_marketplace_trade,
    try_execute_standing_marketplace_import, withdraw_building_commodity, CommodityKind,
};
use crate::marketplace_procurement_policy::{
    marketplace_gold_reserve_shortfall, marketplace_gold_sweep_surplus,
};
use crate::season_policy::EnvironmentState;
use crate::simulation::delivery_cargo::{
    delivery_stock_room, has_delivery_stock_room, residence_commodity_delivery_room,
    selected_food_delivery_commodity,
};
use crate::simulation::delivery_supplier::{dispatch_delivery_if_ready, DeliveryDispatchConfig};
use crate::simulation::delivery_trips::{
    building_has_active_trip, building_has_inbound_commodity_trip,
    building_has_regional_market_trip, onsite_building_labor, regional_market_export_route,
    residence_has_inbound_remedy_trip, residence_has_inbound_wealth_trip,
    start_regional_market_export_trip, try_start_building_supply_trip,
    try_start_free_building_supply_trip, try_start_market_stall_delivery_trip,
    try_start_market_stall_remedy_trip, try_start_private_export_income_trip,
};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::labor_and_logistics_paused;
use crate::simulation::residence_needs::{load_needs, need_stock, ResidenceNeedKind};
use crate::simulation::road_logistics::{
    local_delivery_distance, select_residence_for_need_delivery,
    select_residence_for_remedy_delivery,
};
use crate::simulation::tick_context::SimTickContext;
use crate::specialty_trade_policy::{
    resolved_specialty_family_policy, specialty_export_capacity, specialty_export_order,
    specialty_export_policy_allows, specialty_export_workers, SpecialtyMarketFamily,
};
use crate::tables::{Building, Residence};

const MARKETPLACE_TREASURY_KINDS: &[&str] = &["town_hall", "founders_camp", "salvage_pile"];

#[derive(Clone, Copy, Debug, Default)]
pub struct MarketCaravanDispatch {
    pub include_abandoned: bool,
    pub priority_residence_id: Option<u64>,
    /// A paid household or relief lot must fit and load in full. Routine
    /// marketplace distribution keeps its worker-scaled carrying capacity.
    pub exact_load_amount: Option<f64>,
}

pub fn try_dispatch_marketplace_caravan(
    ctx: &ReducerContext,
    clock: &GameClock,
    tick: &SimTickContext,
    building: &mut Building,
    need_kind: ResidenceNeedKind,
    per_delivery_amount: f64,
    dispatch: MarketCaravanDispatch,
) -> bool {
    if !matches!(building.kind.as_str(), "marketplace" | "trading_post")
        || !building.construction_complete
        || tick.building_disabled_by_fire(ctx, building.id)
    {
        return false;
    }

    let stock = match need_kind {
        ResidenceNeedKind::Firewood => building.firewood,
        ResidenceNeedKind::Food => building_edible_food_stock(building),
        ResidenceNeedKind::Water => building.water,
        ResidenceNeedKind::PreservedFood => building_preserved_food_stock(building),
        ResidenceNeedKind::Ale => building.ale,
        ResidenceNeedKind::Cloth => building.cloth,
        ResidenceNeedKind::Pottery => building.pottery,
        ResidenceNeedKind::Church | ResidenceNeedKind::FoodVariety => return false,
    };
    if stock <= 1e-6
        || (building.kind == "trading_post" && building_has_active_trip(ctx, building.id))
    {
        return false;
    }

    let Some(network) = tick.road_network(building.owner) else {
        return false;
    };
    let delivery_commodity = selected_food_delivery_commodity(building, need_kind);

    let residence_is_eligible = |residence: &Residence| {
        if residence.owner != building.owner || !need_kind.is_active_for_tier(residence.tier) {
            return false;
        }
        dispatch.include_abandoned || (!residence.abandoned && residence.population > 0)
    };
    let eligible: Vec<Residence> = match dispatch.priority_residence_id {
        Some(residence_id) => ctx
            .db
            .residence()
            .id()
            .find(&residence_id)
            .filter(residence_is_eligible)
            .into_iter()
            .collect(),
        None => ctx
            .db
            .residence()
            .owner()
            .filter(&building.owner)
            .filter(residence_is_eligible)
            .collect(),
    };
    let targets: Vec<Residence> = select_residence_for_need_delivery(
        network,
        building,
        eligible,
        dispatch.priority_residence_id,
        None,
        |residence| need_stock(&load_needs(ctx, residence.id), need_kind),
        |residence, stock| {
            let physical_room = delivery_commodity
                .map(|commodity| residence_commodity_delivery_room(residence, commodity));
            dispatch.exact_load_amount.map_or_else(
                || {
                    physical_room.map_or_else(
                        || has_delivery_stock_room(need_kind, stock),
                        |room| room > 1e-6,
                    )
                },
                |amount| {
                    physical_room.unwrap_or_else(|| delivery_stock_room(need_kind, stock)) + 1e-6
                        >= amount
                },
            )
        },
    )
    .into_iter()
    .collect();
    if targets.is_empty() {
        return false;
    }

    let stall_workplace = if building.kind == "marketplace" {
        marketplace_stall_workplace(ctx, tick, building, need_kind)
    } else {
        let workers = onsite_building_labor(ctx, building);
        (workers > 0).then_some((building.id, workers))
    };
    let Some((stall_workplace_id, delivery_workers)) = stall_workplace else {
        return false;
    };
    let per_worker_amount = match dispatch.exact_load_amount {
        Some(amount) if amount.is_finite() && amount > 1e-6 => {
            amount / delivery_workers.max(1) as f64
        }
        Some(_) => return false,
        None => per_delivery_amount,
    };
    let (speed_mps, unload_seconds) = match need_kind {
        ResidenceNeedKind::Firewood => (FIREWOOD_DELIVERY_SPEED_MPS, FIREWOOD_DELIVERY_UNLOAD_SEC),
        ResidenceNeedKind::Food => (FOOD_DELIVERY_SPEED_MPS, FOOD_DELIVERY_UNLOAD_SEC),
        ResidenceNeedKind::Water => (WATER_DELIVERY_SPEED_MPS, WATER_DELIVERY_UNLOAD_SEC),
        ResidenceNeedKind::PreservedFood | ResidenceNeedKind::Ale => {
            (FOOD_DELIVERY_SPEED_MPS, FOOD_DELIVERY_UNLOAD_SEC)
        }
        ResidenceNeedKind::Cloth | ResidenceNeedKind::Pottery => {
            (TIMBER_DELIVERY_SPEED_MPS, TIMBER_DELIVERY_UNLOAD_SEC)
        }
        ResidenceNeedKind::Church | ResidenceNeedKind::FoodVariety => return false,
    };

    if building.kind == "marketplace" {
        try_start_market_stall_delivery_trip(
            ctx,
            tick,
            clock,
            network,
            building,
            stall_workplace_id,
            delivery_workers,
            &targets,
            need_kind,
            speed_mps,
            unload_seconds,
            per_worker_amount,
        )
    } else {
        dispatch_delivery_if_ready(
            ctx,
            tick,
            clock,
            network,
            building,
            delivery_workers,
            &targets,
            DeliveryDispatchConfig {
                need_kind,
                speed_mps,
                unload_seconds,
                per_delivery: per_worker_amount,
            },
        )
    }
}

fn marketplace_stall_workplace(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    marketplace: &Building,
    need_kind: ResidenceNeedKind,
) -> Option<(u64, u32)> {
    let workplace_kind = match need_kind {
        ResidenceNeedKind::Food | ResidenceNeedKind::PreservedFood | ResidenceNeedKind::Ale => {
            "granary"
        }
        ResidenceNeedKind::Firewood | ResidenceNeedKind::Cloth | ResidenceNeedKind::Pottery => {
            "village_storehouse"
        }
        ResidenceNeedKind::Water | ResidenceNeedKind::Church | ResidenceNeedKind::FoodVariety => {
            return None
        }
    };
    let network = tick.road_network(marketplace.owner)?;
    tick.building_ids_for_kinds(ctx, marketplace.owner, &[workplace_kind])
        .into_iter()
        .filter_map(|id| ctx.db.building().id().find(&id))
        .filter(|workplace| {
            workplace.construction_complete
                && workplace.assigned_labor > 0
                && !tick.building_disabled_by_fire(ctx, workplace.id)
        })
        .filter_map(|workplace| {
            let workers = onsite_building_labor(ctx, &workplace);
            let distance = crate::simulation::road_logistics::local_delivery_distance(
                network,
                workplace.x,
                workplace.z,
                marketplace.x,
                marketplace.z,
            )?;
            (workers > 0).then_some((workplace.id, workers, distance))
        })
        .min_by(|a, b| a.2.total_cmp(&b.2).then_with(|| a.0.cmp(&b.0)))
        .map(|(id, workers, _)| (id, workers))
}

fn try_dispatch_marketplace_remedies(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    marketplace: &mut Building,
) -> bool {
    let workplace = if marketplace.kind == "trading_post" {
        let workers = onsite_building_labor(ctx, marketplace);
        (workers > 0).then_some((marketplace.id, workers))
    } else {
        marketplace_stall_workplace(ctx, tick, marketplace, ResidenceNeedKind::Cloth)
    };
    let Some((stall_workplace_id, delivery_workers)) = workplace else {
        return false;
    };
    let Some(network) = tick.road_network(marketplace.owner) else {
        return false;
    };
    let residences: Vec<Residence> = ctx
        .db
        .residence()
        .owner()
        .filter(&marketplace.owner)
        .filter(|residence| !tick.residence_disabled_by_fire(ctx, residence.id))
        .collect();
    let Some(target) =
        select_residence_for_remedy_delivery(network, marketplace, residences, |residence_id| {
            residence_has_inbound_remedy_trip(ctx, residence_id)
        })
    else {
        return false;
    };
    try_start_market_stall_remedy_trip(
        ctx,
        tick,
        clock,
        network,
        marketplace,
        stall_workplace_id,
        delivery_workers,
        &target,
    )
}

pub fn step_marketplace_caravans(
    ctx: &ReducerContext,
    clock: &GameClock,
    tick: &SimTickContext,
    environment: EnvironmentState,
) {
    let marketplace_ids: Vec<u64> = ctx
        .db
        .building()
        .iter()
        .filter(|building| {
            matches!(building.kind.as_str(), "marketplace" | "trading_post")
                && building.construction_complete
                && !tick.building_disabled_by_fire(ctx, building.id)
                && ((building.kind == "marketplace"
                    && (building.firewood > 1e-6
                        || building_edible_food_stock(building) > 1e-6
                        || building.ale > 1e-6
                        || building.cloth > 1e-6
                        || building.pottery > 1e-6
                        || building.remedies > 1e-6
                        || building.gold > 1e-6))
                    || (building.kind == "trading_post"
                        && building.assigned_labor > 0
                        && (building.action_cooldown > 1e-6
                            || building.marketplace_seed_grain_target > 0
                            || building.marketplace_ironwork_target > 0
                            || building.marketplace_iron_target > 0
                            || building.marketplace_salt_target > 0
                            || marketplace_gold_reserve_shortfall(
                                building.gold,
                                0.0,
                                building.marketplace_gold_reserve_target,
                            ) > 1e-6
                            || building.marketplace_pending_trade_code != 0
                            || building_edible_food_stock(building) > 1e-6
                            || building.water > 1e-6
                            || building.firewood > 1e-6
                            || building.remedies > 1e-6
                            || building.ale > 1e-6
                            || building.honey > 1e-6
                            || building.wine > 1e-6
                            || building.cloth > 1e-6
                            || building.cheese > 1e-6
                            || building.pottery > 1e-6
                            || building.gold > 1e-6)))
        })
        .map(|building| building.id)
        .collect();

    for building_id in marketplace_ids {
        let is_trading_post = ctx
            .db
            .building()
            .id()
            .find(&building_id)
            .is_some_and(|building| building.kind == "trading_post");
        if is_trading_post && clock.sim_tick % 5 == building_id % 5 {
            let has_pending_order = ctx
                .db
                .building()
                .id()
                .find(&building_id)
                .is_some_and(|building| building.marketplace_pending_trade_code != 0);
            if has_pending_order {
                try_advance_pending_marketplace_trade(
                    ctx,
                    tick,
                    clock,
                    building_id,
                    environment.road_speed_multiplier(),
                );
            } else {
                try_execute_standing_marketplace_import(
                    ctx,
                    tick,
                    clock,
                    building_id,
                    environment.road_speed_multiplier(),
                );
            }
            try_dispatch_marketplace_cash_reserve(ctx, tick, clock, building_id);
        }
        let Some(mut building) = ctx.db.building().id().find(&building_id) else {
            continue;
        };
        let mut changed = false;
        if is_trading_post
            && building.action_cooldown > 1e-6
            && onsite_building_labor(ctx, &building) > 0
            && !labor_and_logistics_paused(ctx, tick, building.owner, clock)
        {
            building.action_cooldown = (building.action_cooldown - TICK_DT).max(0.0);
            changed = true;
        }
        // Routine household goods are allocated from Marketplace stock in one
        // owner-wide availability pass. No market-to-home cart departs here.
        if building.remedies > 1e-6 {
            changed |= try_dispatch_marketplace_remedies(ctx, tick, clock, &mut building);
        }
        // Public bulk provisions unload at the Trading Post, then its own
        // staffed broker carts carry them to road-linked homes. This closes
        // the physical import chain without pretending that cargo teleports
        // into a Marketplace or well.
        if is_trading_post && !building_has_active_trip(ctx, building.id) {
            let needs = [
                (ResidenceNeedKind::Food, MARKET_CARAVAN_FOOD_PER_DELIVERY),
                (ResidenceNeedKind::Water, MARKET_CARAVAN_WATER_PER_DELIVERY),
                (
                    ResidenceNeedKind::Firewood,
                    crate::balance_generated::MARKET_CARAVAN_FIREWOOD_PER_DELIVERY,
                ),
                (
                    ResidenceNeedKind::Ale,
                    crate::balance_generated::MARKET_CARAVAN_ALE_PER_DELIVERY,
                ),
                (
                    ResidenceNeedKind::Cloth,
                    crate::balance_generated::MARKET_CARAVAN_CLOTH_PER_DELIVERY,
                ),
                (
                    ResidenceNeedKind::Pottery,
                    crate::balance_generated::MARKET_CARAVAN_POTTERY_PER_DELIVERY,
                ),
            ];
            let start = (clock.sim_tick as usize) % needs.len();
            for offset in 0..needs.len() {
                let (need, amount) = needs[(start + offset) % needs.len()];
                if try_dispatch_marketplace_caravan(
                    ctx,
                    clock,
                    tick,
                    &mut building,
                    need,
                    amount,
                    MarketCaravanDispatch::default(),
                ) {
                    changed = true;
                    break;
                }
            }
        }
        // Only remedies retain a targeted household trip. Ordinary stall
        // availability does not reserve granary/storehouse workers. A staffed
        // Trading Post can still launch regional exports;
        // local market tolls use a free-hauler lockbox cart to the civic seat.
        if is_trading_post && !building_has_regional_market_trip(ctx, building.id) {
            changed |= sell_marketplace_specialties(ctx, tick, clock, &mut building);
        }
        if is_trading_post && private_export_proceeds(&building) > 1e-6 {
            changed |= try_dispatch_private_export_income(ctx, tick, clock, &mut building);
        }
        let unpledged_gold = (building.gold - private_export_proceeds(&building)).max(0.0);
        let collectible_gold = if is_trading_post {
            marketplace_gold_sweep_surplus(unpledged_gold, building.marketplace_gold_reserve_target)
        } else if unpledged_gold + 1e-9 >= LOCAL_MARKET_TAX_CART_THRESHOLD
            || (clock.hour == 18 && clock.minute < 15)
        {
            // Batch local tolls into useful carts, with one early-evening
            // sweep so a quiet market never strands its final small balance.
            unpledged_gold
        } else {
            0.0
        };
        if collectible_gold > 1e-6 && !building_has_active_trip(ctx, building.id) {
            changed |= try_dispatch_marketplace_proceeds(
                ctx,
                tick,
                clock,
                &mut building,
                collectible_gold,
            );
        }
        if changed {
            ctx.db.building().id().update(building);
        }
    }
}

fn try_dispatch_marketplace_cash_reserve(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    marketplace_id: u64,
) -> bool {
    let Some(marketplace) = ctx.db.building().id().find(&marketplace_id) else {
        return false;
    };
    let physical_economy = ctx
        .db
        .player_resources()
        .owner()
        .find(&marketplace.owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled);
    if !physical_economy
        || marketplace.marketplace_gold_reserve_target == 0
        || onsite_building_labor(ctx, &marketplace) == 0
        || labor_and_logistics_paused(ctx, tick, marketplace.owner, clock)
        || building_has_inbound_commodity_trip(ctx, marketplace.id, CommodityKind::Gold)
    {
        return false;
    }
    let shortfall = marketplace_gold_reserve_shortfall(
        marketplace.gold,
        0.0,
        marketplace.marketplace_gold_reserve_target,
    );
    let spendable_gold = treasury_gold(ctx, marketplace.owner);
    if shortfall <= 1e-6 || spendable_gold <= 1e-6 {
        return false;
    }
    let Some(network) = tick.road_network(marketplace.owner) else {
        return false;
    };

    for source_id in tick.building_ids_for_kinds(ctx, marketplace.owner, MARKETPLACE_TREASURY_KINDS)
    {
        let Some(mut source) = ctx.db.building().id().find(&source_id) else {
            continue;
        };
        if !source.construction_complete
            || source.gold <= 1e-6
            || building_has_active_trip(ctx, source.id)
        {
            continue;
        }
        let load = shortfall
            .min(source.gold)
            .min(spendable_gold)
            .min(STOREHOUSE_HAUL_PER_WORKER);
        if load <= 1e-6 {
            return false;
        }
        if try_start_building_supply_trip(
            ctx,
            tick,
            clock,
            network,
            &mut source,
            &marketplace,
            1,
            CommodityKind::Gold,
            TIMBER_DELIVERY_SPEED_MPS,
            TIMBER_DELIVERY_UNLOAD_SEC,
            STOREHOUSE_HAUL_PER_WORKER,
            load,
        ) {
            ctx.db.building().id().update(source);
            return true;
        }
    }
    false
}

fn sell_marketplace_specialties(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    building: &mut Building,
) -> bool {
    let onsite_labor = onsite_building_labor(ctx, building);
    if onsite_labor == 0
        || labor_and_logistics_paused(ctx, tick, building.owner, clock)
        || (building.ale <= 1e-6
            && building.honey <= 1e-6
            && building.wine <= 1e-6
            && building.cloth <= 1e-6
            && building.cheese <= 1e-6
            && building.pottery <= 1e-6)
    {
        return false;
    }
    let market = ctx
        .db
        .market_state()
        .owner()
        .find(&building.owner)
        .map(|state| state);
    let Some(network) = tick.road_network(building.owner) else {
        return false;
    };
    if network.nearest_distance(building.x, building.z) > BUILDING_ROAD_ACCESS_DISTANCE {
        return false;
    }

    let physical_economy = ctx
        .db
        .player_resources()
        .owner()
        .find(&building.owner)
        .is_some_and(|resources| resources.physical_founding_site_enabled);
    if physical_economy {
        if building.marketplace_pending_trade_code != 0
            || building_has_regional_market_trip(ctx, building.id)
        {
            return false;
        }
        let export_workers = specialty_export_workers(onsite_labor, building.action_cooldown);
        if export_workers == 0 {
            return false;
        }
        let Ok(route) = regional_market_export_route(ctx, network, building) else {
            return false;
        };
        let specialties = [
            CommodityKind::Ale,
            CommodityKind::Honey,
            CommodityKind::Wine,
            CommodityKind::Cloth,
            CommodityKind::Cheese,
            CommodityKind::Pottery,
        ];
        for index in specialty_export_order(clock.sim_tick) {
            let commodity = specialties[index];
            let market_rate = market
                .as_ref()
                .and_then(|state| specialty_price_multiplier_for_commodity(state, commodity))
                .unwrap_or(1.0);
            let policy = specialty_export_policy_for(building, commodity);
            if !specialty_export_policy_allows(policy, market_rate) {
                continue;
            }
            let available = building_commodity_stock(building, commodity);
            let load = regional_export_cart_load(available);
            if load <= 1e-6 {
                continue;
            }
            let withdrawn = withdraw_building_commodity(building, commodity, load);
            if withdrawn <= 1e-6 {
                continue;
            }
            if start_regional_market_export_trip(
                ctx,
                tick,
                network,
                building,
                0,
                commodity,
                withdrawn,
                TIMBER_DELIVERY_SPEED_MPS,
                TIMBER_DELIVERY_UNLOAD_SEC,
                route,
            ) {
                return true;
            }
            crate::economy::deposit_building_commodity(building, commodity, withdrawn);
            return false;
        }
        return false;
    }

    let mut remaining = specialty_export_capacity(onsite_labor, building.action_cooldown, TICK_DT);
    if remaining <= 1e-6 {
        return false;
    }
    let specialties = [
        (CommodityKind::Ale, SPECIALTY_EXPORT_GOLD_PER_ALE),
        (CommodityKind::Honey, SPECIALTY_EXPORT_GOLD_PER_HONEY),
        (CommodityKind::Wine, SPECIALTY_EXPORT_GOLD_PER_WINE),
        (CommodityKind::Cloth, SPECIALTY_EXPORT_GOLD_PER_CLOTH),
        (CommodityKind::Cheese, SPECIALTY_EXPORT_GOLD_PER_CHEESE),
        (CommodityKind::Pottery, SPECIALTY_EXPORT_GOLD_PER_POTTERY),
    ];
    let mut revenue = 0.0;
    for index in specialty_export_order(clock.sim_tick) {
        let (commodity, gold_per_unit) = specialties[index];
        let market_rate = market
            .as_ref()
            .and_then(|state| specialty_price_multiplier_for_commodity(state, commodity))
            .unwrap_or(1.0);
        let policy = specialty_export_policy_for(building, commodity);
        if !specialty_export_policy_allows(policy, market_rate) {
            continue;
        }
        let available = building_commodity_stock(building, commodity);
        let sold = withdraw_building_commodity(building, commodity, available.min(remaining));
        revenue += sold * gold_per_unit * market_rate;
        record_specialty_market_export(ctx, building.owner, commodity, sold);
        remaining -= sold;
        if remaining <= 1e-6 {
            break;
        }
    }
    credit_private_export_receipt(ctx, building, revenue);
    revenue > 1e-6
}

fn specialty_export_policy_for(building: &Building, commodity: CommodityKind) -> u8 {
    let family_policy = match specialty_family_for_commodity(commodity) {
        Some(SpecialtyMarketFamily::Drink) => building.marketplace_drink_export_policy,
        Some(SpecialtyMarketFamily::Provision) => building.marketplace_provision_export_policy,
        Some(SpecialtyMarketFamily::Wares) => building.marketplace_wares_export_policy,
        None => building.marketplace_specialty_export_policy,
    };
    resolved_specialty_family_policy(family_policy, building.marketplace_specialty_export_policy)
}

fn try_dispatch_marketplace_proceeds(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    marketplace: &mut Building,
    collectible_gold: f64,
) -> bool {
    if building_has_active_trip(ctx, marketplace.id) {
        return false;
    }
    let load = marketplace_proceeds_cart_load(collectible_gold);
    if load <= 1e-6 {
        return false;
    }
    let Some(target) = physical_treasury_seat(ctx, marketplace.owner) else {
        return false;
    };
    if target.id == marketplace.id {
        return false;
    }
    let Some(network) = tick.road_network(marketplace.owner) else {
        return false;
    };
    let before = marketplace.gold;
    let started = try_start_free_building_supply_trip(
        ctx,
        tick,
        clock,
        network,
        marketplace,
        &target,
        CommodityKind::Gold,
        TIMBER_DELIVERY_SPEED_MPS,
        TIMBER_DELIVERY_UNLOAD_SEC,
        STOREHOUSE_HAUL_PER_WORKER,
        load,
    );
    if started {
        mark_local_civic_receipts_dispatched(marketplace, (before - marketplace.gold).max(0.0));
    }
    started
}

fn try_dispatch_private_export_income(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    trading_post: &mut Building,
) -> bool {
    if building_has_active_trip(ctx, trading_post.id)
        || private_export_proceeds(trading_post) <= 1e-6
    {
        return false;
    }
    let Some(network) = tick.road_network(trading_post.owner) else {
        return false;
    };
    let target = ctx
        .db
        .residence()
        .owner()
        .filter(&trading_post.owner)
        .filter(|residence| {
            residence.population > 0
                && !residence.abandoned
                && residence.household_wealth < HOUSEHOLD_MAX_WEALTH - 1e-9
                && !tick.residence_disabled_by_fire(ctx, residence.id)
                && !residence_has_inbound_wealth_trip(ctx, residence.id)
        })
        .filter_map(|residence| {
            local_delivery_distance(
                network,
                trading_post.x,
                trading_post.z,
                residence.x,
                residence.z,
            )
            .map(|distance| (residence, distance))
        })
        .min_by(|(residence_a, distance_a), (residence_b, distance_b)| {
            residence_a
                .household_wealth
                .partial_cmp(&residence_b.household_wealth)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| {
                    distance_a
                        .partial_cmp(distance_b)
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .then_with(|| residence_a.id.cmp(&residence_b.id))
        })
        .map(|(residence, _)| residence);
    let Some(residence) = target else {
        return false;
    };
    try_start_private_export_income_trip(
        ctx,
        tick,
        clock,
        network,
        trading_post,
        &residence,
        PRIVATE_EXPORT_INCOME_CART_LOAD,
    ) > 1e-6
}
