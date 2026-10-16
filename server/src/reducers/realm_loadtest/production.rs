//! Local mature-town fixture coverage. Initial stock is seeded once; the real
//! scheduler owns every subsequent production, consumption and hauling change.
use crate::balance_generated::{
    CATTLE_MAX_SLOPE_DEGREES, FARM_MAX_ACCEPTED_SLOPE_DEGREES, GRAVEYARD_MAX_DISTANCE,
    GRAVEYARD_MAX_SLOPE, GRAVE_AREA_PER_BURIAL, SHEEP_MAX_SLOPE_DEGREES,
};
use crate::economy::{
    building_commodity_cap, building_commodity_stock, deposit_building_commodity,
    withdraw_building_commodity, ALL_COMMODITIES,
};
use crate::farming::{
    centroid, corners_from_values, initial_field_fertility, CROP_BARLEY, CROP_FALLOW, CROP_FLAX,
    CROP_OATS, CROP_RYE, STAGE_GROWING, STAGE_HARVESTING, STAGE_PLOUGHING, STAGE_SOWING,
};
use crate::placement_validation::{
    building_footprint_polygon_at_yaw, building_overlaps_road_surface_at_yaw,
    resolved_building_placement_yaw, resolved_existing_building_yaw,
    zone_overlaps_resource_deposit,
};
use crate::reducers::livestock::{
    set_livestock_species, trade_livestock, unstocked_pasture_herd, SPECIES_CATTLE, SPECIES_SHEEP,
};
use crate::roads::{load_owner_road_network, RoadNetwork};
use crate::{
    burgage::{convex_zones_overlap, Point2},
    db::*,
    tables::*,
};
use spacetimedb::{reducer, ReducerContext};

struct FixtureSpace {
    roads: RoadNetwork,
    land: RoadNetwork,
    occupied: Vec<[Point2; 4]>,
}

struct FixtureBuildingSite {
    x: f64,
    z: f64,
    yaw: f64,
    graveyard: Option<([f64; 8], f64)>,
}

fn rectangle(x: f64, z: f64, width: f64, depth: f64) -> [f64; 8] {
    [
        x - width / 2.0,
        z - depth / 2.0,
        x + width / 2.0,
        z - depth / 2.0,
        x + width / 2.0,
        z + depth / 2.0,
        x - width / 2.0,
        z + depth / 2.0,
    ]
}
fn polygon(values: [f64; 8]) -> [Point2; 4] {
    let c = corners_from_values(values);
    [c.a, c.b, c.c, c.d]
}
fn polygon_values(points: [Point2; 4]) -> [f64; 8] {
    [
        points[0].x,
        points[0].z,
        points[1].x,
        points[1].z,
        points[2].x,
        points[2].z,
        points[3].x,
        points[3].z,
    ]
}

impl FixtureSpace {
    fn new(ctx: &ReducerContext) -> Result<Self, String> {
        let roads =
            load_owner_road_network(ctx, ctx.sender()).ok_or("Seed the test town roads first")?;
        let mut occupied: Vec<_> = ctx
            .db
            .building()
            .iter()
            .map(|b| {
                building_footprint_polygon_at_yaw(
                    &b.kind,
                    b.x,
                    b.z,
                    resolved_existing_building_yaw(Some(&roads), &b),
                )
            })
            .collect();
        for r in ctx.db.burgage_zone().iter() {
            occupied.push(polygon([
                r.corner_ax,
                r.corner_az,
                r.corner_bx,
                r.corner_bz,
                r.corner_cx,
                r.corner_cz,
                r.corner_dx,
                r.corner_dz,
            ]));
        }
        for r in ctx.db.farm_field().iter() {
            occupied.push(polygon([
                r.corner_ax,
                r.corner_az,
                r.corner_bx,
                r.corner_bz,
                r.corner_cx,
                r.corner_cz,
                r.corner_dx,
                r.corner_dz,
            ]));
        }
        for r in ctx.db.pasture().iter() {
            occupied.push(polygon([
                r.corner_ax,
                r.corner_az,
                r.corner_bx,
                r.corner_bz,
                r.corner_cx,
                r.corner_cz,
                r.corner_dx,
                r.corner_dz,
            ]));
        }
        for r in ctx.db.graveyard().iter() {
            occupied.push(polygon([
                r.corner_ax,
                r.corner_az,
                r.corner_bx,
                r.corner_bz,
                r.corner_cx,
                r.corner_cz,
                r.corner_dx,
                r.corner_dz,
            ]));
        }
        let mut land = RoadNetwork::from_snapshot_json("{\"nodes\":[],\"edges\":[]}")
            .ok_or("Invalid empty navigation fixture")?;
        crate::roads::apply_world_navigation(&mut land);
        Ok(Self {
            roads,
            land,
            occupied,
        })
    }

