use spacetimedb::ReducerContext;

use crate::building_defs::building_def;
use crate::constants::{
    RESIDENCE_FIREWOOD_CAPACITY, RESIDENCE_FOOD_CAPACITY, RESIDENCE_WATER_CAPACITY,
};
use crate::db::*;
use crate::residence_upgrade_policy::residence_project_active;
use crate::resource_units::{whole_cost, whole_room, whole_transfer, whole_units};
use crate::tables::{Building, Residence};

use super::commodities::CommodityKind;

#[derive(Clone, Copy, Debug, Default)]
pub struct StorageCaps {
    pub timber: f64,
    pub firewood: f64,
    pub stone: f64,
}

pub fn building_storage_caps(kind: &str) -> StorageCaps {
    let Some(def) = building_def(kind) else {
        return StorageCaps::default();
    };
    StorageCaps {
        timber: def.storage_timber,
        firewood: def.storage_firewood,
        stone: def.storage_stone,
    }
}

pub fn residence_firewood_capacity() -> f64 {
    RESIDENCE_FIREWOOD_CAPACITY
}

pub fn residence_water_capacity() -> f64 {
    RESIDENCE_WATER_CAPACITY
}

pub fn residence_food_capacity() -> f64 {
    RESIDENCE_FOOD_CAPACITY
}

pub fn total_timber(ctx: &ReducerContext, owner: spacetimedb::Identity) -> f64 {
    ((treasury_timber(ctx, owner) + building_sum(ctx, owner, |building| building.timber)
        - reserved_construction_total(ctx, owner, |building| {
            building.construction_reserved_timber
        }))
        - reserved_residence_upgrade_total(ctx, owner, |residence| {
            residence.upgrade_reserved_timber
        }))
    .max(0.0)
}

pub fn total_stone(ctx: &ReducerContext, owner: spacetimedb::Identity) -> f64 {
    ((treasury_stone(ctx, owner) + building_sum(ctx, owner, |building| building.stone)
        - reserved_construction_total(ctx, owner, |building| building.construction_reserved_stone))
        - reserved_residence_upgrade_total(ctx, owner, |residence| {
            residence.upgrade_reserved_stone
        }))
    .max(0.0)
}

pub fn total_ironwork(ctx: &ReducerContext, owner: spacetimedb::Identity) -> f64 {
    (treasury_ironwork(ctx, owner) + building_sum(ctx, owner, |building| building.ironwork)
        - reserved_construction_total(ctx, owner, |building| {
            building.construction_reserved_ironwork
        }))
    .max(0.0)
}

pub fn total_roof_tiles(ctx: &ReducerContext, owner: spacetimedb::Identity) -> f64 {
    (treasury_roof_tiles(ctx, owner) + building_sum(ctx, owner, |building| building.roof_tiles)
        - reserved_construction_total(ctx, owner, |building| {
            building.construction_reserved_roof_tiles
        })
        - reserved_residence_upgrade_total(ctx, owner, |residence| {
            residence.upgrade_reserved_roof_tiles
        }))
    .max(0.0)
}

pub(crate) fn available_unreserved_building_timber(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
) -> f64 {
    let stock = building_sum(ctx, owner, |building| building.timber);
    let reserved = reserved_construction_total(ctx, owner, |building| {
        (building.construction_reserved_timber - building.construction_treasury_timber).max(0.0)
    }) + reserved_residence_upgrade_total(ctx, owner, |residence| {
        residence.upgrade_reserved_timber
    });
    (stock - reserved).max(0.0)
}

pub(crate) fn available_unreserved_building_stone(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
) -> f64 {
    let stock = building_sum(ctx, owner, |building| building.stone);
    let reserved = reserved_construction_total(ctx, owner, |building| {
        (building.construction_reserved_stone - building.construction_treasury_stone).max(0.0)
    }) + reserved_residence_upgrade_total(ctx, owner, |residence| {
        residence.upgrade_reserved_stone
    });
    (stock - reserved).max(0.0)
}

pub(crate) fn available_unreserved_building_ironwork(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
) -> f64 {
    let stock = building_sum(ctx, owner, |building| building.ironwork);
    let reserved = reserved_construction_total(ctx, owner, |building| {
        (building.construction_reserved_ironwork - building.construction_treasury_ironwork).max(0.0)
    });
    (stock - reserved).max(0.0)
}

pub(crate) fn available_unreserved_building_roof_tiles(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
) -> f64 {
    let stock = building_sum(ctx, owner, |building| building.roof_tiles);
    let reserved = reserved_construction_total(ctx, owner, |building| {
        (building.construction_reserved_roof_tiles - building.construction_treasury_roof_tiles)
            .max(0.0)
    }) + reserved_residence_upgrade_total(ctx, owner, |residence| {
        residence.upgrade_reserved_roof_tiles
    });
    (stock - reserved).max(0.0)
}

