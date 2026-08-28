from __future__ import annotations

import math

from .. import spec
from ..core import MeshBuilder, Registry
from .common import add


def register(registry: Registry) -> None:
    family = "siteworks"
    for width, depth in ((2.0, 2.0), (4.0, 2.0), (4.0, 4.0), (6.0, 3.0)):
        wtoken = spec.width_token(width)
        dtoken = spec.width_token(depth)
        add(
            registry, f"site_canopy_timber_{wtoken}_d{dtoken}", family,
            f"Timber work canopy {width:g} x {depth:g} m",
            ("site", "canopy", "open-worksite", "timber"),
            lambda b, w=width, d=depth: _canopy(b, w, d, "shingles"),
            seams=("z=0",),
            triangle_budget=6_400,
        )
        add(
            registry, f"site_canopy_canvas_{wtoken}_d{dtoken}", family,
            f"Canvas work canopy {width:g} x {depth:g} m",
            ("site", "canopy", "open-worksite", "canvas"),
            lambda b, w=width, d=depth: _canopy(b, w, d, "canvas"),
            seams=("z=0",),
            triangle_budget=6_400,
        )

    for length in (1.0, 2.0, 4.0, 6.0):
        token = spec.width_token(length)
        add(registry, f"site_walkway_plank_{token}", family, f"Plank walkway {length:g} m", ("site", "walkway", "plank", "mud"), lambda b, l=length: _walkway(b, l), seams=(f"x=-{length/2:g}", f"x=+{length/2:g}", "z=0"))
        add(registry, f"site_bridge_deck_{token}", family, f"Timber bridge deck {length:g} m", ("site", "bridge", "deck", "road"), lambda b, l=length: _bridge_deck(b, l), seams=(f"x=-{length/2:g}", f"x=+{length/2:g}"), triangle_budget=5_200)
        add(registry, f"site_bridge_railing_{token}", family, f"Timber bridge railing {length:g} m", ("site", "bridge", "railing", "road"), lambda b, l=length: _bridge_railing(b, l), seams=(f"x=-{length/2:g}", f"x=+{length/2:g}"), triangle_budget=4_400)
        add(registry, f"site_dock_segment_{token}", family, f"Riverside dock segment {length:g} m", ("site", "dock", "river", "fishing"), lambda b, l=length: _dock(b, l), seams=(f"x=-{length/2:g}", f"x=+{length/2:g}", "z=0"), triangle_budget=5_000)

    for style in ("shingle", "tile"):
        add(registry, f"site_well_shelter_{style}", family, f"Well shelter roof {style}", ("site", "well", "shelter", style), lambda b, s=style: _well_shelter(b, s), triangle_budget=5_000)
    for radius in (0.75, 1.0, 1.25):
        token = spec.width_token(radius)
        add(registry, f"site_well_curb_r{token}", family, f"Stone well curb radius {radius:g} m", ("site", "well", "curb", "water"), lambda b, r=radius: _well_curb(b, r), allow_nonmanifold=True, triangle_budget=5_400)

    for style in ("shingle", "canvas", "tile"):
        add(registry, f"site_market_stall_{style}", family, f"Market stall {style}", ("site", "market", "stall", style), lambda b, s=style: _market_stall(b, s), triangle_budget=5_200)

    for size in ("small", "large"):
        add(registry, f"site_tent_a_frame_{size}", family, f"A-frame work tent {size}", ("site", "camp", "tent", "canvas"), lambda b, s=size: _tent(b, s), triangle_budget=5_200)
    add(registry, "site_campfire_hearth", family, "Stone campfire hearth", ("site", "camp", "fire", "hearth"), _campfire)
    add(registry, "site_grave_marker_cross", family, "Timber grave cross", ("site", "graveyard", "marker", "sacred"), _grave_cross)
    add(registry, "site_grave_marker_slab", family, "Limestone grave slab", ("site", "graveyard", "marker", "sacred"), _grave_slab)
    add(registry, "site_road_culvert_stone_2m", family, "Stone road culvert 2 m", ("site", "road", "culvert", "drainage"), _culvert, allow_nonmanifold=True, triangle_budget=6_200)


def _canopy(builder: MeshBuilder, width: float, depth: float, material: str) -> None:
    height = 2.45
    for x in (-width * 0.5 + 0.12, width * 0.5 - 0.12):
        for y in (-depth * 0.5 + 0.12, depth * 0.5 - 0.12):
            builder.box((0.18, 0.18, height), (x, y, height * 0.5), "oak_dark")
    builder.beam_between((-width * 0.5, -depth * 0.5, height), (width * 0.5, -depth * 0.5, height), 0.18, "oak_dark")
    builder.beam_between((-width * 0.5, depth * 0.5, height), (width * 0.5, depth * 0.5, height), 0.18, "oak_dark")
    builder.box((width + 0.32, depth + 0.34, 0.10), (0.0, 0.0, height + 0.15), material, (0.04, 0.0, 0.0))


def _walkway(builder: MeshBuilder, length: float) -> None:
    count = max(2, round(length / 0.42))
    for index in range(count):
        x = -length * 0.5 + length * (index + 0.5) / count
        builder.box((length / count - 0.025, 1.10, 0.10), (x, 0.0, 0.05), "timber_weathered", (0.0, builder.random.uniform(-0.018, 0.018), builder.random.uniform(-0.012, 0.012)))
    for y in (-0.42, 0.42):
        builder.box((length, 0.10, 0.10), (0.0, y, -0.02), "oak_dark")


