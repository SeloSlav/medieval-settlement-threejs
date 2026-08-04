//! Output ceilings for staffed processing workshops and extraction yards.
//!
//! The ceiling controls new production and, for conversion workshops, their
//! input deliveries. Extraction sites do not stage inputs. It is not a
//! protected reserve: household, institutional, and market carts may still
//! draw goods below it, at which point production resumes.

pub const PROCESSOR_OUTPUT_TARGET_DEFAULT_PERCENT: u8 = 100;
pub const PROCESSOR_OUTPUT_TARGET_PERCENTS: [u8; 4] = [25, 50, 75, 100];
pub const PROCESSOR_INPUT_STAGING_DEFAULT_CYCLES: f64 = 3.0;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProcessorOutputKind {
    Flour,
    Food,
    Ale,
    PreservedFood,
    Cloth,
    Charcoal,
    Ironwork,
    Pottery,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProcessorInputKind {
    Grain,
    Flour,
    Water,
    Firewood,
    Barley,
    Food,
    Salt,
    Pottery,
    Wool,
    Flax,
    Iron,
    Charcoal,
    Clay,
}

pub fn processor_output_kind(kind: &str) -> Option<ProcessorOutputKind> {
    match kind {
        "watermill" => Some(ProcessorOutputKind::Flour),
        "bakery" => Some(ProcessorOutputKind::Food),
        "brewery" => Some(ProcessorOutputKind::Ale),
        "smokehouse" => Some(ProcessorOutputKind::PreservedFood),
        "weaver" => Some(ProcessorOutputKind::Cloth),
        "charcoal_burner" => Some(ProcessorOutputKind::Charcoal),
        "smithy" => Some(ProcessorOutputKind::Ironwork),
        "potter_kiln" => Some(ProcessorOutputKind::Pottery),
        _ => None,
    }
}

pub fn processor_input_kinds(kind: &str) -> &'static [ProcessorInputKind] {
    use ProcessorInputKind::*;

    match kind {
        "watermill" => &[Grain],
        "bakery" => &[Flour, Water, Firewood],
        "brewery" => &[Barley, Water, Firewood],
        "smokehouse" => &[Food, Firewood, Salt, Pottery],
        "weaver" => &[Wool, Flax, Water],
        "charcoal_burner" => &[Firewood],
        "smithy" => &[Iron, Charcoal, Water],
        "potter_kiln" => &[Clay, Firewood, Water],
        _ => &[],
    }
}

pub fn is_processor_output_target_kind(kind: &str) -> bool {
    processor_output_kind(kind).is_some()
}

pub fn is_extraction_output_target_kind(kind: &str) -> bool {
    matches!(kind, "stone_quarry" | "large_quarry" | "mine" | "clay_pit")
}

pub fn is_production_output_target_kind(kind: &str) -> bool {
    is_processor_output_target_kind(kind) || is_extraction_output_target_kind(kind)
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

/// The existing output policy also controls how much of every production
/// input is staged at the workshop. Lean branches turn carts around after one
/// cycle, balanced branches keep two, and deep/fill policies retain the
/// legacy three-cycle working stock.
pub fn processor_input_staging_cycles(percent: u8) -> f64 {
    match normalize_processor_output_target_percent(percent) {
        25 => 1.0,
        50 => 2.0,
        75 | 100 => PROCESSOR_INPUT_STAGING_DEFAULT_CYCLES,
        _ => unreachable!("normalized processor output target is always a preset"),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        is_extraction_output_target_kind, is_processor_output_target_kind,
        is_production_output_target_kind, is_valid_processor_output_target_percent,
        normalize_processor_output_target_percent, processor_input_kinds,
        processor_input_staging_cycles, processor_output_headroom, processor_output_kind,
        processor_output_target, ProcessorInputKind, ProcessorOutputKind,
        PROCESSOR_INPUT_STAGING_DEFAULT_CYCLES, PROCESSOR_OUTPUT_TARGET_DEFAULT_PERCENT,
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
    fn stock_policy_scales_input_staging_without_changing_the_legacy_default() {
        assert_eq!(processor_input_staging_cycles(25), 1.0);
        assert_eq!(processor_input_staging_cycles(50), 2.0);
        assert_eq!(processor_input_staging_cycles(75), 3.0);
        assert_eq!(processor_input_staging_cycles(100), 3.0);
        assert_eq!(processor_input_staging_cycles(0), 3.0);
        assert_eq!(PROCESSOR_INPUT_STAGING_DEFAULT_CYCLES, 3.0);
    }

    #[test]
    fn only_staffed_conversion_workshops_use_the_policy() {
        for kind in [
            "watermill",
            "bakery",
            "brewery",
            "smokehouse",
            "weaver",
            "charcoal_burner",
            "smithy",
            "potter_kiln",
        ] {
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
    fn geological_worksites_share_the_ceiling_without_becoming_processors() {
        for kind in ["stone_quarry", "large_quarry", "mine", "clay_pit"] {
            assert!(is_extraction_output_target_kind(kind));
            assert!(is_production_output_target_kind(kind));
            assert!(!is_processor_output_target_kind(kind));
        }
        assert!(!is_extraction_output_target_kind("hunters_hall"));
        assert!(is_production_output_target_kind("smithy"));
    }

    #[test]
    fn every_processor_exposes_its_complete_authoritative_input_recipe() {
        use ProcessorInputKind::*;

        assert_eq!(processor_input_kinds("watermill"), &[Grain]);
        assert_eq!(processor_input_kinds("bakery"), &[Flour, Water, Firewood]);
        assert!(processor_input_kinds("granary").is_empty());
        assert_eq!(processor_input_kinds("brewery"), &[Barley, Water, Firewood]);
        assert_eq!(
            processor_input_kinds("smokehouse"),
            &[Food, Firewood, Salt, Pottery]
        );
        assert_eq!(processor_input_kinds("weaver"), &[Wool, Flax, Water]);
        assert_eq!(processor_input_kinds("charcoal_burner"), &[Firewood]);
        assert_eq!(processor_input_kinds("smithy"), &[Iron, Charcoal, Water]);
        assert_eq!(
            processor_input_kinds("potter_kiln"),
            &[Clay, Firewood, Water]
        );
        assert!(processor_input_kinds("clay_pit").is_empty());
    }

    #[test]
    fn malformed_stock_or_capacity_cannot_create_headroom() {
        assert_eq!(processor_output_target(f64::NAN, 100), 0.0);
        assert_eq!(processor_output_target(-10.0, 100), 0.0);
        assert_eq!(processor_output_headroom(f64::NAN, 240.0, 100), 0.0);
    }
}
