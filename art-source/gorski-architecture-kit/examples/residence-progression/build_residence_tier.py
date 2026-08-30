from __future__ import annotations

import json
import math
import os
from pathlib import Path
import time

import bpy
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[4]
EXAMPLE_DIR = Path(__file__).resolve().parent
OUT_DIR = EXAMPLE_DIR / "out"
RENDER_DIR = EXAMPLE_DIR / "renders"
TIER = int(os.environ.get("GK_RESIDENCE_TIER", "2"))
if TIER not in (2, 3, 4):
    raise ValueError("GK_RESIDENCE_TIER must be 2, 3, or 4")


TIER_SPECS = {
    2: {
        "width": 6.0,
        "depth": 8.0,
        "ground_style": "fieldstone",
        "ground_height": 2.7,
        "upper_style": "plank",
        "upper_height": 1.35,
        "roof_style": "shingle",
        "foundation": "fieldstone",
        "foundation_height": 0.65,
        "gable_style": "timber",
        "chimneys": ((1.35, 5.25),),
        "signature": "broad shingled gable with low timber knee wall",
    },
    3: {
        "width": 8.0,
        "depth": 8.0,
        "ground_style": "fieldstone",
        "ground_height": 2.7,
        "upper_style": "limewash",
        "upper_height": 2.7,
        "roof_style": "shingle",
        "foundation": "fieldstone",
        "foundation_height": 0.65,
        "gable_style": "plaster",
        "chimneys": ((-1.75, 5.4), (1.65, 3.15)),
        "signature": "tall stone lower storey with a working timber gallery",
    },
    4: {
        "width": 8.0,
        "depth": 10.0,
        "ground_style": "fieldstone",
        "ground_height": 2.7,
        "upper_style": "limewash",
        "upper_height": 2.7,
        "roof_style": "tile",
        "foundation": "limestone_warm",
        "foundation_height": 1.2,
        "gable_style": "plaster",
        "chimneys": ((-1.7, 6.8),),
        "signature": "tiled high-status house with gallery and covered dormer",
    },
}
SPEC = TIER_SPECS[TIER]
PITCH = math.radians(50.0)
WALL_TOP = float(SPEC["ground_height"]) + float(SPEC["upper_height"])
RIDGE_Z = WALL_TOP + float(SPEC["width"]) * 0.5 * math.tan(PITCH)
VERSION = 1
STEM = f"residence_tier_{TIER}_kit_v{VERSION}"
OUT_BLEND = OUT_DIR / f"{STEM}.blend"
OUT_GLB = OUT_DIR / f"{STEM}.glb"
OUT_MANIFEST = OUT_DIR / f"{STEM}_assembly.json"
OUT_VALIDATION = OUT_DIR / f"{STEM}_validation.json"
OUT_HERO = RENDER_DIR / f"{STEM}_hero.png"
OUT_FRONT = RENDER_DIR / f"{STEM}_front.png"
OUT_REAR = RENDER_DIR / f"{STEM}_rear.png"


def source_objects() -> dict[str, bpy.types.Object]:
    return {
        str(obj.get("gk_id")): obj
        for obj in bpy.data.objects
        if obj.get("gk_id")
    }


SOURCES = source_objects()
PLACEMENTS: list[dict[str, object]] = []
ASSEMBLY_OBJECTS: list[bpy.types.Object] = []


def get_collection(name: str) -> bpy.types.Collection:
    current = bpy.data.collections.get(name)
    if current is None:
        current = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(current)
    return current


FOUNDATION = get_collection(f"R{TIER}_01_Foundation")
LOWER = get_collection(f"R{TIER}_02_Lower_Storey")
UPPER = get_collection(f"R{TIER}_03_Upper_Storey")
OPENINGS = get_collection(f"R{TIER}_04_Openings")
FRAMES = get_collection(f"R{TIER}_05_Frames")
ROOF = get_collection(f"R{TIER}_06_Roof")
FIXED = get_collection(f"R{TIER}_07_Fixed_Architecture")
PREVIEW = get_collection(f"R{TIER}_90_Preview")

