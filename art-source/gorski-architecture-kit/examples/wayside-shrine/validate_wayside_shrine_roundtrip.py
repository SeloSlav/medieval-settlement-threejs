from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path

import bpy


EXAMPLE_DIR = Path(__file__).resolve().parent
OUTPUT_ROOT = Path(os.environ.get("GK_WAYSIDE_SHRINE_OUTPUT_ROOT", str(EXAMPLE_DIR))).resolve()
OUT_DIR = OUTPUT_ROOT / "out"
GLB_PATH = OUT_DIR / "wayside_shrine_textured_v1.glb"
REPORT_PATH = OUT_DIR / "wayside_shrine_roundtrip_validation_v1.json"

REQUIRED_SOURCE_IDS = {
    "civic_shrine_plinth_stone",
    "civic_shrine_niche_stone",
    "civic_shrine_rear_wall_limewash_1p5m",
    "civic_shrine_half_column_pair",
    "opening_shrine_icon_insert",
    "civic_shrine_canopy",
    "roof_shingle_shrine_gable_1p5m",
    "civic_shrine_iron_cross",
    "foundation_steps_limestone_1",
}


def main() -> None:
    errors: list[str] = []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(GLB_PATH))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    source_ids = [str(obj.get("source_component_id", "")) for obj in meshes]
    triangles = sum(sum(max(0, len(poly.vertices) - 2) for poly in obj.data.polygons) for obj in meshes)
    if len(meshes) != 9:
        errors.append(f"expected 9 imported meshes, found {len(meshes)}")
    if set(source_ids) != REQUIRED_SOURCE_IDS:
        errors.append(f"round-trip component coverage changed: {sorted(set(source_ids))}")
    if any(source_ids.count(part_id) != 1 for part_id in REQUIRED_SOURCE_IDS):
        errors.append("one or more shrine components duplicated during export")
    if any(obj.get("preview_only") for obj in meshes):
        errors.append("preview-only staging leaked into the GLB")
    if not 1000 <= triangles <= 1800:
        errors.append(f"imported GLB outside 1000-1800 triangle budget: {triangles}")
    if any(not obj.get("regional_context") for obj in meshes):
        errors.append("regional provenance extras did not survive GLB round-trip")
    atlas_tiles = {
        str(material.get("atlas_tile", ""))
        for material in bpy.data.materials
        if material and material.get("atlas_id") == "gorski-building-atlas-v1"
    }
    for tile in ("lime-plaster", "fieldstone-mortar", "split-shingles", "wrought-iron", "aged-brass"):
        if tile not in atlas_tiles:
            errors.append(f"required runtime atlas material lost after round-trip: {tile}")

    report = {
        "schemaVersion": 1,
        "validatedAt": datetime.now(timezone.utc).isoformat(),
        "status": "pass" if not errors else "fail",
        "glb": str(GLB_PATH),
        "meshesImported": len(meshes),
        "trianglesImported": triangles,
        "sourceIds": sorted(source_ids),
        "atlasTiles": sorted(atlas_tiles),
        "errors": errors,
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("WS_ROUNDTRIP_JSON " + json.dumps({
        "status": report["status"],
        "meshesImported": len(meshes),
        "trianglesImported": triangles,
        "errors": len(errors),
    }, separators=(",", ":")))
    if errors:
        raise RuntimeError("Wayside shrine GLB round-trip failed: " + "; ".join(errors))
    print(f"WS_ROUNDTRIP_OK report={REPORT_PATH}")


if __name__ == "__main__":
    main()
