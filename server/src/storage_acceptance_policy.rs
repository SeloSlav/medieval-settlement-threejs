/// Commodity codes double as storage-acceptance bit positions. Codes 64-127
/// live in the companion high mask.
pub const STOREHOUSE_ACCEPTANCE_MASK: u64 = bit(0) // firewood
    | bit(3) // timber
    | bit(10) // stone
    | bit(11) // polearms
    | bit(12) // ironwork
    | bit(13) // wool
    | bit(14) // cloth
    | bit(19) // iron
    | bit(20) // clay
    | bit(21) // salt
    | bit(22) // charcoal
    | bit(23) // pottery
    | bit(25) // remedies
    | bit(58) // hides
    | bit(59) // leather
    | bit(60); // shoes

pub const STOREHOUSE_ACCEPTANCE_MASK_HIGH: u64 = high_bit(64) // wax
    | high_bit(65) // candles
    | high_bit(66) // pelts
    | high_bit(67) // yarn
    | high_bit(68) // linen
    | high_bit(69) // sidearms
    | high_bit(70) // shields
    | high_bit(71) // bows
    | high_bit(72) // crossbows
    | high_bit(73) // padded armor
    | high_bit(74) // mail armor
    | high_bit(75); // ammunition

pub const GRANARY_ACCEPTANCE_MASK: u64 = bit(6) // ale
    | bit(8) // honey
    | bit(9) // wine
    | bit(16) // barley
    | bit(18) // flax
    | bit(28) // meat
    | bit(29) // fish
    | bit(30) // raspberries (legacy field name: berries)
    | bit(31) // mushrooms
    | bit(32) // milk
    | bit(33) // apples
    | bit(34) // cherries
    | bit(36) // eggs
    | bit(37) // grapes
    | bit(39) // cured meat
    | bit(40) // smoked fish
    | bit(41) // cheese
    | bit(42) // rye sheaves
    | bit(43) // oat sheaves
    | bit(44) // barley sheaves
    | bit(45) // maslin sheaves
    | bit(46) // rye grain
    | bit(47) // oat grain
    | bit(48) // maslin grain
    | bit(49) // rye flour
    | bit(51) // maslin flour
    | bit(52) // rye bread
    | bit(54) // maslin bread
    | bit(4) // pears
    | bit(5) // aronia berries
    | bit(27) // rosehips
    | bit(38) // cabbage
    | bit(50) // carrots
    | bit(53) // beetroot
    | bit(55) // cider
    | bit(56) // mead
    | bit(61); // jam

pub const GRANARY_ACCEPTANCE_MASK_HIGH: u64 = 0;

const fn bit(code: u8) -> u64 {
    1u64 << code
}

const fn high_bit(code: u8) -> u64 {
    1u64 << (code - 64)
}

pub fn storage_mask_accepts(mask: u64, commodity_code: u8) -> bool {
    commodity_code < 64 && mask & bit(commodity_code) != 0
}

pub fn storage_masks_accept(low: u64, high: u64, commodity_code: u8) -> bool {
    if commodity_code < 64 {
        storage_mask_accepts(low, commodity_code)
    } else if commodity_code < 128 {
        high & high_bit(commodity_code) != 0
    } else {
        false
    }
}

pub fn storage_kind_acceptance_masks(kind: &str) -> Option<(u64, u64)> {
    match kind {
        "village_storehouse" => Some((STOREHOUSE_ACCEPTANCE_MASK, STOREHOUSE_ACCEPTANCE_MASK_HIGH)),
        "granary" => Some((GRANARY_ACCEPTANCE_MASK, GRANARY_ACCEPTANCE_MASK_HIGH)),
        _ => None,
    }
}

pub fn storage_kind_supports_commodity(kind: &str, commodity_code: u8) -> bool {
    storage_kind_acceptance_masks(kind)
        .is_some_and(|(low, high)| storage_masks_accept(low, high, commodity_code))
}

pub fn set_storage_mask_commodity(mask: u64, commodity_code: u8, accepts: bool) -> u64 {
    if commodity_code >= 64 {
        return mask;
    }
    if accepts {
        mask | bit(commodity_code)
    } else {
        mask & !bit(commodity_code)
    }
}

