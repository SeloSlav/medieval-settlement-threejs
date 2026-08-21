#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum ResidenceNeedKind {
    Firewood,
    Water,
    Food,
    Ale,
    PreservedFood,
    Cloth,
    Pottery,
    Church,
    FoodVariety,
    Luxury,
}

impl ResidenceNeedKind {
    pub const ALL: [ResidenceNeedKind; 10] = [
        Self::Firewood,
        Self::Water,
        Self::Food,
        Self::PreservedFood,
        Self::Ale,
        Self::Cloth,
        Self::Pottery,
        Self::Church,
        Self::FoodVariety,
        Self::Luxury,
    ];

    pub fn is_active_for_tier(self, tier: u8) -> bool {
        match self {
            Self::Food | Self::Firewood | Self::Water | Self::Church => tier >= 1,
            Self::FoodVariety | Self::Cloth | Self::Ale => tier >= 2,
            Self::PreservedFood | Self::Pottery | Self::Luxury => tier >= 4,
        }
    }

    /// Needs whose absence damages health. Firewood is a survival need only
    /// when seasonal demand rises above the mild-weather baseline.
    pub fn is_vital_for_tier(self, tier: u8, cold_weather: bool) -> bool {
        self.is_active_for_tier(tier) && matches!(self, Self::Food | Self::Water)
            || (self == Self::Firewood && self.is_active_for_tier(tier) && cold_weather)
    }

    pub fn as_u8(self) -> u8 {
        match self {
            Self::Firewood => 0,
            Self::Water => 1,
            Self::Food => 2,
            Self::Ale => 6,
            Self::PreservedFood => 7,
            Self::Cloth => 14,
            // Residence delivery cargo ids mirror CommodityKind so the
            // existing cart renderer and unload path remain unambiguous.
            Self::Pottery => 23,
            // Virtual service rows sit after physical CommodityKind ids.
            Self::Church => 42,
            Self::FoodVariety => 43,
            Self::Luxury => 57,
        }
    }

    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::Firewood),
            1 => Some(Self::Water),
            2 => Some(Self::Food),
            6 => Some(Self::Ale),
            7 => Some(Self::PreservedFood),
            14 => Some(Self::Cloth),
            23 => Some(Self::Pottery),
            42 => Some(Self::Church),
            43 => Some(Self::FoodVariety),
            57 => Some(Self::Luxury),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ResidenceNeedKind;

    #[test]
    fn needs_form_a_four_step_progression() {
        let active_count = |tier| {
            ResidenceNeedKind::ALL
                .into_iter()
                .filter(|kind| kind.is_active_for_tier(tier))
                .count()
        };

        assert_eq!(active_count(0), 0);
        assert_eq!(active_count(1), 4);
        assert_eq!(active_count(2), 7);
        assert_eq!(active_count(3), 7);
        assert_eq!(active_count(4), 10);
        assert!(ResidenceNeedKind::Food.is_active_for_tier(1));
        assert!(ResidenceNeedKind::Firewood.is_active_for_tier(1));
        assert!(ResidenceNeedKind::Cloth.is_active_for_tier(2));
        assert!(ResidenceNeedKind::Ale.is_active_for_tier(2));
        assert!(!ResidenceNeedKind::PreservedFood.is_active_for_tier(2));
        assert!(!ResidenceNeedKind::Pottery.is_active_for_tier(3));
        assert!(ResidenceNeedKind::Pottery.is_active_for_tier(4));
        assert!(ResidenceNeedKind::Luxury.is_active_for_tier(4));
        assert_eq!(ResidenceNeedKind::Cloth.as_u8(), 14);
        assert_eq!(ResidenceNeedKind::Pottery.as_u8(), 23);
    }
}
