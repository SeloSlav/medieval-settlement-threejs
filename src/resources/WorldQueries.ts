import type { Terrain } from '../terrain/Terrain.ts';
import type { RiverField } from '../rivers/RiverField.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import {
  claimResidencesForFoodSuppliers,
  claimResidencesForLodges,
  claimResidencesForWells,
  peekNextDeliveryTarget,
  peekNextWaterDeliveryTarget,
  roadPathDistance,
  sortByRoadPathDistance,
  sortResidencesForDelivery,
  sortResidencesForWaterDelivery,
} from '../logistics/roadLogistics.ts';
import { findActiveTripForBuilding, tripRemainingSeconds } from '../logistics/deliveryTrips.ts';
import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';
import { lodgeDeliveryTripSeconds, lodgeLaborSplit } from '../logistics/lodgeLogistics.ts';
import {
  isResidenceInWellRange,
  wellDeliveryTripSeconds,
  wellLaborSplit,
} from '../logistics/waterLogistics.ts';
import { areRoadConnected, formatRoadAccess, nearestRoadDistance } from '../roads/roadConnectivity.ts';
import { backyardIconPosition } from '../residences/backyardPosition.ts';
import type { BuildingKind, BuildingState, BurgageZoneState, GameState, InspectableTarget, QuarryNodeState, ResidenceState } from './types.ts';
import type { WorldLayoutRegistry } from './WorldLayoutRegistry.ts';
import { buildingKindLabel, findNearestBuilding as findBuilding } from './WorldLayoutRegistry.ts';
import { countTreesNearBuilding } from './ForestVisualSync.ts';
import type { TreeRegistry } from './TreeRegistry.ts';
import { RESIDENCE_PICK_RADIUS } from '../residences/burgageLayout.ts';

const RIVER_INSPECT_MAX_SHORE = 8;
const NEAREST_ROAD_MAX_DISTANCE = 24;

function findNearestResidenceTarget(
  state: GameState,
  x: number,
  z: number,
): Extract<InspectableTarget, { kind: 'residence' }> | null {
  let bestResidence: ResidenceState | null = null;
  let bestDistance = Infinity;

  for (const residence of state.residences.values()) {
    const distance = Math.hypot(x - residence.x, z - residence.z);
    if (distance > RESIDENCE_PICK_RADIUS || distance >= bestDistance) continue;
    bestDistance = distance;
    bestResidence = residence;
  }

  if (!bestResidence) return null;

  const zone = state.burgageZones.get(bestResidence.zoneId);
  if (!zone) return null;

  let residenceCount = 0;
  for (const residence of state.residences.values()) {
    if (residence.zoneId === zone.id) residenceCount += 1;
  }

  return {
    kind: 'residence',
    residence: bestResidence,
    zone,
    residenceCount,
  };
}

function pickCloserTarget(
  buildingTarget: Extract<InspectableTarget, { kind: 'building' }>,
  residenceTarget: Extract<InspectableTarget, { kind: 'residence' }>,
  x: number,
  z: number,
): InspectableTarget {
  const buildingDistance = Math.hypot(x - buildingTarget.building.x, z - buildingTarget.building.z);
  const residenceDistance = Math.hypot(x - residenceTarget.residence.x, z - residenceTarget.residence.z);
  return residenceDistance < buildingDistance ? residenceTarget : buildingTarget;
}

function buildBackyardTarget(
  state: GameState,
  residence: ResidenceState,
  zone: BurgageZoneState,
): Extract<InspectableTarget, { kind: 'backyard' }> | null {
  if (!backyardIconPosition(residence, zone)) return null;
  return {
    kind: 'backyard',
    residence,
    zone,
    garden: state.backyardGardens.get(residence.id) ?? null,
  };
}

export class WorldQueries {
  private readonly terrain: Terrain;
  private readonly riverField: RiverField;
  private readonly registry: WorldLayoutRegistry;
  private readonly getGameState: () => GameState;
  private readonly getRoadNetwork: () => RoadNetwork;
  private readonly getTreeRegistry: () => TreeRegistry | null;

