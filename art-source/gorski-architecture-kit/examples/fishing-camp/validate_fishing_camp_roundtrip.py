from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path

import bpy


EXAMPLE_DIR = Path(__file__).resolve().parent
OUTPUT_ROOT = Path(os.environ.get("GK_FISHING_CAMP_OUTPUT_ROOT", str(EXAMPLE_DIR))).resolve()
OUT_DIR = OUTPUT_ROOT / "out"
GLB_PATH = OUT_DIR / "fishing_camp_textured_v4.glb"
REPORT_PATH = OUT_DIR / "fishing_camp_roundtrip_validation_v4.json"


def main() -> None:
    errors: list[str] = []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(GLB_PATH))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    source_ids = [str(obj.get("source_component_id", "")) for obj in meshes]
    triangles = sum(sum(max(0, len(poly.vertices) - 2) for poly in obj.data.polygons) for obj in meshes)
    if len(meshes) != 59:
        errors.append(f"expected 59 imported meshes, found {len(meshes)}")
    if any(not source_id for source_id in source_ids):
        errors.append("one or more imported meshes lost source_component_id extras")
    if any(obj.get("preview_only") for obj in meshes):
        errors.append("preview-only staging leaked into GLB")
    for required in (
        "prop_boat_dugout", "prop_fish_drying_rack", "wall_limewash_2m_door_service_host",
        "wall_plank_2m_door_service_host", "assembly_custom_settled_shingle_skin",
    ):
        if required not in source_ids:
            errors.append(f"required authored role missing after GLB round-trip: {required}")
    if source_ids.count("assembly_custom_settled_shingle_skin") != 4:
        errors.append("four retopologized roof skins did not survive GLB round-trip")
    rack = next((obj for obj in meshes if obj.get("source_component_id") == "prop_fish_drying_rack"), None)
    if rack is not None:
        rack_roles = {str(material.get("surface_role", "")) for material in rack.data.materials if material}
        if rack_roles - {"oak_dark", "timber_weathered"}:
            errors.append(f"drying rack regained baked catch placeholders: {sorted(rack_roles)}")
    if not 2500 <= triangles <= 4500:
        errors.append(f"imported GLB outside 2500-4500 triangle budget: {triangles}")
    for material in bpy.data.materials:
        if material.get("surface_role") == "dark-window-void":
            continue
        if material.get("atlas_id") != "gorski-building-atlas-v1":
            errors.append(f"material lost production atlas metadata: {material.name}")
            continue
        if material.get("atlas_uv_mode") != "final tile coordinates baked into GK_UV0":
            errors.append(f"direct-UV contract lost in GLB: {material.name}")
        if not material.get("atlas_tint"):
            errors.append(f"authored tint lost in GLB: {material.name}")

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
    print("FC_ROUNDTRIP_JSON " + json.dumps({
        "status": report["status"],
        "meshesImported": len(meshes),
        "trianglesImported": triangles,
        "errors": len(errors),
    }, separators=(",", ":")))
    if errors:
        raise RuntimeError("Fishing Camp GLB round-trip failed: " + "; ".join(errors))
    print(f"FC_ROUNDTRIP_OK report={REPORT_PATH}")


if __name__ == "__main__":
    main()
