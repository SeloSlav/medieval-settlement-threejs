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
OUTPUT_ROOT = Path(os.environ.get("GK_MINEWORKS_OUTPUT_ROOT", str(EXAMPLE_DIR))).resolve()
OUT_DIR = OUTPUT_ROOT / "out"
RENDER_DIR = OUTPUT_ROOT / "renders"
OUT_BLEND = OUT_DIR / "mineworks_textured_v1.blend"
OUT_GLB = OUT_DIR / "mineworks_textured_v1.glb"
OUT_MANIFEST = OUT_DIR / "mineworks_assembly_v1.json"
OUT_HERO = RENDER_DIR / "mineworks_hero_v1.png"
OUT_OVERHEAD = RENDER_DIR / "mineworks_overhead_v1.png"
OUT_SHAFT = RENDER_DIR / "mineworks_shaft_headframe_v1.png"
OUT_HOIST = RENDER_DIR / "mineworks_service_yard_v1.png"
OUT_SORTING = RENDER_DIR / "mineworks_sorting_yard_v1.png"
OUT_REAR = RENDER_DIR / "mineworks_rear_v1.png"


HELPER_PATH = EXAMPLE_DIR.parent / "hunters-camp" / "build_hunters_camp.py"
helper_spec = importlib.util.spec_from_file_location("gorski_mineworks_texture_helper", HELPER_PATH)
if helper_spec is None or helper_spec.loader is None:
    raise RuntimeError(f"Could not load authored-camp texture helper: {HELPER_PATH}")
texture_helper = importlib.util.module_from_spec(helper_spec)
helper_spec.loader.exec_module(texture_helper)


texture_helper.MATERIAL_LOOKS.update({
    "quarry_stone": ("quarry-stone", (0.25, 0.27, 0.27, 1.0), 0.88, 0.86),
    "fieldstone": ("fieldstone-mortar", (0.29, 0.29, 0.26, 1.0), 0.84, 0.86),
    "limestone_warm": ("limestone-ashlar", (0.43, 0.40, 0.33, 1.0), 0.72, 0.72),
    "oak_dark": ("rough-hewn-timber", (0.115, 0.060, 0.028, 1.0), 0.90, 0.78),
    "timber_cut": ("sawn-planks", (0.36, 0.205, 0.088, 1.0), 0.66, 0.68),
    "timber_weathered": ("weathered-planks", (0.225, 0.145, 0.072, 1.0), 0.82, 0.78),
    "shingles": ("split-shingles", (0.12, 0.066, 0.030, 1.0), 0.95, 0.84),
    "iron": ("wrought-iron", (0.050, 0.047, 0.043, 1.0), 0.94, 0.72),
    "earth": ("packed-earth", (0.19, 0.14, 0.10, 1.0), 0.76, 0.58),
    "charcoal": ("packed-earth", (0.075, 0.080, 0.078, 1.0), 0.94, 0.46),
    "rope": ("wicker-weave", (0.31, 0.23, 0.14, 1.0), 0.90, 0.62),
})


SOURCES = {str(obj["gk_id"]): obj for obj in bpy.data.objects if obj.get("gk_id")}
PLACEMENTS: list[dict[str, object]] = []


def collection(name: str) -> bpy.types.Collection:
    current = bpy.data.collections.get(name)
    if current is None:
        current = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(current)
    return current


SHAFT = collection("MW_01_Shaft_And_Headframe")
SORTING = collection("MW_03_Sorting_Shelter")
EQUIPMENT = collection("MW_04_Fixed_Equipment")
PREVIEW = collection("MW_90_Preview_Staging")


