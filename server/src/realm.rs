//! Persistent realm admission and server-owned exploration. Production has no bot reducer.
use std::collections::BTreeMap;
use std::sync::Arc;
use spacetimedb::{Identity, Query, ReducerContext, ViewContext};
use crate::db::*;
use crate::realm_policy::*;

pub const ENABLED: bool = cfg!(feature = "persistent-world");

#[spacetimedb::table(accessor = realm_clock)]
pub struct RealmClock {
    #[primary_key]
    pub id: u8,
    pub last_wall_micros: i64,
    pub remainder_micros: u64,
}

pub fn advance_clock(ctx: &ReducerContext) -> RealmClockStep {
    let now = ctx.timestamp.to_micros_since_unix_epoch();
    let previous = ctx.db.realm_clock().id().find(0);
    let step = realm_clock_step(previous.as_ref().map_or(now, |s| s.last_wall_micros),
        previous.as_ref().map_or(0, |s| s.remainder_micros), now);
    let row = RealmClock { id: 0, last_wall_micros: step.last_wall_micros, remainder_micros: step.remainder_micros };
    if previous.is_some() { ctx.db.realm_clock().id().update(row); }
    else { ctx.db.realm_clock().insert(row); }
    step
}

#[spacetimedb::table(accessor = realm_member)]
pub struct RealmMember {
    #[primary_key]
    pub owner: Identity,
    pub slot: u32,
    pub camp_x: f64,
    pub camp_z: f64,
    pub joined_at: spacetimedb::Timestamp,
}

#[spacetimedb::table(accessor = realm_spawn)]
pub struct RealmSpawn {
    #[primary_key]
    pub slot: u32,
    pub x: f64,
    pub z: f64,
}

#[spacetimedb::table(accessor = realm_fog, index(accessor = owner, btree(columns = [owner])))]
pub struct RealmFog {
    #[primary_key]
    pub id: String,
    pub owner: Identity,
    pub chunk: u32,
    pub explored: u64,
    pub visible: u64,
}

#[spacetimedb::table(accessor = realm_interest)]
pub struct RealmInterest {
    #[primary_key]
    pub owner: Identity,
    pub chunk: u32,
}

/// A founding surveyor gives every settlement a way to explore before recruiting an army.
#[spacetimedb::table(accessor = realm_scout, index(accessor = owner, btree(columns = [owner])))]
#[derive(Clone)]
pub struct RealmScout {
    #[primary_key]
    pub settlement_id: u64,
    pub owner: Identity,
    pub health: f64,
    pub residence_id: u64,
    pub resident_slot: u32,
    pub x: f64,
    pub z: f64,
    pub target_x: f64,
    pub target_z: f64,
}

#[spacetimedb::table(accessor = realm_scout_route)]
pub struct RealmScoutRoute {
    #[primary_key]
    pub settlement_id: u64,
    pub waypoints_json: String,
    pub leg: u32,
}

#[derive(PartialEq)]
struct NavigationFootprint { id: u64, kind: String, x: f64, z: f64, yaw: f64 }
thread_local! {
    static SCOUT_NAVIGATION: std::cell::RefCell<Option<(Vec<NavigationFootprint>, Arc<crate::combat_navigation::CombatNavigation>)>> = const { std::cell::RefCell::new(None) };
}

fn scout_navigation(ctx: &ReducerContext) -> Arc<crate::combat_navigation::CombatNavigation> {
    let mut footprints: Vec<_> = ctx.db.building().iter().map(|b| NavigationFootprint {
        id: b.id, kind: b.kind, x: b.x, z: b.z, yaw: b.placement_yaw,
    }).chain(ctx.db.residence().iter().map(|r| NavigationFootprint {
        id: r.id, kind: String::new(), x: r.x, z: r.z, yaw: r.yaw,
    })).collect();
    // Ordinary stock/population row updates can change table iteration order.
    // Only actual footprint changes invalidate this shared spatial index.
    footprints.sort_unstable_by(|a,b| a.kind.cmp(&b.kind).then(a.id.cmp(&b.id)));
    SCOUT_NAVIGATION.with(|cache| {
        let mut cache = cache.borrow_mut();
        if let Some((previous, navigation)) = cache.as_ref() {
            if *previous == footprints { return navigation.clone(); }
        }
        let mut navigation = crate::combat_navigation::CombatNavigation::default();
        for footprint in &footprints {
            let obstacle = if footprint.kind.is_empty() {
                crate::combat_navigation::CombatObstacle::rectangle(footprint.x, footprint.z, 3.3, 3.7, footprint.yaw)
            } else {
                let corners = crate::placement_validation::building_footprint_polygon_at_yaw(
                    &footprint.kind, footprint.x, footprint.z, footprint.yaw);
                crate::combat_navigation::CombatObstacle::from_corners(corners.map(|p| (p.x,p.z)))
            };
            navigation.push(obstacle);
        }
        let navigation = Arc::new(navigation);
        *cache = Some((footprints, navigation.clone())); navigation
    })
}

