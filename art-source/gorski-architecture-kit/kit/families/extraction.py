from __future__ import annotations

import math

from .. import spec
from ..core import MeshBuilder, Registry
from .common import add


def register(registry: Registry) -> None:
    family = "extraction"
    for shape in ("round", "square"):
        for size in ("small", "large"):
            add(registry, f"extract_shaft_collar_{shape}_{size}", family, f"{size.title()} {shape} shaft collar", ("extraction", "mine", "shaft", "collar", shape, size), lambda b, sh=shape, s=size: _shaft_collar(b, sh, s), allow_nonmanifold=True, triangle_budget=6_200)
    for size in ("small", "large"):
        add(registry, f"extract_headframe_{size}", family, f"Mine headframe {size}", ("extraction", "mine", "headframe", "hoist", size), lambda b, s=size: _headframe(b, s), triangle_budget=7_200)
        add(registry, f"extract_quarry_derrick_{size}", family, f"Quarry lifting derrick {size}", ("extraction", "quarry", "derrick", "hoist", size), lambda b, s=size: _derrick(b, s), triangle_budget=6_800)

    for width in (1.8, 2.4, 3.0):
        token = spec.width_token(width)
        add(registry, f"extract_mine_portal_frame_{token}", family, f"Mine portal timber frame {width:g} m", ("extraction", "mine", "portal", "support"), lambda b, w=width: _mine_portal(b, w), opening_contract="gate_cart", triangle_budget=5_200)
    for length in (1.0, 2.0, 4.0):
        token = spec.width_token(length)
        add(registry, f"extract_tunnel_support_{token}", family, f"Tunnel crib support {length:g} m", ("extraction", "mine", "tunnel", "support"), lambda b, l=length: _tunnel_support(b, l), triangle_budget=5_600)
        add(registry, f"extract_quarry_bench_{token}", family, f"Quarry cut bench {length:g} m", ("extraction", "quarry", "cut", "bench"), lambda b, l=length: _quarry_bench(b, l), triangle_budget=6_200)

    for resource in ("stone", "iron", "salt", "clay"):
        for size in ("small", "large"):
            add(registry, f"extract_stockpile_{resource}_{size}", family, f"{resource.title()} stockpile {size}", ("extraction", "stockpile", resource, size, "state-prop"), lambda b, r=resource, s=size: _stockpile(b, r, s), triangle_budget=5_600)

    add(registry, "extract_sorting_bench", family, "Ore sorting bench", ("extraction", "sorting", "bench", "mine", "quarry"), _sorting_bench)
    add(registry, "extract_sieve_table", family, "Clay and ore sieve table", ("extraction", "sorting", "sieve", "clay", "mine"), _sieve)
    add(registry, "extract_handcart", family, "Extraction handcart", ("extraction", "cart", "ore", "quarry"), _handcart, triangle_budget=5_600)
    add(registry, "extract_ore_bucket", family, "Hoist ore bucket", ("extraction", "bucket", "hoist", "mine"), _bucket)
    add(registry, "extract_windlass", family, "Hand windlass", ("extraction", "windlass", "hoist", "mine", "quarry"), _windlass)
    add(registry, "extract_survey_stakes", family, "Survey stake cluster", ("extraction", "survey", "stakes", "mine", "quarry"), _stakes)
    add(registry, "extract_clay_washing_screen", family, "Clay washing screen", ("extraction", "clay", "screen", "water"), _clay_screen)
    add(registry, "extract_quarry_wedge_rack", family, "Stonecutters wedge rack", ("extraction", "quarry", "tools", "rack"), _wedge_rack)


def _shaft_collar(builder: MeshBuilder, shape: str, size: str) -> None:
    radius = 1.15 if size == "large" else 0.82
    if shape == "round":
        for index in range(14):
            angle = math.tau * index / 14
            builder.box((0.42, 0.34, 0.34), (radius * math.cos(angle), radius * math.sin(angle), 0.17), "fieldstone", (0.0, 0.0, angle))
    else:
        side = radius * 1.55
        builder.box((side, 0.38, 0.36), (0.0, -side * 0.5, 0.18), "fieldstone")
        builder.box((side, 0.38, 0.36), (0.0, side * 0.5, 0.18), "fieldstone")
        builder.box((0.38, side - 0.38, 0.36), (-side * 0.5, 0.0, 0.18), "fieldstone")
        builder.box((0.38, side - 0.38, 0.36), (side * 0.5, 0.0, 0.18), "fieldstone")
    builder.cylinder(radius * 0.68, 0.04, (0.0, 0.0, 0.05), "charcoal", 14, "z")