    fn slope_if_free(
        &self,
        ctx: &ReducerContext,
        points: [Point2; 4],
        max_slope: f64,
    ) -> Option<f64> {
        if points
            .iter()
            .any(|p| crate::realm_policy::world_chunk(p.x, p.z).is_none())
            || self
                .occupied
                .iter()
                .any(|other| convex_zones_overlap(&points, other))
        {
            return None;
        }
        let corners = corners_from_values(polygon_values(points));
        if zone_overlaps_resource_deposit(ctx, &corners) {
            return None;
        }
        // Conservative bounding rectangle, sampled more finely than the shared
        // 24 m navigation cells. Check complete rows, not just parcel corners.
        let min_x = points.iter().map(|p| p.x).fold(f64::INFINITY, f64::min);
        let max_x = points.iter().map(|p| p.x).fold(f64::NEG_INFINITY, f64::max);
        let min_z = points.iter().map(|p| p.z).fold(f64::INFINITY, f64::min);
        let max_z = points.iter().map(|p| p.z).fold(f64::NEG_INFINITY, f64::max);
        let rows = ((max_z - min_z) / 8.0).ceil().max(1.0) as u32;
        let cols = ((max_x - min_x) / 8.0).ceil().max(1.0) as u32;
        let mut slope: f64 = 0.0;
        for row in 0..=rows {
            let z = min_z + (max_z - min_z) * f64::from(row) / f64::from(rows);
            if !self.land.segment_avoids_open_water(min_x, z, max_x, z) {
                return None;
            }
            for col in 0..=cols {
                let x = min_x + (max_x - min_x) * f64::from(col) / f64::from(cols);
                let dx = (self.land.combat_elevation(x + 4.0, z)
                    - self.land.combat_elevation(x - 4.0, z))
                    / 8.0;
                let dz = (self.land.combat_elevation(x, z + 4.0)
                    - self.land.combat_elevation(x, z - 4.0))
                    / 8.0;
                slope = slope.max(dx.hypot(dz).atan().to_degrees());
                if slope > max_slope {
                    return None;
                }
            }
        }
        Some(slope)
    }

    fn parcel(
        &mut self,
        ctx: &ReducerContext,
        parent: &Building,
        sizes: &[(f64, f64)],
        radius: f64,
        max_slope: f64,
    ) -> Option<([f64; 8], f64)> {
        for &(width, depth) in sizes {
            let stride = if radius < 64.0 { 4.0 } else { 16.0 };
            let reach = (radius / stride).ceil() as i32;
            // Larger parcels and the parent's nearby free land win deterministically.
            let mut candidates: Vec<_> = (-reach..=reach)
                .flat_map(|x| (-reach..=reach).map(move |z| (x, z)))
                .collect();
            candidates.sort_by_key(|&(x, z)| (x * x + z * z, z, x));
            for (x, z) in candidates {
                let values = rectangle(
                    parent.x + f64::from(x) * stride,
                    parent.z + f64::from(z) * stride,
                    width,
                    depth,
                );
                let points = polygon(values);
                if points
                    .iter()
                    .any(|p| (p.x - parent.x).hypot(p.z - parent.z) > radius)
                {
                    continue;
                }
                if let Some(slope) = self.slope_if_free(ctx, points, max_slope) {
                    self.occupied.push(points);
                    return Some((values, slope));
                }
            }
        }
        None
    }

    fn building_site(
        &mut self,
        ctx: &ReducerContext,
        template: &Building,
        kind: &str,
        target_x: f64,
        target_z: f64,
    ) -> Option<FixtureBuildingSite> {
        let mut candidates: Vec<_> = (-24i32..=24)
            .flat_map(|x| (-24i32..=24).map(move |z| (x, z)))
            .collect();
        candidates.sort_by_key(|&(x, z)| (x * x + z * z, z, x));
        for (dx, dz) in candidates {
            let x = target_x + f64::from(dx) * 4.0;
            let z = target_z + f64::from(dz) * 4.0;
            if self.roads.nearest_distance(x, z) > 18.0 {
                continue;
            }
            let yaw = resolved_building_placement_yaw(Some(&self.roads), kind, x, z);
            if building_overlaps_road_surface_at_yaw(&self.roads, kind, x, z, yaw) {
                continue;
            }
            let points = building_footprint_polygon_at_yaw(kind, x, z, yaw);
            if self.slope_if_free(ctx, points, 18.0).is_some() {
                self.occupied.push(points);
                let graveyard = if kind == "chapel" {
                    let mut probe = template.clone();
                    probe.x = x;
                    probe.z = z;
                    let Some(parcel) = self.parcel(
                        ctx,
                        &probe,
                        &[(20.0, 16.0), (16.0, 12.0), (12.0, 8.0)],
                        GRAVEYARD_MAX_DISTANCE,
                        GRAVEYARD_MAX_SLOPE,
                    ) else {
                        self.occupied.pop();
                        continue;
                    };
                    Some(parcel)
                } else {
                    None
                };
                return Some(FixtureBuildingSite {
                    x,
                    z,
                    yaw,
                    graveyard,
                });
            }
        }
        None
    }
}

