from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path

import bpy
from mathutils import Vector


EXAMPLE_DIR = Path(__file__).resolve().parent
GLB_PATH = EXAMPLE_DIR / "out" / "tier1_church_delnice_v2.glb"
REPORT_PATH = EXAMPLE_DIR / "out" / "tier1_church_roundtrip_validation_v2.json"
TIER1_RESIDENCE_HEIGHT = 5.1335


def main() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(GLB_PATH))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    errors: list[str] = []
    if len(meshes) != 84:
        errors.append(f"Expected 84 round-trip meshes, found {len(meshes)}")
    triangles = sum(sum(len(poly.vertices) - 2 for poly in obj.data.polygons) for obj in meshes)
    names = {obj.name for obj in bpy.context.scene.objects}
    for required in ("TC_Main_West_Door", "TC_West_Oculus", "TC_Delnice_Flared_Spire", "TC_Spire_Iron_Cross", "TC_Clock_Anchor", "TC_Nave_Left_Lancet_1", "TC_Nave_Right_Lancet_3", "TC_Belfry_Louver_Left", "TC_Belfry_Louver_Right"):
        if required not in names:
            errors.append(f"Missing round-trip node: {required}")
    clock_meshes = [obj.name for obj in meshes if "clock" in obj.name.lower()]
    if clock_meshes:
        errors.append(f"Clock meshes unexpectedly baked into GLB: {clock_meshes}")
    anchor = bpy.data.objects.get("TC_Clock_Anchor")
    if anchor is None or anchor.type != "EMPTY":
        errors.append("Runtime clock anchor did not survive as an empty node")
    for name, contract in (
        ("TC_Nave_Left_Lancet_1", "window_lancet"),
        ("TC_Nave_Right_Lancet_3", "window_lancet"),
        ("TC_Belfry_Louver_Left", "window_domestic"),
        ("TC_Belfry_Louver_Right", "window_domestic"),
    ):
        insert = bpy.data.objects.get(name)
        if insert is None:
            continue
        if insert.get("tc_aperture_contract") != contract:
            errors.append(f"{name} lost aperture contract {contract}")
        if bpy.data.objects.get(str(insert.get("tc_host_object", ""))) is None:
            errors.append(f"{name} lost its host reference")
    side_louver_minimum_z: dict[str, float] = {}
    for face in ("Left", "Right"):
        louver = bpy.data.objects.get(f"TC_Belfry_Louver_{face}")
        if louver is None:
            continue
        minimum_z = min((louver.matrix_world @ vertex.co).z for vertex in louver.data.vertices)
        side_louver_minimum_z[face] = minimum_z
        if minimum_z < 8.0:
            errors.append(f"TC_Belfry_Louver_{face} returned below the roof-clear zone at z={minimum_z:.4f}")
    vertices = [obj.matrix_world @ vertex.co for obj in meshes for vertex in obj.data.vertices]
    min_corner = Vector((min(point.x for point in vertices), min(point.y for point in vertices), min(point.z for point in vertices)))
    max_corner = Vector((max(point.x for point in vertices), max(point.y for point in vertices), max(point.z for point in vertices)))
    ratio = max_corner.z / TIER1_RESIDENCE_HEIGHT
    if not (2.5 <= ratio <= 3.5):
        errors.append(f"Round-trip height ratio is {ratio:.4f}")
    atlas_tiles = {
        str(material.get("atlas_tile"))
        for obj in meshes
        for material in obj.data.materials
        if material is not None and material.get("atlas_tile")
    }
    for tile in ("lime-plaster", "fieldstone-mortar", "split-shingles", "wrought-iron"):
        if tile not in atlas_tiles:
            errors.append(f"Round-trip material lost atlas tile {tile}")
    report = {
        "schemaVersion": 2,
        "validatedAt": datetime.now(timezone.utc).isoformat(),
        "status": "pass" if not errors else "fail",
        "glb": str(GLB_PATH),
        "meshesImported": len(meshes),
        "trianglesImported": triangles,
        "bounds": {"min": [round(v, 4) for v in min_corner], "max": [round(v, 4) for v in max_corner]},
        "heightRatio": round(ratio, 4),
        "clockAnchorImported": anchor is not None and anchor.type == "EMPTY",
        "clockGeometryBaked": bool(clock_meshes),
        "apertureMetadataImported": not any("aperture contract" in error or "host reference" in error for error in errors),
        "sideBelfryLouverMinimumZ": {key: round(value, 4) for key, value in side_louver_minimum_z.items()},
        "atlasTiles": sorted(atlas_tiles),
        "errors": errors,
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    if errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
