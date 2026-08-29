from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import json
import os
from pathlib import Path

import bpy


EXAMPLE_DIR = Path(__file__).resolve().parent
OUTPUT_ROOT = Path(os.environ.get("GK_LARGE_QUARRY_OUTPUT_ROOT", str(EXAMPLE_DIR))).resolve()
OUT_DIR = OUTPUT_ROOT / "out"
GLB_PATH = OUT_DIR / "large_quarry_textured_v1.glb"
REPORT_PATH = OUT_DIR / "large_quarry_roundtrip_validation_v1.json"

EXPECTED_COUNTS = {
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


def main() -> None:
    errors: list[str] = []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(GLB_PATH))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    source_ids = [str(obj.get("source_component_id", "")) for obj in meshes]
    source_counts = Counter(source_ids)
    triangles = sum(sum(max(0, len(poly.vertices) - 2) for poly in obj.data.polygons) for obj in meshes)

    if len(meshes) != 15:
        errors.append(f"expected 15 imported meshes, found {len(meshes)}")
    if any(not source_id for source_id in source_ids):
        errors.append("one or more imported meshes lost source_component_id extras")
    for part_id, expected in EXPECTED_COUNTS.items():
        if source_counts[part_id] != expected:
            errors.append(f"{part_id}: expected {expected} after round-trip, found {source_counts[part_id]}")
    if any(obj.get("preview_only") for obj in meshes):
        errors.append("preview-only staging leaked into GLB")
    if sum(1 for obj in meshes if obj.get("lq_collision")) != 7:
        errors.append("seven Large Quarry collision roles did not survive GLB round-trip")
    if any(source_id.startswith("extract_stockpile_") for source_id in source_ids):
        errors.append("runtime-owned stone stockpile leaked into the neutral GLB")
    if any(token in source_id for source_id in source_ids for token in ("headframe", "shaft", "tunnel", "mine_portal")):
        errors.append("deep Mineworks component leaked into the open-cut Quarry GLB")
    if not 1900 <= triangles <= 2200:
        errors.append(f"imported GLB outside 1900-2200 triangle budget: {triangles}")

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
        errors.append("mobile canvas vocabulary returned after Large Quarry GLB round-trip")

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
    print("LQ_ROUNDTRIP_JSON " + json.dumps({
        "status": report["status"],
        "meshesImported": len(meshes),
        "trianglesImported": triangles,
        "errors": len(errors),
    }, separators=(",", ":")))
    if errors:
        raise RuntimeError("Large Quarry GLB round-trip failed: " + "; ".join(errors))
    print(f"LQ_ROUNDTRIP_OK report={REPORT_PATH}")


if __name__ == "__main__":
    main()
