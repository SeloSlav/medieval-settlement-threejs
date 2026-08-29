//! Automatic output capacity and input staging for processing workshops.
//!
//! Workshops produce up to physical capacity and stage three complete input
//! cycles. The legacy percentage column remains in stored rows for additive
//! schema compatibility, but no longer changes workshop behavior.

pub const PROCESSOR_OUTPUT_TARGET_DEFAULT_PERCENT: u8 = 100;
pub const PROCESSOR_INPUT_STAGING_DEFAULT_CYCLES: f64 = 3.0;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProcessorOutputKind {
    Flour,
    Food,
    Ale,
    PreservedFood,
    TextileIntermediate,
    Cloth,
    Charcoal,
    Ironwork,
    Pottery,
    Leather,
    Shoes,
    Candles,
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
    Wool,
    Flax,
    Yarn,
    Linen,
    Iron,
    Charcoal,
    Clay,
    Apples,
    Honey,
    Hides,
    Leather,
    Wax,
}

pub fn processor_output_kind(kind: &str) -> Option<ProcessorOutputKind> {
    match kind {
        "watermill" | "windmill" => Some(ProcessorOutputKind::Flour),
        "bakery" => Some(ProcessorOutputKind::Food),
        "brewery" => Some(ProcessorOutputKind::Ale),
        "smokehouse" => Some(ProcessorOutputKind::PreservedFood),
        "spinning_retting_house" => Some(ProcessorOutputKind::TextileIntermediate),
        "weaver" => Some(ProcessorOutputKind::Cloth),
        "charcoal_burner" => Some(ProcessorOutputKind::Charcoal),
        "smithy" => Some(ProcessorOutputKind::Ironwork),
        "potter_kiln" => Some(ProcessorOutputKind::Pottery),
        "tannery" => Some(ProcessorOutputKind::Leather),
        "cobbler" => Some(ProcessorOutputKind::Shoes),
        "chandlery" => Some(ProcessorOutputKind::Candles),
        _ => None,
    }
}

pub fn processor_input_kinds(kind: &str) -> &'static [ProcessorInputKind] {
    use ProcessorInputKind::*;

    match kind {
        "watermill" | "windmill" => &[Grain],
        "bakery" => &[Flour, Water, Firewood],
        "brewery" => &[Barley, Water, Firewood, Apples, Honey],
        "smokehouse" => &[Food, Firewood, Salt],
        "spinning_retting_house" => &[Wool, Flax, Water],
        "weaver" => &[Yarn, Linen],
        "charcoal_burner" => &[Firewood],
        "smithy" => &[Iron, Charcoal, Water],
        "potter_kiln" => &[Clay, Firewood, Water],
        "tannery" => &[Hides, Water, Firewood],
        "cobbler" => &[Leather],
        "chandlery" => &[Wax, Firewood],
        _ => &[],
    }
}

pub fn is_processor_output_target_kind(kind: &str) -> bool {
    processor_output_kind(kind).is_some()
}

pub fn normalize_processor_output_target_percent(_percent: u8) -> u8 {
    PROCESSOR_OUTPUT_TARGET_DEFAULT_PERCENT
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

pub fn processor_input_staging_cycles(_percent: u8) -> f64 {
    PROCESSOR_INPUT_STAGING_DEFAULT_CYCLES
}

#[cfg(test)]
mod tests {
    use super::{
        is_processor_output_target_kind, normalize_processor_output_target_percent,
        processor_input_kinds, processor_input_staging_cycles, processor_output_headroom,
        processor_output_kind, processor_output_target, ProcessorInputKind, ProcessorOutputKind,
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
    fn legacy_percentages_all_resolve_to_physical_capacity() {
        for percent in [0, 25, 50, 75, 100, 255] {
            assert_eq!(normalize_processor_output_target_percent(percent), 100);
        }
    }

    #[test]
    fn production_uses_physical_capacity() {
        assert_eq!(processor_output_target(240.0, 25), 240.0);
        assert_eq!(processor_output_headroom(45.0, 240.0, 25), 195.0);
        assert_eq!(processor_output_headroom(240.0, 240.0, 25), 0.0);
    }

    #[test]
    fn workshops_stage_three_input_cycles_automatically() {
        assert_eq!(processor_input_staging_cycles(25), 3.0);
        assert_eq!(processor_input_staging_cycles(50), 3.0);
        assert_eq!(processor_input_staging_cycles(75), 3.0);
        assert_eq!(processor_input_staging_cycles(100), 3.0);
        assert_eq!(processor_input_staging_cycles(0), 3.0);
        assert_eq!(PROCESSOR_INPUT_STAGING_DEFAULT_CYCLES, 3.0);
    }

    #[test]
    fn only_staffed_conversion_workshops_use_automatic_capacity() {
        for kind in [
            "watermill",
            "windmill",
            "bakery",
            "brewery",
            "smokehouse",
            "spinning_retting_house",
            "weaver",
            "charcoal_burner",
            "smithy",
            "potter_kiln",
            "chandlery",
        ] {
            assert!(is_processor_output_target_kind(kind));
        }
        for kind in ["monastery", "apiary", "carpenter"] {
            assert!(!is_processor_output_target_kind(kind));
        }
        assert_eq!(
            processor_output_kind("watermill"),
            Some(ProcessorOutputKind::Flour)
        );
        assert_eq!(
            processor_output_kind("windmill"),
            Some(ProcessorOutputKind::Flour)
        );
        assert_eq!(
            processor_output_kind("smokehouse"),
            Some(ProcessorOutputKind::PreservedFood)
        );
    }

    #[test]
    fn geological_worksites_do_not_use_workshop_output_capacity() {
        for kind in ["stone_quarry", "large_quarry", "mine"] {
            assert!(!is_processor_output_target_kind(kind));
        }
        assert!(!is_processor_output_target_kind("pastoral_farmstead"));
    }

    #[test]
    fn every_processor_exposes_its_complete_authoritative_input_recipe() {
        use ProcessorInputKind::*;

        assert_eq!(processor_input_kinds("watermill"), &[Grain]);
        assert_eq!(processor_input_kinds("windmill"), &[Grain]);
        assert_eq!(processor_input_kinds("bakery"), &[Flour, Water, Firewood]);
        assert!(processor_input_kinds("granary").is_empty());
        assert_eq!(
            processor_input_kinds("brewery"),
            &[Barley, Water, Firewood, Apples, Honey]
        );
        assert_eq!(
            processor_input_kinds("smokehouse"),
            &[Food, Firewood, Salt]
        );
        assert_eq!(
            processor_input_kinds("spinning_retting_house"),
            &[Wool, Flax, Water]
        );
        assert_eq!(processor_input_kinds("weaver"), &[Yarn, Linen]);
        assert_eq!(processor_input_kinds("charcoal_burner"), &[Firewood]);
        assert_eq!(processor_input_kinds("smithy"), &[Iron, Charcoal, Water]);
        assert_eq!(
            processor_input_kinds("potter_kiln"),
            &[Clay, Firewood, Water]
        );
        assert_eq!(processor_input_kinds("chandlery"), &[Wax, Firewood]);
        assert_eq!(
            processor_output_kind("chandlery"),
            Some(ProcessorOutputKind::Candles)
        );
    }

    #[test]
    fn malformed_stock_or_capacity_cannot_create_headroom() {
        assert_eq!(processor_output_target(f64::NAN, 100), 0.0);
        assert_eq!(processor_output_target(-10.0, 100), 0.0);
        assert_eq!(processor_output_headroom(f64::NAN, 240.0, 100), 0.0);
    }
}
