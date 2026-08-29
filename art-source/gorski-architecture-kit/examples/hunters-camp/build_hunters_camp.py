from __future__ import annotations

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
OUTPUT_ROOT = Path(os.environ.get("GK_HUNTERS_CAMP_OUTPUT_ROOT", str(EXAMPLE_DIR))).resolve()
OUT_DIR = OUTPUT_ROOT / "out"
RENDER_DIR = OUTPUT_ROOT / "renders"
ATLAS_DIR = ROOT / "public" / "assets" / "textures" / "buildings" / "gorski_building_atlas_v1"
HIDE_SURFACE_DIR = ROOT / "public" / "assets" / "textures" / "buildings" / "gorski_camp_surfaces_v1"
CANVAS_SURFACE_DIR = ROOT / "public" / "assets" / "textures" / "buildings" / "gorski_camp_canvas_v1"
OUT_BLEND = OUT_DIR / "hunters_camp_textured_v6.blend"
OUT_GLB = OUT_DIR / "hunters_camp_textured_v6.glb"
OUT_MANIFEST = OUT_DIR / "hunters_camp_assembly_v6.json"
OUT_HERO = RENDER_DIR / "hunters_camp_hero_v6.png"
OUT_OVERHEAD = RENDER_DIR / "hunters_camp_overhead_v6.png"
OUT_WORKSIDE = RENDER_DIR / "hunters_camp_workside_v6.png"
OUT_TENT_DETAIL = RENDER_DIR / "hunters_camp_tent_detail_v6.png"
OUT_SHELTER_DETAIL = RENDER_DIR / "hunters_camp_hide_shelter_detail_v6.png"
OUT_TOOLS_DETAIL = RENDER_DIR / "hunters_camp_tools_detail_v6.png"
OUT_BLOCK_DETAIL = RENDER_DIR / "hunters_camp_chopping_block_detail_v6.png"


def source_objects() -> dict[str, bpy.types.Object]:
    return {str(obj["gk_id"]): obj for obj in bpy.data.objects if obj.get("gk_id")}


SOURCES = source_objects()
PLACEMENTS: list[dict[str, object]] = []


def collection(name: str) -> bpy.types.Collection:
    current = bpy.data.collections.get(name)
    if current is None:
        current = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(current)
    return current


SHELTERS = collection("HC_01_Shelters")
HEARTH = collection("HC_02_Hearth")
WORK = collection("HC_03_Work")
EQUIPMENT = collection("HC_04_Equipment")
BOUNDARY = collection("HC_05_Boundary")
PREVIEW = collection("HC_90_Preview_Staging")


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
HIDE_MANIFEST = json.loads((HIDE_SURFACE_DIR / "manifest.json").read_text(encoding="utf-8"))
HIDE_IMAGES = {
    "albedo": bpy.data.images.load(str(HIDE_SURFACE_DIR / "stitched_hide_albedo.png"), check_existing=True),
    "normal": bpy.data.images.load(str(HIDE_SURFACE_DIR / "stitched_hide_normal.png"), check_existing=True),
    "material": bpy.data.images.load(str(HIDE_SURFACE_DIR / "stitched_hide_material.png"), check_existing=True),
}
HIDE_IMAGES["albedo"].colorspace_settings.name = "sRGB"
HIDE_IMAGES["normal"].colorspace_settings.name = "Non-Color"
HIDE_IMAGES["material"].colorspace_settings.name = "Non-Color"
CANVAS_MANIFEST = json.loads((CANVAS_SURFACE_DIR / "manifest.json").read_text(encoding="utf-8"))
CANVAS_IMAGES = {
    "albedo": bpy.data.images.load(str(CANVAS_SURFACE_DIR / "aged_canvas_albedo.png"), check_existing=True),
    "normal": bpy.data.images.load(str(CANVAS_SURFACE_DIR / "aged_canvas_normal.png"), check_existing=True),
    "material": bpy.data.images.load(str(CANVAS_SURFACE_DIR / "aged_canvas_material.png"), check_existing=True),
}
CANVAS_IMAGES["albedo"].colorspace_settings.name = "sRGB"
CANVAS_IMAGES["normal"].colorspace_settings.name = "Non-Color"
CANVAS_IMAGES["material"].colorspace_settings.name = "Non-Color"


