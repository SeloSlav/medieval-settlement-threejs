from pathlib import Path

import bpy


scene = bpy.context.scene
scene.render.resolution_x = 1800
scene.render.resolution_y = 1200
scene.render.resolution_percentage = 100
root = Path(__file__).resolve().parent / "tier1-retopo-v25" / "renders"


def render_with_hidden(predicate, filename: str) -> None:
    objects = [obj for obj in scene.objects if predicate(obj)]
    previous = [obj.hide_render for obj in objects]
    for obj in objects:
        obj.hide_render = True
    scene.render.filepath = str(root / filename)
    bpy.ops.render.render(write_still=True)
    for obj, old in zip(objects, previous):
        obj.hide_render = old


render_with_hidden(
    lambda obj: obj.get("source_component_id") == "assembly_custom_retopped_shingle_skin",
    "diagnostic_without_roof_skins.png",
)
render_with_hidden(
    lambda obj: obj.get("source_component_id") != "assembly_custom_retopped_shingle_skin"
    and not obj.get("preview_only"),
    "diagnostic_roof_skins_only.png",
)
