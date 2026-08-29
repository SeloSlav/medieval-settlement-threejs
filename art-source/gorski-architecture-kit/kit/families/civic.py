from __future__ import annotations

import math

from .. import spec
from ..core import MeshBuilder, Registry
from .common import add


def register(registry: Registry) -> None:
    family = "civic"
    for size in ("small", "large"):
        add(registry, f"civic_belfry_frame_{size}", family, f"Open timber belfry {size}", ("civic", "religious", "chapel", "belfry", size), lambda b, s=size: _belfry(b, s), triangle_budget=7_200)
        add(registry, f"civic_bell_{size}", family, f"Cast bell {size}", ("civic", "religious", "chapel", "bell", size), lambda b, s=size: _bell(b, s), triangle_budget=4_800)
    for width in (1.0, 2.0, 4.0):
        token = spec.width_token(width)
        add(registry, f"civic_cloister_arcade_{token}", family, f"Monastery cloister arcade {width:g} m", ("civic", "religious", "monastery", "cloister", "arcade"), lambda b, w=width: _arcade(b, w), triangle_budget=7_200)
        add(registry, f"civic_town_balustrade_{token}", family, f"Town hall balustrade {width:g} m", ("civic", "town-hall", "balcony", "balustrade"), lambda b, w=width: _balustrade(b, w), triangle_budget=5_200)

    add(registry, "civic_chapel_apse_halfround", family, "Half-round chapel apse shell", ("civic", "religious", "chapel", "apse", "wall-module"), _apse, allow_nonmanifold=True, triangle_budget=7_600)
    add(registry, "civic_chapel_nave_bay_plain_4m", family, "Limewashed chapel nave wall bay", ("civic", "religious", "chapel", "nave", "wall-bay"), lambda b: _church_nave_bay(b, False), seams=("x=-2", "x=+2", "z=0"), triangle_budget=9_200, bevel=0.008)
    add(registry, "civic_chapel_nave_bay_lancet_4m", family, "Chapel nave host bay for lancet", ("civic", "religious", "chapel", "nave", "lancet-host", "wall-bay"), lambda b: _church_nave_bay(b, True), seams=("x=-2", "x=+2", "z=0"), opening_contract="window_lancet", triangle_budget=9_600, bevel=0.008)
    add(registry, "civic_chapel_facade_gable_4m", family, "Chapel west-front gable and portal host", ("civic", "religious", "chapel", "facade", "gable", "portal-host"), _church_facade_gable, seams=("x=-2", "x=+2", "z=0"), opening_contract="door_barn", triangle_budget=11_000, bevel=0.008)
    add(registry, "civic_chapel_buttress_low", family, "Low chapel wall buttress", ("civic", "religious", "chapel", "buttress", "wall-junction"), lambda b: _buttress(b, 2.55), triangle_budget=5_400, bevel=0.008)
    add(registry, "civic_chapel_buttress_tall", family, "Tall chapel facade buttress", ("civic", "religious", "chapel", "buttress", "facade-junction"), lambda b: _buttress(b, 4.15), triangle_budget=6_800, bevel=0.008)
    add(registry, "civic_chapel_belfry_transition", family, "Masonry-to-timber belfry transition curb", ("civic", "religious", "chapel", "belfry", "transition", "junction"), _belfry_transition, triangle_budget=7_200, bevel=0.008)
    add(registry, "civic_chapel_sacristy_junction", family, "Chapel nave-to-sacristy junction", ("civic", "religious", "chapel", "sacristy", "junction"), _sacristy_junction, triangle_budget=8_400, bevel=0.008)
    add(registry, "civic_chapel_cornice_4m", family, "Chapel moulded stone cornice 4 m", ("civic", "religious", "chapel", "facade", "cornice", "trim"), _church_cornice, seams=("x=-2", "x=+2"), triangle_budget=7_200, bevel=0.006)
    add(registry, "civic_chapel_gable_trim_4m", family, "Chapel restrained folk gable trim", ("civic", "religious", "chapel", "facade", "gable", "folk-trim"), _church_gable_trim, seams=("x=-2", "x=+2"), triangle_budget=8_400, bevel=0.006)
    add(registry, "civic_chapel_quoin_stack_3p4m", family, "Chapel alternating limestone quoin stack", ("civic", "religious", "chapel", "facade", "quoin", "corner"), _church_quoin_stack, seams=("z=0", "z=3.4"), triangle_budget=6_400, bevel=0.006)
    add(registry, "civic_church_nave_bay_plain_4m_h5p4m", family, "Tall limewashed parish-church nave bay", ("civic", "religious", "church", "nave", "wall-bay", "tall"), lambda b: _tall_church_nave_bay(b, False), seams=("x=-2", "x=+2", "z=0", "z=5.4"), triangle_budget=11_200, bevel=0.008)
    add(registry, "civic_church_nave_bay_lancet_4m_h5p4m", family, "Tall parish-church nave bay with arched window host", ("civic", "religious", "church", "nave", "window-host", "wall-bay", "tall"), lambda b: _tall_church_nave_bay(b, True), seams=("x=-2", "x=+2", "z=0", "z=5.4"), opening_contract="window_lancet", triangle_budget=11_800, bevel=0.008)
    add(registry, "civic_church_west_portal_bay_3m_h5p4m", family, "Three-metre parish west-front side portal bay", ("civic", "religious", "church", "facade", "portal-host", "wall-bay", "tall"), _church_west_portal_bay, seams=("x=-1.5", "x=+1.5", "z=0", "z=5.4"), opening_contract="door_house", triangle_budget=12_800, bevel=0.008)
    add(registry, "civic_church_tower_shaft_bay_4m_h4m", family, "Enclosed limewashed church-tower shaft bay", ("civic", "religious", "church", "tower", "shaft", "wall-bay"), _church_tower_shaft_bay, seams=("x=-2", "x=+2", "z=0", "z=4"), triangle_budget=8_800, bevel=0.008)
    add(registry, "civic_church_tower_belfry_bay_4m_h3m", family, "Enclosed church-tower belfry louver host bay", ("civic", "religious", "church", "tower", "belfry", "louver-host", "wall-bay"), _church_tower_belfry_bay, seams=("x=-2", "x=+2", "z=0", "z=3"), opening_contract="window_domestic", triangle_budget=10_400, bevel=0.008)
    add(registry, "civic_church_tower_belfry_bay_4m_h3p8m", family, "Tall enclosed church-tower belfry and clock bay", ("civic", "religious", "church", "tower", "belfry", "clock-bay", "louver-host", "wall-bay"), lambda b: _church_tower_belfry_bay(b, 3.8), seams=("x=-2", "x=+2", "z=0", "z=3.8"), opening_contract="window_domestic", triangle_budget=10_800, bevel=0.008)
    add(registry, "civic_church_cross_iron_large", family, "Parish church iron ridge cross", ("civic", "religious", "church", "cross", "iron", "finial"), lambda b: _church_cross(b, "iron"), triangle_budget=4_800, bevel=0.004)
    add(registry, "civic_church_cross_stone", family, "Carved limestone church cross", ("civic", "religious", "church", "cross", "stone", "finial"), lambda b: _church_cross(b, "stone"), triangle_budget=5_200, bevel=0.008)
    add(registry, "civic_shrine_canopy", family, "Wayside shrine canopy", ("civic", "religious", "shrine", "canopy"), _shrine_canopy, triangle_budget=5_400)
    add(registry, "civic_shrine_niche_stone", family, "Wayside shrine stone niche", ("civic", "religious", "shrine", "niche"), _shrine_niche, allow_nonmanifold=True, triangle_budget=5_800)
    add(registry, "civic_shrine_rear_wall_limewash_1p5m", family, "Wayside shrine limewashed rear closure", ("civic", "religious", "shrine", "rear-wall", "closure", "limewash"), _shrine_rear_wall, seams=("x=-0.75", "x=+0.75", "z=0", "z=2.08"), triangle_budget=1_200, bevel=0.006)
    add(registry, "civic_shrine_plinth_stone", family, "Wayside shrine stepped stone plinth", ("civic", "religious", "shrine", "plinth", "foundation"), _shrine_plinth, triangle_budget=6_400, bevel=0.008)
    add(registry, "civic_shrine_votive_ledge", family, "Wayside shrine votive and offering ledge", ("civic", "religious", "shrine", "votive", "offering"), _shrine_votive_ledge, triangle_budget=6_200, bevel=0.006)
    add(registry, "civic_shrine_half_column_pair", family, "Wayside shrine carved half-column pair", ("civic", "religious", "shrine", "column", "facade"), _shrine_columns, triangle_budget=6_800, bevel=0.006)
    add(registry, "civic_shrine_iron_cross", family, "Wayside shrine iron gable cross", ("civic", "religious", "shrine", "cross", "iron"), lambda b: _church_cross(b, "iron", 0.62), triangle_budget=4_000, bevel=0.004)
    add(registry, "civic_shrine_side_rail_2m", family, "Wayside shrine low devotional rail", ("civic", "religious", "shrine", "enclosure", "rail"), _shrine_rail, seams=("x=-1", "x=+1"), triangle_budget=5_200, bevel=0.006)
    add(registry, "civic_processional_cross", family, "Village processional cross", ("civic", "religious", "cross", "marker"), _processional_cross)
    add(registry, "civic_monastery_cell_bay_4m", family, "Pauline monastery cell facade bay", ("civic", "religious", "monastery", "cell", "facade", "wall-bay"), _monastery_cell_bay, seams=("x=-2", "x=+2", "z=0"), triangle_budget=9_800, bevel=0.008)
    add(registry, "civic_cloister_corner", family, "Monastery cloister arcade corner", ("civic", "religious", "monastery", "cloister", "corner"), _cloister_corner, triangle_budget=9_200, bevel=0.008)

    for width in (2.0, 4.0, 6.0):
        token = spec.width_token(width)
        add(registry, f"civic_watch_platform_{token}", family, f"Watchtower platform {width:g} m", ("civic", "defence", "watchtower", "platform"), lambda b, w=width: _watch_platform(b, w), triangle_budget=6_400)
        add(registry, f"civic_hoarding_panel_{token}", family, f"Defensive hoarding panel {width:g} m", ("civic", "defence", "watchtower", "guardhouse", "hoarding"), lambda b, w=width: _hoarding(b, w), triangle_budget=6_200)
    add(registry, "civic_watch_ladder_4m", family, "Watchtower ladder 4 m", ("civic", "defence", "watchtower", "ladder"), lambda b: _ladder(b, 4.0))
    add(registry, "civic_guard_brazier", family, "Iron guard brazier", ("civic", "defence", "guardhouse", "fire"), _brazier, triangle_budget=4_600)
    add(registry, "civic_refuge_gate_crown", family, "Palisaded refuge gate crown", ("civic", "defence", "refuge", "gate", "palisade"), _gate_crown, triangle_budget=6_200)

    add(registry, "civic_town_notice_board", family, "Town notice board", ("civic", "town-hall", "notice", "public"), _notice_board)
    add(registry, "civic_market_scale", family, "Covered market balance scale", ("civic", "market", "trade", "scale"), _market_scale, triangle_budget=4_800)
    add(registry, "civic_trade_sign_hanging", family, "Hanging trade sign bracket", ("civic", "trading-post", "tavern", "shop", "sign"), _trade_sign)
    add(registry, "civic_tavern_gallery_4m", family, "Tavern gallery front 4 m", ("civic", "tavern", "gallery", "social"), lambda b: _tavern_gallery(b, 4.0), triangle_budget=6_200)

    add(registry, "civic_storehouse_loading_hood", family, "Storehouse loading hood", ("civic", "storehouse", "loading", "hoist"), _loading_hood, triangle_budget=5_200)
    add(registry, "civic_stable_hayhood", family, "Stable hayloft hood", ("civic", "stable", "hay", "loading"), _loading_hood, triangle_budget=5_200)
    add(registry, "civic_granary_vent_cupola", family, "Granary vent cupola", ("civic", "granary", "vent", "roof-module"), _cupola, triangle_budget=5_800)


