use crate::balance_generated::{
    CAVALRY_HORSE_DAILY_ANIMAL_FEED, CAVALRY_HORSE_DAILY_OATS, CAVALRY_HORSE_DAILY_WATER,
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CavalryRation {
    pub animal_feed: f64,
    pub oats: f64,
    pub water: f64,
}

pub fn cavalry_uses_winter_feed(month: u32) -> bool {
    matches!(month, 12 | 1 | 2)
}

/// Active field companies carry their horses with them and therefore vacate
/// the authored yard places. Mustering and returning companies still occupy
/// (or reserve) a physical place for every mount.
pub fn horse_occupies_yard_place(
    assigned_company_id: u64,
    assigned_company_state: Option<u8>,
) -> bool {
    assigned_company_id == 0 || assigned_company_state != Some(1)
}

/// One horse-day always consumes water and exactly one seasonal fodder type.
/// Oats represent ordinary campaigning fodder; stored animal feed replaces it
/// during the pastureless winter months rather than stacking with it.
pub fn cavalry_daily_ration(month: u32) -> CavalryRation {
    if cavalry_uses_winter_feed(month) {
        CavalryRation {
            animal_feed: CAVALRY_HORSE_DAILY_ANIMAL_FEED,
            oats: 0.0,
            water: CAVALRY_HORSE_DAILY_WATER,
        }
    } else {
        CavalryRation {
            animal_feed: 0.0,
            oats: CAVALRY_HORSE_DAILY_OATS,
            water: CAVALRY_HORSE_DAILY_WATER,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seasonal_horse_fodder_never_duplicates() {
        for month in 1..=12 {
            let ration = cavalry_daily_ration(month);
            assert!(ration.water > 0.0);
            assert_ne!(ration.animal_feed > 0.0, ration.oats > 0.0);
        }
    }

    #[test]
    fn winter_uses_feed_and_the_rest_of_year_uses_oats() {
        for month in [12, 1, 2] {
            let ration = cavalry_daily_ration(month);
            assert!(ration.animal_feed > 0.0);
            assert_eq!(ration.oats, 0.0);
        }
        for month in 3..=11 {
            let ration = cavalry_daily_ration(month);
            assert_eq!(ration.animal_feed, 0.0);
            assert!(ration.oats > 0.0);
        }
    }

    #[test]
    fn only_active_field_mounts_vacate_yard_places() {
        assert!(horse_occupies_yard_place(0, None));
        assert!(horse_occupies_yard_place(42, Some(0)));
        assert!(!horse_occupies_yard_place(42, Some(1)));
        assert!(horse_occupies_yard_place(42, Some(2)));
        assert!(horse_occupies_yard_place(42, None));
    }
}
