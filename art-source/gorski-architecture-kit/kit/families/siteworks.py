from __future__ import annotations

import math

from .. import spec
from ..core import MeshBuilder, Registry
from .common import add


def register(registry: Registry) -> None:
    family = "siteworks"
    for width, depth in ((2.0, 2.0), (4.0, 2.0), (4.0, 4.0), (6.0, 3.0)):
        wtoken = spec.width_token(width)
        dtoken = spec.width_token(depth)
        add(
            registry, f"site_canopy_timber_{wtoken}_d{dtoken}", family,
            f"Timber work canopy {width:g} x {depth:g} m",
            ("site", "canopy", "open-worksite", "timber"),
            lambda b, w=width, d=depth: _canopy(b, w, d, "shingles"),
            seams=("z=0",),
            triangle_budget=6_400,
        )
        add(
            registry, f"site_canopy_canvas_{wtoken}_d{dtoken}", family,
            f"Canvas work canopy {width:g} x {depth:g} m",
            ("site", "canopy", "open-worksite", "canvas"),
            lambda b, w=width, d=depth: _canopy(b, w, d, "canvas"),
            seams=("z=0",),
            triangle_budget=6_400,
        )

    for length in (1.0, 2.0, 4.0, 6.0):
        token = spec.width_token(length)
        add(registry, f"site_walkway_plank_{token}", family, f"Plank walkway {length:g} m", ("site", "walkway", "plank", "mud"), lambda b, l=length: _walkway(b, l), seams=(f"x=-{length/2:g}", f"x=+{length/2:g}", "z=0"))
        add(registry, f"site_bridge_deck_{token}", family, f"Timber bridge deck {length:g} m", ("site", "bridge", "deck", "road"), lambda b, l=length: _bridge_deck(b, l), seams=(f"x=-{length/2:g}", f"x=+{length/2:g}"), triangle_budget=5_200)
        add(registry, f"site_bridge_railing_{token}", family, f"Timber bridge railing {length:g} m", ("site", "bridge", "railing", "road"), lambda b, l=length: _bridge_railing(b, l), seams=(f"x=-{length/2:g}", f"x=+{length/2:g}"), triangle_budget=4_400)
        add(registry, f"site_dock_segment_{token}", family, f"Riverside dock segment {length:g} m", ("site", "dock", "river", "fishing"), lambda b, l=length: _dock(b, l), seams=(f"x=-{length/2:g}", f"x=+{length/2:g}", "z=0"), triangle_budget=5_000)

    for style in ("shingle", "tile"):
        add(registry, f"site_well_shelter_{style}", family, f"Well shelter roof {style}", ("site", "well", "shelter", style), lambda b, s=style: _well_shelter(b, s), triangle_budget=5_000)
    for radius in (0.75, 1.0, 1.25):
        token = spec.width_token(radius)
        add(registry, f"site_well_curb_r{token}", family, f"Stone well curb radius {radius:g} m", ("site", "well", "curb", "water"), lambda b, r=radius: _well_curb(b, r), allow_nonmanifold=True, triangle_budget=5_400)

    for style in ("shingle", "canvas", "tile"):
        add(registry, f"site_market_stall_{style}", family, f"Market stall {style}", ("site", "market", "stall", style), lambda b, s=style: _market_stall(b, s), triangle_budget=5_200)

    for size in ("small", "large"):
        add(
            registry,
            f"site_tent_a_frame_{size}",
            family,
            f"Sewn A-frame work tent {size}",
            ("site", "camp", "tent", "canvas", "sewn", "guyed"),
            lambda b, s=size: _tent(b, s),
            triangle_budget=7_800,
            bevel=0.004,
        )
    add(
        registry,
        "site_hunter_hide_fly_4m_d2m",
        family,
        "Stitched-hide hunter processing fly 4 x 2 m",
        ("site", "camp", "hunter", "processing", "hide", "leather", "lashed-poles"),
        lambda b: _hunter_hide_fly(b, 4.0, 2.2),
        seams=("z=0",),
        triangle_budget=8_400,
        bevel=0.004,
    )
    add(registry, "site_campfire_hearth", family, "Stone campfire hearth", ("site", "camp", "fire", "hearth"), _campfire)
    add(registry, "site_camp_cooking_tripod", family, "Camp cooking tripod", ("site", "camp", "fire", "tripod", "cooking"), _camp_tripod)
    add(
        registry,
        "site_hunter_boundary_rail_2m",
        family,
        "Low crooked hunter-camp boundary rail 2 m",
        ("site", "camp", "hunter", "boundary", "crooked-sapling", "open"),
        _hunter_boundary_rail,
        seams=("x=-1", "x=+1", "z=0"),
        triangle_budget=2_800,
    )
    add(registry, "site_grave_marker_cross", family, "Timber grave cross", ("site", "graveyard", "marker", "sacred"), _grave_cross)
    add(registry, "site_grave_marker_slab", family, "Limestone grave slab", ("site", "graveyard", "marker", "sacred"), _grave_slab)
    add(registry, "site_road_culvert_stone_2m", family, "Stone road culvert 2 m", ("site", "road", "culvert", "drainage"), _culvert, allow_nonmanifold=True, triangle_budget=6_200)


