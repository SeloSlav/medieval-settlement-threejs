from __future__ import annotations

from collections import defaultdict, deque
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
OUTPUT_ROOT = Path(os.environ.get("GK_MINING_CAMP_OUTPUT_ROOT", str(EXAMPLE_DIR))).resolve()
OUT_DIR = OUTPUT_ROOT / "out"
RENDER_DIR = OUTPUT_ROOT / "renders"
OUT_BLEND = OUT_DIR / "mining_camp_textured_v1.blend"
OUT_GLB = OUT_DIR / "mining_camp_textured_v1.glb"
OUT_MANIFEST = OUT_DIR / "mining_camp_assembly_v1.json"
OUT_HERO = RENDER_DIR / "mining_camp_hero_v1.png"
OUT_OVERHEAD = RENDER_DIR / "mining_camp_overhead_v1.png"
OUT_WORKSIDE = RENDER_DIR / "mining_camp_workside_v1.png"
OUT_SHELTER = RENDER_DIR / "mining_camp_shelter_v1.png"


HELPER_PATH = EXAMPLE_DIR.parent / "hunters-camp" / "build_hunters_camp.py"
helper_spec = importlib.util.spec_from_file_location("gorski_mining_camp_texture_helper", HELPER_PATH)
if helper_spec is None or helper_spec.loader is None:
    raise RuntimeError(f"Could not load authored-camp texture helper: {HELPER_PATH}")
texture_helper = importlib.util.module_from_spec(helper_spec)
helper_spec.loader.exec_module(texture_helper)


texture_helper.MATERIAL_LOOKS.update({
    "canvas_red": ("linen-canvas", (0.36, 0.12, 0.075, 1.0), 0.74, 0.60),
    "quarry_stone": ("quarry-stone", (0.27, 0.29, 0.26, 1.0), 0.86, 0.82),
    "limestone_warm": ("limestone-ashlar", (0.46, 0.43, 0.35, 1.0), 0.72, 0.72),
    "earth": ("packed-earth", (0.22, 0.16, 0.11, 1.0), 0.70, 0.56),
})

SOURCES = {str(obj["gk_id"]): obj for obj in bpy.data.objects if obj.get("gk_id")}
PLACEMENTS: list[dict[str, object]] = []


def collection(name: str) -> bpy.types.Collection:
    current = bpy.data.collections.get(name)
    if current is None:
        current = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(current)
    return current


SHELTER = collection("MC_01_Day_Shelter")
SORTING = collection("MC_02_Sorting_Canopy_And_Yard")
EQUIPMENT = collection("MC_03_Mobile_Equipment")
SURVEY = collection("MC_04_Survey_Markers")
PREVIEW = collection("MC_90_Preview_Staging")


def seat_canopy_edge_beams_below_canvas(obj: bpy.types.Object) -> None:
    """Move the two long eave beams below the fly instead of through its skin."""

    adjacency: dict[int, set[int]] = defaultdict(set)
    for edge in obj.data.edges:
        first, second = edge.vertices
        adjacency[first].add(second)
        adjacency[second].add(first)
    unseen = set(range(len(obj.data.vertices)))
    while unseen:
        start = unseen.pop()
        island = {start}
        queue = deque([start])
        while queue:
            vertex_index = queue.popleft()
            for neighbor in adjacency[vertex_index]:
                if neighbor in unseen:
                    unseen.remove(neighbor)
                    island.add(neighbor)
                    queue.append(neighbor)
        points = [obj.data.vertices[index].co for index in island]
        width = max(point.x for point in points) - min(point.x for point in points)
        depth = max(point.y for point in points) - min(point.y for point in points)
        minimum_z = min(point.z for point in points)
        if width > 3.4 and depth < 0.3 and minimum_z > 2.0:
            for index in island:
                obj.data.vertices[index].co.z -= 0.22
    obj.data.update()


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
    if part_id == "site_canopy_canvas_4m_d4m":
        seat_canopy_edge_beams_below_canvas(obj)
    obj["mc_instance"] = True
    obj["mc_collision"] = collision
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


