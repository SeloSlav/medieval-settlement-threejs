import type { Terrain } from '../terrain/Terrain.ts';
import type { RiverField } from '../rivers/RiverField.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import {
  roadPathDistance,
  sortByRoadPathDistance,
} from '../logistics/roadLogistics.ts';
import {
  findServingChapel,
  hasRoadPathToBuildingKind as landmarkHasRoadPathToBuildingKind,
  isResidenceInMonasteryCoverage,
  monasteryLinkedToChapel,
} from '../logistics/landmarkAccess.ts';
import {
  FirewoodDeliveryClaimQueries,
  FoodDeliveryClaimQueries,
  WellDeliveryClaimQueries,
} from '../logistics/deliveryClaimQueries.ts';
import { findNearestResourceNodeWithRemaining } from './depletableNodes.ts';
import { findActiveTripForBuilding, findInboundSupplyTripForBuilding, findInboundTimberTripForBuilding, tripPathDistance, tripRemainingSeconds } from '../logistics/deliveryTrips.ts';
import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';
import {
  findRoadLinkedSupplierForResidence,
  findRoadLinkedUpgradeSupplierForResidence,
  peekNextSpecialtyDeliveryTarget,
  type SpecialtyNeedKind,
} from '../logistics/specialtyLogistics.ts';
import {
  BUILDING_STORAGE_CAPS,
  MONASTERY_COVERAGE_RADIUS,
  MONASTERY_UNLINKED_PRODUCTIVITY,
} from '../generated/gameBalance.ts';
import {
  selectGrainProcessorTarget,
  selectGrainDispatchTarget,
  type RoutedGrainDestination,
} from '../logistics/grainLogistics.ts';
import {
  selectDirectProcessorInputTarget,
  type DirectProcessorInputCommodity,
  type RoutedProcessorInputDestination,
} from '../logistics/processorInputLogistics.ts';
import { granaryExportableGrain } from '../economy/granaryPolicy.ts';
import { farmsteadExportableGrain } from '../farming/farmWorkPlanning.ts';
import {
  foodLaborSplit,
  foodSupplierDeliveryTripSeconds,
  institutionalFoodSurplus,
} from '../logistics/foodLogistics.ts';
import { lodgeDeliveryTripSeconds, lodgeLaborSplit } from '../logistics/lodgeLogistics.ts';
import { firewoodDeliveryTripSeconds } from '../logistics/deliveryLogistics.ts';
import {
  industrialWaterRequirement,
  industrialWaterTarget,
  isResidenceInWellRange,
  selectIndustrialWaterCandidate,
  wellDeliveryTripSeconds,
  wellLaborSplit,
} from '../logistics/waterLogistics.ts';
import { processorAcceptsInput } from '../economy/processorOutputPolicy.ts';
import {
  areRoadConnected,
  formatRoadAccess,
  hasRoadAccess as roadHasRoadAccess,
  nearestRoadDistance,
} from '../roads/roadConnectivity.ts';
import { backyardIconPosition } from '../residences/backyardPosition.ts';
import type { BuildingKind, BuildingState, BurgageZoneState, GameState, InspectableTarget, LivestockHerdState, PastureState, ResourceNodeState, ResidenceState } from './types.ts';
import type { WorldLayoutRegistry } from './WorldLayoutRegistry.ts';
import { buildingKindLabel, findNearestBuilding as findBuilding } from './WorldLayoutRegistry.ts';
import { countTreesNearBuilding } from './ForestVisualSync.ts';
import type { TreeRegistry } from './TreeRegistry.ts';
import { RESIDENCE_PICK_RADIUS } from '../residences/burgageLayout.ts';
import { isPointInPolygon2 } from '../utils/polygonGeometry.ts';
import {
  carpenterDeliverySpeedMultiplier,
  hasRoadLinkedCarpenter,
} from '../economy/carpenterSupport.ts';
import { fireDisabledBuildingIds } from '../fires/fireIncident.ts';
import {
  selectCriticalGuardhouseFoodTarget,
  type RoutedGuardhouseFoodTarget,
} from '../security/frontierSecurity.ts';
import { gameClock } from '../world/gameCalendar.ts';
import { environmentFor } from '../world/seasonPolicy.ts';

