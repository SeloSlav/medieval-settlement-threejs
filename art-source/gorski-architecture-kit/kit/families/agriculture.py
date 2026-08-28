from __future__ import annotations

import math

from .. import spec
from ..core import MeshBuilder, Registry
from .common import add


def register(registry: Registry) -> None:
    family = "agriculture"
    for length in (2.0, 4.0, 6.0):
        token = spec.width_token(length)
        add(registry, f"agri_hayrack_{token}", family, f"Slatted hayrack {length:g} m", ("agriculture", "hay", "rack", "pastoral"), lambda b, l=length: _hayrack(b, l), triangle_budget=6_200)
        add(registry, f"agri_vine_trellis_{token}", family, f"Vine trellis {length:g} m", ("agriculture", "vineyard", "trellis", "row"), lambda b, l=length: _trellis(b, l), triangle_budget=4_600)
        add(registry, f"agri_seedthree_crop_anchor_{token}", family, f"SeedThree crop-row anchor {length:g} m", ("agriculture", "grain-field", "seedthree-interface", "no-vegetation"), lambda b, l=length: _seedthree_crop_anchor(b, l), triangle_budget=4_200)

    for crop in ("rye", "oats", "barley", "flax", "wheat", "fallow"):
        add(registry, f"agri_field_marker_{crop}", family, f"{crop.title()} field marker", ("agriculture", "field", crop, "marker"), lambda b, c=crop: _field_marker(b, c))
    for tree in ("apple", "pear", "cherry", "aronia", "rosehip"):
        add(registry, f"agri_orchard_guard_{tree}", family, f"{tree.title()} orchard tree guard", ("agriculture", "orchard", tree, "guard"), lambda b, t=tree: _orchard_guard(b, t), triangle_budget=4_800)

    add(registry, "agri_threshed_floor_round", family, "Round timber threshing floor", ("agriculture", "threshing", "floor", "barn"), _threshing_floor, triangle_budget=5_400)
    add(registry, "agri_winnowing_screen", family, "Winnowing screen", ("agriculture", "threshing", "grain", "screen"), _winnowing_screen)
    add(registry, "agri_granary_stilt_set", family, "Vermin-resistant granary stilt set", ("agriculture", "granary", "stilts", "storage"), _granary_stilts)
    add(registry, "agri_grain_bin_small", family, "Lidded grain bin small", ("agriculture", "granary", "grain", "storage"), lambda b: _grain_bin(b, 0.72))
    add(registry, "agri_grain_bin_large", family, "Lidded grain bin large", ("agriculture", "granary", "grain", "storage"), lambda b: _grain_bin(b, 1.08))
    add(registry, "agri_barn_hay_hoist", family, "Barn hay hoist", ("agriculture", "barn", "hoist", "hay"), _hay_hoist)

    add(registry, "agri_livestock_trough_2m", family, "Livestock watering trough 2 m", ("agriculture", "pasture", "livestock", "water"), lambda b: _trough(b, 2.0, True))
    add(registry, "agri_livestock_trough_4m", family, "Livestock watering trough 4 m", ("agriculture", "pasture", "livestock", "water"), lambda b: _trough(b, 4.0, True))
    add(registry, "agri_feed_manger_2m", family, "Livestock feed manger 2 m", ("agriculture", "pasture", "livestock", "feed"), lambda b: _trough(b, 2.0, False))
    add(registry, "agri_goat_stand", family, "Raised goat stand", ("agriculture", "goat", "pasture", "pen"), _goat_stand)
    add(registry, "agri_pig_shelter", family, "Low pig shelter module", ("agriculture", "pig", "swineherd", "pen"), _pig_shelter)
    add(registry, "agri_chicken_roost", family, "Chicken roost module", ("agriculture", "chicken", "backyard", "pen"), _chicken_roost)

    for count in (3, 6, 9):
        add(registry, f"agri_apiary_stand_{count}", family, f"Log hive apiary stand {count}", ("agriculture", "apiary", "bee", "hive"), lambda b, c=count: _apiary(b, c), triangle_budget=6_200)
    add(registry, "agri_scarecrow", family, "Field scarecrow", ("agriculture", "field", "scarecrow", "state-prop"), _scarecrow)
    add(registry, "agri_compost_wattle_bin", family, "Wattle compost bin", ("agriculture", "garden", "compost", "backyard"), _compost_bin, triangle_budget=4_600)
    add(registry, "agri_garden_coldframe", family, "Boarded garden cold frame", ("agriculture", "garden", "vegetable", "backyard"), _coldframe)