def _canopy(builder: MeshBuilder, width: float, depth: float, material: str) -> None:
    if material == "canvas":
        # A hunter's processing fly is a low temporary pole shelter, not a
        # rectilinear market pavilion.  Hand-cut poles lean slightly inward and
        # the carrying rails follow those imperfect tops.
        height = 2.16
        pole_bottoms = (
            (-width * 0.5 + 0.08, -depth * 0.5 + 0.08, 0.02),
            (width * 0.5 - 0.08, -depth * 0.5 + 0.08, 0.02),
            (-width * 0.5 + 0.08, depth * 0.5 - 0.08, 0.02),
            (width * 0.5 - 0.08, depth * 0.5 - 0.08, 0.02),
        )
        pole_tops = (
            (-width * 0.5 + 0.16, -depth * 0.5 + 0.13, height - 0.03),
            (width * 0.5 - 0.13, -depth * 0.5 + 0.10, height + 0.01),
            (-width * 0.5 + 0.13, depth * 0.5 - 0.11, height + 0.02),
            (width * 0.5 - 0.17, depth * 0.5 - 0.14, height - 0.04),
        )
        for bottom, top in zip(pole_bottoms, pole_tops):
            builder.beam_between(bottom, top, 0.115, "timber_weathered")
        builder.beam_between(pole_tops[0], pole_tops[1], 0.105, "timber_weathered")
        builder.beam_between(pole_tops[2], pole_tops[3], 0.105, "timber_weathered")
        _sagging_canvas_canopy(builder, width + 0.30, depth + 0.32, height + 0.08)
        return

    height = 2.45
    for x in (-width * 0.5 + 0.12, width * 0.5 - 0.12):
        for y in (-depth * 0.5 + 0.12, depth * 0.5 - 0.12):
            builder.box((0.18, 0.18, height), (x, y, height * 0.5), "oak_dark")
    builder.beam_between((-width * 0.5, -depth * 0.5, height), (width * 0.5, -depth * 0.5, height), 0.18, "oak_dark")
    builder.beam_between((-width * 0.5, depth * 0.5, height), (width * 0.5, depth * 0.5, height), 0.18, "oak_dark")
    builder.box((width + 0.32, depth + 0.34, 0.10), (0.0, 0.0, height + 0.15), material, (0.04, 0.0, 0.0))


