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
OUTPUT_ROOT = Path(os.environ.get("GK_MINEWORKS_OUTPUT_ROOT", str(EXAMPLE_DIR))).resolve()
OUT_DIR = OUTPUT_ROOT / "out"
REPORT_PATH = OUT_DIR / "mineworks_validation_v1.json"

REQUIRED_EXACT = {
    "extract_shaft_collar_square_large": 1,
    "extract_headframe_large": 1,
    "site_walkway_plank_4m": 1,
    "extract_ore_bucket": 1,
    "prop_water_bucket_pair": 1,
    "site_canopy_timber_6m_d3m": 1,
    "extract_sorting_bench": 1,
    "extract_sieve_table": 1,
    "extract_handcart": 1,
    "prop_tool_rack_quarry": 1,
}
FORBIDDEN_TOKENS = (
    "vegetation", "crop", "grass", "tree", "bush", "stockpile", "segment",
    "modern", "motor", "engine", "steam", "electric", "quarry_bench", "derrick", "canvas",
)
TOPOLOGY_ALLOWANCES = {
    "extract_shaft_collar_square_large",  # aperture composition from the kit contract
    "prop_water_bucket_pair",  # intentionally open service containers
}


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


def margin_inside(container: bpy.types.Object, item: bpy.types.Object) -> float:
    container_min_x, container_max_x, container_min_y, container_max_y = xy_bounds(container)
    min_x, max_x, min_y, max_y = xy_bounds(item)
    return min(
        min_x - container_min_x,
        container_max_x - max_x,
        min_y - container_min_y,
        container_max_y - max_y,
    )


def main() -> None:
    errors: list[str] = []
    warnings: list[str] = []
    instances = [obj for obj in bpy.data.objects if obj.get("mw_instance")]
    source_counts = Counter(str(obj.get("source_component_id", "")) for obj in instances)

    if len(instances) != 10:
        errors.append(f"expected 10 fixed Mineworks instances, found {len(instances)}")
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
            errors.append(f"forbidden runtime-state, quarry/mobile, vegetation, or modern token on {obj.name}")
        if any(abs(value - 1.0) > 1e-5 for value in obj.scale):
            errors.append(f"non-canonical scale on {obj.name}: {tuple(obj.scale)}")
        if obj.type != "MESH":
            errors.append(f"fixed Mineworks instance is not a mesh: {obj.name}")
            continue
        if obj.data.uv_layers.get("GK_UV0") is None:
            errors.append(f"missing metric GK_UV0: {obj.name}")
        if nonmanifold_edges(obj) and part_id not in TOPOLOGY_ALLOWANCES:
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
        "fieldstone-mortar", "quarry-stone", "limestone-ashlar", "rough-hewn-timber",
        "sawn-planks", "weathered-planks", "split-shingles", "wrought-iron",
        "packed-earth", "wicker-weave",
    }
    missing_tiles = sorted(required_tiles - atlas_tiles)
    if missing_tiles:
        errors.append(f"missing required material coverage: {missing_tiles}")
    if "linen-canvas" in atlas_tiles:
        errors.append("permanent Mineworks regained the mobile Mining Camp canvas vocabulary")

    collar = next((obj for obj in instances if obj.name == "MW_Deep_Square_Shaft_Collar"), None)
    headframe = next((obj for obj in instances if obj.name == "MW_Tall_Timber_Winding_Headframe"), None)
    if collar is None or headframe is None:
        errors.append("could not resolve the canonical shaft collar and winding headframe")
    else:
        centre_gap = math.hypot(collar.location.x - headframe.location.x, collar.location.y - headframe.location.y)
        if centre_gap > 1e-5:
            errors.append(f"headframe no longer centres exactly over the shaft: {centre_gap:.5f} m")

    collision_instances = [obj for obj in instances if obj.get("mw_collision")]
    if len(collision_instances) != 5:
        errors.append(f"expected five solid Mineworks collision components, found {len(collision_instances)}")
    allowed_collision_ids = {
        "extract_shaft_collar_square_large", "extract_sorting_bench",
        "extract_sieve_table", "extract_handcart", "prop_tool_rack_quarry",
    }
    for obj in collision_instances:
        if str(obj.get("source_component_id", "")) not in allowed_collision_ids:
            errors.append(f"open frame or canopy must not receive a broad collision proxy: {obj.name}")

    approach_zone = (-0.68, 0.68, -4.65, -1.00)
    approach_conflicts: list[str] = []
    for obj in instances:
        if obj.name == "MW_Roadside_Shaft_Walkway":
            continue
        if overlaps_zone(xy_bounds(obj), approach_zone):
            approach_conflicts.append(obj.name)
    if approach_conflicts:
        errors.append(f"road-facing shaft approach is obstructed: {sorted(approach_conflicts)}")

    sorting_canopy = next((obj for obj in instances if obj.name == "MW_Shingle_Ore_Sorting_Shelter"), None)
    sorting_items = [
        obj for obj in instances
        if obj.name in {"MW_Hand_Sorting_Bench", "MW_Ore_And_Clay_Sieve"}
    ]
    canopy_margins: dict[str, float] = {}
    if sorting_canopy is None or len(sorting_items) != 2:
        errors.append("could not resolve sorting shelter and its two fixtures")
    else:
        for obj in sorting_items:
            canopy_margins[obj.name] = margin_inside(sorting_canopy, obj)
            if canopy_margins[obj.name] < -0.08:
                errors.append(f"{obj.name} no longer sits beneath the sorting shelter: {canopy_margins[obj.name]:.4f} m")

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
        if dimensions[0] > 22.0 or dimensions[1] > 20.0 or dimensions[2] > 7.0:
            errors.append(f"Mineworks exceeds intended placement envelope: {dimensions}")
    if not 1250 <= triangles <= 1400:
        errors.append(f"Mineworks triangle budget is 1250-1400, found {triangles}")

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
            "shelterMarginsM": {name: round(margin, 4) for name, margin in sorted(canopy_margins.items())},
        },
        "errors": errors,
        "warnings": warnings,
        "checks": [
            "one tall timber headframe is centred exactly over one guarded square shaft opening",
            "open road-facing plank approach reaches the shaft without decorative plinth or obstruction",
            "integral headframe winding axle avoids a disconnected duplicate winch; sorting fixtures remain beneath one permanent shingle canopy",
            "no quarry benches, derricks, mobile canvas, modern engines, or living vegetation",
            "iron, salt, clay, support-timber, and civilian-tool stockpiles remain runtime-owned",
            "metric UVs, direct production-atlas contract, canonical transforms, and only the kit-declared open-container/aperture topology allowances",
        ],
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("MW_VALIDATE_JSON " + json.dumps({
        "status": report["status"],
        "instances": len(instances),
        "triangles": triangles,
        "dimensionsM": dimensions,
        "errors": len(errors),
    }, separators=(",", ":")))
    if errors:
        raise RuntimeError("Mineworks validation failed: " + "; ".join(errors))
    print(f"MW_VALIDATE_OK report={REPORT_PATH}")


if __name__ == "__main__":
    main()