def place(
    part_id: str,
    name: str,
    target: bpy.types.Collection,
    location: tuple[float, float, float],
    rotation_z: float = 0.0,
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
    obj.rotation_euler = (0.0, 0.0, rotation_z)
    obj.scale = (1.0, 1.0, 1.0)
    obj.modifiers.clear()
    obj["mw_instance"] = True
    obj["mw_collision"] = collision
    obj["source_component_id"] = part_id
    obj["assembly_role"] = target.name
    obj["regional_context"] = "Gorski Kotar, circa 1550"
    target.objects.link(obj)
    texture_helper.phase_metric_uvs(obj, location, rotation_z)
    texture_helper.replace_materials(obj)
    PLACEMENTS.append({
        "name": name,
        "source": part_id,
        "collection": target.name,
        "location": [round(value, 5) for value in location],
        "rotationZDegrees": round(math.degrees(rotation_z), 4),
        "collision": collision,
    })
    return obj


def assemble_mineworks() -> None:
    # The deep shaft and tall four-leg headframe share an exact centre. The
    # headframe remains visually open; the shaft collar alone owns collision.
    place(
        "extract_shaft_collar_square_large",
        "MW_Deep_Square_Shaft_Collar",
        SHAFT,
        (0.0, 0.75, 0.0),
        collision=True,
    )
    place(
        "extract_headframe_large",
        "MW_Tall_Timber_Winding_Headframe",
        SHAFT,
        (0.0, 0.75, 0.0),
    )
    place(
        "site_walkway_plank_4m",
        "MW_Roadside_Shaft_Walkway",
        SHAFT,
        (0.0, -2.45, 0.0),
        math.radians(90.0),
    )
    place(
        "extract_ore_bucket",
        "MW_Grounded_Hoist_Bucket",
        SHAFT,
        (1.55, 0.92, 0.0),
        math.radians(8.0),
    )

    # Ore preparation is a separate, broad work zone so the vertical hoist
    # remains the only dominant silhouette. Both benches sit under one roof.
    place(
        "site_canopy_timber_6m_d3m",
        "MW_Shingle_Ore_Sorting_Shelter",
        SORTING,
        (-6.25, 0.95, 0.0),
        math.radians(2.5),
    )
    place(
        "extract_sorting_bench",
        "MW_Hand_Sorting_Bench",
        SORTING,
        (-7.42, 0.92, 0.0),
        math.radians(2.5),
        collision=True,
    )
    place(
        "extract_sieve_table",
        "MW_Ore_And_Clay_Sieve",
        SORTING,
        (-4.92, 0.92, 0.0),
        math.radians(2.5),
        collision=True,
    )

    place(
        "extract_handcart",
        "MW_Empty_Ore_Handcart",
        EQUIPMENT,
        (5.65, -2.55, 0.0),
        math.radians(14.0),
        collision=True,
    )
    place(
        "prop_water_bucket_pair",
        "MW_Service_Water_Buckets",
        EQUIPMENT,
        (7.75, -0.62, 0.0),
        math.radians(6.0),
    )
    place(
        "prop_tool_rack_quarry",
        "MW_Fixed_Mining_Tool_Rack",
        EQUIPMENT,
        (-8.20, -1.72, 0.0),
        math.radians(5.0),
        collision=True,
    )


def remove_source_library_objects() -> None:
    for obj in list(bpy.data.objects):
        if not obj.get("mw_instance"):
            bpy.data.objects.remove(obj, do_unlink=True)
    for source_collection in list(bpy.data.collections):
        if source_collection.name.startswith(("GK_", "HC_")) and not source_collection.objects and not source_collection.children:
            bpy.data.collections.remove(source_collection)


def link_preview(obj: bpy.types.Object) -> None:
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    PREVIEW.objects.link(obj)
    obj["preview_only"] = True


def add_preview_ground() -> None:
    bpy.ops.mesh.primitive_plane_add(size=30.0, location=(0.0, 0.0, -0.035))
    ground = bpy.context.object
    ground.name = "MW_Preview_Packed_Earth_Worksite"
    ground.data.uv_layers.active.name = "GK_UV0"
    for uv in ground.data.uv_layers.active.data:
        uv.uv *= 15.0
    texture_helper.bake_atlas_uvs(ground, ["packed_earth"])
    ground.data.materials.append(texture_helper.atlas_material("packed_earth"))
    link_preview(ground)


def point_at(obj: bpy.types.Object, target: tuple[float, float, float]) -> None:
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_light(
    name: str,
    light_type: str,
    location: tuple[float, float, float],
    energy: float,
    color: tuple[float, float, float],
    size: float = 1.0,
) -> bpy.types.Object:
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
    scene.view_settings.exposure = -0.24
    if scene.world is None:
        scene.world = bpy.data.worlds.new("MW_Preview_World")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.027, 0.043, 0.050, 1.0)
    background.inputs["Strength"].default_value = 0.34

    key = add_light("MW_Key", "AREA", (-10.0, -12.0, 15.0), 1550.0, (1.0, 0.90, 0.74), 9.0)
    point_at(key, (0.0, 0.4, 1.9))
    fill = add_light("MW_Fill", "AREA", (12.0, -1.0, 9.0), 540.0, (0.56, 0.68, 1.0), 7.0)
    point_at(fill, (0.8, 0.6, 1.6))
    rim = add_light("MW_Rim", "AREA", (-7.0, 11.0, 11.0), 800.0, (1.0, 0.79, 0.57), 7.0)
    point_at(rim, (-0.4, 1.5, 2.0))
    sun = add_light("MW_Sun", "SUN", (0.0, 0.0, 12.0), 1.10, (1.0, 0.93, 0.82))
    sun.rotation_euler = (math.radians(30.0), math.radians(-14.0), math.radians(-38.0))
    sun.data.angle = math.radians(7.0)

    camera_data = bpy.data.cameras.new("MW_Hero_Camera")
    camera = bpy.data.objects.new("MW_Hero_Camera", camera_data)
    PREVIEW.objects.link(camera)
    camera.location = (15.8, -18.8, 10.8)
    camera_data.lens = 58.0
    point_at(camera, (0.1, 0.15, 1.65))
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
    camera.data.ortho_scale = 20.5
    camera.location = (0.0, 0.5, 24.0)
    point_at(camera, (0.0, 0.5, 0.0))
    render_atomic(OUT_OVERHEAD)
    camera.data.type = "PERSP"
    camera.data.lens = 66.0
    camera.location = (-9.8, -12.5, 7.2)
    point_at(camera, (0.0, 0.5, 2.1))
    render_atomic(OUT_SHAFT)
    camera.data.lens = 70.0
    camera.location = (13.2, -7.8, 5.4)
    point_at(camera, (5.8, -1.4, 0.8))
    render_atomic(OUT_HOIST)
    camera.data.lens = 68.0
    camera.location = (-13.5, -7.2, 5.2)
    point_at(camera, (-6.2, 0.65, 1.0))
    render_atomic(OUT_SORTING)
    camera.data.lens = 60.0
    camera.location = (-13.0, 12.5, 7.5)
    point_at(camera, (0.0, 0.7, 1.5))
    render_atomic(OUT_REAR)


