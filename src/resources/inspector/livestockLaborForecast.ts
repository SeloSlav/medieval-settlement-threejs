import type { LivestockLaborForecast } from '../../economy/livestockFodder.ts';
import { fireDisabledBuildingIds } from '../../fires/fireIncident.ts';
import { rosteredCartWorkersByBuilding } from '../../logistics/deliveryTrips.ts';
import { assignStableOxen } from '../../settlement/stableOxen.ts';
import type { GameState } from '../types.ts';

function laborCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * Best-current client forecast of livestock labor. The shared ox allocator
 * keeps postings, automatic assignments, cart reservations, absent workers,
 * and fire-disabled sites aligned with the rest of the client. Tick-local
 * work pauses and ox claims remain authoritative on the server.
 */
export function livestockLaborForecastByBuilding(
  state: Pick<
    GameState,
    'buildings' | 'stableOxen' | 'deliveryTrips' | 'fireIncidents'
  >,
): Map<string, LivestockLaborForecast> {
  const trips = [...state.deliveryTrips.values()];
  const awayWorkers = rosteredCartWorkersByBuilding(state.buildings, trips);
  const disabledBuildingIds = fireDisabledBuildingIds(
    state.fireIncidents.values(),
  );
  const assignments = assignStableOxen(
    state.stableOxen.values(),
    state.buildings,
    trips,
    disabledBuildingIds,
  );
  const pairedOxenByBuilding = new Map<string, number>();
  for (const assignment of assignments.values()) {
    pairedOxenByBuilding.set(
      assignment.buildingId,
      (pairedOxenByBuilding.get(assignment.buildingId) ?? 0) + 1,
    );
  }

  const forecasts = new Map<string, LivestockLaborForecast>();
  for (const building of state.buildings.values()) {
    if (building.kind !== 'pastoral_farmstead' && building.kind !== 'swineherd') {
      continue;
    }
    const onsiteHumanWorkers = Math.max(
      0,
      laborCount(building.assignedLabor)
        - laborCount(awayWorkers.get(building.id) ?? 0),
    );
    const pairedOxen = Math.min(
      onsiteHumanWorkers,
      laborCount(pairedOxenByBuilding.get(building.id) ?? 0),
    );
    forecasts.set(building.id, {
      onsiteHumanWorkers,
      pairedOxen,
      effectiveWorkers: onsiteHumanWorkers + pairedOxen,
    });
  }
  return forecasts;
}
