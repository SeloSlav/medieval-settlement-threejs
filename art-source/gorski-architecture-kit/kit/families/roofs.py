from __future__ import annotations

import math

from .. import spec
from ..core import MeshBuilder, Registry
from .common import add


def register(registry: Registry) -> None:
    family = "roofs"
    widths = (0.5, 1.0, 2.0, 4.0)
    slope_lengths = (("quarter", 0.60), ("half", 1.20), ("full", 2.40))
    materials = (("shingle", "shingles"), ("tile", "terracotta"), ("thatch", "thatch"))
    for style, material in materials:
        for width in widths:
            for length_name, slope_length in slope_lengths:
                token = spec.width_token(width)
                piece_id = f"roof_{style}_panel_{token}_{length_name}"
                add(
                    registry, piece_id, family,
                    f"{style.title()} roof panel {width:g} m {length_name}",
                    ("roof", style, "panel", length_name, "fraction-authored"),
                    lambda b, w=width, l=slope_length, m=material, s=style: _panel(b, w, l, m, s),
                    seams=(f"x=-{width/2:g}", f"x=+{width/2:g}", "slope-start", "slope-end"),
                    triangle_budget=18_000,
                    bevel=0.004,
                )

        for length in widths:
            token = spec.width_token(length)
            add(
                registry, f"roof_{style}_ridge_{token}", family,
                f"{style.title()} ridge cap {length:g} m",
                ("roof", style, "ridge", "cap"),
                lambda b, l=length, m=material, s=style: _ridge(b, l, m, s),
                seams=(f"x=-{length/2:g}", f"x=+{length/2:g}"),
                triangle_budget=3_600,
                bevel=0.008,
            )

        for length in widths:
            token = spec.width_token(length)
            add(
                registry, f"roof_{style}_eave_edge_{token}", family,
                f"{style.title()} exposed eave edge {length:g} m",
                ("roof", style, "eave", "edge", "junction"),
                lambda b, l=length, s=style: _eave_edge(b, l, s),
                seams=(f"x=-{length/2:g}", f"x=+{length/2:g}"),
                triangle_budget=9_000,
                bevel=0.004,
            )
        add(
            registry, f"roof_{style}_ridge_endcap", family,
            f"{style.title()} ridge end cap",
            ("roof", style, "ridge", "end-cap", "junction"),
            lambda b, s=style: _ridge_endcap(b, s),
            triangle_budget=4_000,
            bevel=0.004,
        )
        add(
            registry, f"roof_{style}_repair_patch_1m", family,
            f"{style.title()} one-metre repair patch",
            ("roof", style, "repair", "weathering", "variant"),
            lambda b, s=style: _repair_patch(b, s),
            triangle_budget=8_000,
            bevel=0.004,
        )

    for length in widths:
        token = spec.width_token(length)
        for role in ("eave", "verge", "valley", "fascia"):
            add(
                registry, f"roof_timber_{role}_{token}", family,
                f"Timber roof {role} {length:g} m",
                ("roof", "timber", role, "junction"),
                lambda b, l=length, r=role: _roof_timber(b, l, r),
                seams=(f"x=-{length/2:g}", f"x=+{length/2:g}"),
                triangle_budget=2_600,
            )

    for width in (1.0, 2.0, 4.0):
        token = spec.width_token(width)
        add(registry, f"roof_dormer_frame_{token}", family, f"Dormer roof frame {width:g} m", ("roof", "dormer", "frame", "junction"), lambda b, w=width: _dormer_frame(b, w), triangle_budget=4_800)
    add(registry, "roof_snow_catch_2m", family, "Timber snow catch 2 m", ("roof", "snow", "safety", "mountain"), _snow_catch)
    for style in ("shingle", "tile", "thatch"):
        add(
            registry, f"roof_{style}_hip_cap_full", family,
            f"{style.title()} full-slope hip cap",
            ("roof", style, "hip", "junction"),
            lambda b, s=style: _hip_cap(b, s),
            seams=("slope-start", "slope-end"),
            triangle_budget=6_800,
            bevel=0.004,
        )
    add(registry, "roof_thatch_smoke_vent", family, "Bound-thatch smoke vent", ("roof", "thatch", "smoke", "residence", "tier-0"), _thatch_smoke_vent, triangle_budget=7_200, bevel=0.004)
    add(registry, "roof_shingle_chimney_flashing", family, "Shingle chimney flashing collar", ("roof", "shingle", "chimney", "flashing", "junction"), lambda b: _chimney_flashing(b, "shingle"), triangle_budget=5_200, bevel=0.004)
    add(registry, "roof_tile_chimney_flashing", family, "Tile chimney flashing collar", ("roof", "tile", "chimney", "flashing", "junction"), lambda b: _chimney_flashing(b, "tile"), triangle_budget=5_200, bevel=0.004)
    add(registry, "roof_shingle_apse_halfcone_3m", family, "Shingled half-cone apse roof", ("roof", "shingle", "apse", "church", "radial"), lambda b: _apse_roof(b, "shingle"), triangle_budget=14_000, bevel=0.004)
    add(registry, "roof_tile_apse_halfcone_3m", family, "Tiled half-cone apse roof", ("roof", "tile", "apse", "church", "radial"), lambda b: _apse_roof(b, "tile"), triangle_budget=14_000, bevel=0.004)
    add(registry, "roof_tile_belfry_pyramid_2m", family, "Tiled belfry pyramid roof", ("roof", "tile", "belfry", "church", "pyramid"), lambda b: _pyramid_roof(b, "tile"), triangle_budget=11_000, bevel=0.004)
    add(registry, "roof_shingle_belfry_pyramid_2m", family, "Shingled belfry pyramid roof", ("roof", "shingle", "belfry", "church", "pyramid"), lambda b: _pyramid_roof(b, "shingle"), triangle_budget=11_000, bevel=0.004)
    add(registry, "roof_shingle_shrine_gable_1p5m", family, "Wayside shrine shingle gable roof", ("roof", "shingle", "shrine", "gable", "devotional"), _shrine_gable_roof, triangle_budget=9_000, bevel=0.004)
    for style in ("shingle", "tile"):
        add(registry, f"roof_{style}_dormer_cap_1p2m", family, f"{style.title()} dormer gable cap", ("roof", style, "dormer", "gable", "junction"), lambda b, s=style: _dormer_cap(b, s), triangle_budget=8_400, bevel=0.004)
        add(registry, f"roof_{style}_halfhip_end_2p4m", family, f"{style.title()} half-hip roof end", ("roof", style, "half-hip", "end", "junction"), lambda b, s=style: _halfhip_end(b, s), triangle_budget=9_800, bevel=0.004)
        add(registry, f"roof_{style}_verge_edge_full", family, f"{style.title()} full-slope verge edge", ("roof", style, "verge", "edge", "junction"), lambda b, s=style: _verge_edge(b, s), seams=("slope-start", "slope-end"), triangle_budget=6_800, bevel=0.004)
    add(registry, "roof_tile_cross_gable_valley_2m", family, "Tiled cross-gable valley junction", ("roof", "tile", "cross-gable", "valley", "junction"), _cross_gable_valley, triangle_budget=7_200, bevel=0.004)
    add(registry, "roof_gable_finial_timber", family, "Carved timber gable finial", ("roof", "gable", "finial", "timber", "residence"), _timber_finial, triangle_budget=4_200, bevel=0.006)
    add(registry, "roof_ridge_cross_iron_small", family, "Small iron ridge cross", ("roof", "ridge", "cross", "iron", "religious"), _ridge_cross, triangle_budget=3_200, bevel=0.004)


