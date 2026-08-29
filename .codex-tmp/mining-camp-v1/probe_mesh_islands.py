import bpy
from collections import defaultdict, deque
from mathutils import Vector

for object_name in ("MiningCampSortingCanopy", "MiningCampDayShelter", "MiningCampToolRack"):
    obj = bpy.data.objects[object_name]
    mesh = obj.data
    adjacency = defaultdict(set)
    for polygon in mesh.polygons:
        vertices = list(polygon.vertices)
        for index, vertex in enumerate(vertices):
            adjacency[vertex].add(vertices[(index + 1) % len(vertices)])
            adjacency[vertices[(index + 1) % len(vertices)]].add(vertex)
    unseen = set(range(len(mesh.vertices)))
    islands = []
    while unseen:
        start = unseen.pop()
        queue = deque([start])
        island = {start}
        while queue:
            vertex = queue.popleft()
            for neighbor in adjacency[vertex]:
                if neighbor in unseen:
                    unseen.remove(neighbor)
                    island.add(neighbor)
                    queue.append(neighbor)
        islands.append(island)
    print(f"ISLAND_OBJECT {object_name} materials={[material.name for material in mesh.materials]} islands={len(islands)}")
    for index, island in enumerate(sorted(islands, key=lambda values: -len(values))):
        points = [mesh.vertices[vertex].co for vertex in island]
        minimum = Vector((min(point.x for point in points), min(point.y for point in points), min(point.z for point in points)))
        maximum = Vector((max(point.x for point in points), max(point.y for point in points), max(point.z for point in points)))
        material_indices = sorted({polygon.material_index for polygon in mesh.polygons if any(vertex in island for vertex in polygon.vertices)})
        print(f"  island={index} verts={len(island)} min={tuple(round(v,4) for v in minimum)} max={tuple(round(v,4) for v in maximum)} mats={material_indices}")
