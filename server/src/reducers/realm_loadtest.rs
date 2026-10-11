//! Deliberately absent unless local-loadtest is compiled. Never publish this build publicly.
//! Fixtures use ordinary rows; production, consumption and hauling use the real scheduler.
use spacetimedb::{reducer, ReducerContext};
use crate::{db::*, tables::*, realm::{realm_member, realm_spawn}};
use crate::building_defs::building_def;
use crate::economy::{ALL_COMMODITIES, building_commodity_stock, withdraw_building_commodity, deposit_building_commodity};

#[reducer]
pub fn loadtest_seed_town(ctx: &ReducerContext, outpost: bool) -> Result<(), String> {
    let owner = ctx.sender();
    let member = ctx.db.realm_member().owner().find(owner).ok_or("Admit all computer players first")?;
    let template = ctx.db.building().owner().filter(owner).next().ok_or("No building")?;
    let kinds = ["town_hall", "marketplace", "well", "granary", "village_storehouse", "stable",
        "lumber_mill", "woodcutters_lodge", "reforester", "stone_quarry", "foragers_shed", "hunters_hall",
        "threshing_barn", "windmill", "bakery", "pastoral_farmstead", "swineherd", "apiary",
        "smithy", "carpenter", "charcoal_burner", "potter_kiln", "weaver", "tannery"];
    let mut centers = vec![(member.camp_x, member.camp_z, 96usize, 48usize)];
    if outpost {
        let members: Vec<_> = ctx.db.realm_member().iter().collect();
        let mut owners: Vec<_> = members.iter().map(|m| m.owner).collect(); owners.sort();
        let index = owners.iter().position(|id| *id == owner).unwrap();
        let free: Vec<_> = (0..81).filter(|slot| !members.iter().any(|m| m.slot == *slot)).collect();
        let slot = *free.get(index).ok_or("No outpost test region")?;
        let spawn = ctx.db.realm_spawn().slot().find(slot).ok_or("No outpost spawn")?;
        centers.push((spawn.x, spawn.z, 12, 6));
    }
    let mut nodes = vec![]; let mut edges = vec![];
    for (area, (cx, cz, houses, workshops)) in centers.into_iter().enumerate() {
        let settlement_id = if area == 0 { template.settlement_id } else {
            let existing = ctx.db.settlement().owner().filter(owner)
                .find(|s| s.anchor_x == cx && s.anchor_z == cz);
            let mut settlement = match existing {
                Some(s) => s,
                None => crate::settlements::create_planned_settlement(ctx, owner, cx, cz)?,
            };
            settlement.active = true;
            let id = settlement.id;
            ctx.db.settlement().id().update(settlement);
            id
        };
        for row in 0..15 {
            let z = cz - 112.0 + row as f64 * 24.0;
            let a = format!("{area}:{row}:a"); let b = format!("{area}:{row}:b");
            nodes.push(serde_json::json!({"id":a,"position":[cx-220.0,0.0,z],"connectedEdges":[]}));
            nodes.push(serde_json::json!({"id":b,"position":[cx+220.0,0.0,z],"connectedEdges":[]}));
            edges.push(serde_json::json!({"id":format!("{area}:{row}"),"startNodeId":a,"endNodeId":b,
                "width":4.0,"sampledPath":[[cx-220.0,0.0,z],[cx+220.0,0.0,z]],"controlPoints":[[cx-220.0,0.0,z],[cx+220.0,0.0,z]],"length":440.0,"revision":0}));
            if row > 0 {
                edges.push(serde_json::json!({"id":format!("{area}:spine:{row}"),"startNodeId":format!("{area}:{}:a",row-1),"endNodeId":a,
                    "width":4.0,"sampledPath":[[cx-220.0,0.0,z-24.0],[cx-220.0,0.0,z]],"controlPoints":[[cx-220.0,0.0,z-24.0],[cx-220.0,0.0,z]],"length":24.0,"revision":0}));
            }
        }
        if ctx.db.residence().owner().filter(owner).any(|r| r.settlement_id == settlement_id) { continue; }
        for i in 0..workshops {
            let kind = kinds[i % kinds.len()];
            let def = building_def(kind).ok_or_else(|| format!("Unknown fixture workshop {kind}"))?;
            let mut b = template.clone();
            for c in ALL_COMMODITIES.iter().copied() {
                let stock = building_commodity_stock(&b,c); withdraw_building_commodity(&mut b,c,stock);
            }
            let mut config = ctx.db.world_config().id().find(0).unwrap();
            b.id = crate::reducers::buildings::next_available_building_id(ctx, config.next_building_id)?;
            config.next_building_id = b.id + 1; ctx.db.world_config().id().update(config);
            b.kind = kind.into(); b.x = cx - 160.0 + (i % 8) as f64 * 40.0;
            b.z = cz - 120.0 + (i / 8) as f64 * 24.0;
            b.settlement_id = settlement_id;
            b.founding_shelter_active = false; b.construction_complete = true; b.construction_progress = 1.0;
            b.work_radius = def.work_radius; b.assigned_labor = def.max_labor; b.water_capacity = def.storage_water;
            b.tree_work_area_x = 0.0; b.tree_work_area_z = 0.0; b.tree_work_area_radius = 0.0;
            for c in ALL_COMMODITIES.iter().copied() {
                let cap = crate::economy::building_commodity_cap(kind,c);
                if cap > 0.0 { deposit_building_commodity(&mut b,c,(cap*0.5).min(500.0)); }
            }
            if kind == "well" { b.water = b.water_capacity; }
            if kind == "town_hall" { b.gold = 10_000.0; }
            let b = ctx.db.building().insert(b);
            if kind == "town_hall" {
                let mut settlement = ctx.db.settlement().id().find(settlement_id).unwrap();
                if settlement.town_hall_id == 0 { settlement.town_hall_id = b.id; }
                ctx.db.settlement().id().update(settlement);
            }
        }
        for i in 0..houses {
            let x = cx - 150.0 + (i % 12) as f64 * 25.0;
            let z = cz + 48.0 + (i / 12) as f64 * 24.0;
            let zone = ctx.db.burgage_zone().insert(BurgageZone {id:0,owner,corner_ax:x-10.0,corner_az:z-8.0,
                corner_bx:x+10.0,corner_bz:z-8.0,corner_cx:x+10.0,corner_cz:z+12.0,
                corner_dx:x-10.0,corner_dz:z+12.0,frontage_edge:0,plot_count:1,settlement_id});
            let residence = ctx.db.residence().insert(test_residence(owner,zone.id,settlement_id,x,z));
            crate::simulation::ensure_residence_needs(ctx,residence.id);
        }
    }
    let json = serde_json::json!({"nodes":nodes,"edges":edges,"nextNodeId":1000,"nextEdgeId":1000}).to_string();
    if let Some(mut road) = ctx.db.road_network_state().owner().find(owner) {
        road.snapshot_json=json; ctx.db.road_network_state().owner().update(road);
    } else { ctx.db.road_network_state().insert(RoadNetworkState{owner,snapshot_json:json}); }
    for mut s in ctx.db.settlement().owner().filter(owner).collect::<Vec<_>>() {s.unhoused_founders=0;ctx.db.settlement().id().update(s);}
    crate::realm::refresh_fog(ctx); crate::realm::refresh_entities(ctx);
    Ok(())
}

