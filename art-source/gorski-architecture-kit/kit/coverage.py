from __future__ import annotations


DOMESTIC = (
    "foundation_fieldstone_4m_h0p65m",
    "wall_limewash_4m_h2p7m",
    "wall_limewash_2m_window_domestic_host",
    "opening_window_domestic_shuttered",
    "opening_door_house_single",
    "roof_shingle_panel_4m_full",
    "roof_shingle_ridge_4m",
)
HUMBLE = (
    "foundation_fieldstone_2m_h0p35m",
    "wall_plank_4m_h2p4m",
    "wall_plank_2m_window_small_host",
    "opening_window_small_shuttered",
    "opening_door_service_single",
    "roof_shingle_panel_4m_full",
)
WORKSHOP = (
    "foundation_fieldstone_4m_h0p65m",
    "wall_limewash_4m_h2p7m",
    "wall_limewash_4m_door_barn_host",
    "opening_door_barn_double",
    "frame_lean_to_4m",
    "site_canopy_timber_4m_d2m",
    "production_chimney_limestone_h4m",
)
BARN = (
    "foundation_pier_stone_0p65m",
    "wall_plank_4m_h3m",
    "wall_plank_4m_door_barn_host",
    "opening_door_barn_double",
    "opening_barn_loft_hatch",
    "frame_portal_barn",
    "roof_shingle_panel_4m_full",
)
STONE_CIVIC = (
    "foundation_limestone_warm_4m_h1p2m",
    "wall_limewash_4m_h3m",
    "wall_fieldstone_2m_window_domestic_host",
    "opening_window_domestic_plain",
    "opening_door_house_single",
    "roof_tile_panel_4m_full",
)


def _entry(group: str, rationale: str, *part_groups: tuple[str, ...] | str) -> dict[str, object]:
    parts: list[str] = []
    for group_value in part_groups:
        values = (group_value,) if isinstance(group_value, str) else group_value
        for value in values:
            if value not in parts:
                parts.append(value)
    return {"group": group, "rationale": rationale, "parts": parts}


