from __future__ import annotations

from .. import spec
from ..core import MeshBuilder, Registry
from .common import add


def register(registry: Registry) -> None:
    family = "foundations"
    widths = (0.5, 1.0, 2.0, 4.0)
    heights = (0.35, 0.65, 1.20)
    for material in ("fieldstone", "limestone_warm"):
        for width in widths:
            for height in heights:
                token = spec.width_token(width)
                htoken = spec.width_token(height)
                piece_id = f"foundation_{material}_{token}_h{htoken}"
                add(
                    registry, piece_id, family,
                    f"{material.replace('_', ' ').title()} foundation {width:g} x {height:g} m",
                    ("foundation", material, "wall-base", "terrain-adapter"),
                    lambda b, w=width, h=height, m=material: b.irregular_stone_run(w, h, spec.WALL_STONE, m),
                    seams=(f"x=-{width/2:g}", f"x=+{width/2:g}", "z=0"),
                    triangle_budget=5_200,
                    bevel=0.012,
                )

    for height in heights:
        token = spec.width_token(height)
        add(
            registry, f"foundation_corner_fieldstone_h{token}", family,
            f"Fieldstone foundation corner {height:g} m",
            ("foundation", "corner", "fieldstone", "terrain-adapter"),
            lambda b, h=height: _corner(b, h, "fieldstone"),
            seams=("x=0", "y=0", "z=0"),
            triangle_budget=4_200,
        )

    for style, height, material in (
        ("timber", 0.55, "timber_cut"),
        ("stone", 0.60, "limestone_warm"),
        ("quarry", 0.72, "quarry_stone"),
    ):
        for width in (0.42, 0.65, 0.90):
            token = spec.width_token(width)
            add(
                registry, f"foundation_pier_{style}_{token}", family,
                f"{style.title()} foundation pier {width:g} m",
                ("foundation", "pier", style),
                lambda b, w=width, h=height, m=material: b.box((w, w, h), (0.0, 0.0, h * 0.5), m),
                seams=("z=0",),
            )

    for steps in (1, 3, 5):
        add(
            registry, f"foundation_steps_limestone_{steps}", family,
            f"Limestone entrance steps {steps}",
            ("foundation", "steps", "entrance", "limestone"),
            lambda b, count=steps: _steps(b, count),
            seams=("z=0",),
            triangle_budget=2_400,
        )

    for width in (1.0, 2.0, 4.0):
        token = spec.width_token(width)
        add(
            registry, f"foundation_retaining_wall_{token}", family,
            f"Slope retaining wall {width:g} m",
            ("foundation", "retaining-wall", "slope", "fieldstone"),
            lambda b, w=width: _retaining(b, w),
            seams=(f"x=-{width/2:g}", f"x=+{width/2:g}", "z=0"),
            triangle_budget=5_600,
        )


def _corner(builder: MeshBuilder, height: float, material: str) -> None:
    thickness = spec.WALL_STONE
    builder.irregular_stone_run(spec.GRID, height, thickness, material)
    builder.box((thickness, spec.GRID - thickness, height), (-spec.GRID * 0.5 + thickness * 0.5, spec.GRID * 0.5, height * 0.5), material)


def _steps(builder: MeshBuilder, count: int) -> None:
    tread = 0.34
    rise = 0.18
    for index in range(count):
        width = 1.25 + (count - index - 1) * 0.12
        depth = tread * (count - index)
        height = rise * (index + 1)
        builder.box((width, depth, height), (0.0, depth * 0.5, height * 0.5), "limestone_warm")


def _retaining(builder: MeshBuilder, width: float) -> None:
    builder.irregular_stone_run(width, 1.1, 0.55, "fieldstone")
    builder.box((width + 0.08, 0.66, 0.16), (0.0, 0.0, 1.18), "limestone_warm")
