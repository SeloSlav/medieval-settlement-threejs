from __future__ import annotations

import json
import math
import os
from pathlib import Path
import time

import bmesh
import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[4]
EXAMPLE_DIR = Path(__file__).resolve().parent
OUTPUT_ROOT = Path(os.environ.get("GK_TIER1_OUTPUT_ROOT", str(EXAMPLE_DIR))).resolve()
OUT_DIR = OUTPUT_ROOT / "out"
RENDER_DIR = OUTPUT_ROOT / "renders"
ATLAS_DIR = ROOT / "public" / "assets" / "textures" / "buildings" / "gorski_building_atlas_v1"
OUT_BLEND = OUT_DIR / "tier1_residence_retopo_v26.blend"
OUT_GLB = OUT_DIR / "tier1_residence_retopo_v26.glb"
OUT_MANIFEST = OUT_DIR / "tier1_residence_assembly_v26.json"
OUT_RENDER = RENDER_DIR / "tier1_residence_hero_retopo_v26.png"
OUT_FRONT_RENDER = RENDER_DIR / "tier1_residence_front_retopo_v26.png"
OUT_SIDE_RENDER = RENDER_DIR / "tier1_residence_side_retopo_v26.png"

WALL_BASE_Z = 0.35
WALL_HEIGHT = 2.4
WALL_TOP_Z = WALL_BASE_Z + WALL_HEIGHT
BUILDING_DEPTH = 7.0
PITCH = math.radians(50.0)
SLOPE_LENGTH = 4.2
SLOPE_MAX = SLOPE_LENGTH / 2.0
ROOF_BEARING_X = 2.0
SMOKE_APERTURE_X = 0.72
SMOKE_APERTURE_Y = 5.05
# The roof must meet the wall plate at the four-metre body edge. The additional
# 0.70 m of horizontal roof projection is a true low eave, not an air gap.
RIDGE_Z = WALL_TOP_Z + ROOF_BEARING_X * math.tan(PITCH)
EAVE_Z = RIDGE_Z - SLOPE_LENGTH * math.sin(PITCH)


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
FIXED_ARCHITECTURE = collection("T1_06_Fixed_Architecture")
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
    "daub_humble": ("lime-plaster", (0.42, 0.29, 0.17, 1.0), 0.60, 0.68),
    "fieldstone": ("fieldstone-mortar", (0.56, 0.50, 0.40, 1.0), 0.45, 0.72),
    "fieldstone_weathered": ("fieldstone-mortar", (0.30, 0.255, 0.20, 1.0), 0.82, 0.86),
    "quarry_stone": ("quarry-stone", (0.68, 0.67, 0.61, 1.0), 0.16, 0.72),
    "limestone_warm": ("limestone-ashlar", (0.86, 0.76, 0.56, 1.0), 0.18, 0.68),
    "oak_dark": ("rough-hewn-timber", (0.25, 0.13, 0.058, 1.0), 0.65, 0.62),
    "roof_support_dark": ("rough-hewn-timber", (0.20, 0.105, 0.045, 1.0), 0.88, 0.62),
    "timber_weathered": ("weathered-planks", (0.66, 0.49, 0.31, 1.0), 0.28, 0.66),
    "timber_weathered_horizontal": ("weathered-planks", (0.32, 0.20, 0.10, 1.0), 0.78, 0.72),
    "timber_cut": ("sawn-planks", (0.78, 0.54, 0.29, 1.0), 0.22, 0.56),
    "shingles": ("split-shingles", (0.52, 0.39, 0.25, 1.0), 1.0, 0.82),
    "shingles_aged": ("split-shingles", (0.34, 0.26, 0.18, 1.0), 1.0, 0.88),
    "shingles_light": ("split-shingles", (0.67, 0.53, 0.35, 1.0), 1.0, 0.78),
    "thatch_dark": ("thatch-roof", (0.07, 0.055, 0.035, 1.0), 0.88, 0.84),
    "thatch": ("thatch-roof", (0.15, 0.115, 0.07, 1.0), 0.86, 0.84),
    "thatch_light": ("thatch-roof", (0.27, 0.21, 0.13, 1.0), 0.82, 0.84),
    "rope": ("wicker-weave", (0.67, 0.46, 0.22, 1.0), 0.30, 0.58),
    "iron": ("wrought-iron", (0.40, 0.43, 0.44, 1.0), 0.22, 0.54),
    "charcoal": ("wrought-iron", (0.08, 0.075, 0.065, 1.0), 0.70, 0.42),
    "interior_dark": ("rough-hewn-timber", (0.035, 0.028, 0.020, 1.0), 0.92, 0.30),
    "packed_earth": ("packed-earth", (0.35, 0.29, 0.23, 1.0), 0.58, 0.52),
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
    # Stay two pixels inside each tile's authored content rectangle.  Large
    # retopologized surfaces cross many repeat boundaries; sampling exactly on
    # the atlas edge otherwise pulls coloured texels from neighbouring tiles and
    # creates false timber-like bands across the shingle roof.
    atlas_inset = 2.0
    u_min = (content["x"] + atlas_inset) / atlas_width
    v_min = 1.0 - (content["y"] + content["height"] - atlas_inset) / atlas_height
    u_scale = (content["width"] - atlas_inset * 2.0) / atlas_width
    v_scale = (content["height"] - atlas_inset * 2.0) / atlas_height
    metres = float(tile["metersPerTile"])

    material = bpy.data.materials.new(material_name)
    material.use_nodes = True
    material.diffuse_color = tint
    material["atlas_id"] = ATLAS_MANIFEST["id"]
    material["atlas_tile"] = tile_id
    material["metres_per_tile"] = metres
    strong_atlas_grade = key in {
        "fieldstone_weathered",
        "timber_weathered_horizontal",
        "roof_support_dark",
        "shingles",
        "shingles_aged",
        "shingles_light",
        "thatch_dark",
        "thatch",
        "thatch_light",
    }
    material["atlas_look"] = key
    material["atlas_tint"] = list(tint[:3])
    material["atlas_tint_strength"] = 1.0 if strong_atlas_grade else tint_strength
    material["atlas_normal_strength"] = normal_strength
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
    uv_source = fractional.outputs["Vector"]
    if key == "timber_weathered_horizontal":
        separate_uv = nodes.new("ShaderNodeSeparateXYZ")
        separate_uv.location = (-740, -90)
        combine_uv = nodes.new("ShaderNodeCombineXYZ")
        combine_uv.location = (-650, -90)
        links.new(fractional.outputs["Vector"], separate_uv.inputs[0])
        links.new(separate_uv.outputs["Y"], combine_uv.inputs["X"])
        links.new(separate_uv.outputs["X"], combine_uv.inputs["Y"])
        links.new(separate_uv.outputs["Z"], combine_uv.inputs["Z"])
        uv_source = combine_uv.outputs["Vector"]
        material["uv_orientation"] = "horizontal-board rotation"
    links.new(uv_source, content_scale.inputs[0])
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
    tint_node.inputs[0].default_value = 1.0 if strong_atlas_grade else tint_strength
    tint_node.inputs[2].default_value = tint
    tint_node.location = (70, 280)
    links.new(textures["albedo"].outputs["Color"], tint_node.inputs[1])
    if strong_atlas_grade:
        material["atlas_grade"] = "full multiply tint for aged Tier-1 finish"

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
    base_color_output = ao_multiply.outputs["Color"]
    if key in {"daub_humble", "fieldstone_weathered"}:
        noise = nodes.new("ShaderNodeTexNoise")
        noise.location = (90, 520)
        noise.noise_dimensions = "3D"
        noise.inputs["Scale"].default_value = 2.35 if key == "daub_humble" else 3.4
        noise.inputs["Detail"].default_value = 5.0
        noise.inputs["Roughness"].default_value = 0.72
        links.new(uv.outputs["UV"], noise.inputs["Vector"])

        noise_range = nodes.new("ShaderNodeMapRange")
        noise_range.location = (300, 520)
        noise_range.clamp = True
        noise_range.inputs["From Min"].default_value = 0.34
        noise_range.inputs["From Max"].default_value = 0.76
        links.new(noise.outputs["Fac"], noise_range.inputs["Value"])

        geometry = nodes.new("ShaderNodeNewGeometry")
        geometry.location = (-140, 690)
        position = nodes.new("ShaderNodeSeparateXYZ")
        position.location = (70, 690)
        links.new(geometry.outputs["Position"], position.inputs[0])
        bottom = nodes.new("ShaderNodeMapRange")
        bottom.location = (280, 690)
        bottom.clamp = True
        if key == "daub_humble":
            bottom.inputs["From Min"].default_value = 0.20
            bottom.inputs["From Max"].default_value = 1.80
            bottom.inputs["To Min"].default_value = 1.0
            bottom.inputs["To Max"].default_value = 0.0
            stain = (0.24, 0.15, 0.08, 1.0)
            base_bias = 0.14
            bottom_strength = 0.64
        else:
            bottom.inputs["From Min"].default_value = 0.0
            bottom.inputs["From Max"].default_value = WALL_BASE_Z
            bottom.inputs["To Min"].default_value = 1.0
            bottom.inputs["To Max"].default_value = 0.24
            stain = (0.13, 0.12, 0.095, 1.0)
            base_bias = 0.24
            bottom_strength = 0.72
        links.new(position.outputs["Z"], bottom.inputs["Value"])

        bottom_scale = nodes.new("ShaderNodeMath")
        bottom_scale.operation = "MULTIPLY"
        bottom_scale.inputs[1].default_value = bottom_strength
        bottom_scale.location = (470, 690)
        links.new(bottom.outputs["Result"], bottom_scale.inputs[0])
        bottom_bias = nodes.new("ShaderNodeMath")
        bottom_bias.operation = "ADD"
        bottom_bias.inputs[1].default_value = base_bias
        bottom_bias.location = (630, 690)
        links.new(bottom_scale.outputs[0], bottom_bias.inputs[0])
        wear_mask = nodes.new("ShaderNodeMath")
        wear_mask.operation = "MULTIPLY"
        wear_mask.location = (780, 560)
        links.new(noise_range.outputs["Result"], wear_mask.inputs[0])
        links.new(bottom_bias.outputs[0], wear_mask.inputs[1])

        wear_mix = nodes.new("ShaderNodeMixRGB")
        wear_mix.blend_type = "MULTIPLY"
        wear_mix.location = (500, 300)
        wear_mix.inputs[2].default_value = stain
        links.new(wear_mask.outputs[0], wear_mix.inputs[0])
        links.new(ao_multiply.outputs["Color"], wear_mix.inputs[1])
        base_color_output = wear_mix.outputs["Color"]
        material["weathering"] = "low-frequency staining with world-height accumulation"
        material["weathering_profile"] = (
            "tier1-daub" if key == "daub_humble" else "tier1-fieldstone"
        )
    links.new(base_color_output, principled.inputs["Base Color"])
    links.new(separate.outputs["Red"], principled.inputs["Roughness"])
    links.new(separate.outputs["Green"], principled.inputs["Metallic"])

    normal = nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = normal_strength
    normal.location = (330, -40)
    links.new(textures["normal"].outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], principled.inputs["Normal"])
    links.new(principled.outputs["BSDF"], output.inputs["Surface"])
    return material


