import bpy
from mathutils import Vector

for obj in bpy.context.scene.objects:
    if obj.type != "MESH" or not obj.get("t1_instance"):
        continue
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    xs = [point.x for point in points]
    ys = [point.y for point in points]
    zs = [point.z for point in points]
    span_x = max(xs) - min(xs)
    span_y = max(ys) - min(ys)
    if span_y > 3.0 or (max(zs) > 3.2 and span_x > 2.0):
        print(
            "ROOF_BOUNDS",
            obj.name,
            obj.get("source_component_id"),
            "x", round(min(xs), 3), round(max(xs), 3),
            "y", round(min(ys), 3), round(max(ys), 3),
            "z", round(min(zs), 3), round(max(zs), 3),
        )
