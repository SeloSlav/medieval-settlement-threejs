//! Pure delivery-agent state rules shared by the authoritative module and
//! native host tests.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeliveryTripPhase {
    Outbound = 0,
    Unloading = 1,
    Inbound = 2,
}

impl DeliveryTripPhase {
    pub fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::Outbound),
            1 => Some(Self::Unloading),
            2 => Some(Self::Inbound),
            _ => None,
        }
    }

    pub fn as_u8(self) -> u8 {
        self as u8
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RaidCartPosture {
    /// No capable raider is present, or this is an emergency fire cart.
    Ordinary,
    /// A loaded outward cart must reverse before unloading.
    Recall,
    /// A cart already facing home keeps moving despite the general work stop.
    ReturnHome,
}

pub fn raid_cart_posture(
    active_raider_threat: bool,
    fire_response: bool,
    phase: DeliveryTripPhase,
) -> RaidCartPosture {
    if !active_raider_threat || fire_response {
        return RaidCartPosture::Ordinary;
    }
    match phase {
        DeliveryTripPhase::Outbound | DeliveryTripPhase::Unloading => RaidCartPosture::Recall,
        DeliveryTripPhase::Inbound => RaidCartPosture::ReturnHome,
    }
}

#[cfg(test)]
mod tests {
    use super::{raid_cart_posture, DeliveryTripPhase, RaidCartPosture};

    #[test]
    fn ordinary_loaded_carts_reverse_when_hostiles_are_physically_active() {
        assert_eq!(
            raid_cart_posture(true, false, DeliveryTripPhase::Outbound),
            RaidCartPosture::Recall,
        );
        assert_eq!(
            raid_cart_posture(true, false, DeliveryTripPhase::Unloading),
            RaidCartPosture::Recall,
        );
    }

    #[test]
    fn homeward_and_fire_carts_keep_moving_through_the_alarm() {
        assert_eq!(
            raid_cart_posture(true, false, DeliveryTripPhase::Inbound),
            RaidCartPosture::ReturnHome,
        );
        for phase in [
            DeliveryTripPhase::Outbound,
            DeliveryTripPhase::Unloading,
            DeliveryTripPhase::Inbound,
        ] {
            assert_eq!(
                raid_cart_posture(true, true, phase),
                RaidCartPosture::Ordinary,
            );
        }
    }

    #[test]
    fn no_alarm_preserves_the_ordinary_schedule_for_every_phase() {
        for phase in [
            DeliveryTripPhase::Outbound,
            DeliveryTripPhase::Unloading,
            DeliveryTripPhase::Inbound,
        ] {
            assert_eq!(
                raid_cart_posture(false, false, phase),
                RaidCartPosture::Ordinary,
            );
        }
    }
}
