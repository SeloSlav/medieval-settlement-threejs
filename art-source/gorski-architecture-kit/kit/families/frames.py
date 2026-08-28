from __future__ import annotations

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