fn scout_roads(ctx: &ReducerContext, owner: Identity) -> crate::roads::RoadNetwork {
    crate::roads::load_owner_road_network(ctx, owner).unwrap_or_else(scout_roads_empty)
}
fn scout_roads_empty() -> crate::roads::RoadNetwork {
    let mut roads = crate::roads::RoadNetwork::from_snapshot_json(r#"{"nodes":[],"edges":[]}"#).unwrap();
    crate::roads::apply_world_navigation(&mut roads); roads
}

#[spacetimedb::view(accessor = my_realm_scout, public, primary_key = settlement_id)]
pub fn my_realm_scout(ctx: &ViewContext) -> impl Query<RealmScout> {
    ctx.from.realm_scout().r#where(|row| row.owner.eq(ctx.sender()))
}

#[spacetimedb::reducer]
pub fn order_realm_scout(ctx: &ReducerContext, settlement_id: u64, x: f64, z: f64) -> Result<(), String> {
    if !ENABLED { return Err("Surveyors belong to the persistent realm.".into()); }
    world_chunk(x, z).ok_or("Destination is outside the realm.")?;
    let mut scout = ctx.db.realm_scout().settlement_id().find(settlement_id).filter(|s| s.owner == ctx.sender() && s.health > 0.0)
        .ok_or("Recruit a surveyor at your camp, town hall, or an occupied home first.")?;
    let navigation = scout_navigation(ctx);
    let goal = navigation.outside((x,z));
    if !navigation.civilian_position_is_clear(goal) { return Err("That destination is inside a blocked area.".into()); }
    let roads = scout_roads(ctx, scout.owner);
    let clear = |a:[f64;2],b:[f64;2]| {
        navigation.civilian_segment_is_clear((a[0],a[1]),(b[0],b[1]))
            && roads.segment_avoids_open_water(a[0],a[1],b[0],b[1])
    };
    // Exact authored centerlines can cross bridges narrower than the search
    // grid, including bridges whose orientation does not follow grid axes.
    let road_route = roads.road_path_route(scout.x,scout.z,goal.0,goal.1)
        .filter(|route| route.polyline.windows(2).all(|pair|
            crate::realm_navigation_policy::clear_segment(pair[0],pair[1],&clear)));
    let path = if crate::realm_navigation_policy::clear_segment([scout.x,scout.z],[goal.0,goal.1],&clear) {
        Ok(vec![[scout.x,scout.z],[goal.0,goal.1]])
    } else if let Some(route) = road_route { Ok(route.polyline) }
    else { crate::realm_navigation_policy::plan_route([scout.x,scout.z], [goal.0,goal.1], clear) }
    .map_err(|error| match error {
        crate::realm_navigation_policy::RouteError::InvalidDestination => "Choose a destination on dry land or a bridge.",
        crate::realm_navigation_policy::RouteError::Unreachable => "The surveyor cannot reach that destination.",
        crate::realm_navigation_policy::RouteError::Budget => "That route is too obstructed. Choose a closer waypoint.",
    })?;
    let route = RealmScoutRoute { settlement_id, waypoints_json: serde_json::to_string(&path).map_err(|_| "Cannot record route")?, leg: 1 };
    if ctx.db.realm_scout_route().settlement_id().find(settlement_id).is_some() {
        ctx.db.realm_scout_route().settlement_id().update(route);
    } else { ctx.db.realm_scout_route().insert(route); }
    scout.target_x = goal.0; scout.target_z = goal.1;
    ctx.db.realm_scout().settlement_id().update(scout);
    Ok(())
}

/// Population is transferred into the expedition, never created by recruitment.
#[spacetimedb::reducer]
pub fn recruit_realm_scout(ctx: &ReducerContext, settlement_id: u64) -> Result<(), String> {
    if !ENABLED { return Err("Surveyors belong to the persistent realm.".into()); }
    let owner = ctx.sender();
    let mut settlement = ctx.db.settlement().id().find(settlement_id).filter(|s| s.owner == owner).ok_or("Settlement not found")?;
    if ctx.db.realm_scout().settlement_id().find(settlement_id).is_some_and(|s| s.health > 0.0) {
        return Err("This settlement already has a surveyor.".into());
    }
    if crate::economy::available_building_labor(ctx, owner) == 0 { return Err("An available adult is needed. Free one worker first.".into()); }
    let anchor = ctx.db.building().owner().filter(owner).filter(|b| b.settlement_id == settlement_id && b.construction_complete
        && matches!(b.kind.as_str(), "founders_camp" | "town_hall"))
        .min_by_key(|b| (if b.kind == "founders_camp" { 0 } else { 1 }, b.id));
    let (residence_id, resident_slot, hx, hz) = if settlement.unhoused_founders > 0 {
        settlement.unhoused_founders -= 1;
        let result = (0, settlement.unhoused_founders, settlement.anchor_x, settlement.anchor_z);
        ctx.db.settlement().id().update(settlement); result
    } else {
        let reserved: std::collections::BTreeSet<_> = ctx.db.military_member().owner().filter(owner)
            .map(|m| (m.residence_id, m.resident_slot)).collect();
        let mut home = ctx.db.residence().owner().filter(owner).filter(|r| r.settlement_id == settlement_id
            && !r.abandoned && !r.smallholding && r.population > 0 && r.sick_population == 0
            && !reserved.contains(&(r.id, r.population - 1))).min_by_key(|r| r.id)
            .ok_or("An occupied home with an available healthy adult is needed.")?;
        home.population -= 1;
        let result = (home.id, home.population, home.x, home.z);
        ctx.db.residence().id().update(home); result
    };
    let (x,z) = anchor.map(|b| (b.x + 8.0,b.z)).unwrap_or((hx,hz));
    let navigation = scout_navigation(ctx);
    let (x,z) = navigation.outside((x,z));
    if !navigation.civilian_position_is_clear((x,z)) || !scout_roads(ctx,owner).segment_avoids_open_water(x,z,x,z) {
        return Err("The recruitment site has no accessible dry exit.".into());
    }
    ctx.db.realm_scout_route().settlement_id().delete(settlement_id);
    let scout = RealmScout { settlement_id, owner, health: 60.0, residence_id, resident_slot, x,z,target_x:x,target_z:z };
    if ctx.db.realm_scout().settlement_id().find(settlement_id).is_some() { ctx.db.realm_scout().settlement_id().update(scout); }
    else { ctx.db.realm_scout().insert(scout); }
    Ok(())
}

pub fn step_scouts(ctx: &ReducerContext, elapsed_seconds: f64) {
    if !ENABLED { return; }
    let scouts = ctx.db.realm_scout().iter().collect::<Vec<_>>();
    let navigation = scouts.iter().any(|s| s.health > 0.0 && (s.target_x-s.x).hypot(s.target_z-s.z)>0.001)
        .then(|| scout_navigation(ctx));
    let roads = navigation.as_ref().map(|_| crate::simulation::SimTickContext::load_road_networks(ctx));
    let empty_roads = navigation.as_ref().map(|_| scout_roads_empty());
    for mut scout in scouts {
        if scout.health <= 0.0 { continue; }
        // Unarmed civilians can be killed by nearby hostile raiders or bandits.
        // They never receive an attack animation or fight back.
        let attackers = ctx.db.combat_agent().owner().filter(scout.owner)
            .filter(|a| matches!(a.faction, 1 | 2) && a.health > 0.0 && a.state != 5
                && (a.x - scout.x).hypot(a.z - scout.z) < 2.5).count();
        if attackers > 0 { scout.health = (scout.health - attackers as f64 * 8.0 * elapsed_seconds).max(0.0); }
        let previous = (scout.x,scout.z);
        if scout.health > 0.0 && (scout.target_x-scout.x).hypot(scout.target_z-scout.z)>0.001 {
            if let (Some(navigation),Some(mut route)) = (navigation.as_ref(),ctx.db.realm_scout_route().settlement_id().find(scout.settlement_id)) {
                if let Ok(path) = serde_json::from_str::<Vec<[f64;2]>>(&route.waypoints_json) {
                    let roads = roads.as_ref().and_then(|networks| networks.get(&scout.owner)).unwrap_or_else(|| empty_roads.as_ref().unwrap());
                    let initial_leg = route.leg;
                    let mut remaining = 4.0 * elapsed_seconds.max(0.0);
                    while remaining > 0.001 && (route.leg as usize) < path.len() {
                        let target = path[route.leg as usize];
                        let dx=target[0]-scout.x; let dz=target[1]-scout.z; let distance=dx.hypot(dz);
                        if distance <= 0.001 { route.leg += 1; continue; }
                        let step=remaining.min(distance);
                        let point=(scout.x+dx/distance*step,scout.z+dz/distance*step);
                        if !navigation.civilian_segment_is_clear((scout.x,scout.z),point)
                            || !roads.segment_avoids_open_water(scout.x,scout.z,point.0,point.1) { break; }
                        scout.x=point.0; scout.z=point.1; remaining-=step;
                        if step >= distance-0.001 { route.leg += 1; }
                    }
                    if route.leg as usize >= path.len() { ctx.db.realm_scout_route().settlement_id().delete(route.settlement_id); }
                    else if route.leg != initial_leg { ctx.db.realm_scout_route().settlement_id().update(route); }
                }
            }
        }
        if previous == (scout.x,scout.z) && attackers == 0 { continue; }
        if scout.health <= 0.0 { ctx.db.realm_scout_route().settlement_id().delete(scout.settlement_id); }
        ctx.db.realm_scout().settlement_id().update(scout);
    }
}

/// Public appearance only: foreign inventories, labor and orders stay private.
#[spacetimedb::table(accessor = realm_entity,
    index(accessor = chunk, btree(columns = [chunk])),
    index(accessor = kind, btree(columns = [kind])))]
