from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import json
import os
from pathlib import Path

import bpy


EXAMPLE_DIR = Path(__file__).resolve().parent
OUTPUT_ROOT = Path(os.environ.get("GK_LUMBER_MILL_OUTPUT_ROOT", str(EXAMPLE_DIR))).resolve()
OUT_DIR = OUTPUT_ROOT / "out"
GLB_PATH = OUT_DIR / "lumber_mill_textured_v1.glb"
REPORT_PATH = OUT_DIR / "lumber_mill_roundtrip_validation_v1.json"

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


def main() -> None:
    errors: list[str] = []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(GLB_PATH))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    source_counts = Counter(str(obj.get("source_component_id", "")) for obj in meshes)
    triangles = sum(sum(max(0, len(poly.vertices) - 2) for poly in obj.data.polygons) for obj in meshes)
    if len(meshes) != 49:
        errors.append(f"expected 49 imported meshes, found {len(meshes)}")
    if source_counts != Counter(REQUIRED_COUNTS):
        errors.append(f"round-trip component counts changed: {dict(sorted(source_counts.items()))}")
    if not 3_200 <= triangles <= 4_500:
        errors.append(f"imported GLB outside 3,200-4,500 triangle budget: {triangles}")
    if sum(int(bool(obj.get("lm_collision"))) for obj in meshes) != 11:
        errors.append("collision provenance extras did not survive GLB round-trip")
    if any(obj.get("preview_only") for obj in meshes):
        errors.append("preview-only staging leaked into the GLB")
    if any(not obj.get("regional_context") for obj in meshes):
        errors.append("regional provenance extras did not survive GLB round-trip")
    atlas_tiles = {
        str(material.get("atlas_tile", ""))
        for material in bpy.data.materials
        if material and material.get("atlas_id") == "gorski-building-atlas-v1"
    }
    for tile in ("fieldstone-mortar", "rough-hewn-timber", "weathered-planks", "split-shingles", "wrought-iron"):
        if tile not in atlas_tiles:
            errors.append(f"required runtime atlas material lost after round-trip: {tile}")

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
    print("LM_ROUNDTRIP_JSON " + json.dumps({
        "status": report["status"],
        "meshesImported": len(meshes),
        "trianglesImported": triangles,
        "errors": len(errors),
    }, separators=(",", ":")))
    if errors:
        raise RuntimeError("Lumber mill GLB round-trip failed: " + "; ".join(errors))
    print(f"LM_ROUNDTRIP_OK report={REPORT_PATH}")


if __name__ == "__main__":
    main()
