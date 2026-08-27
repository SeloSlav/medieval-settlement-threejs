use spacetimedb::{reducer, ReducerContext};

use crate::balance_generated::{
    STARTING_BREAD, STARTING_FIREWOOD, STARTING_GOLD, STARTING_IRONWORK, STARTING_STONE,
    STARTING_TIMBER,
};
use crate::building_defs::building_def;
use crate::construction_priority::CONSTRUCTION_PRIORITY_NORMAL;
use crate::db::*;
use crate::foraging_policy::preserves_runtime_location_during_bootstrap;
use crate::granary_policy::GRANARY_FRESH_FOOD_TARGET_DEFAULT_PERCENT;
use crate::lifecycle::ensure_player_resources;
use crate::processor_output_policy::PROCESSOR_OUTPUT_TARGET_DEFAULT_PERCENT;
use crate::production_rate_policy::DEFAULT_PRODUCTION_RATE_PERCENT;
use crate::quarry_balance::preserve_extracted_stone;
use crate::reducers::buildings::next_available_building_id;
use crate::simulation::materialize_physical_resource_ledger_at;
use crate::storehouse_policy::STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT;
use crate::tables::{Building, ForagingNode, Quarry, TreeEntity, WorldConfig};
use crate::types::{ForagingBootstrap, QuarryBootstrap, TreeBootstrap};

#[reducer]
pub fn bootstrap_quarries(
    ctx: &ReducerContext,
    quarries: Vec<QuarryBootstrap>,
) -> Result<(), String> {
    for quarry in quarries {
        if quarry.quarry_id.is_empty() || quarry.max_yield <= 0.0 {
            continue;
        }
        if let Some(existing) = ctx.db.quarry().quarry_id().find(&quarry.quarry_id) {
            // Preserve the absolute amount already extracted when a balance update
            // expands a deposit, so existing worlds receive the additional reserve.
            let rebalanced_remaining =
                preserve_extracted_stone(existing.max_yield, existing.remaining, quarry.max_yield);
            ctx.db.quarry().quarry_id().update(Quarry {
                x: quarry.x,
                z: quarry.z,
                max_yield: quarry.max_yield,
                remaining: rebalanced_remaining,
                is_rich: quarry.is_rich,
                ..existing
            });
        } else {
            ctx.db.quarry().insert(Quarry {
                quarry_id: quarry.quarry_id,
                x: quarry.x,
                z: quarry.z,
                max_yield: quarry.max_yield,
                remaining: quarry.max_yield,
                is_rich: quarry.is_rich,
            });
        }
    }
    Ok(())
}

#[reducer]
pub fn bootstrap_foraging(
    ctx: &ReducerContext,
    nodes: Vec<ForagingBootstrap>,
) -> Result<(), String> {
    for node in nodes {
        if node.node_id.is_empty() || node.max_yield <= 0.0 {
            continue;
        }
        if let Some(existing) = ctx.db.foraging_node().node_id().find(&node.node_id) {
            let preserve_runtime_location =
                preserves_runtime_location_during_bootstrap(&node.node_kind);
            let rebalanced_remaining = if node.node_kind == "clay" {
                if existing.max_yield <= 1.0 + f64::EPSILON && node.max_yield > 1.0 {
                    // Earlier development worlds stored clay as a permanent
                    // placement anchor with a placeholder reserve of one.
                    // Upgrade untouched anchors to the new physical reserve.
                    node.max_yield
                } else {
                    preserve_extracted_stone(existing.max_yield, existing.remaining, node.max_yield)
                }
            } else {
                existing.remaining.min(node.max_yield)
            };
            ctx.db.foraging_node().node_id().update(ForagingNode {
                // Disturbed game habitats may have migrated, but plants and
                // fish are static world-layout sites and must stay aligned
                // with the resources rendered by reconnecting clients.
                x: if preserve_runtime_location {
                    existing.x
                } else {
                    node.x
                },
                z: if preserve_runtime_location {
                    existing.z
                } else {
                    node.z
                },
                max_yield: node.max_yield,
                remaining: rebalanced_remaining,
                node_kind: node.node_kind,
                anchor_x: if preserve_runtime_location {
                    existing.anchor_x
                } else {
                    node.anchor_x
                },
                anchor_z: if preserve_runtime_location {
                    existing.anchor_z
                } else {
                    node.anchor_z
                },
                ..existing
            });
        } else {
            ctx.db.foraging_node().insert(ForagingNode {
                node_id: node.node_id,
                node_kind: node.node_kind,
                x: node.x,
                z: node.z,
                max_yield: node.max_yield,
                remaining: node.max_yield,
                respawn_cooldown: 0.0,
                anchor_x: node.anchor_x,
                anchor_z: node.anchor_z,
            });
        }
    }
    Ok(())
}