def direct_atlas_material(key: str) -> bpy.types.Material:
    """glTF-compatible atlas material for geometry with final UVs already baked."""

    material_name = f"T1_AtlasDirect_{key}"
    existing = bpy.data.materials.get(material_name)
    if existing is not None:
        return existing
    tile_id, tint, _tint_strength, normal_strength = MATERIAL_LOOKS[key]
    tile = ATLAS_TILES[tile_id]
    material = bpy.data.materials.new(material_name)
    material.use_nodes = True
    material.diffuse_color = tint
    material["atlas_id"] = ATLAS_MANIFEST["id"]
    material["atlas_tile"] = tile_id
    material["metres_per_tile"] = float(tile["metersPerTile"])
    material["atlas_look"] = key
    material["atlas_tint"] = list(tint[:3])
    # Blender's direct roof material samples the atlas without a multiply
    # grade. Its warm colour comes from the split-shingles tile itself.
    material["atlas_tint_strength"] = 0.0
    material["atlas_normal_strength"] = normal_strength
    material["atlas_uv_mode"] = "final tile coordinates baked into GK_UV0"
    material["gltf_export_safe"] = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    output.location = (660, 30)
    principled = nodes.new("ShaderNodeBsdfPrincipled")
    principled.location = (390, 30)
    uv = nodes.new("ShaderNodeUVMap")
    uv.uv_map = "GK_UV0"
    uv.location = (-620, 80)
    textures = {}
    for index, channel in enumerate(("albedo", "normal", "material")):
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = ATLAS_IMAGES[channel]
        texture.extension = "EXTEND"
        texture.interpolation = "Linear"
        texture.location = (-390, 290 - index * 230)
        links.new(uv.outputs["UV"], texture.inputs["Vector"])
        textures[channel] = texture

    channels = nodes.new("ShaderNodeSeparateColor")
    channels.mode = "RGB"
    channels.location = (-60, -210)
    links.new(textures["material"].outputs["Color"], channels.inputs["Color"])
    links.new(textures["albedo"].outputs["Color"], principled.inputs["Base Color"])
    links.new(channels.outputs["Red"], principled.inputs["Roughness"])
    links.new(channels.outputs["Green"], principled.inputs["Metallic"])
    normal = nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = normal_strength
    normal.location = (90, -20)
    links.new(textures["normal"].outputs["Color"], normal.inputs["Color"])
    links.new(normal.outputs["Normal"], principled.inputs["Normal"])
    links.new(principled.outputs["BSDF"], output.inputs["Surface"])
    return material