#[derive(Clone, PartialEq)]
pub struct RealmEntity {
    #[primary_key]
    pub id: String,
    pub owner: Identity,
    pub chunk: u32,
    pub kind: String,
    pub x: f64,
    pub z: f64,
    pub yaw: f64,
    pub tier: u8,
    pub complete: bool,
}

#[spacetimedb::view(accessor = visible_realm_entity, public, primary_key = id)]
pub fn visible_realm_entity(ctx: &ViewContext) -> Vec<RealmEntity> {
    let visibility = view_visibility(ctx);
    visibility.chunks().flat_map(|chunk| ctx.db.realm_entity().chunk().filter(chunk))
        .filter(|entity| entity.owner != ctx.sender() && visibility.contains(entity.x, entity.z)).collect()
}

pub fn refresh_entities(ctx: &ReducerContext) {
    refresh_entities_inner(ctx, true);
}
pub fn refresh_mobile_entities(ctx: &ReducerContext) {
    refresh_entities_inner(ctx, false);
}
fn refresh_entities_inner(ctx: &ReducerContext, include_static: bool) {
    if !ENABLED { return; }
    let mut current: BTreeMap<_, _> = if include_static {
        ctx.db.realm_entity().iter().map(|e| (e.id.clone(), e)).collect()
    } else {
        ["unit", "scout"].into_iter().flat_map(|kind| ctx.db.realm_entity().kind().filter(kind))
            .map(|e| (e.id.clone(), e)).collect()
    };
    let mut publish = |entity: RealmEntity| {
        if let Some(previous) = current.remove(&entity.id) {
            if previous != entity { ctx.db.realm_entity().id().update(entity); }
        } else { ctx.db.realm_entity().insert(entity); }
    };
    if include_static {
    for b in ctx.db.building().iter() {
        publish(RealmEntity { id: format!("building:{}", b.id), owner: b.owner, kind: b.kind,
            chunk: world_chunk(b.x, b.z).unwrap_or(0), x: b.x, z: b.z, yaw: b.placement_yaw,
            tier: b.chapel_tier, complete: b.construction_complete });
    }
    for r in ctx.db.residence().iter() {
        publish(RealmEntity { id: format!("residence:{}", r.id), owner: r.owner, kind: "residence".into(),
            chunk: world_chunk(r.x, r.z).unwrap_or(0), x: r.x, z: r.z, yaw: r.yaw, tier: r.tier, complete: r.tier > 0 });
    }
    }
    for a in ctx.db.combat_agent().iter().filter(|a| a.health > 0.0) {
        publish(RealmEntity { id: format!("unit:{}", a.id), owner: a.owner, kind: "unit".into(),
            chunk: world_chunk(a.x, a.z).unwrap_or(0), x: a.x, z: a.z,
            yaw: a.velocity_x.atan2(a.velocity_z), tier: a.faction, complete: true });
    }
    for a in ctx.db.realm_scout().iter().filter(|s| s.health > 0.0) {
        publish(RealmEntity { id: format!("scout:{}", a.settlement_id), owner: a.owner, kind: "scout".into(),
            chunk: world_chunk(a.x, a.z).unwrap_or(0), x: a.x, z: a.z,
            yaw: (a.target_x - a.x).atan2(a.target_z - a.z), tier: 0, complete: true });
    }
    for id in current.into_keys() { ctx.db.realm_entity().id().delete(id); }
}