ROOT_OBJECT = bpy.data.objects.new(f"ResidenceTier{TIER}_Root", None)
bpy.context.scene.collection.objects.link(ROOT_OBJECT)
ROOT_OBJECT["residence_kit_assembly"] = True
ROOT_OBJECT["residence_tier"] = TIER
ROOT_OBJECT["source_kit"] = "gorski-architecture-kit-1.1.0"
ROOT_OBJECT["concept_reference"] = "Tripo GLBs used for tier-progression massing only"
ROOT_OBJECT["body_width_m"] = float(SPEC["width"])
ROOT_OBJECT["body_depth_m"] = float(SPEC["depth"])
ROOT_OBJECT["ridge_height_m"] = RIDGE_Z
ROOT_OBJECT["signature_silhouette"] = str(SPEC["signature"])
ASSEMBLY_OBJECTS.append(ROOT_OBJECT)


def record(obj: bpy.types.Object, source_id: str, collection: bpy.types.Collection) -> None:
    obj["residence_kit_instance"] = True
    obj["residence_tier"] = TIER
    obj["source_component_id"] = source_id
    obj["assembly_role"] = collection.name
    obj.parent = ROOT_OBJECT
    ASSEMBLY_OBJECTS.append(obj)
    PLACEMENTS.append({
        "name": obj.name,
        "source": source_id,
        "collection": collection.name,
        "location": [round(float(value), 5) for value in obj.location],
        "rotationZDegrees": round(math.degrees(float(obj.rotation_euler.z)), 5),
        "scale": [1.0, 1.0, 1.0],
    })


def place(
    part_id: str,
    name: str,
    collection: bpy.types.Collection,
    location: tuple[float, float, float],
    rotation_z: float = 0.0,
) -> bpy.types.Object:
    source = SOURCES.get(part_id)
    if source is None:
        raise KeyError(f"Missing source component {part_id}")
    obj = source.copy()
    if source.data is not None:
        obj.data = source.data.copy()
    obj.name = name
    obj.location = location
    obj.rotation_euler = (0.0, 0.0, rotation_z)
    obj.scale = (1.0, 1.0, 1.0)
    collection.objects.link(obj)
    record(obj, part_id, collection)
    return obj


def material(key: str) -> bpy.types.Material:
    found = bpy.data.materials.get(f"GK_Mat_{key}")
    if found is None:
        raise KeyError(f"Missing kit material GK_Mat_{key}")
    return found


def add_metric_uv(mesh: bpy.types.Mesh) -> None:
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


def make_prism(
    name: str,
    collection: bpy.types.Collection,
    top: list[tuple[float, float, float]],
    thickness: float,
    material_key: str,
    source_id: str,
) -> bpy.types.Object:
    vertices = top + [(x, y, z - thickness) for x, y, z in top]
    faces = [
        (0, 1, 2, 3),
        (7, 6, 5, 4),
        (0, 4, 5, 1),
        (1, 5, 6, 2),
        (2, 6, 7, 3),
        (3, 7, 4, 0),
    ]
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    add_metric_uv(mesh)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.data.materials.append(material(material_key))
    obj["custom_assembly_piece"] = True
    record(obj, source_id, collection)
    return obj


def spans(length: float) -> list[tuple[float, float, str]]:
    remaining = round(length, 5)
    cursor = -length * 0.5
    result: list[tuple[float, float, str]] = []
    while remaining > 0.001:
        if remaining >= 3.999:
            width, token = 4.0, "4m"
        elif remaining >= 1.999:
            width, token = 2.0, "2m"
        elif remaining >= 0.999:
            width, token = 1.0, "1m"
        else:
            width, token = 0.5, "0p5m"
        result.append((cursor + width * 0.5, width, token))
        cursor += width
        remaining -= width
    return result


