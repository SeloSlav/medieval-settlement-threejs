from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import json
import os
from pathlib import Path

import bpy


EXAMPLE_DIR = Path(__file__).resolve().parent
OUTPUT_ROOT = Path(os.environ.get("GK_MINEWORKS_OUTPUT_ROOT", str(EXAMPLE_DIR))).resolve()
OUT_DIR = OUTPUT_ROOT / "out"
GLB_PATH = OUT_DIR / "mineworks_textured_v1.glb"
REPORT_PATH = OUT_DIR / "mineworks_roundtrip_validation_v1.json"

EXPECTED_COUNTS = {
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


def main() -> None:
    errors: list[str] = []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(GLB_PATH))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    source_ids = [str(obj.get("source_component_id", "")) for obj in meshes]
    source_counts = Counter(source_ids)
    triangles = sum(sum(max(0, len(poly.vertices) - 2) for poly in obj.data.polygons) for obj in meshes)

    if len(meshes) != 10:
        errors.append(f"expected 10 imported meshes, found {len(meshes)}")
    if any(not source_id for source_id in source_ids):
        errors.append("one or more imported meshes lost source_component_id extras")
    for part_id, expected in EXPECTED_COUNTS.items():
        if source_counts[part_id] != expected:
            errors.append(f"{part_id}: expected {expected} after round-trip, found {source_counts[part_id]}")
    if any(obj.get("preview_only") for obj in meshes):
        errors.append("preview-only staging leaked into GLB")
    if sum(1 for obj in meshes if obj.get("mw_collision")) != 5:
        errors.append("five Mineworks collision roles did not survive GLB round-trip")
    if any(source_id.startswith("extract_stockpile_") for source_id in source_ids):
        errors.append("runtime-owned mineral stockpile leaked into the neutral GLB")
    if any(token in source_id for source_id in source_ids for token in ("quarry_bench", "quarry_derrick", "canvas")):
        errors.append("Quarry or mobile Mining Camp vocabulary leaked into the deep Mineworks GLB")
    if not 1250 <= triangles <= 1400:
        errors.append(f"imported GLB outside 1250-1400 triangle budget: {triangles}")

    atlas_tiles: set[str] = set()
    for material in bpy.data.materials:
        if material.get("atlas_id") != "gorski-building-atlas-v1":
            errors.append(f"material lost production atlas metadata: {material.name}")
            continue
        if material.get("atlas_uv_mode") != "final tile coordinates baked into GK_UV0":
            errors.append(f"direct-UV contract lost in GLB: {material.name}")
        if not material.get("atlas_tint"):
            errors.append(f"authored tint lost in GLB: {material.name}")
        atlas_tiles.add(str(material.get("atlas_tile", "")))
    if "linen-canvas" in atlas_tiles:
        errors.append("mobile canvas vocabulary returned after Mineworks GLB round-trip")

    report = {
        "schemaVersion": 1,
        "validatedAt": datetime.now(timezone.utc).isoformat(),
        "status": "pass" if not errors else "fail",
        "glb": str(GLB_PATH),
        "meshesImported": len(meshes),
        "trianglesImported": triangles,
        "sourceCounts": dict(sorted(source_counts.items())),
        "atlasTiles": sorted(atlas_tiles),
        "errors": errors,
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("MW_ROUNDTRIP_JSON " + json.dumps({
        "status": report["status"],
        "meshesImported": len(meshes),
        "trianglesImported": triangles,
        "errors": len(errors),
    }, separators=(",", ":")))
    if errors:
        raise RuntimeError("Mineworks GLB round-trip validation failed: " + "; ".join(errors))
    print(f"MW_ROUNDTRIP_OK report={REPORT_PATH}")


if __name__ == "__main__":
    main()
