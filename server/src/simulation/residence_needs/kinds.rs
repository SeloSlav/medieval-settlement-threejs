#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum ResidenceNeedKind {
    Firewood,
    Water,
    Food,
}

impl ResidenceNeedKind {
    pub const ALL: [ResidenceNeedKind; 3] = [Self::Firewood, Self::Water, Self::Food];

    pub fn as_u8(self) -> u8 {
        match self {
            Self::Firewood => 0,
            Self::Water => 1,
            Self::Food => 2,
        }
    }

    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::Firewood),
            1 => Some(Self::Water),
            2 => Some(Self::Food),
            _ => None,
        }
    }
}
