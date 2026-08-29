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
OUTPUT_ROOT = Path(os.environ.get("GK_WAYSIDE_SHRINE_OUTPUT_ROOT", str(EXAMPLE_DIR))).resolve()
OUT_DIR = OUTPUT_ROOT / "out"
RENDER_DIR = OUTPUT_ROOT / "renders"
OUT_BLEND = OUT_DIR / "wayside_shrine_textured_v1.blend"
OUT_GLB = OUT_DIR / "wayside_shrine_textured_v1.glb"
OUT_MANIFEST = OUT_DIR / "wayside_shrine_assembly_v1.json"
OUT_HERO = RENDER_DIR / "wayside_shrine_hero_v1.png"
OUT_REAR = RENDER_DIR / "wayside_shrine_rear_v1.png"
OUT_SETTLEMENT = RENDER_DIR / "wayside_shrine_settlement_v1.png"
OUT_NICHE = RENDER_DIR / "wayside_shrine_niche_detail_v1.png"


HELPER_PATH = EXAMPLE_DIR.parent / "hunters-camp" / "build_hunters_camp.py"
helper_spec = importlib.util.spec_from_file_location("gorski_shrine_texture_helper", HELPER_PATH)
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


MASONRY = collection("WS_01_Masonry")
DEVOTIONAL = collection("WS_02_Devotional")
CANOPY = collection("WS_03_Canopy")
APPROACH = collection("WS_04_Approach")
PREVIEW = collection("WS_90_Preview_Staging")


# The same shared production atlas used by the other authored architecture.
# Muted pigment tints preserve a painted-icon read without introducing a
# shrine-only texture set or broad saturated colour.
texture_helper.MATERIAL_LOOKS.update({
    "fieldstone": ("fieldstone-mortar", (0.23, 0.25, 0.23, 1.0), 0.84, 0.82),
    "limestone_warm": ("limestone-ashlar", (0.52, 0.45, 0.34, 1.0), 0.58, 0.74),
    "limewash_faded": ("lime-plaster", (0.62, 0.55, 0.43, 1.0), 0.48, 0.68),
    "plaster_inside": ("lime-plaster", (0.16, 0.17, 0.15, 1.0), 0.86, 0.48),
    "oak_dark": ("rough-hewn-timber", (0.12, 0.061, 0.025, 1.0), 0.90, 0.72),
    "timber_cut": ("sawn-planks", (0.43, 0.24, 0.10, 1.0), 0.62, 0.66),
    "timber_weathered": ("weathered-planks", (0.27, 0.17, 0.08, 1.0), 0.74, 0.72),
    "shingles": ("split-shingles", (0.15, 0.080, 0.035, 1.0), 0.92, 0.84),
    "shingles_aged": ("split-shingles", (0.085, 0.057, 0.038, 1.0), 0.98, 0.86),
    "iron": ("wrought-iron", (0.10, 0.11, 0.10, 1.0), 0.84, 0.52),
    "devotional_blue": ("lime-plaster", (0.10, 0.20, 0.34, 1.0), 0.82, 0.42),
    "icon_gold": ("aged-brass", (0.55, 0.35, 0.11, 1.0), 0.62, 0.40),
    "wax": ("linen-canvas", (0.73, 0.64, 0.47, 1.0), 0.46, 0.28),
    "packed_earth": ("packed-earth", (0.30, 0.23, 0.16, 1.0), 0.38, 0.56),
})


def material_keys_for_part(obj: bpy.types.Object, part_id: str) -> list[str]:
    keys = [
        material.name.removeprefix("GK_Mat_") if material is not None else "limestone_warm"
        for material in obj.data.materials
    ]
    if part_id == "civic_shrine_niche_stone":
        # Keep the arch stones exposed while ageing the broad public body.
        return ["limewash_faded" if key == "limestone_warm" else key for key in keys]
    return keys


def remap_materials(obj: bpy.types.Object, part_id: str) -> None:
    if obj.type != "MESH":
        return
    keys = material_keys_for_part(obj, part_id)
    texture_helper.bake_atlas_uvs(obj, keys)
    for index, key in enumerate(keys):
        obj.data.materials[index] = texture_helper.atlas_material(key)


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
    obj["ws_instance"] = True
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
    })
    return obj


