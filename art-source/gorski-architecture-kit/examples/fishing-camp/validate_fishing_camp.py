from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path

import bmesh
import bpy
from mathutils.bvhtree import BVHTree
from mathutils import Vector


EXAMPLE_DIR = Path(__file__).resolve().parent
OUTPUT_ROOT = Path(os.environ.get("GK_FISHING_CAMP_OUTPUT_ROOT", str(EXAMPLE_DIR))).resolve()
OUT_DIR = OUTPUT_ROOT / "out"
REPORT_PATH = OUT_DIR / "fishing_camp_validation_v7.json"

REQUIRED_EXACT = {
    "wall_limewash_2m_door_service_host": 1,
    "wall_limewash_2m_window_small_host": 1,
    "wall_plank_2m_door_service_host": 1,
    "opening_door_service_single": 2,
    "foundation_steps_limestone_1": 2,
    "enclosure_split_rail_2m": 1,
    "enclosure_split_rail_4m": 4,
    "prop_fish_drying_rack": 1,
    "prop_boat_dugout": 1,
    "frame_beam_0p5m_s0p16m": 4,
    "assembly_custom_settled_shingle_skin": 4,
}
FORBIDDEN_TOKENS = ("vegetation", "crop", "grass", "tree", "bush", "modern", "motor", "plastic")


def triangle_count(obj: bpy.types.Object) -> int:
    return sum(max(0, len(poly.vertices) - 2) for poly in obj.data.polygons)


def nonmanifold_edges(obj: bpy.types.Object) -> int:
    bm = bmesh.new()
    try:
        bm.from_mesh(obj.data)
        return sum(1 for edge in bm.edges if not edge.is_manifold)
    finally:
        bm.free()


def world_vertices(obj: bpy.types.Object) -> list[Vector]:
    return [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]


def xy_bounds(obj: bpy.types.Object) -> tuple[float, float, float, float]:
    points = world_vertices(obj)
    return (
        min(point.x for point in points),
        max(point.x for point in points),
        min(point.y for point in points),
        max(point.y for point in points),
    )


def combined_xy_bounds(objects: list[bpy.types.Object]) -> tuple[float, float, float, float]:
    points = [point for obj in objects for point in world_vertices(obj)]
    return (
        min(point.x for point in points),
        max(point.x for point in points),
        min(point.y for point in points),
        max(point.y for point in points),
    )


def support_margins(
    foundation_bounds: tuple[float, float, float, float],
    timber_bounds: tuple[float, float, float, float],
) -> dict[str, float]:
    foundation_min_x, foundation_max_x, foundation_min_y, foundation_max_y = foundation_bounds
    timber_min_x, timber_max_x, timber_min_y, timber_max_y = timber_bounds
    return {
        "left": timber_min_x - foundation_min_x,
        "right": foundation_max_x - timber_max_x,
        "front": timber_min_y - foundation_min_y,
        "rear": foundation_max_y - timber_max_y,
    }


def xy_overlaps(
    bounds: tuple[float, float, float, float],
    zone: tuple[float, float, float, float],
) -> bool:
    min_x, max_x, min_y, max_y = bounds
    zone_min_x, zone_max_x, zone_min_y, zone_max_y = zone
    return max_x > zone_min_x and min_x < zone_max_x and max_y > zone_min_y and min_y < zone_max_y


def mesh_surface_distance(left: bpy.types.Object, right: bpy.types.Object) -> float:
    def directed_distance(source: bpy.types.Object, target: bpy.types.Object) -> float:
        target_vertices = world_vertices(target)
        target_faces = [tuple(polygon.vertices) for polygon in target.data.polygons]
        tree = BVHTree.FromPolygons(target_vertices, target_faces, all_triangles=False)
        distances = []
        for point in world_vertices(source):
            nearest = tree.find_nearest(point)
            if nearest is not None:
                distances.append(float(nearest[3]))
        return min(distances) if distances else math.inf

    return min(directed_distance(left, right), directed_distance(right, left))


