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
        add(registry, f"site_tent_a_frame_{size}", family, f"A-frame work tent {size}", ("site", "camp", "tent", "canvas"), lambda b, s=size: _tent(b, s), triangle_budget=5_200)
    add(registry, "site_campfire_hearth", family, "Stone campfire hearth", ("site", "camp", "fire", "hearth"), _campfire)
    add(registry, "site_camp_cooking_tripod", family, "Camp cooking tripod", ("site", "camp", "fire", "tripod", "cooking"), _camp_tripod)
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


def _tent(builder: MeshBuilder, size: str) -> None:
    # Low, temporary ridge tent rather than a rigid miniature building.  The old
    # version rotated two boxes around their centres, which put each high edge at
    # the ground side and its low edge at the ridge.  Author the cloth explicitly
    # from ridge to eave so the structural contract is unambiguous.
    width, depth, height = (2.55, 3.35, 1.92) if size == "large" else (1.90, 2.45, 1.55)
    frame_depth = depth - 0.20
    for y in (-frame_depth * 0.5, frame_depth * 0.5):
        for side in (-1.0, 1.0):
            builder.beam_between(
                (side * (width * 0.5 - 0.10), y, 0.07),
                (0.0, y, height - 0.08),
                0.075,
                "timber_cut",
            )
    builder.beam_between(
        (0.0, -depth * 0.5 - 0.22, height - 0.08),
        (0.0, depth * 0.5 + 0.22, height - 0.08),
        0.075,
        "timber_cut",
    )
    _a_frame_canvas_side(builder, width, depth, height, -1.0)
    _a_frame_canvas_side(builder, width, depth, height, 1.0)
    _a_frame_canvas_rear(builder, width, depth, height)
    # Guy ropes, hand-cut pegs, and restrained panel seams keep the shelter
    # temporary and field-made instead of reading as a miniature rigid roof.
    for y in (-depth * 0.5, depth * 0.5):
        direction = -1.0 if y < 0.0 else 1.0
        builder.beam_between((0.0, y, height - 0.06), (0.0, y + direction * 0.72, 0.10), 0.018, "rope")
        builder.cylinder(0.034, 0.34, (0.0, y + direction * 0.72, 0.14), "timber_cut", 6, "z")
        for side in (-1.0, 1.0):
            x = side * width * 0.5
            stake_x = side * (width * 0.5 + 0.46)
            builder.beam_between((x, y, 0.18), (stake_x, y + direction * 0.12, 0.09), 0.016, "rope")
            builder.cylinder(0.030, 0.30, (stake_x, y + direction * 0.12, 0.13), "timber_cut", 6, "z")
    # The near end stays open so the shelter reads as a usable sleeping tent;
    # the far triangular panel closes the weather side.


def _a_frame_canvas_side(
    builder: MeshBuilder,
    width: float,
    depth: float,
    height: float,
    side: float,
) -> None:
    """Append one closed, gently slack ridge-to-ground canvas panel."""

    slope_steps = 4
    run_steps = 7
    thickness = 0.024
    pitch = math.atan2(height - 0.08, width * 0.5)
    outward = (side * math.sin(pitch), 0.0, math.cos(pitch))
    layers: list[list[tuple[float, float, float]]] = [[], []]
    for layer_index, direction in enumerate((1.0, -1.0)):
        for run_index in range(run_steps + 1):
            run_ratio = run_index / run_steps
            y = -depth * 0.5 + depth * run_ratio
            for slope_index in range(slope_steps + 1):
                slope_ratio = slope_index / slope_steps
                x = side * width * 0.5 * slope_ratio
                edge_z = 0.075 + 0.018 * math.sin(run_ratio * math.tau + side * 0.7)
                z = height * (1.0 - slope_ratio) + edge_z * slope_ratio
                # Fabric hangs slightly between ridge and ground pegs.  Keep the
                # ridge and eave fixed, and vary the two sides independently.
                slack = -0.045 * math.sin(math.pi * slope_ratio)
                slack *= 0.72 + 0.28 * math.sin(run_ratio * math.pi + side * 0.55) ** 2
                z += slack
                # Both panels meet at one ridge line; thickness fans outward only
                # after leaving the ridge so no bright slot appears along the top.
                fan = math.sin(slope_ratio * math.pi * 0.5)
                offset = direction * thickness * 0.5
                layers[layer_index].append(
                    (
                        x + outward[0] * offset * fan,
                        y,
                        z + outward[2] * offset,
                    )
                )

    vertices = layers[0] + layers[1]
    stride = slope_steps + 1
    layer_size = stride * (run_steps + 1)
    faces: list[tuple[int, ...]] = []
    for run_index in range(run_steps):
        for slope_index in range(slope_steps):
            a = run_index * stride + slope_index
            b = a + 1
            c = a + stride + 1
            d = a + stride
            outer = (a, b, c, d) if side > 0.0 else (a, d, c, b)
            faces.append(outer)
            faces.append(tuple(layer_size + index for index in reversed(outer)))

    # Close all four cloth edges, including the ridge fold and raw ground hem.
    perimeter: list[tuple[int, int]] = []
    for slope_index in range(slope_steps):
        perimeter.append((slope_index, slope_index + 1))
        rear = run_steps * stride + slope_index
        perimeter.append((rear + 1, rear))
    for run_index in range(run_steps):
        ridge = run_index * stride
        perimeter.append((ridge + stride, ridge))
        eave = run_index * stride + slope_steps
        perimeter.append((eave, eave + stride))
    for start, end in perimeter:
        faces.append((start, end, layer_size + end, layer_size + start))
    builder._append(vertices, faces, "canvas")


def _a_frame_canvas_rear(builder: MeshBuilder, width: float, depth: float, height: float) -> None:
    """Close the weather end with a thin triangular canvas panel."""

    inset = 0.055
    half_width = width * 0.5 - inset
    y_outer = depth * 0.5 + 0.002
    y_inner = y_outer - 0.024
    vertices = [
        (-half_width, y_outer, 0.09),
        (half_width, y_outer, 0.09),
        (0.0, y_outer, height - 0.035),
        (-half_width, y_inner, 0.09),
        (half_width, y_inner, 0.09),
        (0.0, y_inner, height - 0.035),
    ]
    faces = [
        (0, 1, 2),
        (5, 4, 3),
        (0, 3, 4, 1),
        (1, 4, 5, 2),
        (2, 5, 3, 0),
    ]
    builder._append(vertices, faces, "canvas")


def _campfire(builder: MeshBuilder) -> None:
    for index in range(10):
        angle = math.tau * index / 10
        builder.box((0.36, 0.26, 0.20), (0.62 * math.cos(angle), 0.62 * math.sin(angle), 0.10), "fieldstone", (0.0, 0.0, angle))
    builder.cylinder(0.42, 0.08, (0.0, 0.0, 0.04), "charcoal", 12, "z")


def _camp_tripod(builder: MeshBuilder) -> None:
    apex = (0.0, 0.0, 2.05)
    for angle in (-math.pi * 0.5, math.pi * 0.17, math.pi * 0.83):
        foot = (0.82 * math.cos(angle), 0.82 * math.sin(angle), 0.02)
        builder.beam_between(foot, apex, 0.085, "timber_cut")
    builder.cylinder(0.025, 1.18, (0.0, 0.0, 1.40), "iron", 6, "z")
    builder.beam_between((0.0, 0.0, 0.82), (0.18, 0.0, 0.70), 0.025, "iron")


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
