//! Simulated regional market — price multipliers drift from neighbor trade and local demand.

use spacetimedb::{Identity, ReducerContext};

use crate::balance_generated::{
    TradeResource, MARKET_LOCAL_FOOD_DEMAND_WEIGHT, MARKET_PRICE_UPDATE_INTERVAL_TICKS,
};
use crate::db::*;
use crate::economy::{household_food_units_per_day_for_tier, CommodityKind};
use crate::simulation::game_clock;
use crate::simulation::residence_needs::{load_needs, need_stock, ResidenceNeedKind};
use crate::specialty_trade_policy::SpecialtyMarketFamily;
use crate::tables::MarketState;

use super::regional_market_policy::{
    adjust_demand_index, adjust_supply_index, drift_market_index, drift_market_index_toward,
    market_price_multiplier, specialty_price_multiplier, specialty_seasonal_demand_target,
    MarketTradeDirection,
};

pub fn ensure_market_state(ctx: &ReducerContext, owner: Identity) {
    if ctx.db.market_state().owner().find(&owner).is_some() {
        return;
    }
    ctx.db.market_state().insert(MarketState {
        owner,
        timber_price_mult: 1.0,
        stone_price_mult: 1.0,
        firewood_price_mult: 1.0,
        food_price_mult: 1.0,
        regional_timber_supply: 0.5,
        regional_stone_supply: 0.5,
        regional_firewood_demand: 0.5,
        regional_food_demand: 0.5,
        regional_food_supply: 0.5,
        last_price_tick: 0,
        bulletin: "Caravans from Kvarner and Lika report steady trade.".to_string(),
        specialty_price_mult: 1.0,
        regional_specialty_demand: 0.5,
        drink_price_mult: 1.0,
        provision_price_mult: 1.0,
        wares_price_mult: 1.0,
        regional_drink_demand: 0.5,
        regional_provision_demand: 0.5,
        regional_wares_demand: 0.5,
    });
}

pub fn price_multiplier_for(state: &MarketState, resource: TradeResource) -> f64 {
    match resource {
        TradeResource::Timber => state.timber_price_mult,
        TradeResource::Stone
        | TradeResource::Ironwork
        | TradeResource::Polearms
        | TradeResource::Iron
        | TradeResource::Clay
        | TradeResource::RoofTiles => state.stone_price_mult,
        TradeResource::Firewood | TradeResource::Water | TradeResource::Charcoal => {
            state.firewood_price_mult
        }
        TradeResource::RyeSheaves
        | TradeResource::OatSheaves
        | TradeResource::BarleySheaves
        | TradeResource::MaslinSheaves
        | TradeResource::RyeGrain
        | TradeResource::OatGrain
        | TradeResource::MaslinGrain
        | TradeResource::RyeFlour
        | TradeResource::MaslinFlour
        | TradeResource::RyeBread
        | TradeResource::MaslinBread
        | TradeResource::Barley
        | TradeResource::Malt
        | TradeResource::Flax
        | TradeResource::Salt
        | TradeResource::Meat
        | TradeResource::Fish
        | TradeResource::Berries
        | TradeResource::Mushrooms
        | TradeResource::Milk
        | TradeResource::Apples
        | TradeResource::Pears
        | TradeResource::Cherries
        | TradeResource::Aronia
        | TradeResource::Rosehips
        | TradeResource::Cabbage
        | TradeResource::Carrots
        | TradeResource::Beetroot
        | TradeResource::Eggs
        | TradeResource::Grapes => state.food_price_mult,
        TradeResource::Ale
        | TradeResource::Cider
        | TradeResource::Cider
        | TradeResource::Wine => state.drink_price_mult,
        TradeResource::Honey
        | TradeResource::CuredMeat
        | TradeResource::SmokedFish
        | TradeResource::Cheese
        | TradeResource::Jam
        | TradeResource::Jam => state.provision_price_mult,
        TradeResource::Wool
        | TradeResource::Yarn
        | TradeResource::Linen
        | TradeResource::Cloth
        | TradeResource::Wax
        | TradeResource::Candles
        | TradeResource::Pelts
        | TradeResource::Hides
        | TradeResource::Leather
        | TradeResource::Shoes
        | TradeResource::Sidearms
        | TradeResource::Shields
        | TradeResource::Bows
        | TradeResource::Crossbows
        | TradeResource::PaddedArmor
        | TradeResource::MailArmor
        | TradeResource::Ammunition
        | TradeResource::Pottery
        | TradeResource::Manure
        | TradeResource::Remedies => state.wares_price_mult,
    }
}

