//! Output ceilings for staffed processing workshops.
//!
//! The ceiling controls new production and its input deliveries. It is not a
//! protected reserve: household, institutional, and market carts may still
//! draw finished goods below it, at which point production resumes.

pub const PROCESSOR_OUTPUT_TARGET_DEFAULT_PERCENT: u8 = 100;
pub const PROCESSOR_OUTPUT_TARGET_PERCENTS: [u8; 4] = [25, 50, 75, 100];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProcessorOutputKind {
    Flour,
    Food,
    Ale,
    PreservedFood,
    Cloth,
}

pub fn processor_output_kind(kind: &str) -> Option<ProcessorOutputKind> {
    match kind {
        "watermill" => Some(ProcessorOutputKind::Flour),
        "granary" => Some(ProcessorOutputKind::Food),
        "brewery" => Some(ProcessorOutputKind::Ale),
        "smokehouse" => Some(ProcessorOutputKind::PreservedFood),
        "weaver" => Some(ProcessorOutputKind::Cloth),
        _ => None,
    }
}

pub fn is_processor_output_target_kind(kind: &str) -> bool {
    processor_output_kind(kind).is_some()
}

pub fn is_valid_processor_output_target_percent(percent: u8) -> bool {
    PROCESSOR_OUTPUT_TARGET_PERCENTS.contains(&percent)
}

/// Invalid legacy or externally-authored values retain the former
/// fill-to-capacity behavior.
pub fn normalize_processor_output_target_percent(percent: u8) -> u8 {
    if is_valid_processor_output_target_percent(percent) {
        percent
    } else {
        PROCESSOR_OUTPUT_TARGET_DEFAULT_PERCENT
    }
}

pub fn processor_output_target(capacity: f64, percent: u8) -> f64 {
    if !capacity.is_finite() {
        return 0.0;
    }
    capacity.max(0.0) * normalize_processor_output_target_percent(percent) as f64 / 100.0
}

pub fn processor_output_headroom(stock: f64, capacity: f64, percent: u8) -> f64 {
    if !stock.is_finite() {
        return 0.0;
    }
    (processor_output_target(capacity, percent) - stock.max(0.0)).max(0.0)
}

#[cfg(test)]
mod tests {
    use super::{
        is_processor_output_target_kind, is_valid_processor_output_target_percent,
        normalize_processor_output_target_percent, processor_output_headroom,
        processor_output_kind, processor_output_target, ProcessorOutputKind,
        PROCESSOR_OUTPUT_TARGET_DEFAULT_PERCENT,
    };

    #[test]
    fn legacy_processors_keep_filling_to_capacity() {
        assert_eq!(PROCESSOR_OUTPUT_TARGET_DEFAULT_PERCENT, 100);
        assert_eq!(normalize_processor_output_target_percent(0), 100);
        assert_eq!(processor_output_target(240.0, 100), 240.0);
        assert_eq!(processor_output_headroom(80.0, 240.0, 0), 160.0);
    }

    #[test]
    fn production_targets_use_four_readable_steps() {
        for percent in [25, 50, 75, 100] {
            assert!(is_valid_processor_output_target_percent(percent));
            assert_eq!(normalize_processor_output_target_percent(percent), percent);
        }
        assert!(!is_valid_processor_output_target_percent(24));
        assert!(!is_valid_processor_output_target_percent(101));
    }

    #[test]
    fn production_stops_at_the_selected_ceiling_and_resumes_below_it() {
        assert_eq!(processor_output_target(240.0, 25), 60.0);
        assert_eq!(processor_output_headroom(45.0, 240.0, 25), 15.0);
        assert_eq!(processor_output_headroom(60.0, 240.0, 25), 0.0);
        assert_eq!(processor_output_headroom(90.0, 240.0, 25), 0.0);
    }

    #[test]
    fn only_staffed_conversion_workshops_use_the_policy() {
        for kind in ["watermill", "granary", "brewery", "smokehouse", "weaver"] {
            assert!(is_processor_output_target_kind(kind));
        }
        for kind in ["monastery", "apiary", "vineyard", "carpenter"] {
            assert!(!is_processor_output_target_kind(kind));
        }
        assert_eq!(
            processor_output_kind("watermill"),
            Some(ProcessorOutputKind::Flour)
        );
        assert_eq!(
            processor_output_kind("smokehouse"),
            Some(ProcessorOutputKind::PreservedFood)
        );
    }

    #[test]
    fn malformed_stock_or_capacity_cannot_create_headroom() {
        assert_eq!(processor_output_target(f64::NAN, 100), 0.0);
        assert_eq!(processor_output_target(-10.0, 100), 0.0);
        assert_eq!(processor_output_headroom(f64::NAN, 240.0, 100), 0.0);
    }
}
