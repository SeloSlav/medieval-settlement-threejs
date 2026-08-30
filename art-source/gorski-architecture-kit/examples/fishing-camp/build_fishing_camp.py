from __future__ import annotations

import importlib.util
import json
import math
import os
from pathlib import Path
import random
import time

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[4]
EXAMPLE_DIR = Path(__file__).resolve().parent
OUTPUT_ROOT = Path(os.environ.get("GK_FISHING_CAMP_OUTPUT_ROOT", str(EXAMPLE_DIR))).resolve()
OUT_DIR = OUTPUT_ROOT / "out"
RENDER_DIR = OUTPUT_ROOT / "renders"
OUT_BLEND = OUT_DIR / "fishing_camp_textured_v5.blend"
OUT_GLB = OUT_DIR / "fishing_camp_textured_v5.glb"
OUT_MANIFEST = OUT_DIR / "fishing_camp_assembly_v5.json"
OUT_HERO = RENDER_DIR / "fishing_camp_hero_v5.png"
OUT_OVERHEAD = RENDER_DIR / "fishing_camp_overhead_v5.png"
OUT_WORKYARD = RENDER_DIR / "fishing_camp_workyard_v5.png"
OUT_BOAT = RENDER_DIR / "fishing_camp_boat_detail_v5.png"
OUT_REAR = RENDER_DIR / "fishing_camp_rear_v5.png"


# Assembly-specific fit contract. The kit's 0.24 m verge is nominal; these
# small, settled roofs need a little more cover because the reusable posts
# include proud peg geometry at their public faces. The wider yard setbacks
# reserve a genuine service aisle for fixed props and runtime fish stock.
ROOF_VERGE_OVERHANG = 0.34
ROOF_RIDGE_LIFT = 0.24
FRAME_FACE_INSET = 0.08
FRAME_POST_FOOT_SINK = 0.05
MAIN_SIDE_PLATE_DROP = 0.23
# At this height the three authored collar fractions span the full interior
# width of the 50-degree gable and terminate against both rake frames.
MAIN_GABLE_COLLAR_Z_OFFSET = 0.5 * math.tan(math.radians(50.0))
RUNTIME_INVENTORY_ZONE = {
    "x": 4.15,
    "yStart": 1.50,
    "yStep": 0.55,
    "segments": 3,
}


# Reuse the proven production-atlas/glTF baking helper from the neighbouring
# authored camp example. This keeps both camp assets on one texture contract
# without copying a second shader implementation into the repository.
HELPER_PATH = EXAMPLE_DIR.parent / "hunters-camp" / "build_hunters_camp.py"
helper_spec = importlib.util.spec_from_file_location("gorski_camp_texture_helper", HELPER_PATH)
if helper_spec is None or helper_spec.loader is None:
    raise RuntimeError(f"Could not load authored-camp texture helper: {HELPER_PATH}")
texture_helper = importlib.util.module_from_spec(helper_spec)
helper_spec.loader.exec_module(texture_helper)


SOURCES = {str(obj["gk_id"]): obj for obj in bpy.data.objects if obj.get("gk_id")}
PLACEMENTS: list[dict[str, object]] = []


def collection(name: str) -> bpy.types.Collection:
    current = bpy.data.collections.get(name)
    if current is None:
        current = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(current)
    return current


MAIN_HOUSE = collection("FC_01_Main_Fish_House")
SERVICE_SHED = collection("FC_02_Service_Shed")
ROOFS = collection("FC_03_Roofs")
WORKYARD = collection("FC_04_Drying_And_Work")
BOAT = collection("FC_05_Boat")
ENCLOSURE = collection("FC_06_Enclosure")
EQUIPMENT = collection("FC_07_Equipment")
PREVIEW = collection("FC_90_Preview_Staging")


