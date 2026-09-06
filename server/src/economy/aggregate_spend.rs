use spacetimedb::ReducerContext;

use super::storage::{
    available_unreserved_building_ironwork, available_unreserved_building_roof_tiles, available_unreserved_building_dressed_stone,
    available_unreserved_building_stone, available_unreserved_building_timber,
    available_unreserved_treasury_ironwork, available_unreserved_treasury_roof_tiles, available_unreserved_treasury_dressed_stone,
    available_unreserved_treasury_stone, available_unreserved_treasury_timber,
};
use crate::db::*;
use crate::resource_units::{whole_cost, whole_units};
use crate::tables::Building;

enum AggregateSpendField {
    Timber,
    Stone,
    Ironwork,
    RoofTiles,
    DressedStone,
}

pub fn spend_aggregate_timber(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    amount: f64,
) -> Result<(), String> {
    spend_aggregate(ctx, owner, amount, AggregateSpendField::Timber)
}

pub fn spend_aggregate_stone(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    amount: f64,
) -> Result<(), String> {
    spend_aggregate(ctx, owner, amount, AggregateSpendField::Stone)
}

pub fn spend_aggregate_ironwork(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    amount: f64,
) -> Result<(), String> {
    spend_aggregate(ctx, owner, amount, AggregateSpendField::Ironwork)
}

pub fn spend_aggregate_roof_tiles(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    amount: f64,
) -> Result<(), String> {
    spend_aggregate(ctx, owner, amount, AggregateSpendField::RoofTiles)
}
pub fn spend_aggregate_dressed_stone(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    amount: f64,
) -> Result<(), String> {
    spend_aggregate(ctx, owner, amount, AggregateSpendField::DressedStone)
}

fn spend_aggregate(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    amount: f64,
    field: AggregateSpendField,
) -> Result<(), String> {
    let amount = whole_cost(amount);
    if amount < 1.0 {
        return Ok(());
    }

    let resource_name = match field {
        AggregateSpendField::Timber => "timber",
        AggregateSpendField::Stone => "stone",
        AggregateSpendField::Ironwork => "ironwork",
        AggregateSpendField::RoofTiles => "fired roof tiles",
        AggregateSpendField::DressedStone => "dressed stone",
    };

    let available_building = whole_units(match field {
        AggregateSpendField::Timber => available_unreserved_building_timber(ctx, owner),
        AggregateSpendField::Stone => available_unreserved_building_stone(ctx, owner),
        AggregateSpendField::Ironwork => available_unreserved_building_ironwork(ctx, owner),
        AggregateSpendField::RoofTiles => available_unreserved_building_roof_tiles(ctx, owner),
        AggregateSpendField::DressedStone => available_unreserved_building_dressed_stone(ctx, owner),
    });
    let available_treasury = whole_units(match field {
        AggregateSpendField::Timber => available_unreserved_treasury_timber(ctx, owner),
        AggregateSpendField::Stone => available_unreserved_treasury_stone(ctx, owner),
        AggregateSpendField::Ironwork => available_unreserved_treasury_ironwork(ctx, owner),
        AggregateSpendField::RoofTiles => available_unreserved_treasury_roof_tiles(ctx, owner),
        AggregateSpendField::DressedStone => available_unreserved_treasury_dressed_stone(ctx, owner),
    });
    if amount > available_building + available_treasury + 1e-6 {
        return Err(format!(
            "Not enough {resource_name} (need {} more).",
            (amount - available_building - available_treasury).round() as i64
        ));
    }

    let mut remaining = amount;
    let mut remaining_building_budget = available_building;
    let mut buildings: Vec<Building> = ctx.db.building().owner().filter(&owner).collect();
    buildings.sort_by_key(|building| {
        if building.kind == "village_storehouse" {
            0
        } else {
            1
        }
    });
    for building in buildings {
        if remaining <= 1e-6 || remaining_building_budget <= 1e-6 {
            break;
        }
        let available = whole_units(match field {
            AggregateSpendField::Timber => building.timber,
            AggregateSpendField::Stone => building.stone,
            AggregateSpendField::Ironwork => building.ironwork,
            AggregateSpendField::RoofTiles => building.roof_tiles,
            AggregateSpendField::DressedStone => building.dressed_stone,
        });
        let withdraw = whole_units(remaining.min(available).min(remaining_building_budget));
        if withdraw <= 0.0 {
            continue;
        }
        let updated = match field {
            AggregateSpendField::Timber => Building {
                timber: whole_units(building.timber) - withdraw,
                ..building
            },
            AggregateSpendField::Stone => Building {
                stone: whole_units(building.stone) - withdraw,
                ..building
            },
            AggregateSpendField::Ironwork => Building {
                ironwork: whole_units(building.ironwork) - withdraw,
                ..building
            },
            AggregateSpendField::RoofTiles => Building {
                roof_tiles: whole_units(building.roof_tiles) - withdraw,
                ..building
            },
            AggregateSpendField::DressedStone => Building {
                dressed_stone: whole_units(building.dressed_stone) - withdraw,
                ..building
            },
        };
        ctx.db.building().id().update(updated);
        remaining -= withdraw;
        remaining_building_budget -= withdraw;
    }

    if remaining > 1e-6 {
        if let Some(mut treasury) = ctx.db.player_resources().owner().find(&owner) {
            let from_treasury = whole_units(remaining.min(available_treasury));
            match field {
                AggregateSpendField::Timber => {
                    treasury.timber = whole_units(treasury.timber) - from_treasury
                }
                AggregateSpendField::Stone => {
                    treasury.stone = whole_units(treasury.stone) - from_treasury
                }
                AggregateSpendField::Ironwork => {
                    treasury.ironwork = whole_units(treasury.ironwork) - from_treasury
                }
                AggregateSpendField::RoofTiles => {
                    treasury.roof_tiles = whole_units(treasury.roof_tiles) - from_treasury
                }
                AggregateSpendField::DressedStone => {
                    treasury.dressed_stone = whole_units(treasury.dressed_stone) - from_treasury
                }
            }
            remaining -= from_treasury;
            ctx.db.player_resources().owner().update(treasury);
        }
    }

    if remaining <= 1e-6 {
        Ok(())
    } else {
        Err(format!(
            "Not enough {resource_name} (need {} more).",
            remaining.round() as i64
        ))
    }
}
