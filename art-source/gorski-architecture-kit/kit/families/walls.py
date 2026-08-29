from __future__ import annotations

from .. import spec
from ..core import MeshBuilder, Registry
from .common import add, framed_panel, plank_face, wall_around_opening


def register(registry: Registry) -> None:
    family = "walls"
    widths = (0.5, 1.0, 2.0, 4.0)
    heights = (1.10, 1.35, 2.40, 2.70, 3.00)
    systems = (
        ("limewash", spec.WALL_PLASTER, "limewash"),
        ("ochre", spec.WALL_PLASTER, "limewash_ochre"),
        ("grey", spec.WALL_PLASTER, "limewash_grey"),
        ("plank", spec.WALL_TIMBER, "timber_weathered"),
        ("fieldstone", spec.WALL_STONE, "fieldstone"),
    )
    for system, depth, material in systems:
        for width in widths:
            for height in heights:
                if width == 4.0 and height in (1.10, 1.35):
                    continue
                token = spec.width_token(width)
                htoken = spec.width_token(height)
                piece_id = f"wall_{system}_{token}_h{htoken}"
                add(
                    registry, piece_id, family,
                    f"{system.title()} wall {width:g} x {height:g} m",
                    ("wall", system, "host", "fraction-authored"),
                    lambda b, w=width, h=height, d=depth, m=material, s=system: _wall(b, w, h, d, m, s),
                    seams=(f"x=-{width/2:g}", f"x=+{width/2:g}", "y=0", "z=0"),
                    triangle_budget=5_600 if system == "fieldstone" else 3_200,
                )

    for contract in ("window_small", "window_domestic", "window_shop", "louver", "door_service", "door_house", "door_barn"):
        opening = spec.OPENINGS[contract]
        width = 4.0 if contract in ("door_barn", "window_shop") else 2.0
        for system, depth, material in (
            ("limewash", spec.WALL_PLASTER, "limewash"),
            ("plank", spec.WALL_TIMBER, "timber_weathered"),
            ("fieldstone", spec.WALL_STONE, "fieldstone"),
        ):
            wall_height = spec.STOREY_CIVIC if contract == "door_barn" else spec.STOREY_DOMESTIC
            piece_id = f"wall_{system}_{spec.width_token(width)}_{contract}_host"
            add(
                registry, piece_id, family,
                f"{system.title()} {contract.replace('_', ' ')} host wall",
                ("wall", system, "opening-host", contract),
                lambda b, w=width, h=wall_height, d=depth, o=opening, m=material, s=system: _opening_wall(b, w, h, d, o, m, s),
                seams=(f"x=-{width/2:g}", f"x=+{width/2:g}", "y=0", "z=0"),
                opening_contract=contract,
                triangle_budget=5_800 if system == "fieldstone" else 3_400,
            )

    for width in (1.0, 2.0, 4.0, 6.0):
        for material in ("limewash", "timber_weathered"):
            token = spec.width_token(width)
            system = "plaster" if material == "limewash" else "timber"
            add(
                registry, f"gable_infill_{system}_{token}", family,
                f"{system.title()} gable infill {width:g} m",
                ("gable", "wall", system, "roof-interface"),
                lambda b, w=width, m=material: _gable(b, w, m),
                seams=(f"x=-{width/2:g}", f"x=+{width/2:g}", "z=0"),
                triangle_budget=3_600,
            )


def _wall(builder: MeshBuilder, width: float, height: float, depth: float, material: str, system: str) -> None:
    if system == "plank":
        plank_face(builder, width, height, depth, material)
    elif system == "fieldstone":
        builder.irregular_stone_run(width, height, depth, material)
    elif width >= 1.0 and height >= 2.0:
        framed_panel(builder, width, height, material, depth)
    else:
        builder.box((width, depth, height), (0.0, depth * 0.5, height * 0.5), material)


def _opening_wall(builder: MeshBuilder, width: float, height: float, depth: float, opening: dict[str, float], material: str, system: str) -> None:
    wall_around_opening(builder, width, height, depth, opening["width"], opening["height"], opening["sill"], material)
    if system != "fieldstone":
        builder.box((width, depth + 0.045, 0.18), (0.0, -0.012, 0.09), "oak_dark")
        builder.box((width, depth + 0.045, 0.18), (0.0, -0.012, height - 0.09), "oak_dark")


def _gable(builder: MeshBuilder, width: float, material: str) -> None:
    height = width * 0.5 * __import__("math").tan(spec.ROOF_PITCH)
    builder.gable_prism(width, spec.WALL_PLASTER, height, 0.0, material)
    builder.beam_between((-width * 0.5, -0.04, 0.0), (0.0, -0.04, height), 0.16, "oak_dark")
    builder.beam_between((0.0, -0.04, height), (width * 0.5, -0.04, 0.0), 0.16, "oak_dark")
