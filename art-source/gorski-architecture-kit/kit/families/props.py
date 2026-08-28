from __future__ import annotations

import math

from ..core import MeshBuilder, Registry
from .common import add


def register(registry: Registry) -> None:
    family = "props"
    for size in ("small", "medium", "large"):
        add(registry, f"prop_barrel_{size}", family, f"Coopered barrel {size}", ("prop", "storage", "barrel", size), lambda b, s=size: _barrel(b, s))
        add(registry, f"prop_crate_{size}", family, f"Timber crate {size}", ("prop", "storage", "crate", size), lambda b, s=size: _crate(b, s))
        add(registry, f"prop_sack_stack_{size}", family, f"Grain sack stack {size}", ("prop", "storage", "sack", "grain", size), lambda b, s=size: _sacks(b, s), triangle_budget=5_200)
        add(registry, f"prop_firewood_stack_{size}", family, f"Split firewood stack {size}", ("prop", "fuel", "firewood", size), lambda b, s=size: _firewood(b, s), triangle_budget=6_200)
    for length in (1.0, 2.0, 4.0):
        token = str(length).replace(".", "p")
        add(registry, f"prop_log_stack_{token}m", family, f"Roundwood log stack {length:g} m", ("prop", "lumber", "logs", "storage"), lambda b, l=length: _logs(b, l), triangle_budget=5_800)
        add(registry, f"prop_ladder_{token}m", family, f"Timber ladder {length:g} m", ("prop", "access", "ladder"), lambda b, l=length: _ladder(b, l))

    for trade in ("smith", "carpenter", "quarry", "farm", "tannery", "fishing"):
        add(registry, f"prop_tool_rack_{trade}", family, f"{trade.title()} tool rack", ("prop", "tools", trade, "rack"), lambda b, t=trade: _tool_rack(b, t), triangle_budget=5_000)
    add(registry, "prop_tool_rack_hunter", family, "Hunter bow and snare rack", ("prop", "tools", "hunter", "rack", "bow", "snare"), _hunter_tool_rack, triangle_budget=5_800)
    add(registry, "prop_camp_worktable", family, "Camp field-dressing worktable", ("prop", "camp", "hunter", "worktable", "processing"), _camp_worktable)
    for kind in ("town", "market", "tavern", "chapel", "mine", "mill"):
        add(registry, f"prop_signpost_{kind}", family, f"{kind.title()} signpost", ("prop", "wayfinding", "sign", kind), lambda b, k=kind: _signpost(b, k))

    add(registry, "prop_two_wheel_cart", family, "Two-wheel village cart", ("prop", "transport", "cart", "logistics"), _cart, triangle_budget=6_400)
    add(registry, "prop_sledge", family, "Timber haulage sledge", ("prop", "transport", "sledge", "logging"), _sledge)
    add(registry, "prop_fish_drying_rack", family, "Fishing camp drying rack", ("prop", "fishing", "rack", "food"), _fish_rack)
    add(registry, "prop_boat_dugout", family, "River dugout boat", ("prop", "fishing", "boat", "river"), _boat, triangle_budget=5_800)
    add(registry, "prop_firewood_chopping_block", family, "Chopping block and axe", ("prop", "woodcutter", "firewood", "tool"), _chopping_block)
    add(registry, "prop_water_bucket_pair", family, "Water bucket pair", ("prop", "water", "bucket", "service"), _bucket_pair)
    add(registry, "prop_hitching_rail_2m", family, "Horse hitching rail 2 m", ("prop", "stable", "horse", "rail"), _hitching_rail)
    add(registry, "prop_torch_bracket", family, "Wall torch bracket", ("prop", "lighting", "torch", "wall"), _torch)
    add(registry, "prop_salvage_pile", family, "Founders' salvage pile", ("prop", "founders-camp", "salvage", "state-prop"), _salvage, triangle_budget=6_800)


