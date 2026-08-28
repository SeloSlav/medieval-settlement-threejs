from __future__ import annotations

import math

from .. import spec
from ..core import MeshBuilder, Registry
from .common import add


def register(registry: Registry) -> None:
    family = "production"
    for diameter in (2.4, 3.6, 5.0):
        token = spec.width_token(diameter)
        add(registry, f"production_waterwheel_d{token}", family, f"Undershot waterwheel {diameter:g} m", ("production", "watermill", "wheel", "powered"), lambda b, d=diameter: _waterwheel(b, d), triangle_budget=7_600)
    for span in (4.0, 6.0, 8.0):
        token = spec.width_token(span)
        add(registry, f"production_windmill_sails_{token}", family, f"Cloth windmill sails {span:g} m", ("production", "windmill", "sails", "powered"), lambda b, s=span: _wind_sails(b, s), triangle_budget=7_200)
    for length in (1.0, 2.0, 4.0):
        token = spec.width_token(length)
        add(registry, f"production_drive_axle_{token}", family, f"Oak drive axle {length:g} m", ("production", "mill", "axle", "powered"), lambda b, l=length: _axle(b, l))
    for diameter in (0.8, 1.4, 2.2):
        token = spec.width_token(diameter)
        add(registry, f"production_gearwheel_d{token}", family, f"Timber gearwheel {diameter:g} m", ("production", "mill", "gear", "powered"), lambda b, d=diameter: _gearwheel(b, d), triangle_budget=6_600)

    for height in (2.4, 4.0, 6.0):
        token = spec.width_token(height)
        add(registry, f"production_chimney_limestone_h{token}", family, f"Limestone workshop chimney {height:g} m", ("production", "chimney", "forge", "kiln"), lambda b, h=height: _chimney(b, h, "limestone_warm"), triangle_budget=5_800)
        add(registry, f"production_chimney_brick_h{token}", family, f"Terracotta workshop chimney {height:g} m", ("production", "chimney", "forge", "kiln"), lambda b, h=height: _chimney(b, h, "terracotta"), triangle_budget=5_800)

    add(registry, "production_smithy_forge", family, "Open smithy hearth and hood", ("production", "smithy", "forge", "hearth"), _forge, triangle_budget=6_200)
    add(registry, "production_smithy_anvil_block", family, "Smithy anvil block", ("production", "smithy", "anvil", "workstation"), _anvil)
    add(registry, "production_potter_kiln_round", family, "Round updraft pottery kiln", ("production", "potter", "kiln", "fired"), lambda b: _kiln(b, "potter"), allow_nonmanifold=True, triangle_budget=7_200)
    add(registry, "production_bakery_oven", family, "Masonry bread oven", ("production", "bakery", "oven", "fired"), lambda b: _kiln(b, "bread"), allow_nonmanifold=True, triangle_budget=7_200)
    add(registry, "production_charcoal_clamp_small", family, "Charcoal clamp small", ("production", "charcoal", "clamp", "state-prop"), lambda b: _charcoal_clamp(b, 1.8), triangle_budget=5_200)
    add(registry, "production_charcoal_clamp_large", family, "Charcoal clamp large", ("production", "charcoal", "clamp", "state-prop"), lambda b: _charcoal_clamp(b, 3.2), triangle_budget=6_400)

    for size in ("small", "large"):
        add(registry, f"production_brew_vat_{size}", family, f"Coopered brewing vat {size}", ("production", "brewery", "vat", size), lambda b, s=size: _vat(b, s, False), triangle_budget=4_400)
        add(registry, f"production_dye_vat_{size}", family, f"Dyeing vat {size}", ("production", "weaver", "dye", "vat", size), lambda b, s=size: _vat(b, s, True), triangle_budget=4_600)
    add(registry, "production_brew_kettle", family, "Copper brewing kettle", ("production", "brewery", "kettle", "fired"), _brew_kettle, triangle_budget=4_800)
    add(registry, "production_malt_rack_2m", family, "Malt drying rack 2 m", ("production", "brewery", "malt", "rack"), lambda b: _rack(b, 2.0, "straw_dry"))
    add(registry, "production_smoke_rack_2m", family, "Smokehouse hanging rack 2 m", ("production", "smokehouse", "rack", "food"), lambda b: _rack(b, 2.0, "leather"))

    add(registry, "production_carpenter_bench", family, "Carpenter shaving bench", ("production", "carpenter", "bench", "workstation"), _carpenter_bench)
    add(registry, "production_sawpit_frame", family, "Timber sawpit frame", ("production", "carpenter", "sawpit", "lumber"), _sawpit, triangle_budget=5_200)
    add(registry, "production_tanning_frame_2m", family, "Hide tanning frame 2 m", ("production", "tannery", "hide", "rack"), lambda b: _tanning_frame(b, 2.0))
    add(registry, "production_tanning_frame_4m", family, "Hide tanning frame 4 m", ("production", "tannery", "hide", "rack"), lambda b: _tanning_frame(b, 4.0), triangle_budget=5_000)
    add(registry, "production_retting_trough", family, "Flax retting trough", ("production", "spinning", "retting", "flax", "water"), _retting_trough)
    add(registry, "production_warp_weighted_loom", family, "Warp-weighted loom", ("production", "weaver", "loom", "workstation"), _loom, triangle_budget=5_200)
    add(registry, "production_spinning_wheel", family, "Timber spinning wheel", ("production", "spinning", "wheel", "workstation"), _spinning_wheel, triangle_budget=5_400)
    add(registry, "production_cobbler_bench", family, "Cobbler workbench", ("production", "cobbler", "bench", "workstation"), _cobbler_bench)
    add(registry, "production_chandlery_dipping_rack", family, "Candle dipping rack", ("production", "chandlery", "candle", "rack"), _dipping_rack, triangle_budget=4_800)
    add(registry, "production_screw_press", family, "Timber screw press", ("production", "press", "brewery", "tannery", "food"), _screw_press, triangle_budget=6_200)