pub(crate) fn available_unreserved_treasury_timber(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
) -> f64 {
    let reserved =
        reserved_construction_total(ctx, owner, |building| building.construction_treasury_timber);
    (treasury_timber(ctx, owner) - reserved).max(0.0)
}

pub(crate) fn available_unreserved_treasury_stone(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
) -> f64 {
    let reserved =
        reserved_construction_total(ctx, owner, |building| building.construction_treasury_stone);
    (treasury_stone(ctx, owner) - reserved).max(0.0)
}

pub(crate) fn available_unreserved_treasury_ironwork(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
) -> f64 {
    let reserved = reserved_construction_total(ctx, owner, |building| {
        building.construction_treasury_ironwork
    });
    (treasury_ironwork(ctx, owner) - reserved).max(0.0)
}

pub(crate) fn available_unreserved_treasury_roof_tiles(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
) -> f64 {
    let reserved = reserved_construction_total(ctx, owner, |building| {
        building.construction_treasury_roof_tiles
    });
    (treasury_roof_tiles(ctx, owner) - reserved).max(0.0)
}

/// Splits a new construction reservation between physical building inventories
/// and the legacy abstract reserve retained only for pre-founding-site saves.
pub fn construction_treasury_reservation(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    timber: f64,
    stone: f64,
    ironwork: f64,
    roof_tiles: f64,
) -> (f64, f64, f64, f64) {
    let timber_from_treasury = (timber - available_unreserved_building_timber(ctx, owner))
        .clamp(0.0, available_unreserved_treasury_timber(ctx, owner));
    let stone_from_treasury = (stone - available_unreserved_building_stone(ctx, owner))
        .clamp(0.0, available_unreserved_treasury_stone(ctx, owner));
    let ironwork_from_treasury = (ironwork - available_unreserved_building_ironwork(ctx, owner))
        .clamp(0.0, available_unreserved_treasury_ironwork(ctx, owner));
    let roof_tiles_from_treasury = (roof_tiles
        - available_unreserved_building_roof_tiles(ctx, owner))
    .clamp(0.0, available_unreserved_treasury_roof_tiles(ctx, owner));
    (
        timber_from_treasury,
        stone_from_treasury,
        ironwork_from_treasury,
        roof_tiles_from_treasury,
    )
}

/// Repair sites may already hold usable material. The caller records the
/// consumed onsite portion as delivered, then reserves only the remainder
/// from other stores or the legacy reserve so the site never dispatches a cart
/// to itself.
pub fn construction_treasury_reservation_excluding_building(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    timber: f64,
    stone: f64,
    ironwork: f64,
    roof_tiles: f64,
    excluded_building_id: u64,
) -> (f64, f64, f64, f64) {
    let building_timber: f64 = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| building.id != excluded_building_id)
        .map(|building| building.timber)
        .sum();
    let building_stone: f64 = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| building.id != excluded_building_id)
        .map(|building| building.stone)
        .sum();
    let building_ironwork: f64 = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| building.id != excluded_building_id)
        .map(|building| building.ironwork)
        .sum();
    let building_roof_tiles: f64 = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| building.id != excluded_building_id)
        .map(|building| building.roof_tiles)
        .sum();
    let reserved_timber = reserved_construction_total(ctx, owner, |building| {
        (building.construction_reserved_timber - building.construction_treasury_timber).max(0.0)
    });
    let reserved_stone = reserved_construction_total(ctx, owner, |building| {
        (building.construction_reserved_stone - building.construction_treasury_stone).max(0.0)
    });
    let reserved_ironwork = reserved_construction_total(ctx, owner, |building| {
        (building.construction_reserved_ironwork - building.construction_treasury_ironwork).max(0.0)
    });
    let reserved_roof_tiles = reserved_construction_total(ctx, owner, |building| {
        (building.construction_reserved_roof_tiles - building.construction_treasury_roof_tiles)
            .max(0.0)
    }) + reserved_residence_upgrade_total(ctx, owner, |residence| {
        residence.upgrade_reserved_roof_tiles
    });
    let available_timber = (building_timber - reserved_timber).max(0.0);
    let available_stone = (building_stone - reserved_stone).max(0.0);
    let available_ironwork = (building_ironwork - reserved_ironwork).max(0.0);
    let available_roof_tiles = (building_roof_tiles - reserved_roof_tiles).max(0.0);
    let timber_from_treasury =
        (timber - available_timber).clamp(0.0, available_unreserved_treasury_timber(ctx, owner));
    let stone_from_treasury =
        (stone - available_stone).clamp(0.0, available_unreserved_treasury_stone(ctx, owner));
    let ironwork_from_treasury = (ironwork - available_ironwork)
        .clamp(0.0, available_unreserved_treasury_ironwork(ctx, owner));
    let roof_tiles_from_treasury = (roof_tiles - available_roof_tiles)
        .clamp(0.0, available_unreserved_treasury_roof_tiles(ctx, owner));
    (
        timber_from_treasury,
        stone_from_treasury,
        ironwork_from_treasury,
        roof_tiles_from_treasury,
    )
}

