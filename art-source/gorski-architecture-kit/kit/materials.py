from __future__ import annotations

import bpy

from .spec import MATERIAL_SPECS


def create_materials() -> dict[str, bpy.types.Material]:
    materials: dict[str, bpy.types.Material] = {}
    for key, (color, roughness, metallic) in MATERIAL_SPECS.items():
        name = f"GK_Mat_{key}"
        material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        material.use_fake_user = True
        material.diffuse_color = color
        material.use_nodes = True
        material["gk_material_key"] = key
        material["gk_palette_authority"] = "src/buildings/buildingMaterials.ts"
        bsdf = material.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = color
            bsdf.inputs["Roughness"].default_value = roughness
            bsdf.inputs["Metallic"].default_value = metallic
            if "Alpha" in bsdf.inputs:
                bsdf.inputs["Alpha"].default_value = color[3]
        if color[3] < 1.0:
            material.surface_render_method = "DITHERED"
        materials[key] = material
    return materials
