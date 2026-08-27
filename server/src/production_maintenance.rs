//! Whole-unit ironwork charging for the production-rate maintenance curve.
//!
//! Inventories are indivisible, so fractional wear is kept in a dedicated
//! building progress field until a complete ironwork unit is due. This makes
//! low and intermediate rates conserve their authored cost over time without
//! leaking fractional resource stock into the economy.

use crate::economy::{withdraw_building_commodity, CommodityKind};
use crate::production_rate_policy::maintenance_wear_per_completed_work;
use crate::resource_units::whole_units;
use crate::tables::Building;

pub fn charge_completed_production_maintenance(
    building: &mut Building,
    base_wear: f64,
) -> f64 {
    let accrued = building.production_maintenance_progress.max(0.0)
        + maintenance_wear_per_completed_work(base_wear, building.production_rate_percent);
    let due = whole_units(accrued);
    if due <= 0.0 {
        building.production_maintenance_progress = accrued;
        return 0.0;
    }

    let paid = withdraw_building_commodity(building, CommodityKind::Ironwork, due);
    // Preserve fractional wear and any temporarily unpaid whole-unit debt.
    // The latter can only occur when a high-rate cycle empties a short rack.
    building.production_maintenance_progress = (accrued - paid).max(0.0);
    paid
}
