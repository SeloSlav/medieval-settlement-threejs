import bpy


def flat_material(name: str, color: tuple[float, float, float, float]) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = color
    emission.inputs["Strength"].default_value = 1.0
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


black = flat_material("Diagnostic_Black", (0.01, 0.01, 0.01, 1.0))
base = flat_material("Diagnostic_BasePanels_Red", (0.9, 0.02, 0.02, 1.0))
overlap = flat_material("Diagnostic_Overlap_Green", (0.02, 0.9, 0.05, 1.0))
eave = flat_material("Diagnostic_Eave_Blue", (0.02, 0.1, 0.95, 1.0))
ridge = flat_material("Diagnostic_Ridge_Cyan", (0.02, 0.9, 0.9, 1.0))
frames = flat_material("Diagnostic_Frames_Yellow", (1.0, 0.75, 0.01, 1.0))

for obj in bpy.data.objects:
    if obj.type != "MESH":
        continue
    material = black
    if obj.name.startswith("T1_RoofOverlapCourse"):
        material = overlap
    elif obj.name.startswith("T1_Roof_"):
        material = base
    elif obj.name.startswith("T1_Eave_"):
        material = eave
    elif obj.name.startswith("T1_Ridge_"):
        material = ridge
    elif obj.name.startswith(("T1_CommonRafter", "T1_RoofTieBeam")):
        material = frames
    for index in range(len(obj.data.materials)):
        obj.data.materials[index] = material

scene = bpy.context.scene
scene.view_settings.look = "None"
scene.render.filepath = (
    "C:/WebProjects/medieval-road-system/art-source/gorski-architecture-kit/"
    "examples/tier1-residence/renders/diagnostic_roof_groups.png"
)
bpy.ops.render.render(write_still=True)