texture_helper.MATERIAL_LOOKS.update({
    "limewash": ("lime-plaster", (0.66, 0.59, 0.45, 1.0), 0.42, 0.70),
    "limewash_grey": ("lime-plaster", (0.49, 0.48, 0.40, 1.0), 0.55, 0.66),
    "limestone_warm": ("fieldstone-mortar", (0.48, 0.43, 0.34, 1.0), 0.64, 0.78),
    "fieldstone_weathered": ("fieldstone-mortar", (0.30, 0.255, 0.20, 1.0), 0.82, 0.86),
    "fieldstone": ("fieldstone-mortar", (0.30, 0.31, 0.27, 1.0), 0.82, 0.88),
    "oak_dark": ("rough-hewn-timber", (0.13, 0.068, 0.029, 1.0), 0.88, 0.76),
    "timber_weathered": ("weathered-planks", (0.29, 0.18, 0.085, 1.0), 0.76, 0.78),
    "timber_cut": ("sawn-planks", (0.45, 0.27, 0.12, 1.0), 0.58, 0.68),
    "shingles": ("split-shingles", (0.12, 0.058, 0.022, 1.0), 0.96, 0.86),
    "shingles_aged": ("split-shingles", (0.075, 0.048, 0.030, 1.0), 0.98, 0.84),
    "shingles_light": ("split-shingles", (0.19, 0.105, 0.043, 1.0), 0.90, 0.82),
    "fence_dark": ("rough-hewn-timber", (0.16, 0.095, 0.040, 1.0), 0.88, 0.72),
    "fence_cut": ("rough-hewn-timber", (0.24, 0.145, 0.065, 1.0), 0.76, 0.70),
    "boat_hull": ("weathered-planks", (0.22, 0.125, 0.050, 1.0), 0.88, 0.78),
    "boat_rim": ("rough-hewn-timber", (0.095, 0.045, 0.017, 1.0), 0.94, 0.76),
    "boat_cut": ("sawn-planks", (0.34, 0.19, 0.075, 1.0), 0.72, 0.66),
    "rope": ("wicker-weave", (0.40, 0.28, 0.14, 1.0), 0.56, 0.66),
    "leather": ("linen-canvas", (0.29, 0.25, 0.19, 1.0), 0.76, 0.42),
    "packed_earth": ("packed-earth", (0.27, 0.21, 0.15, 1.0), 0.46, 0.56),
    "packed_earth_dark": ("packed-earth", (0.12, 0.14, 0.12, 1.0), 0.82, 0.50),
})


def dark_glass_material() -> bpy.types.Material:
    name = "FC_Dark_Unglazed_Window"
    existing = bpy.data.materials.get(name)
    if existing is not None:
        return existing
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    material.diffuse_color = (0.035, 0.045, 0.038, 1.0)
    material["surface_role"] = "dark-window-void"
    material["gltf_export_safe"] = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    if bsdf is not None:
        bsdf.inputs["Base Color"].default_value = material.diffuse_color
        bsdf.inputs["Roughness"].default_value = 0.98
        bsdf.inputs["Metallic"].default_value = 0.0
    return material


def remap_materials(obj: bpy.types.Object, part_id: str) -> None:
    if obj.type != "MESH":
        return
    source_keys = [
        old.name.removeprefix("GK_Mat_") if old is not None else "timber_cut"
        for old in obj.data.materials
    ]
    bake_keys = list(source_keys)
    if part_id.startswith("enclosure_"):
        bake_keys = [
            "fence_dark" if key == "timber_weathered" else "fence_cut" if key == "timber_cut" else key
            for key in bake_keys
        ]
    elif part_id == "foundation_steps_limestone_1":
        bake_keys = ["fieldstone_weathered" if key == "limestone_warm" else key for key in bake_keys]
    elif part_id == "prop_boat_dugout":
        bake_keys = [
            "boat_hull" if key == "timber_weathered" else "boat_rim" if key == "oak_dark" else "boat_cut" if key == "timber_cut" else key
            for key in bake_keys
        ]
    texture_helper.bake_atlas_uvs(obj, bake_keys)
    for index, key in enumerate(bake_keys):
        obj.data.materials[index] = dark_glass_material() if key == "glass" else texture_helper.atlas_material(key)


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
    obj["fc_instance"] = True
    obj["fc_retopology_profile"] = "gameplay-v1; authored topology; no export bevel"
    obj["source_component_id"] = part_id
    obj["assembly_role"] = target.name
    target.objects.link(obj)
    texture_helper.phase_metric_uvs(obj, location, rotation[2])
    remap_materials(obj, part_id)
    PLACEMENTS.append({
        "name": name,
        "source": part_id,
        "collection": target.name,
        "location": [round(value, 5) for value in location],
        "rotationDegrees": [round(math.degrees(value), 4) for value in rotation],
    })
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
    obj["fc_instance"] = True
    obj["fc_retopology_profile"] = "gameplay-v1; authored closed low-poly shell"
    obj["source_component_id"] = source_id
    obj["assembly_role"] = target.name
    PLACEMENTS.append({
        "name": name,
        "source": source_id,
        "collection": target.name,
        "location": [0.0, 0.0, 0.0],
        "rotationDegrees": [0.0, 0.0, 0.0],
    })
    return obj