def _sagging_canvas_canopy(builder: MeshBuilder, width: float, depth: float, top_z: float) -> None:
    """Closed, gently asymmetric canvas skin held high at its four pole corners."""

    x_steps, y_steps = 6, 4
    thickness = 0.035
    vertices = []
    for lower in (False, True):
        for y_index in range(y_steps + 1):
            y_ratio = y_index / y_steps
            y = -depth * 0.5 + depth * y_ratio
            for x_index in range(x_steps + 1):
                x_ratio = x_index / x_steps
                x = -width * 0.5 + width * x_ratio
                # The fabric overhangs its carrying beams. Treat the beam lines,
                # not the raw cloth perimeter, as fixed supports so the sagging
                # middle never lets timber visibly pierce the canvas skin.
                support_half_x = max(0.1, (width - 0.32) * 0.5)
                support_half_y = max(0.1, (depth - 0.34) * 0.5)
                edge_x = min(1.0, abs(x) / support_half_x)
                edge_y = min(1.0, abs(y) / support_half_y)
                support = max(edge_x ** 3.2, edge_y ** 3.2)
                sag = 0.23 * (1.0 - support)
                skew = (
                    0.040 * math.sin(x_ratio * math.pi * 1.7 + y_ratio * 2.2)
                    + 0.018 * (x_ratio - 0.5)
                    - 0.024 * (y_ratio - 0.5)
                )
                z = top_z - sag + skew - (thickness if lower else 0.0)
                vertices.append((x, y, z))

    stride = x_steps + 1
    layer_size = stride * (y_steps + 1)
    faces = []
    for y_index in range(y_steps):
        for x_index in range(x_steps):
            a = y_index * stride + x_index
            b = a + 1
            c = a + stride + 1
            d = a + stride
            faces.append((a, b, c, d))
            faces.append((layer_size + d, layer_size + c, layer_size + b, layer_size + a))
    for x_index in range(x_steps):
        a, b = x_index, x_index + 1
        faces.append((b, a, layer_size + a, layer_size + b))
        a = y_steps * stride + x_index
        b = a + 1
        faces.append((a, b, layer_size + b, layer_size + a))
    for y_index in range(y_steps):
        a = y_index * stride
        b = a + stride
        faces.append((a, b, layer_size + b, layer_size + a))
        a = y_index * stride + x_steps
        b = a + stride
        faces.append((b, a, layer_size + a, layer_size + b))
    builder._append(vertices, faces, "canvas")


def _walkway(builder: MeshBuilder, length: float) -> None:
    count = max(2, round(length / 0.42))
    for index in range(count):
        x = -length * 0.5 + length * (index + 0.5) / count
        builder.box((length / count - 0.025, 1.10, 0.10), (x, 0.0, 0.05), "timber_weathered", (0.0, builder.random.uniform(-0.018, 0.018), builder.random.uniform(-0.012, 0.012)))
    for y in (-0.42, 0.42):
        builder.box((length, 0.10, 0.10), (0.0, y, -0.02), "oak_dark")


def _bridge_deck(builder: MeshBuilder, length: float) -> None:
    _walkway(builder, length)
    for x in (-length * 0.5 + 0.14, length * 0.5 - 0.14):
        for y in (-0.47, 0.47):
            builder.box((0.18, 0.18, 1.35), (x, y, -0.52), "oak_dark")


def _bridge_railing(builder: MeshBuilder, length: float) -> None:
    for x in (-length * 0.5, 0.0, length * 0.5):
        builder.box((0.12, 0.12, 1.05), (x, 0.0, 0.525), "oak_dark")
    builder.box((length, 0.12, 0.12), (0.0, 0.0, 1.0), "oak_dark")
    builder.beam_between((-length * 0.5, 0.0, 0.22), (length * 0.5, 0.0, 0.82), 0.08, "timber_weathered")


def _dock(builder: MeshBuilder, length: float) -> None:
    width = 1.65
    count = max(3, round(length / 0.34))
    for index in range(count):
        x = -length * 0.5 + length * (index + 0.5) / count
        builder.box((length / count - 0.02, width, 0.12), (x, 0.0, 0.30), "timber_weathered")
    for x in (-length * 0.42, length * 0.42):
        for y in (-width * 0.42, width * 0.42):
            builder.cone(0.12, 0.08, 1.65, (x, y, -0.28), "oak_dark", 7)