def assemble_camp() -> None:
    # Road / public approach is Blender -Y. The fixed worksite remains compact
    # so the four simulation-owned material stockpiles can grow around it.
    place(
        "site_tent_a_frame_large",
        "MiningCampDayShelter",
        SHELTER,
        (-4.72, 2.62, 0.0),
        math.radians(-8.0),
        collision=True,
    )
    place(
        "site_canopy_canvas_4m_d4m",
        "MiningCampSortingCanopy",
        SORTING,
        (2.70, 2.75, 0.0),
        math.radians(4.0),
    )
    place(
        "extract_sorting_bench",
        "MiningCampSortingYard",
        SORTING,
        (1.66, 2.58, 0.0),
        math.radians(3.0),
        collision=True,
    )
    place(
        "extract_sieve_table",
        "MiningCampSieveTable",
        SORTING,
        (3.73, 2.83, 0.0),
        math.radians(5.0),
        collision=True,
    )
    place(
        "extract_handcart",
        "MiningCampHandcart",
        EQUIPMENT,
        (-0.25, -1.25, 0.0),
        math.radians(-18.0),
        collision=True,
    )
    place(
        "prop_tool_rack_quarry",
        "MiningCampToolRack",
        EQUIPMENT,
        (-2.00, 0.30, 0.0),
        math.radians(-12.0),
        collision=True,
    )
    place(
        "prop_water_bucket_pair",
        "MiningCampWaterBuckets",
        EQUIPMENT,
        (4.52, 0.72, 0.0),
        math.radians(7.0),
    )
    place(
        "extract_survey_stakes",
        "MiningCampSurveyStakes",
        SURVEY,
        (-3.62, -3.42, 0.0),
        math.radians(-7.0),
    )
    place(
        "extract_survey_stakes",
        "MiningCampSurveyStakesSecondary",
        SURVEY,
        (3.70, -3.58, 0.0),
        math.radians(9.0),
    )


def remove_source_library_objects() -> None:
    for obj in list(bpy.data.objects):
        if not obj.get("mc_instance"):
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
    bpy.ops.mesh.primitive_plane_add(size=27.0, location=(0.0, 0.0, -0.025))
    ground = bpy.context.object
    ground.name = "MC_Preview_Packed_Earth_Worksite"
    ground.data.uv_layers.active.name = "GK_UV0"
    for uv in ground.data.uv_layers.active.data:
        uv.uv *= 13.5
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
    scene.view_settings.exposure = -0.32
    if scene.world is None:
        scene.world = bpy.data.worlds.new("MC_Preview_World")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.030, 0.046, 0.056, 1.0)
    background.inputs["Strength"].default_value = 0.34

    key = add_light("MC_Key", "AREA", (-9.0, -10.0, 12.0), 1280.0, (1.0, 0.89, 0.72), 8.0)
    point_at(key, (-0.3, 0.4, 1.0))
    fill = add_light("MC_Fill", "AREA", (8.5, -1.0, 7.0), 430.0, (0.57, 0.69, 1.0), 6.0)
    point_at(fill, (0.5, 1.0, 0.9))
    rim = add_light("MC_Rim", "AREA", (-6.0, 8.0, 8.0), 580.0, (1.0, 0.79, 0.58), 6.0)
    point_at(rim, (-0.5, 1.7, 1.0))
    shelter_fill = add_light("MC_Shelter_Fill", "AREA", (-5.5, -1.0, 3.1), 135.0, (0.78, 0.84, 1.0), 3.0)
    point_at(shelter_fill, (-4.72, 2.62, 0.85))
    sun = add_light("MC_Sun", "SUN", (0.0, 0.0, 10.0), 1.05, (1.0, 0.93, 0.82))
    sun.rotation_euler = (math.radians(29.0), math.radians(-15.0), math.radians(-40.0))
    sun.data.angle = math.radians(7.0)

    camera_data = bpy.data.cameras.new("MC_Hero_Camera")
    camera = bpy.data.objects.new("MC_Hero_Camera", camera_data)
    PREVIEW.objects.link(camera)
    camera.location = (12.0, -15.0, 8.1)
    camera_data.lens = 58.0
    point_at(camera, (-0.25, 0.60, 0.88))
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
    camera.data.ortho_scale = 12.6
    camera.location = (0.0, 0.6, 18.0)
    point_at(camera, (0.0, 0.6, 0.0))
    render_atomic(OUT_OVERHEAD)
    camera.data.type = "PERSP"
    camera.data.lens = 60.0
    camera.location = (-11.5, -13.0, 6.7)
    point_at(camera, (-0.4, 0.8, 0.9))
    render_atomic(OUT_WORKSIDE)
    camera.data.lens = 68.0
    camera.location = (-8.6, -6.8, 3.2)
    point_at(camera, (-3.3, 1.45, 0.9))
    render_atomic(OUT_SHELTER)