def place_perimeter_run(
    part_prefix: str,
    height_token: str,
    width: float,
    depth: float,
    z: float,
    collection: bpy.types.Collection,
    name_prefix: str,
) -> None:
    def available_spans(length: float) -> list[tuple[float, float, str]]:
        remaining = round(length, 5)
        cursor = -length * 0.5
        result: list[tuple[float, float, str]] = []
        candidates = ((4.0, "4m"), (2.0, "2m"), (1.0, "1m"), (0.5, "0p5m"))
        while remaining > 0.001:
            selected = next(
                (
                    (span_width, token)
                    for span_width, token in candidates
                    if remaining + 0.001 >= span_width
                    and f"{part_prefix}_{token}_{height_token}" in SOURCES
                ),
                None,
            )
            if selected is None:
                raise KeyError(f"No source span can complete {part_prefix} {height_token} over {length} m")
            span_width, token = selected
            result.append((cursor + span_width * 0.5, span_width, token))
            cursor += span_width
            remaining -= span_width
        return result

    for center, _, token in available_spans(width):
        part = f"{part_prefix}_{token}_{height_token}"
        place(part, f"{name_prefix}_Front_{center:+g}", collection, (center, 0.0, z))
        place(part, f"{name_prefix}_Rear_{center:+g}", collection, (-center, depth, z), math.pi)
    for center, _, token in available_spans(depth):
        part = f"{part_prefix}_{token}_{height_token}"
        world_y = center + depth * 0.5
        place(part, f"{name_prefix}_Left_{world_y:g}", collection, (-width * 0.5, world_y, z), -math.pi * 0.5)
        place(part, f"{name_prefix}_Right_{world_y:g}", collection, (width * 0.5, depth - world_y, z), math.pi * 0.5)


def wall_part(style: str, role: str) -> str:
    if role == "door":
        return f"wall_{style}_2m_door_house_host"
    if role == "window":
        return f"wall_{style}_2m_window_domestic_host"
    return f"wall_{style}_2m_h2p7m"


def opening_part(role: str, high_status: bool = False) -> str | None:
    if role == "door":
        return "opening_door_house_single"
    if role == "window":
        return "opening_window_domestic_leaded" if high_status else "opening_window_domestic_shuttered"
    return None


def place_storey(
    style: str,
    z: float,
    collection: bpy.types.Collection,
    front_roles: list[str],
    side_window_stride: int,
    high_status: bool = False,
) -> None:
    width = float(SPEC["width"])
    depth = float(SPEC["depth"])
    front_centers = [-width * 0.5 + 1.0 + index * 2.0 for index in range(int(width / 2.0))]
    for index, center in enumerate(front_centers):
        role = front_roles[index]
        loc = (center, 0.0, z)
        place(wall_part(style, role), f"R{TIER}_{collection.name}_FrontHost_{index}", collection, loc)
        insert = opening_part(role, high_status)
        if insert:
            opened = place(insert, f"Residence{role.title()}_Front_{index}", OPENINGS, loc)
            opened["residence_opening_kind"] = role
    for index, center in enumerate(front_centers):
        role = "window" if index % 2 == 0 else "plain"
        loc = (-center, depth, z)
        place(wall_part(style, role), f"R{TIER}_{collection.name}_RearHost_{index}", collection, loc, math.pi)
        insert = opening_part(role, high_status)
        if insert:
            opened = place(insert, f"ResidenceWindow_Rear_{index}", OPENINGS, loc, math.pi)
            opened["residence_opening_kind"] = "window"
    side_count = int(depth / 2.0)
    for side_name, x, rotation in (
        ("Left", -width * 0.5, -math.pi * 0.5),
        ("Right", width * 0.5, math.pi * 0.5),
    ):
        for index in range(side_count):
            y = 1.0 + index * 2.0
            role = "window" if index % side_window_stride == 0 else "plain"
            loc = (x, y if side_name == "Left" else depth - y, z)
            place(wall_part(style, role), f"R{TIER}_{collection.name}_{side_name}Host_{index}", collection, loc, rotation)
            insert = opening_part(role, high_status)
            if insert:
                opened = place(insert, f"ResidenceWindow_{side_name}_{index}", OPENINGS, loc, rotation)
                opened["residence_opening_kind"] = "window"


def place_foundation() -> None:
    width = float(SPEC["width"])
    depth = float(SPEC["depth"])
    prefix = f"foundation_{SPEC['foundation']}"
    height_token = "h1p2m" if float(SPEC["foundation_height"]) > 1.0 else "h0p65m"
    place_perimeter_run(prefix, height_token, width, depth, 0.0, FOUNDATION, f"R{TIER}_Foundation")


