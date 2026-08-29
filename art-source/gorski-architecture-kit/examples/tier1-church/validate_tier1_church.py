from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path

import bpy
from mathutils import Vector


EXAMPLE_DIR = Path(__file__).resolve().parent
OUT_REPORT = EXAMPLE_DIR / "out" / "tier1_church_validation_v2.json"
TIER1_RESIDENCE_HEIGHT = 5.1335
CHURCH_WIDTH = 10.0
FRONT_Y = -7.80
REAR_Y = 7.80
WALL_TOP_Z = 6.05
RIDGE_Z = 9.05
NAVE_ROOF_FRONT_Y = FRONT_Y - 0.26
NAVE_ROOF_REAR_Y = REAR_Y + 0.30
NAVE_ROOF_EAVE_X = CHURCH_WIDTH * 0.5 + 0.36
NAVE_LANCET_INSERT_Z = 1.405
BELFRY_Z = 7.25
REQUIRED_OBJECTS = {
    "TC_Main_West_Door",
    "TC_Main_West_Portal_Surround",
    "TC_West_Oculus",
    "TC_Tower_Slit_Window_Void",
    "TC_Tower_Belfry_Front",
    "TC_Belfry_Louver_Front",
    "TC_Delnice_Flared_Spire",
    "TC_Spire_Iron_Cross",
    "TC_Nave_Roof_Left",
    "TC_Nave_Roof_Right",
}


def evaluated_triangles(obj: bpy.types.Object) -> int:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        return sum(len(polygon.vertices) - 2 for polygon in mesh.polygons)
    finally:
        evaluated.to_mesh_clear()


def world_vertices(obj: bpy.types.Object):
    return [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]


def world_bounds(obj: bpy.types.Object) -> tuple[Vector, Vector]:
    points = world_vertices(obj)
    return (
        Vector((min(point.x for point in points), min(point.y for point in points), min(point.z for point in points))),
        Vector((max(point.x for point in points), max(point.y for point in points), max(point.z for point in points))),
    )


def roof_surface_z(abs_x: float, y: float) -> float:
    t_y = max(0.0, min(1.0, (y - NAVE_ROOF_FRONT_Y) / (NAVE_ROOF_REAR_Y - NAVE_ROOF_FRONT_Y)))
    ridge = RIDGE_Z + (RIDGE_Z - 0.02 - RIDGE_Z) * t_y
    eave = (WALL_TOP_Z - 0.06) + ((WALL_TOP_Z - 0.10) - (WALL_TOP_Z - 0.06)) * t_y
    middle = ((WALL_TOP_Z - 0.06 + RIDGE_Z) * 0.5 - 0.035) - 0.04 * t_y
    midpoint_x = NAVE_ROOF_EAVE_X * 0.5
    x = max(0.0, min(NAVE_ROOF_EAVE_X, abs_x))
    if x <= midpoint_x:
        return ridge + (middle - ridge) * (x / midpoint_x)
    return middle + (eave - middle) * ((x - midpoint_x) / midpoint_x)


