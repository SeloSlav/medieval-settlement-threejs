/// Every commodity keeps the stable numeric code used by delivery cargo and
/// Trading Post rules. Reusing that code as the bit position keeps the saved
/// mask compact and makes future commodities additive up to code 63.
pub const STOREHOUSE_ACCEPTANCE_MASK: u64 = bit(0) // firewood
    | bit(3) // timber
    | bit(10) // stone
    | bit(14) // cloth
    | bit(19) // iron
    | bit(20) // clay
    | bit(21) // salt
    | bit(22) // charcoal
    | bit(23) // pottery
    | bit(58) // hides
    | bit(59) // leather
    | bit(60); // shoes

pub const GRANARY_ACCEPTANCE_MASK: u64 = bit(2) // legacy mixed food
    | bit(6) // ale
    | bit(7) // legacy preserved food
    | bit(8) // honey
    | bit(16) // barley
    | bit(18) // flax
    | bit(28) // meat
    | bit(29) // fish
    | bit(30) // berries
    | bit(31) // mushrooms
    | bit(32) // milk
    | bit(33) // apples
    | bit(34) // cherries
    | bit(35) // vegetables
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
    | bit(55) // apple cider
    | bit(57) // pear cider
    | bit(61) // aronia jam
    | bit(62); // rosehip jam

const fn bit(code: u8) -> u64 {
    1u64 << code
}

pub fn storage_mask_accepts(mask: u64, commodity_code: u8) -> bool {
    commodity_code < 64 && mask & bit(commodity_code) != 0
}

pub fn storage_kind_acceptance_mask(kind: &str) -> Option<u64> {
    match kind {
        "village_storehouse" => Some(STOREHOUSE_ACCEPTANCE_MASK),
        "granary" => Some(GRANARY_ACCEPTANCE_MASK),
        _ => None,
    }
}

pub fn storage_kind_supports_commodity(kind: &str, commodity_code: u8) -> bool {
    storage_kind_acceptance_mask(kind)
        .is_some_and(|mask| storage_mask_accepts(mask, commodity_code))
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

pub fn set_storage_mask_all(mask: u64, kind: &str, accepts: bool) -> u64 {
    let Some(relevant) = storage_kind_acceptance_mask(kind) else {
        return mask;
    };
    if accepts {
        mask | relevant
    } else {
        mask & !relevant
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_masks_are_specialized_and_default_open() {
        assert!(storage_kind_supports_commodity("village_storehouse", 22));
        assert!(!storage_kind_supports_commodity("village_storehouse", 28));
        assert!(storage_kind_supports_commodity("granary", 28));
        assert!(!storage_kind_supports_commodity("granary", 22));
        assert!(storage_mask_accepts(u64::MAX, 54));
    }

    #[test]
    fn individual_and_bulk_changes_preserve_irrelevant_bits() {
        let without_charcoal = set_storage_mask_commodity(u64::MAX, 22, false);
        assert!(!storage_mask_accepts(without_charcoal, 22));
        assert!(storage_mask_accepts(without_charcoal, 28));

        let no_storehouse_goods = set_storage_mask_all(u64::MAX, "village_storehouse", false);
        assert_eq!(no_storehouse_goods & STOREHOUSE_ACCEPTANCE_MASK, 0);
        assert!(storage_mask_accepts(no_storehouse_goods, 28));
        assert_eq!(
            set_storage_mask_all(no_storehouse_goods, "village_storehouse", true)
                & STOREHOUSE_ACCEPTANCE_MASK,
            STOREHOUSE_ACCEPTANCE_MASK,
        );
    }
}