def _well_curb(builder: MeshBuilder, radius: float) -> None:
    segments = max(12, round(radius * 16))
    for index in range(segments):
        angle = math.tau * index / segments
        x = radius * math.cos(angle)
        y = radius * math.sin(angle)
        builder.box((0.38, 0.32, 0.34), (x, y, 0.17), "limestone_warm", (0.0, 0.0, angle + math.pi * 0.5))
    builder.cylinder(radius * 0.72, 0.035, (0.0, 0.0, 0.22), "water", segments, "z")


def _well_shelter(builder: MeshBuilder, style: str) -> None:
    height = 2.45
    for x in (-0.85, 0.85):
        builder.box((0.18, 0.18, height), (x, 0.0, height * 0.5), "oak_dark")
    builder.cylinder(0.12, 1.72, (0.0, 0.0, 1.55), "timber_cut", 8, "x")
    builder.cylinder(0.18, 0.24, (0.0, -0.02, 1.55), "oak_dark", 8, "x")
    builder.box((2.30, 1.75, 0.10), (0.0, 0.0, height + 0.25), "shingles" if style == "shingle" else "terracotta", (0.06, 0.0, 0.0))


def _market_stall(builder: MeshBuilder, style: str) -> None:
    _canopy(builder, 2.6, 1.8, "canvas" if style == "canvas" else ("shingles" if style == "shingle" else "terracotta"))
    builder.box((2.25, 0.82, 0.10), (0.0, 0.12, 0.92), "timber_cut")
    for x in (-0.95, 0.95):
        builder.box((0.12, 0.12, 0.90), (x, 0.12, 0.45), "oak_dark")


def _append_closed_grid_shell(
    builder: MeshBuilder,
    grid: list[list[tuple[float, float, float]]],
    thickness: float,
    material: str,
) -> None:
    """Append a thin closed sheet from a rectangular surface grid."""

    rows = len(grid)
    columns = len(grid[0])
    outer = [point for row in grid for point in row]
    inner = [(x, y, z - thickness) for x, y, z in outer]
    vertices = outer + inner
    layer_size = len(outer)
    faces: list[tuple[int, ...]] = []
    for row in range(rows - 1):
        for column in range(columns - 1):
            a = row * columns + column
            b = a + 1
            c = a + columns + 1
            d = a + columns
            faces.append((a, b, c, d))
            faces.append((layer_size + d, layer_size + c, layer_size + b, layer_size + a))
    perimeter: list[tuple[int, int]] = []
    for column in range(columns - 1):
        perimeter.append((column + 1, column))
        rear = (rows - 1) * columns + column
        perimeter.append((rear, rear + 1))
    for row in range(rows - 1):
        left = row * columns
        right = left + columns - 1
        perimeter.append((left, left + columns))
        perimeter.append((right + columns, right))
    for start, end in perimeter:
        faces.append((start, end, layer_size + end, layer_size + start))
    builder._append(vertices, faces, material)


def _append_thin_polygon(
    builder: MeshBuilder,
    points: list[tuple[float, float, float]],
    thickness: float,
    material: str,
) -> None:
    """Append one closed thin polygon whose thickness follows local Y."""

    outer = [(x, y - thickness * 0.5, z) for x, y, z in points]
    inner = [(x, y + thickness * 0.5, z) for x, y, z in points]
    vertices = outer + inner
    count = len(points)
    faces: list[tuple[int, ...]] = [tuple(range(count)), tuple(range(count * 2 - 1, count - 1, -1))]
    for index in range(count):
        following = (index + 1) % count
        faces.append((index, following, count + following, count + index))
    builder._append(vertices, faces, material)


