use spacetimedb::ReducerContext;

use super::storage::{
    available_unreserved_building_stone, available_unreserved_building_timber,
    available_unreserved_treasury_stone, available_unreserved_treasury_timber,
};
use crate::db::*;
use crate::tables::{Building, ResidenceNeed};

enum AggregateSpendField {
    Timber,
    Stone,
}

enum TreasurySpendField {
    Firewood,
    Food,
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

pub fn spend_aggregate_firewood(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    amount: f64,
) -> Result<(), String> {
    spend_residence_stock(
        ctx,
        owner,
        amount,
        0,
        TreasurySpendField::Firewood,
        |building| building.firewood,
    )
}

pub fn spend_aggregate_food(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    amount: f64,
) -> Result<(), String> {
    spend_residence_stock(
        ctx,
        owner,
        amount,
        2,
        TreasurySpendField::Food,
        |building| building.food,
    )
}

fn spend_aggregate(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    amount: f64,
    field: AggregateSpendField,
) -> Result<(), String> {
    if amount <= 0.0 {
        return Ok(());
    }

    let resource_name = match field {
        AggregateSpendField::Timber => "timber",
        AggregateSpendField::Stone => "stone",
    };

    let available_building = match field {
        AggregateSpendField::Timber => available_unreserved_building_timber(ctx, owner),
        AggregateSpendField::Stone => available_unreserved_building_stone(ctx, owner),
    };
    let available_treasury = match field {
        AggregateSpendField::Timber => available_unreserved_treasury_timber(ctx, owner),
        AggregateSpendField::Stone => available_unreserved_treasury_stone(ctx, owner),
    };
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
        let available = match field {
            AggregateSpendField::Timber => building.timber,
            AggregateSpendField::Stone => building.stone,
        };
        let withdraw = remaining.min(available).min(remaining_building_budget);
        if withdraw <= 0.0 {
            continue;
        }
        let updated = match field {
            AggregateSpendField::Timber => Building {
                timber: building.timber - withdraw,
                ..building
            },
            AggregateSpendField::Stone => Building {
                stone: building.stone - withdraw,
                ..building
            },
        };
        ctx.db.building().id().update(updated);
        remaining -= withdraw;
        remaining_building_budget -= withdraw;
    }

    if remaining > 1e-6 {
        if let Some(mut treasury) = ctx.db.player_resources().owner().find(&owner) {
            let from_treasury = remaining.min(available_treasury);
            match field {
                AggregateSpendField::Timber => treasury.timber -= from_treasury,
                AggregateSpendField::Stone => treasury.stone -= from_treasury,
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

fn spend_residence_stock<F>(
    ctx: &ReducerContext,
    owner: spacetimedb::Identity,
    amount: f64,
    need_kind: u8,
    treasury_field: TreasurySpendField,
    building_pick: F,
) -> Result<(), String>
where
    F: Fn(&Building) -> f64,
{
    if amount <= 0.0 {
        return Ok(());
    }

    let resource_name = match treasury_field {
        TreasurySpendField::Firewood => "firewood",
        TreasurySpendField::Food => "food",
    };

    let mut remaining = amount;
    if let Some(mut treasury) = ctx.db.player_resources().owner().find(&owner) {
        let from_treasury = match treasury_field {
            TreasurySpendField::Firewood => {
                let withdraw = remaining.min(treasury.firewood);
                treasury.firewood -= withdraw;
                withdraw
            }
            TreasurySpendField::Food => {
                let withdraw = remaining.min(treasury.food);
                treasury.food -= withdraw;
                withdraw
            }
        };
        remaining -= from_treasury;
        ctx.db.player_resources().owner().update(treasury);
    }

    if remaining <= 1e-6 {
        return Ok(());
    }

    let mut buildings: Vec<Building> = ctx.db.building().owner().filter(&owner).collect();
    buildings.sort_by_key(|building| {
        if building.kind == "village_storehouse" {
            0
        } else {
            1
        }
    });
    for building in buildings {
        if remaining <= 1e-6 {
            break;
        }
        let available = building_pick(&building);
        let withdraw = remaining.min(available);
        if withdraw <= 0.0 {
            continue;
        }
        let updated = match treasury_field {
            TreasurySpendField::Firewood => Building {
                firewood: building.firewood - withdraw,
                ..building
            },
            TreasurySpendField::Food => Building {
                food: building.food - withdraw,
                ..building
            },
        };
        ctx.db.building().id().update(updated);
        remaining -= withdraw;
    }

    if remaining <= 1e-6 {
        return Ok(());
    }

    for residence in ctx.db.residence().owner().filter(&owner) {
        if remaining <= 1e-6 {
            break;
        }
        for need in ctx.db.residence_need().residence_id().filter(&residence.id) {
            if need.need_kind != need_kind {
                continue;
            }
            let withdraw = remaining.min(need.stock);
            if withdraw <= 0.0 {
                continue;
            }
            let updated = ResidenceNeed {
                stock: need.stock - withdraw,
                ..need
            };
            ctx.db.residence_need().id().update(updated);
            remaining -= withdraw;
            if remaining <= 1e-6 {
                break;
            }
        }
    }

    if remaining > 1e-6 {
        return Err(format!(
            "Not enough {resource_name} (need {} more).",
            remaining.round() as i64
        ));
    }

    Ok(())
}
