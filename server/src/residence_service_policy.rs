//! Persistent-home consequences for sustained unmet household needs.
//!
//! A shortage never deletes a household slot or marks a home abandoned.
//! Instead it first appears as an approval warning, then blocks residence
//! promotion. Household work and taxable market activity continue normally.

use crate::balance_generated::{
    CALENDAR_SECONDS_PER_DAY, RESIDENCE_SERVICE_WARNING_DAYS, RESIDENCE_UPGRADE_SERVICE_BLOCK_DAYS,
    TICK_DT,
};

fn ticks_for_days(days: f64) -> u32 {
    ((days.max(0.0) * CALENDAR_SECONDS_PER_DAY / TICK_DT).round() as u64).min(u64::from(u32::MAX))
        as u32
}

pub fn service_shortage_warns(deficit_ticks: u32) -> bool {
    deficit_ticks >= ticks_for_days(RESIDENCE_SERVICE_WARNING_DAYS)
}

pub fn service_shortage_blocks_upgrade(deficit_ticks: u32) -> bool {
    deficit_ticks >= ticks_for_days(RESIDENCE_UPGRADE_SERVICE_BLOCK_DAYS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sustained_shortages_escalate_without_removing_housing() {
        let warning = ticks_for_days(RESIDENCE_SERVICE_WARNING_DAYS);
        let blocked = ticks_for_days(RESIDENCE_UPGRADE_SERVICE_BLOCK_DAYS);

        assert!(!service_shortage_warns(warning.saturating_sub(1)));
        assert!(service_shortage_warns(warning));
        assert!(!service_shortage_blocks_upgrade(blocked.saturating_sub(1)));
        assert!(service_shortage_blocks_upgrade(blocked));
    }
}