def _panel(builder: MeshBuilder, width: float, slope_length: float, material: str, style: str) -> None:
    if style == "shingle":
        _split_shingle_panel(builder, width, slope_length)
    elif style == "tile":
        _clay_tile_panel(builder, width, slope_length)
    else:
        _bound_thatch_panel(builder, width, slope_length)


def _slope_center(local_y: float, lift: float = 0.0, pitch: float = spec.ROOF_PITCH) -> tuple[float, float]:
    return (
        local_y * math.cos(pitch) - lift * math.sin(pitch),
        local_y * math.sin(pitch) + lift * math.cos(pitch),
    )


def _slope_box(
    builder: MeshBuilder,
    size: tuple[float, float, float],
    x: float,
    local_y: float,
    lift: float,
    material: str,
    pitch_offset: float = 0.0,
    yaw: float = 0.0,
) -> None:
    y, z = _slope_center(local_y, lift)
    builder.box(size, (x, y, z), material, (spec.ROOF_PITCH + pitch_offset, 0.0, yaw))


def _split_shingle_panel(builder: MeshBuilder, width: float, slope_length: float) -> None:
    builder.roof_panel(width, slope_length, "oak_dark", thickness=0.055)
    exposure = 0.245
    rows = max(2, int(math.ceil(slope_length / exposure)) + 1)
    for row in range(rows):
        local_y = min(slope_length * 0.5 - 0.08, -slope_length * 0.5 + 0.12 + row * exposure)
        offset = -0.11 if row % 2 else 0.0
        x = -width * 0.5 + offset
        while x < width * 0.5 - 0.025:
            board_width = builder.random.uniform(0.16, 0.245)
            left = max(-width * 0.5, x)
            right = min(width * 0.5, x + board_width)
            if right - left < 0.055:
                x += board_width
                continue
            tone = builder.random.random()
            material = "shingles_aged" if tone < 0.26 else "shingles_light" if tone > 0.88 else "shingles"
            _slope_box(
                builder,
                (right - left - 0.008, 0.36, 0.038),
                (left + right) * 0.5,
                local_y + builder.random.uniform(-0.008, 0.008),
                0.060 + row * 0.0015,
                material,
                builder.random.uniform(-0.012, 0.012),
                builder.random.uniform(-0.014, 0.014),
            )
            x += board_width