fn insert_workshop(
    ctx: &ReducerContext,
    space: &mut FixtureSpace,
    template: &Building,
    kind: &str,
    x: f64,
    z: f64,
) -> Result<Building, String> {
    let site = space
        .building_site(ctx, template, kind, x, z)
        .ok_or_else(|| format!("No dry, free, road-linked fixture site for {kind} near {x},{z}"))?;
    let def = crate::building_defs::building_def(kind)
        .ok_or_else(|| format!("Unknown fixture kind {kind}"))?;
    let mut b = template.clone();
    for c in ALL_COMMODITIES.iter().copied() {
        let stock = building_commodity_stock(&b, c);
        withdraw_building_commodity(&mut b, c, stock);
    }
    let mut config = ctx.db.world_config().id().find(0).ok_or("No world")?;
    b.id = crate::reducers::buildings::next_available_building_id(ctx, config.next_building_id)?;
    config.next_building_id = b.id + 1;
    ctx.db.world_config().id().update(config);
    b.kind = kind.into();
    b.x = site.x;
    b.z = site.z;
    b.placement_yaw = site.yaw;
    b.placement_yaw_locked = true;
    b.construction_complete = true;
    b.construction_progress = 1.0;
    b.founding_shelter_active = false;
    b.work_radius = def.work_radius;
    b.assigned_labor = def.max_labor;
    b.water_capacity = def.storage_water;
    b.tree_work_area_x = 0.0;
    b.tree_work_area_z = 0.0;
    b.tree_work_area_radius = 0.0;
    for c in ALL_COMMODITIES.iter().copied() {
        let cap = building_commodity_cap(kind, c);
        if cap > 0.0 {
            deposit_building_commodity(&mut b, c, (cap * 0.5).min(500.0));
        }
    }
    if kind == "well" {
        b.water = b.water_capacity;
    }
    if kind == "chapel" {
        b.chapel_tier = 3;
        b.gold = 1000.0;
    }
    let b = ctx.db.building().insert(b);
    if let Some((values, slope)) = site.graveyard {
        insert_graveyard(ctx, &b, values, slope);
    }
    Ok(b)
}

fn insert_graveyard(ctx: &ReducerContext, chapel: &Building, v: [f64; 8], slope: f64) {
    let area = crate::farming::polygon_area(&corners_from_values(v));
    ctx.db.graveyard().insert(Graveyard {
        id: 0,
        owner: chapel.owner,
        chapel_id: chapel.id,
        corner_ax: v[0],
        corner_az: v[1],
        corner_bx: v[2],
        corner_bz: v[3],
        corner_cx: v[4],
        corner_cz: v[5],
        corner_dx: v[6],
        corner_dz: v[7],
        area,
        average_slope_degrees: slope,
        capacity: (area / GRAVE_AREA_PER_BURIAL.max(1.0)).floor() as u32,
        burials: 0,
    });
}

