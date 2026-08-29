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
OUTPUT_ROOT = Path(os.environ.get("GK_LUMBER_MILL_OUTPUT_ROOT", str(EXAMPLE_DIR))).resolve()
OUT_DIR = OUTPUT_ROOT / "out"
REPORT_PATH = OUT_DIR / "lumber_mill_validation_v1.json"

REQUIRED_COUNTS = {
    "foundation_fieldstone_4m_h0p35m": 8,
    "foundation_fieldstone_2m_h0p35m": 2,
    "wall_plank_4m_h3m": 7,
    "wall_plank_2m_h3m": 2,
    "gable_infill_timber_6m": 2,
    "frame_gable_truss_6m": 2,
    "frame_post_h3m_s0p22m": 10,
    "frame_beam_4m_s0p22m": 8,
    "frame_beam_2m_s0p22m": 2,
    "assembly_custom_settled_shingle_skin": 2,
    "site_canopy_timber_6m_d3m": 1,
    "production_sawpit_frame": 1,
    "prop_tool_rack_carpenter": 1,
    "prop_two_wheel_cart": 1,
}
FORBIDDEN_TOKENS = (
    "vegetation", "crop", "grass", "tree", "sapling", "bush", "vine", "flower",
    "circular saw", "circular_saw", "modern", "plastic", "timberstocksegment",
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


def main() -> None:
    errors: list[str] = []
    warnings: list[str] = []
    instances = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.get("lm_instance")]
    source_counts = Counter(str(obj.get("source_component_id", "")) for obj in instances)
    if len(instances) != 49:
        errors.append(f"expected 49 fixed lumber-mill meshes, found {len(instances)}")
    for source_id, expected in REQUIRED_COUNTS.items():
        if source_counts[source_id] != expected:
            errors.append(f"{source_id} expected {expected}, found {source_counts[source_id]}")
    unexpected = sorted(set(source_counts) - set(REQUIRED_COUNTS))
    if unexpected:
        errors.append(f"unexpected source IDs: {unexpected}")

    all_vertices: list[Vector] = []
    triangles = 0
    atlas_tiles: set[str] = set()
    collision_count = 0
    for obj in instances:
        if any(abs(float(value) - 1.0) > 1e-6 for value in obj.scale):
            errors.append(f"non-canonical scale on {obj.name}: {tuple(obj.scale)}")
        if obj.parent is not None:
            errors.append(f"unexpected parent on {obj.name}")
        if obj.data.uv_layers.get("GK_UV0") is None:
            errors.append(f"missing GK_UV0 on {obj.name}")
        if not all(math.isfinite(value) for vertex in obj.data.vertices for value in vertex.co):
            errors.append(f"non-finite geometry on {obj.name}")
        boundary_edges = nonmanifold_edges(obj)
        if boundary_edges:
            errors.append(f"non-manifold topology on {obj.name}: {boundary_edges} boundary edges")
        triangles += triangle_count(obj)
        all_vertices.extend(world_vertices(obj))
        collision_count += int(bool(obj.get("lm_collision")))
        for material in obj.data.materials:
            if material is None:
                errors.append(f"empty material slot on {obj.name}")
                continue
            if material.get("atlas_id") != "gorski-building-atlas-v1":
                errors.append(f"non-atlas material {material.name} on {obj.name}")
            if material.get("atlas_uv_mode") != "final tile coordinates baked into GK_UV0":
                errors.append(f"material lacks direct-atlas UV contract: {material.name}")
            tile = str(material.get("atlas_tile", ""))
            if tile:
                atlas_tiles.add(tile)

    if not 3_200 <= triangles <= 4_500:
        errors.append(f"lumber mill outside 3,200-4,500 triangle budget: {triangles}")
    if collision_count != 11:
        errors.append(f"expected 11 deliberate component collision proxies, found {collision_count}")
    required_tiles = {
        "fieldstone-mortar", "rough-hewn-timber", "weathered-planks", "sawn-planks",
        "split-shingles", "wrought-iron", "packed-earth",
    }
    missing_tiles = required_tiles - atlas_tiles
    if missing_tiles:
        errors.append(f"missing required material blocks: {sorted(missing_tiles)}")

    if not all_vertices:
        minimum = maximum = Vector()
        errors.append("lumber mill has no fixed geometry")
    else:
        minimum = Vector((min(point.x for point in all_vertices), min(point.y for point in all_vertices), min(point.z for point in all_vertices)))
        maximum = Vector((max(point.x for point in all_vertices), max(point.y for point in all_vertices), max(point.z for point in all_vertices)))
    dimensions = [round(maximum[index] - minimum[index], 4) for index in range(3)]
    if not 13.5 <= dimensions[0] <= 14.2 or not 8.5 <= dimensions[1] <= 9.7 or not 6.9 <= dimensions[2] <= 7.15:
        errors.append(f"lumber-mill silhouette envelope drifted: {dimensions}")
    if minimum.z < -0.03:
        errors.append(f"fixed lumber-mill geometry falls below grade: {minimum.z:.4f} m")

    names = "|".join(obj.name.lower() for obj in instances)
    if any(token in names for token in FORBIDDEN_TOKENS):
        errors.append("forbidden modern, living-vegetation, or baked-inventory token entered the export")
    if not any("open_intake_canopy" in obj.name.lower() for obj in instances):
        errors.append("signature open intake canopy is missing")
    if not any("hand_sawpit" in obj.name.lower() for obj in instances):
        errors.append("historically appropriate hand-sawing rig is missing")
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
            "collisionTaggedInstances": collision_count,
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
            "exact modular component provenance at unit scale",
            "long low hall, dominant steep roof, and supported open intake silhouette",
            "six-metre gables and king-post trusses remain under the shingle skin",
            "hand sawpit replaces the legacy anachronistic circular-saw read",
            "stored roundwood, workers, effects, and living vegetation remain runtime-owned",
            "shared production atlas with no unique building textures",
            "closed topology and bounded first-person collision proxies",
        ],
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("LM_VALIDATE_JSON " + json.dumps({
        "status": report["status"],
        "instances": len(instances),
        "triangles": triangles,
        "dimensionsM": dimensions,
        "collisionTagged": collision_count,
        "errors": len(errors),
    }, separators=(",", ":")))
    if errors:
        raise RuntimeError("Lumber mill validation failed: " + "; ".join(errors))
    print(f"LM_VALIDATE_OK report={REPORT_PATH}")


if __name__ == "__main__":
    main()