def roof_skin(
    name: str,
    centre_x: float,
    front_y: float,
    rear_y: float,
    half_width: float,
    wall_top: float,
    side: float,
    material_key: str,
) -> bpy.types.Object:
    pitch = math.radians(50.0)
    # The gable modules include a 0.16 m sloping oak edge beam. The roof skin
    # must cover that structural member, not share its centreline. Lifting the
    # ridge restores an approximately 50-degree exterior pitch once the eave
    # overhang is included and keeps the shingles outside the timber envelope.
    ridge_z = wall_top + half_width * math.tan(pitch) + ROOF_RIDGE_LIFT
    ridge_x = centre_x
    eave_x_base = centre_x + side * (half_width + 0.32)
    stations = (
        front_y - ROOF_VERGE_OVERHANG,
        front_y + 0.78,
        (front_y + rear_y) * 0.5,
        rear_y - 0.74,
        rear_y + ROOF_VERGE_OVERHANG,
    )
    sag = (0.0, -0.018, -0.045, -0.024, -0.006)
    eave_wander = (0.015, -0.024, 0.012, -0.018, 0.025)
    top: list[tuple[float, float, float]] = []
    for index, y in enumerate(stations):
        ridge_point = (ridge_x, y, ridge_z + sag[index] * 0.55)
        eave_point = (eave_x_base + side * eave_wander[index], y, wall_top - 0.055 + sag[index])
        mid_point = (
            (ridge_point[0] + eave_point[0]) * 0.5,
            y,
            (ridge_point[2] + eave_point[2]) * 0.5,
        )
        # A midpoint is topologically cheap and keeps every face below the
        # 2.2 m shingle-atlas repeat, preventing a full slope from stretching
        # one tile into broad plank-like bands after glTF-safe UV baking.
        top.extend((ridge_point, mid_point, eave_point))
    thickness = 0.085
    vertices = top + [(x, y, z - thickness) for x, y, z in top]
    faces: list[tuple[int, ...]] = []
    for index in range(len(stations) - 1):
        for band in range(2):
            start = index * 3 + band
            following = (index + 1) * 3 + band
            faces.append((start, following, following + 1, start + 1))
            faces.append((start + 15, start + 16, following + 16, following + 15))
    faces.extend([
        (0, 15, 16, 17, 2, 1),
        (12, 13, 14, 29, 28, 27),
    ])
    for index in range(len(stations) - 1):
        ridge = index * 3
        next_ridge = (index + 1) * 3
        eave = ridge + 2
        next_eave = next_ridge + 2
        faces.append((ridge, next_ridge, next_ridge + 15, ridge + 15))
        faces.append((eave, eave + 15, next_eave + 15, next_eave))
    return custom_mesh(name, vertices, faces, material_key, ROOFS, "assembly_custom_settled_shingle_skin")


