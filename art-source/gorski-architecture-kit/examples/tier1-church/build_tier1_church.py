from __future__ import annotations

import importlib.util
import json
import math
import os
from pathlib import Path
import time

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[4]
EXAMPLE_DIR = Path(__file__).resolve().parent
OUTPUT_ROOT = Path(os.environ.get("GK_TIER1_CHURCH_OUTPUT_ROOT", str(EXAMPLE_DIR))).resolve()
OUT_DIR = OUTPUT_ROOT / "out"
RENDER_DIR = OUTPUT_ROOT / "renders"
OUT_BLEND = OUT_DIR / "tier1_church_delnice_v2.blend"
OUT_GLB = OUT_DIR / "tier1_church_delnice_v2.glb"
OUT_MANIFEST = OUT_DIR / "tier1_church_assembly_v2.json"
OUT_FRONT = RENDER_DIR / "tier1_church_front_v2.png"
OUT_HERO = RENDER_DIR / "tier1_church_hero_v2.png"
OUT_REAR = RENDER_DIR / "tier1_church_rear_v2.png"
OUT_SIDE = RENDER_DIR / "tier1_church_side_v2.png"
OUT_TOWER_DETAIL = RENDER_DIR / "tier1_church_tower_clearance_v2.png"
OUT_SCALE = RENDER_DIR / "tier1_church_scale_v2.png"

HELPER_PATH = EXAMPLE_DIR.parent / "hunters-camp" / "build_hunters_camp.py"
helper_spec = importlib.util.spec_from_file_location("gorski_church_texture_helper", HELPER_PATH)
if helper_spec is None or helper_spec.loader is None:
    raise RuntimeError(f"Could not load the production atlas helper: {HELPER_PATH}")
texture_helper = importlib.util.module_from_spec(helper_spec)
helper_spec.loader.exec_module(texture_helper)

SOURCES = {str(obj["gk_id"]): obj for obj in bpy.data.objects if obj.get("gk_id")}
PLACEMENTS: list[dict[str, object]] = []

CHURCH_WIDTH = 10.0
CHURCH_DEPTH = 15.6
FRONT_Y = -7.80
REAR_Y = 7.80
BASE_Z = 0.65
WALL_TOP_Z = 6.05
RIDGE_Z = 9.05
TOWER_WIDTH = 4.0
TOWER_DEPTH = 4.10
TOWER_CENTRE_Y = FRONT_Y + TOWER_DEPTH * 0.5
TOWER_LOWER_HEIGHT = 2.60
TOWER_SHAFT_Z = BASE_Z + TOWER_LOWER_HEIGHT
BELFRY_Z = TOWER_SHAFT_Z + 4.0
BELFRY_ROOF_Z = BELFRY_Z + 3.80
SPIRE_APEX_Z = BELFRY_ROOF_Z + 4.18
CROSS_TOP_Z = SPIRE_APEX_Z + 1.34
NAVE_LANCET_HOST_SILL = 1.62
NAVE_LANCET_INSERT_LOCAL_SILL = 0.865
NAVE_LANCET_INSERT_Z = BASE_Z + NAVE_LANCET_HOST_SILL - NAVE_LANCET_INSERT_LOCAL_SILL
BELFRY_VOID_WIDTH = 0.84
BELFRY_VOID_HEIGHT = 1.04
BELFRY_VOID_CENTRE_Z = BELFRY_Z + 0.92 + BELFRY_VOID_HEIGHT * 0.5
TIER1_RESIDENCE_HEIGHT = 5.1335


def collection(name: str) -> bpy.types.Collection:
    current = bpy.data.collections.get(name)
    if current is None:
        current = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(current)
    return current


FOUNDATIONS = collection("TC_01_Foundations")
NAVE = collection("TC_02_Nave_And_Facade")
TOWER = collection("TC_03_West_Tower")
ROOFS = collection("TC_04_Roofs_And_Spire")
OPENINGS = collection("TC_05_Doors_Windows_Louvers")
DETAILS = collection("TC_06_Stone_Trim_And_Steps")
PREVIEW = collection("TC_90_Preview_Staging")


