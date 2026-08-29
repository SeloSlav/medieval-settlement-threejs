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
OUTPUT_ROOT = Path(os.environ.get("GK_MINING_CAMP_OUTPUT_ROOT", str(EXAMPLE_DIR))).resolve()
OUT_DIR = OUTPUT_ROOT / "out"
REPORT_PATH = OUT_DIR / "mining_camp_validation_v1.json"

REQUIRED_COUNTS = {
    "site_tent_a_frame_large": 1,
    "site_canopy_canvas_4m_d4m": 1,
    "extract_sorting_bench": 1,
    "extract_sieve_table": 1,
    "extract_handcart": 1,
    "extract_survey_stakes": 2,
    "prop_tool_rack_quarry": 1,
    "prop_water_bucket_pair": 1,
}
REQUIRED_NAMES = {
    "MiningCampDayShelter",
    "MiningCampSortingCanopy",
    "MiningCampSortingYard",
    "MiningCampSieveTable",
    "MiningCampHandcart",
    "MiningCampToolRack",
    "MiningCampSurveyStakes",
}
FORBIDDEN_TOKENS = (
    "vegetation", "crop", "grass", "tree", "sapling", "bush", "vine", "flower",
    "derrick", "headframe", "shaft", "pit", "windlass", "stockpile", "ore pile",
    "iron segment", "salt segment", "clay segment", "stone segment", "modern", "plastic",
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


def main() -> None:
    errors: list[str] = []
    warnings: list[str] = []
    instances = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.get("mc_instance")]
    source_counts = Counter(str(obj.get("source_component_id", "")) for obj in instances)
    if len(instances) != 9:
        errors.append(f"expected 9 fixed Mining Camp meshes, found {len(instances)}")
    if source_counts != Counter(REQUIRED_COUNTS):
        errors.append(f"component provenance changed: {dict(sorted(source_counts.items()))}")

    triangles = 0
    atlas_tiles: set[str] = set()
    surface_atlases: set[str] = set()
    collision_count = 0
    all_vertices: list[Vector] = []
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
        if boundary_edges and str(obj.get("source_component_id", "")) != "prop_water_bucket_pair":
            errors.append(f"non-manifold topology on {obj.name}: {boundary_edges} boundary edges")
        triangles += triangle_count(obj)
        collision_count += int(bool(obj.get("mc_collision")))
        all_vertices.extend(obj.matrix_world @ vertex.co for vertex in obj.data.vertices)
        for material in obj.data.materials:
            if material is None:
                errors.append(f"empty material slot on {obj.name}")
                continue
            atlas_id = str(material.get("atlas_id", ""))
            surface_atlases.add(atlas_id)
            tile = str(material.get("atlas_tile", ""))
            if atlas_id == "gorski-building-atlas-v1" and tile:
                atlas_tiles.add(tile)

    if not 1_900 <= triangles <= 2_600:
        errors.append(f"Mining Camp outside 1,900-2,600 triangle budget: {triangles}")
    if collision_count != 5:
        errors.append(f"expected 5 deliberate collision components, found {collision_count}")
    required_tiles = {
        "linen-canvas", "rough-hewn-timber", "weathered-planks", "quarry-stone",
        "limestone-ashlar", "wrought-iron", "wicker-weave", "packed-earth",
    }
    missing_tiles = required_tiles - atlas_tiles
    if missing_tiles:
        errors.append(f"missing required material blocks: {sorted(missing_tiles)}")
    if "gorski-camp-canvas-v1" not in surface_atlases:
        errors.append("the sewn shelter and sorting fly lost their dedicated aged-canvas surface")

    if not all_vertices:
        minimum = maximum = Vector()
        errors.append("Mining Camp has no fixed geometry")
    else:
        minimum = Vector((min(point.x for point in all_vertices), min(point.y for point in all_vertices), min(point.z for point in all_vertices)))
        maximum = Vector((max(point.x for point in all_vertices), max(point.y for point in all_vertices), max(point.z for point in all_vertices)))
    dimensions = [round(maximum[index] - minimum[index], 4) for index in range(3)]
    if not 10.5 <= dimensions[0] <= 12.5 or not 8.5 <= dimensions[1] <= 10.5 or not 2.1 <= dimensions[2] <= 3.0:
        errors.append(f"Mining Camp silhouette envelope drifted: {dimensions}")
    if minimum.z < -0.18:
        errors.append(f"fixed Mining Camp geometry falls implausibly below grade: {minimum.z:.4f} m")

    names = {obj.name for obj in instances}
    missing_names = REQUIRED_NAMES - names
    if missing_names:
        errors.append(f"missing semantic modules: {sorted(missing_names)}")
    flattened_names = "|".join(name.lower() for name in names)
    if any(token in flattened_names for token in FORBIDDEN_TOKENS):
        errors.append("deep-extraction, baked-inventory, modern, or living-vegetation geometry entered the fixed export")
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
            "surfaceAtlases": sorted(surface_atlases),
        },
        "errors": errors,
        "warnings": warnings,
        "checks": [
            "exact modular component provenance at unit scale",
            "low tent-and-sorting-canopy silhouette with no centered excavation",
            "separate sorting, sieving, cart, tool, water, and survey modules",
            "stone, iron, salt, clay, and tool inventories remain runtime-owned",
            "dedicated aged-canvas surfaces plus shared production building atlas",
            "living vegetation excluded under the SeedThree ownership boundary",
            "closed solid topology, intentionally open buckets, and five bounded first-person collision components",
        ],
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("MC_VALIDATE_JSON " + json.dumps({
        "status": report["status"],
        "instances": len(instances),
        "triangles": triangles,
        "dimensionsM": dimensions,
        "collisionTagged": collision_count,
        "errors": len(errors),
    }, separators=(",", ":")))
    if errors:
        raise RuntimeError("Mining Camp validation failed: " + "; ".join(errors))
    print(f"MC_VALIDATE_OK report={REPORT_PATH}")


if __name__ == "__main__":
    main()