#[reducer]
pub fn bootstrap_trees(ctx: &ReducerContext, trees: Vec<TreeBootstrap>) -> Result<(), String> {
    for tree in trees {
        if tree.tree_id.is_empty() {
            continue;
        }
        if ctx.db.tree_entity().tree_id().find(&tree.tree_id).is_some() {
            continue;
        }
        ctx.db.tree_entity().insert(TreeEntity {
            tree_id: tree.tree_id,
            layout_index: tree.layout_index,
            phase: "mature".to_string(),
            growth_progress: 1.0,
            wood_yield: tree.wood_yield.max(1.0),
            x: tree.x,
            z: tree.z,
        });
    }
    Ok(())
}

fn validate_founding_site_coordinates(x: f64, z: f64) -> Result<(), String> {
    if !x.is_finite() || !z.is_finite() || x.abs() > 10_000.0 || z.abs() > 10_000.0 {
        return Err("Founding-site coordinates are invalid.".into());
    }
    Ok(())
}

fn owner_has_existing_settlement(ctx: &ReducerContext, owner: spacetimedb::Identity) -> bool {
    ctx.db.settlement().owner().filter(&owner).next().is_some()
        || ctx.db.building().owner().filter(&owner).next().is_some()
        || ctx.db.residence().owner().filter(&owner).next().is_some()
        || ctx
            .db
            .burgage_zone()
            .owner()
            .filter(&owner)
            .next()
            .is_some()
}

fn first_camp_goods(stock: f64, standard_allocation: f64, multiplier: u8) -> f64 {
    stock.max(0.0) + standard_allocation.max(0.0) * f64::from(multiplier.saturating_sub(1).min(1))
}

/// Migrates developed legacy saves to physical storage without choosing a
/// starting point for a fresh settlement. New players place their camp through
/// the ordinary building-placement reducer once the world has loaded.
#[reducer]
pub fn bootstrap_founding_site(ctx: &ReducerContext, x: f64, z: f64) -> Result<(), String> {
    validate_founding_site_coordinates(x, z)?;
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    let Some(mut resources) = ctx.db.player_resources().owner().find(&owner) else {
        return Err("Player resources are unavailable.".into());
    };
    if resources.physical_founding_site_enabled {
        return Ok(());
    }

    let has_existing_settlement = owner_has_existing_settlement(ctx, owner);
    if has_existing_settlement {
        // Developed legacy saves keep their historic population accounting but
        // no longer keep spendable goods in a disembodied ledger. The existing
        // materializer creates one visible recovery pile beside the civic seat
        // (or at this deterministic fallback when only zoning exists).
        resources.physical_founding_site_enabled = true;
        ctx.db.player_resources().owner().update(resources);
        materialize_physical_resource_ledger_at(ctx, owner, Some((x, z)))?;
    }
    Ok(())
}

