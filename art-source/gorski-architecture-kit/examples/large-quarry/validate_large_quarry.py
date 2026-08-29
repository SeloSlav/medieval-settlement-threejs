from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector


EXAMPLE_DIR = Path(__file__).resolve().parent
OUTPUT_ROOT = Path(os.environ.get("GK_LARGE_QUARRY_OUTPUT_ROOT", str(EXAMPLE_DIR))).resolve()
OUT_DIR = OUTPUT_ROOT / "out"
REPORT_PATH = OUT_DIR / "large_quarry_validation_v1.json"

REQUIRED_EXACT = {
    "extract_quarry_bench_4m": 5,
    "extract_quarry_derrick_large": 1,
    "extract_ore_bucket": 1,
    "site_walkway_plank_4m": 1,
    "foundation_retaining_wall_4m": 2,
    "site_canopy_timber_4m_d2m": 1,
    "extract_sorting_bench": 1,
    "extract_quarry_wedge_rack": 1,
    "extract_handcart": 1,
    "prop_tool_rack_quarry": 1,
}
EXPECTED_BENCH_POSES = {
    "LQ_Cut_Bench_Rear_West": (-4.0, 4.4, 0.0),
    "LQ_Cut_Bench_Rear_Centre": (0.0, 4.4, 0.0),
    "LQ_Cut_Bench_Rear_East": (4.0, 4.4, 0.0),
    "LQ_Cut_Bench_West_Return": (-5.0, 1.4, 90.0),
    "LQ_Cut_Bench_East_Return": (5.0, 1.4, -90.0),
}
FORBIDDEN_TOKENS = (
    "vegetation", "crop", "grass", "tree", "bush", "headframe", "shaft",
    "tunnel", "mine_portal", "stockpile", "segment", "modern", "motor", "plastic",
)


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


def overlaps_zone(bounds: tuple[float, float, float, float], zone: tuple[float, float, float, float]) -> bool:
    min_x, max_x, min_y, max_y = bounds
    zone_min_x, zone_max_x, zone_min_y, zone_max_y = zone
    return max_x > zone_min_x and min_x < zone_max_x and max_y > zone_min_y and min_y < zone_max_y


def degrees_near(actual: float, expected: float, tolerance: float = 0.05) -> bool:
    difference = (math.degrees(actual) - expected + 180.0) % 360.0 - 180.0
    return abs(difference) <= tolerance