def _hayrack(builder: MeshBuilder, length: float) -> None:
    height = 2.65
    count = max(3, round(length / 0.72) + 1)
    for index in range(count):
        x = -length * 0.5 + length * index / (count - 1)
        builder.box((0.14, 0.18, height), (x, 0.0, height * 0.5), "oak_dark")
    for z in (0.45, 0.90, 1.35, 1.80, 2.25):
        builder.box((length, 0.10, 0.10), (0.0, 0.0, z), "timber_cut")
    builder.box((length + 0.45, 0.95, 0.10), (0.0, 0.0, height + 0.10), "shingles", (0.08, 0.0, 0.0))


def _trellis(builder: MeshBuilder, length: float) -> None:
    count = max(2, round(length / 1.0) + 1)
    for index in range(count):
        x = -length * 0.5 + length * index / (count - 1)
        builder.cone(0.07, 0.035, 1.65, (x, 0.0, 0.825), "timber_cut", 6)
    for z in (0.45, 0.92, 1.38):
        builder.box((length, 0.025, 0.025), (0.0, 0.0, z), "rope")


def _seedthree_crop_anchor(builder: MeshBuilder, length: float) -> None:
    """Non-living boundary/attachment points; SeedThree owns all crop plants."""
    width = 1.18
    for x in (-length * 0.5, length * 0.5):
        for y in (-width * 0.5, width * 0.5):
            builder.cone(0.045, 0.022, 0.42, (x, y, 0.21), "timber_cut", 6)
    for y in (-width * 0.5, width * 0.5):
        builder.box((length, 0.022, 0.022), (0.0, y, 0.24), "rope")
    builder.box((0.10, width, 0.028), (-length * 0.5, 0.0, 0.05), "timber_weathered")


def _field_marker(builder: MeshBuilder, crop: str) -> None:
    builder.cone(0.055, 0.025, 1.35, (0.0, 0.0, 0.675), "timber_cut", 6)
    width = 0.72 + 0.04 * len(crop)
    builder.box((width, 0.045, 0.32), (0.0, -0.03, 1.05), "timber_weathered")
    color = "canvas_red" if crop in ("flax", "wheat") else "straw_dry"
    builder.box((width * 0.60, 0.052, 0.035), (0.0, -0.058, 1.05), color)


def _orchard_guard(builder: MeshBuilder, tree: str) -> None:
    for index in range(7):
        angle = math.tau * index / 7
        builder.cone(0.045, 0.025, 1.1, (0.48 * math.cos(angle), 0.48 * math.sin(angle), 0.55), "timber_cut", 6)
    for z in (0.32, 0.72):
        for index in range(7):
            angle0 = math.tau * index / 7
            angle1 = math.tau * (index + 1) / 7
            builder.beam_between((0.48 * math.cos(angle0), 0.48 * math.sin(angle0), z), (0.48 * math.cos(angle1), 0.48 * math.sin(angle1), z), 0.035, "timber_cut")
    marker = "canvas_red" if tree in ("cherry", "rosehip") else "straw_dry"
    builder.box((0.28, 0.04, 0.18), (0.0, -0.50, 0.88), marker)


def _threshing_floor(builder: MeshBuilder) -> None:
    for index in range(18):
        angle = math.tau * index / 18
        builder.box((0.72, 0.42, 0.12), (1.15 * math.cos(angle), 1.15 * math.sin(angle), 0.06), "timber_weathered", (0.0, 0.0, angle))


def _winnowing_screen(builder: MeshBuilder) -> None:
    for x in (-0.92, 0.92):
        builder.box((0.14, 0.14, 1.9), (x, 0.0, 0.95), "oak_dark")
    builder.box((2.0, 0.12, 0.12), (0.0, 0.0, 1.82), "oak_dark")
    for x in (-0.72, -0.48, -0.24, 0.0, 0.24, 0.48, 0.72):
        builder.box((0.025, 0.035, 1.3), (x, 0.0, 1.08), "rope")


def _granary_stilts(builder: MeshBuilder) -> None:
    for x in (-1.3, 1.3):
        for y in (-0.8, 0.8):
            builder.box((0.28, 0.28, 0.82), (x, y, 0.41), "fieldstone")
            builder.cylinder(0.36, 0.12, (x, y, 0.88), "limestone_warm", 10, "z")


def _grain_bin(builder: MeshBuilder, radius: float) -> None:
    height = radius * 1.55
    for index in range(12):
        angle = math.tau * index / 12
        builder.box((radius * 0.46, 0.10, height), (radius * 0.90 * math.cos(angle), radius * 0.90 * math.sin(angle), height * 0.5), "timber_weathered", (0.0, 0.0, angle))
    builder.cone(radius * 1.08, 0.05, radius * 0.55, (0.0, 0.0, height + radius * 0.28), "shingles", 12)