const RIVER_INSPECT_MAX_SHORE = 8;
const NEAREST_ROAD_MAX_DISTANCE = 24;
type ForagingKind = Extract<ResourceNodeState['kind'], 'game' | 'berries' | 'mushrooms' | 'fish'>;

function findNearestForagingTarget(
  state: GameState,
  registry: WorldLayoutRegistry,
  x: number,
  z: number,
): Extract<InspectableTarget, { kind: 'foraging' }> | null {
  let nearest: Extract<InspectableTarget, { kind: 'foraging' }> | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const node of state.foragingNodes.values()) {
    const definition = registry.getDefinition(node.nodeId);
    if (!definition || definition.kind === 'quarry') continue;
    const distance = Math.hypot(node.x - x, node.z - z);
    if (distance > definition.pickRadius || distance >= nearestDistance) continue;
    nearestDistance = distance;
    nearest = { kind: 'foraging', definition, state: node };
  }
  return nearest;
}

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
  private readonly getWorldHydrology: () => number;

  constructor(options: {
    terrain: Terrain;
    riverField: RiverField;
    registry: WorldLayoutRegistry;
    getGameState: () => GameState;
    getRoadNetwork: () => RoadNetwork;
    getTreeRegistry: () => TreeRegistry | null;
    getWorldHydrology?: () => number;
  }) {
    this.terrain = options.terrain;
    this.riverField = options.riverField;
    this.registry = options.registry;
    this.getGameState = options.getGameState;
    this.getRoadNetwork = options.getRoadNetwork;
    this.getTreeRegistry = options.getTreeRegistry;
    this.getWorldHydrology = options.getWorldHydrology ?? (() => 50);
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
    let fieldTarget: Extract<InspectableTarget, { kind: 'farm-field' }> | null = null;
    let pastureTarget: Extract<InspectableTarget, { kind: 'pasture' }> | null = null;
    for (const field of state.farmFields.values()) {
      if (!isPointInPolygon2({ x, z }, field.corners)) continue;
      fieldTarget = {
        kind: 'farm-field',
        field,
        farmstead: state.buildings.get(field.farmsteadId) ?? null,
      };
      break;
    }
    for (const pasture of state.pastures.values()) {
      if (!isPointInPolygon2({ x, z }, pasture.corners)) continue;
      pastureTarget = {
        kind: 'pasture',
        pasture,
        farmstead: state.buildings.get(pasture.farmsteadId) ?? null,
        herd: state.livestockHerds.get(pasture.farmsteadId) ?? null,
      };
      break;
    }

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

    if (pastureTarget) return pastureTarget;
    if (fieldTarget) return fieldTarget;

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

    const foragingTarget = findNearestForagingTarget(state, this.registry, x, z);
    if (foragingTarget) return foragingTarget;

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

  findBuildingTarget(buildingId: string): Extract<InspectableTarget, { kind: 'building' }> | null {
    const state = this.getGameState();
    const building = state.buildings.get(buildingId);
    if (!building) return null;
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

  findFarmFieldTarget(fieldId: string): Extract<InspectableTarget, { kind: 'farm-field' }> | null {
    const state = this.getGameState();
    const field = state.farmFields.get(fieldId);
    if (!field) return null;
    return {
      kind: 'farm-field',
      field,
      farmstead: state.buildings.get(field.farmsteadId) ?? null,
    };
  }

  findResidenceTarget(residenceId: string): Extract<InspectableTarget, { kind: 'residence' }> | null {
    const state = this.getGameState();
    const residence = state.residences.get(residenceId);
    if (!residence) return null;
    const zone = state.burgageZones.get(residence.zoneId);
    if (!zone) return null;
    let residenceCount = 0;
    for (const candidate of state.residences.values()) {
      if (candidate.zoneId === zone.id) residenceCount += 1;
    }
    return { kind: 'residence', residence, zone, residenceCount };
  }

  getLivestockHerd(buildingId: string): LivestockHerdState | null {
    return this.getGameState().livestockHerds.get(buildingId) ?? null;
  }

  getPasturesForBuilding(buildingId: string): PastureState[] {
    return [...this.getGameState().pastures.values()].filter(
      (pasture) => pasture.farmsteadId === buildingId,
    );
  }

  private deliverySnapshot() {
    const state = this.getGameState();
    return {
      network: this.getRoadNetwork(),
      buildings: [...state.buildings.values()].filter(
        (building) => building.constructionComplete !== false,
      ),
      residences: [...state.residences.values()],
    };
  }

  private activeParishChapels(state: GameState): BuildingState[] {
    const fireDisabled = fireDisabledBuildingIds(state.fireIncidents.values());
    return [...state.buildings.values()].filter(
      (building) =>
        building.kind === 'chapel'
        && building.constructionComplete !== false
        && !fireDisabled.has(building.id),
    );
  }

  private activeMonasteries(state: GameState): BuildingState[] {
    const fireDisabled = fireDisabledBuildingIds(state.fireIncidents.values());
    return [...state.buildings.values()].filter(
      (building) =>
        building.kind === 'monastery'
        && building.constructionComplete !== false
        && !fireDisabled.has(building.id),
    );
  }

  private firewoodClaims(): FirewoodDeliveryClaimQueries {
    const { network, buildings, residences } = this.deliverySnapshot();
    return new FirewoodDeliveryClaimQueries(network, buildings, residences);
  }

  private wellClaims(): WellDeliveryClaimQueries {
    const { network, buildings, residences } = this.deliverySnapshot();
    return new WellDeliveryClaimQueries(network, buildings, residences);
  }

  private foodClaims(): FoodDeliveryClaimQueries {
    const state = this.getGameState();
    const { network, buildings, residences } = this.deliverySnapshot();
    const chapels = this.activeParishChapels(state);
    const fireDisabled = fireDisabledBuildingIds(state.fireIncidents.values());
    const probe = (ax: number, az: number, bx: number, bz: number) =>
      roadPathDistance(network, ax, az, bx, bz);
    return new FoodDeliveryClaimQueries(
      network,
      buildings,
      residences,
      (supplier, residence, distance) =>
        supplier.kind !== 'monastery'
        || (
          distance <= MONASTERY_COVERAGE_RADIUS
          && !fireDisabled.has(supplier.id)
          && findServingChapel(residence, chapels, probe) != null
          && monasteryLinkedToChapel(supplier, chapels, probe)
        ),
    );
  }

  getRoadAccessLabel(x: number, z: number): string {
    return formatRoadAccess(nearestRoadDistance(x, z, this.getRoadNetwork()));
  }

  hasRoadAccess(x: number, z: number): boolean {
    return roadHasRoadAccess(x, z, this.getRoadNetwork());
  }

  getClaimedResidencesForWell(well: BuildingState): ResidenceState[] {
    return this.wellClaims().getClaimedResidences(well);
  }

  getNextWaterDeliveryTargetForWell(well: BuildingState): ResidenceState | null {
    return this.wellClaims().peekNextTarget(well);
  }

  getRoadConnectedWells(building: BuildingState): BuildingState[] {
    const state = this.getGameState();
    const network = this.getRoadNetwork();
    const wells = [...state.buildings.values()].filter(
      (candidate) =>
        candidate.kind === 'well'
        && candidate.constructionComplete !== false
        && candidate.assignedLabor > 0
        && roadPathDistance(network, building.x, building.z, candidate.x, candidate.z) != null,
    );
    return sortByRoadPathDistance(network, building, wells);
  }

  getRoadConnectedWaterConsumers(well: BuildingState): BuildingState[] {
    const state = this.getGameState();
    const network = this.getRoadNetwork();
    return [...state.buildings.values()].filter(
      (candidate) =>
        candidate.constructionComplete !== false
        && industrialWaterRequirement(candidate.kind) > 0
        && roadPathDistance(network, well.x, well.z, candidate.x, candidate.z) != null,
    );
  }

  getNextIndustrialWaterTargetForWell(well: BuildingState): BuildingState | null {
    const state = this.getGameState();
    const network = this.getRoadNetwork();
    const inboundTargets = new Set<string>();
    for (const trip of state.deliveryTrips.values()) {
      if (
        trip.phase !== 'inbound'
        && trip.destinationKind === 'building'
        && trip.targetBuildingId
      ) {
        inboundTargets.add(trip.targetBuildingId);
      }
    }
    const candidates = [...state.buildings.values()].flatMap((candidate) => {
      const requiredPerCycle = industrialWaterRequirement(candidate.kind);
      const desiredStock = industrialWaterTarget(
        candidate.kind,
        candidate.processorOutputTargetPercent,
      );
      if (
        candidate.constructionComplete === false
        || candidate.assignedLabor <= 0
        || requiredPerCycle <= 0
        || desiredStock <= 0
        || !processorAcceptsInput(candidate, 'water')
        || candidate.water + 1e-6 >= desiredStock
        || inboundTargets.has(candidate.id)
      ) {
        return [];
      }
      const distance = roadPathDistance(
        network,
        well.x,
        well.z,
        candidate.x,
        candidate.z,
      );
      if (distance == null) return [];
      return [{
        building: candidate,
        requiredPerCycle,
        stockRatio: Math.max(0, candidate.water) / desiredStock,
        distance,
      }];
    });
    return selectIndustrialWaterCandidate(candidates)?.building ?? null;
  }

  getWellDeliveryTripSeconds(
    well: BuildingState,
    target: Pick<ResidenceState, 'x' | 'z'> | null,
  ): number {
    const network = this.getRoadNetwork();
    return wellDeliveryTripSeconds(
      network,
      well,
      target,
      wellLaborSplit(well.assignedLabor).delivering,
      this.getDeliveryTravelSpeedMultiplier(well),
    );
  }

  getServingWellForResidence(residence: ResidenceState): BuildingState | null {
    const wellId = this.wellClaims().getServingSupplierForResidence(residence.id);
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

  getRoadPathDistance(ax: number, az: number, bx: number, bz: number): number | null {
    return roadPathDistance(this.getRoadNetwork(), ax, az, bx, bz);
  }

  getRoadComponentId(x: number, z: number): number | null {
    return this.getRoadNetwork().getPathfinder().roadComponentAt(x, z);
  }

  getRoadComponentIds(x: number, z: number): readonly number[] {
    return this.getRoadNetwork().getPathfinder().roadComponentsAt(x, z);
  }

  getRoadNetworkSnapshot(): RoadNetwork {
    return this.getRoadNetwork();
  }

  hasCarpenterSupportAt(origin: { x: number; z: number }): boolean {
    const state = this.getGameState();
    return hasRoadLinkedCarpenter(
      state.buildings.values(),
      this.getRoadNetwork(),
      origin,
      fireDisabledBuildingIds(state.fireIncidents.values()),
    );
  }

  getCarpenterDeliverySpeedMultiplier(origin: { x: number; z: number }): number {
    const state = this.getGameState();
    return carpenterDeliverySpeedMultiplier(
      state.buildings.values(),
      this.getRoadNetwork(),
      origin,
      fireDisabledBuildingIds(state.fireIncidents.values()),
    );
  }

  getRoadConditionSpeedMultiplier(): number {
    const state = this.getGameState();
    return environmentFor(
      state.seed,
      this.getWorldHydrology(),
      gameClock(state.tick),
    ).roadTravelSpeedMultiplier;
  }

  getDeliveryTravelSpeedMultiplier(origin: { x: number; z: number }): number {
    return this.getCarpenterDeliverySpeedMultiplier(origin)
      * this.getRoadConditionSpeedMultiplier();
  }

  hasRoadPathToBuildingKind(ax: number, az: number, kind: BuildingKind): boolean {
    const state = this.getGameState();
    const fireDisabled = fireDisabledBuildingIds(state.fireIncidents.values());
    return landmarkHasRoadPathToBuildingKind(
      [...state.buildings.values()].filter(
        (building) => !fireDisabled.has(building.id),
      ),
      ax,
      az,
      kind,
      (a, b, c, d) => this.getRoadPathDistance(a, b, c, d),
    );
  }

  hasRoadPathToStaffedBuildingKind(ax: number, az: number, kind: BuildingKind): boolean {
    const state = this.getGameState();
    const fireDisabled = fireDisabledBuildingIds(state.fireIncidents.values());
    return landmarkHasRoadPathToBuildingKind(
      [...state.buildings.values()].filter(
        (building) => !fireDisabled.has(building.id),
      ),
      ax,
      az,
      kind,
      (a, b, c, d) => this.getRoadPathDistance(a, b, c, d),
      true,
    );
  }

  getServingChapelForResidence(residence: ResidenceState): BuildingState | null {
    const state = this.getGameState();
    return findServingChapel(
      residence,
      this.activeParishChapels(state),
      (a, b, c, d) => this.getRoadPathDistance(a, b, c, d),
    );
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
    return this.getServingChapelForResidence(residence) != null;
  }

  isResidenceInMonasteryCoverage(residence: ResidenceState): boolean {
    const state = this.getGameState();
    return isResidenceInMonasteryCoverage(
      residence,
      this.activeMonasteries(state),
      this.activeParishChapels(state),
      (a, b, c, d) => this.getRoadPathDistance(a, b, c, d),
    );
  }

  isMonasteryLinkedToChapel(monastery: BuildingState): boolean {
    const state = this.getGameState();
    if (fireDisabledBuildingIds(state.fireIncidents.values()).has(monastery.id)) {
      return false;
    }
    return monasteryLinkedToChapel(
      monastery,
      this.activeParishChapels(state),
      (a, b, c, d) => this.getRoadPathDistance(a, b, c, d),
    );
  }

  getRoadConnectedMills(lodge: BuildingState): BuildingState[] {
    const state = this.getGameState();
    const network = this.getRoadNetwork();
    const mills = [...state.buildings.values()].filter(
      (building) =>
        building.kind === 'lumber_mill'
        && building.constructionComplete !== false
        && roadPathDistance(network, lodge.x, lodge.z, building.x, building.z) != null,
    );
    return sortByRoadPathDistance(network, lodge, mills);
  }

  getClaimedResidencesForFirewoodSupplier(supplier: BuildingState): ResidenceState[] {
    return this.firewoodClaims().getClaimedResidences(supplier);
  }

  getNextFirewoodDeliveryTarget(supplier: BuildingState): ResidenceState | null {
    return this.firewoodClaims().peekNextTarget(supplier);
  }

  getServingFirewoodSupplierForResidence(residence: ResidenceState): BuildingState | null {
    const supplierId = this.firewoodClaims().getServingSupplierForResidence(residence.id);
    if (!supplierId) return null;
    return this.getGameState().buildings.get(supplierId) ?? null;
  }

  getClaimedResidencesForLodge(lodge: BuildingState): ResidenceState[] {
    return this.getClaimedResidencesForFirewoodSupplier(lodge);
  }

  getNextDeliveryTargetForLodge(lodge: BuildingState): ResidenceState | null {
    return this.getNextFirewoodDeliveryTarget(lodge);
  }

  getServingLodgeForResidence(residence: ResidenceState): BuildingState | null {
    return this.getServingFirewoodSupplierForResidence(residence);
  }

  getServingFoodSupplierForResidence(residence: ResidenceState): BuildingState | null {
    const supplierId = this.foodClaims().getServingSupplierForResidence(residence.id);
    if (!supplierId) return null;
    return this.getGameState().buildings.get(supplierId) ?? null;
  }

  getServingPreservedFoodSupplierForResidence(residence: ResidenceState): BuildingState | null {
    return findRoadLinkedSupplierForResidence(
      residence,
      this.getGameState().buildings.values(),
      this.getRoadNetwork(),
      'preservedFood',
    );
  }

  getPreservedFoodUpgradeSupplierForResidence(
    residence: ResidenceState,
  ): BuildingState | null {
    return findRoadLinkedUpgradeSupplierForResidence(
      residence,
      this.getGameState().buildings.values(),
      this.getRoadNetwork(),
      'preservedFood',
    );
  }

  getServingAleSupplierForResidence(residence: ResidenceState): BuildingState | null {
    return this.getAleSupplierForResidence(residence, true);
  }

  getAleUpgradeSupplierForResidence(residence: ResidenceState): BuildingState | null {
    return this.getAleSupplierForResidence(residence, false);
  }

  getServingClothSupplierForResidence(residence: ResidenceState): BuildingState | null {
    return findRoadLinkedSupplierForResidence(
      residence,
      this.getGameState().buildings.values(),
      this.getRoadNetwork(),
      'cloth',
    );
  }

  getClothUpgradeSupplierForResidence(residence: ResidenceState): BuildingState | null {
    return findRoadLinkedUpgradeSupplierForResidence(
      residence,
      this.getGameState().buildings.values(),
      this.getRoadNetwork(),
      'cloth',
    );
  }

  private getAleSupplierForResidence(
    residence: ResidenceState,
    requireStock: boolean,
  ): BuildingState | null {
    const state = this.getGameState();
    const network = this.getRoadNetwork();
    const chapels = this.activeParishChapels(state);
    const fireDisabled = fireDisabledBuildingIds(state.fireIncidents.values());
    const hasParishAccess = findServingChapel(
      residence,
      chapels,
      (a, b, c, d) => roadPathDistance(network, a, b, c, d),
    ) != null;
    const findSupplier = requireStock
      ? findRoadLinkedSupplierForResidence
      : findRoadLinkedUpgradeSupplierForResidence;
    return findSupplier(
      residence,
      state.buildings.values(),
      network,
      'ale',
      (building, distance) =>
        building.kind !== 'monastery'
        || (
          hasParishAccess
          && distance <= MONASTERY_COVERAGE_RADIUS
          && !fireDisabled.has(building.id)
          && monasteryLinkedToChapel(
            building,
            chapels,
            (a, b, c, d) => roadPathDistance(network, a, b, c, d),
          )
        ),
    );
  }

  getNextSpecialtyDeliveryTargetForSupplier(
    supplier: BuildingState,
    needKind: SpecialtyNeedKind,
  ): ResidenceState | null {
    const claimed = this.getClaimedResidencesForSpecialtySupplier(supplier, needKind);
    return peekNextSpecialtyDeliveryTarget(
      this.getRoadNetwork(),
      supplier,
      claimed,
      needKind,
    );
  }

  getBuilding(buildingId: string): BuildingState | null {
    return this.getGameState().buildings.get(buildingId) ?? null;
  }

  findNearestRoadLinkedBuilding(
    origin: BuildingState,
    targetKinds: readonly BuildingKind[],
    isEligible: (candidate: BuildingState) => boolean = () => true,
  ): BuildingState | null {
    if (targetKinds.length === 0) return null;
    const network = this.getRoadNetwork();
    let best: BuildingState | null = null;
    let bestDistance = Infinity;
    for (const candidate of this.getGameState().buildings.values()) {
      if (
        candidate.id === origin.id
        || candidate.constructionComplete === false
        || !targetKinds.includes(candidate.kind)
        || !isEligible(candidate)
      ) continue;
      const distance = roadPathDistance(network, origin.x, origin.z, candidate.x, candidate.z);
      if (distance == null) continue;
      if (
        distance + 1e-6 < bestDistance
        || (Math.abs(distance - bestDistance) <= 1e-6 && best != null && candidate.id < best.id)
      ) {
        bestDistance = distance;
        best = candidate;
      }
    }
    return best;
  }

  getNextMonasteryHospitalityTarget(
    origin: BuildingState,
    commodity: 'honey' | 'wine',
  ): BuildingState | null {
    const capacity = BUILDING_STORAGE_CAPS.monastery[commodity] ?? 0;
    return this.findNearestRoadLinkedBuilding(
      origin,
      ['monastery'],
      (candidate) =>
        this.isMonasteryLinkedToChapel(candidate)
        && candidate[commodity] < capacity - 1e-6
        && this.getInboundSupplyTrip(candidate) == null,
    );
  }

  getNextFarmGrainDispatch(
    farmstead: BuildingState,
  ): RoutedGrainDestination<BuildingState> | null {
    const state = this.getGameState();
    const exportableGrain = farmsteadExportableGrain(
      farmstead.grain,
      [...state.farmFields.values()]
        .filter((field) => field.farmsteadId === farmstead.id),
    );
    if (exportableGrain <= 1e-6) return null;
    const network = this.getRoadNetwork();
    const inboundTargets = new Set<string>();
    for (const trip of state.deliveryTrips.values()) {
      if (
        trip.phase !== 'inbound'
        && trip.destinationKind === 'building'
        && trip.targetBuildingId
      ) {
        inboundTargets.add(trip.targetBuildingId);
      }
    }
    return selectGrainDispatchTarget(
      state.buildings.values(),
      farmstead.id,
      (target) => roadPathDistance(
        network,
        farmstead.x,
        farmstead.z,
        target.x,
        target.z,
      ),
      (target) => target.kind === 'monastery'
        && !this.isMonasteryLinkedToChapel(target)
        ? MONASTERY_UNLINKED_PRODUCTIVITY
        : 1,
      (target) => inboundTargets.has(target.id),
      (target) => processorAcceptsInput(target, 'grain'),
    );
  }

  getClaimedResidencesForSpecialtySupplier(
    supplier: BuildingState,
    needKind: SpecialtyNeedKind,
  ): ResidenceState[] {
    return [...this.getGameState().residences.values()].filter((residence) => {
      const serving = needKind === 'ale'
        ? this.getServingAleSupplierForResidence(residence)
        : needKind === 'cloth'
          ? this.getServingClothSupplierForResidence(residence)
          : this.getServingPreservedFoodSupplierForResidence(residence);
      return serving?.id === supplier.id;
    });
  }

  getNextGranaryGrainDispatch(
    granary: BuildingState,
  ): RoutedGrainDestination<BuildingState> | null {
    if (
      granary.kind !== 'granary'
      || granary.constructionComplete === false
      || granary.assignedLabor <= 0
      || granaryExportableGrain(granary.grain, granary.granaryGrainReserve ?? 0) <= 1e-6
    ) {
      return null;
    }
    const state = this.getGameState();
    const network = this.getRoadNetwork();
    const inboundTargets = new Set<string>();
    for (const trip of state.deliveryTrips.values()) {
      if (
        trip.phase !== 'inbound'
        && trip.destinationKind === 'building'
        && trip.targetBuildingId
      ) {
        inboundTargets.add(trip.targetBuildingId);
      }
    }
    return selectGrainProcessorTarget(
      state.buildings.values(),
      granary.id,
      (target) => roadPathDistance(
        network,
        granary.x,
        granary.z,
        target.x,
        target.z,
      ),
      (target) => target.kind === 'monastery'
        && !this.isMonasteryLinkedToChapel(target)
        ? MONASTERY_UNLINKED_PRODUCTIVITY
        : 1,
      (target) => inboundTargets.has(target.id),
      (target) => processorAcceptsInput(target, 'grain'),
    );
  }

  getNextDirectProcessorInputDispatch(
    source: BuildingState,
    commodity: DirectProcessorInputCommodity,
  ): RoutedProcessorInputDestination<BuildingState> | null {
    const state = this.getGameState();
    const network = this.getRoadNetwork();
    const inboundTargets = new Set<string>();
    for (const trip of state.deliveryTrips.values()) {
      if (
        trip.phase !== 'inbound'
        && trip.destinationKind === 'building'
        && trip.targetBuildingId
      ) {
        inboundTargets.add(trip.targetBuildingId);
      }
    }
    return selectDirectProcessorInputTarget(
      state.buildings.values(),
      source.id,
      commodity,
      (target) => roadPathDistance(
        network,
        source.x,
        source.z,
        target.x,
        target.z,
      ),
      (target) => inboundTargets.has(target.id),
      (target) => processorAcceptsInput(target, commodity),
    );
  }

  getNextGranaryGuardFoodDispatch(
    granary: BuildingState,
  ): RoutedGuardhouseFoodTarget<BuildingState> | null {
    if (
      granary.kind !== 'granary'
      || granary.constructionComplete === false
      || granary.assignedLabor <= 0
    ) {
      return null;
    }
    const claimedHouseholds = this.getClaimedResidencesForFoodSupplier(granary).length;
    const transferable = institutionalFoodSurplus(
      granary.food,
      claimedHouseholds,
      BUILDING_STORAGE_CAPS.granary.food,
    );
    if (transferable <= 1e-6) return null;

    const state = this.getGameState();
    const network = this.getRoadNetwork();
    const inboundTargets = new Set<string>();
    for (const trip of state.deliveryTrips.values()) {
      if (
        trip.phase !== 'inbound'
        && trip.destinationKind === 'building'
        && trip.targetBuildingId
      ) {
        inboundTargets.add(trip.targetBuildingId);
      }
    }
    return selectCriticalGuardhouseFoodTarget(
      state.buildings.values(),
      granary.id,
      (target) => roadPathDistance(
        network,
        granary.x,
        granary.z,
        target.x,
        target.z,
      ),
      (target) => inboundTargets.has(target.id),
    );
  }

  findNearestRoadLinkedResidence(
    origin: BuildingState,
    minTier: 1 | 2 | 3 = 1,
  ): ResidenceState | null {
    const network = this.getRoadNetwork();
    let best: ResidenceState | null = null;
    let bestDistance = Infinity;
    for (const residence of this.getGameState().residences.values()) {
      if (residence.abandoned || residence.tier < minTier) continue;
      const distance = roadPathDistance(network, origin.x, origin.z, residence.x, residence.z);
      if (distance == null) continue;
      if (
        distance + 1e-6 < bestDistance
        || (Math.abs(distance - bestDistance) <= 1e-6 && best != null && residence.id < best.id)
      ) {
        bestDistance = distance;
        best = residence;
      }
    }
    return best;
  }

  getClaimedResidencesForFoodSupplier(supplier: BuildingState): ResidenceState[] {
    return this.foodClaims().getClaimedResidences(supplier);
  }

  getNextFoodDeliveryTargetForSupplier(supplier: BuildingState): ResidenceState | null {
    return this.foodClaims().peekNextTarget(supplier);
  }

  getFoodDeliveryTripSeconds(
    supplier: BuildingState,
    target: ResidenceState | null,
  ): number {
    const network = this.getRoadNetwork();
    return foodSupplierDeliveryTripSeconds(
      network,
      supplier,
      target,
      foodLaborSplit(supplier.assignedLabor).delivering,
      this.getDeliveryTravelSpeedMultiplier(supplier),
    );
  }

  getLodgeDeliveryTripSeconds(
    lodge: BuildingState,
    target: ResidenceState | null,
  ): number {
    const network = this.getRoadNetwork();
    return lodgeDeliveryTripSeconds(
      network,
      lodge,
      target,
      lodgeLaborSplit(lodge.assignedLabor).delivering,
      this.getDeliveryTravelSpeedMultiplier(lodge),
    );
  }

  getFirewoodDeliveryTripSeconds(
    supplier: BuildingState,
    target: ResidenceState | null,
    deliveryWorkers: number,
  ): number {
    const network = this.getRoadNetwork();
    return firewoodDeliveryTripSeconds(
      network,
      supplier,
      target,
      deliveryWorkers,
      this.getDeliveryTravelSpeedMultiplier(supplier),
    );
  }

  getActiveDeliveryTrip(building: BuildingState): DeliveryTripState | null {
    return findActiveTripForBuilding(this.getGameState().deliveryTrips.values(), building.id);
  }

  getActiveTripPathDistance(trip: DeliveryTripState): number | null {
    return tripPathDistance(this.getRoadNetwork(), trip, this.getGameState());
  }

  getInboundTimberTrip(lodge: BuildingState): DeliveryTripState | null {
    return findInboundTimberTripForBuilding(this.getGameState().deliveryTrips.values(), lodge.id);
  }

  getInboundSupplyTrip(building: BuildingState): DeliveryTripState | null {
    return findInboundSupplyTripForBuilding(this.getGameState().deliveryTrips.values(), building.id);
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

  findNearestQuarryWithRemaining(x: number, z: number, radius: number): ResourceNodeState | null {
    return findNearestResourceNodeWithRemaining(this.getGameState().quarries.values(), x, z, radius, 'quarry');
  }

  findForagingTarget(nodeId: string): Extract<InspectableTarget, { kind: 'foraging' }> | null {
    const definition = this.registry.getDefinition(nodeId);
    if (
      !definition
      || (
        definition.kind !== 'game'
        && definition.kind !== 'berries'
        && definition.kind !== 'mushrooms'
        && definition.kind !== 'fish'
      )
    ) return null;

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

  findNearestBackyardTarget(x: number, z: number, radius = 7): Extract<InspectableTarget, { kind: 'backyard' }> | null {
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
    nodeKind: ForagingKind | readonly ForagingKind[],
    includeDepleted = false,
  ): ResourceNodeState | null {
    const kinds = Array.isArray(nodeKind) ? nodeKind : [nodeKind];
    let nearest: ResourceNodeState | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    if (includeDepleted) {
      for (const candidate of this.getGameState().foragingNodes.values()) {
        if (!kinds.includes(candidate.kind)) continue;
        const distance = Math.hypot(candidate.x - x, candidate.z - z);
        if (distance > radius || distance >= nearestDistance) continue;
        nearest = candidate;
        nearestDistance = distance;
      }
      return nearest;
    }
    for (const kind of kinds) {
      const candidate = findNearestResourceNodeWithRemaining(
        this.getGameState().foragingNodes.values(),
        x,
        z,
        radius,
        kind,
      );
      if (!candidate) continue;
      const distance = Math.hypot(candidate.x - x, candidate.z - z);
      if (distance >= nearestDistance) continue;
      nearest = candidate;
      nearestDistance = distance;
    }
    return nearest;
  }
}