def _clay_tile_panel(builder: MeshBuilder, width: float, slope_length: float) -> None:
    builder.roof_panel(width, slope_length, "oak_dark", thickness=0.050)
    exposure = 0.265
    tile_width = 0.235
    rows = max(2, int(math.ceil(slope_length / exposure)) + 1)
    for row in range(rows):
        local_y = min(slope_length * 0.5 - 0.08, -slope_length * 0.5 + 0.13 + row * exposure)
        offset = -tile_width * 0.5 if row % 2 else 0.0
        column = -int(math.ceil(width / tile_width))
        while column * tile_width + offset < width * 0.5 + tile_width:
            center_x = column * tile_width + offset
            left = max(-width * 0.5, center_x - tile_width * 0.5)
            right = min(width * 0.5, center_x + tile_width * 0.5)
            if right - left > 0.05:
                tone = builder.random.random()
                material = "terracotta_dark" if tone < 0.18 else "terracotta_worn" if tone > 0.78 else "terracotta"
                _slope_box(
                    builder,
                    (right - left - 0.010, 0.355, 0.050),
                    (left + right) * 0.5,
                    local_y + builder.random.uniform(-0.005, 0.005),
                    0.067 + row * 0.001,
                    material,
                    builder.random.uniform(-0.008, 0.008),
                    builder.random.uniform(-0.008, 0.008),
                )
            column += 1


def _bound_thatch_panel(builder: MeshBuilder, width: float, slope_length: float) -> None:
    builder.roof_panel(width, slope_length, "thatch_dark", thickness=0.17)
    strip_width = 0.14
    count = max(2, int(math.ceil(width / strip_width)))
    for index in range(count):
        x = -width * 0.5 + width * (index + 0.5) / count
        material = "thatch_light" if index % 5 in (1, 4) else "thatch"
        _slope_box(
            builder,
            (width / count - 0.009, slope_length + builder.random.uniform(-0.02, 0.035), 0.065),
            x,
            builder.random.uniform(-0.008, 0.008),
            0.125 + builder.random.uniform(-0.010, 0.018),
            material,
            builder.random.uniform(-0.008, 0.008),
        )
    for local_y in _course_positions(slope_length, 0.46):
        _slope_box(builder, (width - 0.025, 0.032, 0.032), 0.0, local_y, 0.176, "rope")
    _thatch_fringe(builder, width, -slope_length * 0.5, 0.16)


def _course_positions(length: float, spacing: float) -> list[float]:
    count = max(1, int(math.floor(length / spacing)))
    return [-length * 0.5 + length * (index + 1) / (count + 1) for index in range(count)]


