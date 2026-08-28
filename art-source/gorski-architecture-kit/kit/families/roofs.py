from __future__ import annotations

import math

from .. import spec
from ..core import MeshBuilder, Registry
from .common import add


def register(registry: Registry) -> None:
    family = "roofs"
    widths = (0.5, 1.0, 2.0, 4.0)
    slope_lengths = (("quarter", 0.60), ("half", 1.20), ("full", 2.40))
    materials = (("shingle", "shingles"), ("tile", "terracotta"), ("thatch", "thatch"))
    for style, material in materials:
        for width in widths:
            for length_name, slope_length in slope_lengths:
                token = spec.width_token(width)
                piece_id = f"roof_{style}_panel_{token}_{length_name}"
                add(
                    registry, piece_id, family,
                    f"{style.title()} roof panel {width:g} m {length_name}",
                    ("roof", style, "panel", length_name, "fraction-authored"),
                    lambda b, w=width, l=slope_length, m=material, s=style: _panel(b, w, l, m, s),
                    seams=(f"x=-{width/2:g}", f"x=+{width/2:g}", "slope-start", "slope-end"),
                    triangle_budget=5_800,
                    bevel=0.008,
                )

        for length in widths:
            token = spec.width_token(length)
            add(
                registry, f"roof_{style}_ridge_{token}", family,
                f"{style.title()} ridge cap {length:g} m",
                ("roof", style, "ridge", "cap"),
                lambda b, l=length, m=material, s=style: _ridge(b, l, m, s),
                seams=(f"x=-{length/2:g}", f"x=+{length/2:g}"),
                triangle_budget=3_600,
                bevel=0.008,
            )

    for length in widths:
        token = spec.width_token(length)
        for role in ("eave", "verge", "valley", "fascia"):
            add(
                registry, f"roof_timber_{role}_{token}", family,
                f"Timber roof {role} {length:g} m",
                ("roof", "timber", role, "junction"),
                lambda b, l=length, r=role: _roof_timber(b, l, r),
                seams=(f"x=-{length/2:g}", f"x=+{length/2:g}"),
                triangle_budget=2_600,
            )

    for width in (1.0, 2.0, 4.0):
        token = spec.width_token(width)
        add(registry, f"roof_dormer_frame_{token}", family, f"Dormer roof frame {width:g} m", ("roof", "dormer", "frame", "junction"), lambda b, w=width: _dormer_frame(b, w), triangle_budget=4_800)
    add(registry, "roof_snow_catch_2m", family, "Timber snow catch 2 m", ("roof", "snow", "safety", "mountain"), _snow_catch)


def _panel(builder: MeshBuilder, width: float, slope_length: float, material: str, style: str) -> None:
    builder.roof_panel(width, slope_length, material)
    if style == "shingle":
        course = 0.24
        count = max(2, int(round(slope_length / course)))
        for index in range(count + 1):
            y = -slope_length * 0.5 + slope_length * index / count
            z = y * math.sin(spec.ROOF_PITCH) + spec.ROOF_THICKNESS * 0.60
            yy = y * math.cos(spec.ROOF_PITCH)
            builder.box((width - 0.025, 0.025, 0.018), (0.0, yy, z), "oak_dark", (spec.ROOF_PITCH, 0.0, 0.0))
    elif style == "tile":
        count = max(2, int(round(slope_length / 0.30)))
        for index in range(count + 1):
            y = -slope_length * 0.5 + slope_length * index / count
            z = y * math.sin(spec.ROOF_PITCH) + spec.ROOF_THICKNESS * 0.60
            yy = y * math.cos(spec.ROOF_PITCH)
            builder.cylinder(0.035, width - 0.04, (0.0, yy, z), "terracotta", 6, "x")
    else:
        for x in (-width * 0.42, -width * 0.14, width * 0.14, width * 0.42):
            if abs(x) <= width * 0.5:
                builder.box((0.028, slope_length, 0.025), (x, 0.0, spec.ROOF_THICKNESS * 0.60), "rope", (spec.ROOF_PITCH, 0.0, 0.0))


def _ridge(builder: MeshBuilder, length: float, material: str, style: str) -> None:
    if style == "tile":
        count = max(2, int(round(length / 0.30)))
        for index in range(count):
            x = -length * 0.5 + length * (index + 0.5) / count
            builder.cylinder(0.11, length / count + 0.025, (x, 0.0, 0.0), material, 8, "x")
    else:
        builder.beam_between((-length * 0.5, -0.13, -0.03), (length * 0.5, -0.13, -0.03), 0.16 if style == "shingle" else 0.20, material)
        builder.beam_between((-length * 0.5, 0.13, -0.03), (length * 0.5, 0.13, -0.03), 0.16 if style == "shingle" else 0.20, material)


def _roof_timber(builder: MeshBuilder, length: float, role: str) -> None:
    thickness = 0.14 if role != "fascia" else 0.18
    depth = 0.18 if role != "valley" else 0.24
    builder.box((length, depth, thickness), (0.0, 0.0, 0.0), "oak_dark")
    if role == "valley":
        builder.box((length, depth * 0.38, thickness * 0.45), (0.0, 0.0, thickness * 0.72), "iron")


def _dormer_frame(builder: MeshBuilder, width: float) -> None:
    height = 1.25
    depth = 1.20
    section = 0.14
    for x in (-width * 0.5, width * 0.5):
        builder.box((section, section, height), (x, -depth * 0.5, height * 0.5), "oak_dark")
        builder.box((section, section, height), (x, depth * 0.5, height * 0.5), "oak_dark")
    builder.beam_between((-width * 0.5, -depth * 0.5, height), (0.0, -depth * 0.5, height + width * 0.34), section, "oak_dark")
    builder.beam_between((0.0, -depth * 0.5, height + width * 0.34), (width * 0.5, -depth * 0.5, height), section, "oak_dark")


def _snow_catch(builder: MeshBuilder) -> None:
    builder.box((2.0, 0.11, 0.11), (0.0, 0.0, 0.28), "oak_dark")
    for x in (-0.8, -0.25, 0.25, 0.8):
        builder.beam_between((x, 0.0, 0.0), (x, 0.0, 0.32), 0.07, "iron")
