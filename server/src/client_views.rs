//! Clients can only subscribe to these identity-scoped views; backing tables are private.
use spacetimedb::{Query, ViewContext};
use crate::db::*;
use crate::tables::*;

#[spacetimedb::view(accessor = visible_player_resources, public, primary_key = owner)]
pub fn visible_player_resources(ctx: &ViewContext) -> impl Query<PlayerResources> {
    ctx.from.player_resources().r#where(|row| row.owner.eq(ctx.sender()))
}

#[spacetimedb::view(accessor = visible_settlement, public, primary_key = id)]
pub fn visible_settlement(ctx: &ViewContext) -> impl Query<Settlement> {
    ctx.from.settlement().r#where(|row| row.owner.eq(ctx.sender()))
}

#[spacetimedb::view(accessor = visible_quarry, public, primary_key = quarry_id)]
pub fn visible_quarry(ctx: &ViewContext) -> Vec<Quarry> {
    if !crate::realm::ENABLED { return ctx.db.quarry().chunk_id().filter(0u32..=u32::MAX).collect(); }
    let visibility = crate::realm::view_visibility(ctx);
    let mut rows = std::collections::BTreeMap::new();
    for chunk in visibility.chunks() {
        for row in ctx.db.quarry().chunk_id().filter(chunk) {
            if visibility.contains(row.x, row.z) { rows.insert(row.quarry_id.clone(), row); }
        }
    }
    rows.into_values().collect()
}

#[spacetimedb::view(accessor = visible_foraging_node, public, primary_key = node_id)]
pub fn visible_foraging_node(ctx: &ViewContext) -> Vec<ForagingNode> {
    if !crate::realm::ENABLED { return ctx.db.foraging_node().chunk_id().filter(0u32..=u32::MAX).collect(); }
    let visibility = crate::realm::view_visibility(ctx);
    let mut rows = std::collections::BTreeMap::new();
    for chunk in visibility.chunks() {
        for row in ctx.db.foraging_node().chunk_id().filter(chunk) {
            if visibility.contains(row.x, row.z) { rows.insert(row.node_id.clone(), row); }
        }
    }
    rows.into_values().collect()
}

#[spacetimedb::view(accessor = visible_tree_entity, public, primary_key = tree_id)]
pub fn visible_tree_entity(ctx: &ViewContext) -> Vec<TreeEntity> {
    if !crate::realm::ENABLED { return ctx.db.tree_entity().chunk_id().filter(0u32..=u32::MAX).collect(); }
    let visibility = crate::realm::view_visibility(ctx);
    let mut rows = std::collections::BTreeMap::new();
    for chunk in visibility.chunks() {
        for row in ctx.db.tree_entity().chunk_id().filter(chunk) {
            if visibility.contains(row.x, row.z) { rows.insert(row.tree_id.clone(), row); }
        }
    }
    rows.into_values().collect()
}

#[spacetimedb::view(accessor = visible_building, public, primary_key = id)]
pub fn visible_building(ctx: &ViewContext) -> impl Query<Building> {
    ctx.from.building().r#where(|row| row.owner.eq(ctx.sender()))
}

#[spacetimedb::view(accessor = visible_trading_post_trade_rule, public, primary_key = id)]
pub fn visible_trading_post_trade_rule(ctx: &ViewContext) -> impl Query<TradingPostTradeRule> {
    ctx.from.trading_post_trade_rule().r#where(|row| row.owner.eq(ctx.sender()))
}

#[spacetimedb::view(accessor = visible_farm_field, public, primary_key = id)]
pub fn visible_farm_field(ctx: &ViewContext) -> impl Query<FarmField> {
    ctx.from.farm_field().r#where(|row| row.owner.eq(ctx.sender()))
}

#[spacetimedb::view(accessor = visible_vineyard_parcel, public, primary_key = id)]
pub fn visible_vineyard_parcel(ctx: &ViewContext) -> impl Query<VineyardParcel> {
    ctx.from.vineyard_parcel().r#where(|row| row.owner.eq(ctx.sender()))
}

#[spacetimedb::view(accessor = visible_pasture, public, primary_key = id)]
pub fn visible_pasture(ctx: &ViewContext) -> impl Query<Pasture> {
    ctx.from.pasture().r#where(|row| row.owner.eq(ctx.sender()))
}

#[spacetimedb::view(accessor = visible_graveyard, public, primary_key = id)]
pub fn visible_graveyard(ctx: &ViewContext) -> impl Query<Graveyard> {
    ctx.from.graveyard().r#where(|row| row.owner.eq(ctx.sender()))
}

#[spacetimedb::view(accessor = visible_pasture_herd, public, primary_key = pasture_id)]
pub fn visible_pasture_herd(ctx: &ViewContext) -> impl Query<PastureHerd> {
    ctx.from.pasture_herd().r#where(|row| row.owner.eq(ctx.sender()))
}

#[spacetimedb::view(accessor = visible_livestock_herd, public, primary_key = building_id)]
pub fn visible_livestock_herd(ctx: &ViewContext) -> impl Query<LivestockHerd> {
    ctx.from.livestock_herd().r#where(|row| row.owner.eq(ctx.sender()))
}