def _tent_cloth_point(
    width: float,
    depth: float,
    height: float,
    cross_ratio: float,
    run_ratio: float,
) -> tuple[float, float, float]:
    half_width = width * 0.5
    x = -half_width + width * cross_ratio
    ridge_weight = 1.0 - abs(x) / half_width
    hem = 0.065 + 0.034 * math.sin(run_ratio * math.tau * 1.35 + (0.4 if x > 0.0 else -0.7))
    z = hem + (height - hem) * ridge_weight
    z -= 0.082 * math.sin(math.pi * ridge_weight) * (0.70 + 0.30 * math.sin(run_ratio * math.pi) ** 2)
    z -= 0.062 * math.sin(run_ratio * math.pi) ** 2 * ridge_weight ** 3
    z += 0.023 * math.sin(run_ratio * math.tau * 2.0 + cross_ratio * 5.3) * math.sin(math.pi * ridge_weight)
    x += 0.048 * math.sin(run_ratio * math.tau + cross_ratio * 2.4) * math.sin(math.pi * ridge_weight)
    y = -depth * 0.5 + depth * run_ratio
    y += 0.030 * math.sin(cross_ratio * math.tau * 1.6 + run_ratio * 3.1) * math.sin(run_ratio * math.pi)
    return (x, y, z)


