//! Opt-in database integration test. Never exported by the production module.
use std::{collections::HashMap, sync::Arc};
use spacetimedb::{reducer, ReducerContext};
use crate::{db::*, tables::*, forestry_policy::*};
use crate::economy::CommodityKind;
use super::{SimTickContext, game_clock};
use super::delivery_trips::{step_delivery_trips, try_start_building_supply_trip, try_start_forestry_trip};

#[reducer]
pub fn run_forestry_regression(ctx: &ReducerContext) -> Result<(), String> {
    if ctx.db.building().iter().next().is_some() { return Err("Forestry regression requires an empty disposable database".into()); }
    crate::reducers::world_configuration::configure_world(ctx, 420042, 1, 50, 0, 0, 50, 50, false, 0, false, false, false, 100, 100, 1, 0, false)?;
    crate::reducers::cheats::grant_cheat_resources(ctx, 1000.0)?;
    crate::reducers::buildings::place_building(ctx, "founders_camp".into(), 8650.0, 14.0, None)?;
    let template = ctx.db.building().owner().filter(&ctx.sender()).next().unwrap();
    let fixture = |kind: &str, x: f64| {
        let mut b = template.clone(); b.id = x as u64; b.kind = kind.into(); b.x = x; b.z = 14.0;
        for commodity in crate::economy::ALL_COMMODITIES.iter().copied() {
            crate::economy::withdraw_building_commodity(&mut b, commodity, 1_000_000.0);
        }
        b.storehouse_accepts_timber = true; b.storehouse_accepts_firewood = true;
        b.construction_complete = true; b.assigned_labor = 2; b.timber = 0.0; b.firewood = 0.0;
        b.stone = 0.0; b.water = 0.0; b.ironwork = 0.0; b.rye_bread = 0.0; b.gold = 0.0;
        b.action_cooldown = 0.0; b.production_rate_percent = 100;
        b.tree_work_area_x = 8700.0; b.tree_work_area_z = 30.0; b.tree_work_area_radius = 10.0;
        ctx.db.building().insert(b)
    };
    let camp = fixture("lumber_mill", 8680.0);
    let lodge = fixture("woodcutters_lodge", 8720.0);
    let store = fixture("village_storehouse", 8740.0);
    let stable = fixture("stable", 8760.0);
    let tree_id = "forestry-regression-tree".to_string();
    ctx.db.tree_entity().insert(TreeEntity { tree_id: tree_id.clone(), layout_index: 321,
        phase: "mature".into(), growth_progress: 1.0, wood_yield: 12.0, x: 8700.0, z: 30.0,
        harvest_progress: 0.0, harvest_owner: None, work_building_id: 0, logs: vec![] });
    let networks = Arc::new(HashMap::from([(ctx.sender(), crate::roads::RoadNetwork::from_snapshot_json("{\"nodes\":[],\"edges\":[]}").unwrap())]));
    let tick = || SimTickContext::with_road_networks(networks.clone());
    let clock = game_clock(0);
    let tree = || ctx.db.tree_entity().tree_id().find(&tree_id).unwrap();
    let building = |id| ctx.db.building().id().find(&id).unwrap();
    super::forestry::step_forestry(ctx, &tick(), &clock, building(camp.id));
    assert_eq!(tree().phase, "falling", "felling starts an animation, not a deposit");
    assert_eq!(building(camp.id).timber, 0.0);
    for _ in 0..(TREE_FALL_SECONDS/crate::constants::TICK_DT).ceil() as usize + 1 { super::forestry::step_falling_trees(ctx); }
    assert_eq!(tree().phase, "fallen");
    for _ in 0..1000 {
        super::forestry::step_forestry(ctx, &tick(), &clock, building(camp.id));
        if tree().phase == "logs" { break; }
    }
    assert_eq!(tree().phase, "logs");
    assert_eq!(tree().logs.iter().map(|l|l.health).sum::<f64>(), 120.0);
    for _ in 0..20 { super::forestry::step_forestry(ctx, &tick(), &clock, building(camp.id)); }
    assert_eq!(ctx.db.delivery_trip().iter().count(), 0, "humans cannot haul timber");
    assert_eq!(building(camp.id).timber, 0.0);
    let mut ox = ctx.db.stable_ox().insert(StableOx { id: 0, owner: ctx.sender(), stable_id: stable.id, slot: 0, assigned_building_id: store.id });
    assert!(!try_start_forestry_trip(ctx, &tick(), &clock, &camp, &tree(), 0, CommodityKind::Timber), "never borrow an ox posted elsewhere");
    ox.assigned_building_id = 0;
    ctx.db.stable_ox().id().update(ox);
    assert!(try_start_forestry_trip(ctx, &tick(), &clock, &camp, &tree(), 0, CommodityKind::Timber), "automatic ox collects timber");
    let other_camp = fixture("lumber_mill", 8800.0);
    assert!(!try_start_forestry_trip(ctx, &tick(), &clock, &other_camp, &tree(), 0, CommodityKind::Timber), "the same log cannot be double booked");
    assert!(!try_start_forestry_trip(ctx, &tick(), &clock, &other_camp, &tree(), 1, CommodityKind::Timber), "another log cannot borrow the busy ox");
    let outward = ctx.db.delivery_trip().iter().next().unwrap();
    assert_eq!(outward.amount, 0.0, "outbound ox is empty");
    assert_eq!(tree().logs[0].health, 40.0, "wood remains on ground until pickup");
    // An ox lost before pickup never turns into a free human timber hauler.
    let original_ox = ctx.db.stable_ox().iter().next().unwrap();
    ctx.db.stable_ox().id().delete(&original_ox.id);
    step_delivery_trips(ctx, &tick(), &clock, 10000.0);
    assert_eq!(tree().logs[0].health, 40.0);
    assert_eq!(building(camp.id).timber, 0.0);
    ctx.db.stable_ox().insert(original_ox);
    assert!(try_start_forestry_trip(ctx, &tick(), &clock, &camp, &tree(), 0, CommodityKind::Timber));
    let mut full_camp = building(camp.id);
    full_camp.timber = crate::economy::building_commodity_cap("lumber_mill", CommodityKind::Timber);
    ctx.db.building().id().update(full_camp);
    step_delivery_trips(ctx, &tick(), &clock, 10000.0);
    assert_eq!(tree().logs[0].health, 40.0, "headroom is checked again at physical pickup");
    let mut empty_camp = building(camp.id); empty_camp.timber = 0.0;
    ctx.db.building().id().update(empty_camp);
    assert!(try_start_forestry_trip(ctx, &tick(), &clock, &camp, &tree(), 0, CommodityKind::Timber));
    step_delivery_trips(ctx, &tick(), &clock, 10000.0);
    assert_eq!(building(camp.id).timber, 4.0);
    assert_eq!(tree().logs[0].health, 0.0);
    assert_eq!(ctx.db.delivery_trip().iter().count(), 0);
    // A different camp splits the same finite tree and collects without an ox.
    super::forestry::step_forestry(ctx, &tick(), &clock, building(lodge.id));
    assert_eq!(tree().logs[1].health, 35.0);
    assert_eq!(tree().logs[1].firewood, 1.0);
    assert_eq!(building(lodge.id).firewood, 0.0);
    assert!(try_start_forestry_trip(ctx, &tick(), &clock, &lodge, &tree(), 1, CommodityKind::Firewood));
    assert_eq!(ctx.db.delivery_trip().iter().next().unwrap().ox_id, 0);
    step_delivery_trips(ctx, &tick(), &clock, 10000.0);
    assert_eq!(building(lodge.id).firewood, 1.0);
    let mut ox = ctx.db.stable_ox().iter().next().unwrap();
    ox.assigned_building_id = camp.id;
    ctx.db.stable_ox().id().update(ox);
    super::village_storehouse::step_village_storehouse_overflow_collection(ctx, &tick(), &clock, vec![building(store.id)]);
    assert_eq!(ctx.db.delivery_trip().iter().next().unwrap().cargo_kind, CommodityKind::Timber.as_u8(), "the actual dispatcher collects timber below the old overflow floor");
    assert_eq!(building(store.id).timber, 0.0, "storehouse waits for physical arrival");
    assert!(ctx.db.delivery_trip().iter().next().unwrap().ox_id != 0);
    step_delivery_trips(ctx, &tick(), &clock, 10000.0);
    assert_eq!(building(store.id).timber, 4.0);
    let health: f64 = tree().logs.iter().map(|l| l.health + l.firewood*LOG_HEALTH_PER_FIREWOOD).sum();
    assert_eq!(health + building(store.id).timber*LOG_HEALTH_PER_TIMBER + building(lodge.id).firewood*LOG_HEALTH_PER_FIREWOOD, 120.0, "entire production and hauling chain conserves wood");
    for _ in 0..1000 {
        super::forestry::step_forestry(ctx, &tick(), &clock, building(lodge.id));
        step_delivery_trips(ctx, &tick(), &clock, 10000.0);
        if tree().phase == "stump" { break; }
    }
    assert_eq!(tree().phase, "stump", "only the completely depleted tree can regrow");
    assert!(tree().logs.is_empty());
    assert_eq!(building(lodge.id).firewood, 16.0);
    for _ in 0..10 { super::forestry::step_forestry(ctx, &tick(), &clock, building(lodge.id)); }
    assert_eq!(building(lodge.id).firewood, 16.0, "a depleted tree cannot yield twice");
    // Direct camp-to-workshop dispatch cannot bypass the requested depot chain.
    let workshop = fixture("charcoal_burner", 8780.0);
    let mut source = building(lodge.id);
    let t = tick(); let network = t.road_network(ctx.sender()).unwrap();
    assert!(!try_start_building_supply_trip(ctx, &t, &clock, network, &mut source, &workshop, 1, CommodityKind::Firewood, 1.0, 1.0, 8.0, 2.0));
    for _ in 0..10 {
        super::village_storehouse::step_village_storehouse_overflow_collection(ctx, &tick(), &clock, vec![building(store.id)]);
        step_delivery_trips(ctx, &tick(), &clock, 10000.0);
        if building(lodge.id).firewood == 0.0 { break; }
    }
    assert_eq!(building(store.id).firewood, 16.0);
    assert_eq!(building(store.id).timber*LOG_HEALTH_PER_TIMBER + building(store.id).firewood*LOG_HEALTH_PER_FIREWOOD, 120.0);
    log::info!("FORESTRY_REGRESSION_PASSED: fall, crew travel, buck, no-ox block, lost ox, automatic and posted ox, exclusive claims, shared firewood, physical arrival, automatic depot collection, complete depletion, no duplicate yield, conserved economy");
    Ok(())
}
