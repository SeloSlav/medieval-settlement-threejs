from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import json
import math
import random
from typing import Callable, Iterable, Sequence

import bpy
from mathutils import Euler, Matrix, Vector

from . import spec


Vec3 = tuple[float, float, float]


def stable_seed(value: str) -> int:
    return int.from_bytes(hashlib.sha256(value.encode("utf-8")).digest()[:8], "big")


class MeshBuilder:
    def __init__(self, piece_id: str):
        self.piece_id = piece_id
        self.vertices: list[Vec3] = []
        self.faces: list[tuple[int, ...]] = []
        self.face_materials: list[str] = []
        self.random = random.Random(stable_seed(piece_id))

    def _append(self, vertices: Sequence[Vec3], faces: Sequence[Sequence[int]], material: str) -> None:
        start = len(self.vertices)
        self.vertices.extend(vertices)
        self.faces.extend(tuple(start + index for index in face) for face in faces)
        self.face_materials.extend([material] * len(faces))

    def box(
        self,
        size: Vec3,
        center: Vec3 = (0.0, 0.0, 0.0),
        material: str = "timber_weathered",
        rotation: Vec3 = (0.0, 0.0, 0.0),
    ) -> None:
        sx, sy, sz = (max(0.001, value) * 0.5 for value in size)
        local = [
            (-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
            (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz),
        ]
        matrix = Euler(rotation, "XYZ").to_matrix().to_4x4()
        matrix.translation = Vector(center)
        vertices = [tuple(matrix @ Vector(vertex)) for vertex in local]
        faces = [
            (0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
            (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7),
        ]
        self._append(vertices, faces, material)

    def cylinder(
        self,
        radius: float,
        depth: float,
        center: Vec3 = (0.0, 0.0, 0.0),
        material: str = "timber_weathered",
        segments: int = 8,
        axis: str = "z",
    ) -> None:
        segments = max(5, segments)
        half = depth * 0.5
        vertices: list[Vec3] = []
        for end in (-half, half):
            for index in range(segments):
                angle = math.tau * index / segments
                a = radius * math.cos(angle)
                b = radius * math.sin(angle)
                if axis == "x":
                    vertices.append((center[0] + end, center[1] + a, center[2] + b))
                elif axis == "y":
                    vertices.append((center[0] + a, center[1] + end, center[2] + b))
                else:
                    vertices.append((center[0] + a, center[1] + b, center[2] + end))
        faces: list[tuple[int, ...]] = [tuple(range(segments - 1, -1, -1)), tuple(range(segments, segments * 2))]
        for index in range(segments):
            next_index = (index + 1) % segments
            faces.append((index, next_index, segments + next_index, segments + index))
        self._append(vertices, faces, material)

    def cone(
        self,
        radius_bottom: float,
        radius_top: float,
        depth: float,
        center: Vec3,
        material: str,
        segments: int = 8,
    ) -> None:
        segments = max(5, segments)
        half = depth * 0.5
        vertices: list[Vec3] = []
        for radius, z in ((radius_bottom, -half), (radius_top, half)):
            for index in range(segments):
                angle = math.tau * index / segments
                vertices.append((center[0] + radius * math.cos(angle), center[1] + radius * math.sin(angle), center[2] + z))
        faces: list[tuple[int, ...]] = [tuple(range(segments - 1, -1, -1)), tuple(range(segments, segments * 2))]
        for index in range(segments):
            nxt = (index + 1) % segments
            faces.append((index, nxt, segments + nxt, segments + index))
        self._append(vertices, faces, material)

    def beam_between(self, start: Vec3, end: Vec3, thickness: float, material: str = "oak_dark") -> None:
        a = Vector(start)
        b = Vector(end)
        direction = b - a
        length = direction.length
        if length < 0.001:
            return
        x_axis = direction.normalized()
        helper = Vector((0.0, 0.0, 1.0))
        if abs(x_axis.dot(helper)) > 0.96:
            helper = Vector((0.0, 1.0, 0.0))
        y_axis = helper.cross(x_axis).normalized()
        z_axis = x_axis.cross(y_axis).normalized()
        matrix = Matrix((x_axis, y_axis, z_axis)).transposed().to_4x4()
        matrix.translation = (a + b) * 0.5
        sx, sy, sz = length * 0.5, thickness * 0.5, thickness * 0.5
        local = [
            (-sx, -sy, -sz), (sx, -sy, -sz), (sx, sy, -sz), (-sx, sy, -sz),
            (-sx, -sy, sz), (sx, -sy, sz), (sx, sy, sz), (-sx, sy, sz),
        ]
        vertices = [tuple(matrix @ Vector(vertex)) for vertex in local]
        faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        self._append(vertices, faces, material)

    def gable_prism(self, width: float, depth: float, height: float, base_z: float, material: str) -> None:
        hw = width * 0.5
        hd = depth * 0.5
        vertices = [
            (-hw, -hd, base_z), (hw, -hd, base_z), (0.0, -hd, base_z + height),
            (-hw, hd, base_z), (hw, hd, base_z), (0.0, hd, base_z + height),
        ]
        faces = [(0, 2, 1), (3, 4, 5), (0, 1, 4, 3), (1, 2, 5, 4), (2, 0, 3, 5)]
        self._append(vertices, faces, material)

    def roof_panel(
        self,
        width: float,
        slope_length: float,
        material: str,
        thickness: float = spec.ROOF_THICKNESS,
        pitch: float = spec.ROOF_PITCH,
    ) -> None:
        self.box((width, slope_length, thickness), material=material, rotation=(pitch, 0.0, 0.0))

    def arch_ring(self, width: float, height: float, depth: float, member: float, material: str, segments: int = 9) -> None:
        radius = width * 0.5
        spring = max(member, height - radius)
        self.box((member, depth, spring), (-radius + member * 0.5, 0.0, spring * 0.5), material)
        self.box((member, depth, spring), (radius - member * 0.5, 0.0, spring * 0.5), material)
        for index in range(segments):
            a0 = math.pi * index / segments
            a1 = math.pi * (index + 1) / segments
            start = ((radius - member * 0.5) * math.cos(a0), 0.0, spring + (radius - member * 0.5) * math.sin(a0))
            end = ((radius - member * 0.5) * math.cos(a1), 0.0, spring + (radius - member * 0.5) * math.sin(a1))
            self.beam_between(start, end, member, material)

    def irregular_stone_run(self, width: float, height: float, depth: float, material: str, course: float = 0.28) -> None:
        rows = max(1, int(round(height / course)))
        z = 0.0
        for row in range(rows):
            row_height = height / rows
            offset = -0.14 if row % 2 else 0.0
            x = -width * 0.5 + offset
            while x < width * 0.5 - 0.02:
                remaining = width * 0.5 - x
                stone_width = min(remaining, self.random.uniform(0.32, 0.62))
                if stone_width < 0.08:
                    break
                jitter_y = self.random.uniform(-0.018, 0.018)
                self.box(
                    (max(0.08, stone_width - 0.018), depth, max(0.08, row_height - 0.018)),
                    (x + stone_width * 0.5, jitter_y, z + row_height * 0.5),
                    material,
                    (0.0, self.random.uniform(-0.018, 0.018), self.random.uniform(-0.018, 0.018)),
                )
                x += stone_width
            z += row_height


BuildFn = Callable[[MeshBuilder], None]


@dataclass(frozen=True)
class PartDefinition:
    id: str
    family: str
    label: str
    tags: tuple[str, ...]
    build: BuildFn
    seams: tuple[str, ...] = ()
    opening_contract: str | None = None
    allow_nonmanifold: bool = False
    triangle_budget: int = spec.TRIANGLE_BUDGET_DEFAULT
    bevel: float = 0.018
    provenance: str = "authored"


@dataclass
class Registry:
    definitions: list[PartDefinition] = field(default_factory=list)
    _ids: set[str] = field(default_factory=set)

    def add(self, definition: PartDefinition) -> None:
        if definition.id in self._ids:
            raise ValueError(f"duplicate part id: {definition.id}")
        self._ids.add(definition.id)
        self.definitions.append(definition)

    def extend(self, definitions: Iterable[PartDefinition]) -> None:
        for definition in definitions:
            self.add(definition)


def create_part_object(definition: PartDefinition, materials: dict[str, bpy.types.Material], collection: bpy.types.Collection) -> bpy.types.Object:
    builder = MeshBuilder(definition.id)
    definition.build(builder)
    if not builder.vertices or not builder.faces:
        raise ValueError(f"{definition.id} generated no geometry")
    mesh = bpy.data.meshes.new(f"GK_Mesh_{definition.id}")
    mesh.from_pydata(builder.vertices, [], builder.faces)
    mesh.update(calc_edges=True)
    object_ = bpy.data.objects.new(f"GK_{definition.id}", mesh)
    collection.objects.link(object_)

    used_materials: list[str] = []
    for material_key in builder.face_materials:
        if material_key not in used_materials:
            used_materials.append(material_key)
    for material_key in used_materials:
        mesh.materials.append(materials[material_key])
    for polygon, material_key in zip(mesh.polygons, builder.face_materials):
        polygon.material_index = used_materials.index(material_key)
        polygon.use_smooth = False

    if definition.bevel > 0:
        modifier = object_.modifiers.new("GK_EdgeSoftening", "BEVEL")
        modifier.width = definition.bevel
        modifier.segments = 1

    object_["gk_id"] = definition.id
    object_["gk_family"] = definition.family
    object_["gk_label"] = definition.label
    object_["gk_tags"] = json.dumps(definition.tags)
    object_["gk_seams"] = json.dumps(definition.seams)
    object_["gk_origin_contract"] = "canonical local origin; X run, Y depth, Z up"
    object_["gk_opening_contract"] = definition.opening_contract or ""
    object_["gk_allow_nonmanifold"] = definition.allow_nonmanifold
    object_["gk_triangle_budget"] = definition.triangle_budget
    object_["gk_provenance"] = definition.provenance
    object_["gk_region"] = spec.REGION
    object_["gk_era"] = spec.ERA
    object_["gk_grid_m"] = spec.GRID
    object_.scale = (1.0, 1.0, 1.0)
    return object_


def triangulated_face_count(object_: bpy.types.Object) -> int:
    return sum(max(0, len(polygon.vertices) - 2) for polygon in object_.data.polygons)


def evaluated_triangle_count(object_: bpy.types.Object) -> int:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = object_.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        return sum(max(0, len(polygon.vertices) - 2) for polygon in mesh.polygons)
    finally:
        evaluated.to_mesh_clear()


def vertex_hash(object_: bpy.types.Object) -> str:
    digest = hashlib.sha256()
    for vertex in object_.data.vertices:
        digest.update(f"{vertex.co.x:.7f},{vertex.co.y:.7f},{vertex.co.z:.7f};".encode("ascii"))
    for polygon in object_.data.polygons:
        digest.update((",".join(str(index) for index in polygon.vertices) + ";").encode("ascii"))
    return digest.hexdigest()
