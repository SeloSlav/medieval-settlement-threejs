from __future__ import annotations

import json
import math
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[4]
EXAMPLE_DIR = Path(__file__).resolve().parent
OUT_DIR = EXAMPLE_DIR / "out"
RENDER_DIR = EXAMPLE_DIR / "renders"
ATLAS_DIR = ROOT / "public" / "assets" / "textures" / "buildings" / "gorski_building_atlas_v1"
OUT_BLEND = OUT_DIR / "tier1_residence_textured.blend"
OUT_GLB = OUT_DIR / "tier1_residence_textured.glb"
OUT_MANIFEST = OUT_DIR / "tier1_residence_assembly.json"
OUT_RENDER = RENDER_DIR / "tier1_residence_hero_structural_v18.png"
OUT_FRONT_RENDER = RENDER_DIR / "tier1_residence_front_structural_v18.png"
OUT_SIDE_RENDER = RENDER_DIR / "tier1_residence_side_structural_v18.png"

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
) -> bpy.types.Object:
    depth = 0.20
    if opening_width is None or opening_height is None:
        boxes = [((0.0, 0.0, WALL_HEIGHT / 2.0), (width, depth, WALL_HEIGHT))]
    else:
        left = opening_x - opening_width / 2.0
        right = opening_x + opening_width / 2.0
        boxes = [
            (((-width / 2.0 + left) / 2.0, 0.0, WALL_HEIGHT / 2.0), (left + width / 2.0, depth, WALL_HEIGHT)),
            (((right + width / 2.0) / 2.0, 0.0, WALL_HEIGHT / 2.0), (width / 2.0 - right, depth, WALL_HEIGHT)),
            ((opening_x, 0.0, opening_sill / 2.0), (opening_width, depth, opening_sill)),
            (
                (opening_x, 0.0, (opening_sill + opening_height + WALL_HEIGHT) / 2.0),
                (opening_width, depth, WALL_HEIGHT - opening_sill - opening_height),
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


def place_shell() -> None:
    # A low rubble footing protects the timber body without turning Tier 1 into a stone house.
    front_foundation = place("foundation_fieldstone_4m_h0p35m", "T1_Foundation_Front", FOUNDATION, (0.0, 0.0, 0.0))
    rear_foundation = place("foundation_fieldstone_4m_h0p35m", "T1_Foundation_Rear", FOUNDATION, (0.0, BUILDING_DEPTH, 0.0), math.pi)
    remap_instance_material(front_foundation, "fieldstone", "fieldstone_weathered")
    remap_instance_material(rear_foundation, "fieldstone", "fieldstone_weathered")
    for side, rotation in ((-2.0, -math.pi / 2.0), (2.0, math.pi / 2.0)):
        label = "Left" if side < 0 else "Right"
        side_a = place("foundation_fieldstone_4m_h0p35m", f"T1_Foundation_{label}_A", FOUNDATION, (side, 2.0, 0.0), rotation)
        side_b = place("foundation_fieldstone_2m_h0p35m", f"T1_Foundation_{label}_B", FOUNDATION, (side, 5.0, 0.0), rotation)
        side_c = place("foundation_fieldstone_1m_h0p35m", f"T1_Foundation_{label}_C", FOUNDATION, (side, 6.5, 0.0), rotation)
        for footing in (side_a, side_b, side_c):
            remap_instance_material(footing, "fieldstone", "fieldstone_weathered")

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
    for side, rotation in ((-2.0, -math.pi / 2.0), (2.0, math.pi / 2.0)):
        label = "Left" if side < 0 else "Right"
        make_aperture_wall(
            f"T1_Wall_{label}_A",
            4.0,
            "timber_weathered_horizontal",
            (side, 2.0, WALL_BASE_Z),
            rotation,
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
        )
        make_aperture_wall(
            f"T1_Wall_{label}_C",
            1.0,
            "timber_weathered_horizontal",
            (side, 6.5, WALL_BASE_Z),
            rotation,
        )

    front_gable = place("gable_infill_timber_4m", "T1_Gable_Front", WALLS, (0.0, -0.01, WALL_TOP_Z))
    rear_gable = place("gable_infill_timber_4m", "T1_Gable_Rear", WALLS, (0.0, BUILDING_DEPTH + 0.01, WALL_TOP_Z), math.pi)
    remap_instance_material(front_gable, "timber_weathered", "timber_weathered_horizontal")
    remap_instance_material(rear_gable, "timber_weathered", "timber_weathered_horizontal")
    # The reusable infill includes an exposed oak verge frame. On this deep-overhang
    # house those strips intersect the shingle skin at both gable ends, so retain the
    # boarding while the independent inset common rafters carry the roof below it.
    remove_instance_material_geometry(front_gable, "oak_dark")
    remove_instance_material_geometry(rear_gable, "oak_dark")

    # Only structurally legible sill, wall plate, and joiner posts remain on the front.
    place("frame_beam_4m_s0p16m", "T1_Front_Sill", FRAMES, (0.0, -0.112, WALL_BASE_Z))
    # The authored beam's bevel extends 0.089 m above its origin. Seat that top face
    # directly against the gable baseline instead of leaving a visible shadow gap.
    place("frame_beam_4m_s0p16m", "T1_Front_WallPlate", FRAMES, (0.0, -0.112, WALL_TOP_Z - 0.089))
    for x in (-2.0, 0.0, 2.0):
        place("frame_post_h2p4m_s0p16m", f"T1_Post_Front_{x:+.0f}", FRAMES, (x, -0.112, WALL_BASE_Z))
    for x in (-2.0, 2.0):
        place("frame_post_h2p4m_s0p16m", f"T1_Post_Rear_{x:+.0f}", FRAMES, (x, BUILDING_DEPTH + 0.112, WALL_BASE_Z), math.pi)


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
    for vertex in obj.data.vertices:
        blend = (vertex.co.x - min_x) / span
        vertex.co.z += start_drop * (1.0 - blend) + end_drop * blend
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


def place_roof_supports() -> None:
    # Repeated rafter pairs bear on the existing continuous timber wall-head courses
    # and meet at the ridge. Their local
    # settlement matches the shingle skin at the same longitudinal station.
    eave_x = SLOPE_LENGTH * math.cos(PITCH)
    common_rafter_stations = (0.05, 1.4, 2.8, 4.2, 5.6, 6.95)
    rafter_clearance = 0.22
    for station_index, y in enumerate(common_rafter_stations):
        for side in (-1.0, 1.0):
            side_name = "Left" if side < 0.0 else "Right"
            rafter_x = side * eave_x / 2.0 - side * math.sin(PITCH) * rafter_clearance
            rafter_z = (
                (EAVE_Z + RIDGE_Z) / 2.0
                - math.cos(PITCH) * rafter_clearance
                + roof_drop_interpolated(y, side)
            )
            rafter = make_custom_part(
                f"T1_CommonRafter_{station_index:02d}_{side_name}",
                FRAMES,
                [((0.0, 0.0, 0.0), (SLOPE_LENGTH - 0.05, 0.15, 0.17))],
                "roof_support_dark",
                (rafter_x, y, rafter_z),
                0.0,
                "assembly_custom_common_rafter",
            )
            rafter.rotation_euler[1] = side * PITCH
            rafter["rotation_y_degrees"] = round(math.degrees(side * PITCH), 4)
            PLACEMENTS[-1]["rotationYDegrees"] = round(math.degrees(side * PITCH), 4)

    # Three tie beams connect opposing wall heads and make the roof thrust legible.
    for station_index, y in enumerate((1.4, 3.5, 5.6)):
        make_custom_part(
            f"T1_RoofTieBeam_{station_index:02d}",
            FRAMES,
            [((0.0, 0.0, 0.0), (3.92, 0.16, 0.16))],
            "oak_dark",
            (0.0, y, WALL_TOP_Z - 0.18),
            0.0,
            "assembly_custom_roof_tie_beam",
        )


def cut_roof_smoke_aperture(smoke_x: float, smoke_y: float, smoke_surface_z: float) -> int:
    """Remove complete closed shingle solids to leave a real, manifold smoke opening."""
    aperture_center = Vector((smoke_x, smoke_y, smoke_surface_z))
    downslope = Vector((math.cos(PITCH), 0.0, -math.sin(PITCH)))
    half_slope = 0.20
    half_run = 0.21
    cut_panel_count = 0
    bpy.context.view_layer.update()
    for panel in tuple(ROOF.objects):
        if panel.type != "MESH" or not panel.name.startswith("T1_Roof_Right_Run"):
            continue
        bm = bmesh.new()
        bm.from_mesh(panel.data)
        remaining_faces = set(bm.faces)
        vertices_to_remove = set()
        while remaining_faces:
            seed = remaining_faces.pop()
            component_faces = {seed}
            frontier = [seed]
            while frontier:
                face = frontier.pop()
                for edge in face.edges:
                    for neighbour in edge.link_faces:
                        if neighbour in remaining_faces:
                            remaining_faces.remove(neighbour)
                            component_faces.add(neighbour)
                            frontier.append(neighbour)
            component_vertices = {vertex for face in component_faces for vertex in face.verts}
            world_points = [panel.matrix_world @ vertex.co for vertex in component_vertices]
            slope_coordinates = [(point - aperture_center).dot(downslope) for point in world_points]
            run_coordinates = [point.y - smoke_y for point in world_points]
            overlaps_slope = max(slope_coordinates) >= -half_slope and min(slope_coordinates) <= half_slope
            overlaps_run = max(run_coordinates) >= -half_run and min(run_coordinates) <= half_run
            if overlaps_slope and overlaps_run:
                vertices_to_remove.update(component_vertices)

        if vertices_to_remove:
            bmesh.ops.delete(bm, geom=list(vertices_to_remove), context="VERTS")
            bm.to_mesh(panel.data)
            panel.data.update()
            panel["roof_aperture_id"] = "tier1-smoke-exit"
            panel["roof_aperture_method"] = "removed intersecting closed shingle solids"
            cut_panel_count += 1
        bm.free()

    if cut_panel_count == 0:
        raise RuntimeError("Tier-1 smoke aperture did not intersect any roof shingle solids")
    return cut_panel_count


def place_roof() -> None:
    # Full + half + quarter authored courses form a 4.2 m slope. On a four-metre
    # body this produces a roof-dominant 0.70 m side overhang without stretching geometry.
    # Eight one-metre runs extend 0.50 m beyond each gable end. Each complete module is
    # settled as one unit so the imperfect silhouette never exposes the oak substrate.
    runs = tuple(("1m", float(index)) for index in range(8))
    # Small downslope overlaps keep the dark panel substrate from reading as a
    # misplaced batten where the authored full/half/quarter courses meet.
    slope_courses = (("full", -0.82), ("half", 0.8), ("quarter", 1.68))
    for side in (-1.0, 1.0):
        side_name = "Left" if side < 0 else "Right"
        for run_index, (run_token, y) in enumerate(runs):
            for course_name, centre in slope_courses:
                (x, z), rotation = roof_transform(side, centre)
                # Each upslope module laps over the course below it. The small normal
                # rise prevents the full/half boundary from exposing a timber-like band.
                course_relief = {"full": 0.0, "half": 0.032, "quarter": 0.050}[course_name]
                x += side * math.sin(PITCH) * course_relief
                z += math.cos(PITCH) * course_relief
                panel = place(
                    f"roof_shingle_panel_{run_token}_{course_name}",
                    f"T1_Roof_{side_name}_Run{run_index:02d}_{course_name}",
                    ROOF,
                    (x, y, z),
                    rotation,
                )
                # The reusable panel's continuous backing closes incidental gaps between
                # individually modelled shingles. Treat it as an aged shingle undercourse,
                # not exposed structural oak; the smoke-aperture pass removes any backing
                # component intersecting the real roof opening.
                remap_instance_material(panel, "oak_dark", "shingles_aged")
                settle_roof_module(panel, run_index, side)

    eave_x = SLOPE_MAX * 2.0 * math.cos(PITCH)
    eave_z = RIDGE_Z - SLOPE_MAX * 2.0 * math.sin(PITCH)
    for side in (-1.0, 1.0):
        rotation = math.pi / 2.0 if side > 0 else -math.pi / 2.0
        side_name = "Left" if side < 0 else "Right"
        for run_index, (run_token, y) in enumerate(runs):
            eave = place(
                f"roof_shingle_eave_edge_{run_token}",
                f"T1_Eave_{side_name}_Run{run_index:02d}",
                ROOF,
                (side * eave_x, y, eave_z),
                rotation,
            )
            settle_roof_module(eave, run_index, side)

    for run_index, (run_token, y) in enumerate(runs):
        ridge = place(
            f"roof_shingle_ridge_{run_token}",
            f"T1_Ridge_Run{run_index:02d}",
            ROOF,
            (0.0, y, RIDGE_Z),
            math.pi / 2.0,
        )
        settle_roof_module(ridge, run_index)

    place(
        "roof_shingle_ridge_endcap",
        "T1_Ridge_Endcap_Front",
        ROOF,
        (0.0, -0.62, RIDGE_Z + roof_settlement_knot(0)),
        math.pi / 2.0,
    )
    place(
        "roof_shingle_ridge_endcap",
        "T1_Ridge_Endcap_Rear",
        ROOF,
        (0.0, BUILDING_DEPTH + 0.62, RIDGE_Z + roof_settlement_knot(8)),
        -math.pi / 2.0,
    )

    # A Tier-1 smoke exit is an actual void through the shingles. Runtime owns the emitted
    # smoke; no surface decal, projecting hood, cap, or later-tier chimney is authored.
    place_roof_supports()


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
        "roofIrregularity": {
            "method": "continuous piecewise-linear one-metre settlement; every shingle, substrate, ridge, and eave vertex follows the same longitudinal profile",
            "moduleEdgeDropsMetres": list(ROOF_SETTLEMENT_KNOTS),
            "rightSlopeAdditionalEdgeDropsMetres": list(ROOF_RIGHT_SETTLEMENT_KNOTS),
            "maximumDropMetres": round(abs(min(ROOF_SETTLEMENT_KNOTS)) + abs(min(ROOF_RIGHT_SETTLEMENT_KNOTS)), 4),
            "bearingLine": "roof plane intersects the continuous wall-head bearing at x = +/- 2.0 m",
            "supports": "continuous timber wall-head courses, six inset common rafter pairs, and three tie beams; all roof supports terminate beneath the shingle skin",
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
        "smokeExit": "approximately 0.40 x 0.42 m true void formed by removing every intersecting closed shingle solid; no surface decal, projecting hood, cap, or later-tier masonry chimney",
        "canonicalState": "neutral shell; no inventory, activity, or occupancy-driven dressing",
        "fixedArchitecture": {
            "threshold": "weathered fieldstone entrance step",
            "smokeOpening": "true mesh aperture through the overlapping shingle layers; empty in the neutral shell",
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
    bpy.ops.export_scene.gltf(
        filepath=str(OUT_GLB),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
    )


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    RENDER_DIR.mkdir(parents=True, exist_ok=True)
    place_shell()
    place_roof()
    place_fixed_architecture()
    remove_source_library_objects()
    smoke_surface_z = (
        RIDGE_Z
        - SMOKE_APERTURE_X * math.tan(PITCH)
        + roof_drop_interpolated(SMOKE_APERTURE_Y, 1.0)
    )
    cut_roof_smoke_aperture(SMOKE_APERTURE_X, SMOKE_APERTURE_Y, smoke_surface_z)
    add_preview_staging()
    stage_render()
    scene = bpy.context.scene
    scene["artifact_id"] = "gorski-tier1-residence-atlas-preview-v3"
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