def _waterwheel(builder: MeshBuilder, diameter: float) -> None:
    radius = diameter * 0.5
    width = max(0.42, diameter * 0.18)
    for y in (-width * 0.5, width * 0.5):
        for index in range(20):
            angle0 = math.tau * index / 20
            angle1 = math.tau * (index + 1) / 20
            builder.beam_between((radius * math.cos(angle0), y, radius + radius * math.sin(angle0)), (radius * math.cos(angle1), y, radius + radius * math.sin(angle1)), diameter * 0.055, "oak_dark")
        for index in range(8):
            angle = math.tau * index / 8
            builder.beam_between((0.0, y, radius), (radius * 0.90 * math.cos(angle), y, radius + radius * 0.90 * math.sin(angle)), diameter * 0.045, "timber_cut")
    for index in range(16):
        angle = math.tau * index / 16
        builder.box((diameter * 0.22, width + 0.18, diameter * 0.055), (radius * 0.88 * math.cos(angle), 0.0, radius + radius * 0.88 * math.sin(angle)), "timber_weathered", (0.0, angle, 0.0))
    builder.cylinder(diameter * 0.12, width + 0.35, (0.0, 0.0, radius), "oak_dark", 10, "y")


def _wind_sails(builder: MeshBuilder, span: float) -> None:
    for arm in range(4):
        angle = math.pi * 0.25 + math.pi * 0.5 * arm
        end = (math.cos(angle) * span * 0.5, 0.0, span * 0.5 + math.sin(angle) * span * 0.5)
        builder.beam_between((0.0, 0.0, span * 0.5), end, span * 0.035, "oak_dark")
        for rung in range(1, 5):
            t = rung / 5
            cx = math.cos(angle) * span * 0.5 * t
            cz = span * 0.5 + math.sin(angle) * span * 0.5 * t
            cross = span * (0.035 + 0.018 * t)
            builder.beam_between((cx - math.sin(angle) * cross, 0.0, cz + math.cos(angle) * cross), (cx + math.sin(angle) * cross, 0.0, cz - math.cos(angle) * cross), span * 0.018, "timber_cut")
        builder.box((span * 0.20, 0.035, span * 0.34), (math.cos(angle) * span * 0.31 - math.sin(angle) * span * 0.08, -0.03, span * 0.5 + math.sin(angle) * span * 0.31 + math.cos(angle) * span * 0.08), "canvas", (0.0, angle - math.pi * 0.5, 0.0))
    builder.cylinder(span * 0.08, 0.65, (0.0, 0.0, span * 0.5), "oak_dark", 10, "y")