def _hay_hoist(builder: MeshBuilder) -> None:
    builder.beam_between((0.0, 0.0, 0.0), (0.0, -1.75, 0.0), 0.22, "oak_dark")
    builder.beam_between((0.0, 0.0, 0.0), (0.0, -1.15, -0.55), 0.16, "oak_dark")
    builder.cylinder(0.18, 0.22, (0.0, -1.38, -0.12), "timber_cut", 9, "x")
    builder.cylinder(0.03, 1.15, (0.0, -1.38, -0.70), "rope", 6, "z")


def _trough(builder: MeshBuilder, length: float, water: bool) -> None:
    builder.box((length, 0.82, 0.12), (0.0, 0.0, 0.18), "timber_weathered")
    for y in (-0.36, 0.36):
        builder.box((length, 0.12, 0.62), (0.0, y, 0.43), "timber_weathered", (0.0, 0.0, 0.0))
    for x in (-length * 0.47, length * 0.47):
        builder.box((0.12, 0.60, 0.58), (x, 0.0, 0.42), "timber_weathered")
    if water:
        builder.box((length - 0.22, 0.54, 0.025), (0.0, 0.0, 0.54), "water")


def _goat_stand(builder: MeshBuilder) -> None:
    builder.box((2.0, 1.2, 0.16), (0.0, 0.0, 0.72), "timber_weathered")
    for x in (-0.82, 0.82):
        for y in (-0.42, 0.42):
            builder.box((0.12, 0.12, 0.72), (x, y, 0.36), "oak_dark")
    builder.box((2.1, 0.14, 0.14), (0.0, -0.58, 1.08), "oak_dark")


def _pig_shelter(builder: MeshBuilder) -> None:
    for x in (-0.92, 0.92):
        builder.box((0.16, 0.16, 1.2), (x, 0.0, 0.60), "oak_dark")
    builder.box((2.25, 1.8, 0.12), (0.0, 0.0, 1.12), "shingles", (0.08, 0.0, 0.0))
    builder.box((2.0, 0.12, 0.72), (0.0, 0.82, 0.36), "timber_weathered")


def _chicken_roost(builder: MeshBuilder) -> None:
    for z in (0.42, 0.78, 1.14):
        builder.cylinder(0.045, 1.75, (0.0, 0.0, z), "timber_cut", 6, "x")
    builder.beam_between((-0.82, 0.0, 0.18), (-0.82, 0.0, 1.35), 0.10, "oak_dark")
    builder.beam_between((0.82, 0.0, 0.18), (0.82, 0.0, 1.35), 0.10, "oak_dark")


def _apiary(builder: MeshBuilder, count: int) -> None:
    columns = 3
    rows = math.ceil(count / columns)
    for index in range(count):
        x = (index % columns - 1) * 0.82
        y = (index // columns - (rows - 1) * 0.5) * 0.86
        builder.cone(0.30, 0.24, 0.70, (x, y, 0.59), "timber_weathered", 10)
        builder.cone(0.36, 0.04, 0.28, (x, y, 1.08), "shingles", 10)
    builder.box((2.55, rows * 0.86 + 0.25, 0.16), (0.0, 0.0, 0.16), "oak_dark")


def _scarecrow(builder: MeshBuilder) -> None:
    builder.cone(0.06, 0.03, 2.25, (0.0, 0.0, 1.125), "timber_cut", 6)
    builder.box((1.55, 0.08, 0.08), (0.0, 0.0, 1.62), "timber_cut")
    builder.box((1.15, 0.08, 0.72), (0.0, -0.05, 1.32), "canvas_red")
    builder.cone(0.32, 0.18, 0.26, (0.0, 0.0, 2.30), "thatch", 9)


def _compost_bin(builder: MeshBuilder) -> None:
    for x in (-0.82, 0.82):
        for y in (-0.62, 0.62):
            builder.cone(0.06, 0.035, 1.15, (x, y, 0.575), "timber_cut", 6)
    for side in (-0.62, 0.62):
        for z in (0.25, 0.48, 0.71, 0.94):
            builder.box((1.65, 0.045, 0.055), (0.0, side, z), "timber_cut")
    builder.box((1.45, 1.02, 0.42), (0.0, 0.0, 0.23), "earth")


def _coldframe(builder: MeshBuilder) -> None:
    builder.box((2.0, 1.2, 0.18), (0.0, 0.0, 0.09), "timber_weathered")
    for y in (-0.52, 0.52):
        builder.box((2.0, 0.14, 0.48), (0.0, y, 0.33), "timber_weathered", (0.04 if y < 0 else -0.04, 0.0, 0.0))
    builder.box((1.72, 0.98, 0.04), (0.0, 0.0, 0.62), "glass", (0.08, 0.0, 0.0))