def assemble_shrine() -> None:
    plinth_top = 0.725
    canopy_eave = plinth_top + 2.18
    roof_origin_z = canopy_eave + 0.025
    roof_ridge_z = roof_origin_z + 0.61

    place("civic_shrine_plinth_stone", "WS_Worn_Stepped_Plinth", MASONRY, (0.0, 0.0, 0.0))
    place("civic_shrine_niche_stone", "WS_Limewashed_Stone_Niche", MASONRY, (0.0, 0.0, plinth_top))
    place("civic_shrine_rear_wall_limewash_1p5m", "WS_Limewashed_Rear_Closure", MASONRY, (0.0, 0.39, plinth_top), (0.0, 0.0, math.pi))
    place("civic_shrine_half_column_pair", "WS_Facade_Half_Columns", MASONRY, (0.0, -0.46, plinth_top))
    place("opening_shrine_icon_insert", "WS_Marian_Icon_And_Votives", DEVOTIONAL, (0.0, -0.47, plinth_top + 0.08))
    place("civic_shrine_canopy", "WS_Timber_Gable_Canopy", CANOPY, (0.0, -0.31, plinth_top))
    # Roof components are authored with the ridge on local X. Rotate the cap
    # so its gable faces the public -Y elevation and matches the canopy frame.
    place("roof_shingle_shrine_gable_1p5m", "WS_Split_Shingle_Gable_Roof", CANOPY, (0.0, -0.02, roof_origin_z), (0.0, 0.0, math.pi * 0.5))
    place("civic_shrine_iron_cross", "WS_Forged_Iron_Ridge_Cross", CANOPY, (0.0, -0.02, roof_ridge_z - 0.01))
    # The step grows toward +Y; a half-turn sends its tread toward the road.
    place("foundation_steps_limestone_1", "WS_Worn_Roadside_Step", APPROACH, (0.0, -0.64, 0.0), (0.0, 0.0, math.pi))


def remove_source_library_objects() -> None:
    for obj in list(bpy.data.objects):
        if not obj.get("ws_instance"):
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
    obj.location = location
    PREVIEW.objects.link(obj)
    obj["preview_only"] = True
    return obj


def add_preview_ground() -> None:
    bpy.ops.mesh.primitive_plane_add(size=9.0, location=(0.0, 0.0, -0.018))
    ground = bpy.context.active_object
    ground.name = "WS_Preview_Roadside_Ground"
    ground.data.materials.append(texture_helper.atlas_material("packed_earth"))
    uv_layer = ground.data.uv_layers.new(name="GK_UV0") if not ground.data.uv_layers else ground.data.uv_layers.active
    for loop in uv_layer.data:
        loop.uv *= 4.5
    link_preview(ground)


def stage_preview() -> bpy.types.Object:
    add_preview_ground()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1200
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = False
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        pass
    scene.view_settings.exposure = -0.12

    if scene.world is None:
        scene.world = bpy.data.worlds.new("WS_Preview_World")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.035, 0.052, 0.064, 1.0)
    background.inputs["Strength"].default_value = 0.38

    key = add_light("WS_Key", "AREA", (-4.8, -6.2, 8.5), 820.0, (1.0, 0.88, 0.70), 5.0)
    point_at(key, (0.0, -0.05, 1.75))
    fill = add_light("WS_Fill", "AREA", (5.4, -1.2, 5.0), 330.0, (0.58, 0.70, 1.0), 4.0)
    point_at(fill, (0.0, 0.0, 1.55))
    rim = add_light("WS_Rim", "AREA", (-2.5, 4.6, 6.8), 420.0, (0.95, 0.86, 0.72), 4.0)
    point_at(rim, (0.0, 0.0, 2.0))
    sun = add_light("WS_Sun", "SUN", (0.0, 0.0, 8.0), 1.2, (1.0, 0.93, 0.82))
    sun.rotation_euler = (math.radians(30.0), math.radians(-14.0), math.radians(-38.0))
    sun.data.angle = math.radians(8.0)

    camera_data = bpy.data.cameras.new("WS_Hero_Camera")
    camera = bpy.data.objects.new("WS_Hero_Camera", camera_data)
    PREVIEW.objects.link(camera)
    camera.location = (5.3, -7.3, 4.15)
    camera_data.lens = 66.0
    point_at(camera, (0.0, -0.02, 1.78))
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
    camera.location = (-4.8, 5.9, 3.75)
    camera.data.lens = 64.0
    point_at(camera, (0.0, 0.0, 1.75))
    render_atomic(OUT_REAR)
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 6.8
    camera.location = (6.8, -9.6, 7.4)
    point_at(camera, (0.0, 0.0, 1.55))
    render_atomic(OUT_SETTLEMENT)
    camera.data.type = "PERSP"
    camera.data.lens = 82.0
    camera.location = (2.0, -4.0, 2.05)
    point_at(camera, (0.0, -0.50, 1.45))
    render_atomic(OUT_NICHE)