texture_helper.MATERIAL_LOOKS.update({
    "limewash": ("lime-plaster", (0.72, 0.68, 0.56, 1.0), 0.36, 0.70),
    "limewash_faded": ("lime-plaster", (0.58, 0.55, 0.46, 1.0), 0.60, 0.72),
    "limewash_damp": ("lime-plaster", (0.38, 0.37, 0.32, 1.0), 0.76, 0.74),
    "limestone_warm": ("fieldstone-mortar", (0.53, 0.48, 0.38, 1.0), 0.62, 0.80),
    "fieldstone": ("fieldstone-mortar", (0.36, 0.35, 0.31, 1.0), 0.80, 0.86),
    "oak_dark": ("rough-hewn-timber", (0.12, 0.070, 0.035, 1.0), 0.88, 0.76),
    "timber_weathered": ("weathered-planks", (0.25, 0.16, 0.082, 1.0), 0.78, 0.76),
    "timber_cut": ("sawn-planks", (0.39, 0.24, 0.12, 1.0), 0.64, 0.68),
    "shingles": ("split-shingles", (0.095, 0.085, 0.075, 1.0), 0.96, 0.84),
    "shingles_aged": ("split-shingles", (0.055, 0.060, 0.058, 1.0), 0.98, 0.84),
    "iron": ("wrought-iron", (0.045, 0.050, 0.047, 1.0), 0.88, 0.54),
    "glass": ("wrought-iron", (0.035, 0.048, 0.052, 1.0), 0.96, 0.36),
    "packed_earth": ("packed-earth", (0.24, 0.20, 0.16, 1.0), 0.48, 0.56),
})


def remap_materials(obj: bpy.types.Object) -> None:
    if obj.type != "MESH":
        return
    keys = [
        old.name.removeprefix("GK_Mat_") if old is not None else "limestone_warm"
        for old in obj.data.materials
    ]
    texture_helper.bake_atlas_uvs(obj, keys)
    for index, key in enumerate(keys):
        obj.data.materials[index] = texture_helper.atlas_material(key)


def record(obj: bpy.types.Object, source_id: str, target: bpy.types.Collection) -> None:
    obj["tc_instance"] = True
    obj["tc_retopology_profile"] = "gameplay-v1; authored topology; no export bevel"
    obj["source_component_id"] = source_id
    obj["assembly_role"] = target.name
    PLACEMENTS.append({
        "name": obj.name,
        "source": source_id,
        "collection": target.name,
        "location": [round(value, 5) for value in obj.location],
        "rotationDegrees": [round(math.degrees(value), 4) for value in obj.rotation_euler],
    })


def place(
    part_id: str,
    name: str,
    target: bpy.types.Collection,
    location: tuple[float, float, float],
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    source = SOURCES.get(part_id)
    if source is None:
        raise KeyError(f"Missing source component: {part_id}")
    obj = source.copy()
    if source.data is not None:
        obj.data = source.data.copy()
    obj.name = name
    obj.location = location
    obj.rotation_euler = rotation
    obj.scale = (1.0, 1.0, 1.0)
    obj.modifiers.clear()
    target.objects.link(obj)
    texture_helper.phase_metric_uvs(obj, location, rotation[2])
    remap_materials(obj)
    record(obj, part_id, target)
    return obj


def add_metric_uv_layer(mesh: bpy.types.Mesh) -> None:
    uv_layer = mesh.uv_layers.new(name="GK_UV0")
    for polygon in mesh.polygons:
        normal = polygon.normal
        ax, ay, az = abs(normal.x), abs(normal.y), abs(normal.z)
        for loop_index in polygon.loop_indices:
            point = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            if az >= ax and az >= ay:
                uv = (point.x, point.y)
            elif ay >= ax:
                uv = (point.x, point.z)
            else:
                uv = (point.y, point.z)
            uv_layer.data[loop_index].uv = uv


def custom_mesh(
    name: str,
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, ...]],
    material_key: str,
    target: bpy.types.Collection,
    source_id: str,
) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update(calc_edges=True)
    add_metric_uv_layer(mesh)
    obj = bpy.data.objects.new(name, mesh)
    target.objects.link(obj)
    texture_helper.bake_atlas_uvs(obj, [material_key])
    obj.data.materials.append(texture_helper.atlas_material(material_key))
    record(obj, source_id, target)
    return obj