def fixed_objects() -> list[bpy.types.Object]:
    return [obj for obj in bpy.data.objects if obj.get("mc_instance") and not obj.get("preview_only")]


def write_manifest() -> None:
    objects = fixed_objects()
    points = [obj.matrix_world @ vertex.co for obj in objects for vertex in obj.data.vertices]
    minimum = Vector((min(point.x for point in points), min(point.y for point in points), min(point.z for point in points)))
    maximum = Vector((max(point.x for point in points), max(point.y for point in points), max(point.z for point in points)))
    dimensions = maximum - minimum
    payload = {
        "id": "gorski-mining-camp-atlas-preview-v1",
        "revision": 1,
        "authoritativeBuildingKind": "stone_quarry",
        "displayIdentity": "Mining Camp",
        "regionalContext": "Gorski Kotar, circa 1550",
        "sourceKit": "gorski-architecture-kit-1.1.0",
        "dimensionsMetres": {
            "artFootprintWidth": round(dimensions.x, 4),
            "artFootprintDepth": round(dimensions.y, 4),
            "maximumHeight": round(maximum.z, 4),
        },
        "designIntent": "Low, mobile day-work camp for finite surface stone, iron, salt, and clay deposits; deliberately not a centered quarry pit or deep mineworks.",
        "signatureSilhouette": "A sewn canvas sleeping tent opposite a low canvas sorting canopy, with mobile hand tools and an open central approach.",
        "construction": {
            "dayShelter": "Weathered sewn linen or hemp canvas over a repairable hand-cut softwood A-frame.",
            "sortingCanopy": "Four-post weathered timber frame under a patched canvas fly, open on every side.",
            "workFurniture": "Two separate timber sorting and sieving stations kept beneath the canopy.",
            "mobileEquipment": "Handcart, hand-tool rack, water buckets, and two irregular survey-marker clusters.",
        },
        "canonicalState": "Fixed shelter, sorting furniture, and tools only; stored outputs are absent at zero inventory.",
        "runtimeOwnedState": {
            "materialStockpiles": "Stone, iron, salt, and clay piles are progressive simulation-owned visuals outside the neutral GLB.",
            "toolInventory": "Civilian-tool stock is a progressive runtime-owned visual.",
            "workersAndEffects": "Workers, active extraction, dust, sound, and surface-deposit dressing remain runtime-owned.",
            "vegetation": "Excluded; SeedThree owns every living plant and surrounding forest layer.",
        },
        "atlas": {
            "id": texture_helper.ATLAS_MANIFEST["id"],
            "usedTiles": ["aged-canvas", "linen-canvas", "rough-hewn-timber", "weathered-planks", "quarry-stone", "limestone-ashlar", "wrought-iron", "wicker-weave", "packed-earth"],
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
    assemble_camp()
    remove_source_library_objects()
    camera = stage_preview()
    scene = bpy.context.scene
    scene["artifact_id"] = "gorski-mining-camp-atlas-preview-v1"
    scene["authoritative_building_kind"] = "stone_quarry"
    scene["architecture_context"] = "Gorski Kotar, circa 1550"
    scene["canonical_state"] = "fixed camp architecture and tools; runtime owns resource and tool inventory"
    scene["semantic_role"] = "general-surface-extraction-camp"
    scene["signature_silhouette"] = "day-work-shelter-and-sorting-yard"
    scene["centered_excavation_count"] = 0
    scene["atlas_id"] = texture_helper.ATLAS_MANIFEST["id"]
    scene["living_vegetation"] = "excluded; SeedThree-owned"
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    write_manifest()
    export_glb()
    render_views(camera)
    print(f"MC_BLEND={OUT_BLEND}")
    print(f"MC_GLB={OUT_GLB}")
    print(f"MC_HERO={OUT_HERO}")
    print(f"MC_OVERHEAD={OUT_OVERHEAD}")
    print(f"MC_PLACEMENTS={len(PLACEMENTS)}")


if __name__ == "__main__":
    main()