def _barrel(builder: MeshBuilder, size: str) -> None:
    radius, height = {"small": (0.34, 0.62), "medium": (0.45, 0.82), "large": (0.58, 1.05)}[size]
    builder.cone(radius * 0.88, radius, height * 0.5, (0.0, 0.0, height * 0.25), "timber_weathered", 12)
    builder.cone(radius, radius * 0.88, height * 0.5, (0.0, 0.0, height * 0.75), "timber_weathered", 12)
    for z in (0.10, height * 0.50, height - 0.10):
        builder.cylinder(radius * 1.01, 0.045, (0.0, 0.0, z), "iron", 12, "z")


def _crate(builder: MeshBuilder, size: str) -> None:
    scale = {"small": 0.55, "medium": 0.82, "large": 1.12}[size]
    builder.box((scale, scale * 0.72, scale * 0.72), (0.0, 0.0, scale * 0.36), "timber_weathered")
    for x in (-scale * 0.42, scale * 0.42):
        builder.box((scale * 0.10, scale * 0.78, scale * 0.78), (x, 0.0, scale * 0.36), "oak_dark")
    builder.beam_between((-scale * 0.44, -scale * 0.38, scale * 0.08), (scale * 0.44, -scale * 0.38, scale * 0.65), scale * 0.07, "oak_dark")


