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
    add(
        registry,
        "prop_water_bucket_pair",
        family,
        "Open stave bucket pair",
        ("prop", "water", "bucket", "service", "open-container"),
        _bucket_pair,
        allow_nonmanifold=True,
    )
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


def _extruded_xz_profile(
    builder: MeshBuilder,
    profile: list[tuple[float, float]],
    y: float,
    thickness: float,
    material: str,
) -> None:
    """Extrude an X/Z silhouette through Y for thin hanging or blade forms."""

    front = [(x, y - thickness * 0.5, z) for x, z in profile]
    back = [(x, y + thickness * 0.5, z) for x, z in profile]
    vertices = front + back
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
        [(-0.10, -0.16), (0.32, -0.19), (0.43, -0.11), (0.39, 0.075), (-0.035, 0.065), (-0.10, 0.005)],
        1.040,
        0.030,
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
    # A field-made A-frame reads more credibly than two perfectly vertical posts.
    # The rack deliberately ships empty: catch meshes are runtime-owned assets
    # and must not be approximated with timber- or leather-like placeholders.
    for side in (-1.0, 1.0):
        builder.round_beam_between((side * 1.07, 0.18, 0.0), (side * 0.91, 0.01, 1.93), 0.075, "oak_dark", 8, 0.062)
        builder.round_beam_between((side * 1.07, -0.18, 0.0), (side * 0.91, 0.01, 1.93), 0.070, "timber_weathered", 8, 0.058)
    builder.round_beam_between((-1.02, 0.0, 1.91), (1.04, 0.0, 1.95), 0.068, "oak_dark", 8, 0.060)
    builder.round_beam_between((-0.93, 0.02, 0.70), (0.93, 0.0, 0.64), 0.046, "timber_weathered", 7, 0.039)


def _boat(builder: MeshBuilder) -> None:
    # Hollow, double-ended river dugout. The continuous outer and inner skins,
    # capped gunwales and end returns make a watertight solid while preserving a
    # real open interior when the craft is pulled ashore or leaned on a fence.
    stations = (
        (-2.20, 0.12, 0.45, 0.78),
        (-1.65, 0.52, 0.18, 0.70),
        (-0.82, 0.76, 0.08, 0.64),
        (0.00, 0.84, 0.055, 0.62),
        (0.82, 0.76, 0.08, 0.64),
        (1.65, 0.52, 0.18, 0.70),
        (2.20, 0.12, 0.45, 0.78),
    )
    outer: list[list[tuple[float, float, float]]] = []
    inner: list[list[tuple[float, float, float]]] = []
    for x, half_width, keel_z, gunwale_z in stations:
        outer.append([
            (x, -half_width, gunwale_z),
            (x, -half_width * 0.72, keel_z + 0.13),
            (x, 0.0, keel_z),
            (x, half_width * 0.72, keel_z + 0.13),
            (x, half_width, gunwale_z),
        ])
        inner_width = max(0.035, half_width - 0.095)
        inner_floor = min(gunwale_z - 0.08, keel_z + 0.19)
        inner.append([
            (x, -inner_width, gunwale_z - 0.055),
            (x, -inner_width * 0.66, inner_floor + 0.035),
            (x, 0.0, inner_floor),
            (x, inner_width * 0.66, inner_floor + 0.035),
            (x, inner_width, gunwale_z - 0.055),
        ])

    vertices = [point for ring in outer for point in ring] + [point for ring in inner for point in ring]
    outer_offset = 0
    inner_offset = len(outer) * 5
    faces: list[tuple[int, ...]] = []
    for station in range(len(stations) - 1):
        for band in range(4):
            a = outer_offset + station * 5 + band
            b = outer_offset + (station + 1) * 5 + band
            faces.append((a, a + 1, b + 1, b))
            ia = inner_offset + station * 5 + band
            ib = inner_offset + (station + 1) * 5 + band
            faces.append((ia, ib, ib + 1, ia + 1))
        # Port and starboard gunwale thickness close the two skins.
        for edge in (0, 4):
            outer_a = outer_offset + station * 5 + edge
            outer_b = outer_offset + (station + 1) * 5 + edge
            inner_a = inner_offset + station * 5 + edge
            inner_b = inner_offset + (station + 1) * 5 + edge
            faces.append((outer_a, outer_b, inner_b, inner_a))
    # Close bow and stern between matching outer/inner cross-sections.
    for station in (0, len(stations) - 1):
        for band in range(4):
            outer_a = outer_offset + station * 5 + band
            outer_b = outer_a + 1
            inner_a = inner_offset + station * 5 + band
            inner_b = inner_a + 1
            order = (outer_a, inner_a, inner_b, outer_b) if station == 0 else (outer_a, outer_b, inner_b, inner_a)
            faces.append(order)
    builder._append(vertices, faces, "timber_weathered")

    # Dark gunwales, a low keel, internal ribs and broad removable thwarts explain
    # how the small craft holds its form. All pieces follow the hull's station curve.
    for side in (-1.0, 1.0):
        for start, end in zip(stations, stations[1:]):
            builder.round_beam_between(
                (start[0], side * start[1], start[3] + 0.012),
                (end[0], side * end[1], end[3] + 0.012),
                0.038,
                "oak_dark",
                7,
                0.032,
            )
    builder.round_beam_between((-1.76, 0.0, 0.15), (1.76, 0.0, 0.07), 0.045, "oak_dark", 7, 0.036)
    for x, half_width, keel_z, gunwale_z in stations[1:-1]:
        rib_z = keel_z + 0.16
        builder.round_beam_between((x, -half_width * 0.82, gunwale_z - 0.07), (x, 0.0, rib_z), 0.026, "timber_cut", 6, 0.021)
        builder.round_beam_between((x, 0.0, rib_z), (x, half_width * 0.82, gunwale_z - 0.07), 0.026, "timber_cut", 6, 0.021)
    for x, half_width, z in ((-0.82, 0.70, 0.58), (0.0, 0.77, 0.56), (0.82, 0.70, 0.58)):
        builder.box((0.16, half_width * 1.62, 0.085), (x, 0.0, z), "oak_dark", (0.0, 0.0, 0.012 * x))
    # One serviceable paddle is stowed diagonally; the blade and shaft visibly meet.
    builder.round_beam_between((-1.24, -0.33, 0.67), (1.28, 0.37, 0.70), 0.028, "timber_cut", 8, 0.022)
    _extruded_xy_profile(
        builder,
        [(1.17, 0.30), (1.65, 0.43), (1.94, 0.39), (1.98, 0.26), (1.67, 0.18)],
        0.70,
        0.045,
        "timber_cut",
    )


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
    faces: list[tuple[int, ...]] = [
        tuple(range(segments - 1, -1, -1)),
        tuple(range(segments, segments * 2)),
    ]
    for index in range(segments):
        following = (index + 1) % segments
        faces.append((index, following, segments + following, segments + index))
    builder._append(vertices, faces, "timber_weathered")


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
