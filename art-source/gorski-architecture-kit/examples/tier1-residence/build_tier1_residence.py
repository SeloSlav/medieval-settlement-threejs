from __future__ import annotations

import json
import math
from pathlib import Path

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[4]
EXAMPLE_DIR = Path(__file__).resolve().parent
OUT_DIR = EXAMPLE_DIR / "out"
RENDER_DIR = EXAMPLE_DIR / "renders"
ATLAS_DIR = ROOT / "public" / "assets" / "textures" / "buildings" / "gorski_building_atlas_v1"
OUT_BLEND = OUT_DIR / "tier1_residence_textured.blend"
OUT_MANIFEST = OUT_DIR / "tier1_residence_assembly.json"
OUT_RENDER = RENDER_DIR / "tier1_residence_hero.png"

WALL_BASE_Z = 0.35
WALL_TOP_Z = 3.05
RIDGE_Z = 5.82
BUILDING_DEPTH = 6.0
PITCH = math.radians(50.0)
SLOPE_MAX = 1.8


def source_objects() -> dict[str, bpy.types.Object]:
    result: dict[str, bpy.types.Object] = {}
    for obj in bpy.data.objects:
        part_id = obj.get("gk_id")
        if part_id:
            result[str(part_id)] = obj
    return result


SOURCES = source_objects()
PLACEMENTS: list[dict[str, object]] = []


def collection(name: str) -> bpy.types.Collection:
    current = bpy.data.collections.get(name)
    if current is not None:
        return current
    current = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(current)
    return current


FOUNDATION = collection("T1_01_Foundation")
WALLS = collection("T1_02_Walls")
OPENINGS = collection("T1_03_Openings")
FRAMES = collection("T1_04_Frames")
ROOF = collection("T1_05_Roof")
PROPS = collection("T1_06_Props")
PREVIEW = collection("T1_90_Preview_Staging")


ATLAS_MANIFEST = json.loads((ATLAS_DIR / "manifest.json").read_text(encoding="utf-8"))
ATLAS_TILES = {tile["id"]: tile for tile in ATLAS_MANIFEST["tiles"]}
ATLAS_IMAGES = {
    "albedo": bpy.data.images.load(str(ATLAS_DIR / "building_albedo_atlas.png"), check_existing=True),
    "normal": bpy.data.images.load(str(ATLAS_DIR / "building_normal_atlas.png"), check_existing=True),
    "material": bpy.data.images.load(str(ATLAS_DIR / "building_material_atlas.png"), check_existing=True),
}
ATLAS_IMAGES["albedo"].colorspace_settings.name = "sRGB"
ATLAS_IMAGES["normal"].colorspace_settings.name = "Non-Color"
ATLAS_IMAGES["material"].colorspace_settings.name = "Non-Color"


MATERIAL_LOOKS = {
    "limewash": ("lime-plaster", (0.70, 0.52, 0.30, 1.0), 0.45, 0.48),
    "limewash_ochre": ("lime-plaster", (0.64, 0.42, 0.22, 1.0), 0.43, 0.48),
    "limewash_grey": ("lime-plaster", (0.60, 0.60, 0.53, 1.0), 0.30, 0.48),
    "fieldstone": ("fieldstone-mortar", (0.56, 0.50, 0.40, 1.0), 0.45, 0.72),
    "quarry_stone": ("quarry-stone", (0.68, 0.67, 0.61, 1.0), 0.16, 0.72),
    "limestone_warm": ("limestone-ashlar", (0.86, 0.76, 0.56, 1.0), 0.18, 0.68),
    "oak_dark": ("rough-hewn-timber", (0.25, 0.13, 0.058, 1.0), 0.65, 0.62),
    "timber_weathered": ("weathered-planks", (0.66, 0.49, 0.31, 1.0), 0.28, 0.66),
    "timber_cut": ("sawn-planks", (0.78, 0.54, 0.29, 1.0), 0.22, 0.56),
    "thatch_dark": ("thatch-roof", (0.42, 0.28, 0.10, 1.0), 0.72, 0.78),
    "thatch": ("thatch-roof", (0.74, 0.52, 0.17, 1.0), 0.62, 0.78),
    "thatch_light": ("thatch-roof", (0.88, 0.68, 0.28, 1.0), 0.55, 0.78),
    "rope": ("wicker-weave", (0.67, 0.46, 0.22, 1.0), 0.30, 0.58),
    "iron": ("wrought-iron", (0.40, 0.43, 0.44, 1.0), 0.22, 0.54),
    "charcoal": ("wrought-iron", (0.08, 0.075, 0.065, 1.0), 0.70, 0.42),
    "packed_earth": ("packed-earth", (0.43, 0.35, 0.27, 1.0), 0.52, 0.52),
}


