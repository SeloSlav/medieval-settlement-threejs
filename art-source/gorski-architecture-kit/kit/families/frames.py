from __future__ import annotations

import math

from .. import spec
from ..core import MeshBuilder, Registry
from .common import add


def register(registry: Registry) -> None:
    family = "frames"
    for height in (1.10, 1.35, 2.40, 2.70, 3.00, 4.50):
        token = spec.width_token(height)
        for section in (0.16, 0.22, 0.30):
            stoken = spec.width_token(section)
            add(
                registry, f"frame_post_h{token}_s{stoken}", family,
                f"Oak post {height:g} m, {section:g} m section",
                ("frame", "post", "structural", "oak"),
                lambda b, h=height, s=section: _post(b, h, s),
                seams=("z=0", f"z={height:g}"),
            )

    for length in (0.5, 1.0, 2.0, 4.0):
        token = spec.width_token(length)
        for section in (0.16, 0.22, 0.30):
            stoken = spec.width_token(section)
            add(
                registry, f"frame_beam_{token}_s{stoken}", family,
                f"Oak beam {length:g} m, {section:g} m section",
                ("frame", "beam", "structural", "oak"),
                lambda b, l=length, s=section: _beam(b, l, s),
                seams=(f"x=-{length/2:g}", f"x=+{length/2:g}"),
            )

    for width in (1.0, 2.0, 4.0):
        token = spec.width_token(width)
        for side in ("left", "right"):
            add(
                registry, f"frame_brace_{side}_{token}", family,
                f"{side.title()} timber brace {width:g} m",
                ("frame", "brace", "joinery", side),
                lambda b, w=width, s=side: _brace(b, w, s),
                seams=("z=0", f"x={'-' if side == 'left' else '+'}{width/2:g}"),
            )

    for name, width, height in (
        ("service", 1.30, 2.35), ("house", 1.55, 2.48), ("barn", 3.00, 3.05), ("cart", 3.30, 3.20),
    ):
        add(
            registry, f"frame_portal_{name}", family,
            f"{name.title()} timber portal frame",
            ("frame", "portal", name, "joinery"),
            lambda b, w=width, h=height: _portal(b, w, h),
            seams=("z=0",),
            triangle_budget=3_800,
        )

    for width in (2.0, 4.0):
        token = spec.width_token(width)
        add(
            registry, f"frame_balcony_{token}", family,
            f"Timber gallery or balcony bay {width:g} m",
            ("frame", "balcony", "gallery", "residence"),
            lambda b, w=width: _balcony(b, w),
            seams=(f"x=-{width/2:g}", f"x=+{width/2:g}"),
            triangle_budget=5_200,
        )
        add(
            registry, f"frame_lean_to_{token}", family,
            f"Lean-to support bay {width:g} m",
            ("frame", "lean-to", "workshop", "annex"),
            lambda b, w=width: _lean_to(b, w),
            seams=(f"x=-{width/2:g}", f"x=+{width/2:g}", "z=0"),
            triangle_budget=4_200,
        )

    for width in (1.0, 2.0):
        token = spec.width_token(width)
        for side in ("left", "right"):
            add(registry, f"frame_curved_bracket_{side}_{token}", family, f"Curved {side} oak eave bracket {width:g} m", ("frame", "bracket", "curved", "eave", "folk-craft", side), lambda b, w=width, s=side: _curved_bracket(b, w, s), seams=("z=0", f"x={'-' if side == 'left' else '+'}{width:g}"), triangle_budget=6_200, bevel=0.006)
    for width in (2.0, 4.0):
        token = spec.width_token(width)
        add(registry, f"frame_gable_truss_{token}", family, f"Vernacular king-post gable truss {width:g} m", ("frame", "gable", "truss", "roof", "structural"), lambda b, w=width: _gable_truss(b, w), seams=(f"x=-{width/2:g}", f"x=+{width/2:g}"), triangle_budget=7_200, bevel=0.006)
        add(registry, f"frame_scalloped_fascia_{token}", family, f"Restrained scalloped timber fascia {width:g} m", ("frame", "fascia", "scalloped", "porch", "folk-craft"), lambda b, w=width: _scalloped_fascia(b, w), seams=(f"x=-{width/2:g}", f"x=+{width/2:g}"), triangle_budget=7_600, bevel=0.006)
    add(registry, "frame_lattice_panel_1m", family, "Diamond timber lattice infill 1 m", ("frame", "lattice", "porch", "shrine", "infill"), _lattice_panel, seams=("x=-0.5", "x=+0.5", "z=0"), triangle_budget=7_400, bevel=0.004)
    add(registry, "frame_eave_corbel_carved", family, "Carved timber eave corbel", ("frame", "corbel", "eave", "carved", "folk-craft"), _carved_corbel, triangle_budget=5_200, bevel=0.006)
    add(registry, "frame_gallery_post_cap", family, "Gallery post capital and bracket crown", ("frame", "post", "capital", "gallery", "porch"), _gallery_post_cap, triangle_budget=5_600, bevel=0.006)
    add(registry, "frame_arch_portal_2p4m", family, "Arched timber cart portal 2.4 m", ("frame", "portal", "arched", "cart", "joinery"), _arch_portal, seams=("z=0",), triangle_budget=8_400, bevel=0.006)


