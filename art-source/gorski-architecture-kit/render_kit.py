from __future__ import annotations

import argparse
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parent

SHEETS = {
    "foundations": [
        "foundation_fieldstone_1m_h0p35m", "foundation_fieldstone_2m_h0p65m", "foundation_fieldstone_4m_h1p2m",
        "foundation_limestone_warm_2m_h0p65m", "foundation_corner_fieldstone_h1p2m", "foundation_pier_timber_0p42m",
        "foundation_pier_stone_0p65m", "foundation_pier_quarry_0p9m", "foundation_steps_limestone_1",
        "foundation_steps_limestone_3", "foundation_steps_limestone_5", "foundation_retaining_wall_4m",
    ],
    "walls": [
        "wall_limewash_0p5m_h2p7m", "wall_limewash_1m_h2p7m", "wall_limewash_2m_h2p7m", "wall_limewash_4m_h2p7m",
        "wall_ochre_2m_h2p7m", "wall_grey_2m_h2p7m", "wall_plank_2m_h2p4m", "wall_fieldstone_2m_h2p7m",
        "wall_limewash_2m_window_small_host", "wall_plank_2m_window_domestic_host", "wall_fieldstone_4m_window_shop_host",
        "wall_limewash_2m_door_house_host", "wall_plank_4m_door_barn_host", "wall_fieldstone_2m_louver_host",
        "gable_infill_plaster_4m", "gable_infill_timber_4m",
    ],
    "frames": [
        "frame_post_h2p4m_s0p16m", "frame_post_h2p7m_s0p22m", "frame_post_h4p5m_s0p3m", "frame_beam_4m_s0p16m",
        "frame_beam_4m_s0p22m", "frame_beam_4m_s0p3m", "frame_brace_left_2m", "frame_brace_right_4m",
        "frame_portal_service", "frame_portal_house", "frame_portal_barn", "frame_portal_cart",
        "frame_balcony_2m", "frame_balcony_4m", "frame_lean_to_2m", "frame_lean_to_4m",
    ],
    "openings": [
        "opening_window_tiny_plain", "opening_window_small_shuttered", "opening_window_domestic_plain", "opening_window_domestic_leaded",
        "opening_window_shop_plain", "opening_louver_plain", "opening_window_lancet_stone", "opening_window_lancet_deep",
        "opening_window_lancet_pair", "opening_window_oculus_stone", "opening_window_belfry_louver_arch", "opening_shrine_icon_insert",
        "opening_door_service_single", "opening_door_house_single", "opening_door_barn_double", "opening_door_barn_open-double",
        "opening_stable_half_door", "opening_church_arch_door", "opening_church_arch_door_double", "opening_church_portal_surround",
    ],
    "roofs": [
        "roof_shingle_panel_1m_quarter", "roof_shingle_panel_2m_half", "roof_shingle_panel_4m_full", "roof_shingle_ridge_4m",
        "roof_tile_panel_1m_quarter", "roof_tile_panel_2m_half", "roof_tile_panel_4m_full", "roof_tile_ridge_4m",
        "roof_thatch_panel_1m_quarter", "roof_thatch_panel_2m_half", "roof_thatch_panel_4m_full", "roof_thatch_ridge_4m",
        "roof_shingle_eave_edge_4m", "roof_tile_eave_edge_4m", "roof_thatch_eave_edge_4m", "roof_thatch_smoke_vent",
        "roof_shingle_hip_cap_full", "roof_tile_hip_cap_full", "roof_shingle_apse_halfcone_3m", "roof_tile_apse_halfcone_3m",
        "roof_shingle_belfry_pyramid_2m", "roof_tile_belfry_pyramid_2m", "roof_shingle_shrine_gable_1p5m", "roof_tile_chimney_flashing",
        "roof_shingle_dormer_cap_1p2m", "roof_tile_dormer_cap_1p2m", "roof_shingle_halfhip_end_2p4m", "roof_tile_halfhip_end_2p4m",
    ],
    "enclosures": [
        "enclosure_split_rail_4m", "enclosure_split_rail_corner", "enclosure_split_rail_gate_cart",
        "enclosure_wattle_4m", "enclosure_wattle_corner", "enclosure_wattle_gate_person",
        "enclosure_dry_stone_4m", "enclosure_dry_stone_corner", "enclosure_dry_stone_gate_cart",
        "enclosure_palisade_4m", "enclosure_palisade_corner", "enclosure_palisade_gate_cart",
        "enclosure_parish_wall_4m", "enclosure_parish_wall_gate_person", "enclosure_livestock_hurdle_2m", "enclosure_graveyard_cross_rail_2m",
    ],
    "siteworks": [
        "site_canopy_timber_4m_d4m", "site_canopy_canvas_4m_d2m", "site_walkway_plank_4m", "site_bridge_deck_4m",
        "site_bridge_railing_4m", "site_dock_segment_4m", "site_well_shelter_shingle", "site_well_curb_r1m",
        "site_market_stall_shingle", "site_market_stall_canvas", "site_tent_a_frame_large", "site_campfire_hearth",
        "site_grave_marker_cross", "site_grave_marker_slab", "site_road_culvert_stone_2m", "site_walkway_plank_2m",
    ],
    "extraction": [
        "extract_shaft_collar_round_small", "extract_shaft_collar_square_large", "extract_headframe_small", "extract_headframe_large",
        "extract_quarry_derrick_small", "extract_quarry_derrick_large", "extract_mine_portal_frame_2p4m", "extract_tunnel_support_4m",
        "extract_quarry_bench_4m", "extract_stockpile_stone_large", "extract_stockpile_iron_large", "extract_sorting_bench",
        "extract_sieve_table", "extract_handcart", "extract_ore_bucket", "extract_windlass",
    ],
    "production": [
        "production_waterwheel_d3p6m", "production_windmill_sails_6m", "production_gearwheel_d2p2m", "production_chimney_limestone_h4m",
        "production_smithy_forge", "production_smithy_anvil_block", "production_potter_kiln_round", "production_bakery_oven",
        "production_charcoal_clamp_large", "production_brew_vat_large", "production_brew_kettle", "production_carpenter_bench",
        "production_sawpit_frame", "production_tanning_frame_4m", "production_warp_weighted_loom", "production_screw_press",
    ],
    "agriculture": [
        "agri_hayrack_4m", "agri_vine_trellis_6m", "agri_crop_strip_4m", "agri_field_marker_flax",
        "agri_orchard_guard_apple", "agri_threshed_floor_round", "agri_winnowing_screen", "agri_granary_stilt_set",
        "agri_grain_bin_large", "agri_livestock_trough_4m", "agri_goat_stand", "agri_pig_shelter",
        "agri_chicken_roost", "agri_apiary_stand_9", "agri_scarecrow", "agri_garden_coldframe",
    ],
    "civic": [
        "civic_belfry_frame_small", "civic_bell_large", "civic_cloister_arcade_4m", "civic_town_balustrade_4m",
        "civic_chapel_apse_halfround", "civic_chapel_nave_bay_lancet_4m", "civic_chapel_facade_gable_4m", "civic_chapel_buttress_tall",
        "civic_shrine_canopy", "civic_shrine_niche_stone", "civic_shrine_plinth_stone", "civic_shrine_votive_ledge",
        "civic_watch_platform_4m", "civic_hoarding_panel_4m", "civic_watch_ladder_4m", "civic_guard_brazier",
        "civic_refuge_gate_crown", "civic_town_notice_board", "civic_market_scale", "civic_granary_vent_cupola",
    ],
    "props": [
        "prop_barrel_large", "prop_crate_large", "prop_sack_stack_large", "prop_firewood_stack_large",
        "prop_log_stack_4p0m", "prop_ladder_4p0m", "prop_tool_rack_smith", "prop_signpost_mine",
        "prop_two_wheel_cart", "prop_sledge", "prop_fish_drying_rack", "prop_boat_dugout",
        "prop_firewood_chopping_block", "prop_water_bucket_pair", "prop_hitching_rail_2m", "prop_salvage_pile",
    ],
    "religious-detail": [
        "civic_chapel_nave_bay_plain_4m", "civic_chapel_nave_bay_lancet_4m", "civic_chapel_facade_gable_4m", "civic_chapel_apse_halfround",
        "civic_chapel_buttress_low", "civic_chapel_buttress_tall", "civic_chapel_sacristy_junction", "civic_chapel_belfry_transition",
        "civic_chapel_cornice_4m", "civic_chapel_gable_trim_4m", "civic_chapel_quoin_stack_3p4m", "civic_monastery_cell_bay_4m",
        "opening_window_lancet_deep", "opening_window_lancet_pair", "opening_window_oculus_stone", "opening_window_belfry_louver_arch",
        "opening_church_arch_door_double", "opening_church_portal_surround", "civic_belfry_frame_small", "civic_bell_small",
        "roof_tile_apse_halfcone_3m", "roof_tile_belfry_pyramid_2m", "civic_church_cross_iron_large", "civic_church_cross_stone",
        "civic_shrine_niche_stone", "opening_shrine_icon_insert", "civic_shrine_votive_ledge", "civic_shrine_half_column_pair",
        "civic_shrine_canopy", "roof_shingle_shrine_gable_1p5m", "civic_shrine_iron_cross", "civic_shrine_plinth_stone",
    ],
    "residence-roof-progression": [
        "roof_thatch_panel_4m_full", "roof_thatch_ridge_4m", "roof_thatch_eave_edge_4m", "roof_thatch_smoke_vent",
        "roof_shingle_panel_4m_full", "roof_shingle_ridge_4m", "roof_shingle_eave_edge_4m", "roof_shingle_repair_patch_1m",
        "roof_tile_panel_4m_full", "roof_tile_ridge_4m", "roof_tile_eave_edge_4m", "roof_tile_repair_patch_1m",
        "roof_shingle_chimney_flashing", "roof_tile_chimney_flashing", "roof_dormer_frame_2m", "roof_snow_catch_2m",
        "roof_shingle_hip_cap_full", "roof_tile_hip_cap_full", "roof_gable_finial_timber", "roof_tile_ridge_endcap",
        "roof_shingle_dormer_cap_1p2m", "roof_tile_dormer_cap_1p2m", "roof_shingle_halfhip_end_2p4m", "roof_tile_halfhip_end_2p4m",
    ],
}