def _thatch_fringe(builder: MeshBuilder, width: float, local_y: float, lift: float) -> None:
    count = max(4, int(math.ceil(width / 0.09)))
    base_y, base_z = _slope_center(local_y, lift)
    direction = (0.0, -math.cos(spec.ROOF_PITCH), -math.sin(spec.ROOF_PITCH))
    for index in range(count):
        x = -width * 0.5 + width * (index + 0.5) / count
        length = builder.random.uniform(0.10, 0.22)
        builder.beam_between(
            (x, base_y, base_z),
            (x + builder.random.uniform(-0.015, 0.015), base_y + direction[1] * length, base_z + direction[2] * length),
            0.022,
            "thatch_light" if index % 4 == 0 else "thatch",
        )


def _ridge(builder: MeshBuilder, length: float, material: str, style: str) -> None:
    if style == "tile":
        count = max(2, int(round(length / 0.30)))
        for index in range(count):
            x = -length * 0.5 + length * (index + 0.5) / count
            tone = "terracotta_dark" if index % 5 == 1 else "terracotta_worn" if index % 7 == 3 else material
            builder.cylinder(0.115, length / count + 0.030, (x, 0.0, 0.02), tone, 10, "x")
    elif style == "shingle":
        segments = max(2, int(math.ceil(length / 0.34)))
        for index in range(segments):
            x = -length * 0.5 + length * (index + 0.5) / segments
            segment = length / segments + 0.035
            tone = "shingles_aged" if index % 4 == 1 else "shingles"
            builder.box((segment, 0.32, 0.042), (x, -0.105, 0.015), tone, (spec.ROOF_PITCH, 0.0, 0.0))
            builder.box((segment, 0.32, 0.042), (x, 0.105, 0.015), tone, (-spec.ROOF_PITCH, 0.0, 0.0))
    else:
        builder.cylinder(0.19, length, (0.0, 0.0, 0.01), "thatch", 9, "x")
        builder.cylinder(0.13, length + 0.03, (0.0, 0.0, 0.11), "thatch_light", 8, "x")
        ties = max(2, int(math.ceil(length / 0.52)))
        for index in range(ties):
            x = -length * 0.5 + length * (index + 0.5) / ties
            builder.cylinder(0.205, 0.026, (x, 0.0, 0.02), "rope", 8, "x")


def _eave_edge(builder: MeshBuilder, length: float, style: str) -> None:
    if style == "thatch":
        builder.box((length, 0.18, 0.14), (0.0, 0.0, 0.04), "thatch_dark")
        _thatch_fringe(builder, length, 0.0, 0.10)
        builder.box((length, 0.045, 0.045), (0.0, -0.03, 0.12), "rope")
        return
    unit = 0.22 if style == "tile" else 0.20
    count = max(2, int(math.ceil(length / unit)))
    for index in range(count):
        x = -length * 0.5 + length * (index + 0.5) / count
        material = "terracotta_worn" if style == "tile" and index % 4 == 0 else "terracotta" if style == "tile" else "shingles_aged" if index % 5 == 2 else "shingles"
        builder.box((length / count - 0.008, 0.38, 0.055), (x, 0.0, 0.0), material, (0.09 if style == "shingle" else 0.04, 0.0, builder.random.uniform(-0.01, 0.01)))
    builder.box((length, 0.10, 0.13), (0.0, 0.12, -0.08), "oak_dark")


def _ridge_endcap(builder: MeshBuilder, style: str) -> None:
    if style == "tile":
        builder.cylinder(0.12, 0.10, (0.0, 0.0, 0.0), "terracotta_worn", 12, "x")
        builder.cylinder(0.052, 0.115, (-0.005, 0.0, 0.0), "terracotta_dark", 10, "x")
    elif style == "thatch":
        builder.cylinder(0.205, 0.24, (0.0, 0.0, 0.0), "thatch", 10, "x")
        builder.box((0.032, 0.42, 0.035), (-0.13, 0.0, 0.0), "rope")
    else:
        builder.box((0.28, 0.36, 0.05), (0.0, -0.11, 0.0), "shingles", (spec.ROOF_PITCH, 0.0, 0.0))
        builder.box((0.28, 0.36, 0.05), (0.0, 0.11, 0.0), "shingles_aged", (-spec.ROOF_PITCH, 0.0, 0.0))