def atlas_material(key: str) -> bpy.types.Material:
    if key == "glass":
        return glass_material()
    material_name = f"T1_Atlas_{key}"
    existing = bpy.data.materials.get(material_name)
    if existing is not None:
        return existing

    tile_id, tint, tint_strength, normal_strength = MATERIAL_LOOKS.get(
        key,
        ("rough-hewn-timber", (0.62, 0.46, 0.29, 1.0), 0.25, 0.55),
    )
    tile = ATLAS_TILES[tile_id]
    grid = ATLAS_MANIFEST["grid"]
    atlas_width = ATLAS_MANIFEST["dimensions"]["width"]
    atlas_height = ATLAS_MANIFEST["dimensions"]["height"]
    content = tile["contentPixels"]
    u_min = content["x"] / atlas_width
    v_min = 1.0 - (content["y"] + content["height"]) / atlas_height
    u_scale = content["width"] / atlas_width
    v_scale = content["height"] / atlas_height
    metres = float(tile["metersPerTile"])

    material = bpy.data.materials.new(material_name)
    material.use_nodes = True
    material.diffuse_color = tint
    material["atlas_id"] = ATLAS_MANIFEST["id"]
    material["atlas_tile"] = tile_id
    material["metres_per_tile"] = metres
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (900, 30)
    principled = nodes.new("ShaderNodeBsdfPrincipled")
    principled.location = (610, 30)
    principled.inputs["Roughness"].default_value = 0.9
    principled.inputs["Metallic"].default_value = 0.0

    uv = nodes.new("ShaderNodeUVMap")
    uv.uv_map = "GK_UV0"
    uv.location = (-1150, 100)
    metre_scale = nodes.new("ShaderNodeVectorMath")
    metre_scale.operation = "MULTIPLY"
    metre_scale.inputs[1].default_value = (1.0 / metres, 1.0 / metres, 1.0)
    metre_scale.location = (-960, 100)
    fractional = nodes.new("ShaderNodeVectorMath")
    fractional.operation = "FRACTION"
    fractional.location = (-770, 100)
    content_scale = nodes.new("ShaderNodeVectorMath")
    content_scale.operation = "MULTIPLY"
    content_scale.inputs[1].default_value = (u_scale, v_scale, 1.0)
    content_scale.location = (-580, 100)
    content_offset = nodes.new("ShaderNodeVectorMath")
    content_offset.operation = "ADD"
    content_offset.inputs[1].default_value = (u_min, v_min, 0.0)
    content_offset.location = (-390, 100)
    links.new(uv.outputs["UV"], metre_scale.inputs[0])
    links.new(metre_scale.outputs["Vector"], fractional.inputs[0])
    links.new(fractional.outputs["Vector"], content_scale.inputs[0])
    links.new(content_scale.outputs["Vector"], content_offset.inputs[0])

    textures = {}
    for index, channel in enumerate(("albedo", "normal", "material")):
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = ATLAS_IMAGES[channel]
        texture.extension = "EXTEND"
        texture.interpolation = "Linear"
        texture.label = f"{channel.title()} atlas / {tile_id}"
        texture.location = (-170, 300 - index * 270)
        links.new(content_offset.outputs["Vector"], texture.inputs["Vector"])
        textures[channel] = texture

    tint_node = nodes.new("ShaderNodeMixRGB")
    tint_node.blend_type = "MULTIPLY"
    tint_node.inputs[0].default_value = tint_strength
    tint_node.inputs[2].default_value = tint
    tint_node.location = (70, 280)
    links.new(textures["albedo"].outputs["Color"], tint_node.inputs[1])

    separate = nodes.new("ShaderNodeSeparateColor")
    separate.mode = "RGB"
    separate.location = (70, -260)
    links.new(textures["material"].outputs["Color"], separate.inputs["Color"])

    ao_multiply = nodes.new("ShaderNodeMixRGB")
    ao_multiply.blend_type = "MULTIPLY"
    ao_multiply.inputs[0].default_value = 0.28
    ao_multiply.location = (330, 260)
    links.new(tint_node.outputs["Color"], ao_multiply.inputs[1])
    links.new(separate.outputs["Blue"], ao_multiply.inputs[2])
    links.new(ao_multiply.outputs["Color"], principled.inputs["Base Color"])
    links.new(separate.outputs["Red"], principled.inputs["Roughness"])
    links.new(separate.outputs["Green"], principled.inputs["Metallic"])

    normal = nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = normal_strength
    normal.location = (330, -40)
    links.new(textures["normal"].outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], principled.inputs["Normal"])
    links.new(principled.outputs["BSDF"], output.inputs["Surface"])
    return material