#[spacetimedb::view(accessor = visible_stable_ox, public, primary_key = id)]
pub fn visible_stable_ox(ctx: &ViewContext) -> impl Query<StableOx> {
    ctx.from.stable_ox().r#where(|row| row.owner.eq(ctx.sender()))
}

#[spacetimedb::view(accessor = visible_cavalry_horse, public, primary_key = id)]
pub fn visible_cavalry_horse(ctx: &ViewContext) -> impl Query<CavalryHorse> {
    ctx.from.cavalry_horse().r#where(|row| row.owner.eq(ctx.sender()))
}

#[spacetimedb::view(accessor = visible_road_network_state, public, primary_key = owner)]
pub fn visible_road_network_state(ctx: &ViewContext) -> impl Query<RoadNetworkState> {
    ctx.from.road_network_state().r#where(|row| row.owner.eq(ctx.sender()))
}

#[spacetimedb::view(accessor = visible_burgage_zone, public, primary_key = id)]
pub fn visible_burgage_zone(ctx: &ViewContext) -> impl Query<BurgageZone> {
    ctx.from.burgage_zone().r#where(|row| row.owner.eq(ctx.sender()))
}

#[spacetimedb::view(accessor = visible_residence, public, primary_key = id)]
pub fn visible_residence(ctx: &ViewContext) -> impl Query<Residence> {
    ctx.from.residence().r#where(|row| row.owner.eq(ctx.sender()))
}

#[spacetimedb::view(accessor = visible_backyard_garden, public, primary_key = id)]
pub fn visible_backyard_garden(ctx: &ViewContext) -> impl Query<BackyardGarden> {
    ctx.from.backyard_garden().r#where(|row| row.owner.eq(ctx.sender()))
}

#[spacetimedb::view(accessor = visible_corpse, public, primary_key = id)]
pub fn visible_corpse(ctx: &ViewContext) -> impl Query<Corpse> {
    ctx.from.corpse().r#where(|row| row.owner.eq(ctx.sender()))
}

#[spacetimedb::view(accessor = visible_market_state, public, primary_key = owner)]
pub fn visible_market_state(ctx: &ViewContext) -> impl Query<MarketState> {
    ctx.from.market_state().r#where(|row| row.owner.eq(ctx.sender()))
}

#[spacetimedb::view(accessor = visible_settlement_security, public, primary_key = owner)]
pub fn visible_settlement_security(ctx: &ViewContext) -> impl Query<SettlementSecurity> {
    ctx.from.settlement_security().r#where(|row| row.owner.eq(ctx.sender()))
}

#[spacetimedb::view(accessor = visible_active_raid, public, primary_key = owner)]
pub fn visible_active_raid(ctx: &ViewContext) -> impl Query<ActiveRaid> {
    ctx.from.active_raid().r#where(|row| row.owner.eq(ctx.sender()))
}

#[spacetimedb::view(accessor = visible_combat_agent, public, primary_key = id)]
pub fn visible_combat_agent(ctx: &ViewContext) -> Vec<CombatAgent> {
    let visibility = crate::realm::view_visibility(ctx);
    ctx.db.combat_agent().owner().filter(ctx.sender())
        .filter(|a| a.faction == 0 || a.faction >= 3 || visibility.contains(a.x, a.z)).collect()
}

#[spacetimedb::view(accessor = visible_delivery_trip, public, primary_key = id)]
pub fn visible_delivery_trip(ctx: &ViewContext) -> impl Query<DeliveryTrip> {
    ctx.from.delivery_trip().r#where(|row| row.owner.eq(ctx.sender()))
}

#[spacetimedb::view(accessor = visible_bandit_camp, public, primary_key = id)]
pub fn visible_bandit_camp(ctx: &ViewContext) -> impl Query<BanditCamp> {
    ctx.from.bandit_camp().r#where(|row| row.owner.eq(ctx.sender()))
}

#[spacetimedb::view(accessor = visible_bandit_incident, public, primary_key = id)]
pub fn visible_bandit_incident(ctx: &ViewContext) -> impl Query<BanditIncident> {
    ctx.from.bandit_incident().r#where(|row| row.owner.eq(ctx.sender()))
}

#[spacetimedb::view(accessor = visible_military_company, public, primary_key = id)]
pub fn visible_military_company(ctx: &ViewContext) -> impl Query<MilitaryCompany> {
    ctx.from.military_company().r#where(|row| row.owner.eq(ctx.sender()))
}

#[spacetimedb::view(accessor = visible_mercenary_contract, public, primary_key = company_id)]
pub fn visible_mercenary_contract(ctx: &ViewContext) -> impl Query<MercenaryContract> {
    ctx.from.mercenary_contract().r#where(|row| row.owner.eq(ctx.sender()))
}

#[spacetimedb::view(accessor = visible_fire_incident, public, primary_key = id)]
pub fn visible_fire_incident(ctx: &ViewContext) -> impl Query<FireIncident> {
    ctx.from.fire_incident().r#where(|row| row.owner.eq(ctx.sender()))
}

#[spacetimedb::view(accessor = visible_residence_need, public, primary_key = id)]
pub fn visible_residence_need(ctx: &ViewContext) -> impl Query<ResidenceNeed> {
    ctx.from.residence_need().r#where(|row| row.owner.eq(ctx.sender()))
}