def _belfry(builder: MeshBuilder, size: str) -> None:
    width, height = ((2.1, 3.6) if size == "large" else (1.45, 2.75))
    section = 0.20 if size == "large" else 0.16
    for x in (-width * 0.5, width * 0.5):
        for y in (-width * 0.35, width * 0.35):
            builder.box((section, section, height), (x, y, height * 0.5), "oak_dark")
    for z in (0.18, height * 0.72, height - 0.18):
        builder.box((width + section, section, section), (0.0, -width * 0.35, z), "oak_dark")
        builder.box((width + section, section, section), (0.0, width * 0.35, z), "oak_dark")
    for side in (-1.0, 1.0):
        builder.beam_between((side * width * 0.5, -width * 0.35, height * 0.22), (side * width * 0.13, -width * 0.35, height * 0.50), section * 0.72, "timber_cut")
        builder.beam_between((side * width * 0.5, width * 0.35, height * 0.22), (side * width * 0.13, width * 0.35, height * 0.50), section * 0.72, "timber_cut")
    builder.box((width + 0.42, width * 0.92, 0.16), (0.0, 0.0, height + 0.08), "oak_dark")
    builder.cylinder(0.11, width * 0.82, (0.0, 0.0, height * 0.72), "timber_cut", 10, "y")