def glass_material() -> bpy.types.Material:
    existing = bpy.data.materials.get("T1_Glass")
    if existing is not None:
        return existing
    material = bpy.data.materials.new("T1_Glass")
    material.use_nodes = True
    material.diffuse_color = (0.055, 0.085, 0.095, 1.0)
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (0.035, 0.065, 0.075, 1.0)
    principled.inputs["Roughness"].default_value = 0.18
    principled.inputs["IOR"].default_value = 1.46
    principled.inputs["Emission Color"].default_value = (0.20, 0.065, 0.012, 1.0)
    principled.inputs["Emission Strength"].default_value = 0.34
    transmission = principled.inputs.get("Transmission Weight")
    if transmission is not None:
        transmission.default_value = 0.52
    return material


def replace_materials(obj: bpy.types.Object) -> None:
    if obj.type != "MESH":
        return
    for index, old in enumerate(obj.data.materials):
        if old is None:
            continue
        key = old.name.removeprefix("GK_Mat_")
        obj.data.materials[index] = atlas_material(key)


def place(
    part_id: str,
    name: str,
    target_collection: bpy.types.Collection,
    location: tuple[float, float, float],
    rotation_z: float = 0.0,
) -> bpy.types.Object:
    if part_id not in SOURCES:
        raise KeyError(f"Missing source component: {part_id}")
    source = SOURCES[part_id]
    obj = source.copy()
    if source.data is not None:
        obj.data = source.data.copy()
    obj.name = name
    obj.location = location
    obj.rotation_euler = (0.0, 0.0, rotation_z)
    obj.scale = (1.0, 1.0, 1.0)
    obj["t1_instance"] = True
    obj["source_component_id"] = part_id
    obj["assembly_role"] = target_collection.name
    target_collection.objects.link(obj)
    replace_materials(obj)
    PLACEMENTS.append(
        {
            "name": name,
            "source": part_id,
            "collection": target_collection.name,
            "location": [round(value, 5) for value in location],
            "rotationZDegrees": round(math.degrees(rotation_z), 5),
        }
    )
    return obj


