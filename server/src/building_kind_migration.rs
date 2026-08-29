use spacetimedb::{Identity, ReducerContext};

use crate::building_defs::building_def;
use crate::db::*;
use crate::tables::Building;

const REMOVED_CLAY_PIT_KIND: &str = "clay_pit";
const MINING_CAMP_KIND: &str = "stone_quarry";

/// Converts the removed Clay Pit row in old saves into the unified Mining Camp.
///
/// The primary key and all physical stock remain unchanged, so labor, carts,
/// construction progress, settlement membership, and stored clay stay attached
/// to the same worksite. Running this on every reconnect is intentionally
/// idempotent and also repairs a legacy database restored after this release.
pub fn migrate_removed_clay_pits(ctx: &ReducerContext, owner: Identity) {
    let Some(mining_camp) = building_def(MINING_CAMP_KIND) else {
        log::error!("Mining Camp definition is missing; Clay Pit migration was skipped");
        return;
    };
    let legacy_rows: Vec<Building> = ctx
        .db
        .building()
        .owner()
        .filter(&owner)
        .filter(|building| building.kind == REMOVED_CLAY_PIT_KIND)
        .collect();

    for mut building in legacy_rows {
        building.kind = MINING_CAMP_KIND.to_string();
        building.work_radius = mining_camp.work_radius;
        ctx.db.building().id().update(building);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removed_kind_and_replacement_are_distinct_and_stable() {
        assert_eq!(REMOVED_CLAY_PIT_KIND, "clay_pit");
        assert_eq!(MINING_CAMP_KIND, "stone_quarry");
        assert_ne!(REMOVED_CLAY_PIT_KIND, MINING_CAMP_KIND);
    }
}