def assemble_main_house() -> None:
    cx = 1.30
    front = -0.80
    rear = 3.20
    base = 0.35
    wall_top = base + 2.70
    for label, x, y, rz in (
        ("Front", cx, front, 0.0),
        ("Rear", cx, rear, math.pi),
        ("Left", cx - 2.0, (front + rear) * 0.5, -math.pi * 0.5),
        ("Right", cx + 2.0, (front + rear) * 0.5, math.pi * 0.5),
    ):
        place("foundation_fieldstone_4m_h0p35m", f"FC_Main_Foundation_{label}", MAIN_HOUSE, (x, y, 0.0), (0.0, 0.0, rz))

    place("wall_limewash_2m_door_service_host", "FC_Main_Front_Door_Host", MAIN_HOUSE, (cx - 1.0, front, base))
    place("wall_limewash_2m_window_small_host", "FC_Main_Front_Window_Host", MAIN_HOUSE, (cx + 1.0, front, base))
    place("wall_plank_4m_h2p7m", "FC_Main_Rear_Plank_Wall", MAIN_HOUSE, (cx, rear, base), (0.0, 0.0, math.pi))
    place("wall_plank_4m_h2p7m", "FC_Main_Left_Plank_Wall", MAIN_HOUSE, (cx - 2.0, (front + rear) * 0.5, base), (0.0, 0.0, -math.pi * 0.5))
    place("wall_plank_4m_h2p7m", "FC_Main_Right_Plank_Wall", MAIN_HOUSE, (cx + 2.0, (front + rear) * 0.5, base), (0.0, 0.0, math.pi * 0.5))
    place("opening_door_service_single", "FC_Main_Service_Door", MAIN_HOUSE, (cx - 1.0, front - 0.105, base))
    place("foundation_steps_limestone_1", "FC_Main_Door_Stone_Step", MAIN_HOUSE, (cx - 1.0, front - 0.56, 0.0))
    place("opening_window_small_shuttered", "FC_Main_Shuttered_Window", MAIN_HOUSE, (cx + 1.0, front - 0.105, base))
    place("gable_infill_timber_4m", "FC_Main_Front_Gable", MAIN_HOUSE, (cx, front - 0.01, wall_top - 0.06))
    place("gable_infill_timber_4m", "FC_Main_Rear_Gable", MAIN_HOUSE, (cx, rear + 0.01, wall_top - 0.06), (0.0, 0.0, math.pi))

    for face, y, rz in (("Front", front - FRAME_FACE_INSET, 0.0), ("Rear", rear + FRAME_FACE_INSET, math.pi)):
        place("frame_beam_4m_s0p16m", f"FC_Main_{face}_Sill", MAIN_HOUSE, (cx, y, base), (0.0, 0.0, rz))
        place("frame_beam_4m_s0p16m", f"FC_Main_{face}_Wall_Plate", MAIN_HOUSE, (cx, y, wall_top - 0.15), (0.0, 0.0, rz))
        for index, x in enumerate((cx - 2.0, cx, cx + 2.0)):
            place("frame_post_h2p7m_s0p16m", f"FC_Main_{face}_Post_{index + 1}", MAIN_HOUSE, (x, y, base - FRAME_POST_FOOT_SINK), (0.0, 0.0, rz))
        # The reusable king post includes proud peg geometry. Sink it into the
        # wall frame and keep the collar well below the shingle underside so
        # neither can emerge through the settled ridge or verge.
        place("frame_post_h2p4m_s0p16m", f"FC_Main_{face}_Gable_King_Post", MAIN_HOUSE, (cx, y, wall_top - 0.45), (0.0, 0.0, rz))
        # A 2 m collar stopped visibly short inside the 4 m gable. Three
        # canonical authored fractions form a 3 m collar at the height where
        # the sloping gable edges are 3.06 m apart, so the structural member
        # meets both rake frames without scaling or penetrating the shingles.
        collar_z = wall_top + MAIN_GABLE_COLLAR_Z_OFFSET
        place("frame_beam_2m_s0p16m", f"FC_Main_{face}_Gable_Collar_Centre", MAIN_HOUSE, (cx, y, collar_z), (0.0, 0.0, rz))
        for side, offset in (("Left", -1.25), ("Right", 1.25)):
            place("frame_beam_0p5m_s0p16m", f"FC_Main_{face}_Gable_Collar_{side}", MAIN_HOUSE, (cx + offset, y, collar_z), (0.0, 0.0, rz))
    for label, x, rz in (("Left", cx - 2.115, -math.pi * 0.5), ("Right", cx + 2.115, math.pi * 0.5)):
        place("frame_beam_4m_s0p16m", f"FC_Main_{label}_Wall_Plate", MAIN_HOUSE, (x, (front + rear) * 0.5, wall_top - MAIN_SIDE_PLATE_DROP), (0.0, 0.0, rz))

    roof_skin("FC_Main_Roof_Left", cx, front, rear, 2.0, wall_top, -1.0, "shingles_aged")
    roof_skin("FC_Main_Roof_Right", cx, front, rear, 2.0, wall_top, 1.0, "shingles")