def box_mesh(
    name: str,
    size: tuple[float, float, float],
    centre: tuple[float, float, float],
    material_key: str,
    target: bpy.types.Collection,
    source_id: str,
) -> bpy.types.Object:
    sx, sy, sz = (value * 0.5 for value in size)
    cx, cy, cz = centre
    vertices = [
        (cx - sx, cy - sy, cz - sz), (cx + sx, cy - sy, cz - sz),
        (cx + sx, cy + sy, cz - sz), (cx - sx, cy + sy, cz - sz),
        (cx - sx, cy - sy, cz + sz), (cx + sx, cy - sy, cz + sz),
        (cx + sx, cy + sy, cz + sz), (cx - sx, cy + sy, cz + sz),
    ]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return custom_mesh(name, vertices, faces, material_key, target, source_id)


def prism_from_profile(
    name: str,
    profile: list[tuple[float, float]],
    front_y: float,
    depth: float,
    material_key: str,
    source_id: str,
) -> bpy.types.Object:
    back_y = front_y + depth
    vertices = [(x, front_y, z) for x, z in profile] + [(x, back_y, z) for x, z in profile]
    count = len(profile)
    faces: list[tuple[int, ...]] = [tuple(range(count - 1, -1, -1)), tuple(range(count, count * 2))]
    for index in range(count):
        following = (index + 1) % count
        faces.append((index, following, count + following, count + index))
    return custom_mesh(name, vertices, faces, material_key, NAVE, source_id)


def nave_roof_skin(name: str, side: int, material_key: str) -> bpy.types.Object:
    eave_x = side * (CHURCH_WIDTH * 0.5 + 0.36)
    ridge_x = 0.0
    front = FRONT_Y - 0.26
    rear = REAR_Y + 0.30
    mid_x = (eave_x + ridge_x) * 0.5
    mid_z = (WALL_TOP_Z - 0.06 + RIDGE_Z) * 0.5 - 0.035
    top = [
        (ridge_x, front, RIDGE_Z), (mid_x, front, mid_z), (eave_x, front, WALL_TOP_Z - 0.06),
        (ridge_x, rear, RIDGE_Z - 0.02), (mid_x, rear, mid_z - 0.04), (eave_x, rear, WALL_TOP_Z - 0.10),
    ]
    thickness = 0.11
    vertices = top + [(x, y, z - thickness) for x, y, z in top]
    faces = [
        (0, 3, 4, 1), (1, 4, 5, 2), (6, 7, 10, 9), (7, 8, 11, 10),
        (0, 6, 9, 3), (2, 5, 11, 8), (0, 1, 7, 6), (1, 2, 8, 7),
        (3, 9, 10, 4), (4, 10, 11, 5),
    ]
    return custom_mesh(name, vertices, faces, material_key, ROOFS, "assembly_custom_church_nave_roof_skin")


def assemble_foundations() -> None:
    side_centres = (-5.80, -1.80, 2.20, 6.20)
    for side, x, rz in (("Left", -5.0, -math.pi * 0.5), ("Right", 5.0, math.pi * 0.5)):
        for index, y in enumerate(side_centres):
            place("foundation_fieldstone_4m_h0p65m", f"TC_Foundation_{side}_{index + 1}", FOUNDATIONS, (x, y, 0.0), (0.0, 0.0, rz))
    for label, x, part in (("Left4", -3.0, "foundation_fieldstone_4m_h0p65m"), ("Centre2", 0.0, "foundation_fieldstone_2m_h0p65m"), ("Right4", 3.0, "foundation_fieldstone_4m_h0p65m")):
        place(part, f"TC_Foundation_Rear_{label}", FOUNDATIONS, (x, REAR_Y, 0.0), (0.0, 0.0, math.pi))
    for label, x, part in (
        ("FarLeft2", -4.0, "foundation_fieldstone_2m_h0p65m"),
        ("InnerLeft1", -2.5, "foundation_fieldstone_1m_h0p65m"),
        ("Tower", 0.0, "foundation_fieldstone_4m_h0p65m"),
        ("InnerRight1", 2.5, "foundation_fieldstone_1m_h0p65m"),
        ("FarRight2", 4.0, "foundation_fieldstone_2m_h0p65m"),
    ):
        place(part, f"TC_Foundation_Front_{label}", FOUNDATIONS, (x, FRONT_Y, 0.0))


