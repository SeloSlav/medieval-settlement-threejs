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

const PENDING_CARGO_EPSILON: f64 = 1e-6;

/// Only a positive load still traveling toward, or unloading at, its target
/// suppresses another dispatch. An empty cart on its return leg has already
/// completed delivery and must not extend the target's queue latency.
pub fn delivery_cargo_is_approaching(phase: u8, amount: f64) -> bool {
    amount.is_finite()
        && amount > PENDING_CARGO_EPSILON
        && matches!(
            DeliveryTripPhase::from_u8(phase),
            Some(DeliveryTripPhase::Outbound | DeliveryTripPhase::Unloading)
        )
}

/// A normal destination receives one supply cart at a time. A Marketplace is
/// different: its independent food and goods tables may receive distinct
/// commodities concurrently, while a second load of the same commodity must
/// still wait so source-side requests cannot reserve the same empty room twice.
pub fn inbound_supply_trip_conflicts(
    target_is_marketplace: bool,
    requested_cargo_kind: u8,
    inbound_cargo_kind: u8,
    phase: u8,
    amount: f64,
) -> bool {
    delivery_cargo_is_approaching(phase, amount)
        && (!target_is_marketplace || requested_cargo_kind == inbound_cargo_kind)
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
    use super::{
        delivery_cargo_is_approaching, inbound_supply_trip_conflicts, raid_cart_posture,
        DeliveryTripPhase, RaidCartPosture,
    };

    #[test]
    fn only_nonempty_outbound_or_unloading_cargo_suppresses_another_dispatch() {
        assert!(delivery_cargo_is_approaching(
            DeliveryTripPhase::Outbound.as_u8(),
            8.0,
        ));
        assert!(delivery_cargo_is_approaching(
            DeliveryTripPhase::Unloading.as_u8(),
            8.0,
        ));
        assert!(!delivery_cargo_is_approaching(
            DeliveryTripPhase::Inbound.as_u8(),
            8.0,
        ));
        assert!(!delivery_cargo_is_approaching(
            DeliveryTripPhase::Inbound.as_u8(),
            0.0,
        ));
        assert!(!delivery_cargo_is_approaching(
            DeliveryTripPhase::Outbound.as_u8(),
            0.0,
        ));
        assert!(!delivery_cargo_is_approaching(u8::MAX, 8.0));
        assert!(!delivery_cargo_is_approaching(
            DeliveryTripPhase::Outbound.as_u8(),
            f64::NAN,
        ));
    }

    #[test]
    fn marketplace_parallelism_is_distinct_by_commodity_without_duplicate_reservations() {
        let outbound = DeliveryTripPhase::Outbound.as_u8();
        let unloading = DeliveryTripPhase::Unloading.as_u8();
        let returning = DeliveryTripPhase::Inbound.as_u8();

        assert!(inbound_supply_trip_conflicts(true, 55, 55, outbound, 24.0));
        assert!(inbound_supply_trip_conflicts(true, 55, 55, unloading, 24.0));
        assert!(!inbound_supply_trip_conflicts(true, 55, 0, outbound, 24.0));
        assert!(inbound_supply_trip_conflicts(false, 55, 0, outbound, 24.0));
        assert!(!inbound_supply_trip_conflicts(
            true, 55, 55, returning, 24.0
        ));
        assert!(!inbound_supply_trip_conflicts(true, 55, 55, outbound, 0.0));
    }

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