OVERVIEW = [
    "foundation_fieldstone_4m_h1p2m", "wall_limewash_4m_door_barn_host", "frame_portal_cart", "opening_church_arch_door",
    "roof_shingle_panel_4m_full", "enclosure_dry_stone_gate_cart", "site_market_stall_canvas", "extract_headframe_large",
    "production_waterwheel_d3p6m", "agri_apiary_stand_9", "civic_belfry_frame_large", "prop_two_wheel_cart",
]


def _args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Render architecture kit overview and family contact sheets.")
    parser.add_argument("--out", type=Path, default=ROOT / "renders")
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])


def _look_at(object_: bpy.types.Object, target: tuple[float, float, float]) -> None:
    direction = Vector(target) - object_.location
    object_.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def _face_camera(object_: bpy.types.Object, camera: bpy.types.Object) -> None:
    direction = camera.location - object_.location
    object_.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()


def _setup_render() -> tuple[bpy.types.Object, bpy.types.Object, bpy.types.Material]:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1800
    scene.render.resolution_y = 1200
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("GK_RenderWorld")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.028, 0.036, 0.042, 1.0)
    background.inputs["Strength"].default_value = 0.28

    camera_data = bpy.data.cameras.new("GK_RenderCamera")
    camera = bpy.data.objects.new("GK_RenderCamera", camera_data)
    scene.collection.objects.link(camera)
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 31.0
    scene.camera = camera

    sun_data = bpy.data.lights.new("GK_Sun", "SUN")
    sun = bpy.data.objects.new("GK_Sun", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(32), math.radians(-24), math.radians(-38))
    sun.data.energy = 2.0
    sun.data.angle = math.radians(12)

    area_data = bpy.data.lights.new("GK_Area", "AREA")
    area = bpy.data.objects.new("GK_Area", area_data)
    scene.collection.objects.link(area)
    area.location = (-10.0, -18.0, 22.0)
    area.data.energy = 1800.0
    area.data.shape = "DISK"
    area.data.size = 14.0
    _look_at(area, (10.0, 8.0, 2.0))

    label_material = bpy.data.materials.new("GK_Label")
    label_material.diffuse_color = (0.78, 0.86, 0.85, 1.0)
    label_material.use_nodes = True
    bsdf = label_material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = label_material.diffuse_color
    bsdf.inputs["Roughness"].default_value = 0.86
    return camera, sun, label_material