pub fn step_regional_markets(ctx: &ReducerContext, sim_tick: u64) {
    let owners: Vec<Identity> = ctx
        .db
        .player_resources()
        .iter()
        .map(|row| row.owner)
        .collect();

    for owner in owners {
        ensure_market_state(ctx, owner);
        let Some(mut state) = ctx.db.market_state().owner().find(&owner) else {
            continue;
        };
        if sim_tick.saturating_sub(state.last_price_tick) < MARKET_PRICE_UPDATE_INTERVAL_TICKS {
            continue;
        }
        update_market_state(ctx, owner, sim_tick, &mut state);
        ctx.db.market_state().owner().update(state);
    }
}

fn update_market_state(
    ctx: &ReducerContext,
    owner: Identity,
    sim_tick: u64,
    state: &mut MarketState,
) {
    let seed = sim_tick
        .wrapping_mul(0x9E37_79B9)
        .wrapping_add(hash_identity(owner));

    state.regional_timber_supply = drift_index(state.regional_timber_supply, seed.wrapping_add(1));
    state.regional_stone_supply = drift_index(state.regional_stone_supply, seed.wrapping_add(2));
    state.regional_firewood_demand =
        drift_index(state.regional_firewood_demand, seed.wrapping_add(3));
    state.regional_food_demand = drift_index(state.regional_food_demand, seed.wrapping_add(4));
    state.regional_food_supply = drift_index(state.regional_food_supply, seed.wrapping_add(5));
    let month = game_clock(sim_tick).month;
    state.regional_drink_demand = drift_specialty_index(
        state.regional_drink_demand,
        SpecialtyMarketFamily::Drink,
        month,
        seed.wrapping_add(6),
    );
    state.regional_provision_demand = drift_specialty_index(
        state.regional_provision_demand,
        SpecialtyMarketFamily::Provision,
        month,
        seed.wrapping_add(7),
    );
    state.regional_wares_demand = drift_specialty_index(
        state.regional_wares_demand,
        SpecialtyMarketFamily::Wares,
        month,
        seed.wrapping_add(8),
    );

    refresh_market_prices(ctx, owner, state);
    state.last_price_tick = sim_tick;
}

pub fn record_market_trade(
    ctx: &ReducerContext,
    owner: Identity,
    resource: TradeResource,
    direction: MarketTradeDirection,
    amount: f64,
) {
    if amount <= 1e-9 {
        return;
    }

    ensure_market_state(ctx, owner);
    let Some(mut state) = ctx.db.market_state().owner().find(&owner) else {
        return;
    };

    match resource {
        TradeResource::Timber => {
            state.regional_timber_supply =
                adjust_supply_index(state.regional_timber_supply, direction, amount);
        }
        TradeResource::Stone
        | TradeResource::Ironwork
        | TradeResource::Polearms
        | TradeResource::Iron
        | TradeResource::Clay
        | TradeResource::RoofTiles => {
            state.regional_stone_supply =
                adjust_supply_index(state.regional_stone_supply, direction, amount);
        }
        TradeResource::Firewood | TradeResource::Water | TradeResource::Charcoal => {
            state.regional_firewood_demand =
                adjust_demand_index(state.regional_firewood_demand, direction, amount);
        }
        TradeResource::RyeSheaves
        | TradeResource::OatSheaves
        | TradeResource::BarleySheaves
        | TradeResource::MaslinSheaves
        | TradeResource::RyeGrain
        | TradeResource::OatGrain
        | TradeResource::MaslinGrain
        | TradeResource::RyeFlour
        | TradeResource::MaslinFlour
        | TradeResource::RyeBread
        | TradeResource::MaslinBread
        | TradeResource::Barley
        | TradeResource::Malt
        | TradeResource::Flax
        | TradeResource::Salt
        | TradeResource::Meat
        | TradeResource::Fish
        | TradeResource::Berries
        | TradeResource::Mushrooms
        | TradeResource::Milk
        | TradeResource::Apples
        | TradeResource::Pears
        | TradeResource::Cherries
        | TradeResource::Aronia
        | TradeResource::Rosehips
        | TradeResource::Cabbage
        | TradeResource::Carrots
        | TradeResource::Beetroot
        | TradeResource::Eggs
        | TradeResource::Grapes => {
            state.regional_food_supply =
                adjust_supply_index(state.regional_food_supply, direction, amount);
        }
        TradeResource::Ale
        | TradeResource::Cider
        | TradeResource::Cider
        | TradeResource::Wine => {
            state.regional_drink_demand =
                adjust_demand_index(state.regional_drink_demand, direction, amount);
        }
        TradeResource::Honey
        | TradeResource::CuredMeat
        | TradeResource::SmokedFish
        | TradeResource::Cheese
        | TradeResource::Jam
        | TradeResource::Jam => {
            state.regional_provision_demand =
                adjust_demand_index(state.regional_provision_demand, direction, amount);
        }
        TradeResource::Wool
        | TradeResource::Yarn
        | TradeResource::Linen
        | TradeResource::Cloth
        | TradeResource::Wax
        | TradeResource::Candles
        | TradeResource::Pelts
        | TradeResource::Hides
        | TradeResource::Leather
        | TradeResource::Shoes
        | TradeResource::Sidearms
        | TradeResource::Shields
        | TradeResource::Bows
        | TradeResource::Crossbows
        | TradeResource::PaddedArmor
        | TradeResource::MailArmor
        | TradeResource::Ammunition
        | TradeResource::Pottery
        | TradeResource::Manure
        | TradeResource::Remedies => {
            state.regional_wares_demand =
                adjust_demand_index(state.regional_wares_demand, direction, amount);
        }
    }

    refresh_market_prices(ctx, owner, &mut state);
    ctx.db.market_state().owner().update(state);
}