/// Establishes the one physical starting point chosen by a new player. The
/// caller performs the same terrain and overlap validation as other buildings
/// before entering this founding-specific resource transfer.
pub(crate) fn place_founding_camp(ctx: &ReducerContext, x: f64, z: f64) -> Result<(), String> {
    validate_founding_site_coordinates(x, z)?;
    let owner = ctx.sender();
    ensure_player_resources(ctx, owner);
    let Some(mut resources) = ctx.db.player_resources().owner().find(&owner) else {
        return Err("Player resources are unavailable.".into());
    };
    if resources.physical_founding_site_enabled || owner_has_existing_settlement(ctx, owner) {
        return Err("This settlement already has a founding site.".into());
    }

    let def = building_def("founders_camp")
        .ok_or_else(|| "Founders' camp balance definition is missing.".to_string())?;
    let config = ctx
        .db
        .world_config()
        .id()
        .find(&0)
        .ok_or_else(|| "World not initialized.".to_string())?;
    let building_id = next_available_building_id(ctx, config.next_building_id)?;
    let initial_goods_multiplier = config.initial_goods_multiplier;
    let settlement = crate::settlements::create_initial_settlement(ctx, owner, building_id, x, z)?;
    ctx.db.building().insert(Building {
        id: building_id,
        owner,
        kind: "founders_camp".into(),
        x,
        z,
        work_radius: 0.0,
        tree_work_area_x: 0.0,
        tree_work_area_z: 0.0,
        tree_work_area_radius: 0.0,
        action_cooldown: 0.0,
        timber: first_camp_goods(resources.timber, STARTING_TIMBER, initial_goods_multiplier),
        firewood: first_camp_goods(
            resources.firewood,
            STARTING_FIREWOOD,
            initial_goods_multiplier,
        ),
        stone: first_camp_goods(resources.stone, STARTING_STONE, initial_goods_multiplier),
        water: resources.water.max(0.0),
        food: 0.0,
        ale: resources.ale.max(0.0),
        preserved_food: resources.preserved_food.max(0.0),
        honey: resources.honey.max(0.0),
        wine: resources.wine.max(0.0),
        ironwork: first_camp_goods(
            resources.ironwork,
            STARTING_IRONWORK,
            initial_goods_multiplier,
        ),
        polearms: resources.polearms.max(0.0),
        wool: resources.wool.max(0.0),
        cloth: resources.cloth.max(0.0),
        water_capacity: def.storage_water,
        assigned_labor: 0,
        storehouse_accepts_timber: true,
        storehouse_accepts_stone: true,
        storehouse_accepts_firewood: true,
        storehouse_accepts_iron: true,
        storehouse_accepts_clay: true,
        storehouse_accepts_salt: true,
        storehouse_accepts_charcoal: true,
        gold: first_camp_goods(resources.gold, STARTING_GOLD, initial_goods_multiplier),
        construction_complete: true,
        construction_progress: 1.0,
        construction_required_timber: 0.0,
        construction_required_stone: 0.0,
        construction_required_ironwork: 0.0,
        construction_delivered_timber: 0.0,
        construction_delivered_stone: 0.0,
        construction_delivered_ironwork: 0.0,
        construction_reserved_timber: 0.0,
        construction_reserved_stone: 0.0,
        construction_reserved_ironwork: 0.0,
        construction_treasury_timber: 0.0,
        construction_treasury_stone: 0.0,
        construction_treasury_ironwork: 0.0,
        construction_required_roof_tiles: 0.0,
        construction_delivered_roof_tiles: 0.0,
        construction_reserved_roof_tiles: 0.0,
        construction_treasury_roof_tiles: 0.0,
        granary_accepts_fresh_food: true,
        granary_households_first: false,
        construction_priority: CONSTRUCTION_PRIORITY_NORMAL,
        woodcutter_timber_reserve: 0.0,
        granary_grain_reserve: 0.0,
        harvest_reserve_percent: 0,
        carpenter_polearm_reserve: 0,
        guardhouse_pay_priority: 0,
        marketplace_ironwork_target: 0,
        marketplace_specialty_export_policy: 0,
        granary_fresh_food_target_percent: GRANARY_FRESH_FOOD_TARGET_DEFAULT_PERCENT,
        storehouse_timber_target_percent: STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        storehouse_stone_target_percent: STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        storehouse_firewood_target_percent: STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        storehouse_iron_target_percent: STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        storehouse_clay_target_percent: STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        storehouse_salt_target_percent: STOREHOUSE_STOCK_TARGET_DEFAULT_PERCENT,
        storehouse_charcoal_target_percent: 25,
        processor_output_target_percent: PROCESSOR_OUTPUT_TARGET_DEFAULT_PERCENT,
        production_rate_percent: DEFAULT_PRODUCTION_RATE_PERCENT,
        production_maintenance_progress: 0.0,
        guardhouse_food_reserve: 0,
        marketplace_seed_grain_target: 0,
        marketplace_pending_trade_code: 0,
        marketplace_gold_reserve_target:
            crate::marketplace_procurement_policy::MARKETPLACE_GOLD_RESERVE_DEFAULT,
        founding_shelter_active: true,
        chapel_monastery_tithe_due: 0.0,
        civic_receipts_gold: 0.0,
        private_export_proceeds_gold: 0.0,
        vineyard_fermenting_grapes: 0.0,
        vineyard_fermentation_progress: 0.0,
        apiary_harvest_policy: 1,
        apiary_colony_health: 1.0,
        apiary_last_winter_year: 0,
        apiary_forage_score: 0.75,
        marketplace_drink_export_policy: 255,
        marketplace_provision_export_policy: 255,
        marketplace_wares_export_policy: 255,
        barley: resources.barley.max(0.0),
        malt: resources.malt.max(0.0),
        flax: resources.flax.max(0.0),
        guardhouse_muster_watchtower_id: 0,
        weaver_input_policy: 0,
        iron: resources.iron.max(0.0),
        clay: resources.clay.max(0.0),
        salt: resources.salt.max(0.0),
        charcoal: resources.charcoal.max(0.0),
        pottery: resources.pottery.max(0.0),
        roof_tiles: resources.roof_tiles.max(0.0),
        manure: 0.0,
        remedies: 0.0,
        marketplace_iron_target: 0,
        marketplace_salt_target: 0,
        pottery_dispatch_policy: 0,
        potter_firing_policy: 0,
        carpenter_cart_service_target_trips: 0,
        remote_work_camp_enabled: false,
        linked_worksite_id: 0,
        commute_efficiency: 1.0,
        chapel_tier: 0,
        meat: resources.meat.max(0.0),
        fish: resources.fish.max(0.0),
        berries: resources.berries.max(0.0),
        mushrooms: resources.mushrooms.max(0.0),
        milk: resources.milk.max(0.0),
        apples: resources.apples.max(0.0),
        cherries: resources.cherries.max(0.0),
        vegetables: resources.vegetables.max(0.0),
        eggs: resources.eggs.max(0.0),
        grapes: resources.grapes.max(0.0),
        cured_meat: resources.cured_meat.max(0.0),
        smoked_fish: resources.smoked_fish.max(0.0),
        cheese: resources.cheese.max(0.0),
        rye_sheaves: resources.rye_sheaves.max(0.0),
        oat_sheaves: resources.oat_sheaves.max(0.0),
        barley_sheaves: resources.barley_sheaves.max(0.0),
        maslin_sheaves: resources.maslin_sheaves.max(0.0),
        rye_grain: resources.rye_grain.max(0.0),
        oat_grain: resources.oat_grain.max(0.0),
        maslin_grain: resources.maslin_grain.max(0.0),
        rye_flour: resources.rye_flour.max(0.0),
        maslin_flour: resources.maslin_flour.max(0.0),
        rye_bread: first_camp_goods(
            resources.rye_bread.max(0.0) + resources.food.max(0.0),
            STARTING_BREAD,
            initial_goods_multiplier,
        ),
        maslin_bread: resources.maslin_bread.max(0.0),
        threshing_priority: crate::farm_work_policy::THRESHING_PRIORITY_DEFAULT,
        fire_repair_active: false,
        cider: resources.cider.max(0.0),
        mead: resources.mead.max(0.0),
        brewery_recipe_policy: crate::brewery_recipe_policy::BREWERY_RECIPE_ALE,
        monastery_orchard_planting: crate::monastery_estate_policy::MONASTERY_ORCHARD_APPLES,
        monastery_croft_planting: crate::monastery_estate_policy::MONASTERY_CROFT_VEGETABLES,
        monastery_extensions: 0,
        monastery_next_extension: 0,
        monastery_orchard_planted_year: 0,
        monastery_orchard_maturity:
            crate::monastery_estate_policy::MONASTERY_ORCHARD_MATURITY_MATURE,
        monastery_croft_choice_year: 0,
        monastery_service_funding: 1.0,
        monastery_last_service_day: 0,
        storage_acceptance_mask: u64::MAX,
        hides: resources.hides.max(0.0),
        leather: resources.leather.max(0.0),
        shoes: resources.shoes.max(0.0),
        pears: resources.pears.max(0.0),
        aronia: resources.aronia.max(0.0),
        rosehips: resources.rosehips.max(0.0),
        cabbage: resources.cabbage.max(0.0),
        carrots: resources.carrots.max(0.0),
        beetroot: resources.beetroot.max(0.0),
        aronia_jam: resources.aronia_jam.max(0.0),
        rosehip_jam: resources.rosehip_jam.max(0.0),
        pear_cider: resources.pear_cider.max(0.0),
        settlement_id: settlement.id,
        animal_feed: 0.0,
        storage_acceptance_mask_high: u64::MAX,
        wax: resources.wax.max(0.0),
        candles: resources.candles.max(0.0),
        apiary_wax_cycle_progress: 0,
        pelts: resources.pelts.max(0.0),
        yarn: resources.yarn.max(0.0),
        linen: resources.linen.max(0.0),
        milk_use_policy: crate::livestock_policy::MILK_USE_BALANCED,
        smokehouse_recipe_policy: crate::smokehouse_recipe_policy::SMOKEHOUSE_RECIPE_AUTO,
    });

    resources.timber = 0.0;
    resources.firewood = 0.0;
    resources.stone = 0.0;
    resources.water = 0.0;
    resources.food = 0.0;
    resources.ale = 0.0;
    resources.cider = 0.0;
    resources.mead = 0.0;
    resources.hides = 0.0;
    resources.leather = 0.0;
    resources.shoes = 0.0;
    resources.pears = 0.0;
    resources.aronia = 0.0;
    resources.rosehips = 0.0;
    resources.cabbage = 0.0;
    resources.carrots = 0.0;
    resources.beetroot = 0.0;
    resources.aronia_jam = 0.0;
    resources.rosehip_jam = 0.0;
    resources.pear_cider = 0.0;
    resources.wax = 0.0;
    resources.candles = 0.0;
    resources.pelts = 0.0;
    resources.yarn = 0.0;
    resources.linen = 0.0;
    resources.preserved_food = 0.0;
    resources.honey = 0.0;
    resources.wine = 0.0;
    resources.ironwork = 0.0;
    resources.polearms = 0.0;
    resources.wool = 0.0;
    resources.iron = 0.0;
    resources.clay = 0.0;
    resources.salt = 0.0;
    resources.charcoal = 0.0;
    resources.pottery = 0.0;
    resources.roof_tiles = 0.0;
    resources.cloth = 0.0;
    resources.gold = 0.0;
    resources.barley = 0.0;
    resources.malt = 0.0;
    resources.flax = 0.0;
    resources.meat = 0.0;
    resources.fish = 0.0;
    resources.berries = 0.0;
    resources.mushrooms = 0.0;
    resources.milk = 0.0;
    resources.apples = 0.0;
    resources.cherries = 0.0;
    resources.vegetables = 0.0;
    resources.eggs = 0.0;
    resources.grapes = 0.0;
    resources.cured_meat = 0.0;
    resources.smoked_fish = 0.0;
    resources.rye_sheaves = 0.0;
    resources.oat_sheaves = 0.0;
    resources.barley_sheaves = 0.0;
    resources.maslin_sheaves = 0.0;
    resources.rye_grain = 0.0;
    resources.oat_grain = 0.0;
    resources.maslin_grain = 0.0;
    resources.rye_flour = 0.0;
    resources.maslin_flour = 0.0;
    resources.rye_bread = 0.0;
    resources.maslin_bread = 0.0;
    resources.cheese = 0.0;
    resources.physical_founding_site_enabled = true;
    resources.legacy_unhoused_population_bonus_enabled = false;
    ctx.db.player_resources().owner().update(resources);

    let clearance = def.pick_radius * 1.35;
    let clearance_sq = clearance * clearance;
    let cleared_tree_ids = ctx
        .db
        .tree_entity()
        .iter()
        .filter(|tree| (tree.x - x).powi(2) + (tree.z - z).powi(2) <= clearance_sq)
        .map(|tree| tree.tree_id)
        .collect::<Vec<_>>();
    for tree_id in cleared_tree_ids {
        ctx.db.tree_entity().tree_id().delete(&tree_id);
    }

    ctx.db.world_config().id().update(WorldConfig {
        next_building_id: building_id
            .checked_add(1)
            .ok_or_else(|| "No building IDs remain available.".to_string())?,
        ..config
    });
    Ok(())
}
