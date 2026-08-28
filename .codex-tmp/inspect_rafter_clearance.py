from pathlib import Path

import bpy
from mathutils.bvhtree import BVHTree


roof_objects = [
    obj for obj in bpy.context.scene.objects
    if obj.get("source_component_id") == "assembly_custom_retopped_shingle_skin"
]
rafter_objects = [
    obj for obj in bpy.context.scene.objects
    if obj.get("source_component_id") == "assembly_custom_common_rafter"
]

vertices = []
faces = []
for obj in roof_objects:
    offset = len(vertices)
    vertices.extend(obj.matrix_world @ vertex.co for vertex in obj.data.vertices)
    faces.extend(tuple(offset + index for index in polygon.vertices) for polygon in obj.data.polygons)

tree = BVHTree.FromPolygons(vertices, faces, all_triangles=False)
distances = []
for obj in rafter_objects:
    for vertex in obj.data.vertices:
        nearest = tree.find_nearest(obj.matrix_world @ vertex.co)
        if nearest is not None:
            distances.append(nearest[3])

print(
    "RAFTER_CLEARANCE",
    {
        "roofObjects": len(roof_objects),
        "rafterObjects": len(rafter_objects),
        "minimumMetres": round(min(distances), 5),
        "maximumMetres": round(max(distances), 5),
    },
)

for obj in rafter_objects:
    obj.visible_shadow = False

scene = bpy.context.scene
scene.render.resolution_x = 900
scene.render.resolution_y = 600
scene.render.resolution_percentage = 100
scene.render.filepath = str(Path(__file__).resolve().parent / "tier1-retopo-v24" / "renders" / "diagnostic_hero_rafters_no_shadow.png")
bpy.ops.render.render(write_still=True)