def _tent(builder: MeshBuilder, size: str) -> None:
    width, depth, height = (2.58, 3.42, 1.84) if size == "large" else (1.92, 2.50, 1.48)
    half_width = width * 0.5
    frame_depth = depth - 0.18

    # Two round sapling A-frames and a concealed ridge pole carry one continuous
    # sewn canvas sheet. Segmenting the poles introduces restrained hand-cut bend.
    for y_index, y in enumerate((-frame_depth * 0.5, frame_depth * 0.5)):
        for side in (-1.0, 1.0):
            foot = (side * (half_width - 0.08), y, 0.035)
            middle = (side * (half_width * 0.47 + 0.025 * y_index), y + side * 0.012, height * 0.52)
            apex = (side * 0.018, y, height - 0.075)
            builder.round_beam_between(foot, middle, 0.046, "timber_weathered", 7, 0.043)
            builder.round_beam_between(middle, apex, 0.043, "timber_weathered", 7, 0.038)
    builder.round_beam_between(
        (0.0, -depth * 0.5 - 0.17, height - 0.075),
        (0.0, depth * 0.5 + 0.17, height - 0.075),
        0.038,
        "timber_weathered",
        8,
        0.034,
    )

    cross_steps, run_steps = 12, 10
    grid = [
        [
            _tent_cloth_point(width, depth, height, cross / cross_steps, run / run_steps)
            for cross in range(cross_steps + 1)
        ]
        for run in range(run_steps + 1)
    ]
    _append_closed_grid_shell(builder, grid, 0.008, "canvas")

    # Raised sewn joins, a folded ridge binding, and weighted long hems keep the
    # atlas weave readable in silhouette instead of leaving two perfect planes.
    for seam_ratio in (0.34, 0.68):
        previous = _tent_cloth_point(width, depth, height, 0.0, seam_ratio)
        for cross in range(1, cross_steps + 1):
            current = _tent_cloth_point(width, depth, height, cross / cross_steps, seam_ratio)
            builder.round_beam_between(
                (previous[0], previous[1] - 0.004, previous[2] + 0.006),
                (current[0], current[1] - 0.004, current[2] + 0.006),
                0.009,
                "canvas",
                5,
            )
            previous = current
    for cross_ratio in (0.0, 0.5, 1.0):
        previous = _tent_cloth_point(width, depth, height, cross_ratio, 0.0)
        for run in range(1, run_steps + 1):
            current = _tent_cloth_point(width, depth, height, cross_ratio, run / run_steps)
            builder.round_beam_between(
                (previous[0], previous[1], previous[2] + 0.006),
                (current[0], current[1], current[2] + 0.006),
                0.012 if cross_ratio == 0.5 else 0.015,
                "canvas",
                5,
            )
            previous = current

    # Rear weather panel and two asymmetrical entrance flaps. The right flap is
    # tied back into a visible roll, avoiding the old featureless black triangle.
    rear_y = depth * 0.5 - 0.008
    _append_thin_polygon(
        builder,
        [(-half_width + 0.05, rear_y, 0.075), (half_width - 0.05, rear_y, 0.075), (0.0, rear_y, height - 0.055)],
        0.008,
        "canvas",
    )
    front_y = -depth * 0.5 + 0.006
    _append_thin_polygon(
        builder,
        [(-half_width + 0.04, front_y, 0.075), (-0.47, front_y - 0.022, 0.12), (-0.02, front_y, height - 0.065)],
        0.008,
        "canvas",
    )
    _append_thin_polygon(
        builder,
        [(0.48, front_y - 0.006, 0.10), (half_width - 0.04, front_y, 0.075), (0.09, front_y, height - 0.11)],
        0.008,
        "canvas",
    )
    builder.round_beam_between(
        (0.47, front_y - 0.018, 0.12),
        (0.10, front_y - 0.018, height - 0.12),
        0.032,
        "canvas",
        6,
        0.024,
    )
    builder.round_beam_between(
        (-0.47, front_y - 0.028, 0.12),
        (-0.10, front_y - 0.022, height - 0.12),
        0.028,
        "canvas",
        6,
        0.022,
    )
    builder.round_beam_between((0.28, front_y - 0.05, 0.74), (0.48, front_y - 0.22, 0.72), 0.012, "rope", 5)
    builder.round_beam_between((-0.28, front_y - 0.05, 0.76), (-0.49, front_y - 0.21, 0.69), 0.011, "rope", 5)

    # Tension is concentrated at ridge and hem corners. Pegs lean away from the
    # shelter and all cordage is round rather than square structural timber.
    for y in (-depth * 0.5, depth * 0.5):
        direction = -1.0 if y < 0.0 else 1.0
        ridge_stake = (0.04, y + direction * 0.78, 0.035)
        builder.round_beam_between((0.0, y, height - 0.065), ridge_stake, 0.010, "rope", 5)
        builder.round_beam_between(
            (ridge_stake[0] - 0.03, ridge_stake[1] - direction * 0.08, 0.0),
            (ridge_stake[0] + 0.02, ridge_stake[1] + direction * 0.13, 0.30),
            0.026,
            "timber_cut",
            6,
            0.020,
        )
        for side in (-1.0, 1.0):
            hem = _tent_cloth_point(width, depth, height, 0.0 if side < 0.0 else 1.0, 0.0 if y < 0.0 else 1.0)
            stake = (side * (half_width + 0.44), y + direction * 0.13, 0.035)
            builder.round_beam_between((hem[0], hem[1], hem[2] + 0.035), stake, 0.009, "rope", 5)
            builder.round_beam_between(
                (stake[0] - side * 0.04, stake[1] - direction * 0.06, 0.0),
                (stake[0] + side * 0.03, stake[1] + direction * 0.10, 0.27),
                0.024,
                "timber_cut",
                6,
                0.019,
            )


def _hide_fly_point(
    width: float,
    depth: float,
    x_ratio: float,
    y_ratio: float,
) -> tuple[float, float, float]:
    half_width = (width + 0.34) * 0.5
    half_depth = (depth + 0.34) * 0.5
    x = -half_width + half_width * 2.0 * x_ratio
    y = -half_depth + half_depth * 2.0 * y_ratio
    corner_z = (
        1.91 * (1.0 - x_ratio) * (1.0 - y_ratio)
        + 1.98 * x_ratio * (1.0 - y_ratio)
        + 1.86 * (1.0 - x_ratio) * y_ratio
        + 1.93 * x_ratio * y_ratio
    )
    support = math.sin(math.pi * x_ratio) * math.sin(math.pi * y_ratio)
    z = corner_z - 0.25 * support
    z += 0.025 * math.sin(x_ratio * math.tau * 2.1 + y_ratio * 3.7) * support
    if x_ratio in (0.0, 1.0):
        x += 0.035 * math.sin(y_ratio * math.tau * 1.7 + x_ratio)
    if y_ratio in (0.0, 1.0):
        y += 0.028 * math.sin(x_ratio * math.tau * 2.3 + y_ratio)
    return (x, y, z)