def assemble_nave() -> None:
    side_centres = (-5.80, -1.80, 2.20, 6.20)
    for side, x, rz in (("Left", -5.0, -math.pi * 0.5), ("Right", 5.0, math.pi * 0.5)):
        for index, y in enumerate(side_centres):
            component = "civic_church_nave_bay_lancet_4m_h5p4m" if index in (1, 2, 3) else "civic_church_nave_bay_plain_4m_h5p4m"
            host = place(component, f"TC_Nave_{side}_Bay_{index + 1}", NAVE, (x, y, BASE_Z), (0.0, 0.0, rz))
            if index in (1, 2, 3):
                host["tc_aperture_contract"] = "window_lancet"
                host["tc_aperture_sill_world"] = BASE_Z + NAVE_LANCET_HOST_SILL
                host["tc_aperture_head_world"] = BASE_Z + NAVE_LANCET_HOST_SILL + 1.62
                insert = place("opening_window_lancet_deep", f"TC_Nave_{side}_Lancet_{index}", OPENINGS, (x + (-0.255 if side == "Left" else 0.255), y, NAVE_LANCET_INSERT_Z), (0.0, 0.0, rz))
                insert["tc_aperture_contract"] = "window_lancet"
                insert["tc_host_object"] = host.name
    for label, x in (("Left", -3.0), ("Right", 3.0)):
        place("civic_church_nave_bay_plain_4m_h5p4m", f"TC_Rear_{label}_Bay", NAVE, (x, REAR_Y, BASE_Z), (0.0, 0.0, math.pi))
    box_mesh("TC_Rear_Centre_Infill", (2.0, 0.46, 5.40), (0.0, REAR_Y, BASE_Z + 2.70), "limewash_faded", NAVE, "assembly_custom_rear_two_metre_bay")

    for label, x in (("Left", -3.5), ("Right", 3.5)):
        place("civic_church_west_portal_bay_3m_h5p4m", f"TC_Front_{label}_Portal_Bay", NAVE, (x, FRONT_Y, BASE_Z))
        place("opening_church_arch_door", f"TC_Front_{label}_Side_Door", OPENINGS, (x, FRONT_Y - 0.27, BASE_Z))
        place("roof_shingle_portal_canopy_1p7m", f"TC_Front_{label}_Door_Canopy", ROOFS, (x, FRONT_Y - 0.02, BASE_Z + 2.42))

    left_profile = [(-5.0, WALL_TOP_Z), (-2.0, WALL_TOP_Z), (-2.0, 7.67)]
    right_profile = [(2.0, WALL_TOP_Z), (5.0, WALL_TOP_Z), (2.0, 7.67)]
    prism_from_profile("TC_Front_Left_Gable_Shoulder", left_profile, FRONT_Y + 0.02, 0.38, "limewash_faded", "assembly_custom_west_gable_shoulder")
    prism_from_profile("TC_Front_Right_Gable_Shoulder", right_profile, FRONT_Y + 0.02, 0.38, "limewash", "assembly_custom_west_gable_shoulder")
    prism_from_profile("TC_Rear_Gable", [(-5.0, WALL_TOP_Z), (5.0, WALL_TOP_Z), (0.0, RIDGE_Z - 0.18)], REAR_Y - 0.40, 0.38, "limewash_faded", "assembly_custom_rear_gable")

    for label, x, y, rz in (
        ("FrontLeft", -5.02, FRONT_Y - 0.04, 0.0), ("FrontRight", 5.02, FRONT_Y - 0.04, 0.0),
        ("RearLeft", -5.02, REAR_Y + 0.04, math.pi), ("RearRight", 5.02, REAR_Y + 0.04, math.pi),
    ):
        place("civic_chapel_buttress_tall", f"TC_{label}_Stone_Pilaster", DETAILS, (x, y, BASE_Z), (0.0, 0.0, rz))