def bake_object_atlas_uvs(obj: bpy.types.Object, key: str) -> None:
    """Map each already-subdivided face into one repeat of its atlas tile."""

    uv_layer = obj.data.uv_layers.get("GK_UV0")
    if uv_layer is None:
        return
    tile_id = MATERIAL_LOOKS[key][0]
    tile = ATLAS_TILES[tile_id]
    atlas_width = float(ATLAS_MANIFEST["dimensions"]["width"])
    atlas_height = float(ATLAS_MANIFEST["dimensions"]["height"])
    metres = float(tile["metersPerTile"])
    # contentPixels is the exact seamless 448 px period; the surrounding 32 px
    # on each side is wrapped mip padding. Sample the first/last pixel centres,
    # preserving the authored seam while leaving the full gutter available to
    # lower mip levels. Arbitrary multi-pixel insets select unrelated columns
    # and create a false straight batten at every 2.2 m repeat boundary.
    content = tile["contentPixels"]
    texel_centre = 0.5
    u_min = (content["x"] + texel_centre) / atlas_width
    v_min = 1.0 - (content["y"] + content["height"] - texel_centre) / atlas_height
    u_scale = (content["width"] - texel_centre * 2.0) / atlas_width
    v_scale = (content["height"] - texel_centre * 2.0) / atlas_height
    for polygon in obj.data.polygons:
        raw = [uv_layer.data[index].uv.copy() for index in polygon.loop_indices]
        if not raw:
            continue
        base_u = math.floor((min(value.x for value in raw) + 1.0e-6) / metres)
        base_v = math.floor((min(value.y for value in raw) + 1.0e-6) / metres)
        for loop_index, value in zip(polygon.loop_indices, raw):
            repeat_u = max(0.0, min(1.0, value.x / metres - base_u))
            repeat_v = max(0.0, min(1.0, value.y / metres - base_v))
            uv_layer.data[loop_index].uv = (
                u_min + repeat_u * u_scale,
                v_min + repeat_v * v_scale,
            )
    obj.data.update()


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


def remap_instance_material(obj: bpy.types.Object, old_key: str, new_key: str) -> None:
    if obj.type != "MESH":
        return
    expected = f"T1_Atlas_{old_key}"
    for index, material in enumerate(obj.data.materials):
        if material is not None and material.name == expected:
            obj.data.materials[index] = atlas_material(new_key)


def remove_instance_material_geometry(obj: bpy.types.Object, material_key: str) -> None:
    """Remove a source material's closed geometry islands from a copied component."""
    if obj.type != "MESH":
        return
    expected = f"T1_Atlas_{material_key}"
    slot_indices = {
        index
        for index, material in enumerate(obj.data.materials)
        if material is not None and material.name == expected
    }
    if not slot_indices:
        return
    mesh_data = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh_data)
    faces = [face for face in bm.faces if face.material_index in slot_indices]
    if faces:
        bmesh.ops.delete(bm, geom=faces, context="FACES")
        loose_edges = [edge for edge in bm.edges if not edge.link_faces]
        if loose_edges:
            bmesh.ops.delete(bm, geom=loose_edges, context="EDGES")
        loose_vertices = [vertex for vertex in bm.verts if not vertex.link_edges]
        if loose_vertices:
            bmesh.ops.delete(bm, geom=loose_vertices, context="VERTS")
        bm.to_mesh(mesh_data)
        mesh_data.update()
    bm.free()


def phase_metric_uvs(
    obj: bpy.types.Object,
    location: tuple[float, float, float],
    rotation_z: float,
) -> None:
    """Keep metre-scaled atlas sampling continuous across snapped instances."""
    if obj.type != "MESH":
        return
    uv_layer = obj.data.uv_layers.get("GK_UV0")
    if uv_layer is None:
        return
    cosine = math.cos(rotation_z)
    sine = math.sin(rotation_z)
    phase_x = location[0] * cosine + location[1] * sine
    phase_y = -location[0] * sine + location[1] * cosine
    phase_z = location[2]
    for polygon in obj.data.polygons:
        normal = polygon.normal
        ax, ay, az = abs(normal.x), abs(normal.y), abs(normal.z)
        if az >= ax and az >= ay:
            u_offset, v_offset = phase_x, phase_y
        elif ay >= ax:
            u_offset, v_offset = phase_x, phase_z
        else:
            u_offset, v_offset = phase_y, phase_z
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
    if part_id.startswith("wall_") or part_id.startswith("gable_infill_"):
        for modifier in list(obj.modifiers):
            if modifier.type != "BEVEL":
                continue
            if part_id.endswith("_host"):
                obj.modifiers.remove(modifier)
            else:
                modifier.width = min(modifier.width, 0.006)
    phase_metric_uvs(obj, location, rotation_z)
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


def mirror_instance_mesh_x(obj: bpy.types.Object) -> None:
    """Mirror copied kit geometry while keeping the exported object scale at +1."""
    if obj.type != "MESH":
        return
    for vertex in obj.data.vertices:
        vertex.co.x *= -1.0
    obj.data.flip_normals()
    obj.data.update()
    obj["mirrored_local_x"] = True
    for placement in reversed(PLACEMENTS):
        if placement["name"] == obj.name:
            placement["mirroredLocalX"] = True
            break


def append_box(
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, int, int, int]],
    center: tuple[float, float, float],
    size: tuple[float, float, float],
) -> None:
    cx, cy, cz = center
    sx, sy, sz = (value / 2.0 for value in size)
    offset = len(vertices)
    vertices.extend(
        (
            (cx - sx, cy - sy, cz - sz),
            (cx + sx, cy - sy, cz - sz),
            (cx + sx, cy + sy, cz - sz),
            (cx - sx, cy + sy, cz - sz),
            (cx - sx, cy - sy, cz + sz),
            (cx + sx, cy - sy, cz + sz),
            (cx + sx, cy + sy, cz + sz),
            (cx - sx, cy + sy, cz + sz),
        )
    )
    faces.extend(
        (
            (offset + 0, offset + 3, offset + 2, offset + 1),
            (offset + 4, offset + 5, offset + 6, offset + 7),
            (offset + 0, offset + 1, offset + 5, offset + 4),
            (offset + 1, offset + 2, offset + 6, offset + 5),
            (offset + 2, offset + 3, offset + 7, offset + 6),
            (offset + 3, offset + 0, offset + 4, offset + 7),
        )
    )


def add_metric_uv_layer(mesh: bpy.types.Mesh) -> None:
    uv_layer = mesh.uv_layers.new(name="GK_UV0")
    for polygon in mesh.polygons:
        normal = polygon.normal
        ax, ay, az = abs(normal.x), abs(normal.y), abs(normal.z)
        for loop_index in polygon.loop_indices:
            point = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            if az >= ax and az >= ay:
                u, v = point.x, point.y
            elif ay >= ax:
                u, v = point.x, point.z
            else:
                u, v = point.y, point.z
            uv_layer.data[loop_index].uv = (u, v)