def _axle(builder: MeshBuilder, length: float) -> None:
    builder.cylinder(0.16, length, (0.0, 0.0, 0.0), "oak_dark", 10, "x")
    for x in (-length * 0.42, length * 0.42):
        builder.cylinder(0.20, 0.08, (x, 0.0, 0.0), "iron", 10, "x")


def _gearwheel(builder: MeshBuilder, diameter: float) -> None:
    radius = diameter * 0.5
    for index in range(16):
        angle = math.tau * index / 16
        builder.box((diameter * 0.11, 0.24, diameter * 0.07), (radius * math.cos(angle), 0.0, radius + radius * math.sin(angle)), "timber_cut", (0.0, angle, 0.0))
    for index in range(8):
        angle = math.tau * index / 8
        builder.beam_between((0.0, 0.0, radius), (radius * 0.82 * math.cos(angle), 0.0, radius + radius * 0.82 * math.sin(angle)), diameter * 0.05, "oak_dark")
    builder.cylinder(diameter * 0.13, 0.32, (0.0, 0.0, radius), "oak_dark", 10, "y")


def _chimney(builder: MeshBuilder, height: float, material: str) -> None:
    builder.box((0.82, 0.82, height), (0.0, 0.0, height * 0.5), material)
    builder.box((0.98, 0.98, 0.20), (0.0, 0.0, height - 0.10), "limestone_warm")
    builder.box((0.48, 0.48, 0.04), (0.0, 0.0, height + 0.01), "charcoal")


def _forge(builder: MeshBuilder) -> None:
    builder.box((2.1, 1.2, 0.78), (0.0, 0.0, 0.39), "fieldstone")
    builder.box((1.45, 0.76, 0.10), (0.0, -0.05, 0.84), "charcoal")
    builder.box((1.75, 0.95, 0.16), (0.0, 0.0, 1.82), "iron")
    builder.box((0.55, 0.55, 1.12), (0.0, 0.0, 1.30), "iron")


def _anvil(builder: MeshBuilder) -> None:
    builder.box((0.52, 0.42, 0.62), (0.0, 0.0, 0.31), "oak_dark")
    builder.box((0.86, 0.34, 0.20), (0.08, 0.0, 0.72), "iron")
    builder.cone(0.22, 0.06, 0.48, (0.60, 0.0, 0.72), "iron", 8)


def _kiln(builder: MeshBuilder, kind: str) -> None:
    radius = 1.25 if kind == "potter" else 1.05
    height = 1.55 if kind == "potter" else 1.20
    material = "terracotta" if kind == "potter" else "limestone_warm"
    for row in range(5):
        r = radius * (1.0 - row * 0.075)
        z = height * (row + 0.5) / 5
        for index in range(14):
            angle = math.tau * index / 14
            builder.box((0.34, 0.30, height / 5 - 0.018), (r * math.cos(angle), r * math.sin(angle), z), material, (0.0, 0.0, angle))
    builder.arch_ring(0.72, 0.72, 0.42, 0.13, "limestone_warm", 9)
    builder.cylinder(0.24, 0.85, (0.0, 0.0, height + 0.42), material, 10, "z")