BUILDING_COVERAGE = {
    "founders_camp": _entry("founding", "Temporary, demountable founding compound.", "site_tent_a_frame_large", "site_canopy_canvas_4m_d4m", "site_campfire_hearth", "prop_salvage_pile", "enclosure_wattle_4m"),
    "salvage_pile": _entry("founding", "Loose recovered construction stock.", "prop_salvage_pile", "prop_log_stack_2p0m", "prop_crate_large", "prop_sack_stack_medium"),
    "lumber_mill": _entry(
        "forestry",
        "Long, low plank saw hall with a six-metre structural gable, open intake canopy, sawpit frame, and state-owned roundwood yard.",
        "foundation_fieldstone_4m_h0p65m", "wall_plank_4m_h3m", "wall_plank_2m_h3m",
        "gable_infill_timber_6m", "frame_gable_truss_6m", "frame_post_h3m_s0p22m", "frame_beam_4m_s0p22m",
        "site_canopy_timber_6m_d3m", "production_sawpit_frame", "prop_log_stack_4p0m", "prop_two_wheel_cart",
    ),
    "reforester": _entry("forestry", "Humble woodland shelter with tools and sapling guards.", HUMBLE, "site_canopy_timber_2m_d2m", "prop_tool_rack_farm", "agri_orchard_guard_apple"),
    "woodcutters_lodge": _entry("forestry", "Humble timber lodge with fuel-processing yard.", HUMBLE, "prop_firewood_chopping_block", "prop_firewood_stack_large", "prop_sledge"),
    "stone_quarry": _entry(
        "extraction",
        "Low mobile day-work camp for finite surface stone, iron, salt, and clay deposits; no centered excavation or deep hoisting silhouette.",
        "site_tent_a_frame_large", "site_canopy_canvas_4m_d4m", "extract_sorting_bench", "extract_sieve_table",
        "extract_handcart", "extract_survey_stakes", "prop_tool_rack_quarry", "prop_water_bucket_pair",
        "extract_stockpile_stone_small", "extract_stockpile_iron_small", "extract_stockpile_salt_small", "extract_stockpile_clay_small",
    ),
    "large_quarry": _entry("extraction", "Expanded cut benches with heavy derrick and sorting floor.", "extract_quarry_bench_4m", "extract_quarry_derrick_large", "extract_stockpile_stone_large", "extract_sorting_bench", "extract_handcart", "foundation_retaining_wall_4m"),
    "mine": _entry("extraction", "Shaft/tunnel works use explicit collars, headframes, supports, and hoisting.", "extract_shaft_collar_square_large", "extract_headframe_large", "extract_mine_portal_frame_2p4m", "extract_tunnel_support_4m", "extract_ore_bucket", "extract_windlass", "extract_stockpile_iron_large"),
    "clay_pit": _entry("extraction", "Open clay washing and screening worksite.", "extract_quarry_bench_2m", "extract_clay_pit_screen", "extract_stockpile_clay_large", "site_walkway_plank_4m", "site_canopy_canvas_4m_d2m"),
    "charcoal_burner": _entry("production", "Charcoal clamps and a weather shelter define the yard.", "production_charcoal_clamp_small", "production_charcoal_clamp_large", "site_canopy_canvas_2m_d2m", "prop_firewood_stack_large", "prop_water_bucket_pair"),
    "smithy": _entry("production", "Masonry workshop identified by open forge and tall flue.", WORKSHOP, "production_smithy_forge", "production_smithy_anvil_block", "prop_tool_rack_smith"),
    "potter_kiln": _entry("production", "Clay-working workshop with an external updraft kiln.", WORKSHOP, "production_potter_kiln_round", "extract_clay_pit_screen", "prop_crate_medium"),
    "well": _entry("infrastructure", "Stone curb, windlass shelter, and buckets.", "site_well_curb_r1m", "site_well_shelter_shingle", "prop_water_bucket_pair", "site_walkway_plank_2m"),
    "hunters_hall": _entry(
        "subsistence",
        "Open woodland hunting camp with a sewn canvas sleeping tent, stitched-hide processing fly, hearth, and authored hunter tools.",
        "site_tent_a_frame_large",
        "site_hunter_hide_fly_4m_d2m",
        "site_campfire_hearth",
        "site_camp_cooking_tripod",
        "prop_tool_rack_hunter",
        "prop_camp_worktable",
        "site_hunter_boundary_rail_2m",
        "prop_water_bucket_pair",
    ),
    "foragers_shed": _entry("subsistence", "Very small timber storage and drying shelter.", HUMBLE, "site_canopy_timber_2m_d2m", "production_malt_rack_2m", "prop_crate_small"),
    "fishing_camp": _entry("subsistence", "Compact fish house and plank service shed with a hollow river dugout, drying rack, open working fence, and shore access.", HUMBLE, "site_dock_segment_4m", "prop_boat_dugout", "prop_fish_drying_rack", "prop_tool_rack_fishing", "enclosure_split_rail_4m", "enclosure_wattle_gate_person"),
    "chapel": _entry(
        "religious",
        "Complete parish-church vocabulary: authored nave and west-front bays, portal, multiple window forms, buttresses, apse and sacristy junctions, belfry transitions, distinct tiled roof forms, bells, and ridge crosses.",
        "foundation_limestone_warm_4m_h1p2m", "civic_chapel_nave_bay_plain_4m", "civic_chapel_nave_bay_lancet_4m",
        "civic_chapel_facade_gable_4m", "civic_chapel_buttress_low", "civic_chapel_buttress_tall", "civic_chapel_apse_halfround",
        "civic_chapel_sacristy_junction", "civic_chapel_cornice_4m", "civic_chapel_gable_trim_4m", "civic_chapel_quoin_stack_3p4m",
        "opening_window_lancet_deep", "opening_window_lancet_pair", "opening_window_oculus_stone",
        "opening_window_belfry_louver_arch", "opening_church_arch_door_double", "opening_church_portal_surround",
        "civic_chapel_belfry_transition", "civic_belfry_frame_small", "civic_bell_small", "roof_tile_panel_4m_full",
        "roof_tile_ridge_4m", "roof_tile_apse_halfcone_3m", "roof_tile_belfry_pyramid_2m", "roof_tile_chimney_flashing",
        "roof_tile_halfhip_end_2p4m", "roof_tile_cross_gable_valley_2m", "civic_church_cross_iron_large", "enclosure_parish_wall_gate_person", "foundation_steps_limestone_5",
    ),
    "wayside_shrine": _entry(
        "religious",
        "Componentized roadside devotion with worn plinth, masonry niche, icon insert, carved columns, votive ledge, gabled canopy roof, iron cross, steps, and optional low rail.",
        "civic_shrine_plinth_stone", "civic_shrine_niche_stone", "civic_shrine_rear_wall_limewash_1p5m", "opening_shrine_icon_insert", "civic_shrine_half_column_pair",
        "civic_shrine_votive_ledge", "civic_shrine_canopy", "roof_shingle_shrine_gable_1p5m", "civic_shrine_iron_cross",
        "foundation_steps_limestone_1", "civic_shrine_side_rail_2m", "frame_lattice_panel_1m", "frame_scalloped_fascia_2m",
    ),
    "marketplace": _entry("civic", "Modular covered stalls, arched/curved frame vocabulary, and public weighing equipment.", "site_market_stall_canvas", "site_market_stall_shingle", "frame_arch_portal_2p4m", "frame_curved_bracket_left_1m", "frame_curved_bracket_right_1m", "civic_market_scale", "civic_town_notice_board", "prop_crate_medium"),
    "trading_post": _entry("civic", "Domestic-commercial shell with shop opening, sign, and loading stock.", DOMESTIC, "wall_limewash_4m_window_shop_host", "opening_window_shop_plain", "civic_trade_sign_hanging", "prop_barrel_medium", "prop_crate_large"),
    "town_hall": _entry("civic", "Tall limewashed civic frontage with stone steps, public balcony, carved gallery crowns, and restrained fascia.", STONE_CIVIC, "civic_town_balustrade_4m", "frame_gallery_post_cap", "frame_scalloped_fascia_4m", "civic_town_notice_board", "foundation_steps_limestone_5"),
    "stable": _entry("service", "Large timber and arched cart portals, split doors, hay loading, and hitching rail.", BARN, "frame_arch_portal_2p4m", "opening_stable_half_door", "civic_stable_hayhood", "prop_hitching_rail_2m", "agri_livestock_trough_4m"),
    "village_storehouse": _entry("service", "Raised stone base, wide doors, and loading hood.", BARN, "foundation_fieldstone_4m_h1p2m", "civic_storehouse_loading_hood", "prop_barrel_large", "prop_sack_stack_large"),
    "watchtower": _entry("defence", "Tall structural posts with platform, hoarding, and ladder.", "frame_post_h4p5m_s0p3m", "civic_watch_platform_4m", "civic_hoarding_panel_4m", "civic_watch_ladder_4m", "roof_shingle_panel_4m_half"),
    "guardhouse": _entry("defence", "Compact defended gate service building.", HUMBLE, "frame_portal_cart", "civic_hoarding_panel_2m", "civic_guard_brazier", "enclosure_palisade_gate_cart"),
    "palisaded_refuge": _entry("defence", "Reusable palisade spans, corners, gates, and watch elements.", "enclosure_palisade_4m", "enclosure_palisade_corner", "enclosure_palisade_gate_cart", "civic_refuge_gate_crown", "civic_watch_platform_2m"),
    "threshing_barn": _entry("agriculture", "Large ventilated barn with threshing floor and winnowing screen.", BARN, "agri_threshed_floor_round", "agri_winnowing_screen", "agri_barn_hay_hoist"),
    "pastoral_farmstead": _entry("agriculture", "Stone-and-timber house/barn language with livestock yard modules.", DOMESTIC, "agri_hayrack_4m", "agri_livestock_trough_4m", "enclosure_split_rail_4m"),
    "swineherd": _entry("agriculture", "Humble shelter with low pig pen fittings.", HUMBLE, "agri_pig_shelter", "agri_feed_manger_2m", "enclosure_wattle_gate_person"),
    "monastery": _entry("religious", "Pauline stone/tile compound vocabulary includes cell facade bays, cloister spans and corners, lancets, oculus, belfry, apse roof, and service production.", STONE_CIVIC, "civic_monastery_cell_bay_4m", "civic_cloister_arcade_4m", "civic_cloister_corner", "opening_window_lancet_pair", "opening_window_oculus_stone", "civic_belfry_frame_large", "roof_tile_belfry_pyramid_2m", "roof_tile_apse_halfcone_3m", "production_dye_vat_small", "agri_garden_coldframe"),
    "brewery": _entry("production", "Fired brewing room, coopered vats, and malt racks.", WORKSHOP, "production_brew_vat_large", "production_brew_kettle", "production_malt_rack_2m", "production_screw_press"),
    "tavern": _entry("civic", "Domestic-commercial building distinguished by gallery and hanging sign.", DOMESTIC, "civic_tavern_gallery_4m", "civic_trade_sign_hanging", "prop_barrel_large"),
    "smokehouse": _entry("production", "Compact dark timber shell with smoke racks and tall flue.", HUMBLE, "production_smoke_rack_2m", "production_chimney_limestone_h4m", "prop_firewood_stack_medium"),
    "granary": _entry("agriculture", "Raised vermin-resistant storage with bins and vent cupola.", BARN, "agri_granary_stilt_set", "agri_grain_bin_large", "civic_granary_vent_cupola", "prop_sack_stack_large"),
    "bakery": _entry("production", "Limewashed workshop with masonry oven and firewood.", WORKSHOP, "production_bakery_oven", "prop_firewood_stack_medium", "prop_sack_stack_medium"),
    "apiary": _entry("agriculture", "Expandable log-hive stands with low wattle enclosure.", "agri_apiary_stand_9", "agri_apiary_stand_3", "enclosure_wattle_4m", "site_canopy_timber_2m_d2m"),
    "watermill": _entry("production", "River mill signature combines wheel, axle, gears, and dock/walkway.", WORKSHOP, "production_waterwheel_d3p6m", "production_drive_axle_4m", "production_gearwheel_d1p4m", "site_dock_segment_4m"),
    "windmill": _entry("production", "High timber frame with full sail and gear modules.", "foundation_limestone_warm_4m_h1p2m", "frame_post_h4p5m_s0p3m", "production_windmill_sails_8m", "production_drive_axle_4m", "production_gearwheel_d2p2m", "roof_shingle_panel_4m_full"),
    "carpenter": _entry("production", "Open-sided timber workshop with sawpit and bench.", WORKSHOP, "production_carpenter_bench", "production_sawpit_frame", "prop_tool_rack_carpenter", "prop_log_stack_2p0m"),
    "spinning_retting_house": _entry("production", "Flax retting trough and spinning equipment beside a humble workhouse.", HUMBLE, "production_retting_trough", "production_spinning_wheel", "agri_field_marker_flax"),
    "weaver": _entry("production", "Domestic workshop with loom and dye vats.", DOMESTIC, "production_warp_weighted_loom", "production_dye_vat_large", "prop_crate_medium"),
    "tannery": _entry("production", "Open yard with hide frames, vats, and water handling.", WORKSHOP, "production_tanning_frame_4m", "production_dye_vat_large", "production_retting_trough", "prop_tool_rack_tannery"),
    "cobbler": _entry("production", "Small domestic workshop with shop opening and cobbler bench.", DOMESTIC, "wall_limewash_4m_window_shop_host", "opening_window_shop_plain", "production_cobbler_bench", "civic_trade_sign_hanging"),
    "chandlery": _entry("production", "Wax-working shop with candle rack and small vats.", DOMESTIC, "production_chandlery_dipping_rack", "production_dye_vat_small", "production_chimney_limestone_h2p4m"),
}