def _bell(builder: MeshBuilder, size: str) -> None:
    radius, height = ((0.48, 0.70) if size == "large" else (0.32, 0.48))
    builder.cone(radius, radius * 0.42, height, (0.0, 0.0, height * 0.5), "brass", 16)
    builder.cylinder(radius * 0.12, height * 0.65, (0.0, 0.0, -height * 0.05), "iron", 8, "z")
    builder.box((radius * 0.58, 0.14, 0.16), (0.0, 0.0, height + 0.06), "oak_dark")


def _arcade(builder: MeshBuilder, width: float) -> None:
    bays = max(1, round(width / 2.0))
    bay = width / bays
    for index in range(bays):
        x = -width * 0.5 + bay * (index + 0.5)
        local = MeshBuilder(f"{builder.piece_id}_{index}")
        local.arch_ring(bay * 0.78, 2.35, 0.42, 0.22, "limestone_warm", 11)
        for vertex in local.vertices:
            builder.vertices.append((vertex[0] + x, vertex[1], vertex[2]))
        offset = len(builder.vertices) - len(local.vertices)
        builder.faces.extend(tuple(offset + i for i in face) for face in local.faces)
        builder.face_materials.extend(local.face_materials)


def _balustrade(builder: MeshBuilder, width: float) -> None:
    builder.box((width, 0.20, 0.18), (0.0, 0.0, 0.12), "limestone_warm")
    builder.box((width, 0.22, 0.18), (0.0, 0.0, 1.12), "limestone_warm")
    count = max(2, round(width / 0.42))
    for index in range(count):
        x = -width * 0.5 + width * (index + 0.5) / count
        builder.cone(0.10, 0.07, 0.90, (x, 0.0, 0.62), "limestone_warm", 8)