MATERIAL_LOOKS = {
    "canvas": ("linen-canvas", (0.76, 0.66, 0.50, 1.0), 0.34, 0.72),
    "oak_dark": ("rough-hewn-timber", (0.25, 0.13, 0.060, 1.0), 0.70, 0.68),
    "timber_cut": ("rough-hewn-timber", (0.58, 0.34, 0.15, 1.0), 0.46, 0.62),
    "timber_weathered": ("weathered-planks", (0.40, 0.25, 0.13, 1.0), 0.62, 0.74),
    "fieldstone": ("fieldstone-mortar", (0.32, 0.29, 0.24, 1.0), 0.66, 0.82),
    "charcoal": ("packed-earth", (0.065, 0.052, 0.040, 1.0), 0.90, 0.38),
    "iron": ("wrought-iron", (0.20, 0.21, 0.20, 1.0), 0.74, 0.58),
    "rope": ("wicker-weave", (0.47, 0.32, 0.17, 1.0), 0.48, 0.58),
    "packed_earth": ("packed-earth", (0.34, 0.25, 0.17, 1.0), 0.34, 0.58),
    "packed_earth_dark": ("packed-earth", (0.15, 0.16, 0.13, 1.0), 0.76, 0.50),
}


def atlas_material(key: str) -> bpy.types.Material:
    material_name = f"HC_Atlas_{key}"
    existing = bpy.data.materials.get(material_name)
    if existing is not None:
        return existing

    tile_id, tint, tint_strength, normal_strength = MATERIAL_LOOKS.get(
        key,
        ("rough-hewn-timber", (0.50, 0.34, 0.19, 1.0), 0.45, 0.60),
    )
    tile = ATLAS_TILES[tile_id]
    metres = float(tile["metersPerTile"])

    material = bpy.data.materials.new(material_name)
    material.use_nodes = True
    material.diffuse_color = tint
    material["atlas_id"] = ATLAS_MANIFEST["id"]
    material["atlas_tile"] = tile_id
    material["metres_per_tile"] = metres
    material["surface_role"] = key
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (690, 40)
    principled = nodes.new("ShaderNodeBsdfPrincipled")
    principled.location = (420, 40)
    principled.inputs["Roughness"].default_value = 0.88

    uv = nodes.new("ShaderNodeUVMap")
    uv.uv_map = "GK_UV0"
    uv.location = (-650, 80)

    textures = {}
    for index, channel in enumerate(("albedo", "normal", "material")):
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = ATLAS_IMAGES[channel]
        texture.extension = "EXTEND"
        texture.interpolation = "Linear"
        texture.location = (-420, 300 - index * 240)
        texture.label = f"{channel.title()} atlas / {tile_id}"
        links.new(uv.outputs["UV"], texture.inputs["Vector"])
        textures[channel] = texture

    packed_channels = nodes.new("ShaderNodeSeparateColor")
    packed_channels.mode = "RGB"
    packed_channels.location = (-80, -220)
    links.new(textures["material"].outputs["Color"], packed_channels.inputs["Color"])
    links.new(textures["albedo"].outputs["Color"], principled.inputs["Base Color"])
    links.new(packed_channels.outputs["Red"], principled.inputs["Roughness"])
    links.new(packed_channels.outputs["Green"], principled.inputs["Metallic"])

    normal = nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = normal_strength
    normal.location = (100, -30)
    links.new(textures["normal"].outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], principled.inputs["Normal"])
    links.new(principled.outputs["BSDF"], output.inputs["Surface"])
    material["atlas_uv_mode"] = "tile coordinates baked into GK_UV0 for Blender/glTF parity"
    material["gltf_export_safe"] = True
    return material