def tower_lower_host() -> None:
    half_gap = 0.88
    side_width = (TOWER_WIDTH - half_gap * 2.0) * 0.5
    for side, x in (("Left", -(half_gap + side_width * 0.5)), ("Right", half_gap + side_width * 0.5)):
        box_mesh(f"TC_Tower_Lower_Stone_{side}", (side_width, 0.52, 2.0), (x, FRONT_Y - 0.01, BASE_Z + 1.0), "fieldstone", TOWER, "assembly_custom_tower_portal_host")
    box_mesh("TC_Tower_Lower_Stone_Head", (TOWER_WIDTH, 0.52, 0.65), (0.0, FRONT_Y - 0.01, BASE_Z + 2.325), "fieldstone", TOWER, "assembly_custom_tower_portal_host")
    for side, x in (("Left", -2.0), ("Right", 2.0)):
        box_mesh(f"TC_Tower_Lower_Side_{side}", (0.50, TOWER_DEPTH, TOWER_LOWER_HEIGHT), (x, TOWER_CENTRE_Y, BASE_Z + TOWER_LOWER_HEIGHT * 0.5), "fieldstone", TOWER, "assembly_custom_tower_base_side")
    box_mesh("TC_Tower_Lower_Back", (TOWER_WIDTH, 0.50, TOWER_LOWER_HEIGHT), (0.0, FRONT_Y + TOWER_DEPTH, BASE_Z + TOWER_LOWER_HEIGHT * 0.5), "fieldstone", TOWER, "assembly_custom_tower_base_back")


def assemble_tower() -> None:
    tower_lower_host()
    for face, x, y, rz in (
        ("Front", 0.0, FRONT_Y - 0.02, 0.0),
        ("Rear", 0.0, FRONT_Y + TOWER_DEPTH, math.pi),
        ("Left", -2.0, TOWER_CENTRE_Y, -math.pi * 0.5),
        ("Right", 2.0, TOWER_CENTRE_Y, math.pi * 0.5),
    ):
        place("civic_church_tower_shaft_bay_4m_h4m", f"TC_Tower_Shaft_{face}", TOWER, (x, y, TOWER_SHAFT_Z), (0.0, 0.0, rz))
        belfry_host = place("civic_church_tower_belfry_bay_4m_h3p8m", f"TC_Tower_Belfry_{face}", TOWER, (x, y, BELFRY_Z), (0.0, 0.0, rz))
        belfry_host["tc_aperture_contract"] = "window_domestic"
        belfry_host["tc_aperture_sill_world"] = BELFRY_Z + 0.92
        belfry_host["tc_aperture_head_world"] = BELFRY_Z + 2.00
        louver_x = x + (-0.27 if face == "Left" else 0.27 if face == "Right" else 0.0)
        louver_y = y + (-0.27 if face == "Front" else 0.27 if face == "Rear" else 0.0)
        louver = place("opening_window_belfry_louver_arch", f"TC_Belfry_Louver_{face}", OPENINGS, (louver_x, louver_y, BELFRY_Z), (0.0, 0.0, rz))
        louver["tc_aperture_contract"] = "window_domestic"
        louver["tc_host_object"] = belfry_host.name
        if face in ("Front", "Rear"):
            box_mesh(f"TC_Belfry_Void_{face}", (BELFRY_VOID_WIDTH, 0.055, BELFRY_VOID_HEIGHT), (x, y + (-0.22 if face == "Front" else 0.22), BELFRY_VOID_CENTRE_Z), "glass", OPENINGS, "assembly_custom_belfry_dark_void")
        else:
            box_mesh(f"TC_Belfry_Void_{face}", (0.055, BELFRY_VOID_WIDTH, BELFRY_VOID_HEIGHT), (x + (-0.22 if face == "Left" else 0.22), y, BELFRY_VOID_CENTRE_Z), "glass", OPENINGS, "assembly_custom_belfry_dark_void")

    place("opening_church_arch_door_double", "TC_Main_West_Door", OPENINGS, (0.0, FRONT_Y - 0.31, BASE_Z))
    place("opening_church_portal_surround", "TC_Main_West_Portal_Surround", DETAILS, (0.0, FRONT_Y - 0.34, BASE_Z))
    place("opening_window_oculus_stone_small", "TC_West_Oculus", OPENINGS, (0.0, FRONT_Y - 0.30, BASE_Z + 3.42))
    place("foundation_steps_limestone_3", "TC_Main_Entrance_Steps", DETAILS, (0.0, FRONT_Y - 0.52, 0.0), (0.0, 0.0, math.pi))
    for label, x in (("Left", -3.5), ("Right", 3.5)):
        place("foundation_steps_limestone_1", f"TC_{label}_Entrance_Step", DETAILS, (x, FRONT_Y - 0.42, 0.0), (0.0, 0.0, math.pi))

    box_mesh("TC_Tower_Slit_Window_Void", (0.48, 0.08, 0.62), (0.0, FRONT_Y - 0.31, 5.60), "glass", OPENINGS, "assembly_custom_tower_slit_window")
    for label, size, centre in (
        ("Top", (0.68, 0.18, 0.12), (0.0, FRONT_Y - 0.36, 5.97)),
        ("Bottom", (0.68, 0.18, 0.12), (0.0, FRONT_Y - 0.36, 5.23)),
        ("Left", (0.12, 0.18, 0.62), (-0.30, FRONT_Y - 0.36, 5.60)),
        ("Right", (0.12, 0.18, 0.62), (0.30, FRONT_Y - 0.36, 5.60)),
    ):
        box_mesh(f"TC_Tower_Slit_Frame_{label}", size, centre, "limestone_warm", DETAILS, "assembly_custom_tower_slit_surround")

    place("roof_shingle_belfry_ogee_4m", "TC_Delnice_Flared_Spire", ROOFS, (0.0, TOWER_CENTRE_Y, BELFRY_ROOF_Z))
    place("civic_church_cross_iron_large", "TC_Spire_Iron_Cross", DETAILS, (0.0, TOWER_CENTRE_Y, SPIRE_APEX_Z))

    anchor = bpy.data.objects.new("TC_Clock_Anchor", None)
    TOWER.objects.link(anchor)
    anchor.location = (0.0, FRONT_Y - 0.34, 9.72)
    anchor.empty_display_type = "CIRCLE"
    anchor.empty_display_size = 0.58
    anchor["tc_instance"] = True
    anchor["runtime_owned"] = "simulation-driven parish clock face and hands"
    anchor["clock_face_normal"] = [0.0, -1.0, 0.0]
    record(anchor, "runtime_clock_anchor_empty", TOWER)