def _add_ground(material: bpy.types.Material) -> bpy.types.Object:
    bpy.ops.mesh.primitive_plane_add(size=85.0, location=(10.0, 8.0, -0.035))
    ground = bpy.context.active_object
    ground.name = "GK_RenderGround"
    ground.data.materials.append(material)
    return ground


def _ground_material() -> bpy.types.Material:
    material = bpy.data.materials.new("GK_RenderGround")
    material.diffuse_color = (0.085, 0.105, 0.11, 1.0)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = material.diffuse_color
    bsdf.inputs["Roughness"].default_value = 0.98
    return material


def _clear_labels() -> None:
    for object_ in list(bpy.data.objects):
        if object_.name.startswith("GK_Label_"):
            bpy.data.objects.remove(object_, do_unlink=True)


def _short_label(part_id: str) -> str:
    tokens = part_id.split("_")
    return " ".join(tokens[1:])[:34]


def _set_sheet(part_ids: list[str], title: str, camera: bpy.types.Object, label_material: bpy.types.Material) -> None:
    all_parts = [object_ for object_ in bpy.data.objects if object_.type == "MESH" and object_.get("gk_id")]
    by_id = {object_["gk_id"]: object_ for object_ in all_parts}
    unknown = sorted(set(part_ids) - set(by_id))
    if unknown:
        raise ValueError(f"render selection contains unknown ids: {unknown}")
    for object_ in all_parts:
        object_.hide_render = True
    _clear_labels()
    columns = 4
    x_step = 7.6
    y_step = 6.2
    rows = math.ceil(len(part_ids) / columns)
    center = (11.4, (rows - 1) * y_step * 0.5, 1.7)
    camera.location = (-16.0, -24.0, 25.0)
    _look_at(camera, center)
    camera.data.ortho_scale = 39.0 if rows >= 4 else 34.0
    for index, part_id in enumerate(part_ids):
        object_ = by_id[part_id]
        column = index % columns
        row = index // columns
        x = column * x_step
        y = row * y_step
        object_.location = (x, y, 0.0)
        object_.rotation_euler = (0.0, 0.0, 0.0)
        object_.hide_render = False
        max_z = max(corner[2] for corner in object_.bound_box)
        curve = bpy.data.curves.new(f"GK_LabelCurve_{index}", "FONT")
        curve.body = _short_label(part_id)
        curve.align_x = "CENTER"
        curve.align_y = "CENTER"
        curve.size = 0.42
        curve.extrude = 0.004
        curve.materials.append(label_material)
        label = bpy.data.objects.new(f"GK_Label_{index:02d}", curve)
        bpy.context.scene.collection.objects.link(label)
        label.location = (x, y - 0.65, max_z + 0.62)
        _face_camera(label, camera)


def main() -> None:
    args = _args()
    out_dir = args.out.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    camera, _sun, label_material = _setup_render()
    ground = _add_ground(_ground_material())

    _set_sheet(OVERVIEW, "Gorski Kotar / Primorje 1550 modular component kit", camera, label_material)
    bpy.context.scene.render.filepath = str(out_dir / "00-overview.png")
    bpy.ops.render.render(write_still=True)
    print(f"GK_RENDERED {bpy.context.scene.render.filepath}")

    for index, (family, part_ids) in enumerate(SHEETS.items(), start=1):
        _set_sheet(part_ids, f"{family} — modular components", camera, label_material)
        ground.hide_render = False
        path = out_dir / f"{index:02d}-{family}.png"
        bpy.context.scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        print(f"GK_RENDERED {path}")

    print(f"GK_RENDER_OK sheets={len(SHEETS) + 1} out={out_dir}")


if __name__ == "__main__":
    main()