def assemble_service_shed() -> None:
    cx = -3.05
    front = 0.15
    rear = 2.15
    base = 0.35
    wall_top = base + 2.70
    for label, x, y, rz in (
        ("Front", cx, front, 0.0),
        ("Rear", cx, rear, math.pi),
        ("Left", cx - 1.0, (front + rear) * 0.5, -math.pi * 0.5),
        ("Right", cx + 1.0, (front + rear) * 0.5, math.pi * 0.5),
    ):
        place("foundation_fieldstone_2m_h0p35m", f"FC_Shed_Foundation_{label}", SERVICE_SHED, (x, y, 0.0), (0.0, 0.0, rz))
    place("wall_plank_2m_door_service_host", "FC_Shed_Front_Door_Host", SERVICE_SHED, (cx, front, base))
    for label, x, y, rz in (
        ("Rear", cx, rear, math.pi),
        ("Left", cx - 1.0, (front + rear) * 0.5, -math.pi * 0.5),
        ("Right", cx + 1.0, (front + rear) * 0.5, math.pi * 0.5),
    ):
        place("wall_plank_2m_h2p7m", f"FC_Shed_{label}_Wall", SERVICE_SHED, (x, y, base), (0.0, 0.0, rz))
    place("opening_door_service_single", "FC_Shed_Service_Door", SERVICE_SHED, (cx, front - 0.105, base))
    place("foundation_steps_limestone_1", "FC_Shed_Door_Stone_Step", SERVICE_SHED, (cx, front - 0.56, 0.0))
    place("gable_infill_timber_2m", "FC_Shed_Front_Gable", SERVICE_SHED, (cx, front - 0.01, wall_top - 0.06))
    place("gable_infill_timber_2m", "FC_Shed_Rear_Gable", SERVICE_SHED, (cx, rear + 0.01, wall_top - 0.06), (0.0, 0.0, math.pi))
    for face, y, rz in (("Front", front - FRAME_FACE_INSET, 0.0), ("Rear", rear + FRAME_FACE_INSET, math.pi)):
        place("frame_beam_2m_s0p16m", f"FC_Shed_{face}_Wall_Plate", SERVICE_SHED, (cx, y, wall_top - 0.15), (0.0, 0.0, rz))
        for side, x in (("Left", cx - 1.0), ("Right", cx + 1.0)):
            place("frame_post_h2p7m_s0p16m", f"FC_Shed_{face}_{side}_Post", SERVICE_SHED, (x, y, base - FRAME_POST_FOOT_SINK), (0.0, 0.0, rz))
    roof_skin("FC_Shed_Roof_Left", cx, front, rear, 1.0, wall_top, -1.0, "shingles_aged")
    roof_skin("FC_Shed_Roof_Right", cx, front, rear, 1.0, wall_top, 1.0, "shingles_light")