def _repair_patch(builder: MeshBuilder, style: str) -> None:
    _panel(builder, 1.0, 0.60, "terracotta" if style == "tile" else "shingles" if style == "shingle" else "thatch", style)
    if style == "tile":
        for x, y in ((-0.22, -0.08), (0.18, 0.12), (0.37, -0.16)):
            _slope_box(builder, (0.20, 0.34, 0.048), x, y, 0.13, "terracotta_dark", 0.018)
    elif style == "shingle":
        for x, y in ((-0.28, -0.08), (0.05, 0.12), (0.31, -0.14)):
            _slope_box(builder, (0.21, 0.36, 0.042), x, y, 0.13, "shingles_light", -0.012)
    else:
        _slope_box(builder, (0.72, 0.12, 0.06), 0.04, -0.02, 0.25, "thatch_light")
        _slope_box(builder, (0.82, 0.035, 0.035), 0.0, 0.02, 0.29, "rope")


def _hip_cap(builder: MeshBuilder, style: str) -> None:
    length = 2.40
    if style == "thatch":
        start = (0.0, -length * 0.5 * math.cos(spec.ROOF_PITCH), -length * 0.5 * math.sin(spec.ROOF_PITCH))
        end = (0.0, length * 0.5 * math.cos(spec.ROOF_PITCH), length * 0.5 * math.sin(spec.ROOF_PITCH))
        builder.beam_between(start, end, 0.25, "thatch")
        return
    count = 10 if style == "tile" else 8
    for index in range(count):
        y0 = -length * 0.5 + length * index / count
        y1 = -length * 0.5 + length * (index + 1.15) / count
        start_y, start_z = _slope_center(y0, 0.05)
        end_y, end_z = _slope_center(min(length * 0.5, y1), 0.05)
        material = "terracotta" if style == "tile" else "shingles"
        if index % 4 == 1:
            material = "terracotta_worn" if style == "tile" else "shingles_aged"
        builder.beam_between((0.0, start_y, start_z), (0.0, end_y, end_z), 0.16 if style == "tile" else 0.13, material)


def _thatch_smoke_vent(builder: MeshBuilder) -> None:
    for x in (-0.28, 0.28):
        builder.box((0.08, 0.08, 0.62), (x, 0.0, 0.31), "oak_dark")
    builder.box((0.70, 0.46, 0.16), (0.0, 0.0, 0.72), "thatch_dark", (0.08, 0.0, 0.0))
    builder.box((0.58, 0.06, 0.12), (0.0, -0.22, 0.35), "charcoal")
    for x in (-0.24, 0.0, 0.24):
        builder.beam_between((x, -0.24, 0.08), (x, -0.24, 0.62), 0.035, "oak_dark")


def _chimney_flashing(builder: MeshBuilder, style: str) -> None:
    material = "terracotta_dark" if style == "tile" else "iron"
    builder.box((0.92, 0.72, 0.055), (0.0, 0.0, 0.0), material, (spec.ROOF_PITCH, 0.0, 0.0))
    for x in (-0.30, 0.30):
        builder.box((0.08, 0.62, 0.10), (x, 0.0, 0.07), material, (spec.ROOF_PITCH, 0.0, 0.0))
    for y in (-0.20, 0.20):
        builder.box((0.52, 0.07, 0.12), (0.0, y, 0.10), material, (spec.ROOF_PITCH, 0.0, 0.0))