def _headframe(builder: MeshBuilder, size: str) -> None:
    width, height, spread = (4.2, 5.8, 2.8) if size == "large" else (3.1, 4.3, 2.1)
    section = 0.28 if size == "large" else 0.22
    for x in (-width * 0.5, width * 0.5):
        builder.beam_between((x * 0.82, -spread * 0.5, 0.0), (x * 0.35, 0.0, height), section, "oak_dark")
        builder.beam_between((x * 0.82, spread * 0.5, 0.0), (x * 0.35, 0.0, height), section, "oak_dark")
    builder.box((width * 0.72, section, section), (0.0, 0.0, height - 0.18), "oak_dark")
    builder.cylinder(0.34, width * 0.52, (0.0, 0.0, height - 0.52), "timber_cut", 10, "x")
    builder.cylinder(0.12, width * 0.60, (0.0, 0.0, height - 0.52), "iron", 8, "x")
    builder.cylinder(0.035, height * 0.74, (0.0, 0.0, height * 0.38), "rope", 6, "z")


def _derrick(builder: MeshBuilder, size: str) -> None:
    height = 4.5 if size == "large" else 3.4
    spread = 2.4 if size == "large" else 1.8
    section = 0.24 if size == "large" else 0.19
    for x in (-spread * 0.5, spread * 0.5):
        builder.beam_between((x, -spread * 0.45, 0.0), (0.0, 0.0, height), section, "oak_dark")
        builder.beam_between((x, spread * 0.45, 0.0), (0.0, 0.0, height), section, "oak_dark")
    builder.box((spread * 1.45, section, section), (0.0, 0.0, height - 0.12), "oak_dark")
    builder.cylinder(0.20, spread * 0.75, (0.0, 0.0, height - 0.42), "timber_cut", 8, "x")


def _mine_portal(builder: MeshBuilder, width: float) -> None:
    height = width * 0.90
    section = 0.26
    for x in (-width * 0.5, width * 0.5):
        builder.box((section, section, height), (x, 0.0, height * 0.5), "oak_dark")
    builder.box((width + section, section, section), (0.0, 0.0, height), "oak_dark")
    builder.beam_between((-width * 0.5, 0.0, height), (0.0, 0.0, height + width * 0.32), section, "oak_dark")
    builder.beam_between((0.0, 0.0, height + width * 0.32), (width * 0.5, 0.0, height), section, "oak_dark")


def _tunnel_support(builder: MeshBuilder, length: float) -> None:
    count = max(2, round(length / 0.85) + 1)
    for index in range(count):
        y = -length * 0.5 + length * index / (count - 1)
        builder.box((0.22, 0.22, 2.35), (-0.95, y, 1.175), "oak_dark")
        builder.box((0.22, 0.22, 2.35), (0.95, y, 1.175), "oak_dark")
        builder.box((2.15, 0.22, 0.22), (0.0, y, 2.28), "oak_dark")


def _quarry_bench(builder: MeshBuilder, length: float) -> None:
    builder.box((length, 2.0, 0.65), (0.0, 0.0, 0.325), "quarry_stone")
    builder.box((length * 0.82, 1.45, 0.62), (0.0, 0.12, 0.96), "quarry_stone")
    builder.box((length * 0.64, 0.90, 0.56), (0.0, 0.20, 1.55), "quarry_stone")


def _stockpile(builder: MeshBuilder, resource: str, size: str) -> None:
    material = {"stone": "quarry_stone", "iron": "charcoal", "salt": "limestone_warm", "clay": "clay"}[resource]
    count = 12 if size == "large" else 6
    spread = 1.35 if size == "large" else 0.82
    for index in range(count):
        angle = math.tau * index / count + builder.random.uniform(-0.15, 0.15)
        radius = spread * (0.28 + 0.62 * builder.random.random())
        r = builder.random.uniform(0.16, 0.34) * (1.25 if size == "large" else 1.0)
        builder.cone(r, r * 0.65, r * 1.35, (radius * math.cos(angle), radius * math.sin(angle), r * 0.68), material, 7)


