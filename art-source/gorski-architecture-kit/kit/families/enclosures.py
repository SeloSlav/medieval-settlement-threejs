from __future__ import annotations

from .. import spec
from ..core import MeshBuilder, Registry
from .common import add


def register(registry: Registry) -> None:
    family = "enclosures"
    for style in ("split_rail", "wattle", "dry_stone", "palisade", "parish_wall"):
        for length in (1.0, 2.0, 4.0):
            token = spec.width_token(length)
            add(
                registry, f"enclosure_{style}_{token}", family,
                f"{style.replace('_', ' ').title()} span {length:g} m",
                ("enclosure", style, "span", "terrain-following"),
                lambda b, s=style, l=length: _span(b, s, l),
                seams=(f"x=-{length/2:g}", f"x=+{length/2:g}", "z=0"),
                triangle_budget=6_200 if style == "dry_stone" else 4_500,
            )
        add(
            registry, f"enclosure_{style}_corner", family,
            f"{style.replace('_', ' ').title()} corner",
            ("enclosure", style, "corner"),
            lambda b, s=style: _corner(b, s),
            seams=("x=0", "y=0", "z=0"),
            triangle_budget=5_600,
        )

    for style in ("split_rail", "wattle", "dry_stone", "palisade", "parish_wall"):
        add(
            registry, f"enclosure_{style}_gate_person", family,
            f"{style.replace('_', ' ').title()} person gate",
            ("enclosure", style, "gate", "pedestrian"),
            lambda b, s=style: _gate(b, s, 1.10),
            opening_contract="door_house",
            triangle_budget=5_200,
        )
        add(
            registry, f"enclosure_{style}_gate_cart", family,
            f"{style.replace('_', ' ').title()} cart gate",
            ("enclosure", style, "gate", "cart"),
            lambda b, s=style: _gate(b, s, 2.40),
            opening_contract="gate_cart",
            triangle_budget=5_800,
        )

    add(registry, "enclosure_livestock_hurdle_2m", family, "Portable livestock hurdle", ("enclosure", "livestock", "hurdle", "portable"), _hurdle)
    add(registry, "enclosure_graveyard_cross_rail_2m", family, "Graveyard cross rail", ("enclosure", "graveyard", "rail", "sacred"), lambda b: _span(b, "split_rail", 2.0))


def _span(builder: MeshBuilder, style: str, length: float) -> None:
    if style == "dry_stone":
        builder.irregular_stone_run(length, 1.08, 0.52, "fieldstone", 0.26)
        builder.box((length + 0.08, 0.58, 0.18), (0.0, 0.0, 1.15), "limestone_warm")
        return
    if style == "parish_wall":
        builder.irregular_stone_run(length, 1.35, 0.45, "limestone_warm", 0.24)
        builder.box((length + 0.06, 0.52, 0.15), (0.0, 0.0, 1.42), "terracotta")
        return
    post_height = 1.20 if style != "palisade" else 2.80
    post_spacing = 1.0 if style != "wattle" else 0.55
    count = max(2, round(length / post_spacing) + 1)
    for index in range(count):
        x = -length * 0.5 + length * index / (count - 1)
        builder.cone(0.105 if style != "palisade" else 0.14, 0.075 if style != "palisade" else 0.02, post_height, (x, 0.0, post_height * 0.5), "timber_weathered", 7)
    if style == "split_rail":
        for z in (0.46, 0.93):
            builder.box((length, 0.10, 0.10), (0.0, 0.0, z), "timber_weathered", (0.0, 0.0, 0.025 if z < 0.6 else -0.018))
    elif style == "wattle":
        for band in range(8):
            z = 0.18 + band * 0.12
            builder.box((length, 0.055, 0.045), (0.0, -0.02 if band % 2 else 0.02, z), "timber_cut")
    else:
        builder.box((length, 0.13, 0.16), (0.0, 0.0, 0.48), "oak_dark")
        builder.box((length, 0.13, 0.16), (0.0, 0.0, 1.55), "oak_dark")


def _corner(builder: MeshBuilder, style: str) -> None:
    _span(builder, style, 2.0)
    if style in ("dry_stone", "parish_wall"):
        height = 1.08 if style == "dry_stone" else 1.35
        material = "fieldstone" if style == "dry_stone" else "limestone_warm"
        builder.box((0.52, 2.0, height), (-1.0, 1.0, height * 0.5), material)
    else:
        builder.box((0.12, 2.0, 0.12), (-1.0, 1.0, 0.46), "timber_weathered")
        builder.box((0.12, 2.0, 0.12), (-1.0, 1.0, 0.93), "timber_weathered")


def _gate(builder: MeshBuilder, style: str, width: float) -> None:
    post_height = 2.0 if style != "palisade" else 3.15
    post = 0.20 if style != "palisade" else 0.30
    for x in (-width * 0.5 - post * 0.5, width * 0.5 + post * 0.5):
        builder.box((post, post, post_height), (x, 0.0, post_height * 0.5), "oak_dark")
    leaf_height = min(1.35, post_height * 0.62)
    builder.box((width - 0.06, 0.11, 0.12), (0.0, -0.05, 0.18), "timber_weathered")
    builder.box((width - 0.06, 0.11, 0.12), (0.0, -0.05, leaf_height - 0.10), "timber_weathered")
    builder.beam_between((-width * 0.46, -0.05, 0.24), (width * 0.46, -0.05, leaf_height - 0.16), 0.12, "timber_weathered")
    builder.cylinder(0.035, 0.12, (width * 0.34, -0.12, leaf_height * 0.54), "iron", 8, "y")


def _hurdle(builder: MeshBuilder) -> None:
    for x in (-0.92, 0.92):
        builder.cone(0.08, 0.045, 1.35, (x, 0.0, 0.675), "timber_cut", 6)
    for z in (0.25, 0.55, 0.85, 1.15):
        builder.box((1.84, 0.07, 0.07), (0.0, 0.0, z), "timber_cut")