def _apse(builder: MeshBuilder) -> None:
    radius = 1.6
    segments = 13
    for index in range(segments):
        angle = math.pi * index / (segments - 1)
        x = radius * math.cos(angle)
        y = radius * math.sin(angle)
        builder.box((0.43, 0.42, 0.62), (x, y, 0.31), "fieldstone", (0.0, 0.0, angle))
        builder.box((0.43, 0.34, 2.42), (x, y, 1.83), "limewash", (0.0, 0.0, angle))
        if index in (0, 4, 8, 12):
            for course in range(6):
                builder.box((0.48, 0.46, 0.25), (x * 1.02, y * 1.02, 0.22 + course * 0.48), "limestone_warm", (0.0, 0.0, angle + (0.018 if course % 2 else -0.018)))
    builder.box((3.62, 0.52, 0.22), (0.0, 0.06, 0.11), "limestone_warm")


def _church_nave_bay(builder: MeshBuilder, windowed: bool) -> None:
    width = 4.0
    depth = 0.42
    wall_height = 3.35
    builder.irregular_stone_run(width, 0.64, depth + 0.06, "fieldstone", 0.26)
    if not windowed:
        builder.box((width, depth, wall_height - 0.64), (0.0, 0.0, 0.64 + (wall_height - 0.64) * 0.5), "limewash")
    else:
        opening_width = 0.92
        sill = 0.78
        head = 2.68
        side = (width - opening_width) * 0.5
        builder.box((side, depth, wall_height - 0.64), (-width * 0.5 + side * 0.5, 0.0, 0.64 + (wall_height - 0.64) * 0.5), "limewash")
        builder.box((side, depth, wall_height - 0.64), (width * 0.5 - side * 0.5, 0.0, 0.64 + (wall_height - 0.64) * 0.5), "limewash")
        builder.box((opening_width, depth, sill - 0.64), (0.0, 0.0, 0.64 + (sill - 0.64) * 0.5), "limewash")
        builder.box((opening_width, depth, wall_height - head), (0.0, 0.0, head + (wall_height - head) * 0.5), "limewash")
    for side in (-1.0, 1.0):
        x = side * (width * 0.5 - 0.16)
        for course in range(8):
            builder.box((0.34, depth + 0.10, 0.35), (x, -0.02, 0.18 + course * 0.42), "limestone_warm", (0.0, 0.0, side * (0.015 if course % 2 else -0.015)))
    builder.box((width + 0.16, depth + 0.06, 0.18), (0.0, 0.0, wall_height + 0.09), "limestone_warm")


def _church_facade_gable(builder: MeshBuilder) -> None:
    width = 4.0
    depth = 0.44
    wall_top = 3.45
    door_width = 1.72
    side = (width - door_width) * 0.5
    builder.irregular_stone_run(width, 0.68, depth + 0.08, "fieldstone", 0.27)
    builder.box((side, depth, wall_top - 0.68), (-width * 0.5 + side * 0.5, 0.0, 0.68 + (wall_top - 0.68) * 0.5), "limewash")
    builder.box((side, depth, wall_top - 0.68), (width * 0.5 - side * 0.5, 0.0, 0.68 + (wall_top - 0.68) * 0.5), "limewash")
    builder.box((door_width, depth, 0.72), (0.0, 0.0, wall_top - 0.36), "limewash")
    builder.gable_prism(width, depth, 2.45, wall_top, "limewash")
    for side_sign in (-1.0, 1.0):
        builder.beam_between((side_sign * width * 0.5, -depth * 0.56, wall_top), (0.0, -depth * 0.56, wall_top + 2.45), 0.16, "limestone_warm")
    builder.box((width + 0.18, depth + 0.12, 0.18), (0.0, 0.0, wall_top + 0.09), "limestone_warm")


def _buttress(builder: MeshBuilder, height: float) -> None:
    courses = max(5, int(round(height / 0.46)))
    for course in range(courses):
        t = course / max(1, courses - 1)
        width = 0.76 - t * 0.24
        depth = 0.92 - t * 0.36
        course_height = height / courses
        builder.box((width, depth, course_height - 0.018), (0.0, -depth * 0.5, course_height * (course + 0.5)), "limestone_warm", (0.0, 0.0, 0.012 if course % 2 else -0.012))
    builder.box((0.62, 0.72, 0.16), (0.0, -0.34, height + 0.08), "limestone_warm", (0.08, 0.0, 0.0))


def _belfry_transition(builder: MeshBuilder) -> None:
    builder.box((2.64, 2.22, 0.30), (0.0, 0.0, 0.15), "limestone_warm")
    builder.box((2.28, 1.88, 0.28), (0.0, 0.0, 0.44), "fieldstone")
    for x in (-0.88, 0.88):
        for y in (-0.68, 0.68):
            builder.box((0.36, 0.36, 0.34), (x, y, 0.75), "limestone_warm")
    builder.box((2.02, 1.62, 0.18), (0.0, 0.0, 0.94), "oak_dark")


def _sacristy_junction(builder: MeshBuilder) -> None:
    builder.box((2.02, 0.48, 2.82), (0.0, 0.0, 1.41), "limewash")
    builder.irregular_stone_run(2.02, 0.62, 0.54, "fieldstone", 0.26)
    for side in (-1.0, 1.0):
        builder.box((0.34, 0.58, 2.96), (side * 0.84, -0.02, 1.48), "limestone_warm", (0.0, 0.0, side * 0.06))
    builder.box((2.34, 0.62, 0.18), (0.0, 0.0, 2.91), "limestone_warm")


