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
    add(registry, "civic_shrine_canopy", family, "Wayside shrine canopy", ("civic", "religious", "shrine", "canopy"), _shrine_canopy, triangle_budget=5_400)
    add(registry, "civic_shrine_niche_stone", family, "Wayside shrine stone niche", ("civic", "religious", "shrine", "niche"), _shrine_niche, allow_nonmanifold=True, triangle_budget=5_800)
    add(registry, "civic_processional_cross", family, "Village processional cross", ("civic", "religious", "cross", "marker"), _processional_cross)

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
    builder.box((width + 0.24, width, 0.12), (0.0, 0.0, height + 0.15), "shingles", (0.05, 0.0, 0.0))
    builder.box((width + section, section, section), (0.0, 0.0, height * 0.72), "oak_dark")


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
    for index in range(12):
        angle = math.pi * index / 11
        builder.box((0.48, 0.42, 3.0), (radius * math.cos(angle), radius * math.sin(angle), 1.5), "limestone_warm", (0.0, 0.0, angle))
    for index in range(12):
        angle = math.pi * index / 11
        builder.box((0.55, 0.62, 0.12), (radius * 0.92 * math.cos(angle), radius * 0.92 * math.sin(angle), 3.15), "shingles", (0.0, 0.12, angle))


def _shrine_canopy(builder: MeshBuilder) -> None:
    for x in (-0.62, 0.62):
        builder.box((0.14, 0.14, 2.2), (x, 0.0, 1.1), "oak_dark")
    builder.box((1.72, 1.15, 0.10), (0.0, 0.0, 2.35), "shingles", (0.06, 0.0, 0.0))
    builder.box((1.32, 0.22, 0.18), (0.0, 0.0, 0.38), "limestone_warm")


def _shrine_niche(builder: MeshBuilder) -> None:
    builder.box((1.25, 0.62, 2.05), (0.0, 0.0, 1.025), "limestone_warm")
    builder.arch_ring(0.62, 1.22, 0.70, 0.16, "fieldstone", 11)
    builder.box((0.44, 0.20, 0.78), (0.0, -0.24, 0.82), "plaster_inside")


def _processional_cross(builder: MeshBuilder) -> None:
    builder.box((0.18, 0.18, 3.0), (0.0, 0.0, 1.5), "oak_dark")
    builder.box((1.45, 0.18, 0.18), (0.0, 0.0, 2.22), "oak_dark")
    builder.box((0.62, 0.62, 0.28), (0.0, 0.0, 0.14), "limestone_warm")


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
