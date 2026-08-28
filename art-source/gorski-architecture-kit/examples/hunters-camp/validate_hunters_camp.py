from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import json
import os
from pathlib import Path

import bpy
from mathutils import Vector


EXAMPLE_DIR = Path(__file__).resolve().parent
OUTPUT_ROOT = Path(os.environ.get("GK_HUNTERS_CAMP_OUTPUT_ROOT", str(EXAMPLE_DIR))).resolve()
OUT_DIR = OUTPUT_ROOT / "out"
REPORT_PATH = OUT_DIR / "hunters_camp_validation_v3.json"

REQUIRED_EXACT = {
    "site_tent_a_frame_large": 1,
    "site_canopy_canvas_4m_d2m": 1,
    "site_campfire_hearth": 1,
    "site_camp_cooking_tripod": 1,
    "prop_tool_rack_hunter": 1,
    "prop_camp_worktable": 1,
    "prop_water_bucket_pair": 1,
}
FORBIDDEN_PREFIXES = ("wall_", "roof_", "foundation_", "opening_", "frame_")
FORBIDDEN_TOKENS = ("vegetation", "crop", "grass", "tree", "bush", "deer", "carcass", "hide", "meat")


def main() -> None:
    errors: list[str] = []
    warnings: list[str] = []
    instances = [obj for obj in bpy.data.objects if obj.get("hc_instance")]
    source_counts = Counter(str(obj.get("source_component_id", "")) for obj in instances)

    if len(instances) != 15:
        errors.append(f"expected 15 fixed camp instances, found {len(instances)}")
    for part_id, expected in REQUIRED_EXACT.items():
        if source_counts[part_id] != expected:
            errors.append(f"{part_id}: expected {expected}, found {source_counts[part_id]}")
    if source_counts["enclosure_split_rail_2m"] < 4:
        errors.append("hunter camp needs at least four sparse split-rail boundary spans")

    triangles = 0
    atlas_tiles: set[str] = set()
    world_points: list[Vector] = []
    for obj in instances:
        part_id = str(obj.get("source_component_id", ""))
        lowered = f"{obj.name} {part_id}".lower()
        if part_id.startswith(FORBIDDEN_PREFIXES):
            errors.append(f"enclosed-building component leaked into camp: {part_id}")
        if any(token in lowered for token in FORBIDDEN_TOKENS):
            errors.append(f"forbidden vegetation or harvested-game token on {obj.name}")
        if any(abs(value - 1.0) > 1e-5 for value in obj.scale):
            errors.append(f"non-canonical scale on {obj.name}: {tuple(obj.scale)}")
        if obj.type != "MESH":
            errors.append(f"fixed camp instance is not a mesh: {obj.name}")
            continue
        if obj.data.uv_layers.get("GK_UV0") is None:
            errors.append(f"missing GK_UV0: {obj.name}")
        triangles += sum(max(0, len(poly.vertices) - 2) for poly in obj.data.polygons)
        for material in obj.data.materials:
            if material is None or not material.get("atlas_id"):
                errors.append(f"non-atlas material on {obj.name}")
                continue
            atlas_tiles.add(str(material.get("atlas_tile", "")))
        world_points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)

    required_tiles = {
        "linen-canvas", "rough-hewn-timber", "weathered-planks", "fieldstone-mortar",
        "wrought-iron", "wicker-weave", "packed-earth",
    }
    missing_tiles = sorted(required_tiles - atlas_tiles)
    if missing_tiles:
        errors.append(f"missing required atlas tile coverage: {missing_tiles}")

    dimensions = [0.0, 0.0, 0.0]
    if world_points:
        minimum = Vector((min(p.x for p in world_points), min(p.y for p in world_points), min(p.z for p in world_points)))
        maximum = Vector((max(p.x for p in world_points), max(p.y for p in world_points), max(p.z for p in world_points)))
        dimensions = [round(value, 4) for value in (maximum - minimum)]
        if dimensions[0] > 11.0 or dimensions[1] > 10.0 or dimensions[2] > 3.1:
            errors.append(f"camp exceeds intended open-worksite envelope: {dimensions}")

    preview_leaks = [obj.name for obj in instances if obj.get("preview_only")]
    if preview_leaks:
        errors.append(f"preview staging tagged as export instances: {preview_leaks}")

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
            "atlasTiles": sorted(atlas_tiles),
        },
        "errors": errors,
        "warnings": warnings,
        "checks": [
            "required reusable component coverage",
            "open-camp identity with no residential shell parts",
            "canonical transforms and metric GK_UV0",
            "atlas-backed material coverage",
            "no living vegetation or harvested-game meshes",
            "no preview staging in the export set",
        ],
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("HC_VALIDATE_JSON " + json.dumps({
        "status": report["status"],
        "instances": len(instances),
        "triangles": triangles,
        "errors": len(errors),
    }, separators=(",", ":")))
    if errors:
        raise RuntimeError("Hunter's Camp validation failed: " + "; ".join(errors))
    print(f"HC_VALIDATE_OK report={REPORT_PATH}")


if __name__ == "__main__":
    main()