SUPPLEMENTAL_COVERAGE = {
    "residence_tier_0": _entry("housing", "Burgage starter cottage with a genuinely volumetric bound-thatch roof, tied ridge, exposed fringe, smoke vent, timber walls, and tiny shuttered opening.", "foundation_fieldstone_2m_h0p35m", "wall_plank_4m_h2p4m", "wall_plank_2m_window_small_host", "opening_window_small_shuttered", "opening_door_service_single", "roof_thatch_panel_4m_full", "roof_thatch_ridge_4m", "roof_thatch_eave_edge_4m", "roof_thatch_smoke_vent", "roof_timber_verge_4m"),
    "residence_tier_1": _entry("housing", "Compact stone-based cottage able to retain repaired thatch or adopt the first split-shingle course system.", HUMBLE, "foundation_fieldstone_4m_h0p65m", "roof_shingle_eave_edge_4m", "roof_shingle_repair_patch_1m", "roof_shingle_chimney_flashing", "production_chimney_limestone_h2p4m"),
    "residence_tier_2": _entry("housing", "Canonical limewashed Gorski house with split-shingle construction, proper ridge/eave/verge junctions, covered dormer, chimney flashing, gable truss, curved brackets, and persistent controlled repair variants.", DOMESTIC, "roof_shingle_eave_edge_4m", "roof_shingle_verge_edge_full", "roof_shingle_ridge_endcap", "roof_shingle_repair_patch_1m", "roof_dormer_frame_2m", "roof_shingle_dormer_cap_1p2m", "roof_shingle_chimney_flashing", "frame_gable_truss_4m", "frame_curved_bracket_left_1m", "frame_curved_bracket_right_1m", "production_chimney_limestone_h4m"),
    "residence_tier_3": _entry("housing", "Wider prosperous residence gains an annex/balcony, carved gallery/fascia vocabulary, and a complete laid-clay-tile roof vocabulary rather than a recolored shingle slab.", DOMESTIC, "roof_tile_panel_4m_full", "roof_tile_ridge_4m", "roof_tile_eave_edge_4m", "roof_tile_verge_edge_full", "roof_tile_ridge_endcap", "roof_tile_repair_patch_1m", "roof_tile_chimney_flashing", "roof_tile_dormer_cap_1p2m", "frame_balcony_4m", "frame_lean_to_4m", "frame_gallery_post_cap", "frame_scalloped_fascia_4m"),
    "residence_tier_4": _entry("housing", "High-status stone/tile frontage adds hip and half-hip junctions, leaded casement, covered dormer, snow catch, carved finial, and civic stone trim without importing fantasy language.", STONE_CIVIC, "roof_tile_hip_cap_full", "roof_tile_halfhip_end_2p4m", "roof_tile_eave_edge_4m", "roof_tile_ridge_endcap", "roof_dormer_frame_2m", "roof_tile_dormer_cap_1p2m", "roof_snow_catch_2m", "roof_gable_finial_timber", "opening_window_domestic_leaded", "civic_town_balustrade_2m"),
    "road": _entry("infrastructure", "Road drainage and wet-ground walkways.", "site_road_culvert_stone_2m", "site_walkway_plank_4m", "foundation_retaining_wall_4m"),
    "bridge": _entry("infrastructure", "Composable deck and railing spans.", "site_bridge_deck_4m", "site_bridge_railing_4m", "foundation_pier_stone_0p9m"),
    "burial_ground": _entry("religious", "Grave markers and parish enclosure.", "site_grave_marker_cross", "site_grave_marker_slab", "enclosure_graveyard_cross_rail_2m", "enclosure_parish_wall_gate_person"),
    "pasture": _entry("agriculture", "Terrain-following fence, gates, and livestock fittings.", "enclosure_split_rail_4m", "enclosure_split_rail_gate_cart", "agri_livestock_trough_4m", "agri_hayrack_4m"),
    "vineyard": _entry("agriculture", "Repeated vine rows with dry-stone perimeter.", "agri_vine_trellis_6m", "enclosure_dry_stone_4m", "enclosure_dry_stone_gate_cart"),
    "dry_stone_wall": _entry("enclosure", "Fraction-authored stone spans, corners, and gates.", "enclosure_dry_stone_1m", "enclosure_dry_stone_2m", "enclosure_dry_stone_4m", "enclosure_dry_stone_corner", "enclosure_dry_stone_gate_person"),
}

