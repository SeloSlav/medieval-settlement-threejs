//! Authoring cheats compiled only into the isolated trailer database.
//! All created entities subsequently run through the ordinary authoritative simulation.
use spacetimedb::{reducer, ReducerContext};
use serde::Deserialize;
use crate::db::*;
use crate::tables::*;
use crate::economy::{ALL_COMMODITIES, building_commodity_stock, withdraw_building_commodity, deposit_building_commodity};
use crate::building_defs::building_def;

#[derive(Deserialize)]
struct Plan {
    #[serde(default)] buildings: Vec<Site>,
    #[serde(default)] zones: Vec<Zone>,
    #[serde(default)] roads: String,
    #[serde(default)] tier: u8,
    #[serde(default)] x: f64,
    #[serde(default)] z: f64,
}
#[derive(Deserialize)]
struct Site { kind: String, x: f64, z: f64, #[serde(default)] yaw: f64, #[serde(default)] labor: u32 }
#[derive(Deserialize)]
struct Zone { x: f64, z: f64, width: f64, depth: f64, count: u32 }

#[reducer]
pub fn trailer_author(ctx: &ReducerContext, plan_json: String) -> Result<(), String> {
    // This entry point is deliberately absent from normal development and release builds.
    author(ctx, &plan_json)
}

fn author(ctx: &ReducerContext, json: &str) -> Result<(), String> {
    let p: Plan = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let owner = ctx.sender();
    // Keep incidental wildlife/bandit attacks out of this deliberately staged realm.
    if let Some(mut cfg)=ctx.db.world_config().id().find(&0) {
        cfg.bandit_camps_enabled=false;cfg.wild_animal_attacks_enabled=false;
        cfg.conflict_enabled=false;cfg.game_speed=0;ctx.db.world_config().id().update(cfg);
    }
    for a in ctx.db.combat_agent().owner().filter(&owner).filter(|a|a.faction<3).collect::<Vec<_>>() {ctx.db.combat_agent().id().delete(a.id);}
    if ctx.db.building().owner().filter(&owner).next().is_none() {
        crate::reducers::bootstrap::place_founding_camp(ctx, p.x, p.z, 0.0)?;
    }
    if p.tier > 0 { crate::reducers::cheats::grant_cheat_resources(ctx, 10000.0)?; }
    if !p.roads.is_empty() { crate::reducers::roads::sync_road_network(ctx, p.roads)?; }
    // Ordinary zoning keeps real parcels, road frontage, household needs, and terrain clearing.
    for z in p.zones {
        if ctx.db.burgage_zone().owner().filter(&owner).any(|a| (a.corner_ax-z.x).abs()<0.1 && (a.corner_az-z.z).abs()<0.1) { continue; }
        // Authoring may extend beyond the normal incremental settlement reach.
        // Temporarily anchor this transaction at the parcel, then restore it.
        let original=ctx.db.settlement().owner().filter(&owner).next().ok_or("No settlement")?;
        let mut anchor=original.clone();anchor.anchor_x=z.x+z.width*0.5;anchor.anchor_z=z.z+z.depth*0.5;
        ctx.db.settlement().id().update(anchor);
        crate::reducers::residences::place_burgage_zone(ctx, z.x,z.z,z.x+z.width,z.z,z.x+z.width,z.z+z.depth,z.x,z.z+z.depth,0,z.count)?;
        ctx.db.settlement().id().update(original);
    }
    let template = ctx.db.building().owner().filter(&owner).find(|b| b.kind == "founders_camp")
        .or_else(|| ctx.db.building().owner().filter(&owner).next()).ok_or("No building template")?;
    for s in p.buildings {
        if ctx.db.building().owner().filter(&owner).any(|b| b.kind==s.kind && (b.x-s.x).abs()<0.1 && (b.z-s.z).abs()<0.1) { continue; }
        if !s.x.is_finite() || !s.z.is_finite() || s.x.abs()>790.0 || s.z.abs()>790.0 { return Err("Invalid trailer site".into()); }
        let def = building_def(&s.kind).ok_or_else(|| format!("Unknown building {}",s.kind))?;
        let mut b = template.clone();
        for c in ALL_COMMODITIES.iter().copied() { let stock = building_commodity_stock(&b,c); withdraw_building_commodity(&mut b,c,stock); }
        let mut config = ctx.db.world_config().id().find(&0).ok_or("No world")?;
        b.id = crate::reducers::buildings::next_available_building_id(ctx, config.next_building_id)?;
        config.next_building_id=b.id+1;
        ctx.db.world_config().id().update(config);
        b.kind=s.kind; b.x=s.x; b.z=s.z; b.placement_yaw=s.yaw; b.placement_yaw_locked=true;
        b.work_radius=def.work_radius; b.tree_work_area_x=0.0; b.tree_work_area_z=0.0; b.tree_work_area_radius=0.0;
        b.water_capacity=def.storage_water; b.assigned_labor=s.labor.min(def.max_labor); b.founding_shelter_active=false;
        b.construction_complete=true; b.construction_progress=1.0; b.action_cooldown=0.0;
        b.chapel_tier=if b.kind=="chapel" {3} else {0};
        b.monastery_extensions=if b.kind=="monastery" {15} else {0};
        b.granary_households_first=true; b.granary_grain_reserve=100.0;
        b.carpenter_polearm_reserve=if b.kind=="carpenter" {24} else {0};
        // Seed finite working buffers in real containers; subsequent production and hauling remain live.
        for c in ALL_COMMODITIES.iter().copied() {
            let cap=crate::economy::building_commodity_cap(&b.kind,c);
            if cap>0.0 { deposit_building_commodity(&mut b,c,(cap*0.35).min(200.0)); }
        }
        if b.kind=="well" { b.water=b.water_capacity; }
        if b.kind=="town_hall" { b.gold=1500.0; }
        if b.kind=="marketplace" { b.gold=200.0; }
        let clear=ctx.db.tree_entity().iter().filter(|t| (t.x-b.x).abs()<10.0 && (t.z-b.z).abs()<10.0).map(|t|t.tree_id).collect::<Vec<_>>();
        for id in clear {ctx.db.tree_entity().tree_id().delete(&id);}
        let hall=b.kind=="town_hall"; let id=b.id;
        ctx.db.building().insert(b);
        if hall { if let Some(mut st)=ctx.db.settlement().id().find(&template.settlement_id) {st.town_hall_id=id;st.name="Delnice".into();ctx.db.settlement().id().update(st);} }
    }
    if p.tier>0 {
        for mut r in ctx.db.residence().owner().filter(&owner).collect::<Vec<_>>() {
            r.tier=p.tier.min(4);r.population=r.population_capacity;r.household_wealth=100.0;
            r.upgrade_target_tier=0;r.upgrade_progress=0.0;r.upgrade_assigned_labor=0;
            r.upgrade_reserved_timber=0.0;r.upgrade_reserved_stone=0.0;r.upgrade_reserved_gold=0.0;
            r.tiled_roof=p.tier>=3 && r.id%3!=0;r.hunger_ticks=0;r.comfort_deficit_ticks=0;
            r.rye_bread=12.0;r.meat=8.0;r.fish=8.0;r.milk=8.0;r.cured_meat=8.0;r.cheese=8.0;r.honey=6.0;
            r.condition=0;r.abandoned=false;r.sick_population=0;r.malnutrition=0.0;
            let rid=r.id;
            ctx.db.residence().id().update(r);
            if !ctx.db.backyard_garden().residence_id().filter(&rid).next().is_some() {
                let kinds=[2,3,8,9,10,11,12,14,17];
                ctx.db.backyard_garden().insert(BackyardGarden {id:0,residence_id:rid,owner,kind:kinds[rid as usize%kinds.len()],first_harvest_day:1,last_primary_production_day:0,last_secondary_production_day:0,hide_stock:0.0,flower_luxury_upgraded:rid%9==5,wax_stock:0.0});
            }
        }
        for mut s in ctx.db.settlement().owner().filter(&owner).collect::<Vec<_>>() {s.unhoused_founders=0;ctx.db.settlement().id().update(s);}
    }
    if p.tier>=4 && ctx.db.farm_field().owner().filter(&owner).next().is_none() {
        let barns=ctx.db.building().owner().filter(&owner).filter(|b|b.kind=="threshing_barn").collect::<Vec<_>>();
        for (i,(x,z)) in [(-250.0,-274.0),(-187.0,-274.0),(-118.0,-274.0),(-55.0,-274.0)].into_iter().enumerate() {
            if let Some(b)=barns.iter().min_by(|a,b|((a.x-x).powi(2)+(a.z-z).powi(2)).total_cmp(&((b.x-x).powi(2)+(b.z-z).powi(2)))) {
                ctx.db.farm_field().insert(FarmField{id:0,owner,farmstead_id:b.id,corner_ax:x,corner_az:z,corner_bx:x+52.0,corner_bz:z,corner_cx:x+52.0,corner_cz:z+62.0,corner_dx:x,corner_dz:z+62.0,area:3224.0,average_slope_degrees:2.0,moisture:0.65,fertility:0.9,crop:if i==3 {1} else {0},next_crop:if i==3 {0} else {1},stage:2,stage_progress:0.7,priority:1,harvest_count:0,last_yield:0.0,current_yield:0.0,harvest_yield_multiplier:1.0,following_crop:2,manure_applied:0.0});
            }
        }
        for b in ctx.db.building().owner().filter(&owner).filter(|b|matches!(b.kind.as_str(),"pastoral_farmstead"|"swineherd")).collect::<Vec<_>>() {
            let x=b.x-22.0;let z=b.z-95.0;
            let pasture=ctx.db.pasture().insert(Pasture{id:0,owner,farmstead_id:b.id,corner_ax:x,corner_az:z,corner_bx:x+54.0,corner_bz:z,corner_cx:x+54.0,corner_cz:z+65.0,corner_dx:x,corner_dz:z+65.0,area:3510.0,average_slope_degrees:2.0,moisture:0.65});
            let species=if b.kind=="swineherd" {2} else {0};
            let mut herd=crate::reducers::livestock::unstocked_pasture_herd(&pasture,species);
            herd.head_count=if species==2 {12} else {10};herd.present_head_count=herd.head_count;herd.health=1.0;herd.hay_stock=250.0;
            ctx.db.pasture_herd().insert(herd);
        }
    }
    if p.tier>=4 {
        // Retire the initial build budget once the town exists. Its workshops,
        // fields, households and regional trade must now move real goods.
        for mut b in ctx.db.building().owner().filter(&owner).filter(|b|b.kind=="reclamation_pile").collect::<Vec<_>>() {
            for c in ALL_COMMODITIES.iter().copied() {let stock=building_commodity_stock(&b,c);withdraw_building_commodity(&mut b,c,stock);}
            ctx.db.building().id().update(b);
        }
        if let Some(post)=ctx.db.building().owner().filter(&owner).find(|b|b.kind=="trading_post") {
            if ctx.db.trading_post_trade_rule().building_id().filter(&post.id).next().is_none() {
                use crate::economy::CommodityKind as C;
                for (c,mode,target) in [(C::Iron,1,150.0),(C::Salt,1,70.0),(C::Clay,1,120.0),(C::Wool,1,100.0),(C::Flax,1,100.0),(C::RyeGrain,1,200.0),(C::Fish,1,80.0),(C::Pottery,2,50.0),(C::Candles,2,40.0),(C::Shoes,2,40.0),(C::Cloth,2,70.0),(C::Timber,2,100.0)] {
                    crate::reducers::trading_post_trade::set_trading_post_trade_rule(ctx,post.id,c.as_u8(),mode,target)?;
                }
            }
        }
    }
    Ok(())
}

/// One ordinary 200 ms scheduler heartbeat, with the realm paused between frames.
#[reducer]
pub fn trailer_calm(ctx: &ReducerContext) {
    if let Some(mut cfg)=ctx.db.world_config().id().find(&0) {
        cfg.bandit_camps_enabled=false;cfg.wild_animal_attacks_enabled=false;
        cfg.conflict_enabled=false;cfg.game_speed=0;ctx.db.world_config().id().update(cfg);
    }
    for a in ctx.db.combat_agent().iter().filter(|a|a.faction<3).collect::<Vec<_>>() {ctx.db.combat_agent().id().delete(a.id);}
}

/// One ordinary 200 ms scheduler heartbeat, with the realm paused between frames.
#[reducer]
pub fn trailer_step(ctx: &ReducerContext) -> Result<(),String> {
    trailer_step_at_speed(ctx, 1)
}

#[reducer]
pub fn trailer_step_at_speed(ctx: &ReducerContext, speed: u8) -> Result<(),String> {
    if speed != 1 && speed != 8 { return Err("Capture speed must be 1 or 8".into()); }
    if ctx.db.active_game_session().iter().next().is_none() { return Err("Enter the world before capturing".into()); }
    // Stock the authored stable through normal purchases, then let the ordinary
    // workforce and delivery systems assign and move these draft animals.
    if speed == 8 && ctx.db.stable_ox().owner().filter(&ctx.sender()).next().is_none() {
        if let Some(stable) = ctx.db.building().owner().filter(&ctx.sender()).find(|b| b.kind == "stable") {
            for _ in 0..crate::balance_generated::STABLE_OX_SLOTS { crate::reducers::stable_oxen::purchase_stable_ox(ctx, stable.id)?; }
            for b in ctx.db.building().owner().filter(&ctx.sender()).filter(|b| matches!(b.kind.as_str(), "woodcutters_lodge" | "threshing_barn")).collect::<Vec<_>>() {
                crate::reducers::stable_oxen::set_building_oxen(ctx, b.id, 1)?;
            }
        }
    }
    let mut cfg=ctx.db.world_config().id().find(&0).ok_or("No world")?;
    if cfg.game_speed!=0 {return Err("Pause before stepping a captured frame".into());}
    cfg.game_speed=speed;ctx.db.world_config().id().update(cfg);
    crate::reducers::simulation::run_sim_tick(ctx,crate::schedule::SimTickSchedule{schedule_id:0,scheduled_at:spacetimedb::ScheduleAt::Time(ctx.timestamp)});
    let mut cfg=ctx.db.world_config().id().find(&0).ok_or("No world")?;cfg.game_speed=0;ctx.db.world_config().id().update(cfg);
    Ok(())
}

#[reducer]
pub fn trailer_battle(ctx: &ReducerContext, action: u8, x: f64, z: f64) -> Result<(),String> {
    stage_battle(ctx,ctx.sender(),action,x,z)
}

/// Local production recovery when the rendering client is unavailable.
#[reducer]
pub fn trailer_battle_saved(ctx: &ReducerContext, action: u8, x: f64, z: f64) -> Result<(),String> {
    let owner=ctx.db.settlement().iter().find(|s|s.name=="Delnice").ok_or("The trailer town has not been built")?.owner;
    stage_battle(ctx,owner,action,x,z)
}

fn stage_battle(ctx: &ReducerContext, owner:spacetimedb::Identity, action:u8,x:f64,z:f64) -> Result<(),String> {
    if action==0 {
        // Prepare an open mustering field so the staged battle remains visible.
        let clearing=ctx.db.tree_entity().iter().filter(|t|(t.x-x).abs()<95.0&&(t.z-(z+30.0)).abs()<85.0).map(|t|t.tree_id).collect::<Vec<_>>();
        for id in clearing {ctx.db.tree_entity().tree_id().delete(&id);}
        // Only this isolated world's own previously staged troops are replaced for another camera take.
        for a in ctx.db.combat_agent().owner().filter(&owner).collect::<Vec<_>>() {ctx.db.combat_agent().id().delete(a.id);}
        for m in ctx.db.military_member().owner().filter(&owner).collect::<Vec<_>>() {ctx.db.military_member().combat_agent_id().delete(m.combat_agent_id);}
        for c in ctx.db.military_company().owner().filter(&owner).collect::<Vec<_>>() {ctx.db.military_company().id().delete(c.id);}
        for h in ctx.db.cavalry_horse().owner().filter(&owner).collect::<Vec<_>>() {ctx.db.cavalry_horse().id().delete(h.id);}
        for r in ctx.db.raid_incursion_route().owner().filter(&owner).collect::<Vec<_>>() {ctx.db.raid_incursion_route().combat_agent_id().delete(r.combat_agent_id);}
        ctx.db.active_raid().owner().delete(&owner);
        // Eight 8-person foot companies, two 6-person crossbow companies,
        // and four 6-person cavalry companies: exactly 100 individual soldiers.
        let kinds=[1,1,2,2,5,5,6,7,3,3,8,8,9,10];
        for (i,kind) in kinds.into_iter().enumerate() {
            let cx=x+(i%7) as f64*10.0-30.0;let cz=z+(i/7) as f64*10.0;
            crate::reducers::bandits::deploy_debug_military_company(ctx,owner,kind,cx,cz)?;
        }
    } else if action==1 {
        let mut cfg=ctx.db.world_config().id().find(&0).ok_or("No world")?;
        cfg.conflict_enabled=true; cfg.enemy_pressure=1;
        let (tick,seed,size)=(cfg.sim_tick,cfg.seed,cfg.map_size);
        ctx.db.world_config().id().update(cfg);
        crate::simulation::start_debug_live_raid(ctx,owner,tick,seed,size,x,z)?;
        let base=ctx.db.combat_agent().owner().filter(&owner).find(|a|a.faction==1).ok_or("No raiders")?;
        let count=ctx.db.combat_agent().owner().filter(&owner).filter(|a|a.faction==1).count();
        for index in count..100 {
            let mut a=base.clone();a.id=0;a.source_slot=index as u32;a.x=x+(index%10)as f64*1.8-9.0;a.z=z+(index/10)as f64*1.8;
            a.home_x=a.x;a.home_z=a.z;a.health=100.0;a.max_health=100.0;a.attack_cooldown=(index%6)as f64*0.08;
            ctx.db.combat_agent().insert(a);
        }
        if let Some(mut r)=ctx.db.active_raid().owner().find(&owner){r.initial_raiders=100;r.initial_guards=100;ctx.db.active_raid().owner().update(r);}
        for mut c in ctx.db.military_company().owner().filter(&owner).collect::<Vec<_>>() {c.fire_at_will=true;ctx.db.military_company().id().update(c);}
    }
    Ok(())
}