def _hunter_hide_fly(builder: MeshBuilder, width: float, depth: float) -> None:
    x_steps, y_steps = 10, 6
    grid = [
        [
            _hide_fly_point(width, depth, x / x_steps, y / y_steps)
            for x in range(x_steps + 1)
        ]
        for y in range(y_steps + 1)
    ]
    _append_closed_grid_shell(builder, grid, 0.012, "leather")

    # Four crooked poles terminate below the skin at its actual tension points.
    # The carrying rails are deliberately lower again, so no timber can poke
    # through the sagging central hide sheet from any camera angle.
    supports: list[tuple[tuple[float, float, float], tuple[float, float, float]]] = []
    for x_ratio, y_ratio in ((0.07, 0.08), (0.93, 0.08), (0.07, 0.92), (0.93, 0.92)):
        cloth = _hide_fly_point(width, depth, x_ratio, y_ratio)
        side = -1.0 if x_ratio < 0.5 else 1.0
        end = -1.0 if y_ratio < 0.5 else 1.0
        top = (cloth[0] - side * 0.025, cloth[1] - end * 0.020, cloth[2] - 0.070)
        bottom = (cloth[0] + side * 0.11, cloth[1] + end * 0.07, 0.015)
        middle = ((bottom[0] + top[0]) * 0.5 + side * 0.025, (bottom[1] + top[1]) * 0.5, top[2] * 0.48)
        builder.round_beam_between(bottom, middle, 0.056, "timber_weathered", 7, 0.050)
        builder.round_beam_between(middle, top, 0.050, "timber_weathered", 7, 0.043)
        supports.append((bottom, top))

    for left_index, right_index in ((0, 1), (2, 3)):
        left = supports[left_index][1]
        right = supports[right_index][1]
        builder.round_beam_between(
            (left[0] + 0.05, left[1], left[2] - 0.075),
            (right[0] - 0.05, right[1], right[2] - 0.075),
            0.046,
            "timber_weathered",
            7,
            0.041,
        )

    # Rolled, weighted hide edges and visible lashings produce the heavy pelt-fly
    # silhouette in the references without adding a harvested animal prop.
    for y_ratio in (0.0, 1.0):
        previous = _hide_fly_point(width, depth, 0.0, y_ratio)
        for x_index in range(1, x_steps + 1):
            current = _hide_fly_point(width, depth, x_index / x_steps, y_ratio)
            builder.round_beam_between(
                (previous[0], previous[1], previous[2] - 0.018),
                (current[0], current[1], current[2] - 0.018),
                0.030,
                "leather",
                6,
            )
            previous = current
    for _, top in supports:
        builder.round_beam_between(
            (top[0] - 0.08, top[1] - 0.025, top[2] - 0.025),
            (top[0] + 0.08, top[1] + 0.025, top[2] - 0.055),
            0.011,
            "rope",
            5,
        )
        builder.round_beam_between(
            (top[0] - 0.075, top[1] + 0.025, top[2] - 0.060),
            (top[0] + 0.075, top[1] - 0.025, top[2] - 0.025),
            0.010,
            "rope",
            5,
        )

    back_left = _hide_fly_point(width, depth, 0.10, 1.0)
    back_mid = _hide_fly_point(width, depth, 0.34, 1.0)
    _append_thin_polygon(
        builder,
        [
            back_left,
            back_mid,
            (back_mid[0] - 0.04, back_mid[1] + 0.035, back_mid[2] - 0.23),
            (back_left[0] + 0.03, back_left[1] + 0.045, back_left[2] - 0.18),
        ],
        0.010,
        "leather",
    )