def place_shell() -> None:
    # Continuous rough-rubble footing.
    place("foundation_fieldstone_4m_h0p35m", "T1_Foundation_Front", FOUNDATION, (0.0, 0.0, 0.0))
    place("foundation_fieldstone_4m_h0p35m", "T1_Foundation_Rear", FOUNDATION, (0.0, BUILDING_DEPTH, 0.0), math.pi)
    for side, rotation in ((-2.0, -math.pi / 2.0), (2.0, math.pi / 2.0)):
        label = "Left" if side < 0 else "Right"
        place("foundation_fieldstone_4m_h0p35m", f"T1_Foundation_{label}_A", FOUNDATION, (side, 2.0, 0.0), rotation)
        place("foundation_fieldstone_2m_h0p35m", f"T1_Foundation_{label}_B", FOUNDATION, (side, 5.0, 0.0), rotation)

    # Front is deliberately asymmetric: a service door and one small shuttered aperture.
    place("wall_limewash_2m_door_service_host", "T1_Wall_Front_Door", WALLS, (-1.0, 0.0, WALL_BASE_Z))
    place("wall_limewash_2m_window_small_host", "T1_Wall_Front_Window", WALLS, (1.0, 0.0, WALL_BASE_Z))
    place("opening_door_service_single", "T1_Door_Front", OPENINGS, (-1.0, -0.018, WALL_BASE_Z))
    place("opening_window_small_shuttered", "T1_Window_Front", OPENINGS, (1.0, -0.022, WALL_BASE_Z))

    place("wall_limewash_4m_h2p7m", "T1_Wall_Rear", WALLS, (0.0, BUILDING_DEPTH, WALL_BASE_Z), math.pi)

    for side, rotation in ((-2.0, -math.pi / 2.0), (2.0, math.pi / 2.0)):
        label = "Left" if side < 0 else "Right"
        place("wall_limewash_4m_h2p7m", f"T1_Wall_{label}_A", WALLS, (side, 2.0, WALL_BASE_Z), rotation)
        place("wall_limewash_2m_window_small_host", f"T1_Wall_{label}_Window", WALLS, (side, 5.0, WALL_BASE_Z), rotation)
        place("opening_window_small_shuttered", f"T1_Window_{label}", OPENINGS, (side, 5.0, WALL_BASE_Z), rotation)

    place("gable_infill_plaster_4m", "T1_Gable_Front", WALLS, (0.0, -0.01, WALL_TOP_Z))
    place("gable_infill_plaster_4m", "T1_Gable_Rear", WALLS, (0.0, BUILDING_DEPTH + 0.01, WALL_TOP_Z), math.pi)
    place("frame_gable_truss_4m", "T1_Gable_Truss_Front", FRAMES, (0.0, -0.165, WALL_TOP_Z))
    place("frame_gable_truss_4m", "T1_Gable_Truss_Rear", FRAMES, (0.0, BUILDING_DEPTH + 0.165, WALL_TOP_Z), math.pi)

    # Joiner posts and wall plates make the modular seams read as a coherent timber frame.
    for x in (-2.0, 0.0, 2.0):
        place("frame_post_h2p4m_s0p16m", f"T1_Post_Front_{x:+.0f}", FRAMES, (x, -0.07, WALL_BASE_Z))
    for x in (-2.0, 2.0):
        place("frame_post_h2p4m_s0p16m", f"T1_Post_Rear_{x:+.0f}", FRAMES, (x, BUILDING_DEPTH + 0.07, WALL_BASE_Z), math.pi)
    place("frame_beam_4m_s0p16m", "T1_WallPlate_Front", FRAMES, (0.0, -0.08, WALL_TOP_Z - 0.09))
    place("frame_beam_4m_s0p16m", "T1_WallPlate_Rear", FRAMES, (0.0, BUILDING_DEPTH + 0.08, WALL_TOP_Z - 0.09), math.pi)


def roof_transform(side: float, slope_center: float) -> tuple[tuple[float, float], float]:
    x = side * (SLOPE_MAX - slope_center) * math.cos(PITCH)
    z = RIDGE_Z + (slope_center - SLOPE_MAX) * math.sin(PITCH)
    rotation = math.pi / 2.0 if side > 0 else -math.pi / 2.0
    return (x, z), rotation