def assemble_roofs() -> None:
    nave_roof_skin("TC_Nave_Roof_Left", -1, "shingles_aged")
    nave_roof_skin("TC_Nave_Roof_Right", 1, "shingles")
    box_mesh("TC_Nave_Ridge", (0.24, CHURCH_DEPTH + 0.74, 0.18), (0.0, 0.02, RIDGE_Z + 0.02), "shingles_aged", ROOFS, "assembly_custom_church_ridge")


def remove_source_library_objects() -> None:
    for obj in list(bpy.data.objects):
        if not obj.get("tc_instance"):
            bpy.data.objects.remove(obj, do_unlink=True)
    for source_collection in list(bpy.data.collections):
        if source_collection.name.startswith(("GK_", "HC_")) and not source_collection.objects and not source_collection.children:
            bpy.data.collections.remove(source_collection)


def link_preview(obj: bpy.types.Object) -> None:
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    PREVIEW.objects.link(obj)
    obj["preview_only"] = True


def point_at(obj: bpy.types.Object, target: tuple[float, float, float]) -> None:
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_light(name: str, light_type: str, location: tuple[float, float, float], energy: float, color: tuple[float, float, float], size: float = 1.0) -> bpy.types.Object:
    data = bpy.data.lights.new(name, light_type)
    data.energy = energy
    data.color = color
    if light_type == "AREA":
        data.shape = "DISK"
        data.size = size
    obj = bpy.data.objects.new(name, data)
    PREVIEW.objects.link(obj)
    obj.location = location
    obj["preview_only"] = True
    return obj


def stage_preview() -> bpy.types.Object:
    bpy.ops.mesh.primitive_plane_add(size=46.0, location=(0.0, 0.0, -0.03))
    ground = bpy.context.object
    ground.name = "TC_Preview_Ground"
    ground.data.uv_layers.active.name = "GK_UV0"
    for uv in ground.data.uv_layers.active.data:
        uv.uv *= 46.0
    texture_helper.bake_atlas_uvs(ground, ["packed_earth"])
    ground.data.materials.append(texture_helper.atlas_material("packed_earth"))
    link_preview(ground)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1500
    scene.render.resolution_y = 1500
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    scene.view_settings.exposure = -0.32
    if scene.world is None:
        scene.world = bpy.data.worlds.new("TC_Preview_World")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.055, 0.075, 0.082, 1.0)
    background.inputs["Strength"].default_value = 0.42

    key = add_light("TC_Key", "AREA", (-12.0, -16.0, 21.0), 1650.0, (0.94, 0.95, 1.0), 11.0)
    point_at(key, (0.0, -1.5, 6.0))
    fill = add_light("TC_Fill", "AREA", (13.0, -4.0, 12.0), 620.0, (0.60, 0.72, 1.0), 9.0)
    point_at(fill, (0.0, -1.0, 5.0))
    rim = add_light("TC_Rim", "AREA", (-8.0, 13.0, 17.0), 850.0, (1.0, 0.82, 0.62), 8.0)
    point_at(rim, (0.0, 0.0, 7.0))
    sun = add_light("TC_Sun", "SUN", (0.0, 0.0, 15.0), 1.35, (1.0, 0.93, 0.80))
    sun.rotation_euler = (math.radians(32.0), math.radians(-18.0), math.radians(-42.0))
    sun.data.angle = math.radians(5.0)

    camera_data = bpy.data.cameras.new("TC_Camera")
    camera = bpy.data.objects.new("TC_Camera", camera_data)
    PREVIEW.objects.link(camera)
    camera.location = (13.8, -23.5, 10.4)
    camera_data.lens = 56.0
    point_at(camera, (0.0, -1.2, 6.5))
    camera["preview_only"] = True
    scene.camera = camera
    return camera


