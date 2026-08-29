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
OUTPUT_ROOT = Path(os.environ.get("GK_LUMBER_MILL_OUTPUT_ROOT", str(EXAMPLE_DIR))).resolve()
OUT_DIR = OUTPUT_ROOT / "out"
RENDER_DIR = OUTPUT_ROOT / "renders"
OUT_BLEND = OUT_DIR / "lumber_mill_textured_v1.blend"
OUT_GLB = OUT_DIR / "lumber_mill_textured_v1.glb"
OUT_MANIFEST = OUT_DIR / "lumber_mill_assembly_v1.json"
OUT_HERO = RENDER_DIR / "lumber_mill_hero_v1.png"
OUT_INTAKE = RENDER_DIR / "lumber_mill_intake_v1.png"
OUT_REAR = RENDER_DIR / "lumber_mill_rear_v1.png"
OUT_SETTLEMENT = RENDER_DIR / "lumber_mill_settlement_v1.png"


HELPER_PATH = EXAMPLE_DIR.parent / "hunters-camp" / "build_hunters_camp.py"
helper_spec = importlib.util.spec_from_file_location("gorski_lumber_texture_helper", HELPER_PATH)
if helper_spec is None or helper_spec.loader is None:
    raise RuntimeError(f"Could not load authored-building texture helper: {HELPER_PATH}")
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


FOUNDATION = collection("LM_01_Continuous_Footing")
HALL = collection("LM_02_Saw_Hall")
FRAME = collection("LM_03_Structural_Frame")
ROOF = collection("LM_04_Settled_Shingle_Roof")
INTAKE = collection("LM_05_Open_Intake")
EQUIPMENT = collection("LM_06_Fixed_Equipment")
PREVIEW = collection("LM_90_Preview_Staging")


texture_helper.MATERIAL_LOOKS.update({
    "fieldstone": ("fieldstone-mortar", (0.25, 0.27, 0.25, 1.0), 0.82, 0.86),
    "oak_dark": ("rough-hewn-timber", (0.105, 0.052, 0.021, 1.0), 0.92, 0.78),
    "timber_weathered": ("weathered-planks", (0.25, 0.145, 0.060, 1.0), 0.80, 0.78),
    "timber_cut": ("sawn-planks", (0.33, 0.175, 0.065, 1.0), 0.68, 0.70),
    "shingles": ("split-shingles", (0.135, 0.072, 0.030, 1.0), 0.96, 0.88),
    "shingles_aged": ("split-shingles", (0.075, 0.047, 0.029, 1.0), 0.99, 0.86),
    "iron": ("wrought-iron", (0.075, 0.080, 0.075, 1.0), 0.78, 0.52),
    "earth": ("packed-earth", (0.22, 0.17, 0.12, 1.0), 0.64, 0.52),
    "packed_earth": ("packed-earth", (0.25, 0.19, 0.135, 1.0), 0.50, 0.56),
})


def remap_materials(obj: bpy.types.Object, part_id: str) -> None:
    if obj.type != "MESH":
        return
    keys = [
        material.name.removeprefix("GK_Mat_") if material is not None else "timber_weathered"
        for material in obj.data.materials
    ]
    texture_helper.bake_atlas_uvs(obj, keys)
    for index, key in enumerate(keys):
        obj.data.materials[index] = texture_helper.atlas_material(key)