def assemble_workyard() -> None:
    # The drying station occupies the east front-side aisle, rotated across
    # the facade so its narrow depth faces the building. Both door approach
    # rectangles remain completely clear, and the paired wash buckets stay
    # visibly attached to the station instead of drifting into an entrance.
    place("prop_fish_drying_rack", "FC_Fish_Drying_Rack", WORKYARD, (4.55, -1.55, 0.0), (0.0, 0.0, math.radians(90.0)))
    # A continuous rear-and-side boundary encloses only the private back yard.
    # It remains well outside both building envelopes and leaves the entire
    # road-facing front open for workers, carts, and the two door approaches.
    for part_id, name, location, rotation in (
        ("enclosure_split_rail_4m", "FC_Fence_Rear_West", (-3.05, 4.45, 0.0), (0.0, 0.0, 0.0)),
        ("enclosure_split_rail_4m", "FC_Fence_Rear_Centre", (1.10, 4.45, 0.0), (0.0, 0.0, 0.0)),
        ("enclosure_split_rail_2m", "FC_Fence_Rear_East", (4.15, 4.45, 0.0), (0.0, 0.0, 0.0)),
        ("enclosure_split_rail_4m", "FC_Fence_West", (-5.15, 2.35, 0.0), (0.0, 0.0, math.radians(90.0))),
        ("enclosure_split_rail_4m", "FC_Fence_East", (5.07, 2.35, 0.0), (0.0, 0.0, math.radians(90.0))),
    ):
        place(part_id, name, ENCLOSURE, location, rotation)

    # The dugout has two real supports: its lower hull bears on grade while
    # the upper gunwale contacts the rear-west rail. The 45-degree lean and
    # 0.32 m lift are the previously validated contact pose, not a floating
    # display transform.
    boat = place(
        "prop_boat_dugout",
        "FC_Leaning_River_Dugout",
        BOAT,
        (-2.95, 4.29, 0.32),
        (math.radians(45.0), 0.0, math.radians(-2.0)),
    )
    boat["signature_silhouette"] = "hollow double-ended dugout grounded below and braced against the rear-west split rail"
    place("prop_barrel_small", "FC_Brine_Barrel", EQUIPMENT, (4.15, -0.25, 0.0), (0.0, 0.0, math.radians(-8.0)))
    place("prop_crate_small", "FC_Net_And_Cord_Crate", EQUIPMENT, (4.15, 0.55, 0.0), (0.0, 0.0, math.radians(11.0)))
    place("prop_water_bucket_pair", "FC_Wash_Buckets", EQUIPMENT, (4.55, -2.95, 0.0), (0.0, 0.0, math.radians(4.0)))


def remove_source_library_objects() -> None:
    for obj in list(bpy.data.objects):
        if not obj.get("fc_instance"):
            bpy.data.objects.remove(obj, do_unlink=True)
    for source_collection in list(bpy.data.collections):
        if source_collection.name.startswith(("GK_", "HC_")) and not source_collection.objects and not source_collection.children:
            bpy.data.collections.remove(source_collection)


def link_preview(obj: bpy.types.Object) -> None:
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    PREVIEW.objects.link(obj)
    obj["preview_only"] = True