def make_custom_part(
    name: str,
    target_collection: bpy.types.Collection,
    boxes: list[tuple[tuple[float, float, float], tuple[float, float, float]]],
    material_key: str,
    location: tuple[float, float, float],
    rotation_z: float,
    source_id: str,
) -> bpy.types.Object:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, int, int, int]] = []
    for center, size in boxes:
        if min(size) <= 0.0001:
            continue
        append_box(vertices, faces, center, size)
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    add_metric_uv_layer(mesh)
    obj = bpy.data.objects.new(name, mesh)
    target_collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler = (0.0, 0.0, rotation_z)
    obj.data.materials.append(atlas_material(material_key))
    obj["t1_instance"] = True
    obj["source_component_id"] = source_id
    obj["assembly_role"] = target_collection.name
    obj["custom_assembly_piece"] = True
    phase_metric_uvs(obj, location, rotation_z)
    PLACEMENTS.append(
        {
            "name": name,
            "source": source_id,
            "collection": target_collection.name,
            "location": [round(value, 5) for value in location],
            "rotationZDegrees": round(math.degrees(rotation_z), 5),
        }
    )
    return obj


def local_to_world(
    origin: tuple[float, float, float],
    rotation_z: float,
    local_point: tuple[float, float, float],
) -> tuple[float, float, float]:
    cosine = math.cos(rotation_z)
    sine = math.sin(rotation_z)
    x, y, z = local_point
    return (
        origin[0] + x * cosine - y * sine,
        origin[1] + x * sine + y * cosine,
        origin[2] + z,
    )


def make_aperture_wall(
    name: str,
    width: float,
    material_key: str,
    location: tuple[float, float, float],
    rotation_z: float = 0.0,
    opening_width: float | None = None,
    opening_height: float | None = None,
    opening_sill: float = 0.0,
    opening_x: float = 0.0,
    dark_backing: bool = False,
    wall_height: float = WALL_HEIGHT,
) -> bpy.types.Object:
    depth = 0.20
    if opening_width is None or opening_height is None:
        boxes = [((0.0, 0.0, wall_height / 2.0), (width, depth, wall_height))]
    else:
        left = opening_x - opening_width / 2.0
        right = opening_x + opening_width / 2.0
        boxes = [
            (((-width / 2.0 + left) / 2.0, 0.0, wall_height / 2.0), (left + width / 2.0, depth, wall_height)),
            (((right + width / 2.0) / 2.0, 0.0, wall_height / 2.0), (width / 2.0 - right, depth, wall_height)),
            ((opening_x, 0.0, opening_sill / 2.0), (opening_width, depth, opening_sill)),
            (
                (opening_x, 0.0, (opening_sill + opening_height + wall_height) / 2.0),
                (opening_width, depth, wall_height - opening_sill - opening_height),
            ),
        ]
    wall = make_custom_part(
        name,
        WALLS,
        boxes,
        material_key,
        location,
        rotation_z,
        "assembly_custom_aperture_wall",
    )
    if dark_backing and opening_width is not None and opening_height is not None:
        backing_center = local_to_world(
            location,
            rotation_z,
            (opening_x, depth / 2.0 + 0.055, opening_sill + opening_height / 2.0),
        )
        make_custom_part(
            f"{name}_DarkInterior",
            OPENINGS,
            [((0.0, 0.0, 0.0), (opening_width - 0.025, 0.025, opening_height - 0.025))],
            "interior_dark",
            backing_center,
            rotation_z,
            "assembly_dark_unglazed_aperture",
        )
    return wall


def inset_gable_under_roof(obj: bpy.types.Object) -> None:
    """Bake a small clearance into gable infill so it cannot pierce the roof skin."""

    if obj.type != "MESH":
        return
    for vertex in obj.data.vertices:
        vertex.co.x *= 0.93
        vertex.co.z *= 0.94
    obj.data.update()
    obj["roof_clearance_baked"] = True
    obj["roof_clearance_note"] = "gable infill inset beneath overhanging shingle skin"