def _apse_roof(builder: MeshBuilder, style: str) -> None:
    segments = 14
    radius = 1.62
    height = 1.82
    material = "terracotta" if style == "tile" else "shingles"
    arc = [(radius * math.cos(math.pi * index / segments), radius * math.sin(math.pi * index / segments), 0.0) for index in range(segments + 1)]
    apex_index = len(arc)
    vertices = [*arc, (0.0, 0.0, height)]
    faces: list[tuple[int, ...]] = []
    for index in range(segments):
        faces.append((index, index + 1, apex_index))
    faces.append(tuple(range(segments, -1, -1)))
    faces.append((0, apex_index, segments))
    builder._append(vertices, faces, material)
    course_material = "terracotta_worn" if style == "tile" else "shingles_aged"
    for course in range(1, 5):
        t = course / 5
        course_radius = radius * (1.0 - t)
        z = height * t + 0.035
        points = [(course_radius * math.cos(math.pi * index / segments), course_radius * math.sin(math.pi * index / segments), z) for index in range(segments + 1)]
        for index in range(segments):
            builder.beam_between(points[index], points[index + 1], 0.055, course_material if course % 2 else material)
    for index in (0, 3, 6, 8, 11, 14):
        builder.beam_between(arc[index], (0.0, 0.0, height), 0.065, "terracotta_dark" if style == "tile" else "oak_dark")
    builder.cylinder(0.11, 0.26, (0.0, 0.0, height + 0.10), "oak_dark", 9, "z")


def _pyramid_roof(builder: MeshBuilder, style: str) -> None:
    material = "terracotta" if style == "tile" else "shingles"
    half = 1.18
    height = 1.72
    base = [(-half, -half, 0.0), (half, -half, 0.0), (half, half, 0.0), (-half, half, 0.0)]
    apex = (0.0, 0.0, height)
    builder._append([*base, apex], [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (3, 2, 1, 0)], material)
    accent = "terracotta_worn" if style == "tile" else "shingles_aged"
    for side in range(4):
        a = base[side]
        b = base[(side + 1) % 4]
        builder.beam_between(a, apex, 0.075, "terracotta_dark" if style == "tile" else "oak_dark")
        for course in range(1, 5):
            t = course / 5
            p0 = tuple(a[axis] * (1.0 - t) + apex[axis] * t for axis in range(3))
            p1 = tuple(b[axis] * (1.0 - t) + apex[axis] * t for axis in range(3))
            builder.beam_between(p0, p1, 0.055, accent if course % 2 else material)
    builder.box((2.52, 2.52, 0.14), (0.0, 0.0, -0.02), "oak_dark")
    builder.cone(0.16, 0.045, 0.52, (0.0, 0.0, height + 0.26), "oak_dark", 8)


def _shrine_gable_roof(builder: MeshBuilder) -> None:
    for side in (-1.0, 1.0):
        builder.box((1.62, 1.05, 0.065), (0.0, side * 0.23, 0.18), "shingles" if side < 0 else "shingles_aged", (side * 0.62, 0.0, 0.0))
    _ridge(builder, 1.62, "shingles", "shingle")
    for x in (-0.75, 0.75):
        builder.beam_between((x, -0.54, -0.03), (x, 0.0, 0.42), 0.07, "oak_dark")
        builder.beam_between((x, 0.54, -0.03), (x, 0.0, 0.42), 0.07, "oak_dark")


def _dormer_cap(builder: MeshBuilder, style: str) -> None:
    material = "terracotta" if style == "tile" else "shingles"
    accent = "terracotta_worn" if style == "tile" else "shingles_aged"
    for side in (-1.0, 1.0):
        builder.box((1.38, 0.94, 0.065), (0.0, side * 0.22, 0.20), material if side < 0 else accent, (side * 0.66, 0.0, 0.0))
    _ridge(builder, 1.38, material, style)
    for x in (-0.64, 0.64):
        builder.beam_between((x, -0.49, -0.02), (x, 0.0, 0.49), 0.065, "oak_dark")
        builder.beam_between((x, 0.49, -0.02), (x, 0.0, 0.49), 0.065, "oak_dark")


def _halfhip_end(builder: MeshBuilder, style: str) -> None:
    material = "terracotta" if style == "tile" else "shingles"
    accent = "terracotta_dark" if style == "tile" else "oak_dark"
    vertices = [
        (-1.20, -1.00, 0.0), (1.20, -1.00, 0.0), (1.20, 1.00, 0.0), (-1.20, 1.00, 0.0),
        (-0.52, 0.58, 1.42), (0.52, 0.58, 1.42),
    ]
    faces = [(0, 1, 5, 4), (1, 2, 5), (2, 3, 4, 5), (3, 0, 4), (3, 2, 1, 0)]
    builder._append(vertices, faces, material)
    for start, end in ((0, 4), (1, 5), (3, 4), (2, 5), (4, 5)):
        builder.beam_between(vertices[start], vertices[end], 0.075, accent)
    for course in range(1, 4):
        t = course / 4
        left = tuple(vertices[0][axis] * (1.0 - t) + vertices[4][axis] * t for axis in range(3))
        right = tuple(vertices[1][axis] * (1.0 - t) + vertices[5][axis] * t for axis in range(3))
        builder.beam_between(left, right, 0.05, "terracotta_worn" if style == "tile" else "shingles_aged")