def main() -> None:
    meshes = [obj for obj in bpy.data.objects if obj.type == "MESH" and obj.get("tc_instance")]
    anchor = bpy.data.objects.get("TC_Clock_Anchor")
    errors: list[str] = []
    warnings: list[str] = []
    names = {obj.name for obj in meshes}
    missing = sorted(REQUIRED_OBJECTS - names)
    if missing:
        errors.append(f"Missing required authored objects: {missing}")
    if anchor is None or anchor.type != "EMPTY":
        errors.append("TC_Clock_Anchor must be an exported empty, not a clock mesh")
    elif anchor.get("runtime_owned") != "simulation-driven parish clock face and hands":
        errors.append("Clock anchor is missing its runtime ownership contract")
    clock_meshes = sorted(obj.name for obj in meshes if "clock" in obj.name.lower())
    if clock_meshes:
        errors.append(f"Clock geometry must not be baked into the GLB: {clock_meshes}")
    noncanonical_scale = [obj.name for obj in meshes if any(abs(value - 1.0) > 1e-6 for value in obj.scale)]
    if noncanonical_scale:
        errors.append(f"Non-canonical object scales: {noncanonical_scale}")
    missing_uv = [obj.name for obj in meshes if obj.data.uv_layers.get("GK_UV0") is None]
    if missing_uv:
        errors.append(f"Meshes missing GK_UV0: {missing_uv}")

    lancet_insert_names = [
        f"TC_Nave_{side}_Lancet_{index}"
        for side in ("Left", "Right")
        for index in (1, 2, 3)
    ]
    aperture_contract_errors: list[str] = []
    for name in lancet_insert_names:
        insert = bpy.data.objects.get(name)
        if insert is None:
            aperture_contract_errors.append(f"{name}: missing")
            continue
        host = bpy.data.objects.get(str(insert.get("tc_host_object", "")))
        if host is None:
            aperture_contract_errors.append(f"{name}: host reference missing")
            continue
        if insert.get("tc_aperture_contract") != "window_lancet" or host.get("tc_aperture_contract") != "window_lancet":
            aperture_contract_errors.append(f"{name}: window_lancet contract mismatch")
        if abs(insert.location.y - host.location.y) > 1e-5:
            aperture_contract_errors.append(f"{name}: host/insert horizontal centreline mismatch")
        if abs(insert.location.z - NAVE_LANCET_INSERT_Z) > 1e-5:
            aperture_contract_errors.append(f"{name}: sill offset is {insert.location.z:.4f}, expected {NAVE_LANCET_INSERT_Z:.4f}")

    belfry_louver_names = [f"TC_Belfry_Louver_{face}" for face in ("Front", "Rear", "Left", "Right")]
    for name in belfry_louver_names:
        insert = bpy.data.objects.get(name)
        if insert is None:
            aperture_contract_errors.append(f"{name}: missing")
            continue
        host = bpy.data.objects.get(str(insert.get("tc_host_object", "")))
        if host is None:
            aperture_contract_errors.append(f"{name}: host reference missing")
            continue
        if insert.get("tc_aperture_contract") != "window_domestic" or host.get("tc_aperture_contract") != "window_domestic":
            aperture_contract_errors.append(f"{name}: window_domestic contract mismatch")
        if abs(insert.location.z - BELFRY_Z) > 1e-5:
            aperture_contract_errors.append(f"{name}: belfry sill offset mismatch")
    if aperture_contract_errors:
        errors.extend(aperture_contract_errors)

    side_louver_clearances: dict[str, float] = {}
    for face in ("Left", "Right"):
        louver = bpy.data.objects.get(f"TC_Belfry_Louver_{face}")
        if louver is None:
            continue
        minimum, _ = world_bounds(louver)
        roof_z = roof_surface_z(2.0, louver.location.y)
        clearance = minimum.z - roof_z
        side_louver_clearances[face] = clearance
        if clearance < 0.10:
            errors.append(f"TC_Belfry_Louver_{face} clears the nave roof by only {clearance:.4f} m")

    gable_roof_clearances: dict[str, float] = {}
    for name in ("TC_Front_Left_Gable_Shoulder", "TC_Front_Right_Gable_Shoulder", "TC_Rear_Gable"):
        gable = bpy.data.objects.get(name)
        if gable is None:
            errors.append(f"Missing roof-contained gable object: {name}")
            continue
        points = [point for point in world_vertices(gable) if point.z > WALL_TOP_Z + 0.01]
        clearance = min(roof_surface_z(abs(point.x), point.y) - point.z for point in points)
        gable_roof_clearances[name] = clearance
        if clearance < 0.08:
            errors.append(f"{name} has only {clearance:.4f} m of roof cover")

    oculus = bpy.data.objects.get("TC_West_Oculus")
    slit_parts = [bpy.data.objects.get(f"TC_Tower_Slit_Frame_{label}") for label in ("Top", "Bottom", "Left", "Right")]
    oculus_slit_clearance = None
    if oculus is not None and all(part is not None for part in slit_parts):
        _, oculus_maximum = world_bounds(oculus)
        slit_minimum_z = min(world_bounds(part)[0].z for part in slit_parts if part is not None)
        oculus_slit_clearance = slit_minimum_z - oculus_maximum.z
        if oculus_slit_clearance < 0.25:
            errors.append(f"West oculus/slit spacing is only {oculus_slit_clearance:.4f} m")

    triangles = sum(evaluated_triangles(obj) for obj in meshes)
    if triangles > 24_000:
        errors.append(f"Triangle budget exceeded: {triangles} > 24000")
    vertices = [point for obj in meshes for point in world_vertices(obj)]
    min_corner = Vector((min(point.x for point in vertices), min(point.y for point in vertices), min(point.z for point in vertices)))
    max_corner = Vector((max(point.x for point in vertices), max(point.y for point in vertices), max(point.z for point in vertices)))
    dimensions = max_corner - min_corner
    height_ratio = max_corner.z / TIER1_RESIDENCE_HEIGHT
    if not (2.5 <= height_ratio <= 3.5):
        errors.append(f"Church/Tier-1 residence height ratio {height_ratio:.4f} is outside 2.5-3.5")
    if min_corner.z < -0.04:
        errors.append(f"Church penetrates grade at z={min_corner.z:.4f}")
    if dimensions.x > 11.2 or dimensions.y > 18.2:
        errors.append(f"Church exceeds reserved footprint: {tuple(round(v, 4) for v in dimensions)}")

    material_roles = {
        str(material.get("surface_role"))
        for obj in meshes
        for material in obj.data.materials
        if material is not None and material.get("surface_role")
    }
    required_roles = {"limewash", "limewash_faded", "limewash_damp", "fieldstone", "limestone_warm", "shingles", "shingles_aged", "iron"}
    missing_roles = sorted(required_roles - material_roles)
    if missing_roles:
        errors.append(f"Missing authored surface roles: {missing_roles}")
    atlas_tiles = {
        str(material.get("atlas_tile"))
        for obj in meshes
        for material in obj.data.materials
        if material is not None and material.get("atlas_tile")
    }
    for tile in ("lime-plaster", "fieldstone-mortar", "split-shingles", "wrought-iron"):
        if tile not in atlas_tiles:
            errors.append(f"Missing production atlas tile: {tile}")

    report = {
        "schemaVersion": 2,
        "validatedAt": datetime.now(timezone.utc).isoformat(),
        "status": "pass" if not errors else "fail",
        "meshes": len(meshes),
        "triangles": triangles,
        "bounds": {"min": [round(v, 4) for v in min_corner], "max": [round(v, 4) for v in max_corner]},
        "dimensions": [round(v, 4) for v in dimensions],
        "maximumHeight": round(max_corner.z, 4),
        "tier1ResidenceHeight": TIER1_RESIDENCE_HEIGHT,
        "heightRatio": round(height_ratio, 4),
        "clockGeometryBaked": bool(clock_meshes),
        "clockAnchor": anchor.name if anchor else None,
        "apertureContractsValidated": len(lancet_insert_names) + len(belfry_louver_names),
        "sideBelfryRoofClearance": {key: round(value, 4) for key, value in side_louver_clearances.items()},
        "gableRoofClearance": {key: round(value, 4) for key, value in gable_roof_clearances.items()},
        "oculusSlitClearance": round(oculus_slit_clearance, 4) if oculus_slit_clearance is not None else None,
        "atlasTiles": sorted(atlas_tiles),
        "surfaceRoles": sorted(material_roles),
        "errors": errors,
        "warnings": warnings,
    }
    OUT_REPORT.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    if errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