def _church_cornice(builder: MeshBuilder) -> None:
    builder.box((4.16, 0.42, 0.18), (0.0, 0.0, 0.09), "limestone_warm")
    builder.box((4.02, 0.30, 0.15), (0.0, -0.02, 0.25), "fieldstone")
    builder.box((4.28, 0.50, 0.13), (0.0, -0.01, 0.39), "limestone_warm")
    for index in range(12):
        x = -1.82 + index * (3.64 / 11)
        builder.box((0.17, 0.36, 0.20), (x, -0.02, -0.09), "limestone_warm", (0.0, 0.0, 0.018 if index % 2 else -0.018))


def _church_gable_trim(builder: MeshBuilder) -> None:
    width = 4.0
    height = 2.45
    member = 0.14
    builder.beam_between((-width * 0.5, 0.0, 0.0), (0.0, 0.0, height), member, "oak_dark")
    builder.beam_between((0.0, 0.0, height), (width * 0.5, 0.0, 0.0), member, "oak_dark")
    builder.box((width, 0.14, member), (0.0, 0.0, 0.0), "oak_dark")
    for side in (-1.0, 1.0):
        for index in range(4):
            t = (index + 1) / 5
            x = side * width * 0.5 * (1.0 - t)
            z = height * t
            builder.cone(0.075, 0.018, 0.26, (x, -0.08, z - 0.11), "timber_cut", 7)
    builder.cone(0.13, 0.025, 0.42, (0.0, 0.0, height + 0.21), "timber_cut", 8)


def _church_quoin_stack(builder: MeshBuilder) -> None:
    course_height = 0.34
    for course in range(10):
        width = 0.54 if course % 2 else 0.72
        depth = 0.58 if course % 2 else 0.46
        builder.box((width, depth, course_height - 0.018), (0.0, -depth * 0.5, course_height * (course + 0.5)), "limestone_warm", (0.0, 0.0, 0.014 if course % 2 else -0.014))


def _tall_church_nave_bay(builder: MeshBuilder, windowed: bool) -> None:
    width = 4.0
    depth = 0.46
    wall_height = 5.40
    base_height = 0.70
    builder.irregular_stone_run(width, base_height, depth + 0.08, "fieldstone", 0.27)
    if windowed:
        opening = spec.OPENINGS["window_lancet"]
        opening_width = opening["width"]
        sill = 1.62
        head = sill + opening["height"]
        side_width = (width - opening_width) * 0.5
        builder.box((side_width, depth, wall_height - base_height), (-width * 0.5 + side_width * 0.5, 0.0, base_height + (wall_height - base_height) * 0.5), "limewash")
        builder.box((side_width, depth, wall_height - base_height), (width * 0.5 - side_width * 0.5, 0.0, base_height + (wall_height - base_height) * 0.5), "limewash")
        builder.box((opening_width, depth, sill - base_height), (0.0, 0.0, base_height + (sill - base_height) * 0.5), "limewash")
        builder.box((opening_width, depth, wall_height - head), (0.0, 0.0, head + (wall_height - head) * 0.5), "limewash_faded")
    else:
        builder.box((width, depth, wall_height - base_height), (0.0, 0.0, base_height + (wall_height - base_height) * 0.5), "limewash")
    builder.box((width, depth + 0.018, 0.34), (0.0, -0.012, base_height + 0.17), "limewash_damp")
    builder.box((width + 0.14, depth + 0.07, 0.16), (0.0, 0.0, wall_height + 0.08), "limestone_warm")


def _church_west_portal_bay(builder: MeshBuilder) -> None:
    width = 3.0
    depth = 0.48
    wall_height = 5.40
    door_width = 1.18
    door_height = 2.22
    side_width = (width - door_width) * 0.5
    builder.box((side_width, depth + 0.04, door_height), (-width * 0.5 + side_width * 0.5, 0.0, door_height * 0.5), "fieldstone")
    builder.box((side_width, depth + 0.04, door_height), (width * 0.5 - side_width * 0.5, 0.0, door_height * 0.5), "fieldstone")
    builder.box((width, depth + 0.04, 0.52), (0.0, 0.0, door_height + 0.26), "fieldstone")
    builder.box((width, depth, wall_height - door_height - 0.52), (0.0, 0.0, door_height + 0.52 + (wall_height - door_height - 0.52) * 0.5), "limewash")
    builder.box((width, depth + 0.018, 0.30), (0.0, -0.012, 2.72), "limewash_damp")
    builder.box((width + 0.14, depth + 0.07, 0.16), (0.0, 0.0, wall_height + 0.08), "limestone_warm")


def _church_tower_shaft_bay(builder: MeshBuilder) -> None:
    width = 4.0
    depth = 0.50
    height = 4.0
    builder.box((width, depth, height), (0.0, 0.0, height * 0.5), "limewash")
    builder.box((width, depth + 0.018, 0.34), (0.0, -0.012, 0.17), "limewash_damp")
    for z in (0.08, height - 0.08):
        builder.box((width + 0.14, depth + 0.08, 0.16), (0.0, 0.0, z), "limestone_warm")