def _sorting_bench(builder: MeshBuilder) -> None:
    builder.box((2.2, 0.9, 0.12), (0.0, 0.0, 0.88), "timber_cut")
    for x in (-0.86, 0.86):
        builder.box((0.14, 0.14, 0.88), (x, 0.0, 0.44), "oak_dark")
    for index, material in enumerate(("quarry_stone", "charcoal", "limestone_warm")):
        builder.cone(0.14, 0.10, 0.22, (-0.58 + index * 0.58, 0.0, 1.05), material, 7)


def _sieve(builder: MeshBuilder) -> None:
    _sorting_bench(builder)
    builder.box((1.35, 0.07, 0.07), (0.0, -0.18, 1.17), "oak_dark")
    for x in (-0.55, -0.28, 0.0, 0.28, 0.55):
        builder.box((0.025, 0.75, 0.025), (x, 0.0, 1.17), "iron")


def _handcart(builder: MeshBuilder) -> None:
    builder.box((1.35, 0.92, 0.16), (0.0, 0.0, 0.68), "timber_weathered")
    for x in (-0.62, 0.62):
        builder.box((0.12, 0.92, 0.55), (x, 0.0, 0.88), "timber_weathered")
    for y in (-0.56, 0.56):
        builder.cylinder(0.42, 0.11, (0.0, y, 0.42), "oak_dark", 10, "y")
        builder.cylinder(0.30, 0.13, (0.0, y, 0.42), "earth", 8, "y")
    builder.beam_between((0.60, -0.30, 0.60), (2.0, -0.30, 0.40), 0.10, "timber_cut")
    builder.beam_between((0.60, 0.30, 0.60), (2.0, 0.30, 0.40), 0.10, "timber_cut")


def _bucket(builder: MeshBuilder) -> None:
    builder.cone(0.38, 0.31, 0.70, (0.0, 0.0, 0.35), "timber_weathered", 10)
    for z in (0.12, 0.58):
        builder.cylinder(0.39, 0.035, (0.0, 0.0, z), "iron", 10, "z")
    builder.beam_between((-0.32, 0.0, 0.58), (0.0, 0.0, 1.02), 0.045, "iron")
    builder.beam_between((0.0, 0.0, 1.02), (0.32, 0.0, 0.58), 0.045, "iron")


def _windlass(builder: MeshBuilder) -> None:
    for x in (-0.82, 0.82):
        builder.box((0.18, 0.18, 1.65), (x, 0.0, 0.825), "oak_dark")
    builder.cylinder(0.22, 1.95, (0.0, 0.0, 1.20), "timber_cut", 10, "x")
    builder.cylinder(0.08, 2.25, (0.0, 0.0, 1.20), "iron", 8, "x")
    builder.beam_between((1.0, 0.0, 1.20), (1.35, 0.0, 1.68), 0.08, "iron")


def _stakes(builder: MeshBuilder) -> None:
    for index, (x, y) in enumerate(((-0.5, -0.3), (0.2, -0.4), (0.45, 0.25), (-0.28, 0.36))):
        builder.cone(0.045, 0.012, 1.0 + 0.1 * index, (x, y, 0.5), "timber_cut", 6)
    builder.box((0.86, 0.05, 0.06), (0.0, -0.02, 0.64), "canvas_red", (0.0, 0.0, 0.18))


def _clay_screen(builder: MeshBuilder) -> None:
    builder.box((2.0, 1.2, 0.12), (0.0, 0.0, 0.72), "timber_cut", (0.22, 0.0, 0.0))
    for x in (-0.82, 0.82):
        builder.box((0.12, 0.12, 1.25), (x, 0.0, 0.625), "oak_dark")
    builder.box((1.6, 0.85, 0.04), (0.0, 0.0, 0.77), "iron", (0.22, 0.0, 0.0))


def _wedge_rack(builder: MeshBuilder) -> None:
    builder.box((1.8, 0.44, 0.10), (0.0, 0.0, 0.56), "timber_cut")
    for x in (-0.72, -0.36, 0.0, 0.36, 0.72):
        builder.cone(0.065, 0.02, 0.44, (x, -0.12, 0.80), "iron", 6)