/// Specialty exports are continuous and may occur every simulation substep.
/// Refresh only their independent rate here; the ordinary price heartbeat
/// performs the more expensive household food-pressure scan.
pub fn record_specialty_market_export(
    ctx: &ReducerContext,
    owner: Identity,
    commodity: CommodityKind,
    amount: f64,
) {
    if amount <= 1e-9 {
        return;
    }

    ensure_market_state(ctx, owner);
    let Some(mut state) = ctx.db.market_state().owner().find(&owner) else {
        return;
    };
    let Some(family) = specialty_family_for_commodity(commodity) else {
        return;
    };
    match family {
        SpecialtyMarketFamily::Drink => {
            state.regional_drink_demand = adjust_demand_index(
                state.regional_drink_demand,
                MarketTradeDirection::Export,
                amount,
            );
        }
        SpecialtyMarketFamily::Provision => {
            state.regional_provision_demand = adjust_demand_index(
                state.regional_provision_demand,
                MarketTradeDirection::Export,
                amount,
            );
        }
        SpecialtyMarketFamily::Wares => {
            state.regional_wares_demand = adjust_demand_index(
                state.regional_wares_demand,
                MarketTradeDirection::Export,
                amount,
            );
        }
    }
    refresh_specialty_prices(&mut state);
    state.bulletin = compose_bulletin(&state);
    ctx.db.market_state().owner().update(state);
}

fn refresh_market_prices(ctx: &ReducerContext, owner: Identity, state: &mut MarketState) {
    let local_food_pressure = local_food_demand_pressure(ctx, owner);
    state.timber_price_mult = market_price_multiplier(
        state.regional_timber_supply,
        1.0 - state.regional_timber_supply,
    );
    state.stone_price_mult = market_price_multiplier(
        state.regional_stone_supply,
        1.0 - state.regional_stone_supply,
    );
    state.firewood_price_mult = market_price_multiplier(
        1.0 - state.regional_firewood_demand,
        state.regional_firewood_demand,
    );
    let food_demand = (state.regional_food_demand * (1.0 - MARKET_LOCAL_FOOD_DEMAND_WEIGHT)
        + local_food_pressure * MARKET_LOCAL_FOOD_DEMAND_WEIGHT)
        .clamp(0.0, 1.0);
    state.food_price_mult = market_price_multiplier(state.regional_food_supply, food_demand);
    refresh_specialty_prices(state);

    state.bulletin = compose_bulletin(state);
}

fn local_food_demand_pressure(ctx: &ReducerContext, owner: Identity) -> f64 {
    let mut runway_days_sum = 0.0;
    let mut active = 0u32;

    for residence in ctx.db.residence().owner().filter(&owner) {
        if residence.abandoned || residence.population == 0 {
            continue;
        }
        let needs = load_needs(ctx, residence.id);
        let stock = need_stock(&needs, ResidenceNeedKind::Food);
        let use_per_day = household_food_units_per_day_for_tier(residence.tier);
        if use_per_day <= 1e-9 {
            continue;
        }
        let runway_days = stock / use_per_day;
        runway_days_sum += runway_days;
        active += 1;
    }

    if active == 0 {
        return 0.5;
    }

    let avg_runway_days = runway_days_sum / active as f64;
    // Low runway (< 0.5 days) pushes demand toward 1.0; comfortable stocks (> 4 days) toward 0.15.
    if avg_runway_days <= 0.5 {
        1.0
    } else if avg_runway_days >= 4.0 {
        0.15
    } else {
        1.0 - (avg_runway_days - 0.5) / 3.5 * 0.85
    }
}