def place_shell() -> None:
    # Four kit-authored L-corners own the turns of the low rubble footing. Mirrored copies
    # have their mesh transforms baked so every exported instance retains unit scale.
    corner_specs = (
        ("Front_Left", (-1.0, 0.0, 0.0), 0.0, False),
        ("Front_Right", (1.0, 0.0, 0.0), 0.0, True),
        ("Rear_Left", (-1.0, BUILDING_DEPTH, 0.0), math.pi, True),
        ("Rear_Right", (1.0, BUILDING_DEPTH, 0.0), math.pi, False),
    )
    for label, location, rotation, mirrored in corner_specs:
        corner = place(
            "foundation_corner_fieldstone_h0p35m",
            f"T1_Foundation_Corner_{label}",
            FOUNDATION,
            location,
            rotation,
        )
        if mirrored:
            mirror_instance_mesh_x(corner)
        remap_instance_material(corner, "fieldstone", "fieldstone_weathered")

    # The corner returns overlap the single centre run slightly, as rubble masonry would;
    # no exposed end face or open corner remains anywhere around the rectangular plinth.
    for side, rotation in ((-2.0, -math.pi / 2.0), (2.0, math.pi / 2.0)):
        label = "Left" if side < 0 else "Right"
        centre_run = place(
            "foundation_fieldstone_4m_h0p35m",
            f"T1_Foundation_{label}_Centre",
            FOUNDATION,
            (side, BUILDING_DEPTH / 2.0, 0.0),
            rotation,
        )
        remap_instance_material(centre_run, "fieldstone", "fieldstone_weathered")

    # The public front retains humble daub, but the openings are literal voids rather than
    # decorative glazed/shuttered inserts. The low service door is the only articulated opening.
    make_aperture_wall(
        "T1_Wall_Front_Door",
        2.0,
        "daub_humble",
        (-1.0, 0.0, WALL_BASE_Z),
        opening_width=1.08,
        opening_height=2.02,
    )
    make_aperture_wall(
        "T1_Wall_Front_SquareHole",
        2.0,
        "daub_humble",
        (1.0, 0.0, WALL_BASE_Z),
        opening_width=0.42,
        opening_height=0.42,
        opening_sill=1.02,
        dark_backing=True,
    )
    place("opening_door_service_single", "T1_Door_Front", OPENINGS, (-1.0, -0.105, 0.33))

    # Horizontal plank boarding dominates the private sides and rear, following the regional
    # timber-first material hierarchy and the lower, workaday burgage references.
    make_aperture_wall(
        "T1_Wall_Rear",
        4.0,
        "timber_weathered_horizontal",
        (0.0, BUILDING_DEPTH, WALL_BASE_Z),
        math.pi,
    )
    # A 0.20 m side wall centred at +/-1.90 m places its exterior face exactly on
    # the +/-2.00 m roof-bearing line instead of piercing the descending roof plane.
    side_wall_height = WALL_HEIGHT - 0.10
    for side, rotation in ((-1.9, -math.pi / 2.0), (1.9, math.pi / 2.0)):
        label = "Left" if side < 0 else "Right"
        make_aperture_wall(
            f"T1_Wall_{label}_A",
            4.0,
            "timber_weathered_horizontal",
            (side, 2.0, WALL_BASE_Z),
            rotation,
            wall_height=side_wall_height,
        )
        make_aperture_wall(
            f"T1_Wall_{label}_SquareHole",
            2.0,
            "timber_weathered_horizontal",
            (side, 5.0, WALL_BASE_Z),
            rotation,
            opening_width=0.38,
            opening_height=0.38,
            opening_sill=1.08,
            dark_backing=True,
            wall_height=side_wall_height,
        )
        make_aperture_wall(
            f"T1_Wall_{label}_C",
            1.0,
            "timber_weathered_horizontal",
            (side, 6.5, WALL_BASE_Z),
            rotation,
            wall_height=side_wall_height,
        )

        # A low-poly longitudinal plate carries the visible roof bearing while
        # remaining safely inside the wall/roof envelope. It replaces the top
        # face of the side wall that previously pierced the shingle surface.
        plate_side = -1.0 if side < 0.0 else 1.0
        make_custom_part(
            f"T1_SideWallPlate_{'Left' if side < 0.0 else 'Right'}",
            FRAMES,
            [((0.0, 0.0, 0.0), (0.14, BUILDING_DEPTH - 0.12, 0.14))],
            "oak_dark",
            (plate_side * 1.80, BUILDING_DEPTH * 0.5, WALL_TOP_Z - 0.16),
            0.0,
            "assembly_custom_side_wall_plate",
        )

    front_gable = place("gable_infill_timber_4m", "T1_Gable_Front", WALLS, (0.0, -0.01, WALL_TOP_Z))
    rear_gable = place("gable_infill_timber_4m", "T1_Gable_Rear", WALLS, (0.0, BUILDING_DEPTH + 0.01, WALL_TOP_Z), math.pi)
    remap_instance_material(front_gable, "timber_weathered", "timber_weathered_horizontal")
    remap_instance_material(rear_gable, "timber_weathered", "timber_weathered_horizontal")
    # The reusable infill includes an exposed oak verge frame. On this deep-overhang
    # house those strips intersect the shingle skin at both gable ends, so retain the
    # boarding while the visible wall plate and inset gable establish the exterior
    # bearing line. Fully occluded common rafters belong to an interior/close-cutaway
    # LOD and are deliberately omitted from this game shell.
    remove_instance_material_geometry(front_gable, "oak_dark")
    remove_instance_material_geometry(rear_gable, "oak_dark")
    inset_gable_under_roof(front_gable)
    inset_gable_under_roof(rear_gable)

    # Only structurally legible sill, wall plate, and joiner posts remain on the front.
    place("frame_beam_4m_s0p16m", "T1_Front_Sill", FRAMES, (0.0, -0.112, WALL_BASE_Z))
    # The authored beam's bevel extends 0.089 m above its origin. Seat that top face
    # directly against the gable baseline instead of leaving a visible shadow gap.
    place("frame_beam_4m_s0p16m", "T1_Front_WallPlate", FRAMES, (0.0, -0.112, WALL_TOP_Z - 0.089))
    # The centre post can meet the gable baseline, but the four corner posts sit
    # beneath the sloping roof and must terminate below its concealed bearing zone.
    # Using the full 2.4 m kit posts here exposed their orange end grain through
    # both roof slopes at the gable ends.
    place("frame_post_h2p4m_s0p16m", "T1_Post_Front_Centre", FRAMES, (0.0, -0.112, WALL_BASE_Z))
    corner_post_height = WALL_HEIGHT - 0.20
    for face, y, rotation in (
        ("Front", -0.112, 0.0),
        ("Rear", BUILDING_DEPTH + 0.112, math.pi),
    ):
        for x in (-2.0, 2.0):
            make_custom_part(
                f"T1_Post_{face}_{x:+.0f}",
                FRAMES,
                [((0.0, 0.0, corner_post_height * 0.5), (0.16, 0.16, corner_post_height))],
                "oak_dark",
                (x, y, WALL_BASE_Z),
                rotation,
                "assembly_custom_short_corner_post",
            )


def roof_transform(side: float, slope_center: float) -> tuple[tuple[float, float], float]:
    x = side * (SLOPE_MAX - slope_center) * math.cos(PITCH)
    z = RIDGE_Z + (slope_center - SLOPE_MAX) * math.sin(PITCH)
    rotation = math.pi / 2.0 if side > 0 else -math.pi / 2.0
    return (x, z), rotation


ROOF_SETTLEMENT_KNOTS = (0.0, -0.018, -0.052, -0.074, -0.030, -0.020, -0.068, -0.108, -0.038)
ROOF_RIGHT_SETTLEMENT_KNOTS = (0.0, -0.004, -0.010, -0.016, -0.008, -0.012, -0.020, -0.014, -0.006)


def roof_settlement_knot(knot_index: int, side: float = 0.0) -> float:
    drop = ROOF_SETTLEMENT_KNOTS[knot_index]
    if side > 0.0:
        drop += ROOF_RIGHT_SETTLEMENT_KNOTS[knot_index]
    return drop


def roof_bearing_weight(world_x: float) -> float:
    """Pin the roof to its wall plate while retaining ridge sag and hanging eaves."""
    return min(1.0, abs(abs(world_x) - ROOF_BEARING_X) / 0.35)


def settle_roof_module(obj: bpy.types.Object, run_index: int, side: float = 0.0) -> None:
    """Apply one continuous longitudinal profile to shingles and their substrate."""
    if obj.type != "MESH" or not obj.data.vertices:
        return
    x_values = [vertex.co.x for vertex in obj.data.vertices]
    min_x = min(x_values)
    max_x = max(x_values)
    span = max(max_x - min_x, 0.001)
    start_drop = roof_settlement_knot(run_index, side)
    end_drop = roof_settlement_knot(run_index + 1, side)
    cosine = math.cos(obj.rotation_euler.z)
    sine = math.sin(obj.rotation_euler.z)
    for vertex in obj.data.vertices:
        blend = (vertex.co.x - min_x) / span
        longitudinal_drop = start_drop * (1.0 - blend) + end_drop * blend
        world_x = obj.location.x + vertex.co.x * cosine - vertex.co.y * sine
        vertex.co.z += longitudinal_drop * roof_bearing_weight(world_x)
    obj.data.update()
    obj["roof_settlement_start_m"] = round(start_drop, 4)
    obj["roof_settlement_end_m"] = round(end_drop, 4)


def roof_drop_interpolated(y: float, side: float = 0.0) -> float:
    """Sample the same edge-knot profile for a roof-mounted accessory."""
    knot_position = max(0.0, min(float(len(ROOF_SETTLEMENT_KNOTS) - 1), y + 0.5))
    lower = int(math.floor(knot_position))
    upper = min(lower + 1, len(ROOF_SETTLEMENT_KNOTS) - 1)
    blend = knot_position - lower
    return roof_settlement_knot(lower, side) * (1.0 - blend) + roof_settlement_knot(upper, side) * blend


