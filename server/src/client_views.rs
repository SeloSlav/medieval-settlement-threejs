//! Clients can only subscribe to these identity-scoped views; backing tables are private.
use spacetimedb::ViewContext;
use crate::db::*;
use crate::tables::*;

#[spacetimedb::view(accessor = visible_player_resources, public, primary_key = owner)]
pub fn visible_player_resources(ctx: &ViewContext) -> Vec<PlayerResources> {
    ctx.db.player_resources().owner().find(ctx.sender()).into_iter().collect()
}

#[spacetimedb::view(accessor = visible_settlement, public, primary_key = id)]
pub fn visible_settlement(ctx: &ViewContext) -> Vec<Settlement> {
    ctx.db.settlement().owner().filter(ctx.sender()).collect()
}

#[spacetimedb::view(accessor = visible_quarry, public, primary_key = quarry_id)]
pub fn visible_quarry(ctx: &ViewContext) -> Vec<Quarry> {
    if !crate::realm::ENABLED { return ctx.db.quarry().chunk_id().filter(0u32..=u32::MAX).collect(); }
    let mut rows = std::collections::BTreeMap::new();
    for chunk in crate::realm::interested_chunks(ctx) {
        for row in ctx.db.quarry().chunk_id().filter(chunk) {
            if crate::realm::visible_to(ctx, row.x, row.z) { rows.insert(row.quarry_id.clone(), row); }
        }
    }
    rows.into_values().collect()
}

#[spacetimedb::view(accessor = visible_foraging_node, public, primary_key = node_id)]
pub fn visible_foraging_node(ctx: &ViewContext) -> Vec<ForagingNode> {
    if !crate::realm::ENABLED { return ctx.db.foraging_node().chunk_id().filter(0u32..=u32::MAX).collect(); }
    let mut rows = std::collections::BTreeMap::new();
    for chunk in crate::realm::interested_chunks(ctx) {
        for row in ctx.db.foraging_node().chunk_id().filter(chunk) {
            if crate::realm::visible_to(ctx, row.x, row.z) { rows.insert(row.node_id.clone(), row); }
        }
    }
    rows.into_values().collect()
}

#[spacetimedb::view(accessor = visible_tree_entity, public, primary_key = tree_id)]
pub fn visible_tree_entity(ctx: &ViewContext) -> Vec<TreeEntity> {
    if !crate::realm::ENABLED { return ctx.db.tree_entity().chunk_id().filter(0u32..=u32::MAX).collect(); }
    let mut rows = std::collections::BTreeMap::new();
    for chunk in crate::realm::interested_chunks(ctx) {
        for row in ctx.db.tree_entity().chunk_id().filter(chunk) {
            if crate::realm::visible_to(ctx, row.x, row.z) { rows.insert(row.tree_id.clone(), row); }
        }
    }
    rows.into_values().collect()
}

#[spacetimedb::view(accessor = visible_building, public, primary_key = id)]
pub fn visible_building(ctx: &ViewContext) -> Vec<Building> {
    ctx.db.building().owner().filter(ctx.sender()).collect()
}

#[spacetimedb::view(accessor = visible_trading_post_trade_rule, public, primary_key = id)]
pub fn visible_trading_post_trade_rule(ctx: &ViewContext) -> Vec<TradingPostTradeRule> {
    ctx.db.trading_post_trade_rule().owner().filter(ctx.sender()).collect()
}

#[spacetimedb::view(accessor = visible_farm_field, public, primary_key = id)]
pub fn visible_farm_field(ctx: &ViewContext) -> Vec<FarmField> {
    ctx.db.farm_field().owner().filter(ctx.sender()).collect()
}

#[spacetimedb::view(accessor = visible_vineyard_parcel, public, primary_key = id)]
pub fn visible_vineyard_parcel(ctx: &ViewContext) -> Vec<VineyardParcel> {
    ctx.db.vineyard_parcel().owner().filter(ctx.sender()).collect()
}

#[spacetimedb::view(accessor = visible_pasture, public, primary_key = id)]
pub fn visible_pasture(ctx: &ViewContext) -> Vec<Pasture> {
    ctx.db.pasture().owner().filter(ctx.sender()).collect()
}

#[spacetimedb::view(accessor = visible_graveyard, public, primary_key = id)]
pub fn visible_graveyard(ctx: &ViewContext) -> Vec<Graveyard> {
    ctx.db.graveyard().owner().filter(ctx.sender()).collect()
}

#[spacetimedb::view(accessor = visible_pasture_herd, public, primary_key = pasture_id)]
pub fn visible_pasture_herd(ctx: &ViewContext) -> Vec<PastureHerd> {
    ctx.db.pasture_herd().owner().filter(ctx.sender()).collect()
}

#[spacetimedb::view(accessor = visible_livestock_herd, public, primary_key = building_id)]
pub fn visible_livestock_herd(ctx: &ViewContext) -> Vec<LivestockHerd> {
    ctx.db.livestock_herd().owner().filter(ctx.sender()).collect()
}

