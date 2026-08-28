"""Shared Gorski Kotar 1550 kit contract.

Axes follow Blender/glTF: X runs along a wall, Y is wall depth, Z is up.
A wall origin is at the bay centre on grade. Its public face is Y=0 and its
body extends toward +Y. A corner fills the void between adjoining wall runs.
One Blender unit is one metre. Structural modules are authored at their final
dimensions; non-uniform assembly scale is never part of the contract.
"""

from __future__ import annotations

import math

GRID = 2.0
HALF_GRID = GRID * 0.5
QUARTER_GRID = GRID * 0.25

STOREY_HUMBLE = 2.40
STOREY_DOMESTIC = 2.70
STOREY_CIVIC = 3.00
STOREY_UPPER = 2.45
KNEE_WALL = 1.10

WALL_STONE = 0.45
WALL_PLASTER = 0.28
WALL_TIMBER = 0.18
TIMBER_POST = 0.22
TIMBER_BEAM = 0.20

ROOF_PITCH_DEG = 50.0
ROOF_PITCH = math.radians(ROOF_PITCH_DEG)
ROOF_SLOPE_SEGMENT = 1.20
EAVE_OVERHANG = 0.32
VERGE_OVERHANG = 0.24
ROOF_THICKNESS = 0.11

PROUD_MAX = 0.32
INSERT_CLEARANCE = 0.025
OPENING_REVEAL = 0.08

OPENINGS = {
    "window_tiny": {"width": 0.46, "height": 0.58, "sill": 1.18},
    "window_small": {"width": 0.64, "height": 0.82, "sill": 1.02},
    "window_domestic": {"width": 0.88, "height": 1.08, "sill": 0.92},
    "window_shop": {"width": 1.18, "height": 1.22, "sill": 0.78},
    "window_lancet": {"width": 0.64, "height": 1.62, "sill": 0.84},
    "louver": {"width": 0.82, "height": 0.66, "sill": 1.38},
    "door_service": {"width": 0.88, "height": 1.94, "sill": 0.0},
    "door_house": {"width": 0.98, "height": 2.04, "sill": 0.0},
    "door_barn": {"width": 2.20, "height": 2.42, "sill": 0.0},
    "gate_cart": {"width": 2.40, "height": 2.35, "sill": 0.0},
}
for _opening in OPENINGS.values():
    _opening["head"] = _opening["sill"] + _opening["height"]

TRIANGLE_BUDGET_DEFAULT = 3_200
TRIANGLE_BUDGET_HERO = 8_000

REGION = "Gorski Kotar and Croatian Littoral"
ERA = "circa 1550"
KIT_VERSION = "1.0.0"

MATERIAL_SPECS = {
    "limestone_warm": ((0.62, 0.57, 0.46, 1.0), 0.91, 0.0),
    "fieldstone": ((0.39, 0.38, 0.34, 1.0), 0.95, 0.0),
    "quarry_stone": ((0.42, 0.44, 0.43, 1.0), 0.96, 0.0),
    "limewash": ((0.79, 0.76, 0.65, 1.0), 0.93, 0.0),
    "limewash_ochre": ((0.62, 0.45, 0.29, 1.0), 0.94, 0.0),
    "limewash_grey": ((0.54, 0.54, 0.49, 1.0), 0.95, 0.0),
    "oak_dark": ((0.19, 0.11, 0.065, 1.0), 0.86, 0.0),
    "timber_weathered": ((0.34, 0.22, 0.13, 1.0), 0.91, 0.0),
    "timber_cut": ((0.47, 0.31, 0.17, 1.0), 0.87, 0.0),
    "shingles": ((0.25, 0.14, 0.075, 1.0), 0.92, 0.0),
    "shingles_aged": ((0.18, 0.12, 0.085, 1.0), 0.96, 0.0),
    "shingles_light": ((0.34, 0.23, 0.14, 1.0), 0.94, 0.0),
    "terracotta": ((0.46, 0.16, 0.075, 1.0), 0.89, 0.0),
    "terracotta_dark": ((0.32, 0.10, 0.052, 1.0), 0.94, 0.0),
    "terracotta_worn": ((0.53, 0.25, 0.14, 1.0), 0.93, 0.0),
    "thatch": ((0.52, 0.39, 0.18, 1.0), 0.98, 0.0),
    "thatch_dark": ((0.36, 0.27, 0.14, 1.0), 1.0, 0.0),
    "thatch_light": ((0.63, 0.50, 0.26, 1.0), 0.99, 0.0),
    "iron": ((0.055, 0.06, 0.058, 1.0), 0.58, 0.72),
    "brass": ((0.46, 0.31, 0.09, 1.0), 0.48, 0.64),
    "devotional_blue": ((0.12, 0.23, 0.38, 1.0), 0.92, 0.0),
    "icon_gold": ((0.58, 0.39, 0.10, 1.0), 0.72, 0.12),
    "wax": ((0.73, 0.63, 0.36, 1.0), 0.94, 0.0),
    "glass": ((0.13, 0.19, 0.20, 0.74), 0.28, 0.0),
    "earth": ((0.29, 0.20, 0.12, 1.0), 1.0, 0.0),
    "clay": ((0.43, 0.25, 0.15, 1.0), 0.98, 0.0),
    "charcoal": ((0.035, 0.032, 0.029, 1.0), 1.0, 0.0),
    "water": ((0.08, 0.24, 0.28, 0.78), 0.18, 0.0),
    "canvas": ((0.63, 0.57, 0.42, 1.0), 0.97, 0.0),
    "canvas_red": ((0.42, 0.13, 0.08, 1.0), 0.96, 0.0),
    "leather": ((0.24, 0.12, 0.055, 1.0), 0.83, 0.0),
    "crop": ((0.50, 0.43, 0.16, 1.0), 0.99, 0.0),
    "foliage": ((0.20, 0.30, 0.12, 1.0), 0.99, 0.0),
    "rope": ((0.43, 0.34, 0.20, 1.0), 0.96, 0.0),
    "plaster_inside": ((0.20, 0.08, 0.22, 1.0), 1.0, 0.0),
}


def width_token(value: float) -> str:
    return f"{value:g}m".replace(".", "p")