def _verge_edge(builder: MeshBuilder, style: str) -> None:
    length = 2.40
    count = 9 if style == "tile" else 8
    for index in range(count):
        y0 = -length * 0.5 + length * index / count
        y1 = -length * 0.5 + length * (index + 1.10) / count
        sy, sz = _slope_center(y0, 0.06)
        ey, ez = _slope_center(min(length * 0.5, y1), 0.06)
        material = "terracotta" if style == "tile" else "shingles"
        if index % 3 == 1:
            material = "terracotta_worn" if style == "tile" else "shingles_aged"
        builder.beam_between((0.0, sy, sz), (0.0, ey, ez), 0.14 if style == "tile" else 0.12, material)
    builder.box((0.10, length * math.cos(spec.ROOF_PITCH), 0.12), (0.0, 0.0, 0.0), "oak_dark", (spec.ROOF_PITCH, 0.0, 0.0))


def _cross_gable_valley(builder: MeshBuilder) -> None:
    for yaw in (-0.72, 0.72):
        start = (-1.05 * math.cos(yaw), -1.05 * math.sin(yaw), 0.0)
        end = (1.05 * math.cos(yaw), 1.05 * math.sin(yaw), 0.72)
        builder.beam_between(start, end, 0.16, "terracotta_dark")
        builder.beam_between((start[0], start[1], 0.08), (end[0], end[1], 0.80), 0.07, "iron")


def _timber_finial(builder: MeshBuilder) -> None:
    builder.cone(0.16, 0.09, 0.34, (0.0, 0.0, 0.17), "timber_cut", 8)
    builder.cone(0.11, 0.015, 0.42, (0.0, 0.0, 0.54), "timber_cut", 8)
    for side in (-1.0, 1.0):
        builder.beam_between((0.0, 0.0, 0.42), (side * 0.19, 0.0, 0.31), 0.055, "timber_cut")


def _ridge_cross(builder: MeshBuilder) -> None:
    builder.box((0.055, 0.055, 0.72), (0.0, 0.0, 0.36), "iron")
    builder.box((0.44, 0.055, 0.055), (0.0, 0.0, 0.49), "iron")
    builder.cone(0.10, 0.055, 0.16, (0.0, 0.0, 0.08), "iron", 8)


def _roof_timber(builder: MeshBuilder, length: float, role: str) -> None:
    thickness = 0.14 if role != "fascia" else 0.18
    depth = 0.18 if role != "valley" else 0.24
    builder.box((length, depth, thickness), (0.0, 0.0, 0.0), "oak_dark")
    if role == "valley":
        builder.box((length, depth * 0.38, thickness * 0.45), (0.0, 0.0, thickness * 0.72), "iron")


def _dormer_frame(builder: MeshBuilder, width: float) -> None:
    height = 1.25
    depth = 1.20
    section = 0.14
    for x in (-width * 0.5, width * 0.5):
        builder.box((section, section, height), (x, -depth * 0.5, height * 0.5), "oak_dark")
        builder.box((section, section, height), (x, depth * 0.5, height * 0.5), "oak_dark")
    builder.beam_between((-width * 0.5, -depth * 0.5, height), (0.0, -depth * 0.5, height + width * 0.34), section, "oak_dark")
    builder.beam_between((0.0, -depth * 0.5, height + width * 0.34), (width * 0.5, -depth * 0.5, height), section, "oak_dark")


def _snow_catch(builder: MeshBuilder) -> None:
    builder.box((2.0, 0.11, 0.11), (0.0, 0.0, 0.28), "oak_dark")
    for x in (-0.8, -0.25, 0.25, 0.8):
        builder.beam_between((x, 0.0, 0.0), (x, 0.0, 0.32), 0.07, "iron")