#[spacetimedb::view(accessor = my_realm_member, public, primary_key = owner)]
pub fn my_realm_member(ctx: &ViewContext) -> impl Query<RealmMember> {
    ctx.from.realm_member().r#where(|row| row.owner.eq(ctx.sender()))
}

#[spacetimedb::view(accessor = my_realm_fog, public, primary_key = id)]
pub fn my_realm_fog(ctx: &ViewContext) -> impl Query<RealmFog> {
    ctx.from.realm_fog().r#where(|row| row.owner.eq(ctx.sender()))
}

/// Fixed-size camera interest affects replication only, never exploration.
#[spacetimedb::reducer]
pub fn set_realm_interest(ctx: &ReducerContext, x: f64, z: f64) -> Result<(), String> {
    if !ENABLED { return Ok(()); }
    let owner = ctx.sender();
    if ctx.db.realm_member().owner().find(owner).is_none() { return Err("Join the realm first.".into()); }
    let chunk = world_chunk(x, z).ok_or("Camera is outside the realm.")?;
    if let Some(previous) = ctx.db.realm_interest().owner().find(owner) {
        if previous.chunk != chunk { ctx.db.realm_interest().owner().update(RealmInterest { owner, chunk }); }
    } else { ctx.db.realm_interest().insert(RealmInterest { owner, chunk }); }
    Ok(())
}