def _sacks(builder: MeshBuilder, size: str) -> None:
    count = {"small": 2, "medium": 5, "large": 9}[size]
    for index in range(count):
        row = int(math.sqrt(index))
        x = (index % 3 - 1) * 0.48 + builder.random.uniform(-0.04, 0.04)
        y = (index // 3 - 1) * 0.46 + builder.random.uniform(-0.04, 0.04)
        z = 0.26 + row * 0.06
        builder.cone(0.24, 0.17, 0.52, (x, y, z), "canvas", 8)


def _firewood(builder: MeshBuilder, size: str) -> None:
    count = {"small": 8, "medium": 16, "large": 28}[size]
    columns = max(4, round(math.sqrt(count) * 1.4))
    for index in range(count):
        x = (index % columns - (columns - 1) * 0.5) * 0.22
        z = 0.10 + (index // columns) * 0.19
        builder.cylinder(0.075, 0.62, (x, 0.0, z), "timber_cut", 7, "y")


def _logs(builder: MeshBuilder, length: float) -> None:
    for row, count in enumerate((4, 3, 2)):
        for index in range(count):
            y = (index - (count - 1) * 0.5) * 0.34
            builder.cylinder(0.15, length, (0.0, y, 0.15 + row * 0.27), "timber_cut", 8, "x")


def _ladder(builder: MeshBuilder, length: float) -> None:
    for x in (-0.28, 0.28):
        builder.box((0.10, 0.10, length), (x, 0.0, length * 0.5), "timber_cut")
    count = max(3, round(length / 0.34))
    for index in range(count):
        builder.box((0.65, 0.08, 0.08), (0.0, 0.0, length * (index + 0.5) / count), "timber_cut")


def _tool_rack(builder: MeshBuilder, trade: str) -> None:
    builder.box((1.65, 0.12, 0.12), (0.0, 0.0, 1.55), "oak_dark")
    for x in (-0.72, -0.36, 0.0, 0.36, 0.72):
        builder.box((0.06, 0.06, 1.28), (x, -0.05, 0.78), "iron", (0.0, 0.0, x * 0.08))
    color = "timber_cut" if trade in ("carpenter", "farm", "fishing") else "iron"
    builder.box((0.82, 0.08, 0.18), (0.0, -0.08, 0.32), color)


def _extruded_xz_profile(
    builder: MeshBuilder,
    profile: list[tuple[float, float]],
    y: float,
    depth: float,
    material: str,
) -> None:
    front = [(x, y - depth * 0.5, z) for x, z in profile]
    back = [(x, y + depth * 0.5, z) for x, z in profile]
    vertices = front + back
    count = len(profile)
    faces: list[tuple[int, ...]] = [tuple(range(count)), tuple(range(count * 2 - 1, count - 1, -1))]
    for index in range(count):
        following = (index + 1) % count
        faces.append((index, following, count + following, count + index))
    builder._append(vertices, faces, material)


def _extruded_xy_profile(
    builder: MeshBuilder,
    profile: list[tuple[float, float]],
    z: float,
    thickness: float,
    material: str,
) -> None:
    lower = [(x, y, z - thickness * 0.5) for x, y in profile]
    upper = [(x, y, z + thickness * 0.5) for x, y in profile]
    vertices = lower + upper
    count = len(profile)
    faces: list[tuple[int, ...]] = [tuple(range(count - 1, -1, -1)), tuple(range(count, count * 2))]
    for index in range(count):
        following = (index + 1) % count
        faces.append((index, following, count + following, count + index))
    builder._append(vertices, faces, material)


def _round_loop(
    builder: MeshBuilder,
    center: tuple[float, float, float],
    radius_x: float,
    radius_z: float,
    material: str,
    tube_radius: float = 0.010,
    segments: int = 14,
) -> None:
    points = [
        (
            center[0] + math.cos(math.tau * index / segments) * radius_x,
            center[1],
            center[2] + math.sin(math.tau * index / segments) * radius_z,
        )
        for index in range(segments)
    ]
    for index, point in enumerate(points):
        builder.round_beam_between(point, points[(index + 1) % segments], tube_radius, material, 5)


def _hunter_tool_rack(builder: MeshBuilder) -> None:
    # A light field rack is made from forked saplings, not perfectly machined
    # square posts. The staggered crossbar and branch forks communicate its lash-up.
    for side in (-1.0, 1.0):
        bottom = (side * 1.03, 0.035 * side, 0.0)
        middle = (side * 1.00, -0.01, 1.06)
        top = (side * 0.95, 0.02 * side, 2.22 + 0.035 * side)
        builder.round_beam_between(bottom, middle, 0.052, "timber_weathered", 7, 0.047)
        builder.round_beam_between(middle, top, 0.047, "timber_weathered", 7, 0.038)
        builder.round_beam_between(top, (side * 1.08, 0.01, 2.39 + 0.02 * side), 0.030, "timber_weathered", 6, 0.018)
    builder.round_beam_between((-1.03, -0.015, 2.05), (1.02, 0.018, 2.13), 0.045, "timber_weathered", 8, 0.039)
    for x in (-0.92, 0.92):
        builder.round_beam_between((x - 0.06, -0.05, 2.01), (x + 0.07, 0.04, 2.14), 0.010, "rope", 5)

    # Two recurved bows use many short tapered sapling sections so the limbs
    # read as sprung curves instead of four angular sticks.
    for center_x, lean in ((-0.48, -0.030), (0.15, 0.045)):
        point_count = 11
        points = [
            (
                center_x
                - 0.205 * math.sin(math.pi * index / (point_count - 1))
                + lean * (index / (point_count - 1) - 0.5),
                -0.105 - 0.006 * math.sin(index * 1.25),
                1.95 - index * (1.40 / (point_count - 1)),
            )
            for index in range(point_count)
        ]
        for index in range(len(points) - 1):
            distance_from_grip = abs(index - (point_count - 2) * 0.5) / ((point_count - 2) * 0.5)
            radius = 0.019 + (1.0 - distance_from_grip) * 0.006
            builder.round_beam_between(points[index], points[index + 1], radius, "timber_cut", 7, radius * 0.88)
        top = points[0]
        grip = points[point_count // 2]
        bottom = points[-1]
        builder.round_beam_between(top, bottom, 0.0055, "rope", 5)
        builder.round_beam_between(
            (grip[0] - 0.008, grip[1] - 0.006, grip[2] - 0.070),
            (grip[0] + 0.008, grip[1] - 0.006, grip[2] + 0.070),
            0.021,
            "leather",
            7,
            0.019,
        )

    # Snares are readable cord loops rather than the old rigid iron squares.
    for index, x in enumerate((0.62, 0.82, 0.96)):
        _round_loop(builder, (x, -0.12 - index * 0.004, 1.29 - index * 0.12), 0.20 - index * 0.015, 0.25 - index * 0.015, "rope", 0.008)
    builder.round_beam_between((0.80, -0.11, 1.63), (0.78, -0.11, 2.08), 0.009, "rope", 5)
    builder.round_beam_between((0.77, -0.12, 0.82), (0.77, -0.12, 1.08), 0.012, "iron", 6, 0.008)


def _camp_worktable(builder: MeshBuilder) -> None:
    # Four independently weathered boards and splayed trestles replace the clean
    # single slab. Their small offsets read at close range without changing scale.
    for index, y in enumerate((-0.315, -0.105, 0.105, 0.315)):
        builder.box(
            (1.92 - 0.035 * (index % 2), 0.205, 0.070 + 0.007 * (index % 3)),
            (0.012 * (index - 1.5), y, 0.90 + 0.009 * math.sin(index * 1.7)),
            "timber_weathered",
            (0.0, 0.006 * (index - 1.5), -0.010 + 0.007 * index),
        )
    for x in (-0.70, 0.70):
        builder.round_beam_between((x - 0.16, -0.34, 0.0), (x, -0.28, 0.86), 0.050, "oak_dark", 7, 0.043)
        builder.round_beam_between((x + 0.16, 0.34, 0.0), (x, 0.28, 0.86), 0.050, "oak_dark", 7, 0.043)
        builder.round_beam_between((x - 0.13, 0.34, 0.0), (x, 0.28, 0.86), 0.047, "oak_dark", 7, 0.041)
        builder.round_beam_between((x + 0.13, -0.34, 0.0), (x, -0.28, 0.86), 0.047, "oak_dark", 7, 0.041)
    builder.round_beam_between((-0.70, 0.0, 0.39), (0.70, 0.0, 0.41), 0.042, "oak_dark", 7)

    builder.box((1.08, 0.48, 0.055), (-0.14, 0.015, 0.982), "timber_cut", (0.0, 0.008, 0.020))
    # Field-dressing knife: tapered forged blade, short wooden scales, and one pin.
    _extruded_xy_profile(
        builder,
        [(0.28, -0.17), (0.74, -0.21), (0.30, -0.10), (0.20, -0.11)],
        1.035,
        0.022,
        "iron",
    )
    builder.round_beam_between((0.14, -0.105, 1.041), (-0.10, -0.065, 1.041), 0.035, "timber_cut", 7, 0.031)
    builder.cylinder(0.008, 0.075, (0.02, -0.085, 1.043), "iron", 6, "z")


def _signpost(builder: MeshBuilder, kind: str) -> None:
    builder.box((0.14, 0.14, 2.25), (0.0, 0.0, 1.125), "oak_dark")
    direction = -1.0 if kind in ("mine", "mill", "chapel") else 1.0
    builder.box((1.25, 0.08, 0.32), (direction * 0.45, 0.0, 1.75), "timber_weathered", (0.0, 0.0, direction * 0.05))
    builder.cone(0.18, 0.02, 0.28, (direction * 1.13, 0.0, 1.75), "timber_weathered", 6)


def _cart(builder: MeshBuilder) -> None:
    builder.box((2.15, 1.25, 0.18), (0.0, 0.0, 0.78), "timber_weathered")
    for x in (-0.98, 0.98):
        builder.box((0.16, 1.25, 0.72), (x, 0.0, 1.04), "timber_weathered")
    for y in (-0.74, 0.74):
        builder.cylinder(0.58, 0.12, (0.0, y, 0.58), "oak_dark", 12, "y")
        builder.cylinder(0.42, 0.14, (0.0, y, 0.58), "earth", 10, "y")
    for y in (-0.35, 0.35):
        builder.beam_between((0.95, y, 0.64), (3.4, y, 0.32), 0.11, "timber_cut")


def _sledge(builder: MeshBuilder) -> None:
    for y in (-0.62, 0.62):
        builder.beam_between((-1.4, y, 0.12), (1.55, y, 0.22), 0.16, "oak_dark")
        builder.beam_between((1.55, y, 0.22), (2.15, y, 0.55), 0.16, "oak_dark")
    for x in (-0.92, -0.30, 0.30, 0.92):
        builder.box((0.14, 1.4, 0.14), (x, 0.0, 0.42), "timber_weathered")


def _fish_rack(builder: MeshBuilder) -> None:
    for x in (-1.0, 1.0):
        builder.box((0.14, 0.14, 1.9), (x, 0.0, 0.95), "oak_dark")
    builder.box((2.15, 0.14, 0.14), (0.0, 0.0, 1.82), "oak_dark")
    for x in (-0.72, -0.36, 0.0, 0.36, 0.72):
        builder.box((0.10, 0.045, 0.58), (x, -0.04, 1.34), "leather")


def _boat(builder: MeshBuilder) -> None:
    builder.box((3.8, 0.68, 0.32), (0.0, 0.0, 0.28), "timber_weathered")
    builder.cone(0.52, 0.05, 0.78, (2.20, 0.0, 0.28), "timber_weathered", 8)
    builder.cone(0.52, 0.05, 0.78, (-2.20, 0.0, 0.28), "timber_weathered", 8)
    for x in (-0.95, 0.0, 0.95):
        builder.box((0.12, 0.92, 0.12), (x, 0.0, 0.52), "oak_dark")


def _chopping_block(builder: MeshBuilder) -> None:
    builder.cone(0.38, 0.335, 0.69, (0.0, 0.0, 0.345), "timber_weathered", 11)
    builder.cylinder(0.315, 0.028, (0.0, 0.0, 0.698), "timber_cut", 11, "z")
    # Curved haft and forged wedge head make the embedded hatchet legible from
    # both settlement and close views; the blade edge is thinner than its eye.
    builder.round_beam_between((0.01, 0.0, 0.73), (0.13, 0.0, 1.00), 0.031, "timber_cut", 7, 0.028)
    builder.round_beam_between((0.13, 0.0, 1.00), (0.23, 0.0, 1.24), 0.028, "timber_cut", 7, 0.024)
    _extruded_xz_profile(
        builder,
        [(0.08, 1.31), (0.07, 1.18), (0.21, 1.18), (0.34, 1.23), (0.24, 1.30)],
        0.0,
        0.064,
        "iron",
    )
    builder.round_beam_between((0.17, -0.035, 1.22), (0.17, 0.035, 1.22), 0.021, "timber_cut", 7)


def _bucket_pair(builder: MeshBuilder) -> None:
    for x in (-0.42, 0.42):
        builder.cone(0.28, 0.23, 0.52, (x, 0.0, 0.26), "timber_weathered", 10)
        builder.arch_ring(0.48, 0.62, 0.035, 0.035, "iron", 9)


def _hitching_rail(builder: MeshBuilder) -> None:
    for x in (-0.92, 0.92):
        builder.box((0.16, 0.16, 1.35), (x, 0.0, 0.675), "oak_dark")
    builder.box((2.0, 0.16, 0.16), (0.0, 0.0, 1.12), "oak_dark")
    for x in (-0.52, 0.52):
        builder.cylinder(0.045, 0.12, (x, -0.12, 1.08), "iron", 8, "y")


def _torch(builder: MeshBuilder) -> None:
    builder.beam_between((0.0, 0.0, 0.0), (0.0, -0.48, 0.48), 0.06, "iron")
    builder.cone(0.12, 0.07, 0.42, (0.0, -0.48, 0.72), "timber_cut", 8)
    builder.cone(0.18, 0.03, 0.36, (0.0, -0.48, 1.10), "canvas_red", 8)


def _salvage(builder: MeshBuilder) -> None:
    _logs(builder, 2.0)
    builder.box((1.25, 0.92, 0.82), (1.25, 0.35, 0.41), "timber_weathered", (0.0, 0.0, 0.12))
    builder.cylinder(0.42, 0.75, (-1.15, -0.45, 0.42), "iron", 10, "y")
    builder.box((1.45, 0.08, 1.05), (0.42, -0.62, 0.76), "canvas", (0.18, 0.0, 0.24))
