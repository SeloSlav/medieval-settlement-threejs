from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path

import bpy


EXAMPLE_DIR = Path(__file__).resolve().parent
OUTPUT_ROOT = Path(os.environ.get("GK_TIER1_OUTPUT_ROOT", str(EXAMPLE_DIR))).resolve()
OUT_DIR = OUTPUT_ROOT / "out"
GLB_PATH = OUT_DIR / "tier1_residence_retopo_v26.glb"
REPORT_PATH = OUT_DIR / "tier1_residence_roundtrip_validation_v26.json"


def main() -> None:
    errors: list[str] = []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(GLB_PATH))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    source_ids = [str(obj.get("source_component_id", "")) for obj in meshes]
    triangles = sum(sum(max(0, len(poly.vertices) - 2) for poly in obj.data.polygons) for obj in meshes)

    if len(meshes) != 33:
        errors.append(f"expected 33 imported meshes, found {len(meshes)}")
    if any(not source_id for source_id in source_ids):
        errors.append("one or more imported meshes lost source_component_id extras")
    if any(obj.get("preview_only") for obj in meshes):
        errors.append("preview-only staging leaked into GLB")
    if source_ids.count("assembly_custom_retopped_shingle_skin") != 2:
        errors.append("expected two retopologized roof skins after GLB round-trip")
    if source_ids.count("assembly_custom_short_corner_post") != 4:
        errors.append("expected four shortened corner posts after GLB round-trip")
    if any(source_id.startswith("roof_shingle_ridge") for source_id in source_ids):
        errors.append("removed ridge-cap components leaked into GLB")
    if triangles <= 0 or triangles >= 9000:
        errors.append(f"imported GLB triangle count outside residence budget: {triangles}")

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
    print("T1_ROUNDTRIP_JSON " + json.dumps({
        "status": report["status"],
        "meshesImported": len(meshes),
        "trianglesImported": triangles,
        "errors": len(errors),
    }, separators=(",", ":")))
    if errors:
        raise RuntimeError("Tier-1 residence GLB round-trip failed: " + "; ".join(errors))
    print(f"T1_ROUNDTRIP_OK report={REPORT_PATH}")


if __name__ == "__main__":
    main()