pub fn require_single_player(action: &str) -> Result<(), String> {
    if ENABLED { Err(format!("{action} is unavailable in the persistent realm.")) } else { Ok(()) }
}

pub fn validate_construction(ctx: &ReducerContext, x: f64, z: f64) -> Result<(), String> {
    if !ENABLED { return Ok(()); }
    let owner = ctx.sender();
    if ctx.db.realm_member().owner().find(owner).is_none() { return Err("Join the realm to receive your campfire.".into()); }
    let (chunk, bit) = fog_bit(x, z).ok_or("Construction is outside the realm.")?;
    if !ctx.db.realm_fog().id().find(format!("{owner}:{chunk}")).is_some_and(|f| f.explored & bit != 0) {
        return Err("Explore this land with your units before building.".into());
    }
    // Claims protect room for established towns; neutral land remains available for outposts.
    for member in ctx.db.realm_member().iter() {
        if member.owner != owner && (x - member.camp_x).hypot(z - member.camp_z) < TOWN_RADIUS {
            return Err("This land belongs to another settlement.".into());
        }
    }
    if ctx.db.building().iter().any(|b| b.owner != owner && (b.x - x).hypot(b.z - z) < 48.0) {
        return Err("Another player's building occupies this site.".into());
    }
    Ok(())
}

pub fn admit(ctx: &ReducerContext) -> Result<(), String> {
    if !ENABLED { return Ok(()); }
    let owner = ctx.sender();
    if ctx.db.realm_member().owner().find(owner).is_some() { return Ok(()); }
    let occupied: std::collections::BTreeSet<u32> = ctx.db.realm_member().iter().map(|m| m.slot).collect();
    if occupied.len() >= MAX_PLAYERS { return Err("This persistent realm has reached its 50-settlement capacity.".into()); }
    // A prime-stride permutation scatters new neighbours; joining cannot choose coordinates.
    let spawn = (0..REGION_COLUMNS * REGION_COLUMNS)
        .map(|i| (i * 37 + 11) % (REGION_COLUMNS * REGION_COLUMNS))
        .filter(|slot| !occupied.contains(slot))
        .find_map(|slot| ctx.db.realm_spawn().slot().find(slot)
            .filter(|s| !ctx.db.building().iter().any(|b| (b.x - s.x).hypot(b.z - s.z) < 48.0)));
    let spawn = spawn.ok_or("No resource-accessible founding clearing is available.")?;
    crate::reducers::bootstrap::place_founding_camp(ctx, spawn.x, spawn.z, 0.0)?;
    ctx.db.realm_member().insert(RealmMember { owner, slot: spawn.slot,
        camp_x: spawn.x, camp_z: spawn.z, joined_at: ctx.timestamp });
    ctx.db.realm_interest().insert(RealmInterest { owner, chunk: world_chunk(spawn.x, spawn.z).unwrap() });
    let settlement = ctx.db.settlement().owner().filter(owner).next().ok_or("Founding settlement missing")?;
    recruit_realm_scout(ctx, settlement.id)?;
    refresh_owner_fog(ctx, owner);
    Ok(())
}