  constructor(options: {
    terrain: Terrain;
    riverField: RiverField;
    registry: WorldLayoutRegistry;
    getGameState: () => GameState;
    getRoadNetwork: () => RoadNetwork;
    getTreeRegistry: () => TreeRegistry | null;
  }) {
    this.terrain = options.terrain;
    this.riverField = options.riverField;
    this.registry = options.registry;
    this.getGameState = options.getGameState;
    this.getRoadNetwork = options.getRoadNetwork;
    this.getTreeRegistry = options.getTreeRegistry;
  }

  getHeightAt(x: number, z: number): number {
    return this.terrain.getHeightAt(x, z);
  }

  getRiverAccessInfo(x: number, z: number): { shoreDistance: number; onWater: boolean } {
    return {
      onWater: this.riverField.isRenderedWetAt(x, z),
      shoreDistance: this.riverField.sampleShoreDistance(x, z),
    };
  }

  getRiverField(): RiverField {
    return this.riverField;
  }

  findInspectableTarget(x: number, z: number): InspectableTarget | null {
    const state = this.getGameState();
    const backyardTarget = this.findNearestBackyardTarget(x, z);
    const building = findBuilding(state.buildings.values(), x, z);
    const residenceTarget = findNearestResidenceTarget(state, x, z);

    if (backyardTarget) {
      const backyardPos = backyardIconPosition(backyardTarget.residence, backyardTarget.zone);
      const backyardDistance = backyardPos ? Math.hypot(x - backyardPos.x, z - backyardPos.z) : Infinity;
      const residenceDistance = residenceTarget
        ? Math.hypot(x - residenceTarget.residence.x, z - residenceTarget.residence.z)
        : Infinity;
      if (backyardDistance + 0.5 < residenceDistance) {
        return backyardTarget;
      }
    }

    if (building && residenceTarget) {
      const treeRegistry = this.getTreeRegistry();
      const counts = treeRegistry
        ? countTreesNearBuilding(state, treeRegistry, building.x, building.z, building.workRadius)
        : { matureTrees: 0, stumpTrees: 0, growingTrees: 0 };
      return pickCloserTarget(
        {
          kind: 'building',
          building,
          matureTrees: counts.matureTrees,
          stumpTrees: counts.stumpTrees,
          growingTrees: counts.growingTrees,
        },
        residenceTarget,
        x,
        z,
      );
    }

    if (residenceTarget) return residenceTarget;

    if (building) {
      const treeRegistry = this.getTreeRegistry();
      const counts = treeRegistry
        ? countTreesNearBuilding(state, treeRegistry, building.x, building.z, building.workRadius)
        : { matureTrees: 0, stumpTrees: 0, growingTrees: 0 };
      return {
        kind: 'building',
        building,
        matureTrees: counts.matureTrees,
        stumpTrees: counts.stumpTrees,
        growingTrees: counts.growingTrees,
      };
    }

    const quarryDefinition = this.registry.findNearestQuarry(x, z);
    if (quarryDefinition) {
      const quarryState = state.quarries.get(quarryDefinition.id);
      if (quarryState) {
        return { kind: 'quarry', definition: quarryDefinition, state: quarryState };
      }
    }

    const gameDefinition = this.registry.findNearestForagingNode(x, z, 'game');
    if (gameDefinition) {
      const nodeState = state.foragingNodes.get(gameDefinition.id);
      if (nodeState && nodeState.remaining > 0) {
        return { kind: 'foraging', definition: gameDefinition, state: nodeState };
      }
    }

    const berryDefinition = this.registry.findNearestForagingNode(x, z, 'berries');
    if (berryDefinition) {
      const nodeState = state.foragingNodes.get(berryDefinition.id);
      if (nodeState && nodeState.remaining > 0) {
        return { kind: 'foraging', definition: berryDefinition, state: nodeState };
      }
    }

    const river = this.getRiverAccessInfo(x, z);
    if (river.onWater || river.shoreDistance <= RIVER_INSPECT_MAX_SHORE) {
      return { kind: 'river', x, z, ...river };
    }

    return null;
  }