def place_shell() -> None:
    width = float(SPEC["width"])
    depth = float(SPEC["depth"])
    front_count = int(width / 2.0)
    lower_roles = ["window"] * front_count
    lower_roles[max(0, front_count // 2 - 1)] = "door"
    place_storey(str(SPEC["ground_style"]), 0.0, LOWER, lower_roles, 2)

    upper_z = float(SPEC["ground_height"])
    upper_height = float(SPEC["upper_height"])
    if upper_height >= 2.4:
        place_storey(str(SPEC["upper_style"]), upper_z, UPPER, ["window"] * front_count, 1, high_status=TIER == 4)
    else:
        place_perimeter_run(
            f"wall_{SPEC['upper_style']}",
            "h1p35m",
            width,
            depth,
            upper_z,
            UPPER,
            f"R{TIER}_KneeWall",
        )
        for index, x in enumerate((-1.5, 1.5)):
            window = place("opening_window_small_plain", f"ResidenceWindow_Knee_{index}", OPENINGS, (x, -0.08, upper_z - 0.48))
            window["residence_opening_kind"] = "window"

    gable_width = 6 if width >= 6 else 4
    for label, y, rotation in (("Front", 0.0, 0.0), ("Rear", depth, math.pi)):
        place(f"gable_infill_{SPEC['gable_style']}_{gable_width}m", f"R{TIER}_Gable_{label}", UPPER, (0.0, y, WALL_TOP), rotation)
        place(f"frame_gable_truss_{gable_width}m", f"R{TIER}_GableTruss_{label}", FRAMES, (0.0, y - 0.02 if label == "Front" else y + 0.02, WALL_TOP), rotation)


def roof_height_at_x(x: float) -> float:
    return RIDGE_Z - abs(x) * math.tan(PITCH)


def place_roof() -> None:
    width = float(SPEC["width"])
    depth = float(SPEC["depth"])
    overhang = 0.42
    verge = 0.36
    eave_x = width * 0.5 + overhang
    eave_z = roof_height_at_x(eave_x)
    finish = "terracotta" if SPEC["roof_style"] == "tile" else "shingles"
    for side, label in ((-1.0, "Left"), (1.0, "Right")):
        outer_x = side * eave_x
        roof = make_prism(
            f"ResidenceRoofSurface_{label}",
            ROOF,
            [(0.0, -verge, RIDGE_Z), (0.0, depth + verge, RIDGE_Z), (outer_x, depth + verge, eave_z), (outer_x, -verge, eave_z)],
            0.11 if TIER < 4 else 0.14,
            finish,
            f"assembly_custom_{SPEC['roof_style']}_roof_skin",
        )
        roof["residence_roof_surface"] = True
        roof["residence_roof_finish"] = "fired-clay-tile" if TIER == 4 else "split-wood-shingle"

    ridge_lengths = spans(depth)
    for index, (center, _, token) in enumerate(ridge_lengths):
        y = center + depth * 0.5
        place(f"roof_{SPEC['roof_style']}_ridge_{token}", f"R{TIER}_Roof_Ridge_{index}", ROOF, (0.0, y, RIDGE_Z + 0.035), math.pi * 0.5)
    for side, label in ((-1.0, "Left"), (1.0, "Right")):
        for index, (center, _, token) in enumerate(ridge_lengths):
            y = center + depth * 0.5
            place(f"roof_{SPEC['roof_style']}_eave_edge_{token}", f"R{TIER}_Roof_Eave_{label}_{index}", ROOF, (side * eave_x, y, eave_z + 0.02), math.pi * 0.5)

    for index, (x, y) in enumerate(SPEC["chimneys"]):
        surface_z = roof_height_at_x(float(x))
        chimney = place("production_chimney_limestone_h4m", f"ResidenceChimney_{index}", FIXED, (float(x), float(y), max(1.4, surface_z - 2.55)))
        chimney["residence_chimney"] = True
        flashing = place(f"roof_{SPEC['roof_style']}_chimney_flashing", f"ResidenceChimneyFlashing_{index}", ROOF, (float(x), float(y), surface_z + 0.03))
        flashing["residence_roof_junction"] = "chimney-flashing"

    if TIER == 4:
        # Keep the dormer face close to the eave. Farther upslope the main roof
        # occludes the lower frame and makes the cap read as a floating object.
        # This exposes the reusable dormer assembly while its rear still keys
        # visibly into the tile roof.
        dormer_x = width * 0.44
        dormer_y = depth * 0.38
        dormer_z = roof_height_at_x(dormer_x) + 0.10
        wall = place(
            "wall_limewash_2m_h1p35m",
            "ResidenceDormerWall",
            ROOF,
            (dormer_x, dormer_y, dormer_z),
            math.pi * 0.5,
        )
        wall["residence_signature_feature"] = "covered-dormer"
        dormer_window = place(
            "opening_window_small_plain",
            "ResidenceWindow_Dormer",
            OPENINGS,
            (dormer_x + 0.02, dormer_y, dormer_z - 0.65),
            math.pi * 0.5,
        )
        dormer_window["residence_opening_kind"] = "window"
        frame = place("roof_dormer_frame_2m", "ResidenceDormerFrame", ROOF, (dormer_x, dormer_y, dormer_z), math.pi * 0.5)
        frame["residence_signature_feature"] = "covered-dormer"
        dormer_ridge_z = dormer_z + 1.92
        dormer_eave_z = dormer_z + 1.31
        dormer_inner_x = dormer_x - 0.76
        dormer_outer_x = dormer_x + 0.76
        dormer_half_span = 0.76
        for label, top in (
            (
                "Front",
                [
                    (dormer_inner_x, dormer_y, dormer_ridge_z),
                    (dormer_outer_x, dormer_y, dormer_ridge_z),
                    (dormer_outer_x, dormer_y - dormer_half_span, dormer_eave_z),
                    (dormer_inner_x, dormer_y - dormer_half_span, dormer_eave_z),
                ],
            ),
            (
                "Rear",
                [
                    (dormer_inner_x, dormer_y + dormer_half_span, dormer_eave_z),
                    (dormer_outer_x, dormer_y + dormer_half_span, dormer_eave_z),
                    (dormer_outer_x, dormer_y, dormer_ridge_z),
                    (dormer_inner_x, dormer_y, dormer_ridge_z),
                ],
            ),
        ):
            dormer_roof = make_prism(
                f"ResidenceDormerRoof_{label}",
                ROOF,
                top,
                0.10,
                "terracotta",
                "assembly_custom_tile_dormer_roof_skin",
            )
            dormer_roof["residence_roof_surface"] = True
            dormer_roof["residence_signature_feature"] = "covered-dormer"


def place_fixed_architecture() -> None:
    width = float(SPEC["width"])
    place("foundation_steps_limestone_3" if TIER < 4 else "foundation_steps_limestone_5", "ResidenceEntranceSteps", FIXED, (-1.0, -0.62, 0.0))
    if TIER >= 3:
        for index, x in enumerate((-2.0, 2.0) if width >= 8.0 else (0.0,)):
            gallery = place("frame_balcony_4m", f"ResidenceGallery_{index}", FRAMES, (x, -0.46, float(SPEC["ground_height"]) - 0.08))
            gallery["residence_signature_feature"] = "front-gallery"
    if TIER == 3:
        lean_y = float(SPEC["depth"]) * 0.68
        lean_to = place("frame_lean_to_4m", "ResidenceWorkingLeanTo", FRAMES, (width * 0.5 + 0.08, lean_y, 0.0), math.pi * 0.5)
        lean_to["residence_signature_feature"] = "working-annex"
        annex_roof = make_prism(
            "ResidenceAnnexRoof",
            ROOF,
            [
                (width * 0.5 - 0.12, lean_y - 2.18, 2.58),
                (width * 0.5 - 0.12, lean_y + 2.18, 2.58),
                (width * 0.5 + 1.82, lean_y + 2.18, 1.88),
                (width * 0.5 + 1.82, lean_y - 2.18, 1.88),
            ],
            0.10,
            "shingles",
            "assembly_custom_shingle_annex_roof",
        )
        annex_roof["residence_signature_feature"] = "working-annex-roof"
    if TIER == 4:
        for index, x in enumerate((-3.0, -1.0, 1.0, 3.0)):
            place("civic_town_balustrade_2m", f"ResidenceStoneBalustrade_{index}", FIXED, (x, -0.78, float(SPEC["ground_height"]) + 0.02))


def triangle_count() -> int:
    return sum(
        sum(len(poly.vertices) - 2 for poly in obj.data.polygons)
        for obj in ASSEMBLY_OBJECTS
        if obj.type == "MESH" and obj.data is not None
    )


def validate_native() -> dict[str, object]:
    failures: list[str] = []
    material_keys: set[str] = set()
    source_ids: set[str] = set()
    for obj in ASSEMBLY_OBJECTS:
        if tuple(round(value, 6) for value in obj.scale) != (1.0, 1.0, 1.0):
            failures.append(f"non-unit scale: {obj.name}")
        source_id = obj.get("source_component_id")
        if source_id:
            source_ids.add(str(source_id))
        if obj.type != "MESH":
            continue
        if not obj.data.vertices or not obj.data.polygons:
            failures.append(f"empty mesh: {obj.name}")
        if obj.data.uv_layers.get("GK_UV0") is None:
            failures.append(f"missing GK_UV0: {obj.name}")
        for slot in obj.material_slots:
            if slot.material is None:
                failures.append(f"empty material slot: {obj.name}")
                continue
            key = slot.material.get("gk_material_key")
            if key:
                material_keys.add(str(key))
    if len(source_ids) < 12:
        failures.append(f"insufficient reusable source breadth: {len(source_ids)}")
    if not {"fieldstone", "oak_dark"}.issubset(material_keys):
        failures.append(f"missing core materials: {sorted(material_keys)}")
    payload = {
        "schemaVersion": 1,
        "tier": TIER,
        "passed": not failures,
        "failures": failures,
        "objectCount": len(ASSEMBLY_OBJECTS),
        "meshCount": sum(1 for obj in ASSEMBLY_OBJECTS if obj.type == "MESH"),
        "triangleCount": triangle_count(),
        "uniqueSourcePartCount": len(source_ids),
        "sourcePartIds": sorted(source_ids),
        "materialKeys": sorted(material_keys),
        "unitScale": "metres",
        "canonicalObjectScale": [1.0, 1.0, 1.0],
        "vegetation": "excluded; SeedThree-owned",
    }
    OUT_VALIDATION.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    if failures:
        raise RuntimeError("; ".join(failures))
    return payload


def write_manifest(validation: dict[str, object]) -> None:
    payload = {
        "schemaVersion": 1,
        "id": STEM,
        "tier": TIER,
        "regionalContext": "Gorski Kotar and Croatian Littoral, circa 1550",
        "sourceKit": "gorski-architecture-kit-1.1.0",
        "conceptReferencePolicy": "Attached Tripo GLBs informed only footprint, silhouette, and tier progression; no source mesh, UV, material, or texture was reused.",
        "signatureSilhouette": SPEC["signature"],
        "dimensionsMetres": {
            "bodyWidth": SPEC["width"],
            "bodyDepth": SPEC["depth"],
            "groundStorey": SPEC["ground_height"],
            "upperStorey": SPEC["upper_height"],
            "wallTop": WALL_TOP,
            "ridge": round(RIDGE_Z, 5),
        },
        "roofFinish": "fired clay tile" if TIER == 4 else "hand-split softwood shingles",
        "materialAuthority": "src/buildings/buildingMaterials.ts through semantic gk_material_key metadata",
        "canonicalState": "neutral shell; runtime owns firewood, smoke emission, and occupied window glow",
        "livingVegetation": "excluded; SeedThree-owned",
        "validation": validation,
        "placements": PLACEMENTS,
    }
    OUT_MANIFEST.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def remove_source_library_objects() -> None:
    for obj in list(bpy.data.objects):
        if obj not in ASSEMBLY_OBJECTS:
            bpy.data.objects.remove(obj, do_unlink=True)
    for current in list(bpy.data.collections):
        if current.name.startswith("GK_") and not current.objects:
            bpy.data.collections.remove(current)


def point_at(obj: bpy.types.Object, target: tuple[float, float, float]) -> None:
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_preview_staging() -> bpy.types.Object:
    bpy.ops.mesh.primitive_plane_add(size=28.0, location=(0.0, float(SPEC["depth"]) * 0.5, -0.03))
    ground = bpy.context.object
    ground.name = "PreviewGround"
    for owner in list(ground.users_collection):
        owner.objects.unlink(ground)
    PREVIEW.objects.link(ground)
    ground.data.materials.append(material("earth"))
    ground["preview_only"] = True

    camera_data = bpy.data.cameras.new("PreviewCamera")
    camera = bpy.data.objects.new("PreviewCamera", camera_data)
    PREVIEW.objects.link(camera)
    camera["preview_only"] = True
    camera.data.lens = 58
    bpy.context.scene.camera = camera
    for name, location, energy, size in (
        ("PreviewKey", (-11.0, -9.0, 17.0), 1450.0, 7.0),
        ("PreviewFill", (10.0, 12.0, 11.0), 850.0, 6.0),
    ):
        light_data = bpy.data.lights.new(name, type="AREA")
        light_data.energy = energy
        light_data.shape = "DISK"
        light_data.size = size
        light = bpy.data.objects.new(name, light_data)
        PREVIEW.objects.link(light)
        light.location = location
        light["preview_only"] = True
        point_at(light, (0.0, float(SPEC["depth"]) * 0.5, WALL_TOP * 0.55))
    return camera


def configure_render() -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1100
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    if scene.world is None:
        scene.world = bpy.data.worlds.new("ResidencePreviewWorld")
    scene.world.color = (0.055, 0.067, 0.048)
    scene.view_settings.look = "AgX - Medium High Contrast"


def render_views(camera: bpy.types.Object) -> None:
    depth = float(SPEC["depth"])
    target = (0.0, depth * 0.48, WALL_TOP * 0.62)
    distance = max(float(SPEC["width"]), depth) * 1.55
    for path, location in (
        (OUT_HERO, (distance, -distance * 0.85, RIDGE_Z * 0.86)),
        (OUT_FRONT, (0.0, -distance * 1.45, WALL_TOP * 0.85)),
        (OUT_REAR, (-distance, depth + distance * 0.80, RIDGE_Z * 0.78)),
    ):
        camera.location = location
        point_at(camera, target)
        bpy.context.scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)


def export_glb() -> None:
    staged = OUT_GLB.with_name(f"{OUT_GLB.stem}.exporting.glb")
    staged.unlink(missing_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in ASSEMBLY_OBJECTS:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = ROOT_OBJECT
    try:
        bpy.ops.export_scene.gltf(
            filepath=str(staged),
            export_format="GLB",
            use_selection=True,
            export_yup=True,
            export_apply=True,
            export_extras=True,
        )
        for attempt in range(12):
            try:
                staged.replace(OUT_GLB)
                break
            except PermissionError:
                if attempt == 11:
                    raise
                time.sleep(0.25)
    finally:
        staged.unlink(missing_ok=True)


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    RENDER_DIR.mkdir(parents=True, exist_ok=True)
    place_foundation()
    place_shell()
    place_roof()
    place_fixed_architecture()
    validation = validate_native()
    write_manifest(validation)
    remove_source_library_objects()
    camera = add_preview_staging()
    configure_render()
    scene = bpy.context.scene
    scene["artifact_id"] = STEM
    scene["residence_tier"] = TIER
    scene["architecture_context"] = "Gorski Kotar and Croatian Littoral, circa 1550"
    scene["source_kit"] = "gorski-architecture-kit-1.1.0"
    scene["roof_finish"] = "fired-clay-tile" if TIER == 4 else "split-wood-shingle"
    scene["canonical_state"] = "neutral; runtime owns firewood, smoke, and occupied window glow"
    scene["living_vegetation"] = "excluded; SeedThree-owned"
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT_BLEND))
    export_glb()
    render_views(camera)
    print(f"RESIDENCE_TIER={TIER}")
    print(f"RESIDENCE_BLEND={OUT_BLEND}")
    print(f"RESIDENCE_GLB={OUT_GLB}")
    print(f"RESIDENCE_TRIANGLES={triangle_count()}")
    print(f"RESIDENCE_PLACEMENTS={len(PLACEMENTS)}")


if __name__ == "__main__":
    main()