pub fn refresh_fog(ctx: &ReducerContext) {
    if !ENABLED { return; }
    for member in ctx.db.realm_member().iter() { refresh_owner_fog(ctx, member.owner); }
}

fn refresh_owner_fog(ctx: &ReducerContext, owner: Identity) {
    let mut masks = BTreeMap::new();
    for scout in ctx.db.realm_scout().owner().filter(owner).filter(|s| s.health > 0.0) {
        reveal_circle(&mut masks, scout.x, scout.z, UNIT_SIGHT);
    }
    for b in ctx.db.building().owner().filter(owner) {
        reveal_circle(&mut masks, b.x, b.z, if b.kind == "founders_camp" { CAMP_SIGHT } else { 64.0 });
    }
    for unit in ctx.db.combat_agent().owner().filter(owner) {
        // Owner also scopes hostile raid rows: hostile or downed agents grant no sight.
        if (unit.faction == 0 || unit.faction >= 3) && unit.health > 0.0 && unit.state != 5 {
            reveal_circle(&mut masks, unit.x, unit.z, UNIT_SIGHT);
        }
    }
    for trip in ctx.db.delivery_trip().owner().filter(owner) {
        reveal_circle(&mut masks, trip.x, trip.z, 64.0);
    }
    for previous in ctx.db.realm_fog().owner().filter(owner).collect::<Vec<_>>() {
        let visible = masks.remove(&previous.chunk).unwrap_or(0);
        let explored = previous.explored | visible;
        if visible != previous.visible || explored != previous.explored {
            ctx.db.realm_fog().id().update(RealmFog { visible, explored, ..previous });
        }
    }
    for (chunk, visible) in masks {
        ctx.db.realm_fog().insert(RealmFog { id: format!("{owner}:{chunk}"), owner, chunk, explored: visible, visible });
    }
}

/// One view evaluation uses one identity-scoped fog snapshot. This cache is
/// local to the call, so another player's view or a later fog update cannot
/// reuse it. Resource rows no longer deserialize a fog row per tree or node.
#[derive(Default)]
pub(crate) struct ViewVisibility {
    chunks: Vec<u32>,
    visible: BTreeMap<u32, u64>,
}

impl ViewVisibility {
    pub fn chunks(&self) -> impl Iterator<Item = u32> + '_ {
        self.chunks.iter().copied()
    }

    pub fn contains(&self, x: f64, z: f64) -> bool {
        if !ENABLED { return true; }
        fog_bit(x, z).is_some_and(|(chunk, bit)|
            self.visible.get(&chunk).is_some_and(|mask| mask & bit != 0))
    }
}

pub(crate) fn view_visibility(ctx: &ViewContext) -> ViewVisibility {
    if !ENABLED { return ViewVisibility::default(); }
    let camera = ctx.db.realm_interest().owner().find(ctx.sender()).map(|interest|
        ((interest.chunk % CHUNKS_PER_SIDE) as i32, (interest.chunk / CHUNKS_PER_SIDE) as i32));
    let mut visibility = ViewVisibility::default();
    for fog in ctx.db.realm_fog().owner().filter(ctx.sender()) {
        if fog.visible != 0 { visibility.visible.insert(fog.chunk, fog.visible); }
        if fog.explored != 0 && camera.is_some_and(|(cx, cz)|
            ((fog.chunk % CHUNKS_PER_SIDE) as i32 - cx).abs() <= 4
            && ((fog.chunk / CHUNKS_PER_SIDE) as i32 - cz).abs() <= 4)
        {
            visibility.chunks.push(fog.chunk);
        }
    }
    visibility
}
