from __future__ import annotations

import math

from .. import spec
from ..core import MeshBuilder, Registry
from .common import add


def register(registry: Registry) -> None:
    family = "openings"
    for contract in ("window_tiny", "window_small", "window_domestic", "window_shop", "louver"):
        for treatment in ("plain", "shuttered"):
            piece_id = f"opening_{contract}_{treatment}"
            add(
                registry, piece_id, family,
                f"{contract.replace('_', ' ').title()} {treatment}",
                ("opening", "window", contract, treatment, "insert"),
                lambda b, c=contract, t=treatment: _window(b, c, t),
                seams=("y=0", "z=sill"),
                opening_contract=contract,
                triangle_budget=4_400,
                bevel=0.012,
            )

    add(
        registry, "opening_window_lancet_stone", family, "Stone lancet window insert",
        ("opening", "window", "lancet", "church", "insert"),
        _lancet,
        seams=("y=0", "z=sill"),
        opening_contract="window_lancet",
        triangle_budget=4_800,
        bevel=0.01,
    )
    add(registry, "opening_window_domestic_leaded", family, "Domestic diamond-leaded casement", ("opening", "window", "domestic", "leaded", "high-status", "insert"), _domestic_leaded, seams=("y=0", "z=sill"), opening_contract="window_domestic", triangle_budget=7_200, bevel=0.008)
    add(registry, "opening_window_lancet_deep", family, "Deep-reveal stone lancet", ("opening", "window", "lancet", "church", "deep-reveal", "insert"), lambda b: _lancet(b, deep=True), seams=("y=0", "z=sill"), opening_contract="window_lancet", triangle_budget=8_200, bevel=0.008)
    add(registry, "opening_window_lancet_pair", family, "Paired church lancets with shared hood mould", ("opening", "window", "lancet", "paired", "church", "insert"), _paired_lancet, seams=("y=0", "z=sill"), opening_contract="window_shop", triangle_budget=12_000, bevel=0.008)
    add(registry, "opening_window_oculus_stone", family, "Stone church oculus", ("opening", "window", "oculus", "church", "insert"), _oculus, seams=("y=0", "z=center"), opening_contract="window_shop", triangle_budget=7_600, bevel=0.008)
    add(registry, "opening_window_belfry_louver_arch", family, "Arched belfry louver", ("opening", "window", "louver", "belfry", "church", "insert"), _belfry_louver, seams=("y=0", "z=sill"), opening_contract="window_domestic", triangle_budget=7_200, bevel=0.008)

    for contract in ("door_service", "door_house", "door_barn", "gate_cart"):
        for leaf in (("single",) if contract != "door_barn" and contract != "gate_cart" else ("double", "open-double")):
            piece_id = f"opening_{contract}_{leaf}"
            add(
                registry, piece_id, family,
                f"{contract.replace('_', ' ').title()} {leaf}",
                ("opening", "door", contract, leaf, "insert"),
                lambda b, c=contract, l=leaf: _door(b, c, l),
                seams=("y=0", "z=0"),
                opening_contract=contract,
                triangle_budget=4_600,
                bevel=0.012,
            )

    add(registry, "opening_stable_half_door", family, "Stable split half-door", ("opening", "door", "stable", "insert"), _stable_door, opening_contract="door_house")
    add(registry, "opening_church_arch_door", family, "Church arched oak door", ("opening", "door", "church", "arched", "insert"), _church_door, opening_contract="door_house", triangle_budget=5_200)
    add(registry, "opening_church_arch_door_double", family, "Paired arched church oak doors", ("opening", "door", "church", "arched", "double", "insert"), lambda b: _church_door(b, double=True), opening_contract="door_barn", triangle_budget=10_000, bevel=0.008)
    add(registry, "opening_church_portal_surround", family, "Stepped limestone church portal surround", ("opening", "door", "church", "portal", "surround", "insert"), _church_portal_surround, opening_contract="door_house", triangle_budget=8_800, bevel=0.008)
    add(registry, "opening_shrine_icon_insert", family, "Marian shrine icon and votive insert", ("opening", "shrine", "icon", "devotional", "insert"), _shrine_icon_insert, opening_contract="window_small", triangle_budget=7_600, bevel=0.006)
    add(registry, "opening_barn_loft_hatch", family, "Barn loft hatch", ("opening", "hatch", "barn", "insert"), _loft_hatch, opening_contract="window_shop")
    add(registry, "opening_cellar_vent", family, "Stone cellar vent", ("opening", "vent", "cellar", "insert"), _cellar_vent, opening_contract="window_tiny")


