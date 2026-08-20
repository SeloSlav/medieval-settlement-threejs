//! Secular land and customs policy shared by the authoritative simulation.
//!
//! Parish tithes deliberately do not appear here: they belong to chapel and
//! monastery accounts, not to the civic treasury.

use crate::balance_generated::{
    EXPORT_DUTY_RATE_MAX, EXPORT_DUTY_RATE_MIN, IMPORT_DUTY_RATE_MAX, IMPORT_DUTY_RATE_MIN,
    LAND_LEVY_AREA_MULTIPLIER_MAX, LAND_LEVY_AREA_MULTIPLIER_MIN, LAND_LEVY_BACKYARD_MULTIPLIER,
    LAND_LEVY_RATE_MAX, LAND_LEVY_RATE_MIN, LAND_LEVY_REFERENCE_PLOT_AREA,
    LAND_LEVY_TIER1_ASSESSED_VALUE, LAND_LEVY_TIER2_ASSESSED_VALUE, LAND_LEVY_TIER3_ASSESSED_VALUE,
};

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PrivateExportSplit {
    pub household_income: f64,
    pub export_duty: f64,
}

pub fn clamp_land_levy_rate(rate: f64) -> f64 {
    rate.clamp(LAND_LEVY_RATE_MIN, LAND_LEVY_RATE_MAX)
}

pub fn clamp_import_duty_rate(rate: f64) -> f64 {
    rate.clamp(IMPORT_DUTY_RATE_MIN, IMPORT_DUTY_RATE_MAX)
}

pub fn clamp_export_duty_rate(rate: f64) -> f64 {
    rate.clamp(EXPORT_DUTY_RATE_MIN, EXPORT_DUTY_RATE_MAX)
}

pub fn split_private_export_receipt(gross_receipt: f64, rate: f64) -> PrivateExportSplit {
    let gross = gross_receipt.max(0.0);
    let export_duty = gross * clamp_export_duty_rate(rate);
    PrivateExportSplit {
        household_income: (gross - export_duty).max(0.0),
        export_duty,
    }
}

pub fn land_levy_assessed_value(tier: u8, plot_area: f64, has_backyard: bool) -> f64 {
    let tier_value = match tier {
        0 | 1 => LAND_LEVY_TIER1_ASSESSED_VALUE,
        2 => LAND_LEVY_TIER2_ASSESSED_VALUE,
        _ => LAND_LEVY_TIER3_ASSESSED_VALUE,
    };
    let area_multiplier = (plot_area.max(0.0) / LAND_LEVY_REFERENCE_PLOT_AREA.max(1.0))
        .clamp(LAND_LEVY_AREA_MULTIPLIER_MIN, LAND_LEVY_AREA_MULTIPLIER_MAX);
    let backyard_multiplier = if has_backyard {
        LAND_LEVY_BACKYARD_MULTIPLIER
    } else {
        1.0
    };
    tier_value * area_multiplier * backyard_multiplier
}

/// The configured rate is annual. Twelve rational game months divide that
/// liability into predictable monthly assessments.
pub fn monthly_land_levy(assessed_value: f64, annual_rate: f64) -> f64 {
    assessed_value.max(0.0) * clamp_land_levy_rate(annual_rate) / 12.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn customs_rates_are_bounded_and_conserve_private_export_receipts() {
        let split = split_private_export_receipt(100.0, EXPORT_DUTY_RATE_MAX);
        assert!((split.household_income + split.export_duty - 100.0).abs() < 1e-9);
        assert_eq!(clamp_import_duty_rate(-1.0), IMPORT_DUTY_RATE_MIN);
        assert_eq!(clamp_export_duty_rate(2.0), EXPORT_DUTY_RATE_MAX);
    }

    #[test]
    fn larger_improved_burgages_have_a_larger_land_assessment() {
        let cottage = land_levy_assessed_value(1, LAND_LEVY_REFERENCE_PLOT_AREA, false);
        let prosperous = land_levy_assessed_value(3, LAND_LEVY_REFERENCE_PLOT_AREA * 1.4, true);
        assert!(prosperous > cottage);
        assert!(monthly_land_levy(prosperous, LAND_LEVY_RATE_MAX) > 0.0);
    }
}
