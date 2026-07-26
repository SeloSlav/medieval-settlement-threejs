//! Shared delivery dispatch choreography for lodge, well, and food suppliers.

use spacetimedb::ReducerContext;

use crate::roads::RoadNetwork;
use crate::simulation::delivery_trips::{building_has_active_trip, try_start_delivery_trip};
use crate::simulation::game_calendar::GameClock;
use crate::simulation::residence_needs::ResidenceNeedKind;
use crate::simulation::SimTickContext;
use crate::tables::{Building, Residence};

#[derive(Clone, Copy, Debug)]
pub struct DeliveryDispatchConfig {
    pub need_kind: ResidenceNeedKind,
    pub speed_mps: f64,
    pub unload_seconds: f64,
    pub per_delivery: f64,
}

pub fn delivery_work_ready(
    delivering_workers: u32,
    building_has_stock: bool,
    building_id: u64,
    ctx: &ReducerContext,
) -> bool {
    delivering_workers > 0 && building_has_stock && !building_has_active_trip(ctx, building_id)
}

pub fn should_alternate_single_worker(
    single_worker: bool,
    alternate_work_ready: bool,
    delivery_ready: bool,
    has_target: bool,
) -> (bool, bool) {
    let do_deliver = delivery_ready && (!single_worker || !alternate_work_ready || has_target);
    let do_alternate = alternate_work_ready && (!single_worker || !delivery_ready || !has_target);
    (do_deliver, do_alternate)
}

pub fn dispatch_delivery_if_ready(
    ctx: &ReducerContext,
    tick: &SimTickContext,
    clock: &GameClock,
    network: &RoadNetwork,
    building: &mut Building,
    delivery_workers: u32,
    targets: &[Residence],
    config: DeliveryDispatchConfig,
) -> bool {
    if delivery_workers == 0 {
        return false;
    }
    try_start_delivery_trip(
        ctx,
        tick,
        clock,
        network,
        building,
        delivery_workers,
        targets,
        config.need_kind,
        config.speed_mps,
        config.unload_seconds,
        config.per_delivery,
    )
}