def _frame(builder: MeshBuilder, width: float, height: float, sill: float, member: float, material: str = "oak_dark") -> None:
    builder.box((member, spec.OPENING_REVEAL, height), (-width * 0.5 - member * 0.5, -spec.OPENING_REVEAL * 0.5, sill + height * 0.5), material)
    builder.box((member, spec.OPENING_REVEAL, height), (width * 0.5 + member * 0.5, -spec.OPENING_REVEAL * 0.5, sill + height * 0.5), material)
    builder.box((width + member * 2, spec.OPENING_REVEAL, member), (0.0, -spec.OPENING_REVEAL * 0.5, sill + height + member * 0.5), material)
    builder.box((width + member * 2.25, spec.OPENING_REVEAL * 1.3, member * 0.72), (0.0, -spec.OPENING_REVEAL * 0.62, sill - member * 0.36), material)


def _window(builder: MeshBuilder, contract: str, treatment: str) -> None:
    opening = spec.OPENINGS[contract]
    width = opening["width"] - spec.INSERT_CLEARANCE * 2
    height = opening["height"] - spec.INSERT_CLEARANCE * 2
    sill = opening["sill"] + spec.INSERT_CLEARANCE
    member = 0.09 if contract != "window_shop" else 0.12
    _frame(builder, width, height, sill, member)
    if contract == "louver":
        for index in range(4):
            z = sill + height * (index + 0.5) / 4
            builder.box((width - 0.08, 0.055, 0.075), (0.0, -0.035, z), "timber_weathered", (0.18, 0.0, 0.0))
    else:
        builder.box((width - member * 0.65, 0.026, height - member * 0.65), (0.0, 0.008, sill + height * 0.5), "glass")
    if treatment == "shuttered":
        shutter_width = width * 0.44
        for side in (-1.0, 1.0):
            x = side * (width * 0.5 + shutter_width * 0.56)
            builder.box((shutter_width, 0.07, height), (x, -0.035, sill + height * 0.5), "timber_weathered", (0.0, 0.0, side * 0.055))
            for index in range(3):
                z = sill + height * (index + 1) / 4
                builder.box((shutter_width - 0.06, 0.078, 0.045), (x, -0.075, z), "oak_dark")


def _append_local(builder: MeshBuilder, local: MeshBuilder, offset: tuple[float, float, float]) -> None:
    start = len(builder.vertices)
    builder.vertices.extend((vertex[0] + offset[0], vertex[1] + offset[1], vertex[2] + offset[2]) for vertex in local.vertices)
    builder.faces.extend(tuple(start + index for index in face) for face in local.faces)
    builder.face_materials.extend(local.face_materials)


def _lancet(builder: MeshBuilder, deep: bool = False) -> None:
    opening = spec.OPENINGS["window_lancet"]
    width = opening["width"] - 0.05
    height = opening["height"] - 0.05
    sill = opening["sill"] + 0.025
    local = MeshBuilder(f"{builder.piece_id}_lancet")
    local.arch_ring(width + 0.24, height + 0.12, 0.26 if deep else 0.16, 0.13, "limestone_warm", 13)
    _append_local(builder, local, (0.0, 0.0, sill - 0.10))
    builder.box((width, 0.028, height - width * 0.48), (0.0, 0.015, sill + (height - width * 0.48) * 0.5), "glass")
    builder.gable_prism(width, 0.028, width * 0.5, sill + height - width * 0.5, "glass")
    if deep:
        for side in (-1.0, 1.0):
            builder.box((0.10, 0.32, height * 0.74), (side * (width * 0.5 + 0.08), 0.09, sill + height * 0.41), "limestone_warm", (0.0, 0.0, side * 0.025))
        _diamond_lead(builder, width * 0.80, height * 0.56, sill + height * 0.36, -0.025)


def _diamond_lead(builder: MeshBuilder, width: float, height: float, center_z: float, y: float) -> None:
    spacing = 0.22
    extent = width + height
    count = max(2, int(math.ceil(extent / spacing)))
    for direction in (-1.0, 1.0):
        for index in range(-count, count + 1):
            offset = index * spacing
            points: list[tuple[float, float]] = []
            for x in (-width * 0.5, width * 0.5):
                z = direction * x + offset
                if -height * 0.5 <= z <= height * 0.5:
                    points.append((x, z))
            for z in (-height * 0.5, height * 0.5):
                x = direction * (z - offset)
                if -width * 0.5 <= x <= width * 0.5:
                    points.append((x, z))
            unique: list[tuple[float, float]] = []
            for point in points:
                if point not in unique:
                    unique.append(point)
            if len(unique) >= 2:
                builder.beam_between((unique[0][0], y, center_z + unique[0][1]), (unique[1][0], y, center_z + unique[1][1]), 0.018, "iron")