#[reducer]
pub fn loadtest_complete_production_town(ctx: &ReducerContext) -> Result<(), String> {
    let owner = ctx.sender();
    let mut settlements: Vec<_> = ctx.db.settlement().owner().filter(owner).collect();
    settlements.sort_by_key(|s| s.id);
    let mut space = FixtureSpace::new(ctx)?;
    for settlement in settlements {
        let mut homes: Vec<_> = ctx
            .db
            .residence()
            .owner()
            .filter(owner)
            .filter(|r| r.settlement_id == settlement.id)
            .collect();
        homes.sort_by_key(|r| r.id);
        if homes.is_empty() {
            continue;
        }
        let large = homes.len() >= 96;
        let mut sites: Vec<_> = ctx
            .db
            .building()
            .owner()
            .filter(owner)
            .filter(|b| b.settlement_id == settlement.id)
            .collect();
        sites.sort_by_key(|b| b.id);
        let template = sites.first().ok_or("No test workshop template")?.clone();
        for kind in [
            "chapel",
            "brewery",
            "smokehouse",
            "spinning_retting_house",
            "threshing_barn",
            "windmill",
            "bakery",
            "pastoral_farmstead",
        ] {
            let count = sites.iter().filter(|b| b.kind == kind).count();
            for i in count..if large { 2 } else { 1 } {
                let b = insert_workshop(
                    ctx,
                    &mut space,
                    &template,
                    kind,
                    settlement.anchor_x + 180.0,
                    settlement.anchor_z - 40.0 + i as f64 * 24.0,
                )?;
                sites.push(b);
            }
        }
        // Give every occupied home a road-linked well slot. Water refills and
        // distribution remain ordinary work after this one-time fixture setup.
        for home in &homes {
            if !crate::simulation::road_logistics::claim_residences_for_wells(
                &space.roads, &sites, &homes,
            ).contains_key(&home.id)
            {
                let b = insert_workshop(
                    ctx,
                    &mut space,
                    &template,
                    "well",
                    home.x + 12.5,
                    home.z + 12.0,
                )?;
                sites.push(b);
                if !crate::simulation::road_logistics::claim_residences_for_wells(
                    &space.roads, &sites, &homes,
                ).contains_key(&home.id) {
                    return Err("Fixture home has no road-linked well service slot".into());
                }
            }
        }
        // Reserve short-range pastures and graveyards before broad-range fields.
        let pastoral: Vec<_> = sites
            .iter()
            .filter(|b| b.kind == "pastoral_farmstead")
            .collect();
        for (i, parent) in pastoral.into_iter().enumerate() {
            if ctx
                .db
                .pasture()
                .farmstead_id()
                .filter(parent.id)
                .next()
                .is_some()
            {
                continue;
            }
            let species = if i % 2 == 0 {
                SPECIES_CATTLE
            } else {
                SPECIES_SHEEP
            };
            let max_slope = if species == SPECIES_CATTLE {
                CATTLE_MAX_SLOPE_DEGREES
            } else {
                SHEEP_MAX_SLOPE_DEGREES
            };
            let (v, slope) = space
                .parcel(
                    ctx,
                    parent,
                    if species == SPECIES_CATTLE {
                        &[
                            (64.0, 48.0),
                            (48.0, 40.0),
                            (48.0, 36.0),
                            (36.0, 48.0),
                            (56.0, 32.0),
                            (32.0, 56.0),
                        ]
                    } else {
                        &[(64.0, 48.0), (48.0, 40.0), (32.0, 32.0)]
                    },
                    parent.work_radius,
                    max_slope,
                )
                .ok_or_else(|| format!("No legal pasture for holding {}", parent.id))?;
            let c = centroid(&corners_from_values(v));
            let config = ctx.db.world_config().id().find(0).unwrap();
            let pasture = ctx.db.pasture().insert(Pasture {
                id: 0,
                owner,
                farmstead_id: parent.id,
                corner_ax: v[0],
                corner_az: v[1],
                corner_bx: v[2],
                corner_bz: v[3],
                corner_cx: v[4],
                corner_cz: v[5],
                corner_dx: v[6],
                corner_dz: v[7],
                area: crate::farming::polygon_area(&corners_from_values(v)),
                average_slope_degrees: slope,
                moisture: crate::hydrology::sample_world_groundwater_score(
                    c.x,
                    c.z,
                    config.seed,
                    config.hydrology,
                ),
            });
            set_livestock_species(ctx, pasture.id, species)?;
            let herd = unstocked_pasture_herd(&pasture, species);
            let heads = crate::simulation::grazing_capacity_for_pasture(ctx, &pasture, &herd)
                .floor()
                .min(10.0) as i32;
            if heads < 2 {
                return Err(format!(
                    "Pasture {} cannot sustain a breeding herd",
                    pasture.id
                ));
            }
            trade_livestock(ctx, pasture.id, heads)?;
        }
        for parent in sites.iter().filter(|b| b.kind == "chapel") {
            if ctx
                .db
                .graveyard()
                .chapel_id()
                .filter(parent.id)
                .next()
                .is_some()
            {
                continue;
            }
            let (v, slope) = space
                .parcel(
                    ctx,
                    parent,
                    &[(20.0, 16.0), (16.0, 12.0), (12.0, 8.0)],
                    GRAVEYARD_MAX_DISTANCE,
                    GRAVEYARD_MAX_SLOPE,
                )
                .ok_or_else(|| format!("No legal burial ground for chapel {}", parent.id))?;
            let area = crate::farming::polygon_area(&corners_from_values(v));
            ctx.db.graveyard().insert(Graveyard {
                id: 0,
                owner,
                chapel_id: parent.id,
                corner_ax: v[0],
                corner_az: v[1],
                corner_bx: v[2],
                corner_bz: v[3],
                corner_cx: v[4],
                corner_cz: v[5],
                corner_dx: v[6],
                corner_dz: v[7],
                area,
                average_slope_degrees: slope,
                capacity: (area / GRAVE_AREA_PER_BURIAL.max(1.0)).floor() as u32,
                burials: 0,
            });
        }
        // Alternate holdings so an early barn cannot consume all shared arable
        // ground before its neighbour gets a field. Smaller legal parcels fill
        // constrained edges without overlapping any residence or holding.
        for i in 0..6 {
            for parent in sites.iter().filter(|b| b.kind == "threshing_barn") {
                if ctx.db.farm_field().farmstead_id().filter(parent.id).count() > i {
                    continue;
                }
                let (v, slope) = space
                    .parcel(
                        ctx,
                        parent,
                        &[
                            (96.0, 64.0),
                            (64.0, 48.0),
                            (48.0, 40.0),
                            (32.0, 24.0),
                            (24.0, 16.0),
                        ],
                        parent.work_radius,
                        FARM_MAX_ACCEPTED_SLOPE_DEGREES,
                    )
                    .ok_or_else(|| format!("No legal field {i} for barn {}", parent.id))?;
                let config = ctx.db.world_config().id().find(0).unwrap();
                let c = centroid(&corners_from_values(v));
                let moisture = crate::hydrology::sample_world_groundwater_score(
                    c.x,
                    c.z,
                    config.seed,
                    config.hydrology,
                );
                let crops = [
                    CROP_RYE,
                    CROP_OATS,
                    CROP_BARLEY,
                    CROP_FLAX,
                    CROP_RYE,
                    CROP_OATS,
                ];
                ctx.db.farm_field().insert(FarmField {
                    id: 0,
                    owner,
                    farmstead_id: parent.id,
                    corner_ax: v[0],
                    corner_az: v[1],
                    corner_bx: v[2],
                    corner_bz: v[3],
                    corner_cx: v[4],
                    corner_cz: v[5],
                    corner_dx: v[6],
                    corner_dz: v[7],
                    area: crate::farming::polygon_area(&corners_from_values(v)),
                    average_slope_degrees: slope,
                    moisture,
                    fertility: initial_field_fertility(moisture, slope, c.x, c.z),
                    crop: crops[i],
                    next_crop: crops[(i + 1) % 6],
                    following_crop: CROP_FALLOW,
                    // Mature initial condition: mixed sowing, growth and harvest
                    // exercise physical crop haulage immediately. No calendar or
                    // ongoing stock refill is used by this local-only fixture.
                    stage: match i % 4 {
                        0 => STAGE_HARVESTING,
                        1 => STAGE_SOWING,
                        2 => STAGE_GROWING,
                        _ => STAGE_PLOUGHING,
                    },
                    stage_progress: if i % 4 == 2 { 0.65 } else { 0.0 },
                    priority: 1,
                    harvest_count: 0,
                    last_yield: 0.0,
                    current_yield: 0.0,
                    harvest_yield_multiplier: 1.0,
                    manure_applied: 0.0,
                });
            }
        }
    }
    // Clear only the physical fixture parcels, leaving grazing trees intact.
    let mut clearings: Vec<_> = ctx
        .db
        .farm_field()
        .owner()
        .filter(owner)
        .map(|f| {
            corners_from_values([
                f.corner_ax,
                f.corner_az,
                f.corner_bx,
                f.corner_bz,
                f.corner_cx,
                f.corner_cz,
                f.corner_dx,
                f.corner_dz,
            ])
        })
        .collect();
    clearings.extend(ctx.db.graveyard().owner().filter(owner).map(|f| {
        corners_from_values([
            f.corner_ax,
            f.corner_az,
            f.corner_bx,
            f.corner_bz,
            f.corner_cx,
            f.corner_cz,
            f.corner_dx,
            f.corner_dz,
        ])
    }));
    let cleared: Vec<_> = ctx
        .db
        .tree_entity()
        .iter()
        .filter(|tree| {
            clearings.iter().any(|c| {
                crate::farming::point_in_field(
                    Point2 {
                        x: tree.x,
                        z: tree.z,
                    },
                    c,
                )
            })
        })
        .map(|t| t.tree_id)
        .collect();
    for id in cleared {
        ctx.db.tree_entity().tree_id().delete(id);
    }
    crate::realm::refresh_fog(ctx);
    crate::realm::refresh_entities(ctx);
    Ok(())
}