def _church_tower_belfry_bay(builder: MeshBuilder, height: float = 3.0) -> None:
    width = 4.0
    depth = 0.50
    opening = spec.OPENINGS["window_domestic"]
    opening_width = opening["width"]
    sill = opening["sill"]
    head = sill + opening["height"]
    side_width = (width - opening_width) * 0.5
    builder.box((side_width, depth, height), (-width * 0.5 + side_width * 0.5, 0.0, height * 0.5), "limewash_faded")
    builder.box((side_width, depth, height), (width * 0.5 - side_width * 0.5, 0.0, height * 0.5), "limewash_faded")
    builder.box((opening_width, depth, sill), (0.0, 0.0, sill * 0.5), "limewash_faded")
    builder.box((opening_width, depth, height - head), (0.0, 0.0, head + (height - head) * 0.5), "limewash_faded")
    for z in (0.08, height - 0.08):
        builder.box((width + 0.14, depth + 0.08, 0.16), (0.0, 0.0, z), "limestone_warm")


def _church_cross(builder: MeshBuilder, material_kind: str, height: float = 1.34) -> None:
    material = "iron" if material_kind == "iron" else "limestone_warm"
    thickness = 0.075 if material_kind == "iron" else 0.16
    builder.box((thickness, thickness, height), (0.0, 0.0, height * 0.5), material)
    builder.box((height * 0.60, thickness, thickness), (0.0, 0.0, height * 0.66), material)
    builder.cone(thickness * 1.7, thickness * 0.65, height * 0.18, (0.0, 0.0, height * 0.09), material, 8)
    # Keep forged-iron crosses structurally legible at game scale. Vertical
    # cone finials on the arm ends read as unsupported wedges rather than
    # blacksmith work and made the shrine silhouette unnecessarily noisy.


def _shrine_canopy(builder: MeshBuilder) -> None:
    width = 1.46
    height = 2.18
    for x in (-width * 0.5, width * 0.5):
        builder.box((0.16, 0.16, height), (x, -0.18, height * 0.5), "oak_dark")
        builder.beam_between((x, -0.18, height * 0.72), (x * 0.56, -0.18, height), 0.10, "timber_cut")
    builder.box((width + 0.18, 0.18, 0.18), (0.0, -0.18, height), "oak_dark")
    builder.beam_between((-width * 0.5, -0.18, height), (0.0, -0.18, height + 0.54), 0.13, "oak_dark")
    builder.beam_between((0.0, -0.18, height + 0.54), (width * 0.5, -0.18, height), 0.13, "oak_dark")


def _shrine_niche(builder: MeshBuilder) -> None:
    width = 1.34
    depth = 0.66
    height = 2.08
    recess_width = 0.68
    for side in (-1.0, 1.0):
        builder.box(((width - recess_width) * 0.5, depth, height), (side * (recess_width * 0.5 + (width - recess_width) * 0.25), 0.0, height * 0.5), "limestone_warm")
    builder.box((recess_width, depth, 0.52), (0.0, 0.0, height - 0.26), "limestone_warm")
    builder.box((recess_width, 0.12, 1.35), (0.0, depth * 0.40, 0.82), "plaster_inside")
    local = MeshBuilder(f"{builder.piece_id}_arch")
    local.arch_ring(recess_width + 0.18, 1.32, depth + 0.08, 0.14, "fieldstone", 13)
    start = len(builder.vertices)
    builder.vertices.extend((vertex[0], vertex[1], vertex[2] + 0.38) for vertex in local.vertices)
    builder.faces.extend(tuple(start + index for index in face) for face in local.faces)
    builder.face_materials.extend(local.face_materials)
    builder.box((width + 0.20, depth + 0.12, 0.18), (0.0, 0.0, 0.09), "fieldstone")


def _shrine_rear_wall(builder: MeshBuilder) -> None:
    # Independent closure for a freestanding roadside niche. The body grows
    # toward +Y from its public face like every wall component; assemblies
    # rotate it 180 degrees when closing the shrine's rear elevation.
    builder.box((1.50, 0.16, 2.08), (0.0, 0.08, 1.04), "limewash_faded")
    builder.box((1.58, 0.20, 0.22), (0.0, 0.10, 0.11), "fieldstone")


def _shrine_plinth(builder: MeshBuilder) -> None:
    builder.box((1.78, 1.18, 0.24), (0.0, 0.0, 0.12), "fieldstone")
    builder.box((1.48, 0.98, 0.23), (0.0, 0.03, 0.355), "limestone_warm")
    builder.box((1.20, 0.82, 0.20), (0.0, 0.07, 0.57), "limestone_warm")
    for index in range(5):
        x = -0.50 + index * 0.25
        builder.box((0.22, 0.88, 0.07), (x, 0.07 + (0.015 if index % 2 else -0.010), 0.69), "limestone_warm", (0.0, 0.0, 0.018 if index % 2 else -0.012))