def main() -> None:
    errors: list[str] = []
    warnings: list[str] = []
    instances = [obj for obj in bpy.data.objects if obj.get("lq_instance")]
    source_counts = Counter(str(obj.get("source_component_id", "")) for obj in instances)

    if len(instances) != 15:
        errors.append(f"expected 15 fixed Large Quarry instances, found {len(instances)}")
    for part_id, expected in REQUIRED_EXACT.items():
        if source_counts[part_id] != expected:
            errors.append(f"{part_id}: expected {expected}, found {source_counts[part_id]}")

    triangles = 0
    atlas_tiles: set[str] = set()
    world_points: list[Vector] = []
    for obj in instances:
        part_id = str(obj.get("source_component_id", ""))
        lowered = f"{obj.name} {part_id}".lower()
        if any(token in lowered for token in FORBIDDEN_TOKENS):
            errors.append(f"forbidden runtime-state, mine-only, vegetation, or modern token on {obj.name}")
        if any(abs(value - 1.0) > 1e-5 for value in obj.scale):
            errors.append(f"non-canonical scale on {obj.name}: {tuple(obj.scale)}")
        if obj.type != "MESH":
            errors.append(f"fixed Large Quarry instance is not a mesh: {obj.name}")
            continue
        if obj.data.uv_layers.get("GK_UV0") is None:
            errors.append(f"missing metric GK_UV0: {obj.name}")
        if nonmanifold_edges(obj):
            errors.append(f"nonmanifold geometry on {obj.name}")
        if obj.modifiers:
            errors.append(f"export-expanding modifier retained on {obj.name}")
        triangles += triangle_count(obj)
        for material in obj.data.materials:
            if material is None:
                errors.append(f"empty material slot on {obj.name}")
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
        "quarry-stone", "fieldstone-mortar", "limestone-ashlar", "rough-hewn-timber",
        "sawn-planks", "weathered-planks", "split-shingles", "wrought-iron", "packed-earth",
    }
    missing_tiles = sorted(required_tiles - atlas_tiles)
    if missing_tiles:
        errors.append(f"missing required material coverage: {missing_tiles}")
    if "linen-canvas" in atlas_tiles:
        errors.append("permanent Large Quarry regained the mobile Mining Camp canvas vocabulary")

    bench_pose_errors: list[str] = []
    for name, (expected_x, expected_y, expected_degrees) in EXPECTED_BENCH_POSES.items():
        bench = next((obj for obj in instances if obj.name == name), None)
        if bench is None:
            bench_pose_errors.append(f"{name}:missing")
            continue
        if abs(bench.location.x - expected_x) > 1e-4 or abs(bench.location.y - expected_y) > 1e-4:
            bench_pose_errors.append(f"{name}:location")
        if not degrees_near(bench.rotation_euler.z, expected_degrees):
            bench_pose_errors.append(f"{name}:rotation")
    if bench_pose_errors:
        errors.append(f"continuous U-shaped bench contract changed: {bench_pose_errors}")

    collision_instances = [obj for obj in instances if obj.get("lq_collision")]
    if len(collision_instances) != 7:
        errors.append(f"expected seven cut/retaining collision components, found {len(collision_instances)}")
    for obj in collision_instances:
        part_id = str(obj.get("source_component_id", ""))
        if part_id not in {"extract_quarry_bench_4m", "foundation_retaining_wall_4m"}:
            errors.append(f"open work equipment must not receive broad collision proxy: {obj.name}")

    # Only the functional causeway and its flanking retaining walls may enter
    # the road-facing approach corridor. The open-cut floor starts behind it.
    approach_zone = (-0.72, 0.72, -4.70, -0.60)
    approach_conflicts: list[str] = []
    allowed_approach = {
        "LQ_Central_Plank_Causeway",
        "LQ_Access_Retaining_Wall_West",
        "LQ_Access_Retaining_Wall_East",
    }
    for obj in instances:
        if obj.name in allowed_approach:
            continue
        if overlaps_zone(xy_bounds(obj), approach_zone):
            approach_conflicts.append(obj.name)
    if approach_conflicts:
        errors.append(f"road-facing quarry approach is obstructed: {sorted(approach_conflicts)}")

    canopy = next((obj for obj in instances if obj.name == "LQ_Shingle_Sorting_Canopy"), None)
    sorting = [
        obj for obj in instances
        if obj.name in {"LQ_Stone_Sorting_Bench", "LQ_Stonecutters_Wedge_Rack"}
    ]
    sorting_overhang_margins: dict[str, float] = {}
    if canopy is None or len(sorting) != 2:
        errors.append("could not resolve the permanent sorting canopy and its two work fixtures")
    else:
        canopy_min_x, canopy_max_x, canopy_min_y, canopy_max_y = xy_bounds(canopy)
        for obj in sorting:
            min_x, max_x, min_y, max_y = xy_bounds(obj)
            margin = min(
                min_x - canopy_min_x,
                canopy_max_x - max_x,
                min_y - canopy_min_y,
                canopy_max_y - max_y,
            )
            sorting_overhang_margins[obj.name] = margin
            if margin < -0.08:
                errors.append(f"{obj.name} no longer sits beneath the sorting canopy: {margin:.4f} m")

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
        if dimensions[0] > 24.0 or dimensions[1] > 22.0 or dimensions[2] > 7.0:
            errors.append(f"Large Quarry exceeds intended placement envelope: {dimensions}")
    if not 1900 <= triangles <= 2200:
        errors.append(f"Large Quarry triangle budget is 1900-2200, found {triangles}")

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
            "collisionComponents": len(collision_instances),
            "approachConflicts": sorted(approach_conflicts),
            "sortingCanopyMarginsM": {
                name: round(margin, 4) for name, margin in sorted(sorting_overhang_margins.items())
            },
        },
        "errors": errors,
        "warnings": warnings,
        "checks": [
            "continuous five-module U-shaped stepped open cut with road-facing entrance",
            "large timber quarry derrick is present while mine headframes, shafts, and portals are absent",
            "permanent split-shingle sorting canopy distinguishes Quarry from the mobile canvas Mining Camp",
            "central plank causeway and two partially buried retaining walls preserve the open approach",
            "fixed sorting, wedge, cart, bucket, and tool equipment communicate function without baking output",
            "stone, support-timber, and civilian-tool stockpiles remain runtime-owned",
            "metric UVs, direct production-atlas contract, canonical transforms, and no living vegetation",
            "manifold fixed geometry and no preview staging in the export set",
        ],
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("LQ_VALIDATE_JSON " + json.dumps({
        "status": report["status"],
        "instances": len(instances),
        "triangles": triangles,
        "dimensionsM": dimensions,
        "errors": len(errors),
    }, separators=(",", ":")))
    if errors:
        raise RuntimeError("Large Quarry validation failed: " + "; ".join(errors))
    print(f"LQ_VALIDATE_OK report={REPORT_PATH}")


if __name__ == "__main__":
    main()
