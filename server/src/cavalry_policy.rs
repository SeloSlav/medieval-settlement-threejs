use crate::balance_generated::{CAVALRY_HORSE_DAILY_OATS, CAVALRY_HORSE_DAILY_WATER};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CavalryRation {
    pub oats: f64,
    pub water: f64,
}

/// One fielded horse-day consumes portable oats and water year-round. Ambient
/// campaign forage is abstracted; parcel-local hay and winter Animal Feed remain
/// exclusive to horses physically present at their home pasture.
pub fn cavalry_daily_ration() -> CavalryRation {
    CavalryRation {
        oats: CAVALRY_HORSE_DAILY_OATS,
        water: CAVALRY_HORSE_DAILY_WATER,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fielded_horses_always_use_oats_and_water() {
        let ration = cavalry_daily_ration();
        assert!(ration.oats > 0.0);
        assert!(ration.water > 0.0);
    }
}