def _shrine_votive_ledge(builder: MeshBuilder) -> None:
    builder.box((1.02, 0.38, 0.14), (0.0, 0.0, 0.44), "limestone_warm")
    builder.box((0.82, 0.22, 0.10), (0.0, -0.03, 0.59), "oak_dark")
    for x, height in ((-0.28, 0.26), (0.0, 0.20), (0.26, 0.30)):
        builder.cylinder(0.035, height, (x, -0.04, 0.64 + height * 0.5), "wax", 8, "z")
        builder.cone(0.052, 0.008, 0.12, (x, -0.04, 0.64 + height + 0.06), "icon_gold", 8)
    builder.box((0.56, 0.28, 0.09), (0.0, 0.06, 0.10), "timber_weathered")


def _shrine_columns(builder: MeshBuilder) -> None:
    for x in (-0.56, 0.56):
        builder.box((0.24, 0.18, 0.18), (x, 0.0, 0.09), "limestone_warm")
        builder.cylinder(0.105, 1.46, (x, 0.0, 0.91), "limestone_warm", 10, "z")
        builder.cone(0.16, 0.12, 0.24, (x, 0.0, 1.76), "limestone_warm", 8)
        builder.box((0.28, 0.22, 0.14), (x, 0.0, 1.95), "limestone_warm")


def _shrine_rail(builder: MeshBuilder) -> None:
    for x in (-0.92, 0.92):
        builder.box((0.14, 0.14, 0.92), (x, 0.0, 0.46), "oak_dark")
        builder.cone(0.11, 0.025, 0.24, (x, 0.0, 1.04), "timber_cut", 7)
    for z in (0.30, 0.70):
        builder.box((2.0, 0.10, 0.10), (0.0, 0.0, z), "timber_cut")
    for x in (-0.56, -0.18, 0.18, 0.56):
        builder.box((0.07, 0.07, 0.62), (x, 0.0, 0.50), "timber_weathered")


def _processional_cross(builder: MeshBuilder) -> None:
    builder.box((0.16, 0.16, 3.0), (0.0, 0.0, 1.5), "oak_dark")
    builder.box((1.45, 0.16, 0.16), (0.0, 0.0, 2.22), "oak_dark")
    builder.box((0.72, 0.72, 0.22), (0.0, 0.0, 0.11), "limestone_warm")
    builder.box((0.48, 0.48, 0.24), (0.0, 0.0, 0.34), "fieldstone")
    for x in (-0.72, 0.72):
        builder.cone(0.12, 0.02, 0.28, (x, 0.0, 2.22), "timber_cut", 8)
    builder.cone(0.12, 0.02, 0.28, (0.0, 0.0, 3.0), "timber_cut", 8)
    builder.box((0.08, 0.055, 0.64), (0.0, -0.11, 2.25), "iron")
    builder.box((0.38, 0.055, 0.06), (0.0, -0.11, 2.40), "iron")


def _monastery_cell_bay(builder: MeshBuilder) -> None:
    _church_nave_bay(builder, False)
    builder.box((1.08, 0.04, 1.12), (0.0, -0.23, 1.78), "glass")
    for side in (-1.0, 1.0):
        builder.box((0.13, 0.20, 1.28), (side * 0.61, -0.22, 1.78), "limestone_warm")
    builder.box((1.34, 0.22, 0.15), (0.0, -0.22, 2.48), "limestone_warm")
    builder.box((1.48, 0.26, 0.15), (0.0, -0.22, 1.10), "limestone_warm")
    for x in (-0.34, 0.0, 0.34):
        builder.box((0.035, 0.06, 0.98), (x, -0.28, 1.79), "iron")


def _cloister_corner(builder: MeshBuilder) -> None:
    _arcade(builder, 2.0)
    local = MeshBuilder(f"{builder.piece_id}_return")
    _arcade(local, 2.0)
    start = len(builder.vertices)
    for vertex in local.vertices:
        builder.vertices.append((1.0 + vertex[1], vertex[0] - 1.0, vertex[2]))
    builder.faces.extend(tuple(start + index for index in face) for face in local.faces)
    builder.face_materials.extend(local.face_materials)
    builder.box((0.48, 0.48, 2.65), (1.0, 0.0, 1.325), "limestone_warm")


def _watch_platform(builder: MeshBuilder, width: float) -> None:
    depth = width * 0.75
    builder.box((width, depth, 0.22), (0.0, 0.0, 0.11), "oak_dark")
    for x in (-width * 0.5 + 0.12, width * 0.5 - 0.12):
        for y in (-depth * 0.5 + 0.12, depth * 0.5 - 0.12):
            builder.box((0.16, 0.16, 1.15), (x, y, 0.72), "oak_dark")
    for y in (-depth * 0.5, depth * 0.5):
        builder.box((width, 0.12, 0.12), (0.0, y, 1.22), "oak_dark")


def _hoarding(builder: MeshBuilder, width: float) -> None:
    height = 1.55
    count = max(3, round(width / 0.34))
    for index in range(count):
        x = -width * 0.5 + width * (index + 0.5) / count
        builder.box((width / count - 0.02, 0.18, height), (x, 0.0, height * 0.5), "timber_weathered")
    for x in (-width * 0.42, 0.0, width * 0.42):
        builder.beam_between((x, 0.10, 0.0), (x, 0.65, -0.85), 0.14, "oak_dark")
    builder.box((width + 0.28, 1.05, 0.10), (0.0, 0.14, height + 0.12), "shingles", (0.06, 0.0, 0.0))


