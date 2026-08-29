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
OUTPUT_ROOT = Path(os.environ.get("GK_WAYSIDE_SHRINE_OUTPUT_ROOT", str(EXAMPLE_DIR))).resolve()
OUT_DIR = OUTPUT_ROOT / "out"
REPORT_PATH = OUT_DIR / "wayside_shrine_validation_v1.json"

REQUIRED_EXACT = {
    "civic_shrine_plinth_stone": 1,
    "civic_shrine_niche_stone": 1,
    "civic_shrine_rear_wall_limewash_1p5m": 1,
    "civic_shrine_half_column_pair": 1,
    "opening_shrine_icon_insert": 1,
    "civic_shrine_canopy": 1,
    "roof_shingle_shrine_gable_1p5m": 1,
    "civic_shrine_iron_cross": 1,
    "foundation_steps_limestone_1": 1,
}
FORBIDDEN_TOKENS = ("vegetation", "crop", "grass", "tree", "bush", "vine", "flower", "modern", "plastic")


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


def main() -> None:
    errors: list[str] = []
    warnings: list[str] = []
    instances = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.get("ws_instance")]
    if len(instances) != 9:
        errors.append(f"expected 9 fixed shrine components, found {len(instances)}")

    source_counts = Counter(str(obj.get("source_component_id", "")) for obj in instances)
    for part_id, expected in REQUIRED_EXACT.items():
        if source_counts[part_id] != expected:
            errors.append(f"{part_id} expected {expected}, found {source_counts[part_id]}")
    if source_counts.get("civic_shrine_votive_ledge", 0):
        errors.append("standalone votive ledge duplicates the icon insert's authored ledge and candles")

    all_vertices: list[Vector] = []
    triangles = 0
    atlas_tiles: set[str] = set()
    for obj in instances:
        if any(abs(float(value) - 1.0) > 1e-6 for value in obj.scale):
            errors.append(f"non-canonical scale on {obj.name}: {tuple(obj.scale)}")
        if obj.parent is not None:
            errors.append(f"unexpected parent on {obj.name}")
        if not obj.get("source_component_id"):
            errors.append(f"missing component provenance on {obj.name}")
        if obj.data.uv_layers.get("GK_UV0") is None:
            errors.append(f"missing GK_UV0 on {obj.name}")
        if not all(math.isfinite(value) for vertex in obj.data.vertices for value in vertex.co):
            errors.append(f"non-finite geometry on {obj.name}")
        triangles += triangle_count(obj)
        all_vertices.extend(world_vertices(obj))
        if obj.get("source_component_id") != "civic_shrine_niche_stone" and nonmanifold_edges(obj):
            errors.append(f"unexpected non-manifold topology on {obj.name}")
        for material in obj.data.materials:
            if material is None:
                errors.append(f"empty material slot on {obj.name}")
                continue
            if material.get("atlas_id") != "gorski-building-atlas-v1":
                errors.append(f"non-atlas material {material.name} on {obj.name}")
            if material.get("atlas_uv_mode") != "final tile coordinates baked into GK_UV0":
                errors.append(f"material lacks direct-atlas UV contract: {material.name}")
            atlas_tile = str(material.get("atlas_tile", ""))
            if atlas_tile:
                atlas_tiles.add(atlas_tile)

    if not 1000 <= triangles <= 1800:
        errors.append(f"shrine outside 1000-1800 triangle budget: {triangles}")
    required_tiles = {
        "lime-plaster", "limestone-ashlar", "fieldstone-mortar", "rough-hewn-timber",
        "sawn-planks", "split-shingles", "wrought-iron", "aged-brass", "linen-canvas",
    }
    missing_tiles = required_tiles - atlas_tiles
    if missing_tiles:
        errors.append(f"missing required material blocks: {sorted(missing_tiles)}")

    if not all_vertices:
        errors.append("shrine has no fixed geometry")
        minimum = maximum = Vector()
    else:
        minimum = Vector((min(point.x for point in all_vertices), min(point.y for point in all_vertices), min(point.z for point in all_vertices)))
        maximum = Vector((max(point.x for point in all_vertices), max(point.y for point in all_vertices), max(point.z for point in all_vertices)))
    dimensions = [round(maximum[index] - minimum[index], 4) for index in range(3)]
    if dimensions[0] > 2.05 or dimensions[1] > 1.90 or not 3.80 <= dimensions[2] <= 4.20:
        errors.append(f"shrine silhouette envelope drifted: {dimensions}")
    if minimum.z < -0.025:
        errors.append(f"fixed shrine geometry falls below grade: {minimum.z:.4f} m")

    by_name = {obj.name: obj for obj in instances}
    expected_locations = {
        "WS_Worn_Stepped_Plinth": (0.0, 0.0, 0.0),
        "WS_Limewashed_Stone_Niche": (0.0, 0.0, 0.725),
        "WS_Limewashed_Rear_Closure": (0.0, 0.39, 0.725),
        "WS_Facade_Half_Columns": (0.0, -0.46, 0.725),
        "WS_Marian_Icon_And_Votives": (0.0, -0.47, 0.805),
        "WS_Timber_Gable_Canopy": (0.0, -0.31, 0.725),
        "WS_Split_Shingle_Gable_Roof": (0.0, -0.02, 2.93),
        "WS_Forged_Iron_Ridge_Cross": (0.0, -0.02, 3.53),
        "WS_Worn_Roadside_Step": (0.0, -0.64, 0.0),
    }
    for name, expected in expected_locations.items():
        obj = by_name.get(name)
        if obj is None:
            errors.append(f"missing named construction role {name}")
            continue
        if any(abs(obj.location[index] - expected[index]) > 1e-4 for index in range(3)):
            errors.append(f"{name} lost its authored placement: {tuple(round(v, 4) for v in obj.location)}")

    roof = by_name.get("WS_Split_Shingle_Gable_Roof")
    if roof is not None and abs(float(roof.rotation_euler.z) - math.pi * 0.5) > 1e-4:
        errors.append("shrine roof ridge no longer runs perpendicular to the public facade")

    icon = by_name.get("WS_Marian_Icon_And_Votives")
    niche = by_name.get("WS_Limewashed_Stone_Niche")
    if icon is not None and niche is not None:
        icon_points = world_vertices(icon)
        niche_points = world_vertices(niche)
        if max(point.x for point in icon_points) >= max(point.x for point in niche_points):
            errors.append("devotional insert escapes the niche width")
        if min(point.y for point in icon_points) >= min(point.y for point in niche_points):
            errors.append("devotional insert is not visibly proud at the public face")

    lowered_names = "|".join(obj.name.lower() for obj in instances)
    if any(token in lowered_names for token in FORBIDDEN_TOKENS):
        errors.append("forbidden modern or living-vegetation token entered the shrine export")
    if any(obj.get("preview_only") for obj in instances):
        errors.append("preview-only staging leaked into the fixed export set")

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
            "boundsM": {
                "minimumM": [round(value, 4) for value in minimum],
                "maximumM": [round(value, 4) for value in maximum],
            },
            "atlasTiles": sorted(atlas_tiles),
        },
        "errors": errors,
        "warnings": warnings,
        "checks": [
            "nine canonical kit components with exact provenance and scale",
            "compact gabled niche silhouette with roof-supported iron cross",
            "single devotional insert without duplicate votive furniture",
            "warm limewash, local stone, dark oak, split shingles, iron, and restrained icon pigment",
            "metric UVs baked to the shared production atlas",
            "no living vegetation, presentation base, characters, or runtime inventory",
            "no preview staging in the export set",
        ],
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("WS_VALIDATE_JSON " + json.dumps({
        "status": report["status"],
        "instances": len(instances),
        "triangles": triangles,
        "dimensionsM": dimensions,
        "errors": len(errors),
    }, separators=(",", ":")))
    if errors:
        raise RuntimeError("Wayside shrine validation failed: " + "; ".join(errors))
    print(f"WS_VALIDATE_OK report={REPORT_PATH}")


if __name__ == "__main__":
    main()