def roof_eave_extension(run_y: float, side: float) -> float:
    """Small continuous hand-cut variation along the hanging shingle edge."""

    primary = 0.050 * math.sin(run_y * 2.17 + side * 0.63)
    secondary = 0.022 * math.sin(run_y * 5.31 - side * 0.42)
    return primary + secondary


def append_roof_skin_prism(
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, int, int, int]],
    side: float,
    slope_min: float,
    slope_max: float,
    run_min: float,
    run_max: float,
) -> None:
    """Append one closed, settlement-following low-poly shingle skin region."""
    if slope_max - slope_min <= 0.001 or run_max - run_min <= 0.001:
        return
    run_stations = [run_min]
    half_metre = math.ceil((run_min + 0.001) * 2.0) / 2.0
    while half_metre < run_max - 0.001:
        if half_metre > run_min + 0.001:
            run_stations.append(half_metre)
        half_metre += 0.5
    for knot_index in range(len(ROOF_SETTLEMENT_KNOTS)):
        knot_y = float(knot_index) - 0.5
        if run_min + 0.001 < knot_y < run_max - 0.001:
            run_stations.append(knot_y)
    run_stations.append(run_max)
    run_stations = sorted(set(round(value, 6) for value in run_stations))

    top_offset = -0.006
    bottom_offset = 0.12

    def point(slope_distance: float, run_y: float, normal_offset: float) -> tuple[float, float, float]:
        edge_weight = max(0.0, min(1.0, (slope_distance - (SLOPE_LENGTH - 0.58)) / 0.58))
        effective_slope = slope_distance + roof_eave_extension(run_y, side) * edge_weight
        world_x = (
            0.0
            if slope_distance <= 0.001
            else side * effective_slope * math.cos(PITCH) - side * math.sin(PITCH) * normal_offset
        )
        shared_drop = roof_drop_interpolated(run_y, 0.0)
        side_drop = roof_drop_interpolated(run_y, side) - shared_drop
        ridge_blend = min(1.0, slope_distance / 0.72)
        return (
            world_x,
            run_y,
            RIDGE_Z
            - effective_slope * math.sin(PITCH)
            + (shared_drop + side_drop * ridge_blend) * roof_bearing_weight(world_x)
            - math.cos(PITCH) * normal_offset,
        )

    start = len(vertices)
    for run_y in run_stations:
        vertices.extend(
            (
                point(slope_min, run_y, top_offset),
                point(slope_max, run_y, top_offset),
                point(slope_max, run_y, bottom_offset),
                point(slope_min, run_y, bottom_offset),
            )
        )
    for station_index in range(len(run_stations) - 1):
        current = start + station_index * 4
        following = current + 4
        faces.extend(
            (
                (current + 0, current + 1, following + 1, following + 0),
                (current + 3, following + 3, following + 2, current + 2),
                (current + 0, following + 0, following + 3, current + 3),
                (current + 1, current + 2, following + 2, following + 1),
            )
        )
    final = start + (len(run_stations) - 1) * 4
    faces.extend(
        (
            (start + 0, start + 3, start + 2, start + 1),
            (final + 0, final + 1, final + 2, final + 3),
        )
    )


