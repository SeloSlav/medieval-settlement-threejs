from __future__ import annotations

import math
from pathlib import Path

import bpy
from mathutils import Vector


SOURCE_DIR = Path(r"C:\Users\Asus\Downloads")
OUTPUT_DIR = Path(r"C:\WebProjects\medieval-road-system\.codex-tmp\residence-reference-renders")


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.images):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)


def scene_bounds() -> tuple[Vector, Vector]:
    points: list[Vector] = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    return (
        Vector(tuple(min(point[axis] for point in points) for axis in range(3))),
        Vector(tuple(max(point[axis] for point in points) for axis in range(3))),
    )


def point_at(obj: bpy.types.Object, target: Vector) -> None:
    obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_area(name: str, location: tuple[float, float, float], energy: float, size: float) -> None:
    data = bpy.data.lights.new(name, type="AREA")
    data.energy = energy
    data.shape = "DISK"
    data.size = size
    light = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(light)
    light.location = location
    point_at(light, Vector((0.0, 0.0, 1.5)))


def render_tier(tier: int) -> None:
    clear_scene()
    source = SOURCE_DIR / f"civic_residence_tier_{tier}.glb"
    bpy.ops.import_scene.gltf(filepath=str(source))
    minimum, maximum = scene_bounds()
    size = maximum - minimum
    center = (minimum + maximum) * 0.5
    span = max(size.x, size.y, size.z)

    ground_data = bpy.data.meshes.new("ReferenceGroundMesh")
    ground = bpy.data.objects.new("ReferenceGround", ground_data)
    bpy.context.scene.collection.objects.link(ground)
    half = span * 1.8
    ground_data.from_pydata(
        [(-half, -half, minimum.z), (half, -half, minimum.z), (half, half, minimum.z), (-half, half, minimum.z)],
        [],
        [(0, 1, 2, 3)],
    )
    ground_material = bpy.data.materials.new("ReferenceGroundMaterial")
    ground_material.diffuse_color = (0.18, 0.21, 0.14, 1.0)
    ground.data.materials.append(ground_material)

    camera_data = bpy.data.cameras.new("ReferenceCamera")
    camera = bpy.data.objects.new("ReferenceCamera", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    camera.location = center + Vector((span * 1.45, -span * 1.75, span * 1.15))
    camera.data.lens = 58
    point_at(camera, center + Vector((0.0, 0.0, size.z * 0.05)))
    bpy.context.scene.camera = camera

    add_area("Key", (span * -1.5, span * -2.0, span * 2.7), 1100, span * 3.0)
    add_area("Fill", (span * 2.0, span * 1.2, span * 1.5), 650, span * 2.0)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world.color = (0.055, 0.065, 0.045)
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.render.filepath = str(OUTPUT_DIR / f"civic_residence_tier_{tier}_reference.png")
    bpy.ops.render.render(write_still=True)


OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
for current_tier in range(1, 5):
    render_tier(current_tier)