def hide_material() -> bpy.types.Material:
    """Dedicated repeatable hide surface for the processing shelter.

    This is kept separate from the common building atlas because it represents a
    sewn construction sheet, not a generic wall or furnishing tile.  The node
    graph remains glTF-safe and the UVs are authored in 1.6 m repeat units.
    """

    material_name = "HC_Stitched_Hide"
    existing = bpy.data.materials.get(material_name)
    if existing is not None:
        return existing
    material = bpy.data.materials.new(material_name)
    material.use_nodes = True
    material.diffuse_color = (0.25, 0.18, 0.12, 1.0)
    material["atlas_id"] = HIDE_MANIFEST["id"]
    material["atlas_tile"] = "stitched-hide"
    material["metres_per_tile"] = 1.6
    material["surface_role"] = "leather"
    material["atlas_uv_mode"] = "repeatable 1.6 m stitched-hide coordinates baked into GK_UV0"
    material["gltf_export_safe"] = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (680, 40)
    principled = nodes.new("ShaderNodeBsdfPrincipled")
    principled.location = (410, 40)
    principled.inputs["Roughness"].default_value = 0.92
    principled.inputs["Specular IOR Level"].default_value = 0.22
    uv = nodes.new("ShaderNodeUVMap")
    uv.uv_map = "GK_UV0"
    uv.location = (-640, 80)
    textures = {}
    for index, channel in enumerate(("albedo", "normal", "material")):
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = HIDE_IMAGES[channel]
        texture.extension = "REPEAT"
        texture.interpolation = "Linear"
        texture.location = (-410, 300 - index * 240)
        texture.label = f"{channel.title()} / stitched hide"
        links.new(uv.outputs["UV"], texture.inputs["Vector"])
        textures[channel] = texture
    packed_channels = nodes.new("ShaderNodeSeparateColor")
    packed_channels.mode = "RGB"
    packed_channels.location = (-70, -220)
    links.new(textures["material"].outputs["Color"], packed_channels.inputs["Color"])
    links.new(textures["albedo"].outputs["Color"], principled.inputs["Base Color"])
    links.new(packed_channels.outputs["Red"], principled.inputs["Roughness"])
    links.new(packed_channels.outputs["Green"], principled.inputs["Metallic"])
    normal = nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = 0.48
    normal.location = (90, -30)
    links.new(textures["normal"].outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], principled.inputs["Normal"])
    links.new(principled.outputs["BSDF"], output.inputs["Surface"])
    return material


def canvas_material() -> bpy.types.Material:
    material_name = "HC_Aged_Linen_Canvas"
    existing = bpy.data.materials.get(material_name)
    if existing is not None:
        return existing
    material = bpy.data.materials.new(material_name)
    material.use_nodes = True
    material.diffuse_color = (0.66, 0.57, 0.43, 1.0)
    material["atlas_id"] = CANVAS_MANIFEST["id"]
    material["atlas_tile"] = "aged-canvas"
    material["metres_per_tile"] = 1.25
    material["surface_role"] = "canvas"
    material["atlas_uv_mode"] = "repeatable 1.25 m aged-canvas coordinates baked into GK_UV0"
    material["gltf_export_safe"] = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (680, 40)
    principled = nodes.new("ShaderNodeBsdfPrincipled")
    principled.location = (410, 40)
    principled.inputs["Roughness"].default_value = 0.94
    principled.inputs["Specular IOR Level"].default_value = 0.18
    uv = nodes.new("ShaderNodeUVMap")
    uv.uv_map = "GK_UV0"
    uv.location = (-640, 80)
    textures = {}
    for index, channel in enumerate(("albedo", "normal", "material")):
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = CANVAS_IMAGES[channel]
        texture.extension = "REPEAT"
        texture.interpolation = "Linear"
        texture.location = (-410, 300 - index * 240)
        texture.label = f"{channel.title()} / aged linen canvas"
        links.new(uv.outputs["UV"], texture.inputs["Vector"])
        textures[channel] = texture
    packed_channels = nodes.new("ShaderNodeSeparateColor")
    packed_channels.mode = "RGB"
    packed_channels.location = (-70, -220)
    links.new(textures["material"].outputs["Color"], packed_channels.inputs["Color"])
    links.new(textures["albedo"].outputs["Color"], principled.inputs["Base Color"])
    links.new(packed_channels.outputs["Red"], principled.inputs["Roughness"])
    links.new(packed_channels.outputs["Green"], principled.inputs["Metallic"])
    normal = nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = 0.34
    normal.location = (90, -30)
    links.new(textures["normal"].outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], principled.inputs["Normal"])
    links.new(principled.outputs["BSDF"], output.inputs["Surface"])
    return material


