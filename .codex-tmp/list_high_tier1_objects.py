import bpy
from mathutils import Vector


rows = []
for obj in bpy.context.scene.objects:
    if not obj.get("t1_instance") or obj.get("preview_only"):
        continue
    if obj.get("source_component_id") == "assembly_custom_retopped_shingle_skin":
        continue
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    minimum = [min(point[index] for point in points) for index in range(3)]
    maximum = [max(point[index] for point in points) for index in range(3)]
    if maximum[2] <= 2.8:
        continue
    rows.append(
        {
            "name": obj.name,
            "source": obj.get("source_component_id"),
            "dimensions": [round(maximum[i] - minimum[i], 4) for i in range(3)],
            "minimum": [round(value, 4) for value in minimum],
            "maximum": [round(value, 4) for value in maximum],
            "materials": [material.name for material in obj.data.materials],
        }
    )

print("HIGH_OBJECTS", rows)