def create_retopped_roof_skin(side: float) -> bpy.types.Object:
    """Create one closed textured roof skin; the right side contains a true smoke hole."""
    vertices: list[tuple[float, float, float]] = []
    vertex_metric_uv: list[tuple[float, float]] = []
    faces: list[tuple[int, ...]] = []
    # Both skins reach the common apex. Their closed upper boundaries overlap by
    # only the roof build-up thickness, closing the ridge without a separate cap
    # strip or a visible slot.
    slope_min = 0.0
    slope_max = SLOPE_LENGTH - 0.12
    run_min = -0.40
    run_max = BUILDING_DEPTH + 0.40
    aperture_slope = SMOKE_APERTURE_X / math.cos(PITCH)
    aperture_half_slope = 0.23
    aperture_half_run = 0.24
    aperture_slope_min = aperture_slope - aperture_half_slope
    aperture_slope_max = aperture_slope + aperture_half_slope
    aperture_run_min = SMOKE_APERTURE_Y - aperture_half_run
    aperture_run_max = SMOKE_APERTURE_Y + aperture_half_run

    slope_stations = {slope_min, slope_max, 2.2}
    run_stations = {run_min, run_max, 0.0, 2.2, 4.4, 6.6}
    cursor = math.ceil(slope_min * 2.0) / 2.0
    while cursor < slope_max:
        slope_stations.add(round(cursor, 6))
        cursor += 0.5
    cursor = math.ceil(run_min * 2.0) / 2.0
    while cursor < run_max:
        run_stations.add(round(cursor, 6))
        cursor += 0.5
    if side > 0.0:
        slope_stations.update((aperture_slope_min, aperture_slope_max))
        run_stations.update((aperture_run_min, aperture_run_max))
    slope_values = sorted(value for value in slope_stations if slope_min <= value <= slope_max)
    run_values = sorted(value for value in run_stations if run_min <= value <= run_max)

    active_cells: set[tuple[int, int]] = set()
    for slope_index in range(len(slope_values) - 1):
        slope_centre = (slope_values[slope_index] + slope_values[slope_index + 1]) * 0.5
        for run_index in range(len(run_values) - 1):
            run_centre = (run_values[run_index] + run_values[run_index + 1]) * 0.5
            inside_aperture = (
                side > 0.0
                and aperture_slope_min < slope_centre < aperture_slope_max
                and aperture_run_min < run_centre < aperture_run_max
            )
            if not inside_aperture:
                active_cells.add((slope_index, run_index))

    top_offset = -0.006
    # A 12.6 cm closed roof build-up represents shingles plus concealed boarding
    # and laths. Besides being structurally credible, it prevents screen-space
    # shadow/AO from interior wall plates leaking onto the exterior roof surface.
    bottom_offset = 0.12

    def surface_point(slope_distance: float, run_y: float, normal_offset: float) -> tuple[float, float, float]:
        edge_weight = max(0.0, min(1.0, (slope_distance - (SLOPE_LENGTH - 0.58)) / 0.58))
        effective_slope = slope_distance + roof_eave_extension(run_y, side) * edge_weight
        # Both closed skins share one exact apex curve. Side-specific settlement
        # fades in below the ridge; otherwise the capless roof would reveal the
        # closed brown edge of the lower skin wherever their heights diverged.
        world_x = (
            0.0
            if slope_distance <= 0.001
            else side * effective_slope * math.cos(PITCH) - side * math.sin(PITCH) * normal_offset
        )
        shared_drop = roof_drop_interpolated(run_y, 0.0)
        side_drop = roof_drop_interpolated(run_y, side) - shared_drop
        ridge_blend = min(1.0, slope_distance / 0.72)
        return (
            world_x,
            run_y,
            RIDGE_Z
            - effective_slope * math.sin(PITCH)
            + (shared_drop + side_drop * ridge_blend) * roof_bearing_weight(world_x)
            - math.cos(PITCH) * normal_offset,
        )

    vertex_indices: dict[tuple[int, int, int], int] = {}

    def vertex_index(slope_index: int, run_index: int, layer: int) -> int:
        key = (slope_index, run_index, layer)
        existing = vertex_indices.get(key)
        if existing is not None:
            return existing
        slope_distance = slope_values[slope_index]
        run_y = run_values[run_index]
        normal_offset = top_offset if layer == 0 else bottom_offset
        index = len(vertices)
        vertices.append(surface_point(slope_distance, run_y, normal_offset))
        # Explicit roof-space metric UVs keep rows aligned across the settled
        # surface and let every subdivided face fit inside a single atlas repeat.
        vertex_metric_uv.append((run_y, slope_distance))
        vertex_indices[key] = index
        return index

    for slope_index, run_index in sorted(active_cells):
        p00 = vertex_index(slope_index, run_index, 0)
        p10 = vertex_index(slope_index + 1, run_index, 0)
        p11 = vertex_index(slope_index + 1, run_index + 1, 0)
        p01 = vertex_index(slope_index, run_index + 1, 0)
        b00 = vertex_index(slope_index, run_index, 1)
        b10 = vertex_index(slope_index + 1, run_index, 1)
        b11 = vertex_index(slope_index + 1, run_index + 1, 1)
        b01 = vertex_index(slope_index, run_index + 1, 1)
        top_order = (p00, p10, p11, p01) if side > 0.0 else (p00, p01, p11, p10)
        bottom_by_top = {p00: b00, p10: b10, p11: b11, p01: b01}
        faces.append(top_order)
        faces.append(tuple(bottom_by_top[index] for index in reversed(top_order)))

        boundary_edges = set()
        if (slope_index, run_index - 1) not in active_cells:
            boundary_edges.add(frozenset((p00, p10)))
        if (slope_index + 1, run_index) not in active_cells:
            boundary_edges.add(frozenset((p10, p11)))
        if (slope_index, run_index + 1) not in active_cells:
            boundary_edges.add(frozenset((p11, p01)))
        if (slope_index - 1, run_index) not in active_cells:
            boundary_edges.add(frozenset((p01, p00)))
        for edge_index, start in enumerate(top_order):
            end = top_order[(edge_index + 1) % len(top_order)]
            if frozenset((start, end)) in boundary_edges:
                faces.append((start, end, bottom_by_top[end], bottom_by_top[start]))

    side_name = "Left" if side < 0.0 else "Right"
    mesh = bpy.data.meshes.new(f"T1_RoofSkin_{side_name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    uv_layer = mesh.uv_layers.new(name="GK_UV0")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            uv_layer.data[loop_index].uv = vertex_metric_uv[mesh.loops[loop_index].vertex_index]
    obj = bpy.data.objects.new(f"T1_RoofSkin_{side_name}", mesh)
    ROOF.objects.link(obj)
    bake_object_atlas_uvs(obj, "shingles")
    obj.data.materials.append(direct_atlas_material("shingles"))
    obj["t1_instance"] = True
    obj["source_component_id"] = "assembly_custom_retopped_shingle_skin"
    obj["assembly_role"] = ROOF.name
    obj["custom_assembly_piece"] = True
    obj["roof_topology"] = "connected subdivided closed skin meeting opposite slope at capless apex; atlas supplies individual shingle relief"
    obj["roof_grid_cells"] = len(active_cells)
    if side > 0.0:
        obj["roof_aperture_id"] = "tier1-smoke-exit"
        obj["roof_aperture_method"] = "closed roof-skin regions arranged around rectangular void"
    PLACEMENTS.append(
        {
            "name": obj.name,
            "source": "assembly_custom_retopped_shingle_skin",
            "collection": ROOF.name,
            "location": [0.0, 0.0, 0.0],
            "rotationZDegrees": 0.0,
        }
    )
    return obj


def place_roof() -> None:
    # Two closed low-poly skins carry the production split-shingle atlas.  The
    # texture/normal maps supply individual shingle relief while longitudinal
    # settlement and the irregular hanging eave remain authored in the silhouette.
    # This replaces 48 repeated solid shingle panels, which dominated the earlier
    # 24k-triangle assembly without adding useful medium-distance shape information.
    for side in (-1.0, 1.0):
        create_retopped_roof_skin(side)

    # A Tier-1 smoke exit is an actual void through the shingles. Runtime owns the emitted
    # smoke; no surface decal, projecting hood, cap, or later-tier chimney is authored.


def place_fixed_architecture() -> None:
    # Permanent entrance construction. Inventory-driven firewood is owned by ResidenceMarkers.
    threshold = place("foundation_steps_limestone_1", "T1_Threshold_Steps", FIXED_ARCHITECTURE, (-1.0, -0.56, 0.0))
    remap_instance_material(threshold, "limestone_warm", "fieldstone_weathered")


def remove_source_library_objects() -> None:
    for obj in list(bpy.data.objects):
        if not obj.get("t1_instance"):
            bpy.data.objects.remove(obj, do_unlink=True)
    for source_collection in list(bpy.data.collections):
        if source_collection.name.startswith("GK_") and not source_collection.objects:
            bpy.data.collections.remove(source_collection)


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
    point_camera(key, (0.0, 3.2, 2.2))
    fill = add_light("T1_Fill", "AREA", (7.0, -1.0, 6.0), 900.0, (0.53, 0.69, 1.0), 5.0)
    point_camera(fill, (0.0, 3.5, 2.0))
    rim = add_light("T1_Rim", "AREA", (-4.0, 9.0, 8.0), 1150.0, (0.72, 0.83, 1.0), 4.0)
    point_camera(rim, (0.0, 3.5, 3.0))
    sun = add_light("T1_Sun", "SUN", (0.0, 0.0, 10.0), 2.2, (1.0, 0.74, 0.48))
    sun.rotation_euler = (math.radians(26.0), math.radians(-18.0), math.radians(-38.0))
    sun.data.angle = math.radians(8.0)

    camera_data = bpy.data.cameras.new("T1_Hero_Camera")
    camera = bpy.data.objects.new("T1_Hero_Camera", camera_data)
    PREVIEW.objects.link(camera)
    camera.location = (11.5, -14.5, 7.3)
    camera_data.lens = 58.0
    point_camera(camera, (0.0, 3.15, 2.55))
    camera["preview_only"] = True
    scene.camera = camera


def render_alignment_views() -> None:
    scene = bpy.context.scene
    camera = scene.camera
    hero_location = camera.location.copy()
    hero_rotation = camera.rotation_euler.copy()
    hero_lens = camera.data.lens

    for filepath, location, target, lens in (
        (OUT_FRONT_RENDER, (0.0, -16.0, 4.55), (0.0, 0.8, 2.80), 58.0),
        (OUT_SIDE_RENDER, (24.0, 3.5, 5.35), (0.0, 3.5, 2.75), 58.0),
    ):
        camera.location = location
        camera.data.lens = lens
        point_camera(camera, target)
        scene.render.filepath = str(filepath)
        bpy.ops.render.render(write_still=True)

    camera.location = hero_location
    camera.rotation_euler = hero_rotation
    camera.data.lens = hero_lens
    scene.render.filepath = str(OUT_RENDER)


def write_manifest() -> None:
    payload = {
        "id": "gorski-tier1-residence-atlas-preview-v3",
        "regionalContext": "Gorski Kotar, circa 1550",
        "sourceKit": "gorski-architecture-kit-1.1.0",
        "atlas": {
            "id": ATLAS_MANIFEST["id"],
            "albedo": str((ATLAS_DIR / "building_albedo_atlas.png").relative_to(ROOT)).replace("\\", "/"),
            "normal": str((ATLAS_DIR / "building_normal_atlas.png").relative_to(ROOT)).replace("\\", "/"),
            "material": str((ATLAS_DIR / "building_material_atlas.png").relative_to(ROOT)).replace("\\", "/"),
            "packing": "R roughness, G metalness, B AO, A centered height",
            "instanceUvPhase": "metric UVs are translated by snapped world placement so adjacent modules retain atlas continuity",
        },
        "dimensionsMetres": {
            "bodyWidth": 4.0,
            "bodyDepth": BUILDING_DEPTH,
            "foundationTop": WALL_BASE_Z,
            "wallHeight": WALL_HEIGHT,
            "wallTop": WALL_TOP_Z,
            "ridge": RIDGE_Z,
            "sideEaveOverhang": round(SLOPE_LENGTH * math.cos(PITCH) - 2.0, 4),
            "gableEndOverhang": 0.5,
        },
        "roofFinish": "hand-split softwood shingles",
        "eaveFinish": "raw hanging shingle edge; no applied fascia or paired eave-edge trim",
        "foundationAssembly": {
            "method": "four kit-authored L-corners with baked mirrored counterparts and two central side runs",
            "cornerCount": 4,
            "closedRectangle": True,
        },
        "roofIrregularity": {
            "method": "two closed retopologized roof skins joined directly at a capless apex, with half-metre eave stations and continuous piecewise-linear settlement attenuated to zero at the +/- 2.0 m wall-plate bearing",
            "surfaceDetail": "the split-shingle atlas supplies individual shingle albedo, normal, roughness, and AO detail instead of thousands of repeated closed shingle solids",
            "moduleEdgeDropsMetres": list(ROOF_SETTLEMENT_KNOTS),
            "rightSlopeAdditionalEdgeDropsMetres": list(ROOF_RIGHT_SETTLEMENT_KNOTS),
            "maximumDropMetres": round(abs(min(ROOF_SETTLEMENT_KNOTS)) + abs(min(ROOF_RIGHT_SETTLEMENT_KNOTS)), 4),
            "bearingLine": "roof settlement is pinned to zero at x = +/- 2.0 m; the 0.20 m side walls are inset so their exterior faces terminate on that line",
            "supports": "continuous timber wall-head courses, shortened corner posts, and inset boarded gables form the visible exterior bearing line; fully occluded common rafters are omitted from this exterior game LOD",
        },
        "historicalMaterialDecision": {
            "primaryBody": "weathered horizontal timber boarding on a dark moisture-stained fieldstone footing",
            "publicFront": "rough warm daub with blotchy staining and heavier accumulation toward grade, within a restrained structural frame",
            "roof": "irregular hand-split softwood shingles, replacing the earlier game-stylized thatch",
            "openings": "plain unglazed square light and ventilation holes; no decorative shutters or leaded glazing",
        },
        "atlasCoverage": {
            "usedNow": ["fieldstone-mortar", "lime-plaster", "rough-hewn-timber", "weathered-planks", "split-shingles", "wrought-iron", "packed-earth"],
            "sufficientForThisPass": True,
            "variantPolicy": "weathered fieldstone and worn daub are named material variants over shared atlas tiles; the clean global tiles remain unchanged for maintained and later-tier buildings",
            "recommendedFutureTiles": [
                "riven-softwood-boarding: hand-split fir or pine boards with irregular adze edges",
                "clay-straw-daub: coarser earthen infill with visible straw and restrained cracking",
            ],
        },
        "smokeExit": "approximately 0.46 x 0.48 m true void bounded by closed roof-skin regions; no surface decal, projecting hood, cap, or later-tier masonry chimney",
        "canonicalState": "neutral shell; no inventory, activity, or occupancy-driven dressing",
        "fixedArchitecture": {
            "threshold": "weathered fieldstone entrance step",
            "smokeOpening": "true mesh aperture through the retopologized shingle skin; empty in the neutral shell",
        },
        "runtimeOwnedState": {
            "firewoodPile": "ResidenceMarkers.syncFirewoodPile controls visibility and fill scale from household firewood stock",
            "smokeEmission": "ResidenceMarkers activates the emitter only for a populated, non-abandoned residence with firewood and fire enabled",
            "windowGlow": "ResidenceMarkers applies occupied household activity glow at runtime",
        },
        "livingVegetation": "excluded; SeedThree-owned",
        "placements": PLACEMENTS,
    }
    OUT_MANIFEST.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def export_glb() -> None:
    staged_path = OUT_GLB.with_name(f"{OUT_GLB.stem}.exporting{OUT_GLB.suffix}")
    staged_path.unlink(missing_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    export_objects = [
        obj
        for obj in bpy.data.objects
        if obj.get("t1_instance") and not obj.get("preview_only")
    ]
    for obj in export_objects:
        obj.select_set(True)
    if export_objects:
        bpy.context.view_layer.objects.active = export_objects[0]
    try:
        bpy.ops.export_scene.gltf(
            filepath=str(staged_path),
            export_format="GLB",
            use_selection=True,
            export_yup=True,
            export_apply=True,
            export_extras=True,
        )
        for attempt in range(12):
            try:
                staged_path.replace(OUT_GLB)
                break
            except PermissionError:
                if attempt == 11:
                    raise
                time.sleep(0.25)
    finally:
        staged_path.unlink(missing_ok=True)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    RENDER_DIR.mkdir(parents=True, exist_ok=True)
    place_shell()
    place_roof()
    place_fixed_architecture()
    remove_source_library_objects()
    add_preview_staging()
    stage_render()
    scene = bpy.context.scene
    scene["artifact_id"] = "gorski-tier1-residence-atlas-preview-v5"
    scene["architecture_context"] = "Gorski Kotar, circa 1550"
    scene["roof_finish"] = "hand-split softwood shingles"
    scene["atlas_id"] = ATLAS_MANIFEST["id"]
    scene["canonical_state"] = "neutral; runtime owns firewood, smoke emission, and window glow"
    scene["living_vegetation"] = "excluded; SeedThree-owned"
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    write_manifest()
    export_glb()
    bpy.ops.render.render(write_still=True)
    render_alignment_views()
    print(f"T1_BLEND={OUT_BLEND}")
    print(f"T1_GLB={OUT_GLB}")
    print(f"T1_RENDER={OUT_RENDER}")
    print(f"T1_PLACEMENTS={len(PLACEMENTS)}")


if __name__ == "__main__":
    main()