def _domestic_leaded(builder: MeshBuilder) -> None:
    opening = spec.OPENINGS["window_domestic"]
    width = opening["width"] - 0.05
    height = opening["height"] - 0.05
    sill = opening["sill"] + 0.025
    _frame(builder, width, height, sill, 0.105)
    builder.box((width - 0.08, 0.028, height - 0.08), (0.0, 0.01, sill + height * 0.5), "glass")
    _diamond_lead(builder, width - 0.12, height - 0.12, sill + height * 0.5, -0.025)


def _paired_lancet(builder: MeshBuilder) -> None:
    for x in (-0.46, 0.46):
        local = MeshBuilder(f"{builder.piece_id}_{x}")
        _lancet(local, deep=True)
        _append_local(builder, local, (x, 0.0, 0.0))
    builder.beam_between((-0.98, -0.02, 2.55), (0.0, -0.02, 2.88), 0.13, "limestone_warm")
    builder.beam_between((0.0, -0.02, 2.88), (0.98, -0.02, 2.55), 0.13, "limestone_warm")


def _circle_ring(builder: MeshBuilder, radius: float, center_z: float, member: float, material: str, segments: int = 18) -> None:
    for index in range(segments):
        angle0 = math.tau * index / segments
        angle1 = math.tau * (index + 1) / segments
        builder.beam_between((radius * math.cos(angle0), 0.0, center_z + radius * math.sin(angle0)), (radius * math.cos(angle1), 0.0, center_z + radius * math.sin(angle1)), member, material)


def _oculus(builder: MeshBuilder) -> None:
    center_z = 1.42
    radius = 0.61
    builder.cylinder(radius - 0.12, 0.04, (0.0, 0.01, center_z), "glass", 24, "y")
    _circle_ring(builder, radius, center_z, 0.15, "limestone_warm", 20)
    _diamond_lead(builder, 0.72, 0.72, center_z, -0.035)
    builder.box((1.42, 0.23, 0.12), (0.0, 0.02, center_z - radius - 0.08), "limestone_warm")


def _belfry_louver(builder: MeshBuilder) -> None:
    opening = spec.OPENINGS["window_domestic"]
    width = opening["width"]
    sill = opening["sill"]
    local = MeshBuilder(f"{builder.piece_id}_arch")
    local.arch_ring(width + 0.18, 1.34, 0.20, 0.12, "limestone_warm", 13)
    _append_local(builder, local, (0.0, 0.0, sill - 0.10))
    for index in range(5):
        z = sill + 0.20 + index * 0.18
        builder.box((width - 0.11, 0.075, 0.065), (0.0, -0.04, z), "oak_dark", (0.18, 0.0, 0.0))


def _door(builder: MeshBuilder, contract: str, leaf: str) -> None:
    opening = spec.OPENINGS[contract]
    width = opening["width"] - 0.05
    height = opening["height"] - 0.04
    member = 0.12 if width < 1.5 else 0.18
    _frame(builder, width, height, 0.02, member)
    panels = 2 if leaf in ("double", "open-double") else 1
    for panel in range(panels):
        panel_width = width / panels
        x = -width * 0.5 + panel_width * (panel + 0.5)
        yaw = 0.0
        y = 0.018
        if leaf == "open-double":
            yaw = (-1 if panel == 0 else 1) * math.radians(34)
            y = -0.14
        builder.box((panel_width - 0.028, 0.075, height - 0.04), (x, y, height * 0.5 + 0.02), "timber_weathered", (0.0, 0.0, yaw))
        plank_count = max(2, round(panel_width / 0.24))
        for index in range(1, plank_count):
            seam_x = x - panel_width * 0.5 + panel_width * index / plank_count
            builder.box((0.012, 0.082, height - 0.10), (seam_x, y - 0.043, height * 0.5 + 0.02), "oak_dark")
        for z in (height * 0.25, height * 0.72):
            builder.box((panel_width * 0.38, 0.032, 0.055), (x + (-0.18 if panel == 0 else 0.18) * panel_width, y - 0.065, z), "iron")
    builder.cylinder(0.035, 0.08, (width * 0.28, -0.075, height * 0.50), "iron", 8, "y")


