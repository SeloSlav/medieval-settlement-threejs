from __future__ import annotations

from collections.abc import Callable

from ..core import MeshBuilder, PartDefinition, Registry


def add(
    registry: Registry,
    piece_id: str,
    family: str,
    label: str,
    tags: tuple[str, ...],
    build: Callable[[MeshBuilder], None],
    *,
    seams: tuple[str, ...] = (),
    opening_contract: str | None = None,
    allow_nonmanifold: bool = False,
    triangle_budget: int = 3_200,
    bevel: float = 0.018,
) -> None:
    registry.add(PartDefinition(
        id=piece_id,
        family=family,
        label=label,
        tags=tags,
        build=build,
        seams=seams,
        opening_contract=opening_contract,
        allow_nonmanifold=allow_nonmanifold,
        triangle_budget=triangle_budget,
        bevel=bevel,
    ))


def plank_face(builder: MeshBuilder, width: float, height: float, depth: float, material: str, plank_width: float = 0.34) -> None:
    count = max(1, round(width / plank_width))
    actual = width / count
    for index in range(count):
        x = -width * 0.5 + actual * (index + 0.5)
        builder.box((actual - 0.018, depth, height), (x, depth * 0.5, height * 0.5), material)


def framed_panel(builder: MeshBuilder, width: float, height: float, panel_material: str, depth: float = 0.24) -> None:
    builder.box((width, depth, height), (0.0, depth * 0.5, height * 0.5), panel_material)
    member = min(0.20, width * 0.16)
    builder.box((member, depth + 0.05, height), (-width * 0.5 + member * 0.5, -0.015, height * 0.5), "oak_dark")
    builder.box((member, depth + 0.05, height), (width * 0.5 - member * 0.5, -0.015, height * 0.5), "oak_dark")
    builder.box((width, depth + 0.05, member), (0.0, -0.015, member * 0.5), "oak_dark")
    builder.box((width, depth + 0.05, member), (0.0, -0.015, height - member * 0.5), "oak_dark")
    if width >= 1.0 and height >= 1.3:
        builder.beam_between((-width * 0.42, -0.04, member), (width * 0.42, -0.04, height - member), member * 0.72, "oak_dark")


def wall_around_opening(
    builder: MeshBuilder,
    wall_width: float,
    wall_height: float,
    thickness: float,
    opening_width: float,
    opening_height: float,
    sill: float,
    material: str,
) -> None:
    side = (wall_width - opening_width) * 0.5
    if side <= 0.04 or opening_height + sill > wall_height + 0.001:
        raise ValueError("opening does not fit host wall")
    if sill > 0.001:
        builder.box((opening_width, thickness, sill), (0.0, thickness * 0.5, sill * 0.5), material)
    builder.box((side, thickness, wall_height), (-wall_width * 0.5 + side * 0.5, thickness * 0.5, wall_height * 0.5), material)
    builder.box((side, thickness, wall_height), (wall_width * 0.5 - side * 0.5, thickness * 0.5, wall_height * 0.5), material)
    head_height = wall_height - (sill + opening_height)
    if head_height > 0.001:
        builder.box((opening_width, thickness, head_height), (0.0, thickness * 0.5, wall_height - head_height * 0.5), material)