def bake_atlas_uvs(obj: bpy.types.Object, material_keys: list[str]) -> None:
    """Convert metric UVs to final atlas coordinates before Blender or glTF shading.

    Baking removes the shader-side FRACTION/scale node chain that Blender could
    preview but the glTF exporter could not represent reliably.  Every exported
    material now samples the same production atlas directly in Three.js.
    """

    if obj.type != "MESH":
        return
    uv_layer = obj.data.uv_layers.get("GK_UV0")
    if uv_layer is None:
        return
    atlas_width = float(ATLAS_MANIFEST["dimensions"]["width"])
    atlas_height = float(ATLAS_MANIFEST["dimensions"]["height"])
    for polygon in obj.data.polygons:
        slot = min(polygon.material_index, len(material_keys) - 1)
        key = material_keys[slot] if material_keys else "timber_cut"
        if key == "canvas":
            for loop_index in polygon.loop_indices:
                uv = uv_layer.data[loop_index].uv
                uv.x /= 1.25
                uv.y /= 1.25
            continue
        if key == "leather":
            for loop_index in polygon.loop_indices:
                uv = uv_layer.data[loop_index].uv
                uv.x /= 1.6
                uv.y /= 1.6
            continue
        tile_id = MATERIAL_LOOKS.get(key, MATERIAL_LOOKS["timber_cut"])[0]
        tile = ATLAS_TILES[tile_id]
        metres = float(tile["metersPerTile"])
        # contentPixels is the exact seamless period; the surrounding 32 px is
        # wrapped mip padding. Sampling pixel centres retains both properties.
        content = tile["contentPixels"]
        texel_centre = 0.5
        u_min = (content["x"] + texel_centre) / atlas_width
        v_min = 1.0 - (content["y"] + content["height"] - texel_centre) / atlas_height
        u_scale = (content["width"] - texel_centre * 2.0) / atlas_width
        v_scale = (content["height"] - texel_centre * 2.0) / atlas_height
        for loop_index in polygon.loop_indices:
            uv = uv_layer.data[loop_index].uv
            repeat_u = uv.x / metres - math.floor(uv.x / metres)
            repeat_v = uv.y / metres - math.floor(uv.y / metres)
            uv.x = u_min + repeat_u * u_scale
            uv.y = v_min + repeat_v * v_scale
    obj.data.update()


def replace_materials(obj: bpy.types.Object) -> None:
    if obj.type != "MESH":
        return
    keys = [
        old.name.removeprefix("GK_Mat_") if old is not None else "timber_cut"
        for old in obj.data.materials
    ]
    bake_atlas_uvs(obj, keys)
    for index, key in enumerate(keys):
        if key == "leather":
            obj.data.materials[index] = hide_material()
        elif key == "canvas":
            obj.data.materials[index] = canvas_material()
        else:
            obj.data.materials[index] = atlas_material(key)


def phase_metric_uvs(obj: bpy.types.Object, location: tuple[float, float, float], rotation_z: float) -> None:
    if obj.type != "MESH":
        return
    uv_layer = obj.data.uv_layers.get("GK_UV0")
    if uv_layer is None:
        return
    cosine = math.cos(rotation_z)
    sine = math.sin(rotation_z)
    phase_x = location[0] * cosine + location[1] * sine
    phase_y = -location[0] * sine + location[1] * cosine
    for polygon in obj.data.polygons:
        normal = polygon.normal
        ax, ay, az = abs(normal.x), abs(normal.y), abs(normal.z)
        if az >= ax and az >= ay:
            u_offset, v_offset = phase_x, phase_y
        elif ay >= ax:
            u_offset, v_offset = phase_x, location[2]
        else:
            u_offset, v_offset = phase_y, location[2]
        for loop_index in polygon.loop_indices:
            uv_layer.data[loop_index].uv.x += u_offset
            uv_layer.data[loop_index].uv.y += v_offset


