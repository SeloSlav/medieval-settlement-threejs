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
OUTPUT_ROOT = Path(os.environ.get("GK_LARGE_QUARRY_OUTPUT_ROOT", str(EXAMPLE_DIR))).resolve()
OUT_DIR = OUTPUT_ROOT / "out"
RENDER_DIR = OUTPUT_ROOT / "renders"
OUT_BLEND = OUT_DIR / "large_quarry_textured_v1.blend"
OUT_GLB = OUT_DIR / "large_quarry_textured_v1.glb"
OUT_MANIFEST = OUT_DIR / "large_quarry_assembly_v1.json"
OUT_HERO = RENDER_DIR / "large_quarry_hero_v1.png"
OUT_OVERHEAD = RENDER_DIR / "large_quarry_overhead_v1.png"
OUT_CUT = RENDER_DIR / "large_quarry_cut_face_v1.png"
OUT_SORTING = RENDER_DIR / "large_quarry_sorting_yard_v1.png"
OUT_REAR = RENDER_DIR / "large_quarry_rear_v1.png"


HELPER_PATH = EXAMPLE_DIR.parent / "hunters-camp" / "build_hunters_camp.py"
helper_spec = importlib.util.spec_from_file_location("gorski_large_quarry_texture_helper", HELPER_PATH)
if helper_spec is None or helper_spec.loader is None:
    raise RuntimeError(f"Could not load authored-camp texture helper: {HELPER_PATH}")
texture_helper = importlib.util.module_from_spec(helper_spec)
helper_spec.loader.exec_module(texture_helper)


texture_helper.MATERIAL_LOOKS.update({
    "quarry_stone": ("quarry-stone", (0.27, 0.29, 0.27, 1.0), 0.88, 0.86),
    "fieldstone": ("fieldstone-mortar", (0.31, 0.31, 0.27, 1.0), 0.84, 0.86),
    "limestone_warm": ("limestone-ashlar", (0.45, 0.42, 0.34, 1.0), 0.72, 0.72),
    "oak_dark": ("rough-hewn-timber", (0.12, 0.065, 0.030, 1.0), 0.90, 0.78),
    "timber_cut": ("sawn-planks", (0.38, 0.22, 0.095, 1.0), 0.65, 0.68),
    "timber_weathered": ("weathered-planks", (0.25, 0.16, 0.078, 1.0), 0.80, 0.78),
    "shingles": ("split-shingles", (0.13, 0.072, 0.033, 1.0), 0.94, 0.84),
    "iron": ("wrought-iron", (0.055, 0.050, 0.044, 1.0), 0.94, 0.72),
    "earth": ("packed-earth", (0.20, 0.15, 0.105, 1.0), 0.74, 0.58),
    "charcoal": ("packed-earth", (0.10, 0.105, 0.095, 1.0), 0.92, 0.48),
})


SOURCES = {str(obj["gk_id"]): obj for obj in bpy.data.objects if obj.get("gk_id")}
PLACEMENTS: list[dict[str, object]] = []


def collection(name: str) -> bpy.types.Collection:
    current = bpy.data.collections.get(name)
    if current is None:
        current = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(current)
    return current


CUT_FACE = collection("LQ_01_Stepped_Open_Cut")
HOIST = collection("LQ_02_Derrick_And_Access")
SORTING = collection("LQ_03_Sorting_Shelter")
EQUIPMENT = collection("LQ_04_Fixed_Equipment")
PREVIEW = collection("LQ_90_Preview_Staging")


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
    obj["lq_instance"] = True
    obj["lq_collision"] = collision
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