pub fn set_storage_masks_commodity(
    low: u64,
    high: u64,
    commodity_code: u8,
    accepts: bool,
) -> (u64, u64) {
    if commodity_code < 64 {
        (
            set_storage_mask_commodity(low, commodity_code, accepts),
            high,
        )
    } else if commodity_code < 128 {
        let bit = high_bit(commodity_code);
        (low, if accepts { high | bit } else { high & !bit })
    } else {
        (low, high)
    }
}

pub fn set_storage_masks_all(low: u64, high: u64, kind: &str, accepts: bool) -> (u64, u64) {
    let Some((relevant_low, relevant_high)) = storage_kind_acceptance_masks(kind) else {
        return (low, high);
    };
    if accepts {
        (low | relevant_low, high | relevant_high)
    } else {
        (low & !relevant_low, high & !relevant_high)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_masks_are_specialized_and_default_open() {
        assert!(storage_kind_supports_commodity("village_storehouse", 22));
        assert!(storage_kind_supports_commodity("village_storehouse", 25));
        assert!(!storage_kind_supports_commodity("village_storehouse", 28));
        assert!(storage_kind_supports_commodity("granary", 28));
        assert!(storage_kind_supports_commodity("granary", 9));
        assert!(!storage_kind_supports_commodity("granary", 22));
        assert!(storage_mask_accepts(u64::MAX, 54));
        assert!(storage_kind_supports_commodity("village_storehouse", 64));
        assert!(storage_kind_supports_commodity("village_storehouse", 65));
        assert!(storage_kind_supports_commodity("village_storehouse", 66));
        assert!(storage_kind_supports_commodity("village_storehouse", 67));
        assert!(storage_kind_supports_commodity("village_storehouse", 68));
        assert!(!storage_kind_supports_commodity("granary", 64));
        assert!(storage_masks_accept(u64::MAX, u64::MAX, 65));
        assert!(storage_masks_accept(u64::MAX, u64::MAX, 66));
        assert!(storage_masks_accept(u64::MAX, u64::MAX, 67));
        assert!(storage_masks_accept(u64::MAX, u64::MAX, 68));
    }

    #[test]
    fn individual_and_bulk_changes_preserve_irrelevant_bits() {
        let without_charcoal = set_storage_mask_commodity(u64::MAX, 22, false);
        assert!(!storage_mask_accepts(without_charcoal, 22));
        assert!(storage_mask_accepts(without_charcoal, 28));

        let (no_storehouse_goods, unchanged_high) =
            set_storage_masks_all(u64::MAX, u64::MAX, "village_storehouse", false);
        assert_eq!(no_storehouse_goods & STOREHOUSE_ACCEPTANCE_MASK, 0);
        assert_eq!(unchanged_high & STOREHOUSE_ACCEPTANCE_MASK_HIGH, 0);
        assert!(storage_mask_accepts(no_storehouse_goods, 28));
        let (restored_storehouse_goods, restored_high) = set_storage_masks_all(
            no_storehouse_goods,
            unchanged_high,
            "village_storehouse",
            true,
        );
        assert_eq!(
            restored_storehouse_goods & STOREHOUSE_ACCEPTANCE_MASK,
            STOREHOUSE_ACCEPTANCE_MASK
        );
        assert_eq!(
            restored_high & STOREHOUSE_ACCEPTANCE_MASK_HIGH,
            STOREHOUSE_ACCEPTANCE_MASK_HIGH
        );

        let (low, high) = set_storage_masks_commodity(u64::MAX, u64::MAX, 64, false);
        assert_eq!(low, u64::MAX);
        assert!(!storage_masks_accept(low, high, 64));
        assert!(storage_masks_accept(low, high, 65));

        let (low, high) = set_storage_masks_all(u64::MAX, u64::MAX, "village_storehouse", false);
        assert_eq!(low & STOREHOUSE_ACCEPTANCE_MASK, 0);
        assert_eq!(high & STOREHOUSE_ACCEPTANCE_MASK_HIGH, 0);
    }
}