def place(
    part_id: str,
    name: str,
    target_collection: bpy.types.Collection,
    location: tuple[float, float, float],
    rotation_z: float = 0.0,
) -> bpy.types.Object:
    source = SOURCES.get(part_id)
    if source is None:
        raise KeyError(f"Missing source component: {part_id}")
    obj = source.copy()
    if source.data is not None:
        obj.data = source.data.copy()
    obj.name = name
    obj.location = location
    obj.rotation_euler = (0.0, 0.0, rotation_z)
    obj.scale = (1.0, 1.0, 1.0)
    obj["hc_instance"] = True
    obj["source_component_id"] = part_id
    obj["assembly_role"] = target_collection.name
    target_collection.objects.link(obj)
    phase_metric_uvs(obj, location, rotation_z)
    replace_materials(obj)
    PLACEMENTS.append({
        "name": name,
        "source": part_id,
        "collection": target_collection.name,
        "location": [round(value, 5) for value in location],
        "rotationZDegrees": round(math.degrees(rotation_z), 4),
    })
    return obj


def assemble_camp() -> None:
    place("site_tent_a_frame_large", "HC_Sleeping_Tent", SHELTERS, (-2.70, 1.25, 0.0), math.radians(-8.0))
    place("site_hunter_hide_fly_4m_d2m", "HC_Processing_Hide_Fly", SHELTERS, (2.20, 1.75, 0.0), math.radians(4.0))
    place("site_campfire_hearth", "HC_Hearth", HEARTH, (-0.25, -0.58, 0.0), math.radians(7.0))
    place("site_camp_cooking_tripod", "HC_Cooking_Tripod", HEARTH, (-0.25, -0.58, 0.0), math.radians(-5.0))
    place("prop_camp_worktable", "HC_Field_Worktable", WORK, (2.18, 1.72, 0.0), math.radians(4.0))
    place("prop_tool_rack_hunter", "HC_Hunter_Tool_Rack", WORK, (2.92, -1.42, 0.0), math.radians(28.0))
    place("prop_firewood_chopping_block", "HC_Chopping_Block", WORK, (-1.58, -2.12, 0.0), math.radians(11.0))
    place("prop_water_bucket_pair", "HC_Water_Buckets", EQUIPMENT, (3.75, 0.58, 0.0), math.radians(7.0))
    place("prop_barrel_small", "HC_Supply_Barrel", EQUIPMENT, (3.66, 2.73, 0.0), math.radians(-9.0))
    place("prop_crate_small", "HC_Supply_Crate", EQUIPMENT, (0.95, 3.00, 0.0), math.radians(13.0))

    for index, (location, rotation) in enumerate((
        ((-2.45, 4.15, 0.0), math.radians(1.5)),
        ((-0.24, 4.18, 0.0), math.radians(-1.0)),
        ((1.98, 4.10, 0.0), math.radians(2.0)),
        ((-4.35, 1.55, 0.0), math.radians(91.0)),
        ((4.42, 2.05, 0.0), math.radians(88.0)),
    )):
        place("site_hunter_boundary_rail_2m", f"HC_Boundary_Rail_{index + 1:02d}", BOUNDARY, location, rotation)


def remove_source_library_objects() -> None:
    for obj in list(bpy.data.objects):
        if not obj.get("hc_instance"):
            bpy.data.objects.remove(obj, do_unlink=True)
    for source_collection in list(bpy.data.collections):
        if source_collection.name.startswith("GK_") and not source_collection.objects:
            bpy.data.collections.remove(source_collection)


def link_preview(obj: bpy.types.Object) -> None:
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    PREVIEW.objects.link(obj)
    obj["preview_only"] = True


