//! Stable extraction-site identities and deposit routing.
//!
//! World generation stores stone, iron, and salt in the legacy `quarry`
//! table and clay in `foraging_node`.  Keep the schema-compatible ids, but
//! keep the finite surface layer distinct from the rich deep source:
//!
//! - `stone_quarry` (Mining Pit): the finite surface reserve of every material,
//!   including the surface layer carried by a rich marker.
//! - `large_quarry` (Quarry): the non-depleting deep source of rich stone only.
//! - `mine` (Mineworks): the non-depleting deep source of rich iron, salt, or
//!   clay only.

use crate::economy::CommodityKind;

pub const LEGACY_CLAY_PIT_KIND: &str = "clay_pit";

pub fn geological_commodity(deposit_id: &str) -> Option<CommodityKind> {
    if deposit_id.starts_with("deposit-iron-") {
        Some(CommodityKind::Iron)
    } else if deposit_id.starts_with("deposit-salt-") {
        Some(CommodityKind::Salt)
    } else if deposit_id.starts_with("quarry-") {
        Some(CommodityKind::Stone)
    } else {
        None
    }
}

pub fn mining_pit_geological_commodity(
    deposit_id: &str,
    _is_rich: bool,
) -> Option<CommodityKind> {
    geological_commodity(deposit_id)
}

pub fn mining_pit_clay_commodity(node_kind: &str, node_id: &str) -> Option<CommodityKind> {
    (node_kind == "clay" && node_id.starts_with("clay-")).then_some(CommodityKind::Clay)
}

pub fn quarry_geological_commodity(
    deposit_id: &str,
    is_rich: bool,
) -> Option<CommodityKind> {
    (is_rich && geological_commodity(deposit_id) == Some(CommodityKind::Stone))
        .then_some(CommodityKind::Stone)
}

pub fn mineworks_geological_commodity(
    deposit_id: &str,
    is_rich: bool,
) -> Option<CommodityKind> {
    if !is_rich {
        return None;
    }
    match geological_commodity(deposit_id) {
        Some(commodity @ (CommodityKind::Iron | CommodityKind::Salt)) => Some(commodity),
        _ => None,
    }
}

pub fn mineworks_clay_commodity(node_kind: &str, node_id: &str) -> Option<CommodityKind> {
    (node_kind == "clay" && node_id.starts_with("clay-rich-"))
        .then_some(CommodityKind::Clay)
}

pub fn extraction_site_accepts_commodity(kind: &str, commodity: CommodityKind) -> bool {
    match kind {
        "stone_quarry" => matches!(
            commodity,
            CommodityKind::Stone
                | CommodityKind::Iron
                | CommodityKind::Salt
                | CommodityKind::Clay
        ),
        "large_quarry" => commodity == CommodityKind::Stone,
        "mine" => matches!(
            commodity,
            CommodityKind::Iron | CommodityKind::Salt | CommodityKind::Clay
        ),
        LEGACY_CLAY_PIT_KIND => commodity == CommodityKind::Clay,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mining_pits_accept_the_finite_surface_layer_of_ordinary_and_rich_nodes() {
        for (id, commodity) in [
            ("quarry-7", CommodityKind::Stone),
            ("deposit-iron-7", CommodityKind::Iron),
            ("deposit-salt-7", CommodityKind::Salt),
        ] {
            assert_eq!(mining_pit_geological_commodity(id, false), Some(commodity));
            assert_eq!(mining_pit_geological_commodity(id, true), Some(commodity));
        }
        assert_eq!(
            mining_pit_clay_commodity("clay", "clay-7"),
            Some(CommodityKind::Clay)
        );
        assert_eq!(
            mining_pit_clay_commodity("clay", "clay-rich-7"),
            Some(CommodityKind::Clay)
        );
    }

    #[test]
    fn quarry_accepts_only_rich_stone() {
        assert_eq!(
            quarry_geological_commodity("quarry-7", true),
            Some(CommodityKind::Stone)
        );
        assert_eq!(quarry_geological_commodity("quarry-7", false), None);
        assert_eq!(
            quarry_geological_commodity("deposit-iron-7", true),
            None
        );
        assert_eq!(
            quarry_geological_commodity("deposit-salt-7", true),
            None
        );
    }

    #[test]
    fn mineworks_accepts_only_rich_iron_salt_and_clay() {
        assert_eq!(
            mineworks_geological_commodity("deposit-iron-7", true),
            Some(CommodityKind::Iron)
        );
        assert_eq!(
            mineworks_geological_commodity("deposit-salt-7", true),
            Some(CommodityKind::Salt)
        );
        assert_eq!(
            mineworks_clay_commodity("clay", "clay-rich-7"),
            Some(CommodityKind::Clay)
        );
        assert_eq!(
            mineworks_geological_commodity("deposit-iron-7", false),
            None
        );
        assert_eq!(mineworks_geological_commodity("quarry-7", true), None);
        assert_eq!(mineworks_clay_commodity("clay", "clay-7"), None);
    }

    #[test]
    fn output_identity_matches_each_current_site() {
        for commodity in [
            CommodityKind::Stone,
            CommodityKind::Iron,
            CommodityKind::Salt,
            CommodityKind::Clay,
        ] {
            assert!(extraction_site_accepts_commodity("stone_quarry", commodity));
        }
        assert!(extraction_site_accepts_commodity(
            "large_quarry",
            CommodityKind::Stone
        ));
        assert!(!extraction_site_accepts_commodity(
            "large_quarry",
            CommodityKind::Iron
        ));
        for commodity in [CommodityKind::Iron, CommodityKind::Salt, CommodityKind::Clay] {
            assert!(extraction_site_accepts_commodity("mine", commodity));
        }
        assert!(!extraction_site_accepts_commodity(
            "mine",
            CommodityKind::Stone
        ));
    }
}
