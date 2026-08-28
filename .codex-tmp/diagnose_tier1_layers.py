from pathlib import Path

import bpy

root = Path(__file__).resolve().parent / "tier1-retopo-v24" / "renders"
scene = bpy.context.scene
scene.render.resolution_x = 900
scene.render.resolution_y = 600
scene.render.resolution_percentage = 100

def render_without(collection_name: str, filename: str) -> None:
    objects = [
        obj for obj in bpy.context.scene.objects
        if str(obj.get("assembly_role", "")) == collection_name
    ]
    previous = [obj.hide_render for obj in objects]
    for obj in objects:
        obj.hide_render = True
    scene.render.filepath = str(root / filename)
    bpy.ops.render.render(write_still=True)
    for obj, value in zip(objects, previous):
        obj.hide_render = value

render_without("T1_04_Frames", "diagnostic_side_no_frames.png")
render_without("T1_02_Walls", "diagnostic_side_no_walls.png")

def render_without_sources(prefixes: tuple[str, ...], filename: str) -> None:
    objects = [
        obj for obj in bpy.context.scene.objects
        if str(obj.get("source_component_id", "")).startswith(prefixes)
    ]
    previous = [obj.hide_render for obj in objects]
    for obj in objects:
        obj.hide_render = True
    scene.render.filepath = str(root / filename)
    bpy.ops.render.render(write_still=True)
    for obj, value in zip(objects, previous):
        obj.hide_render = value

render_without_sources(("assembly_custom_common_rafter",), "diagnostic_hero_no_rafters.png")
render_without_sources(("assembly_custom_roof_tie_beam",), "diagnostic_hero_no_ties.png")
render_without_sources(("frame_beam_", "frame_post_"), "diagnostic_hero_no_wall_frame.png")
