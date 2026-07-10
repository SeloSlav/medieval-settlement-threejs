import type { Terrain } from '../terrain/Terrain.ts';
import type { RiverField } from '../rivers/RiverField.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import {
  claimResidencesForLodges,
  roadPathDistance,
  sortByRoadPathDistance,
  sortResidencesForDelivery,
} from '../logistics/roadLogistics.ts';
import { RESIDENCE_FIREWOOD_CAPACITY, lodgeDeliveryIntervalSeconds, lodgeLaborSplit } from './resourceTotals.ts';
import { areRoadConnected, formatRoadAccess, nearestRoadDistance } from '../roads/roadConnectivity.ts';
import type { BuildingState, GameState, InspectableTarget, QuarryNodeState, ResidenceState } from './types.ts';
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

  findInspectableTarget(x: number, z: number): InspectableTarget | null {
    const state = this.getGameState();
    const building = findBuilding(state.buildings.values(), x, z);
    const residenceTarget = findNearestResidenceTarget(state, x, z);

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
      (residence) => !residence.abandoned && claims.get(residence.id) === lodge.id,
    );
    return sortResidencesForDelivery(this.getRoadNetwork(), lodge, residences);
  }

  getNextDeliveryTargetForLodge(lodge: BuildingState): ResidenceState | null {
    const claimed = this.getClaimedResidencesForLodge(lodge);
    return claimed.find((residence) => residence.firewoodStock < RESIDENCE_FIREWOOD_CAPACITY - 1e-6) ?? null;
  }

  getServingLodgeForResidence(residence: ResidenceState): BuildingState | null {
    const lodgeId = this.getResidenceLodgeClaims().get(residence.id);
    if (!lodgeId) return null;
    return this.getGameState().buildings.get(lodgeId) ?? null;
  }

  getLodgeDeliveryIntervalSeconds(lodge: BuildingState): number {
    return lodgeDeliveryIntervalSeconds(lodgeLaborSplit(lodge.assignedLabor).delivering);
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
}