def write_manifest() -> None:
    payload = {
        "id": "gorski-wayside-shrine-atlas-preview-v1",
        "authoritativeBuildingKind": "wayside_shrine",
        "displayIdentity": "Wayside Shrine",
        "regionalContext": "Gorski Kotar, circa 1550",
        "sourceKit": "gorski-architecture-kit-1.1.0",
        "dimensionsMetres": {"width": 1.78, "depth": 1.79, "maximumHeight": 4.15},
        "signatureSilhouette": "A tiny limewashed masonry niche beneath a steep split-shingle canopy and forged iron ridge cross.",
        "designIntent": "Compact roadside poklonac: materially related to the parish church but visibly smaller, humbler, and suitable for settlement-scale repetition.",
        "atlas": {
            "id": texture_helper.ATLAS_MANIFEST["id"],
            "usedTiles": [
                "lime-plaster", "limestone-ashlar", "fieldstone-mortar", "rough-hewn-timber",
                "sawn-planks", "split-shingles", "wrought-iron", "aged-brass", "linen-canvas",
            ],
            "packing": "R roughness, G metalness, B AO, A centered height",
        },
        "construction": {
            "plinth": "Weather-darkened gathered fieldstone and dressed local limestone form three worn roadside courses.",
            "niche": "A shallow masonry devotional recess with restrained aged limewash and exposed stone arch trim.",
            "canopy": "Dark oak posts and rake braces carry a steep hand-split fir/pine shingle cap.",
            "devotionalInsert": "Muted Marian blue and ochre/gold remain small focal pigments inside the recessed niche.",
        },
        "canonicalState": "Permanent shrine fabric, icon, and votive objects only; no living vegetation, characters, or broad presentation base.",
        "runtimeBudget": {"triangles": [1000, 1800], "textures": "shared building atlas only"},
        "livingVegetation": "Excluded; SeedThree-owned.",
        "placements": PLACEMENTS,
    }
    OUT_MANIFEST.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def export_glb() -> None:
    staging = OUT_GLB.with_name(f"{OUT_GLB.stem}.exporting{OUT_GLB.suffix}")
    staging.unlink(missing_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    export_objects = [obj for obj in bpy.data.objects if obj.get("ws_instance") and not obj.get("preview_only")]
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
    assemble_shrine()
    remove_source_library_objects()
    camera = stage_preview()
    scene = bpy.context.scene
    scene["artifact_id"] = "gorski-wayside-shrine-atlas-preview-v1"
    scene["authoritative_building_kind"] = "wayside_shrine"
    scene["architecture_context"] = "Gorski Kotar, circa 1550"
    scene["canonical_state"] = "permanent roadside devotion; no runtime inventory or vegetation"
    scene["signature_silhouette"] = "tiny gabled masonry niche with forged iron ridge cross"
    scene["atlas_id"] = texture_helper.ATLAS_MANIFEST["id"]
    scene["living_vegetation"] = "excluded; SeedThree-owned"
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    write_manifest()
    export_glb()
    render_views(camera)
    print(f"WS_BLEND={OUT_BLEND}")
    print(f"WS_GLB={OUT_GLB}")
    print(f"WS_HERO={OUT_HERO}")
    print(f"WS_PLACEMENTS={len(PLACEMENTS)}")


if __name__ == "__main__":
    main()