for crop in ("rye", "oats", "fallow", "barley", "flax", "wheat"):
    SUPPLEMENTAL_COVERAGE[f"farm_crop_{crop}"] = _entry("agriculture", f"Non-living {crop} marker and SeedThree attachment boundary; SeedThree owns every crop plant and growth state.", f"agri_field_marker_{crop}", "agri_seedthree_crop_anchor_4m")

for garden in (
    "orchard", "apple_orchard", "cherry_orchard", "pear_orchard", "aronia_orchard", "rosehip_orchard",
    "vegetable_garden", "cabbage_garden", "carrot_garden", "beetroot_garden", "flower_garden", "herb_garden",
    "animal_pen", "chicken_pen", "goat_pen", "pig_pen", "backyard_apiary",
):
    if "apiary" in garden:
        signature = "agri_apiary_stand_3"
    elif "chicken" in garden:
        signature = "agri_chicken_roost"
    elif "goat" in garden:
        signature = "agri_goat_stand"
    elif "pig" in garden or garden == "animal_pen":
        signature = "agri_pig_shelter"
    elif "orchard" in garden:
        tree = next((name for name in ("apple", "cherry", "pear", "aronia", "rosehip") if name in garden), "apple")
        signature = f"agri_orchard_guard_{tree}"
    else:
        signature = "agri_garden_coldframe"
    # Most game keys need the supplemental namespace prefix. `backyard_apiary`
    # already carries it, so preserve that authoritative key instead of emitting
    # the invalid `backyard_backyard_apiary` near-duplicate.
    coverage_key = garden if garden.startswith("backyard_") else f"backyard_{garden}"
    SUPPLEMENTAL_COVERAGE[coverage_key] = _entry("backyard", f"Reusable module for {garden.replace('_', ' ')}.", signature, "enclosure_wattle_2m", "agri_compost_wattle_bin")


ALL_COVERAGE = {**BUILDING_COVERAGE, **SUPPLEMENTAL_COVERAGE}
