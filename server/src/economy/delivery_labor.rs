//! Cart labor totals shared by one production phase, with live mutation updates.
use crate::db::*;
use crate::tables::DeliveryTrip;
use spacetimedb::{Identity, ReducerContext};
use std::cell::RefCell;
use std::collections::HashMap;

#[derive(Default)]
struct DeliveryLaborTotals {
    free_by_owner: HashMap<Identity, u64>,
    rostered_by_building: HashMap<u64, u64>,
    #[cfg(feature = "local-loadtest")]
    queries: u64,
    #[cfg(feature = "local-loadtest")]
    scanned_rows: u64,
}

impl DeliveryLaborTotals {
    fn add(&mut self, trip: &DeliveryTrip) {
        *self.free_by_owner.entry(trip.owner).or_default() += u64::from(trip.free_hauler_workers);
        let building = labor_building(trip);
        if building != 0 {
            *self.rostered_by_building.entry(building).or_default() += u64::from(
                trip.delivery_workers
                    .saturating_sub(trip.free_hauler_workers),
            );
        }
    }

    fn remove(&mut self, trip: &DeliveryTrip) {
        if let Some(workers) = self.free_by_owner.get_mut(&trip.owner) {
            *workers -= u64::from(trip.free_hauler_workers);
        }
        if let Some(workers) = self.rostered_by_building.get_mut(&labor_building(trip)) {
            *workers -= u64::from(
                trip.delivery_workers
                    .saturating_sub(trip.free_hauler_workers),
            );
        }
    }
}

fn labor_building(trip: &DeliveryTrip) -> u64 {
    if trip.labor_building_id != 0 {
        trip.labor_building_id
    } else if trip.free_hauler_workers < trip.delivery_workers {
        trip.building_id
    } else {
        0
    }
}

thread_local! {
    // Outer None disables caching outside a guarded phase. Inner None loads
    // the current table only when its first labor query actually needs it.
    static DELIVERY_LABOR_TOTALS: RefCell<Option<Option<DeliveryLaborTotals>>> = const { RefCell::new(None) };
}

pub(crate) struct DeliveryLaborCache;
pub(crate) fn cache_delivery_labor() -> DeliveryLaborCache {
    DELIVERY_LABOR_TOTALS.with(|cache| *cache.borrow_mut() = Some(None));
    DeliveryLaborCache
}
impl Drop for DeliveryLaborCache {
    fn drop(&mut self) {
        DELIVERY_LABOR_TOTALS.with(|cache| {
            let _completed = cache.borrow_mut().take();
            #[cfg(feature = "local-loadtest")]
            if let Some(Some(totals)) = _completed {
                log::debug!("Cart labor cache phase: {} lookups, {} scanned rows", totals.queries, totals.scanned_rows);
            }
        });
    }
}

fn cached_total(
    ctx: &ReducerContext,
    read: impl FnOnce(&DeliveryLaborTotals) -> u64,
) -> Option<u32> {
    DELIVERY_LABOR_TOTALS.with(|cache| {
        let mut cache = cache.borrow_mut();
        let totals = cache.as_mut()?;
        if totals.is_none() {
            #[cfg(feature = "local-loadtest")]
            let _timer = spacetimedb::log_stopwatch::LogStopwatch::new("cart labor scan");
            let mut loaded = DeliveryLaborTotals::default();
            for trip in ctx.db.delivery_trip().iter() {
                loaded.add(&trip);
                #[cfg(feature = "local-loadtest")]
                { loaded.scanned_rows += 1; }
            }
            *totals = Some(loaded);
        }
        #[cfg(feature = "local-loadtest")]
        { totals.as_mut().unwrap().queries += 1; }
        Some(read(totals.as_ref().unwrap()).min(u64::from(u32::MAX)) as u32)
    })
}

pub(crate) fn cached_free_hauler_labor(ctx: &ReducerContext, owner: Identity) -> Option<u32> {
    cached_total(ctx, |totals| {
        totals.free_by_owner.get(&owner).copied().unwrap_or(0)
    })
}

pub(crate) fn cached_rostered_cart_labor(ctx: &ReducerContext, building: u64) -> Option<u32> {
    cached_total(ctx, |totals| {
        totals
            .rostered_by_building
            .get(&building)
            .copied()
            .unwrap_or(0)
    })
}

pub(crate) fn record_delivery_trip_started(trip: &DeliveryTrip) {
    DELIVERY_LABOR_TOTALS.with(|cache| {
        if let Some(Some(totals)) = cache.borrow_mut().as_mut() {
            totals.add(trip);
        }
    });
}

pub(crate) fn record_delivery_trip_finished(trip: &DeliveryTrip) {
    DELIVERY_LABOR_TOTALS.with(|cache| {
        if let Some(Some(totals)) = cache.borrow_mut().as_mut() {
            totals.remove(trip);
        }
    });
}

pub(crate) fn invalidate_delivery_labor() {
    DELIVERY_LABOR_TOTALS.with(|cache| {
        if let Some(totals) = cache.borrow_mut().as_mut() {
            *totals = None;
        }
    });
}