  getNearestRoadNodeDistance(x: number, z: number): number | null {
    const network = this.getRoadNetwork();
    const distance = nearestRoadDistance(x, z, network);
    if (!Number.isFinite(distance) || distance > NEAREST_ROAD_MAX_DISTANCE) return null;
    return distance;
  }

  getRoadAccessLabel(x: number, z: number): string {
    return formatRoadAccess(nearestRoadDistance(x, z, this.getRoadNetwork()));
  }

  private getResidenceWellClaims(): Map<string, string> {
    const state = this.getGameState();
    return claimResidencesForWells(
      this.getRoadNetwork(),
      [...state.buildings.values()],
      [...state.residences.values()],
    );
  }

  getRoadConnectedWells(building: BuildingState): BuildingState[] {
    const state = this.getGameState();
    const network = this.getRoadNetwork();
    const wells = [...state.buildings.values()].filter(
      (candidate) =>
        candidate.kind === 'well'
        && roadPathDistance(network, building.x, building.z, candidate.x, candidate.z) != null,
    );
    return sortByRoadPathDistance(network, building, wells);
  }

  getClaimedResidencesForWell(well: BuildingState): ResidenceState[] {
    const state = this.getGameState();
    const claims = this.getResidenceWellClaims();
    const residences = [...state.residences.values()].filter(
      (residence) =>
        !residence.abandoned
        && residence.population > 0
        && claims.get(residence.id) === well.id,
    );
    return sortResidencesForWaterDelivery(this.getRoadNetwork(), well, residences);
  }

  getNextWaterDeliveryTargetForWell(well: BuildingState): ResidenceState | null {
    const state = this.getGameState();
    const claims = this.getResidenceWellClaims();
    const residences = [...state.residences.values()].filter(
      (residence) =>
        !residence.abandoned
        && residence.population > 0
        && claims.get(residence.id) === well.id,
    );
    return peekNextWaterDeliveryTarget(this.getRoadNetwork(), well, residences);
  }

  getWellDeliveryTripSeconds(
    well: BuildingState,
    target: ResidenceState | null,
  ): number {
    return wellDeliveryTripSeconds(
      this.getRoadNetwork(),
      well,
      target,
      wellLaborSplit(well.assignedLabor).delivering,
    );
  }

  getServingWellForResidence(residence: ResidenceState): BuildingState | null {
    const wellId = this.getResidenceWellClaims().get(residence.id);
    if (!wellId) return null;
    return this.getGameState().buildings.get(wellId) ?? null;
  }

  countRoadConnectedResidencesInWellRange(well: BuildingState): number {
    return this.getClaimedResidencesForWell(well).length;
  }

  countResidencesInWellRange(well: BuildingState): number {
    const state = this.getGameState();
    let count = 0;
    for (const residence of state.residences.values()) {
      if (isResidenceInWellRange(well, residence)) count += 1;
    }
    return count;
  }

  private getResidenceLodgeClaims(): Map<string, string> {
    const state = this.getGameState();
    return claimResidencesForLodges(
      this.getRoadNetwork(),
      [...state.buildings.values()],
      [...state.residences.values()],
    );
  }

  getRoadPathDistance(ax: number, az: number, bx: number, bz: number): number | null {
    return roadPathDistance(this.getRoadNetwork(), ax, az, bx, bz);
  }

  hasRoadPathToBuildingKind(ax: number, az: number, kind: BuildingKind): boolean {
    const network = this.getRoadNetwork();
    for (const building of this.getGameState().buildings.values()) {
      if (building.kind !== kind) continue;
      if (roadPathDistance(network, ax, az, building.x, building.z) != null) {
        return true;
      }
    }
    return false;
  }

  hasRoadPathToStaffedBuildingKind(ax: number, az: number, kind: BuildingKind): boolean {
    const network = this.getRoadNetwork();
    for (const building of this.getGameState().buildings.values()) {
      if (building.kind !== kind || building.assignedLabor <= 0) continue;
      if (roadPathDistance(network, ax, az, building.x, building.z) != null) {
        return true;
      }
    }
    return false;
  }

