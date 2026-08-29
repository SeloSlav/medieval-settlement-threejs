from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import json
import os
from pathlib import Path

import bpy


EXAMPLE_DIR = Path(__file__).resolve().parent
OUTPUT_ROOT = Path(os.environ.get("GK_MINING_CAMP_OUTPUT_ROOT", str(EXAMPLE_DIR))).resolve()
OUT_DIR = OUTPUT_ROOT / "out"
GLB_PATH = OUT_DIR / "mining_camp_textured_v1.glb"
REPORT_PATH = OUT_DIR / "mining_camp_roundtrip_validation_v1.json"

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


def main() -> None:
    errors: list[str] = []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(GLB_PATH))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    source_counts = Counter(str(obj.get("source_component_id", "")) for obj in meshes)
    triangles = sum(sum(max(0, len(poly.vertices) - 2) for poly in obj.data.polygons) for obj in meshes)
    if len(meshes) != 9:
        errors.append(f"expected 9 imported meshes, found {len(meshes)}")
    if source_counts != Counter(REQUIRED_COUNTS):
        errors.append(f"round-trip component counts changed: {dict(sorted(source_counts.items()))}")
    if not 1_900 <= triangles <= 2_600:
        errors.append(f"imported GLB outside 1,900-2,600 triangle budget: {triangles}")
    if sum(int(bool(obj.get("mc_collision"))) for obj in meshes) != 5:
        errors.append("collision provenance extras did not survive GLB round-trip")
    if any(obj.get("preview_only") for obj in meshes):
        errors.append("preview-only staging leaked into the GLB")
    if any(not obj.get("regional_context") for obj in meshes):
        errors.append("regional provenance extras did not survive GLB round-trip")
    names = {obj.name for obj in meshes}
    for required in (
        "MiningCampDayShelter", "MiningCampSortingCanopy", "MiningCampSortingYard",
        "MiningCampSieveTable", "MiningCampHandcart", "MiningCampToolRack", "MiningCampSurveyStakes",
    ):
        if required not in names:
            errors.append(f"semantic module lost after round-trip: {required}")
    atlas_ids = {str(material.get("atlas_id", "")) for material in bpy.data.materials if material}
    if "gorski-building-atlas-v1" not in atlas_ids:
        errors.append("shared building-atlas materials were lost after round-trip")
    if "gorski-camp-canvas-v1" not in atlas_ids:
        errors.append("dedicated aged-canvas material was lost after round-trip")

    report = {
        "schemaVersion": 1,
        "validatedAt": datetime.now(timezone.utc).isoformat(),
        "status": "pass" if not errors else "fail",
        "glb": str(GLB_PATH),
        "meshesImported": len(meshes),
        "trianglesImported": triangles,
        "sourceCounts": dict(sorted(source_counts.items())),
        "atlasIds": sorted(atlas_ids),
        "errors": errors,
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("MC_ROUNDTRIP_JSON " + json.dumps({
        "status": report["status"],
        "meshesImported": len(meshes),
        "trianglesImported": triangles,
        "errors": len(errors),
    }, separators=(",", ":")))
    if errors:
        raise RuntimeError("Mining Camp GLB round-trip failed: " + "; ".join(errors))
    print(f"MC_ROUNDTRIP_OK report={REPORT_PATH}")


if __name__ == "__main__":
    main()