fn reserved_construction_total<F>(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    pick: F,
) -> f64
where
    F: Fn(&Building) -> f64,
{
    ctx.db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| !building.construction_complete)
        .map(|building| pick(&building))
        .sum()
}

fn reserved_residence_upgrade_total<F>(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    pick: F,
) -> f64
where
    F: Fn(&Residence) -> f64,
{
    ctx.db
        .residence()
        .owner()
        .filter(&owner)
        .filter(|residence| {
            residence_project_active(
                residence.upgrade_target_tier,
                residence.tier,
                residence.backyard_project_kind,
                residence.fire_repair_active,
                residence.decay_repair_active,
                residence.roof_tile_retrofit_active,
            )
        })
        .map(|residence| pick(&residence).max(0.0))
        .sum()
}

pub fn deposit_building(
    building: &Building,
    caps: StorageCaps,
    timber: f64,
    firewood: f64,
    stone: f64,
) -> (f64, f64, f64, Building) {
    let mut next = building.clone();
    next.timber = whole_units(next.timber);
    next.firewood = whole_units(next.firewood);
    next.stone = whole_units(next.stone);
    let timber_room = whole_room(caps.timber, next.timber);
    let firewood_room = whole_room(caps.firewood, next.firewood);
    let stone_room = whole_room(caps.stone, next.stone);
    let timber_deposited = whole_units(timber).min(timber_room);
    let firewood_deposited = whole_units(firewood).min(firewood_room);
    let stone_deposited = whole_units(stone).min(stone_room);
    next.timber += timber_deposited;
    next.firewood += firewood_deposited;
    next.stone += stone_deposited;
    (timber_deposited, firewood_deposited, stone_deposited, next)
}

pub fn withdraw_building(
    building: &Building,
    timber: f64,
    firewood: f64,
    stone: f64,
) -> (f64, f64, f64, Building) {
    let mut next = building.clone();
    next.timber = whole_units(next.timber);
    next.firewood = whole_units(next.firewood);
    next.stone = whole_units(next.stone);
    let timber_withdrawn = whole_transfer(next.timber, timber);
    let firewood_withdrawn = whole_transfer(next.firewood, firewood);
    let stone_withdrawn = whole_transfer(next.stone, stone);
    next.timber -= timber_withdrawn;
    next.firewood -= firewood_withdrawn;
    next.stone -= stone_withdrawn;
    (timber_withdrawn, firewood_withdrawn, stone_withdrawn, next)
}

pub fn withdraw_building_water(building: &Building, amount: f64) -> (f64, Building) {
    let mut next = building.clone();
    next.water = whole_units(next.water);
    let withdrawn = whole_transfer(next.water, amount);
    next.water -= withdrawn;
    (withdrawn, next)
}

pub fn building_water_storage_cap(kind: &str) -> f64 {
    building_def(kind)
        .map(|def| def.storage_water)
        .unwrap_or(0.0)
}

pub fn credit_treasury_timber(ctx: &ReducerContext, owner: spacetimedb::Identity, amount: f64) {
    crate::economy::credit_treasury_commodity(ctx, owner, CommodityKind::Timber, amount);
}

pub fn credit_treasury_stone(ctx: &ReducerContext, owner: spacetimedb::Identity, amount: f64) {
    crate::economy::credit_treasury_commodity(ctx, owner, CommodityKind::Stone, amount);
}

pub fn credit_treasury_gold(ctx: &ReducerContext, owner: spacetimedb::Identity, amount: f64) {
    let amount = whole_units(amount);
    if amount < 1.0 {
        return;
    }
    if let Some(mut treasury) = ctx.db.player_resources().owner().find(&owner) {
        let physical = treasury.physical_founding_site_enabled;
        if physical {
            if let Some(mut seat) = physical_treasury_seat(ctx, owner) {
                seat.gold = whole_units(seat.gold) + amount;
                ctx.db.building().id().update(seat);
                return;
            }
        }
        treasury.gold = whole_units(treasury.gold) + amount;
        ctx.db.player_resources().owner().update(treasury);
        if physical {
            if let Err(error) = crate::simulation::materialize_physical_resource_ledger(ctx, owner)
            {
                log::warn!("Could not materialize physical treasury gold: {error}");
            }
        }
    }
}