#[reducer]
pub fn loadtest_surveyor_loss(ctx: &ReducerContext, settlement_id: u64, remove_anchors: bool) -> Result<(), String> {
    use crate::realm::realm_scout;
    let owner = ctx.sender();
    let mut scout = ctx.db.realm_scout().settlement_id().find(settlement_id)
        .filter(|s| s.owner == owner).ok_or("No surveyor")?;
    scout.health = 0.0; ctx.db.realm_scout().settlement_id().update(scout);
    if remove_anchors {
        for b in ctx.db.building().owner().filter(owner).filter(|b| b.settlement_id == settlement_id
            && matches!(b.kind.as_str(), "founders_camp" | "town_hall")).collect::<Vec<_>>() {
            ctx.db.building().id().delete(b.id);
        }
    }
    crate::realm::refresh_fog(ctx); Ok(())
}

fn test_residence(owner: spacetimedb::Identity, zone_id: u64, settlement_id: u64, x: f64, z: f64) -> Residence {
    Residence { id:0,zone_id,owner,parcel_index:0,x,z,yaw:0.0,population:5,population_capacity:5,tier:4,
        settlement_ticks:0,abandoned:false,household_wealth:100.0,last_household_market_tick:0,
        upgrade_target_tier:0,upgrade_progress:0.0,upgrade_required_timber:0.0,upgrade_required_stone:0.0,
        upgrade_required_gold:0.0,upgrade_delivered_timber:0.0,upgrade_delivered_stone:0.0,upgrade_delivered_gold:0.0,
        upgrade_reserved_timber:0.0,upgrade_reserved_stone:0.0,upgrade_reserved_gold:0.0,upgrade_assigned_labor:0,
        upgrade_priority:1,backyard_project_kind:0,fire_repair_active:false,hunger_ticks:0,malnutrition:0.0,
        sick_population:0,illness_ticks:0,remedy_stock:0.0,deaths_total:0,comfort_deficit_ticks:0,
        comfort_deficit_tick:0,comfort_deficit_rate:0,vacancy_ticks:0,
        condition:0,last_starvation_death_hunger_ticks:0,decay_repair_active:false,tiled_roof:true,
        roof_tile_retrofit_active:false,upgrade_required_roof_tiles:0.0,upgrade_delivered_roof_tiles:0.0,
        upgrade_reserved_roof_tiles:0.0,food:0.0,honey:20.0,meat:20.0,fish:20.0,berries:20.0,mushrooms:20.0,
        milk:20.0,apples:20.0,cherries:20.0,eggs:20.0,grapes:20.0,cured_meat:20.0,smoked_fish:20.0,cheese:20.0,
        food_inventory_migrated:true,last_discretionary_market_day:0,rye_bread:20.0,maslin_bread:20.0,oat_grain:20.0,
        pears:20.0,aronia:20.0,rosehips:20.0,cabbage:20.0,carrots:20.0,beetroot:20.0,jam:20.0,settlement_id,smallholding:false }
}
