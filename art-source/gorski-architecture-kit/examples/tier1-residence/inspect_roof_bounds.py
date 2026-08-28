import math

import bmesh
import bpy
from mathutils import Vector


PITCH = math.radians(50.0)
RIDGE_Z = 5.1335
DOWNSLOPE = Vector((math.cos(PITCH), 0.0, -math.sin(PITCH)))
RIDGE = Vector((0.0, 0.0, RIDGE_Z))


def slope_distance(point: Vector) -> float:
    return (point - RIDGE).dot(DOWNSLOPE)


for name in (
    "T1_Roof_Right_Run00_full",
    "T1_Roof_Right_Run00_half",
    "T1_Roof_Right_Run00_quarter",
    "T1_RoofOverlapCourse_Right_Run00",
):
    obj = bpy.data.objects.get(name)
    if obj is None:
        print(f"BOUNDS missing {name}")
        continue
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    remaining = set(bm.faces)
    components = []
    while remaining:
        seed = remaining.pop()
        faces = {seed}
        frontier = [seed]
        while frontier:
            face = frontier.pop()
            for edge in face.edges:
                for neighbour in edge.link_faces:
                    if neighbour in remaining:
                        remaining.remove(neighbour)
                        faces.add(neighbour)
                        frontier.append(neighbour)
        vertices = {vertex for face in faces for vertex in face.verts}
        distances = [slope_distance(obj.matrix_world @ vertex.co) for vertex in vertices]
        materials = sorted({obj.data.materials[face.material_index].name for face in faces})
        components.append((min(distances), max(distances), materials))
    bm.free()
    components.sort()
    print(f"BOUNDS {name} components={len(components)} overall={components[0][0]:.4f}..{max(item[1] for item in components):.4f}")
    for component in components:
        print(f"  {component[0]:.4f}..{component[1]:.4f} {component[2]}")
