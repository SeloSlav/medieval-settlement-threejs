#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum ResidenceNeedKind {
    Firewood,
}

impl ResidenceNeedKind {
    pub const ALL: [ResidenceNeedKind; 1] = [Self::Firewood];

    pub fn as_u8(self) -> u8 {
        match self {
            Self::Firewood => 0,
        }
    }

    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::Firewood),
            _ => None,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Firewood => "firewood",
        }
    }
}
