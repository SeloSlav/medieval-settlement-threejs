import type { DeliveryAgentRenderer } from '../logistics/DeliveryAgentRenderer.ts';
import type { VillagerRenderer } from '../settlement/VillagerRenderer.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { BackyardGardenMarkers } from '../residences/BackyardGardenMarkers.ts';
import type { ResidenceMarkers } from '../residences/ResidenceMarkers.ts';
import type { FarmFieldMarkers } from '../farming/FarmFieldMarkers.ts';
import type { PastureMarkers } from '../farming/PastureMarkers.ts';
import type { LivestockVisuals } from '../farming/LivestockVisuals.ts';
import type { GameState } from '../resources/types.ts';
import type { CrowdViewState } from '../settlement/crowdView.ts';

export type SettlementWorldSyncTargets = {
  residenceMarkers: ResidenceMarkers | null;
  farmFieldMarkers: FarmFieldMarkers | null;
  pastureMarkers: PastureMarkers | null;
  livestockVisuals: LivestockVisuals | null;
  backyardGardenMarkers: BackyardGardenMarkers | null;
  deliveryAgents: DeliveryAgentRenderer | null;
  villagers: VillagerRenderer | null;
  getHeightAt: (x: number, z: number) => number;
  getRoadNetwork: () => RoadNetwork | null;
};

export function syncSettlementWorld(
  targets: SettlementWorldSyncTargets,
  state: GameState,
  previous: GameState | null = null,
): void {
  const { getHeightAt } = targets;
  const residencesChanged = !previous || !mapEntriesShareValues(
    state.residences,
    previous.residences,
  );
  const farmFieldsChanged = !previous || !mapEntriesShareValues(
    state.farmFields,
    previous.farmFields,
  );
  const pasturesChanged = !previous || !mapEntriesShareValues(
    state.pastures,
    previous.pastures,
  );
  const livestockChanged = !previous || !mapEntriesShareValues(
    state.livestockHerds,
    previous.livestockHerds,
  );
  const burgageZonesChanged = !previous || !mapEntriesShareValues(
    state.burgageZones,
    previous.burgageZones,
  );
  const gardensChanged = !previous || !mapEntriesShareValues(
    state.backyardGardens,
    previous.backyardGardens,
  );
  const deliveryTripsChanged = !previous || !mapEntriesShareValues(
    state.deliveryTrips,
    previous.deliveryTrips,
  );

  if (residencesChanged) {
    targets.residenceMarkers?.syncResidences(state.residences.values(), getHeightAt);
    targets.villagers?.sync({
      residences: state.residences.values(),
      roadNetwork: targets.getRoadNetwork(),
    });
  }
  if (farmFieldsChanged) {
    targets.farmFieldMarkers?.syncFields(state.farmFields.values());
  }
  if (pasturesChanged || livestockChanged) {
    targets.pastureMarkers?.syncPastures(state.pastures.values(), state.livestockHerds);
    targets.livestockVisuals?.sync(state.pastures.values(), state.livestockHerds);
  }
  if (residencesChanged || burgageZonesChanged || gardensChanged) {
    targets.backyardGardenMarkers?.syncGardens({
      residences: state.residences.values(),
      zones: state.burgageZones.values(),
      gardens: state.backyardGardens,
      getHeightAt,
    });
  }
  if (deliveryTripsChanged) {
    targets.deliveryAgents?.syncTrips(state.deliveryTrips.values());
    targets.deliveryAgents?.applyTripStates(state.deliveryTrips.values());
  }
}

export function tickSettlementWorld(
  targets: Pick<SettlementWorldSyncTargets, 'residenceMarkers' | 'backyardGardenMarkers' | 'livestockVisuals' | 'deliveryAgents' | 'villagers'>,
  dt: number,
  view?: CrowdViewState,
  gameState?: Pick<GameState, 'deliveryTrips'>,
): void {
  if (gameState) {
    targets.deliveryAgents?.applyTripStates(gameState.deliveryTrips.values());
  }
  targets.residenceMarkers?.tick(dt);
  targets.backyardGardenMarkers?.tick(dt, view);
  targets.livestockVisuals?.tick(dt, view);
  targets.deliveryAgents?.update(dt, view);
  targets.villagers?.tick(dt, view);
}

export function disposeSettlementWorld(
  targets: SettlementWorldSyncTargets,
): void {
  targets.residenceMarkers?.dispose();
  targets.farmFieldMarkers?.dispose();
  targets.pastureMarkers?.dispose();
  targets.livestockVisuals?.dispose();
  targets.backyardGardenMarkers?.dispose();
  targets.deliveryAgents?.dispose();
  targets.villagers?.dispose();
}

function mapEntriesShareValues<K, V>(
  current: ReadonlyMap<K, V>,
  previous: ReadonlyMap<K, V>,
): boolean {
  if (current === previous) return true;
  if (current.size !== previous.size) return false;
  for (const [key, value] of current) {
    if (previous.get(key) !== value) return false;
  }
  return true;
}
