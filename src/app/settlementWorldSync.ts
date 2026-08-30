import type { DeliveryAgentRenderer } from '../logistics/DeliveryAgentRenderer.ts';
import type { VillagerRenderer } from '../settlement/VillagerRenderer.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { BackyardGardenMarkers } from '../residences/BackyardGardenMarkers.ts';
import type { ResidenceMarkers } from '../residences/ResidenceMarkers.ts';
import type { BurialMarkers } from '../residences/BurialMarkers.ts';
import type { FarmFieldMarkers } from '../farming/FarmFieldMarkers.ts';
import type { PastureMarkers } from '../farming/PastureMarkers.ts';
import type { LivestockVisuals } from '../farming/LivestockVisuals.ts';
import type { VineyardParcelMarkers } from '../vineyards/VineyardParcelMarkers.ts';
import type { GameState } from '../resources/types.ts';
import type { FireEffectsRenderer } from '../fires/FireEffectsRenderer.ts';
import type { TreeRegistry } from '../resources/TreeRegistry.ts';
import type { CrowdViewState } from '../settlement/crowdView.ts';
import { gameClock } from '../world/gameCalendar.ts';
import { fireDisabledResidenceIds } from '../fires/fireIncident.ts';

export type SettlementWorldSyncTargets = {
  residenceMarkers: ResidenceMarkers | null;
  farmFieldMarkers: FarmFieldMarkers | null;
  pastureMarkers: PastureMarkers | null;
  vineyardParcelMarkers: VineyardParcelMarkers | null;
  burialMarkers: BurialMarkers | null;
  livestockVisuals: LivestockVisuals | null;
  backyardGardenMarkers: BackyardGardenMarkers | null;
  deliveryAgents: DeliveryAgentRenderer | null;
  fireEffects: FireEffectsRenderer | null;
  villagers: VillagerRenderer | null;
  getHeightAt: (x: number, z: number) => number;
  getRoadNetwork: () => RoadNetwork | null;
  getTreeRegistry: () => TreeRegistry | null;
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
  const vineyardsChanged = !previous || !mapEntriesShareValues(
    state.vineyardParcels ?? new Map(),
    previous.vineyardParcels ?? new Map(),
  );
  const graveyards = state.graveyards ?? new Map();
  const previousGraveyards = previous?.graveyards ?? new Map();
  const corpses = state.corpses ?? new Map();
  const previousCorpses = previous?.corpses ?? new Map();
  const graveyardsChanged = !previous
    || !mapEntriesShareValues(graveyards, previousGraveyards);
  const burialsChanged = graveyardsChanged
    || !mapEntriesShareValues(corpses, previousCorpses);
  const livestockChanged = !previous || !mapEntriesShareValues(
    state.livestockHerds,
    previous.livestockHerds,
  );
  const livestockBuildingsChanged = !previous || !mapEntriesShareValues(
    state.buildings,
    previous.buildings,
  );
  const stableOxenChanged = !previous || !mapEntriesShareValues(
    state.stableOxen,
    previous.stableOxen,
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
  const workerCartCrewsChanged = !previous || !mapEntriesMatch(
    state.deliveryTrips,
    previous.deliveryTrips,
    (current, prior) =>
      current.buildingId === prior.buildingId
      && current.laborBuildingId === prior.laborBuildingId
      && current.deliveryWorkers === prior.deliveryWorkers
      && current.freeHaulerWorkers === prior.freeHaulerWorkers
      && current.oxId === prior.oxId,
  );
  const fireIncidentsChanged = !previous || !mapEntriesShareValues(
    state.fireIncidents,
    previous.fireIncidents,
  );
  const workerBuildingsChanged = !previous || !mapEntriesMatch(
    state.buildings,
    previous.buildings,
    (current, prior) =>
      current.kind === prior.kind
      && current.x === prior.x
      && current.z === prior.z
      && current.workRadius === prior.workRadius
      && current.treeWorkArea?.x === prior.treeWorkArea?.x
      && current.treeWorkArea?.z === prior.treeWorkArea?.z
      && current.treeWorkArea?.radius === prior.treeWorkArea?.radius
      && current.assignedLabor === prior.assignedLabor,
  );
  const workerResourcesChanged = !previous
    || !mapEntriesMatch(
      state.quarries,
      previous.quarries,
      (current, prior) =>
        current.remaining === prior.remaining
        && current.x === prior.x
        && current.z === prior.z,
    )
    || !mapEntriesMatch(
      state.foragingNodes,
      previous.foragingNodes,
      (current, prior) =>
        current.remaining === prior.remaining
        && current.x === prior.x
        && current.z === prior.z
        && current.kind === prior.kind,
    );
  const workerForagingMonthChanged = !previous
    || gameClock(state.tick).month !== gameClock(previous.tick).month;
  const backyardGardenDayChanged = !previous
    || gameClock(state.tick).totalDays !== gameClock(previous.tick).totalDays;
  const workerTreePhasesChanged = !previous || !mapEntriesMatch(
    state.trees,
    previous.trees,
    (current, prior) => current.phase === prior.phase,
  );
  const workerFieldsChanged = !previous || !mapEntriesMatch(
    state.farmFields,
    previous.farmFields,
    (current, prior) =>
      current.farmsteadId === prior.farmsteadId
      && current.priority === prior.priority
      && cornersEqual(current.corners, prior.corners),
  );
  const workerPasturesChanged = !previous || !mapEntriesMatch(
    state.pastures,
    previous.pastures,
    (current, prior) =>
      current.farmsteadId === prior.farmsteadId
      && cornersEqual(current.corners, prior.corners),
  );

  if (residencesChanged) {
    targets.residenceMarkers?.syncResidences(state.residences.values(), getHeightAt);
  }
  if (fireIncidentsChanged) {
    targets.residenceMarkers?.setFireDisabledResidenceIds(
      fireDisabledResidenceIds(state.fireIncidents.values()),
    );
  }
  if (
    residencesChanged
    || workerBuildingsChanged
    || workerResourcesChanged
    || workerForagingMonthChanged
    || workerTreePhasesChanged
    || workerFieldsChanged
    || workerPasturesChanged
    || vineyardsChanged
    || graveyardsChanged
    || burialsChanged
    || workerCartCrewsChanged
    || fireIncidentsChanged
    || gardensChanged
    || burgageZonesChanged
    || stableOxenChanged
  ) {
    targets.villagers?.sync({
      residences: state.residences.values(),
      buildings: state.buildings.values(),
      quarries: state.quarries.values(),
      foragingNodes: state.foragingNodes.values(),
      trees: state.trees,
      treeRegistry: targets.getTreeRegistry(),
      farmFields: state.farmFields.values(),
      pastures: state.pastures.values(),
      vineyardParcels: state.vineyardParcels?.values() ?? [],
      graveyards: graveyards.values(),
      corpses: corpses.values(),
      backyardGardens: state.backyardGardens.values(),
      burgageZones: state.burgageZones.values(),
      deliveryTrips: state.deliveryTrips.values(),
      oxen: state.stableOxen.values(),
      fireIncidents: state.fireIncidents.values(),
      roadNetwork: targets.getRoadNetwork(),
      foragingMonth: gameClock(state.tick).month,
    });
  }
  if (farmFieldsChanged) {
    targets.farmFieldMarkers?.syncFields(state.farmFields.values());
  }
  if (pasturesChanged || livestockChanged) {
    targets.pastureMarkers?.syncPastures(state.pastures.values(), state.livestockHerds);
  }
  if (pasturesChanged || livestockChanged || livestockBuildingsChanged) {
    targets.livestockVisuals?.sync(
      state.pastures.values(),
      state.livestockHerds,
      state.buildings,
    );
  }
  if (vineyardsChanged) {
    targets.vineyardParcelMarkers?.sync(state.vineyardParcels?.values() ?? []);
  }
  if (burialsChanged) {
    targets.burialMarkers?.sync(graveyards.values(), corpses.values(), getHeightAt);
  }
  if (
    residencesChanged
    || burgageZonesChanged
    || gardensChanged
    || workerForagingMonthChanged
    || backyardGardenDayChanged
  ) {
    const clock = gameClock(state.tick);
    targets.backyardGardenMarkers?.syncGardens({
      residences: state.residences.values(),
      zones: state.burgageZones.values(),
      gardens: state.backyardGardens,
      month: clock.month,
      totalDays: clock.totalDays,
      getHeightAt,
    });
  }
  if (deliveryTripsChanged) {
    targets.deliveryAgents?.syncTrips(state.deliveryTrips.values());
    targets.fireEffects?.syncTrips(state.deliveryTrips.values());
  }
  if (fireIncidentsChanged || residencesChanged || workerBuildingsChanged) {
    targets.fireEffects?.syncIncidents(
      state.fireIncidents.values(),
      state.buildings,
      state.residences,
    );
  }
}

export function tickSettlementWorld(
  targets: Pick<SettlementWorldSyncTargets, 'residenceMarkers' | 'backyardGardenMarkers' | 'livestockVisuals' | 'deliveryAgents' | 'fireEffects' | 'villagers'>,
  dt: number,
  view?: CrowdViewState,
): void {
  targets.residenceMarkers?.tick(dt);
  targets.backyardGardenMarkers?.tick(dt, view);
  targets.livestockVisuals?.tick(dt, view);
  targets.deliveryAgents?.update(dt, view);
  targets.fireEffects?.tick(dt);
  targets.villagers?.tick(dt, view);
}

export function disposeSettlementWorld(
  targets: SettlementWorldSyncTargets,
): void {
  targets.residenceMarkers?.dispose();
  targets.farmFieldMarkers?.dispose();
  targets.pastureMarkers?.dispose();
  targets.vineyardParcelMarkers?.dispose();
  targets.burialMarkers?.dispose();
  targets.livestockVisuals?.dispose();
  targets.backyardGardenMarkers?.dispose();
  targets.deliveryAgents?.dispose();
  targets.fireEffects?.dispose();
  targets.villagers?.dispose();
}

function cornersEqual(
  current: readonly { x: number; z: number }[],
  previous: readonly { x: number; z: number }[],
): boolean {
  if (current.length !== previous.length) return false;
  return current.every(
    (point, index) =>
      point.x === previous[index]?.x
      && point.z === previous[index]?.z,
  );
}

function mapEntriesMatch<K, V>(
  current: ReadonlyMap<K, V>,
  previous: ReadonlyMap<K, V>,
  matches: (current: V, previous: V) => boolean,
): boolean {
  if (current === previous) return true;
  if (current.size !== previous.size) return false;
  for (const [key, value] of current) {
    const prior = previous.get(key);
    if (prior === undefined || !matches(value, prior)) return false;
  }
  return true;
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