#[spacetimedb::view(accessor = visible_stable_ox, public, primary_key = id)]
pub fn visible_stable_ox(ctx: &ViewContext) -> Vec<StableOx> {
    ctx.db.stable_ox().owner().filter(ctx.sender()).collect()
}

#[spacetimedb::view(accessor = visible_cavalry_horse, public, primary_key = id)]
pub fn visible_cavalry_horse(ctx: &ViewContext) -> Vec<CavalryHorse> {
    ctx.db.cavalry_horse().owner().filter(ctx.sender()).collect()
}

#[spacetimedb::view(accessor = visible_road_network_state, public, primary_key = owner)]
pub fn visible_road_network_state(ctx: &ViewContext) -> Vec<RoadNetworkState> {
    ctx.db.road_network_state().owner().find(ctx.sender()).into_iter().collect()
}

#[spacetimedb::view(accessor = visible_burgage_zone, public, primary_key = id)]
pub fn visible_burgage_zone(ctx: &ViewContext) -> Vec<BurgageZone> {
    ctx.db.burgage_zone().owner().filter(ctx.sender()).collect()
}

#[spacetimedb::view(accessor = visible_residence, public, primary_key = id)]
pub fn visible_residence(ctx: &ViewContext) -> Vec<Residence> {
    ctx.db.residence().owner().filter(ctx.sender()).collect()
}

#[spacetimedb::view(accessor = visible_backyard_garden, public, primary_key = id)]
pub fn visible_backyard_garden(ctx: &ViewContext) -> Vec<BackyardGarden> {
    ctx.db.backyard_garden().owner().filter(ctx.sender()).collect()
}

#[spacetimedb::view(accessor = visible_corpse, public, primary_key = id)]
pub fn visible_corpse(ctx: &ViewContext) -> Vec<Corpse> {
    ctx.db.corpse().owner().filter(ctx.sender()).collect()
}

#[spacetimedb::view(accessor = visible_market_state, public, primary_key = owner)]
pub fn visible_market_state(ctx: &ViewContext) -> Vec<MarketState> {
    ctx.db.market_state().owner().find(ctx.sender()).into_iter().collect()
}

#[spacetimedb::view(accessor = visible_settlement_security, public, primary_key = owner)]
pub fn visible_settlement_security(ctx: &ViewContext) -> Vec<SettlementSecurity> {
    ctx.db.settlement_security().owner().find(ctx.sender()).into_iter().collect()
}

#[spacetimedb::view(accessor = visible_active_raid, public, primary_key = owner)]
pub fn visible_active_raid(ctx: &ViewContext) -> Vec<ActiveRaid> {
    ctx.db.active_raid().owner().find(ctx.sender()).into_iter().collect()
}

#[spacetimedb::view(accessor = visible_combat_agent, public, primary_key = id)]
pub fn visible_combat_agent(ctx: &ViewContext) -> Vec<CombatAgent> {
    ctx.db.combat_agent().owner().filter(ctx.sender())
        .filter(|a| a.faction == 0 || a.faction >= 3 || crate::realm::visible_to(ctx, a.x, a.z)).collect()
}

#[spacetimedb::view(accessor = visible_delivery_trip, public, primary_key = id)]
pub fn visible_delivery_trip(ctx: &ViewContext) -> Vec<DeliveryTrip> {
    ctx.db.delivery_trip().owner().filter(ctx.sender()).collect()
}

#[spacetimedb::view(accessor = visible_bandit_camp, public, primary_key = id)]
pub fn visible_bandit_camp(ctx: &ViewContext) -> Vec<BanditCamp> {
    ctx.db.bandit_camp().owner().filter(ctx.sender()).collect()
}

#[spacetimedb::view(accessor = visible_bandit_incident, public, primary_key = id)]
pub fn visible_bandit_incident(ctx: &ViewContext) -> Vec<BanditIncident> {
    ctx.db.bandit_incident().owner().filter(ctx.sender()).collect()
}

#[spacetimedb::view(accessor = visible_military_company, public, primary_key = id)]
pub fn visible_military_company(ctx: &ViewContext) -> Vec<MilitaryCompany> {
    ctx.db.military_company().owner().filter(ctx.sender()).collect()
}

#[spacetimedb::view(accessor = visible_mercenary_contract, public, primary_key = company_id)]
pub fn visible_mercenary_contract(ctx: &ViewContext) -> Vec<MercenaryContract> {
    ctx.db.mercenary_contract().owner().filter(ctx.sender()).collect()
}

#[spacetimedb::view(accessor = visible_fire_incident, public, primary_key = id)]
pub fn visible_fire_incident(ctx: &ViewContext) -> Vec<FireIncident> {
    ctx.db.fire_incident().owner().filter(ctx.sender()).collect()
}

#[spacetimedb::view(accessor = visible_residence_need, public, primary_key = id)]
pub fn visible_residence_need(ctx: &ViewContext) -> Vec<ResidenceNeed> {
    ctx.db.residence_need().owner().filter(ctx.sender()).collect()
}