def _charcoal_clamp(builder: MeshBuilder, diameter: float) -> None:
    radius = diameter * 0.5
    for ring in range(4):
        r = radius * (1.0 - ring * 0.20)
        z = diameter * 0.14 * ring
        for index in range(max(8, 15 - ring * 2)):
            angle = math.tau * index / max(8, 15 - ring * 2)
            builder.cone(diameter * 0.13, diameter * 0.08, diameter * 0.28, (r * math.cos(angle), r * math.sin(angle), z + diameter * 0.14), "charcoal", 7)
    builder.cylinder(diameter * 0.07, diameter * 0.84, (0.0, 0.0, diameter * 0.42), "timber_weathered", 7, "z")


def _vat(builder: MeshBuilder, size: str, dyed: bool) -> None:
    radius, height = ((0.92, 1.15) if size == "large" else (0.62, 0.82))
    for index in range(12):
        angle = math.tau * index / 12
        builder.box((radius * 0.48, 0.10, height), (radius * 0.88 * math.cos(angle), radius * 0.88 * math.sin(angle), height * 0.5), "timber_weathered", (0.0, 0.0, angle))
    for z in (0.16, height * 0.72):
        for index in range(12):
            angle = math.tau * index / 12
            builder.box((radius * 0.48, 0.04, 0.05), (radius * math.cos(angle), radius * math.sin(angle), z), "iron", (0.0, 0.0, angle))
    if dyed:
        builder.cylinder(radius * 0.78, 0.035, (0.0, 0.0, height + 0.01), "canvas_red", 12, "z")


def _brew_kettle(builder: MeshBuilder) -> None:
    builder.cone(0.72, 0.56, 0.88, (0.0, 0.0, 0.64), "brass", 14)
    builder.cylinder(0.58, 0.12, (0.0, 0.0, 1.14), "brass", 14, "z")
    builder.arch_ring(1.0, 1.0, 0.08, 0.07, "iron", 11)


def _rack(builder: MeshBuilder, width: float, hanging_material: str) -> None:
    for x in (-width * 0.5, width * 0.5):
        builder.box((0.14, 0.14, 2.0), (x, 0.0, 1.0), "oak_dark")
    builder.box((width + 0.14, 0.14, 0.14), (0.0, 0.0, 1.92), "oak_dark")
    for x in (-0.65, -0.22, 0.22, 0.65):
        if abs(x) < width * 0.5:
            builder.box((0.10, 0.10, 0.72), (x, 0.0, 1.48), hanging_material)


def _carpenter_bench(builder: MeshBuilder) -> None:
    builder.box((2.4, 0.72, 0.18), (0.0, 0.0, 0.88), "timber_cut")
    for x in (-0.9, 0.9):
        builder.box((0.18, 0.18, 0.86), (x, 0.0, 0.43), "oak_dark")
    builder.box((0.14, 0.42, 0.42), (0.62, -0.28, 1.02), "iron")


def _sawpit(builder: MeshBuilder) -> None:
    for y in (-0.78, 0.78):
        builder.box((3.2, 0.22, 0.24), (0.0, y, 0.92), "oak_dark")
    for x in (-1.35, 1.35):
        builder.box((0.22, 1.78, 0.92), (x, 0.0, 0.46), "oak_dark")
    builder.cylinder(0.32, 3.5, (0.0, 0.0, 1.18), "timber_cut", 10, "x")


def _tanning_frame(builder: MeshBuilder, width: float) -> None:
    height = 2.2
    for x in (-width * 0.5, width * 0.5):
        builder.box((0.14, 0.14, height), (x, 0.0, height * 0.5), "oak_dark")
    builder.box((width, 0.14, 0.14), (0.0, 0.0, height - 0.07), "oak_dark")
    hide_width = min(1.35, width * 0.65)
    builder.box((hide_width, 0.045, 1.45), (0.0, -0.02, 1.02), "leather")
    for x in (-hide_width * 0.5, hide_width * 0.5):
        for z in (0.38, 1.72):
            builder.cylinder(0.025, 0.18, (x, 0.0, z), "rope", 6, "y")