def add_irregular_ground_patch() -> None:
    randomizer = random.Random(1550)
    count = 64
    vertices = [(0.0, 0.6, -0.018)]
    for index in range(count):
        angle = math.tau * index / count
        radius = 5.25 + randomizer.uniform(-0.38, 0.32) + 0.18 * math.sin(angle * 5.0)
        vertices.append((radius * math.cos(angle), 0.6 + radius * 0.78 * math.sin(angle), -0.018))
    faces = [(0, index + 1, ((index + 1) % count) + 1) for index in range(count)]
    mesh = bpy.data.meshes.new("HC_Preview_Clearing_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update(calc_edges=True)
    uv_layer = mesh.uv_layers.new(name="GK_UV0")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            point = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            uv_layer.data[loop_index].uv = (point.x + 8.0, point.y + 8.0)
    patch = bpy.data.objects.new("HC_Preview_Packed_Earth_Clearing", mesh)
    PREVIEW.objects.link(patch)
    bake_atlas_uvs(patch, ["packed_earth"])
    patch.data.materials.append(atlas_material("packed_earth"))
    patch["preview_only"] = True

    bpy.ops.mesh.primitive_plane_add(size=34.0, location=(0.0, 0.0, -0.035))
    outer = bpy.context.object
    outer.name = "HC_Preview_Neutral_Ground"
    outer.data.uv_layers.active.name = "GK_UV0"
    for uv in outer.data.uv_layers.active.data:
        uv.uv *= 34.0
    bake_atlas_uvs(outer, ["packed_earth_dark"])
    outer.data.materials.append(atlas_material("packed_earth_dark"))
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
    add_irregular_ground_patch()
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
    # Keep the linen weave, tool silhouettes, and dark field timber inside the
    # display range instead of bleaching the atlas into a white clay render.
    scene.view_settings.exposure = -0.35

    if scene.world is None:
        scene.world = bpy.data.worlds.new("HC_Preview_World")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.035, 0.052, 0.066, 1.0)
    background.inputs["Strength"].default_value = 0.32

    key = add_light("HC_Key", "AREA", (-6.0, -7.0, 11.0), 1020.0, (0.92, 0.95, 1.0), 7.5)
    point_at(key, (0.0, 0.7, 0.8))
    fill = add_light("HC_Fill", "AREA", (8.0, -1.0, 6.0), 350.0, (0.56, 0.68, 1.0), 6.0)
    point_at(fill, (0.2, 1.0, 0.9))
    rim = add_light("HC_Rim", "AREA", (-4.0, 8.0, 8.0), 520.0, (1.0, 0.84, 0.68), 5.0)
    point_at(rim, (0.0, 1.4, 1.1))
    tent_bounce = add_light("HC_Tent_Bounce", "AREA", (-0.5, -1.0, 2.3), 105.0, (0.82, 0.87, 1.0), 3.0)
    point_at(tent_bounce, (-2.7, 1.25, 0.9))
    tent_interior = add_light("HC_Tent_Interior", "POINT", (-2.70, 1.25, 1.0), 22.0, (0.80, 0.84, 1.0))
    tent_interior.data.shadow_soft_size = 1.6
    sun = add_light("HC_Sun", "SUN", (0.0, 0.0, 10.0), 1.0, (1.0, 0.92, 0.80))
    sun.rotation_euler = (math.radians(27.0), math.radians(-16.0), math.radians(-41.0))
    sun.data.angle = math.radians(7.0)
    hearth_glow = add_light("HC_Hearth_Glow", "POINT", (-0.25, -0.58, 0.42), 58.0, (1.0, 0.28, 0.055))
    hearth_glow.data.shadow_soft_size = 1.0

    camera_data = bpy.data.cameras.new("HC_Hero_Camera")
    camera = bpy.data.objects.new("HC_Hero_Camera", camera_data)
    PREVIEW.objects.link(camera)
    camera.location = (10.8, -14.2, 7.2)
    camera_data.lens = 56.0
    point_at(camera, (0.0, 0.75, 1.02))
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
    camera.data.ortho_scale = 12.0
    camera.location = (0.0, 0.55, 17.5)
    point_at(camera, (0.0, 0.55, 0.0))
    render_atomic(OUT_OVERHEAD)
    camera.data.type = "PERSP"
    camera.data.lens = 60.0
    camera.location = (-11.8, -11.0, 5.9)
    point_at(camera, (0.0, 0.9, 0.95))
    render_atomic(OUT_WORKSIDE)
    camera.data.lens = 66.0
    camera.location = (-7.5, -5.6, 3.4)
    point_at(camera, (-2.70, 1.30, 0.92))
    render_atomic(OUT_TENT_DETAIL)
    camera.data.lens = 62.0
    camera.location = (8.1, 0.0, 3.35)
    point_at(camera, (2.20, 1.72, 1.0))
    render_atomic(OUT_SHELTER_DETAIL)
    camera.data.lens = 68.0
    camera.location = (7.2, -7.2, 3.0)
    point_at(camera, (2.88, -1.42, 1.20))
    render_atomic(OUT_TOOLS_DETAIL)
    camera.data.lens = 76.0
    camera.location = (-5.0, -5.8, 2.15)
    point_at(camera, (-1.58, -2.12, 0.80))
    render_atomic(OUT_BLOCK_DETAIL)