def _stable_door(builder: MeshBuilder) -> None:
    opening = spec.OPENINGS["door_house"]
    width = opening["width"] - 0.05
    height = opening["height"] - 0.04
    _frame(builder, width, height, 0.02, 0.12)
    for z in (height * 0.25, height * 0.75):
        builder.box((width - 0.05, 0.08, height * 0.47), (0.0, 0.02, z), "timber_weathered")
    builder.box((width - 0.04, 0.09, 0.08), (0.0, -0.03, height * 0.50), "oak_dark")


def _church_door(builder: MeshBuilder, double: bool = False) -> None:
    opening = spec.OPENINGS["door_house"]
    width = 1.72 if double else opening["width"]
    height = 2.34 if double else opening["height"]
    builder.arch_ring(width + 0.38, height + 0.18, 0.30, 0.16, "limestone_warm", 15)
    panels = 2 if double else 1
    panel_width = width / panels
    radius = width * 0.5
    spring = height - radius
    for panel in range(panels):
        panel_center = -width * 0.5 + panel_width * (panel + 0.5)
        plank_count = max(3, int(round(panel_width / 0.18)))
        for plank in range(plank_count):
            x = panel_center - panel_width * 0.5 + panel_width * (plank + 0.5) / plank_count
            top = spring + math.sqrt(max(0.0, radius * radius - x * x))
            builder.box((panel_width / plank_count - 0.010, 0.095, top - 0.035), (x, 0.02, top * 0.5), "timber_weathered")
        for z in (0.52, 1.28):
            builder.box((panel_width * 0.72, 0.035, 0.065), (panel_center, -0.045, z), "iron")
    for side in (-1.0, 1.0):
        builder.box((0.18, 0.34, height), (side * (width * 0.5 + 0.09), 0.04, height * 0.5), "limestone_warm")
    builder.box((width + 0.48, 0.42, 0.16), (0.0, 0.06, 0.08), "limestone_warm")
    builder.cylinder(0.038, 0.13, ((0.26 if not double else 0.10), -0.08, 1.05), "iron", 10, "y")


def _church_portal_surround(builder: MeshBuilder) -> None:
    for layer, (width, height, depth, member) in enumerate(((1.40, 2.36, 0.34, 0.17), (1.72, 2.56, 0.24, 0.15), (2.02, 2.74, 0.16, 0.13))):
        local = MeshBuilder(f"{builder.piece_id}_{layer}")
        local.arch_ring(width, height, depth, member, "limestone_warm", 15)
        _append_local(builder, local, (0.0, 0.08 * layer, 0.0))
    builder.box((2.28, 0.48, 0.18), (0.0, 0.08, 0.09), "limestone_warm")


def _shrine_icon_insert(builder: MeshBuilder) -> None:
    builder.box((0.48, 0.055, 0.70), (0.0, 0.0, 0.76), "devotional_blue")
    builder.cylinder(0.17, 0.065, (0.0, -0.005, 1.02), "icon_gold", 16, "y")
    builder.cone(0.20, 0.09, 0.46, (0.0, 0.0, 0.72), "devotional_blue", 10)
    builder.box((0.82, 0.30, 0.12), (0.0, 0.05, 0.30), "limestone_warm")
    for x in (-0.23, 0.23):
        builder.cylinder(0.038, 0.24, (x, -0.10, 0.48), "wax", 8, "z")
        builder.cone(0.055, 0.008, 0.14, (x, -0.10, 0.67), "icon_gold", 8)


def _loft_hatch(builder: MeshBuilder) -> None:
    opening = spec.OPENINGS["window_shop"]
    _frame(builder, opening["width"] - 0.05, opening["height"] - 0.05, opening["sill"], 0.11)
    builder.box((opening["width"] - 0.12, 0.08, opening["height"] - 0.12), (0.0, 0.02, opening["sill"] + opening["height"] * 0.5), "timber_weathered")


def _cellar_vent(builder: MeshBuilder) -> None:
    opening = spec.OPENINGS["window_tiny"]
    _frame(builder, opening["width"], opening["height"], opening["sill"], 0.10, "limestone_warm")
    for x in (-0.12, 0.0, 0.12):
        builder.box((0.025, 0.07, opening["height"] - 0.10), (x, -0.04, opening["sill"] + opening["height"] * 0.5), "iron")