def add_ground() -> None:
    randomizer = random.Random(1550)
    count = 72
    vertices = [(0.0, 0.25, -0.018)]
    for index in range(count):
        angle = math.tau * index / count
        radius_x = 5.75 + randomizer.uniform(-0.25, 0.28)
        radius_y = 4.65 + randomizer.uniform(-0.24, 0.32)
        vertices.append((radius_x * math.cos(angle), 0.25 + radius_y * math.sin(angle), -0.018))
    faces = [(0, index + 1, ((index + 1) % count) + 1) for index in range(count)]
    mesh = bpy.data.meshes.new("FC_Preview_Workyard_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update(calc_edges=True)
    add_metric_uv_layer(mesh)
    patch = bpy.data.objects.new("FC_Preview_Packed_Earth_Workyard", mesh)
    PREVIEW.objects.link(patch)
    texture_helper.bake_atlas_uvs(patch, ["packed_earth"])
    patch.data.materials.append(texture_helper.atlas_material("packed_earth"))
    patch["preview_only"] = True

    bpy.ops.mesh.primitive_plane_add(size=34.0, location=(0.0, 0.0, -0.035))
    outer = bpy.context.object
    outer.name = "FC_Preview_Neutral_Ground"
    outer.data.uv_layers.active.name = "GK_UV0"
    for uv in outer.data.uv_layers.active.data:
        uv.uv *= 34.0
    texture_helper.bake_atlas_uvs(outer, ["packed_earth_dark"])
    outer.data.materials.append(texture_helper.atlas_material("packed_earth_dark"))
    link_preview(outer)


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
    add_ground()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1800
    scene.render.resolution_y = 1200
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    scene.view_settings.exposure = -0.42
    if scene.world is None:
        scene.world = bpy.data.worlds.new("FC_Preview_World")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.025, 0.045, 0.052, 1.0)
    background.inputs["Strength"].default_value = 0.30

    key = add_light("FC_Key", "AREA", (-7.0, -8.0, 12.0), 1050.0, (0.90, 0.94, 1.0), 8.0)
    point_at(key, (0.0, 0.5, 1.5))
    fill = add_light("FC_Fill", "AREA", (8.0, -1.0, 7.0), 420.0, (0.56, 0.68, 1.0), 6.0)
    point_at(fill, (0.6, 0.8, 1.4))
    rim = add_light("FC_Rim", "AREA", (-5.0, 8.0, 9.0), 620.0, (1.0, 0.80, 0.58), 5.0)
    point_at(rim, (-0.4, 1.4, 1.6))
    sun = add_light("FC_Sun", "SUN", (0.0, 0.0, 10.0), 1.15, (1.0, 0.91, 0.76))
    sun.rotation_euler = (math.radians(28.0), math.radians(-14.0), math.radians(-38.0))
    sun.data.angle = math.radians(6.0)

    camera_data = bpy.data.cameras.new("FC_Hero_Camera")
    camera = bpy.data.objects.new("FC_Hero_Camera", camera_data)
    PREVIEW.objects.link(camera)
    camera.location = (11.7, -14.8, 8.3)
    camera_data.lens = 58.0
    point_at(camera, (-0.05, 0.35, 1.55))
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
    render_atomic(OUT_HERO)
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 12.8
    camera.location = (0.0, 0.5, 18.0)
    point_at(camera, (0.0, 0.5, 0.0))
    render_atomic(OUT_OVERHEAD)
    camera.data.type = "PERSP"
    camera.data.lens = 62.0
    camera.location = (-10.8, -12.0, 6.4)
    point_at(camera, (-0.2, -0.25, 1.35))
    render_atomic(OUT_WORKYARD)
    camera.data.lens = 68.0
    camera.location = (-8.5, 8.2, 4.8)
    point_at(camera, (-2.45, 3.30, 0.98))
    render_atomic(OUT_BOAT)
    camera.data.lens = 60.0
    camera.location = (-10.6, 10.4, 6.6)
    point_at(camera, (0.2, 1.35, 1.65))
    render_atomic(OUT_REAR)