def _post(builder: MeshBuilder, height: float, section: float) -> None:
    builder.box((section, section, height), (0.0, 0.0, height * 0.5), "oak_dark")
    builder.cylinder(section * 0.10, section * 1.15, (0.0, -section * 0.52, height * 0.72), "iron", 6, "y")


def _beam(builder: MeshBuilder, length: float, section: float) -> None:
    builder.box((length, section, section), (0.0, 0.0, 0.0), "oak_dark")
    if length >= 1.0:
        builder.box((0.06, section + 0.018, section + 0.018), (-length * 0.34, 0.0, 0.0), "iron")
        builder.box((0.06, section + 0.018, section + 0.018), (length * 0.34, 0.0, 0.0), "iron")


def _brace(builder: MeshBuilder, width: float, side: str) -> None:
    sign = -1.0 if side == "left" else 1.0
    builder.beam_between((0.0, 0.0, 0.18), (sign * width * 0.5, 0.0, 1.35), 0.16, "oak_dark")


def _portal(builder: MeshBuilder, width: float, height: float) -> None:
    section = 0.24 if width < 2.0 else 0.30
    builder.box((section, section, height), (-width * 0.5, 0.0, height * 0.5), "oak_dark")
    builder.box((section, section, height), (width * 0.5, 0.0, height * 0.5), "oak_dark")
    builder.box((width + section, section, section), (0.0, 0.0, height - section * 0.5), "oak_dark")
    builder.beam_between((-width * 0.5, 0.0, height - section), (-width * 0.12, 0.0, height - 0.28), section * 0.66, "oak_dark")
    builder.beam_between((width * 0.5, 0.0, height - section), (width * 0.12, 0.0, height - 0.28), section * 0.66, "oak_dark")


def _balcony(builder: MeshBuilder, width: float) -> None:
    depth = 1.05
    builder.box((width, depth, 0.16), (0.0, 0.0, 0.08), "timber_weathered")
    for x in (-width * 0.5 + 0.10, 0.0, width * 0.5 - 0.10):
        builder.box((0.12, 0.12, 1.02), (x, -depth * 0.42, 0.59), "oak_dark")
    builder.box((width, 0.12, 0.12), (0.0, -depth * 0.42, 1.04), "oak_dark")
    builder.box((width, 0.08, 0.08), (0.0, -depth * 0.42, 0.61), "timber_weathered")


def _lean_to(builder: MeshBuilder, width: float) -> None:
    depth = 1.55
    for x in (-width * 0.5 + 0.12, width * 0.5 - 0.12):
        builder.box((0.18, 0.18, 2.15), (x, -depth, 1.075), "oak_dark")
    builder.box((width, 0.20, 0.20), (0.0, -depth, 2.05), "oak_dark")
    builder.beam_between((-width * 0.5, 0.0, 2.48), (-width * 0.5, -depth, 2.08), 0.16, "oak_dark")
    builder.beam_between((width * 0.5, 0.0, 2.48), (width * 0.5, -depth, 2.08), 0.16, "oak_dark")


def _curved_bracket(builder: MeshBuilder, width: float, side: str) -> None:
    sign = -1.0 if side == "left" else 1.0
    height = 1.08 + width * 0.18
    points: list[tuple[float, float, float]] = []
    for index in range(9):
        t = index / 8
        one = 1.0 - t
        x = sign * (3 * one * t * t * width * 0.32 + t * t * t * width)
        z = 3 * one * one * t * height * 0.72 + 3 * one * t * t * height + t * t * t * height
        points.append((x, 0.0, z))
    for start, end in zip(points, points[1:]):
        builder.beam_between(start, end, 0.13, "timber_cut")
    builder.box((0.20, 0.18, height * 0.58), (0.0, 0.0, height * 0.29), "oak_dark")
    builder.box((width + 0.18, 0.18, 0.18), (sign * width * 0.5, 0.0, height), "oak_dark")