def assemble_quarry() -> None:
    # Five canonical 4 m cut modules form one continuous U-shaped face. Their
    # inner edges leave an eight-by-four metre working floor and a completely
    # open road-facing approach rather than a decorative stone plinth.
    for label, x, y, rotation in (
        ("Rear_West", -4.0, 4.4, 0.0),
        ("Rear_Centre", 0.0, 4.4, 0.0),
        ("Rear_East", 4.0, 4.4, 0.0),
        ("West_Return", -5.0, 1.4, math.radians(90.0)),
        ("East_Return", 5.0, 1.4, math.radians(-90.0)),
    ):
        place(
            "extract_quarry_bench_4m",
            f"LQ_Cut_Bench_{label}",
            CUT_FACE,
            (x, y, 0.0),
            rotation,
            collision=True,
        )

    # The derrick is the single dominant silhouette and remains visibly an
    # open-cut lifting frame, not an underground mine headframe.
    place(
        "extract_quarry_derrick_large",
        "LQ_Large_Timber_Derrick",
        HOIST,
        (0.0, 1.45, 0.0),
        math.radians(-4.0),
    )
    place(
        "extract_ore_bucket",
        "LQ_Grounded_Hoist_Bucket",
        HOIST,
        (2.15, 1.35, 0.0),
        math.radians(8.0),
    )

    # A plank causeway and two low, partially buried retaining walls make the
    # access cut readable without filling its centre with a broad base mesh.
    place(
        "site_walkway_plank_4m",
        "LQ_Central_Plank_Causeway",
        HOIST,
        (0.0, -2.50, 0.0),
        math.radians(90.0),
    )
    for side, x in (("West", -1.20), ("East", 1.20)):
        place(
            "foundation_retaining_wall_4m",
            f"LQ_Access_Retaining_Wall_{side}",
            HOIST,
            (x, -2.50, -0.70),
            math.radians(90.0),
            collision=True,
        )

    # The permanent sorting shelter uses the regional split-shingle canopy;
    # canvas remains the visual language of the smaller mobile Mining Camp.
    place(
        "site_canopy_timber_4m_d2m",
        "LQ_Shingle_Sorting_Canopy",
        SORTING,
        (8.25, 0.18, 0.0),
        math.radians(-2.0),
    )
    place(
        "extract_sorting_bench",
        "LQ_Stone_Sorting_Bench",
        SORTING,
        (7.18, 0.18, 0.0),
        math.radians(-2.0),
    )
    place(
        "extract_quarry_wedge_rack",
        "LQ_Stonecutters_Wedge_Rack",
        SORTING,
        (9.15, 0.18, 0.0),
        math.radians(-2.0),
    )

    place(
        "extract_handcart",
        "LQ_Empty_Stone_Handcart",
        EQUIPMENT,
        (-7.35, -0.05, 0.0),
        math.radians(-16.0),
    )
    place(
        "prop_tool_rack_quarry",
        "LQ_Fixed_Quarry_Tool_Rack",
        EQUIPMENT,
        (-7.35, -1.72, 0.0),
        math.radians(6.0),
    )


def remove_source_library_objects() -> None:
    for obj in list(bpy.data.objects):
        if not obj.get("lq_instance"):
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
    bpy.ops.mesh.primitive_plane_add(size=32.0, location=(0.0, 0.0, -0.035))
    ground = bpy.context.object
    ground.name = "LQ_Preview_Packed_Earth_Worksite"
    ground.data.uv_layers.active.name = "GK_UV0"
    for uv in ground.data.uv_layers.active.data:
        uv.uv *= 16.0
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
    scene.view_settings.exposure = -0.28
    if scene.world is None:
        scene.world = bpy.data.worlds.new("LQ_Preview_World")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.027, 0.043, 0.050, 1.0)
    background.inputs["Strength"].default_value = 0.34

    key = add_light("LQ_Key", "AREA", (-10.0, -12.0, 14.0), 1450.0, (1.0, 0.90, 0.74), 9.0)
    point_at(key, (0.0, 0.5, 1.1))
    fill = add_light("LQ_Fill", "AREA", (12.0, -2.0, 8.0), 520.0, (0.56, 0.68, 1.0), 7.0)
    point_at(fill, (1.0, 0.8, 1.0))
    rim = add_light("LQ_Rim", "AREA", (-7.0, 11.0, 10.0), 760.0, (1.0, 0.79, 0.57), 7.0)
    point_at(rim, (-0.5, 2.2, 1.2))
    sun = add_light("LQ_Sun", "SUN", (0.0, 0.0, 12.0), 1.10, (1.0, 0.93, 0.82))
    sun.rotation_euler = (math.radians(30.0), math.radians(-14.0), math.radians(-38.0))
    sun.data.angle = math.radians(7.0)

    camera_data = bpy.data.cameras.new("LQ_Hero_Camera")
    camera = bpy.data.objects.new("LQ_Hero_Camera", camera_data)
    PREVIEW.objects.link(camera)
    camera.location = (15.8, -18.5, 10.6)
    camera_data.lens = 58.0
    point_at(camera, (0.6, 0.25, 1.15))
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
    camera.data.ortho_scale = 21.5
    camera.location = (0.0, 0.6, 24.0)
    point_at(camera, (0.0, 0.6, 0.0))
    render_atomic(OUT_OVERHEAD)
    camera.data.type = "PERSP"
    camera.data.lens = 62.0
    camera.location = (-14.5, -13.8, 7.8)
    point_at(camera, (-0.4, 1.0, 1.0))
    render_atomic(OUT_CUT)
    camera.data.lens = 68.0
    camera.location = (15.5, -8.5, 5.8)
    point_at(camera, (6.0, 0.0, 1.05))
    render_atomic(OUT_SORTING)
    camera.data.lens = 60.0
    camera.location = (-12.8, 13.0, 7.4)
    point_at(camera, (0.4, 1.8, 1.05))
    render_atomic(OUT_REAR)