  countRoadConnectedPopulation(building: BuildingState): number {
    const state = this.getGameState();
    const network = this.getRoadNetwork();
    let population = 0;
    for (const residence of state.residences.values()) {
      if (residence.abandoned || residence.population <= 0) continue;
      if (roadPathDistance(network, residence.x, residence.z, building.x, building.z) != null) {
        population += residence.population;
      }
    }
    return population;
  }

  countRoadConnectedResidences(building: BuildingState, requirePopulation = true): number {
    const state = this.getGameState();
    const network = this.getRoadNetwork();
    let count = 0;
    for (const residence of state.residences.values()) {
      if (residence.abandoned) continue;
      if (requirePopulation && residence.population <= 0) continue;
      if (roadPathDistance(network, residence.x, residence.z, building.x, building.z) != null) {
        count += 1;
      }
    }
    return count;
  }

  isResidenceConnectedToMarketplace(residence: ResidenceState): boolean {
    return this.hasRoadPathToBuildingKind(residence.x, residence.z, 'marketplace');
  }

  isResidenceConnectedToChapel(residence: ResidenceState): boolean {
    return this.hasRoadPathToStaffedBuildingKind(residence.x, residence.z, 'chapel');
  }

  getRoadConnectedMills(lodge: BuildingState): BuildingState[] {
    const state = this.getGameState();
    const network = this.getRoadNetwork();
    const mills = [...state.buildings.values()].filter(
      (building) =>
        building.kind === 'lumber_mill'
        && roadPathDistance(network, lodge.x, lodge.z, building.x, building.z) != null,
    );
    return sortByRoadPathDistance(network, lodge, mills);
  }

  getClaimedResidencesForLodge(lodge: BuildingState): ResidenceState[] {
    const state = this.getGameState();
    const claims = this.getResidenceLodgeClaims();
    const residences = [...state.residences.values()].filter(
      (residence) => claims.get(residence.id) === lodge.id,
    );
    return sortResidencesForDelivery(this.getRoadNetwork(), lodge, residences);
  }

  getNextDeliveryTargetForLodge(lodge: BuildingState): ResidenceState | null {
    const state = this.getGameState();
    const claims = this.getResidenceLodgeClaims();
    const residences = [...state.residences.values()].filter(
      (residence) => claims.get(residence.id) === lodge.id,
    );
    return peekNextDeliveryTarget(this.getRoadNetwork(), lodge, residences);
  }

  getServingLodgeForResidence(residence: ResidenceState): BuildingState | null {
    const lodgeId = this.getResidenceLodgeClaims().get(residence.id);
    if (!lodgeId) return null;
    return this.getGameState().buildings.get(lodgeId) ?? null;
  }

  private getResidenceFoodClaims(): Map<string, string> {
    const state = this.getGameState();
    return claimResidencesForFoodSuppliers(
      this.getRoadNetwork(),
      [...state.buildings.values()],
      [...state.residences.values()],
    );
  }

  getServingFoodSupplierForResidence(residence: ResidenceState): BuildingState | null {
    const supplierId = this.getResidenceFoodClaims().get(residence.id);
    if (!supplierId) return null;
    return this.getGameState().buildings.get(supplierId) ?? null;
  }

  getLodgeDeliveryTripSeconds(
    lodge: BuildingState,
    target: ResidenceState | null,
  ): number {
    return lodgeDeliveryTripSeconds(
      this.getRoadNetwork(),
      lodge,
      target,
      lodgeLaborSplit(lodge.assignedLabor).delivering,
    );
  }

  getActiveDeliveryTrip(building: BuildingState): DeliveryTripState | null {
    return findActiveTripForBuilding(this.getGameState().deliveryTrips.values(), building.id);
  }

  getActiveTripPathDistance(trip: DeliveryTripState): number | null {
    const building = this.getGameState().buildings.get(trip.buildingId);
    const residence = this.getGameState().residences.get(trip.residenceId);
    if (!building || !residence) return null;
    return roadPathDistance(
      this.getRoadNetwork(),
      building.x,
      building.z,
      residence.x,
      residence.z,
    );
  }

  getActiveTripRemainingSeconds(building: BuildingState): number | null {
    const trip = this.getActiveDeliveryTrip(building);
    if (!trip) return null;
    return tripRemainingSeconds(trip, this.getActiveTripPathDistance(trip));
  }