def _campfire(builder: MeshBuilder) -> None:
    for index in range(10):
        angle = math.tau * index / 10
        radius = 0.22 + 0.025 * math.sin(index * 1.91)
        height = 0.14 + 0.030 * math.sin(index * 2.37 + 0.4)
        builder.cone(
            radius,
            radius * (0.82 + 0.05 * math.cos(index)),
            height,
            (0.61 * math.cos(angle), 0.61 * math.sin(angle), height * 0.5),
            "fieldstone",
            7,
        )
    builder.cylinder(0.42, 0.08, (0.0, 0.0, 0.04), "charcoal", 12, "z")


def _camp_tripod(builder: MeshBuilder) -> None:
    apex = (0.0, 0.0, 1.82)
    for angle in (-math.pi * 0.5, math.pi * 0.17, math.pi * 0.83):
        # The hearth stones extend to roughly 0.83 m radius. Set every foot on
        # the surrounding ground so no leg originates on top of a stone.
        foot = (1.02 * math.cos(angle), 1.02 * math.sin(angle), 0.0)
        middle = (0.42 * math.cos(angle) + 0.018 * math.sin(angle * 2.0), 0.42 * math.sin(angle), 0.92)
        builder.round_beam_between(foot, middle, 0.034, "timber_cut", 7, 0.030)
        builder.round_beam_between(middle, apex, 0.030, "timber_cut", 7, 0.025)
    for angle in (0.0, math.tau / 3.0, math.tau * 2.0 / 3.0):
        builder.round_beam_between(
            (0.055 * math.cos(angle), 0.055 * math.sin(angle), 1.76),
            (0.055 * math.cos(angle + 1.3), 0.055 * math.sin(angle + 1.3), 1.84),
            0.009,
            "rope",
            5,
        )


def _hunter_boundary_rail(builder: MeshBuilder) -> None:
    """A low visual edge marker, not a stock-proof settlement fence."""

    post_tops = ((-1.0, 0.015, 0.73), (0.0, -0.025, 0.67), (1.0, 0.020, 0.76))
    for index, top in enumerate(post_tops):
        bottom = (top[0] + (-0.025 if index == 0 else 0.018 if index == 2 else 0.0), 0.0, 0.0)
        middle = ((bottom[0] + top[0]) * 0.5 + (0.018 if index % 2 else -0.012), top[1] * 0.45, top[2] * 0.48)
        builder.round_beam_between(bottom, middle, 0.038, "timber_weathered", 7, 0.033)
        builder.round_beam_between(middle, top, 0.033, "timber_weathered", 7, 0.027)
    for level, base_z in enumerate((0.27, 0.50)):
        points = [
            (-1.02, -0.012, base_z + 0.020 * math.sin(level + 0.2)),
            (-0.52, 0.018, base_z - 0.018 + 0.012 * level),
            (0.02, -0.020, base_z + 0.015),
            (0.52, 0.010, base_z - 0.012),
            (1.02, -0.014, base_z + 0.018 * math.cos(level + 0.3)),
        ]
        for index in range(len(points) - 1):
            builder.round_beam_between(points[index], points[index + 1], 0.030, "timber_weathered", 7, 0.025)


def _grave_cross(builder: MeshBuilder) -> None:
    builder.box((0.12, 0.12, 1.45), (0.0, 0.0, 0.725), "oak_dark")
    builder.box((0.76, 0.12, 0.12), (0.0, 0.0, 1.04), "oak_dark")


def _grave_slab(builder: MeshBuilder) -> None:
    builder.box((0.72, 1.45, 0.16), (0.0, 0.0, 0.08), "limestone_warm", (0.0, 0.0, 0.025))
    builder.box((0.26, 0.10, 0.035), (0.0, -0.28, 0.18), "fieldstone")


def _culvert(builder: MeshBuilder) -> None:
    for side in (-0.72, 0.72):
        builder.box((0.60, 2.0, 0.90), (side, 0.0, 0.45), "fieldstone")
    builder.arch_ring(1.25, 1.0, 2.0, 0.22, "limestone_warm", 11)