def fixed_objects() -> list[bpy.types.Object]:
    return [obj for obj in bpy.data.objects if obj.get("lq_instance") and not obj.get("preview_only")]


def write_manifest() -> None:
    objects = fixed_objects()
    points = [obj.matrix_world @ vertex.co for obj in objects for vertex in obj.data.vertices]
    minimum = Vector((min(point.x for point in points), min(point.y for point in points), min(point.z for point in points)))
    maximum = Vector((max(point.x for point in points), max(point.y for point in points), max(point.z for point in points)))
    dimensions = maximum - minimum
    payload = {
        "id": "gorski-large-quarry-atlas-preview-v1",
        "revision": 1,
        "authoritativeBuildingKind": "large_quarry",
        "displayIdentity": "Quarry",
        "regionalContext": "Gorski Kotar, circa 1550",
        "sourceKit": "gorski-architecture-kit-1.1.0",
        "dimensionsMetres": {
            "artFootprintWidth": round(dimensions.x, 4),
            "artFootprintDepth": round(dimensions.y, 4),
            "maximumHeight": round(maximum.z, 4),
        },
        "designIntent": "Permanent rich-stone open cut, clearly larger and more infrastructural than the mobile Mining Camp while remaining distinct from underground Mineworks.",
        "signatureSilhouette": "A large hand-built timber lifting derrick stands inside a continuous U-shaped stepped quarry face.",
        "construction": {
            "cutFace": "Five canonical four-metre quarry-bench modules form a continuous three-sided extraction face with an open road approach.",
            "hoist": "Large dark-oak derrick and grounded hoist bucket over the central working floor.",
            "access": "Four-metre plank causeway between two partially buried fieldstone retaining walls.",
            "sorting": "Permanent split-shingle canopy with a sorting bench and stonecutters' wedge rack.",
            "equipment": "Empty handcart and fixed quarry tool rack remain trade-defining equipment rather than stored output.",
        },
        "canonicalState": "Fixed extraction architecture and empty equipment only; stone output, replacement supports, and civilian-tool stock are absent at zero inventory.",
        "runtimeOwnedState": {
            "stoneOutput": "LargeQuarryStockpile and its progressive segments remain simulation-owned.",
            "supportTimber": "LargeQuarrySupportStockpile and its progressive segments remain simulation-owned.",
            "toolInventory": "Civilian quarry-tool inventory remains simulation-owned.",
            "workersAndEffects": "Workers, dust, sound, carts in motion, and deposit depletion remain runtime-owned.",
            "vegetation": "Excluded; SeedThree owns every living plant and surrounding forest layer.",
        },
        "atlas": {
            "id": texture_helper.ATLAS_MANIFEST["id"],
            "usedTiles": ["quarry-stone", "fieldstone-mortar", "limestone-ashlar", "rough-hewn-timber", "sawn-planks", "weathered-planks", "split-shingles", "wrought-iron", "packed-earth"],
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
    assemble_quarry()
    remove_source_library_objects()
    camera = stage_preview()
    scene = bpy.context.scene
    scene["artifact_id"] = "gorski-large-quarry-atlas-preview-v1"
    scene["authoritative_building_kind"] = "large_quarry"
    scene["architecture_context"] = "Gorski Kotar, circa 1550"
    scene["canonical_state"] = "fixed open-cut architecture; runtime owns stone, support-timber, and tool inventory"
    scene["semantic_role"] = "permanent-rich-stone-open-cut"
    scene["signature_silhouette"] = "u-shaped-stepped-cut-and-large-timber-derrick"
    scene["centered_excavation_count"] = 1
    scene["atlas_id"] = texture_helper.ATLAS_MANIFEST["id"]
    scene["living_vegetation"] = "excluded; SeedThree-owned"
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    write_manifest()
    export_glb()
    render_views(camera)
    print(f"LQ_BLEND={OUT_BLEND}")
    print(f"LQ_GLB={OUT_GLB}")
    print(f"LQ_HERO={OUT_HERO}")
    print(f"LQ_OVERHEAD={OUT_OVERHEAD}")
    print(f"LQ_PLACEMENTS={len(PLACEMENTS)}")


if __name__ == "__main__":
    main()
