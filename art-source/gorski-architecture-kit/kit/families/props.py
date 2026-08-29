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
    add(registry, "prop_tool_rack_hunter", family, "Hunter camp utility frame", ("prop", "tools", "hunter", "rack", "empty", "no-inventory"), _hunter_tool_rack, triangle_budget=800)
    add(registry, "prop_camp_worktable", family, "Camp field-dressing worktable", ("prop", "camp", "hunter", "worktable", "processing", "field-cleaver"), _camp_worktable)
    for kind in ("town", "market", "tavern", "chapel", "mine", "mill"):
        add(registry, f"prop_signpost_{kind}", family, f"{kind.title()} signpost", ("prop", "wayfinding", "sign", kind), lambda b, k=kind: _signpost(b, k))

    add(registry, "prop_two_wheel_cart", family, "Two-wheel village cart", ("prop", "transport", "cart", "logistics"), _cart, triangle_budget=6_400)
    add(registry, "prop_sledge", family, "Timber haulage sledge", ("prop", "transport", "sledge", "logging"), _sledge)
    add(registry, "prop_fish_drying_rack", family, "Fishing camp drying rack", ("prop", "fishing", "rack", "food"), _fish_rack)
    add(registry, "prop_boat_dugout", family, "River dugout boat", ("prop", "fishing", "boat", "river"), _boat, triangle_budget=5_800)
    add(registry, "prop_firewood_chopping_block", family, "Empty chopping block", ("prop", "woodcutter", "firewood", "work-surface", "empty"), _chopping_block)
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


def _hunter_tool_rack(builder: MeshBuilder) -> None:
    # A light, deliberately empty field frame. The uprights terminate directly
    # into the crossbar: there are no decorative fork tips, faux lashing sticks,
    # bows, strings, snares, hooks, or other hanging inventory.
    for side in (-1.0, 1.0):
        bottom = (side * 1.03, 0.035 * side, 0.0)
        middle = (side * 1.00, -0.01, 1.06)
        top = (side * (1.025 if side < 0.0 else 1.015), 0.015 * side, 2.09 + 0.04 * side)
        builder.round_beam_between(bottom, middle, 0.052, "timber_weathered", 7, 0.047)
        builder.round_beam_between(middle, top, 0.047, "timber_weathered", 7, 0.038)
    builder.round_beam_between((-1.03, -0.015, 2.05), (1.02, 0.018, 2.13), 0.045, "timber_weathered", 8, 0.039)


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
    # Broad field cleaver: the forged tang overlaps a dark wooden grip, with a
    # compact ferrule and pin making the blade/handle connection unmistakable.
    _extruded_xy_profile(
        builder,
        [(-0.13, -0.13), (0.46, -0.18), (0.64, -0.12), (0.54, 0.025), (-0.04, 0.030), (-0.13, -0.025)],
        1.040,
        0.026,
        "iron",
    )
    builder.box((0.09, 0.13, 0.035), (-0.105, -0.052, 1.040), "iron", (0.0, 0.0, -0.10))
    builder.round_beam_between((-0.08, -0.052, 1.040), (-0.43, 0.015, 1.040), 0.046, "oak_dark", 8, 0.040)
    builder.cylinder(0.010, 0.088, (-0.28, -0.012, 1.042), "iron", 7, "z")


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


def _rough_stump(builder: MeshBuilder, radius_bottom: float, radius_top: float, height: float) -> None:
    """One tapered stump with a flush cut face rather than a cap object."""

    segments = 10
    bottom: list[tuple[float, float, float]] = []
    top: list[tuple[float, float, float]] = []
    for index in range(segments):
        angle = math.tau * index / segments
        bottom_radius = radius_bottom * (1.0 + builder.random.uniform(-0.055, 0.055))
        top_radius = radius_top * (1.0 + builder.random.uniform(-0.045, 0.045))
        bottom.append((bottom_radius * math.cos(angle), bottom_radius * math.sin(angle), 0.0))
        top.append((top_radius * math.cos(angle), top_radius * math.sin(angle), height))
    vertices = bottom + top
    faces: list[tuple[int, ...]] = [tuple(range(segments - 1, -1, -1))]
    for index in range(segments):
        following = (index + 1) % segments
        faces.append((index, following, segments + following, segments + index))
    builder._append(vertices, faces, "timber_weathered")
    builder._append(top, [tuple(range(segments))], "timber_cut")


def _chopping_block(builder: MeshBuilder) -> None:
    _rough_stump(builder, 0.38, 0.335, 0.69)


def _open_bucket(builder: MeshBuilder, x: float) -> None:
    """Tapered stave bucket with a real open mouth and no dark lid/cap mesh."""

    segments = 10
    outer_bottom: list[tuple[float, float, float]] = []
    outer_top: list[tuple[float, float, float]] = []
    inner_top: list[tuple[float, float, float]] = []
    inner_floor: list[tuple[float, float, float]] = []
    for index in range(segments):
        angle = math.tau * index / segments
        outer_bottom.append((x + 0.23 * math.cos(angle), 0.23 * math.sin(angle), 0.0))
        outer_top.append((x + 0.28 * math.cos(angle), 0.28 * math.sin(angle), 0.52))
        inner_top.append((x + 0.225 * math.cos(angle), 0.225 * math.sin(angle), 0.52))
        inner_floor.append((x + 0.19 * math.cos(angle), 0.19 * math.sin(angle), 0.43))

    shell = outer_bottom + outer_top
    shell_faces: list[tuple[int, ...]] = [tuple(range(segments - 1, -1, -1))]
    for index in range(segments):
        following = (index + 1) % segments
        shell_faces.append((index, following, segments + following, segments + index))
    builder._append(shell, shell_faces, "timber_weathered")

    rim = outer_top + inner_top
    rim_faces = [
        (index, (index + 1) % segments, segments + (index + 1) % segments, segments + index)
        for index in range(segments)
    ]
    builder._append(rim, rim_faces, "oak_dark")

    interior = inner_top + inner_floor
    interior_faces: list[tuple[int, ...]] = [tuple(range(segments, segments * 2))]
    for index in range(segments):
        following = (index + 1) % segments
        interior_faces.append((index, segments + index, segments + following, following))
    builder._append(interior, interior_faces, "charcoal")


def _bucket_pair(builder: MeshBuilder) -> None:
    for x in (-0.42, 0.42):
        _open_bucket(builder, x)


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