def write_manifest() -> None:
    fixed_objects = [obj for obj in bpy.data.objects if obj.get("fc_instance") and not obj.get("preview_only")]
    fixed_points = [obj.matrix_world @ vertex.co for obj in fixed_objects for vertex in obj.data.vertices]
    minimum = Vector((min(point.x for point in fixed_points), min(point.y for point in fixed_points), min(point.z for point in fixed_points)))
    maximum = Vector((max(point.x for point in fixed_points), max(point.y for point in fixed_points), max(point.z for point in fixed_points)))
    dimensions = maximum - minimum
    payload = {
        "id": "gorski-fishing-camp-atlas-preview-v5",
        "revision": 5,
        "authoritativeBuildingKind": "fishing_camp",
        "displayIdentity": "Fishing Camp",
        "regionalContext": "Gorski Kotar, circa 1550",
        "sourceKit": "gorski-architecture-kit-1.1.0",
        "dimensionsMetres": {
            "artFootprintWidth": round(dimensions.x, 4),
            "artFootprintDepth": round(dimensions.y, 4),
            "maximumHeight": round(maximum.z, 4),
        },
        "designIntent": "A compact two-building inland fishery whose main house inherits Tier-1 construction while the smaller plank shed and fenced rear work yard remain visibly utilitarian.",
        "signatureSilhouette": "A hollow double-ended river dugout is grounded and leans against the rear-west split-rail fence.",
        "construction": {
            "mainHouse": "Four-metre bay, low irregular fieldstone footing, warm restrained limewash public face, weathered plank private walls, dark oak posts and plates, timber gables, and a settled 50-degree split-shingle roof with 0.32 m eaves and 0.34 m protective verges.",
            "serviceShed": "Two-metre plank outbuilding on the same low rubble footing, with a service door and smaller 50-degree split-shingle roof.",
            "yard": "Open road frontage with a continuous, generously offset split-rail boundary around the rear and sides; the east-side drying frame, wash buckets, brine barrel, and cord crate retain clear service aisles.",
            "thresholds": "Each service door has the same single weathered stone-block step used by the Tier-1 residence.",
        },
        "atlas": {
            "id": texture_helper.ATLAS_MANIFEST["id"],
            "usedTiles": ["lime-plaster", "fieldstone-mortar", "rough-hewn-timber", "weathered-planks", "sawn-planks", "split-shingles", "wrought-iron", "packed-earth"],
            "packing": "R roughness, G metalness, B AO, A centered height",
        },
        "historicalMaterialDecision": {
            "walling": "Warm, smoke- and rain-muted limewash is limited to the main public facade; rough plank boarding dominates private and service elevations.",
            "timber": "Structural oak is nearly black-brown, while replaceable boards and the dugout use warmer weathered fir/oak tones.",
            "roofing": "Hand-split fir/pine shingles stay dark and uneven rather than reading as pale canvas or modern boards.",
            "boat": "A small hollow double-ended river dugout with gunwales, keel, ribs, removable thwarts, and a connected paddle has credible lower-hull ground bearing and upper-gunwale contact against the rear-west rail.",
            "dryingRack": "An intentionally empty splayed sapling frame provides a clean attachment point for separately authored catch models.",
        },
        "canonicalState": "Neutral fixed fishery architecture with an empty drying rack; separate catch models and runtime stock baskets remain state-owned.",
        "runtimeOwnedState": {
            "freshCatchAndInventory": "Not baked into the GLB; food-stockpile visuals own current stored fish.",
            "waterAndVegetation": "Not baked into the GLB; terrain/water and SeedThree own their world layers.",
            "workersAndAnimation": "No characters, active nets, smoke, or animated props are included.",
        },
        "runtimeInventoryZoneBlender": RUNTIME_INVENTORY_ZONE,
        "retopology": {
            "profile": "gameplay-v1",
            "method": "Reusable kit modules plus two closed low-poly roof skins; no blanket export bevel or automatic decimation.",
        },
        "placements": PLACEMENTS,
    }
    OUT_MANIFEST.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def export_glb() -> None:
    staging = OUT_GLB.with_name(f"{OUT_GLB.stem}.exporting{OUT_GLB.suffix}")
    staging.unlink(missing_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    export_objects = [obj for obj in bpy.data.objects if obj.get("fc_instance") and not obj.get("preview_only")]
    for obj in export_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = export_objects[0]
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
    assemble_main_house()
    assemble_service_shed()
    assemble_workyard()
    remove_source_library_objects()
    camera = stage_preview()
    scene = bpy.context.scene
    scene["artifact_id"] = "gorski-fishing-camp-atlas-preview-v5"
    scene["authoritative_building_kind"] = "fishing_camp"
    scene["architecture_context"] = "Gorski Kotar, circa 1550"
    scene["canonical_state"] = "neutral fixed fishery; runtime owns fresh catch, inventory, workers, and world layers"
    scene["signature_silhouette"] = "hollow dugout grounded below and leaning against the rear-west split-rail boundary"
    scene["atlas_id"] = texture_helper.ATLAS_MANIFEST["id"]
    scene["living_vegetation"] = "excluded; SeedThree-owned"
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    write_manifest()
    export_glb()
    render_views(camera)
    print(f"FC_BLEND={OUT_BLEND}")
    print(f"FC_GLB={OUT_GLB}")
    print(f"FC_HERO={OUT_HERO}")
    print(f"FC_OVERHEAD={OUT_OVERHEAD}")
    print(f"FC_PLACEMENTS={len(PLACEMENTS)}")


if __name__ == "__main__":
    main()
