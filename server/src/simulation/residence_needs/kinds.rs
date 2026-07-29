#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum ResidenceNeedKind {
    Firewood,
    Water,
    Food,
    Ale,
    PreservedFood,
    Cloth,
}

impl ResidenceNeedKind {
    pub const ALL: [ResidenceNeedKind; 6] = [
        Self::Firewood,
        Self::Water,
        Self::Food,
        Self::PreservedFood,
        Self::Ale,
        Self::Cloth,
    ];

    pub fn is_active_for_tier(self, tier: u8) -> bool {
        match self {
            Self::Food => tier >= 1,
            Self::Firewood | Self::Water => tier >= 2,
            Self::PreservedFood | Self::Ale | Self::Cloth => tier >= 3,
        }
    }

    /// Needs whose absence damages health. Firewood is a survival need only
    /// when seasonal demand rises above the mild-weather baseline.
    pub fn is_vital_for_tier(self, tier: u8, cold_weather: bool) -> bool {
        self.is_active_for_tier(tier) && matches!(self, Self::Food | Self::Water)
            || (self == Self::Firewood && self.is_active_for_tier(tier) && cold_weather)
    }

    pub fn is_status_need(self) -> bool {
        matches!(self, Self::Ale | Self::PreservedFood | Self::Cloth)
    }

    pub fn as_u8(self) -> u8 {
        match self {
            Self::Firewood => 0,
            Self::Water => 1,
            Self::Food => 2,
            Self::Ale => 6,
            Self::PreservedFood => 7,
            Self::Cloth => 14,
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
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::ResidenceNeedKind;

    #[test]
    fn needs_form_a_three_step_progression() {
        let active_count = |tier| {
            ResidenceNeedKind::ALL
                .into_iter()
                .filter(|kind| kind.is_active_for_tier(tier))
                .count()
        };

        assert_eq!(active_count(0), 0);
        assert_eq!(active_count(1), 1);
        assert_eq!(active_count(2), 3);
        assert_eq!(active_count(3), 6);
        assert!(ResidenceNeedKind::Food.is_active_for_tier(1));
        assert!(!ResidenceNeedKind::Firewood.is_active_for_tier(1));
        assert!(!ResidenceNeedKind::PreservedFood.is_active_for_tier(2));
        assert_eq!(ResidenceNeedKind::Cloth.as_u8(), 14);
    }
}