def write_manifest() -> None:
    payload = {
        "id": "gorski-hunters-camp-atlas-preview-v6",
        "authoritativeBuildingKind": "hunters_hall",
        "displayIdentity": "Hunter's Camp",
        "regionalContext": "Gorski Kotar, circa 1550",
        "sourceKit": "gorski-architecture-kit-1.1.0",
        "dimensionsMetres": {"artFootprintWidth": 9.0, "artFootprintDepth": 7.5, "maximumHeight": 2.70},
        "designIntent": "Open temporary woodland worksite, replacing the previous oversized enclosed lodge.",
        "atlas": {
            "id": ATLAS_MANIFEST["id"],
            "usedTiles": ["aged-canvas", "stitched-hide", "rough-hewn-timber", "weathered-planks", "fieldstone-mortar", "wrought-iron", "wicker-weave", "packed-earth"],
            "packing": "R roughness, G metalness, B AO, A centered height",
        },
        "historicalMaterialDecision": {
            "sleepingTent": "Weathered off-white sewn linen or hemp canvas with visible weave, repairs, tied-back entrance flaps, tension hems, and guy ropes over bent hand-cut softwood poles.",
            "processingShelter": "Hair-off smoke-darkened hides stitched with sinew into a weather fly over a lashed sapling frame; this fixed construction surface is not current harvested inventory.",
            "workFurniture": "Rough, repairable weathered timber with minimal iron hardware.",
            "hearth": "Loose fieldstone ring and charcoal bed with an unladen lashed-sapling tripod whose feet stand on the surrounding ground; flame, smoke, cookware, and hanging hooks remain runtime state.",
            "boundary": "Sparse split-rail edge markers, deliberately open toward the working approach.",
        },
        "canonicalState": "Neutral fixed camp architecture and tools only.",
        "runtimeOwnedState": {
            "fireAndSmoke": "Not baked into the GLB; activity state owns emission and particles.",
            "harvestedGame": "No deer, carcass, loose fresh hide, or meat mesh is included.",
            "inventory": "No stocked firewood, fixed axe, bows, snares, hanging equipment, cooking hook, or production-output pile is included.",
        },
        "livingVegetation": "Excluded; SeedThree-owned.",
        "placements": PLACEMENTS,
    }
    OUT_MANIFEST.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def export_glb() -> None:
    staging = OUT_GLB.with_name(f"{OUT_GLB.stem}.exporting{OUT_GLB.suffix}")
    staging.unlink(missing_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    export_objects = [obj for obj in bpy.data.objects if obj.get("hc_instance") and not obj.get("preview_only")]
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
    assemble_camp()
    remove_source_library_objects()
    camera = stage_preview()
    scene = bpy.context.scene
    scene["artifact_id"] = "gorski-hunters-camp-atlas-preview-v6"
    scene["authoritative_building_kind"] = "hunters_hall"
    scene["architecture_context"] = "Gorski Kotar, circa 1550"
    scene["canonical_state"] = "neutral fixed camp; runtime owns fire, smoke, harvest, and inventory"
    scene["atlas_id"] = ATLAS_MANIFEST["id"]
    scene["living_vegetation"] = "excluded; SeedThree-owned"
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    write_manifest()
    export_glb()
    render_views(camera)
    print(f"HC_BLEND={OUT_BLEND}")
    print(f"HC_GLB={OUT_GLB}")
    print(f"HC_HERO={OUT_HERO}")
    print(f"HC_OVERHEAD={OUT_OVERHEAD}")
    print(f"HC_PLACEMENTS={len(PLACEMENTS)}")


if __name__ == "__main__":
    main()