def place(
    part_id: str,
    name: str,
    target: bpy.types.Collection,
    location: tuple[float, float, float],
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    *,
    collision: bool = False,
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
    obj["lm_instance"] = True
    obj["lm_collision"] = collision
    obj["source_component_id"] = part_id
    obj["assembly_role"] = target.name
    obj["regional_context"] = "Gorski Kotar, circa 1550"
    target.objects.link(obj)
    texture_helper.phase_metric_uvs(obj, location, rotation[2])
    remap_materials(obj, part_id)
    PLACEMENTS.append({
        "name": name,
        "source": part_id,
        "collection": target.name,
        "location": [round(value, 5) for value in location],
        "rotationDegrees": [round(math.degrees(value), 4) for value in rotation],
        "collision": collision,
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
    obj["lm_instance"] = True
    obj["lm_collision"] = False
    obj["source_component_id"] = source_id
    obj["assembly_role"] = target.name
    obj["regional_context"] = "Gorski Kotar, circa 1550"
    PLACEMENTS.append({
        "name": name,
        "source": source_id,
        "collection": target.name,
        "location": [0.0, 0.0, 0.0],
        "rotationDegrees": [0.0, 0.0, 0.0],
        "collision": False,
    })
    return obj


def roof_skin(name: str, side: float, material_key: str) -> bpy.types.Object:
    front_y = -2.40
    rear_y = 3.60
    ridge_y = (front_y + rear_y) * 0.5
    wall_top = 3.35
    half_depth = 3.0
    ridge_z = wall_top + half_depth * math.tan(math.radians(50.0)) + 0.10
    eave_y = ridge_y + side * (half_depth + 0.40)
    stations = (-6.40, -3.20, 0.0, 3.20, 6.40)
    sag = (-0.012, -0.035, -0.055, -0.028, -0.006)
    eave_wander = (0.014, -0.025, 0.018, -0.014, 0.026)
    top: list[tuple[float, float, float]] = []
    for index, x in enumerate(stations):
        ridge_point = (x, ridge_y, ridge_z + sag[index] * 0.55)
        eave_point = (x, eave_y + side * eave_wander[index], wall_top - 0.045 + sag[index])
        middle = (
            x,
            (ridge_point[1] + eave_point[1]) * 0.5,
            (ridge_point[2] + eave_point[2]) * 0.5 - 0.018,
        )
        top.extend((ridge_point, middle, eave_point))
    thickness = 0.095
    vertices = top + [(x, y, z - thickness) for x, y, z in top]
    faces: list[tuple[int, ...]] = []
    layer = len(top)
    for station in range(len(stations) - 1):
        for band in range(2):
            start = station * 3 + band
            following = (station + 1) * 3 + band
            faces.append((start, following, following + 1, start + 1))
            faces.append((layer + start + 1, layer + following + 1, layer + following, layer + start))
    faces.extend([
        (0, 1, 2, layer + 2, layer + 1, layer),
        (12, layer + 12, layer + 13, layer + 14, 14, 13),
    ])
    for station in range(len(stations) - 1):
        ridge = station * 3
        next_ridge = (station + 1) * 3
        eave = ridge + 2
        next_eave = next_ridge + 2
        faces.append((ridge, layer + ridge, layer + next_ridge, next_ridge))
        faces.append((eave, next_eave, layer + next_eave, layer + eave))
    return custom_mesh(name, vertices, faces, material_key, ROOF, "assembly_custom_settled_shingle_skin")


def assemble_foundation() -> None:
    for face, y, rz in (("Front", -2.40, 0.0), ("Rear", 3.60, math.pi)):
        for index, x in enumerate((-4.0, 0.0, 4.0), start=1):
            place("foundation_fieldstone_4m_h0p35m", f"LM_{face}_Footing_{index}", FOUNDATION, (x, y, 0.0), (0.0, 0.0, rz))
    for side, x, rz in (("West", -6.0, -math.pi * 0.5), ("East", 6.0, math.pi * 0.5)):
        place("foundation_fieldstone_4m_h0p35m", f"LM_{side}_Footing_Long", FOUNDATION, (x, -0.40, 0.0), (0.0, 0.0, rz))
        place("foundation_fieldstone_2m_h0p35m", f"LM_{side}_Footing_Short", FOUNDATION, (x, 2.60, 0.0), (0.0, 0.0, rz))


def assemble_hall() -> None:
    base = 0.35
    wall_top = 3.35
    for index, x in enumerate((-4.0, 0.0, 4.0), start=1):
        place("wall_plank_4m_h3m", f"LM_Rear_Plank_Bay_{index}", HALL, (x, 3.60, base), (0.0, 0.0, math.pi), collision=True)
    for label, x in (("West", -4.0), ("East", 4.0)):
        place("wall_plank_4m_h3m", f"LM_Front_{label}_Plank_Bay", HALL, (x, -2.40, base), collision=True)
    for side, x, rz in (("West", -6.0, -math.pi * 0.5), ("East", 6.0, math.pi * 0.5)):
        place("wall_plank_4m_h3m", f"LM_{side}_Wall_Long", HALL, (x, -0.40, base), (0.0, 0.0, rz), collision=True)
        place("wall_plank_2m_h3m", f"LM_{side}_Wall_Short", HALL, (x, 2.60, base), (0.0, 0.0, rz), collision=True)
        place("gable_infill_timber_6m", f"LM_{side}_Six_Metre_Gable", HALL, (x + (0.05 if side == "West" else -0.05), 0.60, wall_top - 0.04), (0.0, 0.0, rz))
        place("frame_gable_truss_6m", f"LM_{side}_King_Post_Truss", FRAME, (x + (-0.095 if side == "West" else 0.095), 0.60, wall_top - 0.30), (0.0, 0.0, rz))

    for face, y, rz in (("Front", -2.51, 0.0), ("Rear", 3.71, math.pi)):
        for index, x in enumerate((-6.0, -2.0, 2.0, 6.0), start=1):
            place("frame_post_h3m_s0p22m", f"LM_{face}_Structural_Post_{index}", FRAME, (x, y, base - 0.035), (0.0, 0.0, rz))
        for index, x in enumerate((-4.0, 0.0, 4.0), start=1):
            place("frame_beam_4m_s0p22m", f"LM_{face}_Wall_Plate_{index}", FRAME, (x, y, wall_top - 0.14), (0.0, 0.0, rz))
    for side, x, rz in (("West", -6.11, -math.pi * 0.5), ("East", 6.11, math.pi * 0.5)):
        place("frame_post_h3m_s0p22m", f"LM_{side}_Middle_Post", FRAME, (x, 1.60, base - 0.035), (0.0, 0.0, rz))
        place("frame_beam_4m_s0p22m", f"LM_{side}_Wall_Plate_Long", FRAME, (x, -0.40, wall_top - 0.14), (0.0, 0.0, rz))
        place("frame_beam_2m_s0p22m", f"LM_{side}_Wall_Plate_Short", FRAME, (x, 2.60, wall_top - 0.14), (0.0, 0.0, rz))


def assemble_roof_and_workside() -> None:
    roof_skin("LM_Front_Settled_Shingle_Slope", -1.0, "shingles_aged")
    roof_skin("LM_Rear_Settled_Shingle_Slope", 1.0, "shingles")
    place("site_canopy_timber_6m_d3m", "LM_Open_Intake_Canopy", INTAKE, (0.0, -3.30, 0.0))
    place("production_sawpit_frame", "LM_Hand_Sawpit_And_Log_Frame", EQUIPMENT, (-0.80, -4.00, 0.0), collision=True)
    place("prop_tool_rack_carpenter", "LM_Sawyers_Tool_Rack", EQUIPMENT, (-4.85, -2.68, 0.0), (0.0, 0.0, math.radians(-3.0)))
    place("prop_two_wheel_cart", "LM_Timber_Transport_Cart", EQUIPMENT, (4.05, -4.00, 0.0), (0.0, 0.0, math.radians(11.0)), collision=True)


def remove_source_library_objects() -> None:
    for obj in list(bpy.data.objects):
        if not obj.get("lm_instance"):
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


def add_preview_ground() -> None:
    bpy.ops.mesh.primitive_plane_add(size=28.0, location=(0.0, 0.0, -0.025))
    ground = bpy.context.object
    ground.name = "LM_Preview_Packed_Earth_Yard"
    ground.data.uv_layers.active.name = "GK_UV0"
    for uv in ground.data.uv_layers.active.data:
        uv.uv *= 14.0
    texture_helper.bake_atlas_uvs(ground, ["packed_earth"])
    ground.data.materials.append(texture_helper.atlas_material("packed_earth"))
    link_preview(ground)


def stage_preview() -> bpy.types.Object:
    add_preview_ground()
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
    scene.view_settings.exposure = -0.30
    if scene.world is None:
        scene.world = bpy.data.worlds.new("LM_Preview_World")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.026, 0.044, 0.052, 1.0)
    background.inputs["Strength"].default_value = 0.34

    key = add_light("LM_Key", "AREA", (-10.0, -10.0, 14.0), 1650.0, (1.0, 0.88, 0.70), 9.0)
    point_at(key, (0.0, -0.3, 2.4))
    fill = add_light("LM_Fill", "AREA", (10.0, -1.0, 8.0), 520.0, (0.58, 0.70, 1.0), 7.0)
    point_at(fill, (0.0, 0.0, 2.2))
    rim = add_light("LM_Rim", "AREA", (-8.0, 9.0, 11.0), 760.0, (1.0, 0.79, 0.55), 7.0)
    point_at(rim, (0.0, 0.8, 2.5))
    work_fill = add_light("LM_Work_Fill", "AREA", (-1.5, -9.0, 4.2), 720.0, (0.78, 0.84, 1.0), 4.0)
    point_at(work_fill, (-0.8, -3.9, 1.0))
    sun = add_light("LM_Sun", "SUN", (0.0, 0.0, 12.0), 1.25, (1.0, 0.92, 0.80))
    sun.rotation_euler = (math.radians(28.0), math.radians(-16.0), math.radians(-38.0))
    sun.data.angle = math.radians(7.0)

    camera_data = bpy.data.cameras.new("LM_Hero_Camera")
    camera = bpy.data.objects.new("LM_Hero_Camera", camera_data)
    PREVIEW.objects.link(camera)
    camera.location = (-14.2, -15.8, 9.4)
    camera_data.lens = 58.0
    point_at(camera, (0.0, -0.65, 2.20))
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
    camera.location = (-5.2, -13.0, 5.1)
    camera.data.lens = 62.0
    point_at(camera, (-0.8, -3.40, 1.20))
    render_atomic(OUT_INTAKE)
    camera.location = (-14.0, 11.8, 8.6)
    camera.data.lens = 58.0
    point_at(camera, (0.0, 0.80, 2.25))
    render_atomic(OUT_REAR)
    camera.location = (19.0, -23.0, 14.5)
    camera.data.lens = 68.0
    point_at(camera, (0.0, 0.0, 2.0))
    render_atomic(OUT_SETTLEMENT)


def fixed_objects() -> list[bpy.types.Object]:
    return [obj for obj in bpy.data.objects if obj.get("lm_instance") and not obj.get("preview_only")]


def write_manifest() -> None:
    objects = fixed_objects()
    points = [obj.matrix_world @ vertex.co for obj in objects for vertex in obj.data.vertices]
    minimum = Vector((min(point.x for point in points), min(point.y for point in points), min(point.z for point in points)))
    maximum = Vector((max(point.x for point in points), max(point.y for point in points), max(point.z for point in points)))
    dimensions = maximum - minimum
    payload = {
        "id": "gorski-lumber-mill-atlas-preview-v1",
        "revision": 1,
        "authoritativeBuildingKind": "lumber_mill",
        "displayIdentity": "Lumber Mill",
        "regionalContext": "Gorski Kotar, circa 1550",
        "sourceKit": "gorski-architecture-kit-1.1.0",
        "dimensionsMetres": {
            "artFootprintWidth": round(dimensions.x, 4),
            "artFootprintDepth": round(dimensions.y, 4),
            "maximumHeight": round(maximum.z, 4),
        },
        "designIntent": "A long, low hand-sawing hall whose open road-facing intake and deep roof communicate timber processing without an anachronistic circular saw.",
        "signatureSilhouette": "A broad six-metre gable roof over a low twelve-metre hall, with a lower open intake canopy projecting toward the road.",
        "construction": {
            "hall": "Twelve-metre weathered plank hall on a continuous low fieldstone ring, divided into canonical four- and two-metre bays.",
            "roof": "Settled fifty-degree split-fir/pine shingle slopes with deep eaves and protected verges; the closed slopes meet directly at the ridge without a beam-like cap.",
            "frame": "Dark oak posts and plates carry reusable six-metre king-post trusses; all fixed beams terminate at structural members.",
            "intake": "A six-by-three-metre supported work canopy shelters the hand-sawpit and log frame while leaving a clear road-facing bay.",
        },
        "canonicalState": "Fixed mill architecture, saw frame, tool rack, and transport cart only; stored roundwood remains runtime-state-owned.",
        "runtimeOwnedState": {
            "timberInventory": "Five progressive runtime log-stack segments remain hidden at zero stored timber.",
            "workersAndMotion": "Workers, active sawing animation, dust, and sound are runtime-owned.",
            "vegetation": "Excluded; SeedThree owns every living plant and forest layer.",
        },
        "atlas": {
            "id": texture_helper.ATLAS_MANIFEST["id"],
            "usedTiles": ["fieldstone-mortar", "rough-hewn-timber", "weathered-planks", "sawn-planks", "split-shingles", "wrought-iron", "packed-earth"],
        },
        "retopology": {
            "profile": "gameplay-v1",
            "method": "Canonical kit walls, frames, gables, canopy and tools plus two closed low-poly roof skins; no blanket bevel or decimation.",
        },
        "placements": PLACEMENTS,
    }
    OUT_MANIFEST.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def export_glb() -> None:
    staging = OUT_GLB.with_name(f"{OUT_GLB.stem}.exporting{OUT_GLB.suffix}")
    staging.unlink(missing_ok=True)
    objects = fixed_objects()
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
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
    assemble_foundation()
    assemble_hall()
    assemble_roof_and_workside()
    remove_source_library_objects()
    camera = stage_preview()
    scene = bpy.context.scene
    scene["artifact_id"] = "gorski-lumber-mill-atlas-preview-v1"
    scene["authoritative_building_kind"] = "lumber_mill"
    scene["architecture_context"] = "Gorski Kotar, circa 1550"
    scene["canonical_state"] = "fixed saw hall and equipment; runtime owns stored timber, workers, and effects"
    scene["signature_silhouette"] = "long low six-metre-gabled saw hall with lower open intake canopy"
    scene["atlas_id"] = texture_helper.ATLAS_MANIFEST["id"]
    scene["living_vegetation"] = "excluded; SeedThree-owned"
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    write_manifest()
    export_glb()
    render_views(camera)
    print(f"LM_BLEND={OUT_BLEND}")
    print(f"LM_GLB={OUT_GLB}")
    print(f"LM_HERO={OUT_HERO}")
    print(f"LM_INTAKE={OUT_INTAKE}")
    print(f"LM_PLACEMENTS={len(PLACEMENTS)}")


if __name__ == "__main__":
    main()