def _retting_trough(builder: MeshBuilder) -> None:
    builder.box((3.2, 1.35, 0.16), (0.0, 0.0, 0.08), "timber_weathered")
    for y in (-0.62, 0.62):
        builder.box((3.2, 0.16, 0.72), (0.0, y, 0.36), "timber_weathered")
    for x in (-1.52, 1.52):
        builder.box((0.16, 1.08, 0.72), (x, 0.0, 0.36), "timber_weathered")
    builder.box((2.85, 0.94, 0.035), (0.0, 0.0, 0.30), "water")


def _loom(builder: MeshBuilder) -> None:
    for x in (-0.92, 0.92):
        builder.box((0.16, 0.20, 2.25), (x, 0.0, 1.125), "oak_dark")
    for z in (0.25, 2.12):
        builder.box((2.0, 0.18, 0.16), (0.0, 0.0, z), "oak_dark")
    for index in range(13):
        x = -0.72 + index * 0.12
        builder.box((0.018, 0.03, 1.65), (x, -0.06, 1.18), "rope")
    for index in range(7):
        x = -0.72 + index * 0.24
        builder.cone(0.08, 0.05, 0.25, (x, -0.07, 0.17), "fieldstone", 7)


def _spinning_wheel(builder: MeshBuilder) -> None:
    radius = 0.62
    for index in range(14):
        angle0 = math.tau * index / 14
        angle1 = math.tau * (index + 1) / 14
        builder.beam_between((radius * math.cos(angle0), 0.0, 0.85 + radius * math.sin(angle0)), (radius * math.cos(angle1), 0.0, 0.85 + radius * math.sin(angle1)), 0.055, "timber_cut")
    for index in range(8):
        angle = math.tau * index / 8
        builder.beam_between((0.0, 0.0, 0.85), (radius * math.cos(angle), 0.0, 0.85 + radius * math.sin(angle)), 0.035, "timber_cut")
    builder.box((1.55, 0.42, 0.16), (0.0, 0.0, 0.18), "oak_dark")
    builder.box((0.12, 0.12, 1.35), (-0.62, 0.0, 0.76), "oak_dark")


def _cobbler_bench(builder: MeshBuilder) -> None:
    builder.box((1.55, 0.72, 0.16), (0.0, 0.0, 0.78), "timber_cut")
    for x in (-0.58, 0.58):
        builder.box((0.14, 0.14, 0.76), (x, 0.0, 0.38), "oak_dark")
    builder.cone(0.20, 0.14, 0.52, (0.34, 0.0, 1.10), "oak_dark", 8)
    builder.box((0.54, 0.22, 0.10), (-0.34, -0.12, 0.94), "leather")


def _dipping_rack(builder: MeshBuilder) -> None:
    for x in (-0.95, 0.95):
        builder.box((0.14, 0.14, 1.85), (x, 0.0, 0.925), "oak_dark")
    builder.box((2.0, 0.14, 0.14), (0.0, 0.0, 1.78), "oak_dark")
    for x in (-0.72, -0.36, 0.0, 0.36, 0.72):
        builder.cylinder(0.025, 1.18, (x, 0.0, 1.14), "limewash", 6, "z")
    builder.box((1.65, 0.52, 0.36), (0.0, 0.0, 0.18), "iron")


def _screw_press(builder: MeshBuilder) -> None:
    for x in (-0.88, 0.88):
        builder.box((0.24, 0.32, 2.7), (x, 0.0, 1.35), "oak_dark")
    builder.box((2.0, 0.38, 0.28), (0.0, 0.0, 2.55), "oak_dark")
    builder.cylinder(0.15, 1.55, (0.0, 0.0, 1.78), "oak_dark", 10, "z")
    builder.box((1.45, 0.92, 0.20), (0.0, 0.0, 0.58), "timber_cut")
    builder.box((1.36, 0.86, 0.24), (0.0, 0.0, 1.14), "timber_cut")
    builder.box((1.55, 0.12, 0.12), (0.0, 0.0, 2.05), "iron")