fn drift_index(current: f64, seed: u64) -> f64 {
    drift_market_index(current, hash_to_unit(seed))
}

fn drift_specialty_index(
    current: f64,
    family: SpecialtyMarketFamily,
    month: u32,
    seed: u64,
) -> f64 {
    drift_market_index_toward(
        current,
        specialty_seasonal_demand_target(family, month),
        hash_to_unit(seed),
    )
}

fn refresh_specialty_prices(state: &mut MarketState) {
    state.drink_price_mult = specialty_price_multiplier(state.regional_drink_demand);
    state.provision_price_mult = specialty_price_multiplier(state.regional_provision_demand);
    state.wares_price_mult = specialty_price_multiplier(state.regional_wares_demand);
    state.regional_specialty_demand = (state.regional_drink_demand
        + state.regional_provision_demand
        + state.regional_wares_demand)
        / 3.0;
    state.specialty_price_mult =
        (state.drink_price_mult + state.provision_price_mult + state.wares_price_mult) / 3.0;
}

pub fn specialty_family_for_commodity(commodity: CommodityKind) -> Option<SpecialtyMarketFamily> {
    match commodity {
        CommodityKind::Ale
        | CommodityKind::Cider
        | CommodityKind::Cider
        | CommodityKind::Wine => Some(SpecialtyMarketFamily::Drink),
        CommodityKind::Honey
        | CommodityKind::Cheese
        | CommodityKind::Jam
        | CommodityKind::Jam => Some(SpecialtyMarketFamily::Provision),
        CommodityKind::Cloth | CommodityKind::Shoes | CommodityKind::Pottery => {
            Some(SpecialtyMarketFamily::Wares)
        }
        _ => None,
    }
}

pub fn specialty_price_multiplier_for_commodity(
    state: &MarketState,
    commodity: CommodityKind,
) -> Option<f64> {
    match specialty_family_for_commodity(commodity)? {
        SpecialtyMarketFamily::Drink => Some(state.drink_price_mult),
        SpecialtyMarketFamily::Provision => Some(state.provision_price_mult),
        SpecialtyMarketFamily::Wares => Some(state.wares_price_mult),
    }
}

fn compose_bulletin(state: &MarketState) -> String {
    if state.food_price_mult >= 1.18 {
        return "Lamb and veal scarce in the highlands — provender prices are up.".to_string();
    }
    if state.food_price_mult <= 0.88 {
        return "A surplus harvest reached Kvarner — food imports are cheap this week.".to_string();
    }
    if state.drink_price_mult >= 1.05 {
        return "Feast season is lifting demand for ale and wine.".to_string();
    }
    if state.provision_price_mult >= 1.05 {
        return "Highland households are stocking honey and cheese.".to_string();
    }
    if state.wares_price_mult >= 1.05 {
        return "Regional buyers are seeking cloth and finished pottery.".to_string();
    }
    if state.drink_price_mult <= 0.9
        && state.provision_price_mult <= 0.9
        && state.wares_price_mult <= 0.9
    {
        return "Regional buyers are well supplied across all specialty stalls.".to_string();
    }
    if state.timber_price_mult >= 1.15 {
        return "Timber merchants from Lika are paying well for oak.".to_string();
    }
    if state.stone_price_mult <= 0.85 {
        return "Quarry wagons from the coast flooded the stone market.".to_string();
    }
    if state.regional_firewood_demand >= 0.72 {
        return "Cold snaps inland are driving firewood demand.".to_string();
    }
    "Caravans from Kvarner and the nearby highlands report steady trade.".to_string()
}

fn hash_identity(owner: Identity) -> u64 {
    let bytes = owner.to_byte_array();
    u64::from_le_bytes(bytes[0..8].try_into().unwrap_or([0; 8]))
}

fn hash_to_unit(seed: u64) -> f64 {
    let mixed = seed.wrapping_mul(0x517CC1B7_27220A95);
    (mixed % 10_000) as f64 / 10_000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn balanced_supply_and_demand_are_neutral() {
        assert!((market_price_multiplier(0.5, 0.5) - 1.0).abs() < 1e-6);
    }
}