def _gable_truss(builder: MeshBuilder, width: float) -> None:
    height = width * 0.62
    section = 0.17 if width <= 2.0 else 0.22
    builder.box((width, section, section), (0.0, 0.0, 0.0), "oak_dark")
    builder.beam_between((-width * 0.5, 0.0, 0.0), (0.0, 0.0, height), section, "oak_dark")
    builder.beam_between((0.0, 0.0, height), (width * 0.5, 0.0, 0.0), section, "oak_dark")
    builder.box((section, section, height), (0.0, 0.0, height * 0.5), "timber_cut")
    builder.box((width * 0.62, section * 0.86, section * 0.86), (0.0, 0.0, height * 0.46), "timber_cut")
    for side in (-1.0, 1.0):
        builder.beam_between((side * width * 0.31, 0.0, 0.08), (side * width * 0.10, 0.0, height * 0.46), section * 0.64, "timber_cut")


def _scalloped_fascia(builder: MeshBuilder, width: float) -> None:
    builder.box((width, 0.14, 0.18), (0.0, 0.0, 0.0), "oak_dark")
    count = max(4, int(round(width / 0.34)))
    for index in range(count):
        x = -width * 0.5 + width * (index + 0.5) / count
        depth = 0.20 if index % 2 else 0.28
        builder.cone(width / count * 0.38, 0.025, depth, (x, -0.01, -depth * 0.5 - 0.08), "timber_cut", 7)
    builder.box((width + 0.08, 0.16, 0.07), (0.0, 0.0, 0.14), "timber_cut")


def _lattice_panel(builder: MeshBuilder) -> None:
    width = 1.0
    height = 1.72
    builder.box((0.10, 0.10, height), (-width * 0.5, 0.0, height * 0.5), "oak_dark")
    builder.box((0.10, 0.10, height), (width * 0.5, 0.0, height * 0.5), "oak_dark")
    builder.box((width + 0.10, 0.10, 0.10), (0.0, 0.0, 0.05), "oak_dark")
    builder.box((width + 0.10, 0.10, 0.10), (0.0, 0.0, height - 0.05), "oak_dark")
    spacing = 0.34
    for direction in (-1.0, 1.0):
        for offset in (-0.78, -0.39, 0.0, 0.39, 0.78):
            points: list[tuple[float, float]] = []
            for x in (-width * 0.46, width * 0.46):
                z = direction * x + height * 0.5 + offset
                if 0.08 <= z <= height - 0.08:
                    points.append((x, z))
            for z in (0.08, height - 0.08):
                x = direction * (z - height * 0.5 - offset)
                if -width * 0.46 <= x <= width * 0.46:
                    points.append((x, z))
            if len(points) >= 2:
                builder.beam_between((points[0][0], -0.02, points[0][1]), (points[1][0], -0.02, points[1][1]), 0.045, "timber_cut")


def _carved_corbel(builder: MeshBuilder) -> None:
    builder.box((0.24, 0.28, 0.92), (0.0, 0.0, 0.46), "oak_dark")
    builder.box((0.88, 0.30, 0.22), (0.32, 0.0, 0.90), "oak_dark")
    _curved_bracket(builder, 0.72, "right")
    builder.cone(0.14, 0.035, 0.32, (0.0, -0.02, 1.14), "timber_cut", 8)


def _gallery_post_cap(builder: MeshBuilder) -> None:
    builder.box((0.24, 0.24, 0.76), (0.0, 0.0, 0.38), "oak_dark")
    builder.box((0.42, 0.34, 0.16), (0.0, 0.0, 0.82), "timber_cut")
    builder.box((0.62, 0.38, 0.14), (0.0, 0.0, 0.97), "timber_cut")
    for side in (-1.0, 1.0):
        builder.beam_between((0.0, 0.0, 0.72), (side * 0.48, 0.0, 1.14), 0.11, "timber_cut")


def _arch_portal(builder: MeshBuilder) -> None:
    width = 2.40
    height = 2.86
    spring = 1.70
    section = 0.22
    for x in (-width * 0.5, width * 0.5):
        builder.box((section, section, spring), (x, 0.0, spring * 0.5), "oak_dark")
    radius = width * 0.5
    points = [(radius * math.cos(math.pi * index / 12), 0.0, spring + radius * math.sin(math.pi * index / 12)) for index in range(13)]
    for start, end in zip(points, points[1:]):
        builder.beam_between(start, end, section, "oak_dark")
    builder.box((width + 0.46, section, section), (0.0, 0.0, height), "timber_cut")
    for side in (-1.0, 1.0):
        builder.beam_between((side * width * 0.5, 0.0, spring * 0.55), (side * width * 0.22, 0.0, spring), section * 0.62, "timber_cut")