def place_roof() -> None:
    # The 3.6 m authored slope is made from a full and half panel—no stretched roof mesh.
    runs = (("4m", 2.0), ("2m", 5.0))
    slope_courses = (("full", -0.6), ("half", 1.2))
    for side in (-1.0, 1.0):
        side_name = "Left" if side < 0 else "Right"
        for run_token, y in runs:
            for course_name, centre in slope_courses:
                (x, z), rotation = roof_transform(side, centre)
                place(
                    f"roof_thatch_panel_{run_token}_{course_name}",
                    f"T1_Roof_{side_name}_{run_token}_{course_name}",
                    ROOF,
                    (x, y, z),
                    rotation,
                )

    eave_x = SLOPE_MAX * 2.0 * math.cos(PITCH)
    eave_z = RIDGE_Z - SLOPE_MAX * 2.0 * math.sin(PITCH)
    for side in (-1.0, 1.0):
        rotation = math.pi / 2.0 if side > 0 else -math.pi / 2.0
        side_name = "Left" if side < 0 else "Right"
        for run_token, y in runs:
            place(
                f"roof_thatch_eave_edge_{run_token}",
                f"T1_Eave_{side_name}_{run_token}",
                ROOF,
                (side * eave_x, y, eave_z),
                rotation,
            )

    for run_token, y in runs:
        place(f"roof_thatch_ridge_{run_token}", f"T1_Ridge_{run_token}", ROOF, (0.0, y, RIDGE_Z), math.pi / 2.0)

    place("roof_thatch_ridge_endcap", "T1_Ridge_Endcap_Front", ROOF, (0.0, -0.12, RIDGE_Z), math.pi / 2.0)
    place("roof_thatch_ridge_endcap", "T1_Ridge_Endcap_Rear", ROOF, (0.0, BUILDING_DEPTH + 0.12, RIDGE_Z), -math.pi / 2.0)

    # A bound-thatch smoke hood is the Tier-1 fire exit; a later masonry chimney would be anachronistic here.
    smoke_x = 0.72
    smoke_z = RIDGE_Z - smoke_x * math.tan(PITCH) - 0.05
    place("roof_thatch_smoke_vent", "T1_Thatch_Smoke_Vent", ROOF, (smoke_x, 4.55, smoke_z), math.pi / 2.0)

    patch_centre = -0.05
    (patch_x, patch_z), patch_rotation = roof_transform(1.0, patch_centre)
    place("roof_thatch_repair_patch_1m", "T1_Thatch_Repair_Patch", ROOF, (patch_x, 2.65, patch_z + 0.025), patch_rotation)


def place_props() -> None:
    place("foundation_steps_limestone_1", "T1_Threshold_Steps", PROPS, (-1.0, -0.56, 0.0))
    place("prop_firewood_stack_small", "T1_Firewood_Stack", PROPS, (2.43, 3.15, 0.0), math.pi / 2.0)


def remove_source_library_objects() -> None:
    for obj in list(bpy.data.objects):
        if not obj.get("t1_instance"):
            bpy.data.objects.remove(obj, do_unlink=True)
    for source_collection in list(bpy.data.collections):
        if source_collection.name.startswith("GK_") and not source_collection.objects:
            bpy.data.collections.remove(source_collection)


def simple_material(name: str, color: tuple[float, float, float, float], roughness: float, emission: float = 0.0) -> bpy.types.Material:
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = color
    principled.inputs["Roughness"].default_value = roughness
    if emission > 0.0:
        principled.inputs["Emission Color"].default_value = color
        principled.inputs["Emission Strength"].default_value = emission
    material.diffuse_color = color
    return material


def add_cube(name: str, location: tuple[float, float, float], dimensions: tuple[float, float, float], material: bpy.types.Material, rotation_z: float = 0.0) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location, rotation=(0.0, 0.0, rotation_z))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material)
    obj["preview_only"] = True
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    PREVIEW.objects.link(obj)
    return obj


def add_preview_staging() -> None:
    # Neutral, vegetation-free ground uses the same production atlas.
    bpy.ops.mesh.primitive_plane_add(size=18.0, location=(0.0, 3.0, -0.015))
    ground = bpy.context.object
    ground.name = "T1_Preview_Packed_Earth"
    uv_layer = ground.data.uv_layers.active
    uv_layer.name = "GK_UV0"
    for uv in uv_layer.data:
        uv.uv *= 18.0
    ground.data.materials.append(atlas_material("packed_earth"))
    ground["preview_only"] = True
    for owner in list(ground.users_collection):
        owner.objects.unlink(ground)
    PREVIEW.objects.link(ground)

    warm = simple_material("T1_Preview_Interior_Warmth", (0.46, 0.19, 0.055, 1.0), 0.8, emission=2.2)
    add_cube("T1_Preview_WindowGlow_Front", (1.0, 0.19, 1.79), (0.48, 0.035, 0.68), warm)
    add_cube("T1_Preview_WindowGlow_Left", (-1.81, 5.0, 1.79), (0.035, 0.48, 0.68), warm, -math.pi / 2.0)
    add_cube("T1_Preview_WindowGlow_Right", (1.81, 5.0, 1.79), (0.035, 0.48, 0.68), warm, math.pi / 2.0)