  getResidence(residenceId: string): ResidenceState | null {
    return this.getGameState().residences.get(residenceId) ?? null;
  }

  isRoadConnected(ax: number, az: number, bx: number, bz: number): boolean {
    return areRoadConnected(ax, az, bx, bz, this.getRoadNetwork());
  }

  getBuildingLabel(kind: Parameters<typeof buildingKindLabel>[0]): string {
    return buildingKindLabel(kind);
  }

  findQuarryTarget(quarryId: string): Extract<InspectableTarget, { kind: 'quarry' }> | null {
    const definition = this.registry.getDefinition(quarryId);
    if (!definition || definition.kind !== 'quarry') return null;

    const quarryState = this.getGameState().quarries.get(quarryId);
    if (!quarryState) return null;

    return { kind: 'quarry', definition, state: quarryState };
  }

  findNearestQuarryWithRemaining(x: number, z: number, radius: number): QuarryNodeState | null {
    const state = this.getGameState();
    let best: QuarryNodeState | null = null;
    let bestDistance = Infinity;

    for (const quarryState of state.quarries.values()) {
      if (quarryState.remaining <= 0) continue;
      const distance = Math.hypot(x - quarryState.x, z - quarryState.z);
      if (distance > radius || distance >= bestDistance) continue;
      bestDistance = distance;
      best = quarryState;
    }

    return best;
  }

  findForagingTarget(nodeId: string): Extract<InspectableTarget, { kind: 'foraging' }> | null {
    const definition = this.registry.getDefinition(nodeId);
    if (!definition || (definition.kind !== 'game' && definition.kind !== 'berries')) return null;

    const state = this.getGameState().foragingNodes.get(nodeId);
    if (!state) return null;

    return { kind: 'foraging', definition, state };
  }

  findBackyardTarget(residenceId: string): Extract<InspectableTarget, { kind: 'backyard' }> | null {
    const state = this.getGameState();
    const residence = state.residences.get(residenceId);
    if (!residence) return null;

    const zone = state.burgageZones.get(residence.zoneId);
    if (!zone) return null;

    return buildBackyardTarget(state, residence, zone);
  }

  findNearestBackyardTarget(x: number, z: number, radius = 4.5): Extract<InspectableTarget, { kind: 'backyard' }> | null {
    const state = this.getGameState();
    let best: Extract<InspectableTarget, { kind: 'backyard' }> | null = null;
    let bestDistance = Infinity;

    for (const residence of state.residences.values()) {
      if (residence.abandoned) continue;
      const zone = state.burgageZones.get(residence.zoneId);
      if (!zone) continue;
      const position = backyardIconPosition(residence, zone);
      if (!position) continue;
      const distance = Math.hypot(x - position.x, z - position.z);
      if (distance > radius || distance >= bestDistance) continue;
      bestDistance = distance;
      best = buildBackyardTarget(state, residence, zone);
    }

    return best;
  }

  findNearestForagingWithRemaining(
    x: number,
    z: number,
    radius: number,
    nodeKind: 'game' | 'berries',
  ): QuarryNodeState | null {
    const state = this.getGameState();
    let best: QuarryNodeState | null = null;
    let bestDistance = Infinity;

    for (const nodeState of state.foragingNodes.values()) {
      if (nodeState.kind !== nodeKind || nodeState.remaining <= 0) continue;
      const distance = Math.hypot(x - nodeState.x, z - nodeState.z);
      if (distance > radius || distance >= bestDistance) continue;
      bestDistance = distance;
      best = nodeState;
    }

    return best;
  }

  getClaimedResidencesForFoodSupplier(supplier: BuildingState): ResidenceState[] {
    const network = this.getRoadNetwork();
    const state = this.getGameState();
    const suppliers = [...state.buildings.values()].filter(
      (building) => building.kind === 'hunters_hall' || building.kind === 'foragers_shed',
    );
    const residences = [...state.residences.values()];
    const claims = claimResidencesForFoodSuppliers(network, suppliers, residences);
    const supplierId = supplier.id;
    return residences.filter((residence) => claims.get(residence.id) === supplierId);
  }
}