def fixed_objects() -> list[bpy.types.Object]:
    return [obj for obj in bpy.data.objects if obj.get("mw_instance") and not obj.get("preview_only")]


def write_manifest() -> None:
    objects = fixed_objects()
    points = [obj.matrix_world @ vertex.co for obj in objects for vertex in obj.data.vertices]
    minimum = Vector((min(point.x for point in points), min(point.y for point in points), min(point.z for point in points)))
    maximum = Vector((max(point.x for point in points), max(point.y for point in points), max(point.z for point in points)))
    dimensions = maximum - minimum
    payload = {
        "id": "gorski-mineworks-atlas-preview-v1",
        "revision": 1,
        "authoritativeBuildingKind": "mine",
        "displayIdentity": "Mineworks",
        "regionalContext": "Gorski Kotar, circa 1550",
        "sourceKit": "gorski-architecture-kit-1.1.0",
        "dimensionsMetres": {
            "artFootprintWidth": round(dimensions.x, 4),
            "artFootprintDepth": round(dimensions.y, 4),
            "maximumHeight": round(maximum.z, 4),
        },
        "designIntent": "Permanent deep-mineral extraction works for rich iron, salt, and clay, visibly distinct from both the mobile surface Mining Camp and broad open-cut Quarry.",
        "signatureSilhouette": "A tall four-leg timber winding headframe rises directly over one guarded square shaft collar.",
        "construction": {
            "shaft": "Large square fieldstone collar with a true dark opening beneath the centred headframe.",
            "hoist": "Hand-built timber headframe with an integral winding axle, suspended rope, and grounded ore bucket; no disconnected duplicate winch or modern engine machinery.",
            "access": "Four-metre plank walkway preserves a clear road-facing approach to the shaft edge.",
            "sorting": "Permanent split-shingle shelter covers distinct hand-sorting and sieve tables.",
            "equipment": "Empty handcart, water buckets, and a fixed tool rack communicate trade without faking stored output.",
        },
        "canonicalState": "Fixed mine architecture and empty equipment only; iron, salt, clay, support timber, and civilian-tool inventory are absent at zero stock.",
        "runtimeOwnedState": {
            "mineralOutput": "IronMineStockpile, SaltMineStockpile, and ClayMineStockpile remain simulation-owned and deposit-specific.",
            "supportTimber": "MineSupportStockpile and its progressive segments remain simulation-owned.",
            "toolInventory": "Civilian mine-tool inventory remains simulation-owned.",
            "workersAndEffects": "Workers, winding motion, dust, sound, carts in motion, and deposit depletion remain runtime-owned.",
            "vegetation": "Excluded; SeedThree owns every living plant and surrounding forest layer.",
        },
        "atlas": {
            "id": texture_helper.ATLAS_MANIFEST["id"],
            "usedTiles": ["fieldstone-mortar", "quarry-stone", "limestone-ashlar", "rough-hewn-timber", "sawn-planks", "weathered-planks", "split-shingles", "wrought-iron", "packed-earth", "wicker-weave"],
        },
        "retopology": {
            "profile": "gameplay-v1",
            "method": "Canonical low-poly kit components at unit scale with export bevels removed; no automatic decimation.",
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
    assemble_mineworks()
    remove_source_library_objects()
    camera = stage_preview()
    scene = bpy.context.scene
    scene["artifact_id"] = "gorski-mineworks-atlas-preview-v1"
    scene["authoritative_building_kind"] = "mine"
    scene["architecture_context"] = "Gorski Kotar, circa 1550"
    scene["canonical_state"] = "fixed deep-extraction architecture; runtime owns mineral, support-timber, and tool inventory"
    scene["semantic_role"] = "permanent-rich-mineral-mineworks"
    scene["signature_silhouette"] = "tall-timber-headframe-over-square-shaft"
    scene["centered_excavation_count"] = 1
    scene["atlas_id"] = texture_helper.ATLAS_MANIFEST["id"]
    scene["living_vegetation"] = "excluded; SeedThree-owned"
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    write_manifest()
    export_glb()
    render_views(camera)
    print(f"MW_BLEND={OUT_BLEND}")
    print(f"MW_GLB={OUT_GLB}")
    print(f"MW_HERO={OUT_HERO}")
    print(f"MW_OVERHEAD={OUT_OVERHEAD}")
    print(f"MW_PLACEMENTS={len(PLACEMENTS)}")


if __name__ == "__main__":
    main()
