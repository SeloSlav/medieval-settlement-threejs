from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path

import bpy


EXAMPLE_DIR = Path(__file__).resolve().parent
OUTPUT_ROOT = Path(os.environ.get("GK_HUNTERS_CAMP_OUTPUT_ROOT", str(EXAMPLE_DIR))).resolve()
OUT_DIR = OUTPUT_ROOT / "out"
GLB_PATH = OUT_DIR / "hunters_camp_textured_v6.glb"
REPORT_PATH = OUT_DIR / "hunters_camp_roundtrip_validation_v6.json"


def main() -> None:
    errors: list[str] = []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(GLB_PATH))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    source_ids = [str(obj.get("source_component_id", "")) for obj in meshes]
    triangles = sum(sum(max(0, len(poly.vertices) - 2) for poly in obj.data.polygons) for obj in meshes)

    if len(meshes) != 15:
        errors.append(f"expected 15 imported meshes, found {len(meshes)}")
    if any(not source_id for source_id in source_ids):
        errors.append("one or more imported meshes lost source_component_id extras")
    if any(obj.get("preview_only") for obj in meshes):
        errors.append("preview-only staging leaked into GLB")
    if not any(source_id == "site_tent_a_frame_large" for source_id in source_ids):
        errors.append("tent missing after GLB round-trip")
    if not any(source_id == "site_hunter_hide_fly_4m_d2m" for source_id in source_ids):
        errors.append("stitched-hide processing shelter missing after GLB round-trip")
    if not any(source_id == "site_camp_cooking_tripod" for source_id in source_ids):
        errors.append("camp tripod missing after GLB round-trip")
    if triangles <= 0:
        errors.append("imported GLB contains no triangles")

    report = {
        "schemaVersion": 1,
        "validatedAt": datetime.now(timezone.utc).isoformat(),
        "status": "pass" if not errors else "fail",
        "glb": str(GLB_PATH),
        "meshesImported": len(meshes),
        "trianglesImported": triangles,
        "sourceIds": sorted(source_ids),
        "errors": errors,
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("HC_ROUNDTRIP_JSON " + json.dumps({
        "status": report["status"],
        "meshesImported": len(meshes),
        "trianglesImported": triangles,
        "errors": len(errors),
    }, separators=(",", ":")))
    if errors:
        raise RuntimeError("Hunter's Camp GLB round-trip failed: " + "; ".join(errors))
    print(f"HC_ROUNDTRIP_OK report={REPORT_PATH}")


if __name__ == "__main__":
    main()