def _ladder(builder: MeshBuilder, length: float) -> None:
    for x in (-0.32, 0.32):
        builder.box((0.12, 0.12, length), (x, 0.0, length * 0.5), "oak_dark")
    count = max(4, round(length / 0.36))
    for index in range(count):
        builder.box((0.76, 0.10, 0.10), (0.0, 0.0, length * (index + 0.5) / count), "timber_cut")


def _brazier(builder: MeshBuilder) -> None:
    builder.cone(0.62, 0.42, 0.38, (0.0, 0.0, 0.92), "iron", 12)
    for index in range(4):
        angle = math.tau * index / 4
        builder.beam_between((0.32 * math.cos(angle), 0.32 * math.sin(angle), 0.74), (0.62 * math.cos(angle), 0.62 * math.sin(angle), 0.0), 0.08, "iron")
    builder.cylinder(0.38, 0.04, (0.0, 0.0, 1.10), "charcoal", 12, "z")


def _gate_crown(builder: MeshBuilder) -> None:
    builder.box((3.35, 0.36, 0.32), (0.0, 0.0, 0.16), "oak_dark")
    for x in (-1.45, -0.95, -0.48, 0.0, 0.48, 0.95, 1.45):
        builder.cone(0.14, 0.025, 1.05, (x, 0.0, 0.72), "timber_weathered", 7)
    builder.box((3.75, 1.05, 0.10), (0.0, 0.0, 1.28), "shingles", (0.06, 0.0, 0.0))


def _notice_board(builder: MeshBuilder) -> None:
    for x in (-0.92, 0.92):
        builder.box((0.16, 0.16, 2.35), (x, 0.0, 1.175), "oak_dark")
    builder.box((2.0, 0.12, 1.25), (0.0, 0.0, 1.48), "timber_weathered")
    builder.box((2.32, 0.72, 0.10), (0.0, 0.0, 2.46), "shingles", (0.06, 0.0, 0.0))
    for x, z in ((-0.45, 1.65), (0.33, 1.35), (0.55, 1.80)):
        builder.box((0.52, 0.02, 0.36), (x, -0.071, z), "canvas")


def _market_scale(builder: MeshBuilder) -> None:
    builder.box((0.16, 0.16, 1.75), (0.0, 0.0, 0.875), "oak_dark")
    builder.box((1.75, 0.08, 0.08), (0.0, 0.0, 1.58), "iron")
    for x in (-0.72, 0.72):
        builder.cylinder(0.025, 0.58, (x, 0.0, 1.22), "rope", 6, "z")
        builder.cone(0.32, 0.24, 0.16, (x, 0.0, 0.92), "brass", 10)


def _trade_sign(builder: MeshBuilder) -> None:
    builder.box((1.45, 0.12, 0.12), (0.20, 0.0, 0.0), "iron")
    builder.beam_between((-0.52, 0.0, 0.0), (0.12, 0.0, -0.58), 0.06, "iron")
    builder.cylinder(0.025, 0.48, (0.72, 0.0, -0.32), "iron", 6, "z")
    builder.box((0.72, 0.08, 0.58), (0.72, 0.0, -0.78), "timber_weathered")


def _tavern_gallery(builder: MeshBuilder, width: float) -> None:
    depth = 1.30
    builder.box((width, depth, 0.18), (0.0, 0.0, 0.09), "timber_weathered")
    for x in (-width * 0.5 + 0.12, 0.0, width * 0.5 - 0.12):
        builder.box((0.14, 0.14, 2.35), (x, -depth * 0.45, 1.175), "oak_dark")
    for z in (0.70, 1.08):
        builder.box((width, 0.10, 0.10), (0.0, -depth * 0.45, z), "timber_cut")
    builder.box((width + 0.42, depth + 0.35, 0.10), (0.0, 0.0, 2.46), "shingles", (0.06, 0.0, 0.0))


def _loading_hood(builder: MeshBuilder) -> None:
    builder.beam_between((0.0, 0.0, 0.0), (0.0, -1.55, 0.0), 0.22, "oak_dark")
    builder.box((2.1, 1.72, 0.10), (0.0, -0.68, 0.24), "shingles", (0.14, 0.0, 0.0))
    builder.cylinder(0.16, 0.20, (0.0, -1.25, -0.22), "timber_cut", 9, "x")
    builder.cylinder(0.03, 1.0, (0.0, -1.25, -0.72), "rope", 6, "z")


def _cupola(builder: MeshBuilder) -> None:
    for x in (-0.52, 0.52):
        for y in (-0.52, 0.52):
            builder.box((0.12, 0.12, 1.15), (x, y, 0.575), "oak_dark")
    for index in range(5):
        z = 0.28 + index * 0.18
        builder.box((1.1, 0.06, 0.08), (0.0, -0.54, z), "timber_weathered", (0.10, 0.0, 0.0))
        builder.box((1.1, 0.06, 0.08), (0.0, 0.54, z), "timber_weathered", (-0.10, 0.0, 0.0))
    builder.cone(0.92, 0.08, 0.75, (0.0, 0.0, 1.52), "shingles", 10)