/// Return coin that was withdrawn for a payment but could not be accepted by
/// its recipient. This is a refund to the original public purse, not income.
pub fn restore_treasury_gold(ctx: &ReducerContext, owner: spacetimedb::Identity, amount: f64) {
    credit_treasury_gold(ctx, owner, amount);
}

pub fn treasury_gold(ctx: &ReducerContext, owner: spacetimedb::Identity) -> f64 {
    let Some(resources) = ctx.db.player_resources().owner().find(&owner) else {
        return 0.0;
    };
    let held_gold = if resources.physical_founding_site_enabled {
        ctx.db
            .building()
            .owner()
            .filter(&owner)
            .filter(|building| {
                building.construction_complete
                    && matches!(
                        building.kind.as_str(),
                        "founders_camp" | "salvage_pile" | "town_hall"
                    )
            })
            .map(|building| whole_units(building.gold))
            .sum::<f64>()
    } else {
        whole_units(resources.gold)
    };
    let reserved = whole_cost(reserved_residence_upgrade_total(ctx, owner, |residence| {
        residence.upgrade_reserved_gold
    }));
    whole_units(held_gold - reserved)
}

pub fn spend_treasury_gold(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    amount: f64,
) -> Result<(), String> {
    let amount = whole_cost(amount);
    if amount < 1.0 {
        return Ok(());
    }
    let available = treasury_gold(ctx, owner);
    if available + 1e-6 < amount {
        return Err(format!(
            "Not enough gold (need {} more).",
            (amount - available).round() as i64
        ));
    }
    let Some(mut treasury) = ctx.db.player_resources().owner().find(&owner) else {
        return Err("Not enough gold.".to_string());
    };

    if treasury.physical_founding_site_enabled {
        let mut remaining = amount;
        let mut seats = ctx
            .db
            .building()
            .owner()
            .filter(&owner)
            .filter(|building| {
                building.construction_complete
                    && matches!(
                        building.kind.as_str(),
                        "founders_camp" | "salvage_pile" | "town_hall"
                    )
                    && building.gold > 1e-9
            })
            .collect::<Vec<_>>();
        seats.sort_by_key(|building| {
            (
                match building.kind.as_str() {
                    "town_hall" => 0_u8,
                    "founders_camp" => 1,
                    _ => 2,
                },
                building.id,
            )
        });
        for mut seat in seats {
            seat.gold = whole_units(seat.gold);
            let paid = whole_transfer(seat.gold, remaining);
            seat.gold -= paid;
            remaining -= paid;
            ctx.db.building().id().update(seat);
            if remaining < 1.0 {
                return Ok(());
            }
        }
        return Err("Not enough physically stored gold.".to_string());
    }
    treasury.gold = whole_units(treasury.gold) - amount;
    ctx.db.player_resources().owner().update(treasury);
    Ok(())
}

pub(crate) fn physical_treasury_seat(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
) -> Option<Building> {
    ctx.db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| {
            building.construction_complete
                && matches!(
                    building.kind.as_str(),
                    "founders_camp" | "salvage_pile" | "town_hall"
                )
        })
        .min_by_key(|building| {
            (
                match building.kind.as_str() {
                    "town_hall" => 0_u8,
                    "founders_camp" => 1,
                    _ => 2,
                },
                building.id,
            )
        })
}

fn treasury_timber(ctx: &ReducerContext, owner: spacetimedb::Identity) -> f64 {
    ctx.db
        .player_resources()
        .owner()
        .find(&owner)
        .filter(|row| !row.physical_founding_site_enabled)
        .map(|row| row.timber)
        .unwrap_or(0.0)
}

fn treasury_stone(ctx: &ReducerContext, owner: spacetimedb::Identity) -> f64 {
    ctx.db
        .player_resources()
        .owner()
        .find(&owner)
        .filter(|row| !row.physical_founding_site_enabled)
        .map(|row| row.stone)
        .unwrap_or(0.0)
}

fn treasury_ironwork(ctx: &ReducerContext, owner: spacetimedb::Identity) -> f64 {
    ctx.db
        .player_resources()
        .owner()
        .find(&owner)
        .filter(|row| !row.physical_founding_site_enabled)
        .map(|row| row.ironwork)
        .unwrap_or(0.0)
}

fn treasury_roof_tiles(ctx: &ReducerContext, owner: spacetimedb::Identity) -> f64 {
    ctx.db
        .player_resources()
        .owner()
        .find(&owner)
        .filter(|row| !row.physical_founding_site_enabled)
        .map(|row| row.roof_tiles)
        .unwrap_or(0.0)
}

fn building_sum<F>(ctx: &ReducerContext, owner: spacetimedb::Identity, pick: F) -> f64
where
    F: Fn(&Building) -> f64,
{
    ctx.db
        .building()
        .owner()
        .filter(&owner)
        .map(|building| pick(&building))
        .sum()
}