def render_atomic(path: Path) -> None:
    staging = path.with_name(f"{path.stem}.exporting{path.suffix}")
    staging.unlink(missing_ok=True)
    bpy.context.scene.render.filepath = str(staging)
    bpy.ops.render.render(write_still=True)
    for attempt in range(10):
        try:
            staging.replace(path)
            return
        except PermissionError:
            if attempt == 9:
                raise
            time.sleep(0.20)


def render_views(camera: bpy.types.Object) -> None:
    camera.data.type = "PERSP"
    camera.data.lens = 62.0
    camera.location = (0.0, -29.0, 8.0)
    point_at(camera, (0.0, -2.2, 6.8))
    render_atomic(OUT_FRONT)
    camera.data.lens = 56.0
    camera.location = (13.8, -23.5, 10.4)
    point_at(camera, (0.0, -1.2, 6.5))
    render_atomic(OUT_HERO)
    camera.data.lens = 58.0
    camera.location = (-14.0, 20.0, 10.0)
    point_at(camera, (0.0, 0.8, 6.2))
    render_atomic(OUT_REAR)
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 17.4
    camera.location = (27.0, 0.4, 8.7)
    point_at(camera, (0.0, 0.4, 6.8))
    render_atomic(OUT_SIDE)
    camera.data.type = "PERSP"
    camera.data.lens = 72.0
    camera.location = (11.8, -9.0, 10.7)
    point_at(camera, (0.0, TOWER_CENTRE_Y, 8.8))
    render_atomic(OUT_TOWER_DETAIL)
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 18.0
    camera.location = (24.0, -31.0, 14.0)
    point_at(camera, (0.0, -0.5, 6.5))
    render_atomic(OUT_SCALE)


def authored_mesh_bounds() -> tuple[Vector, Vector]:
    vertices = [
        obj.matrix_world @ vertex.co
        for obj in bpy.data.objects
        if obj.type == "MESH" and obj.get("tc_instance") and not obj.get("preview_only")
        for vertex in obj.data.vertices
    ]
    return (
        Vector((min(point.x for point in vertices), min(point.y for point in vertices), min(point.z for point in vertices))),
        Vector((max(point.x for point in vertices), max(point.y for point in vertices), max(point.z for point in vertices))),
    )