def point_camera(camera: bpy.types.Object, target: tuple[float, float, float]) -> None:
    direction = Vector(target) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


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


def stage_render() -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1800
    scene.render.resolution_y = 1200
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.filepath = str(OUT_RENDER)
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.resolution_percentage = 100
    scene.render.use_file_extension = True
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass

    if scene.world is None:
        scene.world = bpy.data.worlds.new("T1_Preview_World")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.055, 0.075, 0.095, 1.0)
    background.inputs["Strength"].default_value = 0.34

    key = add_light("T1_Key", "AREA", (-5.5, -5.5, 11.0), 1450.0, (1.0, 0.79, 0.57), 7.0)
    point_camera(key, (0.0, 2.7, 2.2))
    fill = add_light("T1_Fill", "AREA", (7.0, -1.0, 6.0), 900.0, (0.53, 0.69, 1.0), 5.0)
    point_camera(fill, (0.0, 3.0, 2.0))
    rim = add_light("T1_Rim", "AREA", (-4.0, 9.0, 8.0), 1150.0, (0.72, 0.83, 1.0), 4.0)
    point_camera(rim, (0.0, 3.5, 3.0))
    sun = add_light("T1_Sun", "SUN", (0.0, 0.0, 10.0), 2.2, (1.0, 0.74, 0.48))
    sun.rotation_euler = (math.radians(26.0), math.radians(-18.0), math.radians(-38.0))
    sun.data.angle = math.radians(8.0)

    camera_data = bpy.data.cameras.new("T1_Hero_Camera")
    camera = bpy.data.objects.new("T1_Hero_Camera", camera_data)
    PREVIEW.objects.link(camera)
    camera.location = (10.6, -12.6, 8.1)
    camera_data.lens = 55.0
    point_camera(camera, (0.0, 2.85, 2.65))
    camera["preview_only"] = True
    scene.camera = camera


def write_manifest() -> None:
    payload = {
        "id": "gorski-tier1-residence-atlas-preview-v1",
        "regionalContext": "Gorski Kotar, circa 1550",
        "sourceKit": "gorski-architecture-kit-1.1.0",
        "atlas": {
            "id": ATLAS_MANIFEST["id"],
            "albedo": str((ATLAS_DIR / "building_albedo_atlas.png").relative_to(ROOT)).replace("\\", "/"),
            "normal": str((ATLAS_DIR / "building_normal_atlas.png").relative_to(ROOT)).replace("\\", "/"),
            "material": str((ATLAS_DIR / "building_material_atlas.png").relative_to(ROOT)).replace("\\", "/"),
            "packing": "R roughness, G metalness, B AO, A centered height",
        },
        "dimensionsMetres": {"width": 4.0, "depth": BUILDING_DEPTH, "foundationTop": WALL_BASE_Z, "wallTop": WALL_TOP_Z, "ridge": RIDGE_Z},
        "roofFinish": "bundled-thatch",
        "smokeExit": "bound-thatch hood; no later-tier masonry chimney",
        "livingVegetation": "excluded; SeedThree-owned",
        "placements": PLACEMENTS,
    }
    OUT_MANIFEST.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    RENDER_DIR.mkdir(parents=True, exist_ok=True)
    place_shell()
    place_roof()
    place_props()
    remove_source_library_objects()
    add_preview_staging()
    stage_render()
    scene = bpy.context.scene
    scene["artifact_id"] = "gorski-tier1-residence-atlas-preview-v1"
    scene["architecture_context"] = "Gorski Kotar, circa 1550"
    scene["roof_finish"] = "bundled-thatch"
    scene["atlas_id"] = ATLAS_MANIFEST["id"]
    scene["living_vegetation"] = "excluded; SeedThree-owned"
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    write_manifest()
    bpy.ops.render.render(write_still=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    print(f"T1_BLEND={OUT_BLEND}")
    print(f"T1_RENDER={OUT_RENDER}")
    print(f"T1_PLACEMENTS={len(PLACEMENTS)}")


if __name__ == "__main__":
    main()
