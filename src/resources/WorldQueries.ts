import type { Terrain } from '../terrain/Terrain.ts';
import type { RiverField } from '../rivers/RiverField.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import {
  localDeliveryDistance,
  localDeliveryDistancesFrom,
  roadPathDistance,
  sortByRoadPathDistance,
} from '../logistics/roadLogistics.ts';
import {
  claimResidenceCommunityLandmarks,
  findServingChapel,
  hasRoadPathToBuildingKind as landmarkHasRoadPathToBuildingKind,
  isResidenceInMonasteryCoverage,
  monasteryLinkedToChapel,
  type ResidenceCommunityLandmarkClaims,
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
} from '../generated/gameBalance.ts';
import {
  selectGrainProcessorTarget,
  selectGrainDispatchTarget,
  type RoutedGrainDestination,
} from '../logistics/grainLogistics.ts';
import {
  assignLocalMaterialInputTargets,
  assignMarketplaceMaterialInputTargets,
  localMaterialInputCommodities,
  processorInputCommodityStock,
  selectDirectProcessorInputTarget,
  type DirectProcessorInputCommodity,
  type RoutedMarketplaceMaterialDestination,
  type RoutedProcessorInputDestination,
} from '../logistics/processorInputLogistics.ts';
import { granaryExportableGrain } from '../economy/granaryPolicy.ts';
import { marketplacePendingTradeOffer } from '../economy/marketplaceTrade.ts';
import {
  fieldSeedGrainRemaining,
  farmsteadSeedBarleyRequired,
} from '../farming/farmWorkPlanning.ts';
import { BREAD_GRAIN_KINDS, breadGrainStock, type BreadGrainKind } from '../economy/cropGoods.ts';
import {
  foodSupplierDeliveryTripSeconds,
  INSTITUTIONAL_FOOD_SOURCE_KINDS,
  type RoutedInstitutionalFoodDestination,
  institutionalFoodSurplus,
  selectInstitutionalFoodTarget,
} from '../logistics/foodLogistics.ts';
import { lodgeDeliveryTripSeconds } from '../logistics/lodgeLogistics.ts';
import { firewoodDeliveryTripSeconds } from '../logistics/deliveryLogistics.ts';
import { monasteryScriptoriumRecoveryMultiplier } from '../buildings/monasteryEstate.ts';
import {
  industrialWaterRequirement,
  industrialWaterTarget,
  isResidenceInWellRange,
  isWithinWellServiceRadius,
  selectIndustrialWaterCandidate,
  wellDeliveryTripSeconds,
} from '../logistics/waterLogistics.ts';
import {
  extractionAcceptsMaintenance,
  processorAcceptsInput,
} from '../economy/processorOutputPolicy.ts';
import { edibleFoodStock } from '../economy/foodInventory.ts';
import {
  isStorageCommodity,
  storageAcceptsCommodity,
} from '../economy/storageAcceptancePolicy.ts';
import { mineralDepositBeneath } from '../economy/settlementGeology.ts';
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
import { computePopulationStats } from './resourceTotals.ts';
import type { TreeRegistry } from './TreeRegistry.ts';
import { effectiveTreeWorkArea } from './treeWorkArea.ts';
import { RESIDENCE_PICK_RADIUS } from '../residences/burgageLayout.ts';
import { isPointInPolygon2 } from '../utils/polygonGeometry.ts';
import {
  carpenterDeliverySpeedMultiplier,
  hasRoadLinkedCarpenter,
} from '../economy/carpenterSupport.ts';
import {
  fireDisabledBuildingIds,
  fireDisabledResidenceIds,
  fireForTarget,
} from '../fires/fireIncident.ts';
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
  private readonly getSevereWeatherEnabled: () => boolean;

  constructor(options: {
    terrain: Terrain;
    riverField: RiverField;
    registry: WorldLayoutRegistry;
    getGameState: () => GameState;
    getRoadNetwork: () => RoadNetwork;
    getTreeRegistry: () => TreeRegistry | null;
    getWorldHydrology?: () => number;
    getSevereWeatherEnabled?: () => boolean;
  }) {
    this.terrain = options.terrain;
    this.riverField = options.riverField;
    this.registry = options.registry;
    this.getGameState = options.getGameState;
    this.getRoadNetwork = options.getRoadNetwork;
    this.getTreeRegistry = options.getTreeRegistry;
    this.getWorldHydrology = options.getWorldHydrology ?? (() => 50);
    this.getSevereWeatherEnabled = options.getSevereWeatherEnabled ?? (() => false);
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
      const workArea = effectiveTreeWorkArea(building);
      const counts = treeRegistry && buildingNeedsInspectableTreeCounts(state, building)
        ? countTreesNearBuilding(state, treeRegistry, workArea.x, workArea.z, workArea.radius)
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
      const workArea = effectiveTreeWorkArea(building);
      const counts = treeRegistry && buildingNeedsInspectableTreeCounts(state, building)
        ? countTreesNearBuilding(state, treeRegistry, workArea.x, workArea.z, workArea.radius)
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
    const workArea = effectiveTreeWorkArea(building);
    const counts = treeRegistry && buildingNeedsInspectableTreeCounts(state, building)
      ? countTreesNearBuilding(state, treeRegistry, workArea.x, workArea.z, workArea.radius)
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

  private *fireEnabledBuildings(
    state: GameState,
    fireDisabled = fireDisabledBuildingIds(state.fireIncidents.values()),
  ): IterableIterator<BuildingState> {
    for (const building of state.buildings.values()) {
      if (!fireDisabled.has(building.id)) yield building;
    }
  }

  private deliverySnapshot() {
    const state = this.getGameState();
    const fireDisabledResidences = fireDisabledResidenceIds(
      state.fireIncidents.values(),
    );
    return {
      network: this.getRoadNetwork(),
      buildings: [...this.fireEnabledBuildings(state)].filter(
        (building) => building.constructionComplete !== false,
      ),
      residences: [...state.residences.values()].filter(
        (residence) => !fireDisabledResidences.has(residence.id),
      ),
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
        && building.assignedLabor > 0
        && !fireDisabled.has(building.id),
    );
  }

  /**
   * Batched chapel and monastery territory used by settlement-wide forecasts.
   * Fire-disabled homes and landmarks are excluded before route assignment so
   * the Town Hall reports the same community support as the authority.
   */
  getResidenceCommunityLandmarkClaims(
    residences: readonly ResidenceState[],
  ): ResidenceCommunityLandmarkClaims {
    const state = this.getGameState();
    const fireDisabledResidences = fireDisabledResidenceIds(
      state.fireIncidents.values(),
    );
    return claimResidenceCommunityLandmarks(
      this.getRoadNetwork(),
      residences.filter(
        (residence) => !fireDisabledResidences.has(residence.id),
      ),
      this.activeParishChapels(state),
      this.activeMonasteries(state),
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
    const { network, buildings, residences } = this.deliverySnapshot();
    return new FoodDeliveryClaimQueries(
      network,
      buildings,
      residences,
      (supplier) => supplier.kind !== 'monastery',
    );
  }

  private marketplaceHasStallWorkforce(
    marketplace: BuildingState,
    workplaceKind: Extract<BuildingKind, 'granary' | 'village_storehouse'>,
  ): boolean {
    if (
      marketplace.kind !== 'marketplace'
      || marketplace.constructionComplete === false
    ) {
      return false;
    }
    const state = this.getGameState();
    const fireDisabled = fireDisabledBuildingIds(state.fireIncidents.values());
    if (fireDisabled.has(marketplace.id)) return false;
    const network = this.getRoadNetwork();
    return [...state.buildings.values()].some((workplace) =>
      workplace.kind === workplaceKind
      && workplace.constructionComplete !== false
      && workplace.assignedLabor > 0
      && !fireDisabled.has(workplace.id)
      && localDeliveryDistance(
        network,
        workplace.x,
        workplace.z,
        marketplace.x,
        marketplace.z,
      ) != null
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
    const fireDisabled = fireDisabledBuildingIds(state.fireIncidents.values());
    if (fireDisabled.has(building.id)) return [];
    const network = this.getRoadNetwork();
    const wells = [...this.fireEnabledBuildings(state, fireDisabled)].filter(
      (candidate) =>
        candidate.kind === 'well'
        && candidate.constructionComplete !== false
        && isWithinWellServiceRadius(candidate, building)
        && localDeliveryDistance(network, building.x, building.z, candidate.x, candidate.z) != null,
    );
    return sortByRoadPathDistance(network, building, wells);
  }

  getRoadConnectedWaterConsumers(well: BuildingState): BuildingState[] {
    const state = this.getGameState();
    const fireDisabled = fireDisabledBuildingIds(state.fireIncidents.values());
    if (fireDisabled.has(well.id)) return [];
    const network = this.getRoadNetwork();
    return [...this.fireEnabledBuildings(state, fireDisabled)].filter(
      (candidate) =>
        candidate.constructionComplete !== false
        && industrialWaterRequirement(candidate.kind) > 0
        && isWithinWellServiceRadius(well, candidate)
        && localDeliveryDistance(network, well.x, well.z, candidate.x, candidate.z) != null,
    );
  }

  getNextIndustrialWaterTargetForWell(well: BuildingState): BuildingState | null {
    const state = this.getGameState();
    const fireDisabled = fireDisabledBuildingIds(state.fireIncidents.values());
    if (fireDisabled.has(well.id)) return null;
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
    const candidates = [
      ...this.fireEnabledBuildings(state, fireDisabled),
    ].flatMap((candidate) => {
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
        || (candidate.kind === 'weaver' && (candidate.flax ?? 0) <= 1e-6)
        || !processorAcceptsInput(candidate, 'water')
        || !isWithinWellServiceRadius(well, candidate)
        || candidate.water + 1e-6 >= desiredStock
        || inboundTargets.has(candidate.id)
      ) {
        return [];
      }
      const distance = localDeliveryDistance(
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
      1,
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

  getLocalDeliveryDistance(ax: number, az: number, bx: number, bz: number): number | null {
    return localDeliveryDistance(this.getRoadNetwork(), ax, az, bx, bz);
  }

  getLocalDeliveryDistancesFrom(
    origin: { x: number; z: number },
    targets: readonly { x: number; z: number }[],
  ): Array<number | null> {
    return localDeliveryDistancesFrom(
      this.getRoadNetwork(),
      origin.x,
      origin.z,
      targets,
    );
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

  getScriptoriumRecoveryMultiplierAt(origin: { x: number; z: number }): number {
    const state = this.getGameState();
    const chapels = this.activeParishChapels(state);
    const probe = (ax: number, az: number, bx: number, bz: number) =>
      this.getRoadPathDistance(ax, az, bx, bz);
    let multiplier = 1;
    for (const monastery of this.activeMonasteries(state)) {
      if (!monasteryLinkedToChapel(monastery, chapels, probe)) continue;
      const distance = probe(origin.x, origin.z, monastery.x, monastery.z);
      if (distance == null || distance > MONASTERY_COVERAGE_RADIUS) continue;
      multiplier = Math.min(
        multiplier,
        monasteryScriptoriumRecoveryMultiplier(monastery.chapelTier),
      );
    }
    return multiplier;
  }

  getRoadConditionSpeedMultiplier(): number {
    const state = this.getGameState();
    return environmentFor(
      state.seed,
      this.getWorldHydrology(),
      gameClock(state.tick),
      this.getSevereWeatherEnabled(),
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

  getServingChapelForResidence(
    residence: ResidenceState,
    requiredTier?: 1 | 2 | 3,
  ): BuildingState | null {
    const state = this.getGameState();
    if (fireDisabledResidenceIds(state.fireIncidents.values()).has(residence.id)) {
      return null;
    }
    return findServingChapel(
      residence,
      this.activeParishChapels(state),
      (a, b, c, d) => this.getRoadPathDistance(a, b, c, d),
      requiredTier,
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

  isResidenceConnectedToMarketplace(
    residence: ResidenceState,
    stallKind: 'food' | 'goods' = 'food',
  ): boolean {
    const state = this.getGameState();
    const fireDisabled = fireDisabledBuildingIds(state.fireIncidents.values());
    const workplaceKind = stallKind === 'food' ? 'granary' : 'village_storehouse';
    return [...state.buildings.values()].some((marketplace) =>
      !fireDisabled.has(marketplace.id)
      && this.marketplaceHasStallWorkforce(marketplace, workplaceKind)
      && this.getRoadPathDistance(
        residence.x,
        residence.z,
        marketplace.x,
        marketplace.z,
      ) != null
    );
  }

  isResidenceConnectedToChapel(residence: ResidenceState): boolean {
    return this.getServingChapelForResidence(residence) != null;
  }

  isResidenceInMonasteryCoverage(residence: ResidenceState): boolean {
    const state = this.getGameState();
    if (fireDisabledResidenceIds(state.fireIncidents.values()).has(residence.id)) {
      return false;
    }
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
    const fireDisabled = fireDisabledBuildingIds(state.fireIncidents.values());
    if (fireDisabled.has(lodge.id)) return [];
    const network = this.getRoadNetwork();
    const mills = [...this.fireEnabledBuildings(state, fireDisabled)].filter(
      (building) =>
        building.kind === 'lumber_mill'
        && building.constructionComplete !== false
        && localDeliveryDistance(network, lodge.x, lodge.z, building.x, building.z) != null,
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
    const state = this.getGameState();
    if (fireDisabledResidenceIds(state.fireIncidents.values()).has(residence.id)) {
      return null;
    }
    return findRoadLinkedSupplierForResidence(
      residence,
      this.fireEnabledBuildings(state),
      this.getRoadNetwork(),
      'preservedFood',
    );
  }

  getPreservedFoodUpgradeSupplierForResidence(
    residence: ResidenceState,
  ): BuildingState | null {
    const state = this.getGameState();
    if (fireDisabledResidenceIds(state.fireIncidents.values()).has(residence.id)) {
      return null;
    }
    return findRoadLinkedUpgradeSupplierForResidence(
      residence,
      this.fireEnabledBuildings(state),
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
    const state = this.getGameState();
    if (fireDisabledResidenceIds(state.fireIncidents.values()).has(residence.id)) {
      return null;
    }
    return findRoadLinkedSupplierForResidence(
      residence,
      this.fireEnabledBuildings(state),
      this.getRoadNetwork(),
      'cloth',
    );
  }

  getClothUpgradeSupplierForResidence(residence: ResidenceState): BuildingState | null {
    const state = this.getGameState();
    if (fireDisabledResidenceIds(state.fireIncidents.values()).has(residence.id)) {
      return null;
    }
    return findRoadLinkedUpgradeSupplierForResidence(
      residence,
      this.fireEnabledBuildings(state),
      this.getRoadNetwork(),
      'cloth',
    );
  }

  private getAleSupplierForResidence(
    residence: ResidenceState,
    requireStock: boolean,
  ): BuildingState | null {
    const state = this.getGameState();
    if (fireDisabledResidenceIds(state.fireIncidents.values()).has(residence.id)) {
      return null;
    }
    const network = this.getRoadNetwork();
    const findSupplier = requireStock
      ? findRoadLinkedSupplierForResidence
      : findRoadLinkedUpgradeSupplierForResidence;
    return findSupplier(
      residence,
      this.fireEnabledBuildings(state),
      network,
      'ale',
      (building) => building.kind !== 'monastery',
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
    const state = this.getGameState();
    const fireDisabled = fireDisabledBuildingIds(state.fireIncidents.values());
    if (fireDisabled.has(origin.id)) return null;
    const network = this.getRoadNetwork();
    let best: BuildingState | null = null;
    let bestDistance = Infinity;
    for (const candidate of state.buildings.values()) {
      if (
        candidate.id === origin.id
        || candidate.constructionComplete === false
        || fireDisabled.has(candidate.id)
        || !targetKinds.includes(candidate.kind)
        || !isEligible(candidate)
      ) continue;
      const distance = localDeliveryDistance(
        network,
        origin.x,
        origin.z,
        candidate.x,
        candidate.z,
      );
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

  getNextFarmGrainDispatch(
    farmstead: BuildingState,
  ): RoutedGrainDestination<BuildingState> | null {
    const state = this.getGameState();
    const fireDisabled = fireDisabledBuildingIds(state.fireIncidents.values());
    if (fireDisabled.has(farmstead.id)) return null;
    const fields = [...state.farmFields.values()]
      .filter((field) => field.farmsteadId === farmstead.id);
    const seedReserve: Record<BreadGrainKind, number> = {
      ryeGrain: 0,
      oatGrain: 0,
      maslinGrain: 0,
    };
    for (const field of fields) {
      const crop = field.stage === 'ploughing' || field.stage === 'sowing'
        ? field.crop
        : field.nextCrop;
      const commodity = crop === 'rye'
        ? 'ryeGrain'
        : crop === 'oats'
          ? 'oatGrain'
          : crop === 'wheat'
            ? 'maslinGrain'
            : null;
      if (commodity) seedReserve[commodity] += fieldSeedGrainRemaining(field);
    }
    const commodity = BREAD_GRAIN_KINDS
      .map((kind) => ({ kind, surplus: Math.max(0, (farmstead[kind] ?? 0) - seedReserve[kind]) }))
      .sort((left, right) => right.surplus - left.surplus)[0];
    if (!commodity || commodity.surplus <= 1e-6) return null;
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
      this.fireEnabledBuildings(state, fireDisabled),
      farmstead.id,
      (target) => localDeliveryDistance(
        network,
        farmstead.x,
        farmstead.z,
        target.x,
        target.z,
      ),
      () => 1,
      (target) => inboundTargets.has(target.id),
      (target) => processorAcceptsInput(target, commodity.kind),
      commodity.kind,
    );
  }

  getServingShoesSupplierForResidence(residence: ResidenceState): BuildingState | null {
    const state = this.getGameState();
    if (fireDisabledResidenceIds(state.fireIncidents.values()).has(residence.id)) {
      return null;
    }
    return findRoadLinkedSupplierForResidence(
      residence,
      this.fireEnabledBuildings(state),
      this.getRoadNetwork(),
      'shoes',
    );
  }

  getShoesUpgradeSupplierForResidence(residence: ResidenceState): BuildingState | null {
    const state = this.getGameState();
    if (fireDisabledResidenceIds(state.fireIncidents.values()).has(residence.id)) {
      return null;
    }
    return findRoadLinkedUpgradeSupplierForResidence(
      residence,
      this.fireEnabledBuildings(state),
      this.getRoadNetwork(),
      'shoes',
    );
  }

  getServingPotterySupplierForResidence(residence: ResidenceState): BuildingState | null {
    const state = this.getGameState();
    if (fireDisabledResidenceIds(state.fireIncidents.values()).has(residence.id)) {
      return null;
    }
    return findRoadLinkedSupplierForResidence(
      residence,
      this.fireEnabledBuildings(state),
      this.getRoadNetwork(),
      'pottery',
    );
  }

  getPotteryUpgradeSupplierForResidence(residence: ResidenceState): BuildingState | null {
    const state = this.getGameState();
    if (fireDisabledResidenceIds(state.fireIncidents.values()).has(residence.id)) {
      return null;
    }
    return findRoadLinkedUpgradeSupplierForResidence(
      residence,
      this.fireEnabledBuildings(state),
      this.getRoadNetwork(),
      'pottery',
    );
  }

  getLuxuryUpgradeSupplierForResidence(residence: ResidenceState): BuildingState | null {
    const state = this.getGameState();
    if (fireDisabledResidenceIds(state.fireIncidents.values()).has(residence.id)) {
      return null;
    }
    const candidates = [...this.fireEnabledBuildings(state)].filter(
      (building) =>
        building.kind === 'marketplace'
        && building.constructionComplete !== false
        && Math.max(0, building.wine ?? 0) + Math.max(0, building.honey ?? 0) > 1e-6,
    );
    return sortByRoadPathDistance(this.getRoadNetwork(), residence, candidates)[0] ?? null;
  }

  getNextFarmBarleyDispatch(
    farmstead: BuildingState,
  ): RoutedProcessorInputDestination<BuildingState> | null {
    if (farmstead.kind !== 'threshing_barn') return null;
    const state = this.getGameState();
    const fields = [...state.farmFields.values()]
      .filter((field) => field.farmsteadId === farmstead.id);
    const exportableBarley = Math.max(
      0,
      (farmstead.barley ?? 0) - farmsteadSeedBarleyRequired(fields),
    );
    if (exportableBarley <= 1e-6) return null;
    return this.getNextDirectProcessorInputDispatch(farmstead, 'barley');
  }

  getNextFarmFlaxDispatch(
    farmstead: BuildingState,
  ): RoutedProcessorInputDestination<BuildingState> | null {
    if (
      farmstead.kind !== 'threshing_barn'
      || (farmstead.flax ?? 0) <= 1e-6
    ) {
      return null;
    }
    return this.getNextDirectProcessorInputDispatch(farmstead, 'flax');
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
          : needKind === 'shoes'
            ? this.getServingShoesSupplierForResidence(residence)
          : needKind === 'pottery'
            ? this.getServingPotterySupplierForResidence(residence)
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
      || granaryExportableGrain(breadGrainStock(granary), granary.granaryGrainReserve ?? 0) <= 1e-6
    ) {
      return null;
    }
    const state = this.getGameState();
    const fireDisabled = fireDisabledBuildingIds(state.fireIncidents.values());
    if (fireDisabled.has(granary.id)) return null;
    const network = this.getRoadNetwork();
    const commodity = BREAD_GRAIN_KINDS
      .map((kind) => ({ kind, stock: granary[kind] ?? 0 }))
      .sort((left, right) => right.stock - left.stock)[0];
    if (!commodity || commodity.stock <= 1e-6) return null;
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
      this.fireEnabledBuildings(state, fireDisabled),
      granary.id,
      (target) => localDeliveryDistance(
        network,
        granary.x,
        granary.z,
        target.x,
        target.z,
      ),
      () => 1,
      (target) => inboundTargets.has(target.id),
      (target) => processorAcceptsInput(target, commodity.kind),
      commodity.kind,
    );
  }

  getNextDirectProcessorInputDispatch(
    source: BuildingState,
    commodity: DirectProcessorInputCommodity,
  ): RoutedProcessorInputDestination<BuildingState> | null {
    const state = this.getGameState();
    const fireDisabled = fireDisabledBuildingIds(state.fireIncidents.values());
    if (
      source.constructionComplete === false
      || source.assignedLabor <= 0
      || fireDisabled.has(source.id)
      || processorInputCommodityStock(source, commodity) <= 1e-6
      || findActiveTripForBuilding(state.deliveryTrips.values(), source.id) != null
    ) {
      return null;
    }
    const network = this.getRoadNetwork();
    const activeSources = new Set<string>();
    const inboundTargets = new Set<string>();
    for (const trip of state.deliveryTrips.values()) {
      activeSources.add(trip.buildingId);
      if (
        trip.phase !== 'inbound'
        && trip.destinationKind === 'building'
        && trip.targetBuildingId
      ) {
        inboundTargets.add(trip.targetBuildingId);
      }
    }
    const acceptsMaterialInput = (
      target: BuildingState,
      material: DirectProcessorInputCommodity,
    ): boolean => {
      if (material === 'preservedFood') {
        return storageAcceptsCommodity(target, material);
      }
      if (isStorageCommodity(material) && !storageAcceptsCommodity(target, material)) return false;
      if (!processorAcceptsInput(target, material)) return false;
      if (material !== 'ironwork') return true;
      const deposit = target.kind === 'mine'
        ? mineralDepositBeneath(target, state.quarries.values())
        : null;
      const mineralResource = deposit?.resource === 'iron'
        || deposit?.resource === 'salt'
        ? deposit.resource
        : null;
      return extractionAcceptsMaintenance(target, mineralResource);
    };
    if (localMaterialInputCommodities(source.kind, source)
      .some((candidate) => candidate === commodity)) {
      const localSources = [...this.fireEnabledBuildings(state, fireDisabled)]
        .filter((candidate) =>
          localMaterialInputCommodities(candidate.kind, candidate).length > 0
          && candidate.constructionComplete !== false
          && candidate.assignedLabor > 0
          && !activeSources.has(candidate.id));
      const assignments = assignLocalMaterialInputTargets(
        localSources,
        this.fireEnabledBuildings(state, fireDisabled),
        (producer, target) => localDeliveryDistance(
          network,
          producer.x,
          producer.z,
          target.x,
          target.z,
        ),
        (producer) => !activeSources.has(producer.id),
        (target) => inboundTargets.has(target.id),
        acceptsMaterialInput,
      );
      const assignment = assignments.get(source.id) ?? null;
      return assignment?.commodity === commodity ? assignment : null;
    }
    return selectDirectProcessorInputTarget(
      this.fireEnabledBuildings(state, fireDisabled),
      source.id,
      commodity,
      (target) => localDeliveryDistance(
        network,
        source.x,
        source.z,
        target.x,
        target.z,
      ),
      (target) => inboundTargets.has(target.id),
      (target) => acceptsMaterialInput(target, commodity),
    );
  }

  getNextInstitutionalFoodDispatch(
    source: BuildingState,
    conflictEnabled = false,
  ): RoutedInstitutionalFoodDestination<BuildingState> | null {
    const state = this.getGameState();
    const fireDisabled = fireDisabledBuildingIds(state.fireIncidents.values());
    const claimedHouseholds = this.getClaimedResidencesForFoodSupplier(source).length;
    const sourceCapacity = (
      BUILDING_STORAGE_CAPS[source.kind] as { food?: number } | undefined
    )?.food ?? 0;
    if (
      !INSTITUTIONAL_FOOD_SOURCE_KINDS.includes(
        source.kind as (typeof INSTITUTIONAL_FOOD_SOURCE_KINDS)[number],
      )
      || source.constructionComplete === false
      || fireDisabled.has(source.id)
      || findActiveTripForBuilding(state.deliveryTrips.values(), source.id) != null
      || institutionalFoodSurplus(
        edibleFoodStock(source),
        claimedHouseholds,
        sourceCapacity,
      ) <= 1e-6
    ) {
      return null;
    }
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
    return selectInstitutionalFoodTarget(
      this.fireEnabledBuildings(state, fireDisabled),
      source.id,
      conflictEnabled,
      (target) => localDeliveryDistance(
        network,
        source.x,
        source.z,
        target.x,
        target.z,
      ),
      (target) => inboundTargets.has(target.id),
      (target) => processorAcceptsInput(target, 'food'),
    );
  }

  getNextMarketplaceMaterialDispatch(
    source: BuildingState,
  ): RoutedMarketplaceMaterialDestination<BuildingState> | null {
    const state = this.getGameState();
    const fireDisabled = fireDisabledBuildingIds(state.fireIncidents.values());
    const pendingTrade = marketplacePendingTradeOffer(
      source.marketplacePendingTradeCode,
    );
    const potteryReservedForTrade = pendingTrade?.kind === 'goldSell'
      && pendingTrade.resource === 'pottery';
    if (
      source.kind !== 'trading_post'
      || source.constructionComplete === false
      || source.assignedLabor <= 0
      || fireDisabled.has(source.id)
      || (
        (source.iron ?? 0) <= 1e-6
        && (source.salt ?? 0) <= 1e-6
        && (
          potteryReservedForTrade
          || (source.pottery ?? 0) <= 1e-6
        )
      )
    ) {
      return null;
    }
    const network = this.getRoadNetwork();
    const activeSources = new Set<string>();
    const inboundTargets = new Set<string>();
    for (const trip of state.deliveryTrips.values()) {
      activeSources.add(trip.buildingId);
      if (
        trip.phase !== 'inbound'
        && trip.destinationKind === 'building'
        && trip.targetBuildingId
      ) {
        inboundTargets.add(trip.targetBuildingId);
      }
    }
    const materialSources = [...this.fireEnabledBuildings(state, fireDisabled)]
      .filter((candidate) =>
        candidate.kind === 'trading_post'
        && candidate.constructionComplete !== false
        && candidate.assignedLabor > 0
        && !activeSources.has(candidate.id));
    const reservations = new Map<string, boolean>();
    for (const candidate of materialSources) {
      const pendingTrade = marketplacePendingTradeOffer(
        candidate.marketplacePendingTradeCode,
      );
      reservations.set(
        candidate.id,
        pendingTrade?.kind === 'goldSell' && pendingTrade.resource === 'pottery',
      );
    }
    const assignments = assignMarketplaceMaterialInputTargets(
      materialSources,
      this.fireEnabledBuildings(state, fireDisabled),
      (market, target) => localDeliveryDistance(
        network,
        market.x,
        market.z,
        target.x,
        target.z,
      ),
      (market) => !activeSources.has(market.id),
      (target) => inboundTargets.has(target.id),
      (target, commodity) => processorAcceptsInput(target, commodity),
      (market, commodity) =>
        commodity === 'pottery' && reservations.get(market.id) === true,
    );
    return assignments.get(source.id) ?? null;
  }

  getNextGranaryGuardFoodDispatch(
    granary: BuildingState,
  ): RoutedGuardhouseFoodTarget<BuildingState> | null {
    const state = this.getGameState();
    const fireDisabled = fireDisabledBuildingIds(state.fireIncidents.values());
    if (
      granary.kind !== 'granary'
      || granary.constructionComplete === false
      || granary.assignedLabor <= 0
      || fireDisabled.has(granary.id)
    ) {
      return null;
    }
    const claimedHouseholds = this.getClaimedResidencesForFoodSupplier(granary).length;
    const transferable = institutionalFoodSurplus(
      edibleFoodStock(granary),
      claimedHouseholds,
      BUILDING_STORAGE_CAPS.granary.food,
    );
    if (transferable <= 1e-6) return null;

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
      this.fireEnabledBuildings(state, fireDisabled),
      granary.id,
      (target) => localDeliveryDistance(
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
    minTier: 1 | 2 | 3 | 4 = 1,
  ): ResidenceState | null {
    const state = this.getGameState();
    const fireDisabledBuildings = fireDisabledBuildingIds(
      state.fireIncidents.values(),
    );
    if (fireDisabledBuildings.has(origin.id)) return null;
    const fireDisabledResidences = fireDisabledResidenceIds(
      state.fireIncidents.values(),
    );
    const network = this.getRoadNetwork();
    let best: ResidenceState | null = null;
    let bestDistance = Infinity;
    for (const residence of state.residences.values()) {
      if (
        residence.abandoned
        || residence.tier < minTier
        || fireDisabledResidences.has(residence.id)
      ) continue;
      const distance = localDeliveryDistance(
        network,
        origin.x,
        origin.z,
        residence.x,
        residence.z,
      );
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
    const freeHaulerWorkers = computePopulationStats(this.getGameState()).available > 0 ? 1 : 0;
    return foodSupplierDeliveryTripSeconds(
      network,
      supplier,
      target,
      freeHaulerWorkers,
      this.getDeliveryTravelSpeedMultiplier(supplier),
    );
  }

  getLodgeDeliveryTripSeconds(
    lodge: BuildingState,
    target: ResidenceState | null,
  ): number {
    const network = this.getRoadNetwork();
    const freeHaulerWorkers = computePopulationStats(this.getGameState()).available > 0 ? 1 : 0;
    return lodgeDeliveryTripSeconds(
      network,
      lodge,
      target,
      freeHaulerWorkers,
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

  getDeliveryTripRemainingSeconds(trip: DeliveryTripState): number {
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
    return findNearestResourceNodeWithRemaining(
      this.getGameState().quarries.values(),
      x,
      z,
      radius,
      'quarry',
      'stone',
    );
  }

  findNearestSurfaceDepositWithRemaining(
    x: number,
    z: number,
    radius: number,
  ): ResourceNodeState | null {
    let nearest: ResourceNodeState | null = null;
    let nearestDistance = Math.max(0, radius);
    for (const deposit of this.getGameState().quarries.values()) {
      if (deposit.remaining <= 0) continue;
      const distance = Math.hypot(deposit.x - x, deposit.z - z);
      if (distance > nearestDistance) continue;
      nearest = deposit;
      nearestDistance = distance;
    }
    return nearest;
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

function buildingNeedsInspectableTreeCounts(
  state: GameState,
  building: BuildingState,
): boolean {
  if (
    building.kind !== 'lumber_mill'
    && building.kind !== 'reforester'
    && building.kind !== 'swineherd'
  ) {
    return false;
  }
  return fireForTarget(
    state.fireIncidents.values(),
    'building',
    building.id,
  )?.status !== 'destroyed';
}