def write_manifest() -> None:
    min_corner, max_corner = authored_mesh_bounds()
    dimensions = max_corner - min_corner
    payload = {
        "id": "gorski-tier1-church-delnice-v2",
        "authoritativeBuildingKind": "chapel",
        "developmentTier": 1,
        "displayIdentity": "Tier 1 Parish Church",
        "regionalContext": "Gorski Kotar, circa 1550 material language",
        "visualReference": {
            "building": "Church of St. John the Baptist, Delnice",
            "referenceDate": "current photographed exterior; existing church built 1825-1829",
            "adaptation": "West-front tower, flared skirt and spire, three arched portals, oculus, pale facade, stone lower work, and dark roof follow the supplied Delnice references; surfaces are adapted to the game's regional material contract.",
        },
        "dimensionsMetres": {
            "artFootprintWidth": round(dimensions.x, 4),
            "artFootprintDepth": round(dimensions.y, 4),
            "maximumHeight": round(max_corner.z, 4),
            "tier1ResidenceReferenceHeight": TIER1_RESIDENCE_HEIGHT,
            "heightRatioToTier1Residence": round(CROSS_TOP_Z / TIER1_RESIDENCE_HEIGHT, 4),
        },
        "signatureSilhouette": "A broad pale nave is dominated by a central enclosed west tower, concave flared belfry hood, steep dark spire, and iron cross.",
        "openingFit": {
            "naveLancets": "Host voids use the shared window_lancet contract and inserts share its centreline and sill.",
            "belfryLouvers": "Host voids use the shared window_domestic contract; the tower stack is lifted above the nave-roof intersection.",
            "roofClearance": "Front shoulders and rear gable are seated below the roof skins to prevent diagonal flashing and z-fighting.",
        },
        "runtimeOwnedState": {
            "clock": "The GLB exports only TC_Clock_Anchor; Three.js creates the clock face and hands and drives them from the simulation clock.",
            "bellAudioAndMotion": "Runtime-owned; no baked animation.",
            "vegetationAndPeople": "Excluded; SeedThree and settlement simulation own these layers.",
        },
        "atlas": {
            "id": texture_helper.ATLAS_MANIFEST["id"],
            "usedTiles": ["lime-plaster", "fieldstone-mortar", "rough-hewn-timber", "weathered-planks", "sawn-planks", "split-shingles", "wrought-iron", "packed-earth"],
            "packing": "R roughness, G metalness, B AO, A centered height",
            "fading": "Three named lime-plaster variants provide maintained warm limewash, broad faded exposure, and restrained damp staining without pure-white materials.",
        },
        "retopology": {
            "profile": "gameplay-v1",
            "budgetTriangles": 24000,
            "method": "Reusable authored kit bays and inserts plus low-poly closed roof/gable shells; no automatic bevel or blanket decimation.",
        },
        "placements": PLACEMENTS,
    }
    OUT_MANIFEST.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def export_glb() -> None:
    staging = OUT_GLB.with_name(f"{OUT_GLB.stem}.exporting{OUT_GLB.suffix}")
    staging.unlink(missing_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    export_objects = [obj for obj in bpy.data.objects if obj.get("tc_instance") and not obj.get("preview_only")]
    for obj in export_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = next(obj for obj in export_objects if obj.type == "MESH")
    bpy.ops.export_scene.gltf(
        filepath=str(staging),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_extras=True,
    )
    for attempt in range(12):
        try:
            staging.replace(OUT_GLB)
            return
        except PermissionError:
            if attempt == 11:
                raise
            time.sleep(0.25)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    RENDER_DIR.mkdir(parents=True, exist_ok=True)
    required = {
        "civic_church_nave_bay_plain_4m_h5p4m",
        "civic_church_nave_bay_lancet_4m_h5p4m",
        "civic_church_west_portal_bay_3m_h5p4m",
        "civic_church_tower_shaft_bay_4m_h4m",
        "civic_church_tower_belfry_bay_4m_h3p8m",
        "roof_shingle_belfry_ogee_4m",
        "roof_shingle_portal_canopy_1p7m",
        "opening_window_oculus_stone_small",
    }
    missing = sorted(required - SOURCES.keys())
    if missing:
        raise RuntimeError(f"Church build requires the extended kit components: {missing}")
    assemble_foundations()
    assemble_nave()
    assemble_tower()
    assemble_roofs()
    remove_source_library_objects()
    camera = stage_preview()
    scene = bpy.context.scene
    scene["artifact_id"] = "gorski-tier1-church-delnice-v2"
    scene["authoritative_building_kind"] = "chapel"
    scene["development_tier"] = 1
    scene["reference_building"] = "Church of St. John the Baptist, Delnice"
    scene["canonical_state"] = "fixed church shell; runtime owns clock, people, bell state, and world layers"
    scene["signature_silhouette"] = "enclosed west tower with roof-clear belfry, flared hood, and steep dark spire"
    scene["atlas_id"] = texture_helper.ATLAS_MANIFEST["id"]
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    write_manifest()
    export_glb()
    render_views(camera)
    print(f"TC_BLEND={OUT_BLEND}")
    print(f"TC_GLB={OUT_GLB}")
    print(f"TC_FRONT={OUT_FRONT}")
    print(f"TC_HERO={OUT_HERO}")
    print(f"TC_PLACEMENTS={len(PLACEMENTS)}")


if __name__ == "__main__":
    main()