def _bridge_deck(builder: MeshBuilder, length: float) -> None:
    _walkway(builder, length)
    for x in (-length * 0.5 + 0.14, length * 0.5 - 0.14):
        for y in (-0.47, 0.47):
            builder.box((0.18, 0.18, 1.35), (x, y, -0.52), "oak_dark")


def _bridge_railing(builder: MeshBuilder, length: float) -> None:
    for x in (-length * 0.5, 0.0, length * 0.5):
        builder.box((0.12, 0.12, 1.05), (x, 0.0, 0.525), "oak_dark")
    builder.box((length, 0.12, 0.12), (0.0, 0.0, 1.0), "oak_dark")
    builder.beam_between((-length * 0.5, 0.0, 0.22), (length * 0.5, 0.0, 0.82), 0.08, "timber_weathered")


def _dock(builder: MeshBuilder, length: float) -> None:
    width = 1.65
    count = max(3, round(length / 0.34))
    for index in range(count):
        x = -length * 0.5 + length * (index + 0.5) / count
        builder.box((length / count - 0.02, width, 0.12), (x, 0.0, 0.30), "timber_weathered")
    for x in (-length * 0.42, length * 0.42):
        for y in (-width * 0.42, width * 0.42):
            builder.cone(0.12, 0.08, 1.65, (x, y, -0.28), "oak_dark", 7)


def _well_curb(builder: MeshBuilder, radius: float) -> None:
    segments = max(12, round(radius * 16))
    for index in range(segments):
        angle = math.tau * index / segments
        x = radius * math.cos(angle)
        y = radius * math.sin(angle)
        builder.box((0.38, 0.32, 0.34), (x, y, 0.17), "limestone_warm", (0.0, 0.0, angle + math.pi * 0.5))
    builder.cylinder(radius * 0.72, 0.035, (0.0, 0.0, 0.22), "water", segments, "z")


def _well_shelter(builder: MeshBuilder, style: str) -> None:
    height = 2.45
    for x in (-0.85, 0.85):
        builder.box((0.18, 0.18, height), (x, 0.0, height * 0.5), "oak_dark")
    builder.cylinder(0.12, 1.72, (0.0, 0.0, 1.55), "timber_cut", 8, "x")
    builder.cylinder(0.18, 0.24, (0.0, -0.02, 1.55), "oak_dark", 8, "x")
    builder.box((2.30, 1.75, 0.10), (0.0, 0.0, height + 0.25), "shingles" if style == "shingle" else "terracotta", (0.06, 0.0, 0.0))


def _market_stall(builder: MeshBuilder, style: str) -> None:
    _canopy(builder, 2.6, 1.8, "canvas" if style == "canvas" else ("shingles" if style == "shingle" else "terracotta"))
    builder.box((2.25, 0.82, 0.10), (0.0, 0.12, 0.92), "timber_cut")
    for x in (-0.95, 0.95):
        builder.box((0.12, 0.12, 0.90), (x, 0.12, 0.45), "oak_dark")


def _tent(builder: MeshBuilder, size: str) -> None:
    width, depth, height = (2.4, 3.2, 2.2) if size == "large" else (1.8, 2.3, 1.75)
    builder.beam_between((-width * 0.5, 0.0, 0.0), (0.0, 0.0, height), 0.08, "timber_cut")
    builder.beam_between((0.0, 0.0, height), (width * 0.5, 0.0, 0.0), 0.08, "timber_cut")
    builder.beam_between((0.0, -depth * 0.5, height), (0.0, depth * 0.5, height), 0.08, "timber_cut")
    slope = math.hypot(width * 0.5, height)
    angle = math.atan2(height, width * 0.5)
    builder.box((slope, depth, 0.045), (-width * 0.25, 0.0, height * 0.5), "canvas", (0.0, angle, 0.0))
    builder.box((slope, depth, 0.045), (width * 0.25, 0.0, height * 0.5), "canvas", (0.0, -angle, 0.0))


def _campfire(builder: MeshBuilder) -> None:
    for index in range(10):
        angle = math.tau * index / 10
        builder.box((0.36, 0.26, 0.20), (0.62 * math.cos(angle), 0.62 * math.sin(angle), 0.10), "fieldstone", (0.0, 0.0, angle))
    builder.cylinder(0.42, 0.08, (0.0, 0.0, 0.04), "charcoal", 12, "z")


def _grave_cross(builder: MeshBuilder) -> None:
    builder.box((0.12, 0.12, 1.45), (0.0, 0.0, 0.725), "oak_dark")
    builder.box((0.76, 0.12, 0.12), (0.0, 0.0, 1.04), "oak_dark")


def _grave_slab(builder: MeshBuilder) -> None:
    builder.box((0.72, 1.45, 0.16), (0.0, 0.0, 0.08), "limestone_warm", (0.0, 0.0, 0.025))
    builder.box((0.26, 0.10, 0.035), (0.0, -0.28, 0.18), "fieldstone")


def _culvert(builder: MeshBuilder) -> None:
    for side in (-0.72, 0.72):
        builder.box((0.60, 2.0, 0.90), (side, 0.0, 0.45), "fieldstone")
    builder.arch_ring(1.25, 1.0, 2.0, 0.22, "limestone_warm", 11)