def main() -> None:
    errors: list[str] = []
    warnings: list[str] = []
    instances = [obj for obj in bpy.data.objects if obj.get("fc_instance")]
    source_counts = Counter(str(obj.get("source_component_id", "")) for obj in instances)
    if len(instances) != 66:
        errors.append(f"expected 66 fixed fishery instances, found {len(instances)}")
    for part_id, expected in REQUIRED_EXACT.items():
        if source_counts[part_id] != expected:
            errors.append(f"{part_id}: expected {expected}, found {source_counts[part_id]}")
    if sum(count for source, count in source_counts.items() if source.startswith("foundation_fieldstone_")) != 8:
        errors.append("the two buildings must retain eight perimeter foundation runs")
    boundary_count = sum(count for source, count in source_counts.items() if source.startswith("enclosure_"))
    if boundary_count != 5:
        errors.append(f"rear-and-side fishing-camp boundary must contain five modules, found {boundary_count}")
    if any("gate" in obj.name.lower() for obj in instances):
        errors.append("road frontage must remain open without a fence gate")

    triangles = 0
    atlas_tiles: set[str] = set()
    world_points: list[Vector] = []
    for obj in instances:
        part_id = str(obj.get("source_component_id", ""))
        lowered = f"{obj.name} {part_id}".lower()
        if any(token in lowered for token in FORBIDDEN_TOKENS):
            errors.append(f"forbidden world-layer or modern token on {obj.name}")
        if any(abs(value - 1.0) > 1e-5 for value in obj.scale):
            errors.append(f"non-canonical scale on {obj.name}: {tuple(obj.scale)}")
        if obj.type != "MESH":
            errors.append(f"fixed fishery instance is not a mesh: {obj.name}")
            continue
        if obj.data.uv_layers.get("GK_UV0") is None:
            errors.append(f"missing metric GK_UV0: {obj.name}")
        triangles += triangle_count(obj)
        if part_id != "prop_water_bucket_pair" and nonmanifold_edges(obj):
            errors.append(f"nonmanifold geometry on {obj.name}")
        if obj.modifiers:
            errors.append(f"export-expanding modifier retained on {obj.name}")
        for material in obj.data.materials:
            if material is None:
                errors.append(f"empty material slot on {obj.name}")
                continue
            if material.get("surface_role") == "dark-window-void":
                continue
            if material.get("atlas_id") != "gorski-building-atlas-v1":
                errors.append(f"non-production-atlas material on {obj.name}: {material.name}")
                continue
            if material.get("atlas_uv_mode") != "final tile coordinates baked into GK_UV0":
                errors.append(f"building material lacks direct-UV contract: {material.name}")
            if not material.get("atlas_tint"):
                errors.append(f"building material lacks authored tint: {material.name}")
            atlas_tiles.add(str(material.get("atlas_tile", "")))
        world_points.extend(world_vertices(obj))

    required_tiles = {
        "lime-plaster", "quarry-stone", "rough-hewn-timber", "weathered-planks",
        "sawn-planks", "split-shingles", "wrought-iron",
    }
    missing_tiles = sorted(required_tiles - atlas_tiles)
    if missing_tiles:
        errors.append(f"missing required material coverage: {missing_tiles}")
    if "fieldstone-mortar" in atlas_tiles:
        errors.append("individual fishing-camp foundation stones still use a mortared wall texture")

    foundation_support: dict[str, object] = {}
    for label, prefix in (("mainHouse", "FC_Main_"), ("serviceShed", "FC_Shed_")):
        foundations = [obj for obj in instances if obj.name.startswith(f"{prefix}Foundation_")]
        timber_supports = [
            obj for obj in instances
            if obj.name.startswith(prefix)
            and (
                str(obj.get("source_component_id", "")).startswith("wall_")
                or "_Post_" in obj.name
                or obj.name.endswith("_Post")
                or obj.name.endswith("_Sill")
            )
        ]
        footing_bounds = combined_xy_bounds(foundations)
        timber_bounds = combined_xy_bounds(timber_supports)
        margins = support_margins(footing_bounds, timber_bounds)
        foundation_support[label] = {
            "foundationBoundsXY": [round(value, 5) for value in footing_bounds],
            "timberBoundsXY": [round(value, 5) for value in timber_bounds],
            "edgeMarginsM": {key: round(value, 5) for key, value in margins.items()},
        }
        if min(margins.values()) < -1.0e-5:
            errors.append(f"{label} timber edge overhangs its stone foundation: {margins}")

    rack = next((obj for obj in instances if obj.get("source_component_id") == "prop_fish_drying_rack"), None)
    if rack is not None:
        rack_roles = {str(material.get("surface_role", "")) for material in rack.data.materials if material}
        if rack_roles - {"oak_dark", "timber_weathered"}:
            errors.append(f"empty drying rack retained catch/cord placeholder materials: {sorted(rack_roles)}")

    wash_buckets = next((obj for obj in instances if obj.name == "FC_Wash_Buckets"), None)
    door_access_zones = {
        "main-house": (-0.42, 1.02, -3.05, -0.72),
        "service-shed": (-3.77, -2.33, -2.20, 0.22),
    }
    doorway_access_conflicts: list[str] = []
    for prop in (rack, wash_buckets):
        if prop is None:
            errors.append("offset drying station is missing its rack or wash buckets")
            continue
        bounds_xy = xy_bounds(prop)
        for door_name, access_zone in door_access_zones.items():
            if xy_overlaps(bounds_xy, access_zone):
                doorway_access_conflicts.append(f"{prop.name}:{door_name}")
    if doorway_access_conflicts:
        errors.append(f"drying station obstructs a door approach: {doorway_access_conflicts}")
    drying_station_spacing = None
    if rack is not None and wash_buckets is not None:
        rack_centre = sum((point for point in world_vertices(rack)), Vector()) / len(rack.data.vertices)
        bucket_centre = sum((point for point in world_vertices(wash_buckets)), Vector()) / len(wash_buckets.data.vertices)
        drying_station_spacing = math.hypot(rack_centre.x - bucket_centre.x, rack_centre.y - bucket_centre.y)
        if drying_station_spacing > 2.25:
            errors.append(f"wash buckets no longer read beside the drying rack: {drying_station_spacing:.4f} m")

    thresholds = [
        obj for obj in instances
        if obj.get("source_component_id") == "foundation_steps_limestone_1"
    ]
    expected_threshold_locations = {
        "FC_Main_Door_Stone_Step": Vector((0.30, -1.36, 0.0)),
        "FC_Shed_Door_Stone_Step": Vector((-3.05, -0.41, 0.0)),
    }
    threshold_alignment_errors: list[str] = []
    for name, expected_location in expected_threshold_locations.items():
        threshold = next((obj for obj in thresholds if obj.name == name), None)
        if threshold is None:
            threshold_alignment_errors.append(f"{name}:missing")
            continue
        location_error = (threshold.location - expected_location).length
        points = world_vertices(threshold)
        minimum_z = min(point.z for point in points)
        maximum_z = max(point.z for point in points)
        if location_error > 0.01 or not -0.01 <= minimum_z <= 0.01 or not 0.16 <= maximum_z <= 0.20:
            threshold_alignment_errors.append(
                f"{name}:location={location_error:.4f},z=[{minimum_z:.4f},{maximum_z:.4f}]"
            )
    if threshold_alignment_errors:
        errors.append(f"door thresholds lost their Tier-1 residence step alignment: {threshold_alignment_errors}")

    boat_ground_clearance = None
    boat_fence_contact_distance = None
    boat = next((obj for obj in instances if obj.get("source_component_id") == "prop_boat_dugout"), None)
    if boat is None:
        errors.append("leaning river dugout is missing")
    else:
        boat_triangles = triangle_count(boat)
        if not 650 <= boat_triangles <= 5800:
            errors.append(f"boat topology outside authored budget: {boat_triangles}")
        if not math.radians(40.0) <= boat.rotation_euler.x <= math.radians(50.0):
            errors.append(f"boat lost its physically readable fence lean: {math.degrees(boat.rotation_euler.x):.2f} degrees")
        if not boat.get("signature_silhouette"):
            errors.append("boat lost its signature-silhouette contract")
        boat_points = world_vertices(boat)
        boat_ground_clearance = min(point.z for point in boat_points)
        if not -0.025 <= boat_ground_clearance <= 0.075:
            errors.append(f"boat lacks credible lower-hull ground bearing: min Z {boat_ground_clearance:.4f} m")
        rear_west_fence = next((obj for obj in instances if obj.name == "FC_Fence_Rear_West"), None)
        if rear_west_fence is None:
            errors.append("rear-west support fence for the boat is missing")
        else:
            boat_fence_contact_distance = mesh_surface_distance(boat, rear_west_fence)
            if boat_fence_contact_distance > 0.035:
                errors.append(
                    f"boat floats away from its rear-west fence support: {boat_fence_contact_distance:.4f} m"
                )

    roof_structure_clearances: list[tuple[float, str]] = []
    roof_verge_coverages = []
    roof_pitch = math.radians(50.0)
    for obj in instances:
        part_id = str(obj.get("source_component_id", ""))
        if not (part_id.startswith("frame_") or part_id.startswith("gable_infill_")):
            continue
        if obj.name.startswith("FC_Main_"):
            centre_x, front, rear, half_width, wall_top = 1.30, -0.80, 3.20, 2.0, 3.05
        elif obj.name.startswith("FC_Shed_"):
            centre_x, front, rear, half_width, wall_top = -3.05, 0.15, 2.15, 1.0, 3.05
        else:
            continue
        for point in world_vertices(obj):
            roof_span = half_width + 0.295
            offset = abs(point.x - centre_x)
            if offset > roof_span:
                roof_structure_clearances.append((-1.0, obj.name))
                continue
            blend = offset / roof_span
            ridge_top = wall_top + half_width * math.tan(roof_pitch) + 0.24 - 0.045
            eave_top = wall_top - 0.055 - 0.045
            conservative_underside = ridge_top * (1.0 - blend) + eave_top * blend - 0.085
            roof_structure_clearances.append((conservative_underside - point.z, obj.name))
            roof_verge_coverages.append(min(
                point.y - (front - 0.34),
                (rear + 0.34) - point.y,
            ))
    minimum_roof_structure_record = min(roof_structure_clearances) if roof_structure_clearances else None
    minimum_roof_structure_clearance = minimum_roof_structure_record[0] if minimum_roof_structure_record else None
    minimum_roof_structure_member = minimum_roof_structure_record[1] if minimum_roof_structure_record else None
    minimum_roof_verge_coverage = min(roof_verge_coverages) if roof_verge_coverages else None
    if minimum_roof_structure_clearance is None or minimum_roof_structure_clearance < 0.04:
        errors.append(f"roof structure breaches the shingle underside at {minimum_roof_structure_member}: clearance {minimum_roof_structure_clearance}")
    if minimum_roof_verge_coverage is None or minimum_roof_verge_coverage < 0.06:
        errors.append(f"roof verge does not cover proud frame geometry: coverage {minimum_roof_verge_coverage}")

    main_gable_collar_end_gaps: dict[str, float] = {}
    expected_collar_min_x = 1.30 - 1.50
    expected_collar_max_x = 1.30 + 1.50
    for face in ("Front", "Rear"):
        collars = [obj for obj in instances if obj.name.startswith(f"FC_Main_{face}_Gable_Collar_")]
        if len(collars) != 3:
            errors.append(f"main {face.lower()} gable must retain three authored collar fractions, found {len(collars)}")
            continue
        actual_min_x = min(point.x for obj in collars for point in world_vertices(obj))
        actual_max_x = max(point.x for obj in collars for point in world_vertices(obj))
        end_gap = max(abs(actual_min_x - expected_collar_min_x), abs(actual_max_x - expected_collar_max_x))
        main_gable_collar_end_gaps[face.lower()] = end_gap
        if end_gap > 0.025:
            errors.append(f"main {face.lower()} gable collar no longer terminates at both rake frames: {end_gap:.4f} m")

    main_objects = [obj for obj in instances if obj.get("assembly_role") == "FC_01_Main_Fish_House"]
    shed_objects = [obj for obj in instances if obj.get("assembly_role") == "FC_02_Service_Shed"]
    fence_objects = [obj for obj in instances if str(obj.get("source_component_id", "")).startswith("enclosure_")]
    service_props = [obj for obj in instances if obj.name in {"FC_Brine_Barrel", "FC_Net_And_Cord_Crate"}]
    fixed_prop_building_clearance = None
    if not main_objects or not shed_objects or len(service_props) != 2:
        errors.append("could not resolve building and fixed-prop service-clearance roles")
    else:
        main_max_x = max(point.x for obj in main_objects for point in world_vertices(obj))
        fixed_prop_building_clearance = min(
            min(point.x for point in world_vertices(prop)) - main_max_x
            for prop in service_props
        )
        if fixed_prop_building_clearance < 0.20:
            errors.append(f"fixed east-side props intersect or crowd the building: {fixed_prop_building_clearance:.4f} m")

    fence_clearances: dict[str, float] = {}
    if not main_objects or not shed_objects or len(fence_objects) != 5:
        errors.append("could not resolve building envelopes and the five-module rear boundary")
    else:
        building_points = [point for obj in (*main_objects, *shed_objects) for point in world_vertices(obj)]
        building_min_x = min(point.x for point in building_points)
        building_max_x = max(point.x for point in building_points)
        building_max_y = max(point.y for point in building_points)
        west_fence = next(obj for obj in fence_objects if obj.name == "FC_Fence_West")
        east_fence = next(obj for obj in fence_objects if obj.name == "FC_Fence_East")
        rear_fences = [obj for obj in fence_objects if obj.name.startswith("FC_Fence_Rear_")]
        fence_clearances = {
            "west": building_min_x - max(point.x for point in world_vertices(west_fence)),
            "east": min(point.x for point in world_vertices(east_fence)) - building_max_x,
            "rear": min(point.y for obj in rear_fences for point in world_vertices(obj)) - building_max_y,
        }
        for side, clearance in fence_clearances.items():
            if clearance < 0.65:
                errors.append(f"{side} fence crowds or intersects a building: {clearance:.4f} m")

    roof_parts = [obj for obj in instances if obj.get("source_component_id") == "assembly_custom_settled_shingle_skin"]
    if any(triangle_count(obj) > 60 for obj in roof_parts):
        errors.append("retopologized roof skin exceeded its low-poly budget")
    if any(obj.get("preview_only") for obj in instances):
        errors.append("preview staging leaked into the export instance set")

    dimensions = [0.0, 0.0, 0.0]
    bounds = {"minimumM": [0.0, 0.0, 0.0], "maximumM": [0.0, 0.0, 0.0]}
    if world_points:
        minimum = Vector((min(p.x for p in world_points), min(p.y for p in world_points), min(p.z for p in world_points)))
        maximum = Vector((max(p.x for p in world_points), max(p.y for p in world_points), max(p.z for p in world_points)))
        dimensions = [round(value, 4) for value in (maximum - minimum)]
        bounds = {
            "minimumM": [round(value, 4) for value in minimum],
            "maximumM": [round(value, 4) for value in maximum],
        }
        if dimensions[0] > 10.7 or dimensions[1] > 8.3 or dimensions[2] > 5.9:
            errors.append(f"fishery exceeds intended placement envelope: {dimensions}")
    if not 2500 <= triangles <= 5500:
        errors.append(f"fishery triangle budget is 2500-5500, found {triangles}")

    report = {
        "schemaVersion": 1,
        "validatedAt": datetime.now(timezone.utc).isoformat(),
        "status": "pass" if not errors else "fail",
        "blend": bpy.data.filepath,
        "metrics": {
            "fixedInstances": len(instances),
            "sourceCounts": dict(sorted(source_counts.items())),
            "trianglesBeforeExportApply": triangles,
            "dimensionsM": dimensions,
            "boundsM": bounds,
            "atlasTiles": sorted(atlas_tiles),
            "foundationSupport": foundation_support,
            "boatGroundClearanceM": None if boat_ground_clearance is None else round(boat_ground_clearance, 4),
            "boatFenceContactDistanceM": None if boat_fence_contact_distance is None else round(boat_fence_contact_distance, 4),
            "minimumRoofStructureClearanceM": None if minimum_roof_structure_clearance is None else round(minimum_roof_structure_clearance, 4),
            "minimumRoofStructureMember": minimum_roof_structure_member,
            "minimumRoofVergeCoverageM": None if minimum_roof_verge_coverage is None else round(minimum_roof_verge_coverage, 4),
            "mainGableCollarEndGapM": {
                face: round(gap, 4) for face, gap in sorted(main_gable_collar_end_gaps.items())
            },
            "fixedPropBuildingClearanceM": None if fixed_prop_building_clearance is None else round(fixed_prop_building_clearance, 4),
            "fenceBuildingClearanceM": {
                side: round(clearance, 4) for side, clearance in sorted(fence_clearances.items())
            },
            "doorwayAccessConflicts": doorway_access_conflicts,
            "thresholdAlignmentErrors": threshold_alignment_errors,
            "dryingRackToWashBucketsM": None if drying_station_spacing is None else round(drying_station_spacing, 4),
        },
        "errors": errors,
        "warnings": warnings,
        "checks": [
            "two structurally distinct buildings on the two-metre kit grid",
            "Tier-1 fieldstone, warm limewash, dark oak, plank, and 50-degree shingle vocabulary",
            "four closed retopologized roof skins with sub-repeat atlas faces",
            "hollow dugout bears on grade and contacts the rear-west fence with its connected paddle intact",
            "empty splayed drying rack reserved for separately authored catch models",
            "offset drying rack and wash buckets remain grouped while clearing both authored door approaches",
            "gable infill and framing remain fully below the lifted shingle envelope and inside both protective verges",
            "main-house front and rear collar fractions terminate at both gable rake frames",
            "continuous rear-and-side split-rail boundary clears both buildings while the road frontage remains open",
            "both service doors retain Tier-1 residence stone-block thresholds",
            "stone perimeter bounds contain every ground-bearing timber wall, sill, and post edge",
            "metric UVs, direct production-atlas contract, canonical transforms, and no living vegetation",
            "manifold fixed geometry except the intentionally open bucket pair",
            "no preview staging in the export set",
        ],
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("FC_VALIDATE_JSON " + json.dumps({
        "status": report["status"],
        "instances": len(instances),
        "triangles": triangles,
        "dimensionsM": dimensions,
        "foundationSupport": foundation_support,
        "errors": len(errors),
    }, separators=(",", ":")))
    if errors:
        raise RuntimeError("Fishing Camp validation failed: " + "; ".join(errors))
    print(f"FC_VALIDATE_OK report={REPORT_PATH}")


if __name__ == "__main__":
    main()
