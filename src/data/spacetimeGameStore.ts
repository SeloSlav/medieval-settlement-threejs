/// <reference types="vite/client" />
/**
 * SpacetimeDB game store — replicated game state from server tables.
 * Data flow: SpacetimeDB → store → App / ForestVisualSync / RoadNetwork.
 */

import type { DbConnection } from '../generated/index.ts';
import {
  clearStoredSpacetimeToken,
  getStoredSpacetimeToken,
  setStoredSpacetimeToken,
} from '../network/identityPersistence.ts';
import {
  connect,
  getConnection,
  getSpacetimeConfig,
  isConnected,
} from '../network/spacetimedbClient.ts';
import { isUnauthorizedConnectError } from '../network/connectionErrorPolicy.ts';
import type { RoadNetworkSnapshot } from '../roads/RoadNetwork.ts';
import type { BackyardGardenKind } from '../residences/backyardGarden.ts';
import type { FireTargetKind } from '../fires/fireIncident.ts';
import type { StorehouseCommodity } from '../economy/storehousePolicy.ts';
import type { FarmCrop, LivestockSpecies } from '../resources/types.ts';
import { ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT } from '../economy/villageEconomy.ts';
import { DEFAULT_PARISH_POLICY, type ParishPolicyState } from '../economy/chapelParish.ts';
import { DEFAULT_MONASTERY_POLICY, type MonasteryPolicyState } from '../economy/monasteryPolicy.ts';
import {
  DEFAULT_REGIONAL_MARKET_STATE,
  type RegionalMarketState,
} from '../economy/regionalMarket.ts';
import type {
  BackyardGardenState,
  BuildingKind,
  BuildingState,
  BurgageFrontageEdge,
  BurgageZoneState,
  GameState,
  ResourceNodeState,
  ForagingNodeState,
  FarmFieldState,
  GraveyardState,
  CorpseState,
  LivestockHerdState,
  PastureState,
  ResidenceState,
  SettlementState,
  ResourceStockpile,
  StableOxState,
  TreeEntityState,
  VineyardParcelState,
} from '../resources/types.ts';
import { createEmptyStockpile } from '../resources/types.ts';
import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';
import type { CombatAgentState } from '../security/combatAgents.ts';
import type { ActiveRaidState } from '../security/activeRaid.ts';
import type { FireIncidentState } from '../fires/fireIncident.ts';
import {
  DEFAULT_SETTLEMENT_SECURITY,
  type SettlementSecurityState,
} from '../security/frontierSecurity.ts';
import { GAME_TABLE_SUBSCRIPTIONS } from './gameTableSubscriptions.ts';
import type { WorldLayout } from '../resources/WorldLayout.ts';
import type { WorldLayoutRegistry } from '../resources/WorldLayoutRegistry.ts';
import type { WorldGenerationSettings } from '../world/worldGenerationSettings.ts';
import {
  type AuthoritativeWorldGeneration,
} from '../world/worldConfigAuthority.ts';
import { getDraftWorldGeneration } from '../world/worldGenerationContext.ts';
import { inferNextBuildingId } from './spacetimeIds.ts';
import * as spacetimeReducers from './spacetimeReducers.ts';
import { applyAuthoritativeWorldGeneration } from '../world/worldGenerationContext.ts';
import { GameTableSync } from './spacetimeTableSync/gameTableSync.ts';
import { syncWorldConfig } from './spacetimeTableSync/syncWorldConfig.ts';
import type { GameTableSyncState } from './spacetimeTableSync/gameTableSyncState.ts';
import type { GameSpeed } from '../world/gameSpeed.ts';
import { DEFAULT_FISCAL_POLICY, type FiscalPolicyState } from '../economy/fiscalPolicy.ts';
import {
  applySeasonalLaborCallup,
  applySeasonalLaborRecall,
  computeSettlementSeasonalCallupPlan,
  computeSettlementSeasonalLaborPlan,
} from '../economy/seasonalLabor.ts';
import {
  applyProcessorLaborCallup,
  computeSettlementProcessorLaborCallupPlan,
} from '../economy/processorLabor.ts';
import {
  applyWorksiteStallRecall,
  computeSettlementWorksiteStallPlan,
} from '../economy/settlementWorksiteStalls.ts';
import {
  applyConstructionLaborRotation,
  computeSettlementConstructionLaborPlan,
} from '../economy/constructionLabor.ts';
import {
  applyYearRoundLaborRotation,
  computeSettlementYearRoundLaborRotation,
} from '../economy/yearRoundLabor.ts';
import { gameClock } from '../world/gameCalendar.ts';
import { STARTING_POPULATION } from '../generated/gameBalance.ts';
import {
  DEFAULT_CONSTRUCTION_LABOR_STEWARD_ENABLED,
  DEFAULT_LABOR_STEWARD_RESERVE,
  DEFAULT_PRODUCTION_LABOR_STEWARD_ENABLED,
  DEFAULT_SEASONAL_LABOR_STEWARD_ENABLED,
} from '../economy/laborSteward.ts';
import {
  DEFAULT_NIGHT_POLICY,
  type NightPolicyCode,
  type NightPolicyState,
} from '../economy/nightPolicy.ts';
import {
  DEFAULT_PANTRY_SAFEGUARD_POLICY,
  type PantrySafeguardPolicyCode,
} from '../economy/pantrySafeguardPolicy.ts';
import type { TradingPostTradeRuleState } from '../economy/tradingPostTrade.ts';

export type SpacetimeGameSnapshot = {
  connected: boolean;
  identityHex: string | null;
  stockpile: ResourceStockpile;
  physicalFoundingSiteEnabled: boolean;
  legacyUnhousedPopulationBonusEnabled: boolean;
  economicActivityTaxRate: number;
  pantrySafeguardPolicy: PantrySafeguardPolicyCode;
  fiscalPolicy: FiscalPolicyState;
  seasonalLaborStewardEnabled: boolean;
  constructionLaborStewardEnabled: boolean;
  productionLaborStewardEnabled: boolean;
  laborStewardReserve: number;
  parishPolicy: ParishPolicyState;
  monasteryPolicy: MonasteryPolicyState;
  nightPolicy: NightPolicyState;
  marketState: RegionalMarketState;
  tradingPostTradeRules: Map<string, TradingPostTradeRuleState>;
  quarries: Map<string, ResourceNodeState>;
  foragingNodes: Map<string, ForagingNodeState>;
  trees: Map<string, TreeEntityState>;
  buildings: Map<string, BuildingState>;
  settlements: Map<string, SettlementState>;
  farmFields: Map<string, FarmFieldState>;
  pastures: Map<string, PastureState>;
  vineyardParcels: Map<string, VineyardParcelState>;
  graveyards: Map<string, GraveyardState>;
  corpses: Map<string, CorpseState>;
  livestockHerds: Map<string, LivestockHerdState>;
  stableOxen: Map<string, StableOxState>;
  burgageZones: Map<string, BurgageZoneState>;
  residences: Map<string, ResidenceState>;
  backyardGardens: Map<string, BackyardGardenState>;
  deliveryTrips: Map<string, DeliveryTripState>;
  fireIncidents: Map<string, FireIncidentState>;
  combatAgents: Map<string, CombatAgentState>;
  activeRaid: ActiveRaidState | null;
  settlementSecurity: SettlementSecurityState;
  roads: RoadNetworkSnapshot | null;
  simTick: number;
  gameSpeed: GameSpeed;
  worldGeneration: AuthoritativeWorldGeneration | null;
};

export type SpacetimeGameStoreListener = (snapshot: SpacetimeGameSnapshot) => void;

function createEmptyTableState(): GameTableSyncState {
  return {
    identityHex: null,
    simTick: 0,
    gameSpeed: 1,
    worldGeneration: null,
    stockpile: createEmptyStockpile(),
    physicalFoundingSiteEnabled: false,
    legacyUnhousedPopulationBonusEnabled: true,
    economicActivityTaxRate: ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT,
    pantrySafeguardPolicy: DEFAULT_PANTRY_SAFEGUARD_POLICY,
    fiscalPolicy: { ...DEFAULT_FISCAL_POLICY },
    seasonalLaborStewardEnabled: DEFAULT_SEASONAL_LABOR_STEWARD_ENABLED,
    constructionLaborStewardEnabled: DEFAULT_CONSTRUCTION_LABOR_STEWARD_ENABLED,
    productionLaborStewardEnabled: DEFAULT_PRODUCTION_LABOR_STEWARD_ENABLED,
    laborStewardReserve: DEFAULT_LABOR_STEWARD_RESERVE,
    parishPolicy: { ...DEFAULT_PARISH_POLICY },
    monasteryPolicy: { ...DEFAULT_MONASTERY_POLICY },
    nightPolicy: { ...DEFAULT_NIGHT_POLICY },
    marketState: { ...DEFAULT_REGIONAL_MARKET_STATE },
    tradingPostTradeRules: new Map(),
    quarries: new Map(),
    foragingNodes: new Map(),
    trees: new Map(),
    buildings: new Map(),
    settlements: new Map(),
    farmFields: new Map(),
    pastures: new Map(),
    vineyardParcels: new Map(),
    graveyards: new Map(),
    corpses: new Map(),
    livestockHerds: new Map(),
    stableOxen: new Map(),
    burgageZones: new Map(),
    residences: new Map(),
    backyardGardens: new Map(),
    deliveryTrips: new Map(),
    fireIncidents: new Map(),
    combatAgents: new Map(),
    activeRaid: null,
    settlementSecurity: { ...DEFAULT_SETTLEMENT_SECURITY },
    roads: null,
  };
}

function tableStatePopulation(state: GameTableSyncState): number {
  const housed = Array.from(state.residences.values()).reduce(
    (total, residence) => total + (residence.abandoned ? 0 : residence.population),
    0,
  );
  if (state.settlements.size > 0) {
    const unhousedFounders = [...state.settlements.values()].reduce(
      (total, settlement) => total + (settlement.active ? settlement.unhousedFounders : 0),
      0,
    );
    return housed + unhousedFounders;
  }
  return state.legacyUnhousedPopulationBonusEnabled
    ? STARTING_POPULATION + housed
    : Math.max(STARTING_POPULATION, housed);
}

function scopedTownHallPlanningState(
  state: GameTableSyncState,
  townHallId: string,
): GameTableSyncState {
  const hall = state.buildings.get(townHallId);
  if (!hall || hall.kind !== 'town_hall') throw new Error('Select a valid Town Hall.');
  const settlementId = hall.settlementId;
  // Legacy schema rows had no settlement id and retain the former realm-wide
  // preview until their additive migration assigns durable membership.
  if (!settlementId) return state;
  const buildings = filterMap(state.buildings, (building) =>
    building.settlementId === settlementId);
  const residences = filterMap(state.residences, (residence) =>
    residence.settlementId === settlementId);
  const burgageZones = filterMap(state.burgageZones, (zone) =>
    zone.settlementId === settlementId);
  const localBuildingIds = new Set(buildings.keys());
  const localResidenceIds = new Set(residences.keys());
  const farmFields = filterMap(state.farmFields, (field) =>
    localBuildingIds.has(field.farmsteadId));
  const deliveryTrips = filterMap(state.deliveryTrips, (trip) =>
    localBuildingIds.has(trip.buildingId)
    || (trip.laborBuildingId != null && localBuildingIds.has(trip.laborBuildingId))
    || (trip.targetBuildingId != null && localBuildingIds.has(trip.targetBuildingId))
    || (trip.residenceId != null && localResidenceIds.has(trip.residenceId)));
  return {
    ...state,
    buildings,
    residences,
    burgageZones,
    farmFields,
    deliveryTrips,
  };
}

function filterMap<K, V>(
  source: ReadonlyMap<K, V>,
  predicate: (value: V, key: K) => boolean,
): Map<K, V> {
  const filtered = new Map<K, V>();
  for (const [key, value] of source) {
    if (predicate(value, key)) filtered.set(key, value);
  }
  return filtered;
}

export class SpacetimeGameStore {
  private connection: DbConnection | null = null;
  private readonly tableState = createEmptyTableState();
  private readonly listeners = new Set<SpacetimeGameStoreListener>();
  private roadSyncTimer: number | null = null;
  private pendingRoadSnapshot: string | null = null;
  private subscribedConnection: DbConnection | null = null;
  private readonly tableSync: GameTableSync;
  private readonly snapshotMapCache = new WeakMap<object, object>();
  private readonly snapshotRecordCache = new WeakMap<object, object>();
  private readonly snapshotRoadCache = new WeakMap<RoadNetworkSnapshot, RoadNetworkSnapshot>();

  constructor() {
    this.tableSync = new GameTableSync(this.tableState, () => this.emit());
  }

  get isConnected(): boolean {
    return isConnected();
  }

  hasServerQuarries(): boolean {
    const connection = getConnection();
    if (!connection) return false;
    return spacetimeReducers.countServerRows(connection, 'quarry') > 0;
  }

  hasServerTrees(): boolean {
    const connection = getConnection();
    if (!connection) return false;
    return spacetimeReducers.countServerRows(connection, 'tree_entity') > 0;
  }

  get snapshot(): SpacetimeGameSnapshot {
    const state = this.tableState;
    return {
      connected: this.isConnected,
      identityHex: state.identityHex,
      stockpile: this.snapshotRecord(state.stockpile),
      physicalFoundingSiteEnabled: state.physicalFoundingSiteEnabled,
      legacyUnhousedPopulationBonusEnabled: state.legacyUnhousedPopulationBonusEnabled,
      economicActivityTaxRate: state.economicActivityTaxRate,
      pantrySafeguardPolicy: state.pantrySafeguardPolicy,
      fiscalPolicy: this.snapshotRecord(state.fiscalPolicy),
      seasonalLaborStewardEnabled: state.seasonalLaborStewardEnabled,
      constructionLaborStewardEnabled: state.constructionLaborStewardEnabled,
      productionLaborStewardEnabled: state.productionLaborStewardEnabled,
      laborStewardReserve: state.laborStewardReserve,
      parishPolicy: this.snapshotRecord(state.parishPolicy),
      monasteryPolicy: this.snapshotRecord(state.monasteryPolicy),
      nightPolicy: this.snapshotRecord(state.nightPolicy),
      marketState: this.snapshotRecord(state.marketState),
      tradingPostTradeRules: this.snapshotMap(state.tradingPostTradeRules),
      quarries: this.snapshotMap(state.quarries),
      foragingNodes: this.snapshotMap(state.foragingNodes),
      trees: this.snapshotMap(state.trees),
      buildings: this.snapshotMap(state.buildings),
      settlements: this.snapshotMap(state.settlements),
      farmFields: this.snapshotMap(state.farmFields),
      pastures: this.snapshotMap(state.pastures),
      vineyardParcels: this.snapshotMap(state.vineyardParcels),
      graveyards: this.snapshotMap(state.graveyards),
      corpses: this.snapshotMap(state.corpses),
      livestockHerds: this.snapshotMap(state.livestockHerds),
      stableOxen: this.snapshotMap(state.stableOxen),
      burgageZones: this.snapshotMap(state.burgageZones),
      residences: this.snapshotMap(state.residences),
      backyardGardens: this.snapshotMap(state.backyardGardens),
      deliveryTrips: this.snapshotMap(state.deliveryTrips),
      fireIncidents: this.snapshotMap(state.fireIncidents),
      combatAgents: this.snapshotMap(state.combatAgents),
      activeRaid: state.activeRaid ? this.snapshotRecord(state.activeRaid) : null,
      settlementSecurity: this.snapshotRecord(state.settlementSecurity),
      roads: this.snapshotRoads(state.roads),
      simTick: state.simTick,
      gameSpeed: state.gameSpeed,
      worldGeneration: state.worldGeneration
        ? this.snapshotRecord(state.worldGeneration)
        : null,
    };
  }

  subscribe(listener: SpacetimeGameStoreListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  connect(): DbConnection {
    return this.connectWithOptionalToken(getStoredSpacetimeToken(getSpacetimeConfig().dbName) ?? undefined, false);
  }

  /**
   * Promote this transport connection to an active gameplay session only after
   * GameRuntime has applied subscriptions and hydrated the authoritative world.
   */
  enterWorld(): Promise<void> {
    return spacetimeReducers.enterWorld();
  }

  private connectWithOptionalToken(token: string | undefined, isRetry: boolean): DbConnection {
    const { dbName } = getSpacetimeConfig();

    this.connection = connect(token, {
      onIdentity: (identity) => {
        this.tableState.identityHex = identity.toHexString();
        this.startSubscriptions();
      },
      onToken: (serverToken) => {
        setStoredSpacetimeToken(dbName, serverToken);
      },
      onConnectError: (error) => {
        if (!isRetry && isUnauthorizedConnectError(error)) {
          clearStoredSpacetimeToken(dbName);
          console.warn('[SpacetimeGameStore] Stale token cleared, retrying anonymous connect');
          this.connectWithOptionalToken(undefined, true);
          return;
        }
        console.warn('[SpacetimeGameStore] connect error', error);
        this.connectErrorListener?.(error);
        this.emit();
      },
      onDisconnect: () => {
        this.subscribedConnection = null;
        this.tableState.identityHex = null;
        this.tableState.roads = null;
        this.emit();
      },
    });
    return this.connection;
  }

  toGameState(
    _registry: WorldLayoutRegistry,
    snapshot: SpacetimeGameSnapshot = this.snapshot,
  ): GameState {
    const seed = snapshot.worldGeneration?.configured
      ? snapshot.worldGeneration.seed
      : getDraftWorldGeneration().seed;

    return {
      seed,
      tick: snapshot.simTick,
      physicalFoundingSiteEnabled: snapshot.physicalFoundingSiteEnabled,
      legacyUnhousedPopulationBonusEnabled: snapshot.legacyUnhousedPopulationBonusEnabled,
      stockpile: snapshot.stockpile,
      quarries: snapshot.quarries,
      foragingNodes: snapshot.foragingNodes,
      trees: snapshot.trees,
      buildings: snapshot.buildings,
      settlements: snapshot.settlements,
      tradingPostTradeRules: snapshot.tradingPostTradeRules,
      farmFields: snapshot.farmFields,
      pastures: snapshot.pastures,
      vineyardParcels: snapshot.vineyardParcels,
      graveyards: snapshot.graveyards,
      corpses: snapshot.corpses,
      livestockHerds: snapshot.livestockHerds,
      stableOxen: snapshot.stableOxen,
      burgageZones: snapshot.burgageZones,
      residences: snapshot.residences,
      backyardGardens: snapshot.backyardGardens,
      deliveryTrips: snapshot.deliveryTrips,
      fireIncidents: snapshot.fireIncidents,
      nextBuildingId: inferNextBuildingId(snapshot.buildings),
    };
  }

  placeBackyardGarden(residenceId: string, kind: BackyardGardenKind): Promise<void> {
    return spacetimeReducers.placeBackyardGarden(residenceId, kind);
  }

  demolishBackyardGarden(residenceId: string): Promise<void> {
    return spacetimeReducers.demolishBackyardGarden(residenceId);
  }

  specializeOrchard(residenceId: string, kind: BackyardGardenKind): Promise<void> {
    return spacetimeReducers.specializeOrchard(residenceId, kind);
  }

  specializeAnimalPen(residenceId: string, kind: BackyardGardenKind): Promise<void> {
    return spacetimeReducers.specializeAnimalPen(residenceId, kind);
  }

  specializeVegetableGarden(residenceId: string, kind: BackyardGardenKind): Promise<void> {
    return spacetimeReducers.specializeVegetableGarden(residenceId, kind);
  }

  upgradeFlowerGardenLuxury(residenceId: string): Promise<void> {
    return spacetimeReducers.upgradeFlowerGardenLuxury(residenceId);
  }

  placeBurgageZone(input: {
    corners: Array<{ x: number; z: number }>;
    frontageEdge: BurgageFrontageEdge;
    plotCount: number;
  }): Promise<void> {
    return spacetimeReducers.placeBurgageZone(input);
  }

  demolishBurgageZone(zoneId: string): Promise<void> {
    return spacetimeReducers.demolishBurgageZone(zoneId);
  }

  demolishResidence(residenceId: string): Promise<void> {
    return spacetimeReducers.demolishResidence(residenceId);
  }

  upgradeResidence(residenceId: string): Promise<void> {
    return spacetimeReducers.upgradeResidence(residenceId);
  }

  retrofitResidenceTileRoof(residenceId: string): Promise<void> {
    return spacetimeReducers.retrofitResidenceTileRoof(residenceId);
  }

  async setResidenceUpgradePriority(residenceId: string, priority: number): Promise<void> {
    const clampedPriority = Math.max(0, Math.min(3, Math.floor(priority)));
    const previous = this.tableState.residences.get(residenceId);
    if (previous) {
      const nextResidences = new Map(this.tableState.residences);
      nextResidences.set(residenceId, {
        ...previous,
        upgradePriority: clampedPriority,
        upgradeAssignedLabor: clampedPriority === 0 ? 0 : previous.upgradeAssignedLabor,
      });
      this.tableState.residences = nextResidences;
      this.emit();
    }
    try {
      await spacetimeReducers.setResidenceUpgradePriority(residenceId, clampedPriority);
      const connection = getConnection();
      if (connection) this.tableSync.syncResidences(connection);
    } catch (error) {
      if (previous) {
        const nextResidences = new Map(this.tableState.residences);
        nextResidences.set(residenceId, previous);
        this.tableState.residences = nextResidences;
        this.emit();
      }
      throw error;
    }
  }

  repairFireDamage(targetKind: FireTargetKind, targetId: string): Promise<void> {
    return spacetimeReducers.repairFireDamage(targetKind, targetId);
  }

  placeBuilding(kind: BuildingKind, x: number, z: number): Promise<void> {
    return spacetimeReducers.placeBuilding(kind, x, z);
  }

  async setGameSpeed(speed: GameSpeed): Promise<void> {
    const previous = this.tableState.gameSpeed;
    this.tableState.gameSpeed = speed;
    this.emit();
    try {
      await spacetimeReducers.setGameSpeed(speed);
    } catch (error) {
      this.tableState.gameSpeed = previous;
      this.emit();
      throw error;
    }
  }

  grantCheatResources(amount: number): Promise<void> {
    return spacetimeReducers.grantCheatResources(amount);
  }

  placeFarmField(input: {
    farmsteadId: string;
    corners: Array<{ x: number; z: number }>;
    crop: FarmCrop;
    averageSlopeDegrees: number;
  }): Promise<void> {
    return spacetimeReducers.placeFarmField(input);
  }

  setFarmFieldCrop(fieldId: string, crop: FarmCrop): Promise<void> {
    return spacetimeReducers.setFarmFieldCrop(fieldId, crop);
  }

  setFarmFieldFollowingCrop(fieldId: string, crop: FarmCrop | null): Promise<void> {
    return spacetimeReducers.setFarmFieldFollowingCrop(fieldId, crop);
  }

  setFarmFieldPriority(fieldId: string, priority: number): Promise<void> {
    return spacetimeReducers.setFarmFieldPriority(fieldId, priority);
  }

  startFarmFieldEarlyHarvest(fieldId: string): Promise<void> {
    return spacetimeReducers.startFarmFieldEarlyHarvest(fieldId);
  }

  demolishFarmField(fieldId: string): Promise<void> {
    return spacetimeReducers.demolishFarmField(fieldId);
  }

  placePasture(input: {
    farmsteadId: string;
    corners: Array<{ x: number; z: number }>;
    averageSlopeDegrees: number;
  }): Promise<void> {
    return spacetimeReducers.placePasture(input);
  }

  placeVineyard(input: {
    monasteryId: string;
    corners: Array<{ x: number; z: number }>;
    averageSlopeDegrees: number;
    southExposure: number;
  }): Promise<void> {
    return spacetimeReducers.placeVineyard(input);
  }

  demolishPasture(pastureId: string): Promise<void> {
    return spacetimeReducers.demolishPasture(pastureId);
  }

  placeGraveyard(input: {
    chapelId: string;
    corners: Array<{ x: number; z: number }>;
    averageSlopeDegrees: number;
  }): Promise<void> {
    return spacetimeReducers.placeGraveyard(input);
  }

  demolishGraveyard(graveyardId: string): Promise<void> {
    return spacetimeReducers.demolishGraveyard(graveyardId);
  }

  setLivestockSpecies(buildingId: string, species: Exclude<LivestockSpecies, 'swine'>): Promise<void> {
    return spacetimeReducers.setLivestockSpecies(buildingId, species);
  }

  tradeLivestock(buildingId: string, headDelta: number): Promise<void> {
    return spacetimeReducers.tradeLivestock(buildingId, headDelta);
  }

  purchaseStableOx(stableId: string): Promise<void> {
    return spacetimeReducers.purchaseStableOx(stableId);
  }

  setBuildingOxen(buildingId: string, assignedOxen: number): Promise<void> {
    return spacetimeReducers.setBuildingOxen(buildingId, assignedOxen);
  }

  setLivestockBreedingReserve(buildingId: string, breedingReserve: number): Promise<void> {
    return spacetimeReducers.setLivestockBreedingReserve(buildingId, breedingReserve);
  }

  setLivestockHaymakingPercent(buildingId: string, haymakingPercent: number): Promise<void> {
    return spacetimeReducers.setLivestockHaymakingPercent(buildingId, haymakingPercent);
  }

  setEconomicActivityTaxRate(townHallId: string, taxRate: number): Promise<void> {
    return spacetimeReducers.setEconomicActivityTaxRate(townHallId, taxRate);
  }

  setPantrySafeguardPolicy(
    townHallId: string,
    policy: PantrySafeguardPolicyCode,
  ): Promise<void> {
    return spacetimeReducers.setPantrySafeguardPolicy(townHallId, policy);
  }

  setFiscalPolicy(
    townHallId: string,
    landLevyRate: number,
    importDutyRate: number,
    exportDutyRate: number,
  ): Promise<void> {
    return spacetimeReducers.setFiscalPolicy(
      townHallId,
      landLevyRate,
      importDutyRate,
      exportDutyRate,
    );
  }

  setSeasonalLaborSteward(townHallId: string, enabled: boolean): Promise<void> {
    return spacetimeReducers.setSeasonalLaborSteward(townHallId, enabled);
  }

  setConstructionLaborSteward(townHallId: string, enabled: boolean): Promise<void> {
    return spacetimeReducers.setConstructionLaborSteward(townHallId, enabled);
  }

  setProductionLaborSteward(townHallId: string, enabled: boolean): Promise<void> {
    return spacetimeReducers.setProductionLaborSteward(townHallId, enabled);
  }

  setLaborStewardReserve(townHallId: string, laborReserve: number): Promise<void> {
    return spacetimeReducers.setLaborStewardReserve(townHallId, laborReserve);
  }

  setChapelParishPolicy(sabbathObservanceEnabled: boolean): Promise<void> {
    return spacetimeReducers.setChapelParishPolicy(sabbathObservanceEnabled);
  }

  setMonasteryPolicy(titheShare: number, feastsEnabled: boolean): Promise<void> {
    return spacetimeReducers.setMonasteryPolicy(titheShare, feastsEnabled);
  }

  setMonasteryCharter(levyRate: number): Promise<void> {
    return spacetimeReducers.setMonasteryCharter(levyRate);
  }

  setMonasteryPlanting(
    buildingId: string,
    orchardPlanting: number,
    croftPlanting: number,
  ): Promise<void> {
    return spacetimeReducers.setMonasteryPlanting(
      buildingId,
      orchardPlanting,
      croftPlanting,
    );
  }

  setMonasteryNextExtension(buildingId: string, extension: number): Promise<void> {
    return spacetimeReducers.setMonasteryNextExtension(buildingId, extension);
  }

  setNightPolicies(
    townHallId: string,
    watch: NightPolicyCode,
    gathering: NightPolicyCode,
    work: NightPolicyCode,
    lighting: NightPolicyCode,
    curfew: NightPolicyCode,
  ): Promise<void> {
    return spacetimeReducers.setNightPolicies(
      townHallId,
      watch,
      gathering,
      work,
      lighting,
      curfew,
    );
  }

  setStorehousePolicy(
    buildingId: string,
    acceptsTimber: boolean,
    acceptsStone: boolean,
    acceptsFirewood: boolean,
    acceptsCharcoal: boolean,
    acceptsIron: boolean,
    acceptsClay: boolean,
    acceptsSalt: boolean,
  ): Promise<void> {
    return spacetimeReducers.setStorehousePolicy(
      buildingId,
      acceptsTimber,
      acceptsStone,
      acceptsFirewood,
      acceptsCharcoal,
      acceptsIron,
      acceptsClay,
      acceptsSalt,
    );
  }

  placeRemoteWorkCamp(worksiteId: string, x: number, z: number): Promise<void> {
    return spacetimeReducers.placeRemoteWorkCamp(worksiteId, x, z);
  }

  setStorehouseStockTarget(
    buildingId: string,
    commodity: StorehouseCommodity,
    targetPercent: number,
  ): Promise<void> {
    return spacetimeReducers.setStorehouseStockTarget(
      buildingId,
      commodity,
      targetPercent,
    );
  }

  setProcessorOutputTarget(
    buildingId: string,
    targetPercent: number,
  ): Promise<void> {
    return spacetimeReducers.setProcessorOutputTarget(buildingId, targetPercent);
  }

  setStorageCommodityAcceptance(
    buildingId: string,
    commodity: import('../economy/storageAcceptancePolicy.ts').StorageCommodity,
    accepts: boolean,
  ): Promise<void> {
    return spacetimeReducers.setStorageCommodityAcceptance(buildingId, commodity, accepts);
  }

  setAllStorageAcceptance(buildingId: string, accepts: boolean): Promise<void> {
    return spacetimeReducers.setAllStorageAcceptance(buildingId, accepts);
  }

  setThreshingPriority(buildingId: string, priority: number): Promise<void> {
    return spacetimeReducers.setThreshingPriority(buildingId, priority);
  }

  setBreweryRecipePolicy(
    buildingId: string,
    recipePolicy: number,
  ): Promise<void> {
    return spacetimeReducers.setBreweryRecipePolicy(buildingId, recipePolicy);
  }

  setWeaverInputPolicy(
    buildingId: string,
    inputPolicy: number,
  ): Promise<void> {
    return spacetimeReducers.setWeaverInputPolicy(buildingId, inputPolicy);
  }

  setPotteryDispatchPolicy(
    buildingId: string,
    dispatchPolicy: number,
  ): Promise<void> {
    return spacetimeReducers.setPotteryDispatchPolicy(buildingId, dispatchPolicy);
  }

  setPotterFiringPolicy(
    buildingId: string,
    firingPolicy: number,
  ): Promise<void> {
    return spacetimeReducers.setPotterFiringPolicy(buildingId, firingPolicy);
  }

  setGranaryPolicy(
    buildingId: string,
    acceptsFreshFood: boolean,
    householdsFirst: boolean,
  ): Promise<void> {
    return spacetimeReducers.setGranaryPolicy(buildingId, acceptsFreshFood, householdsFirst);
  }

  setGranaryGrainReserve(buildingId: string, grainReserve: number): Promise<void> {
    return spacetimeReducers.setGranaryGrainReserve(buildingId, grainReserve);
  }

  setGranaryFreshFoodTarget(buildingId: string, targetPercent: number): Promise<void> {
    return spacetimeReducers.setGranaryFreshFoodTarget(buildingId, targetPercent);
  }

  setWoodcutterTimberReserve(buildingId: string, timberReserve: number): Promise<void> {
    return spacetimeReducers.setWoodcutterTimberReserve(buildingId, timberReserve);
  }

  setTreeWorkArea(
    buildingId: string,
    x: number,
    z: number,
    radius: number,
  ): Promise<void> {
    return spacetimeReducers.setTreeWorkArea(buildingId, x, z, radius);
  }

  clearTreeWorkArea(buildingId: string): Promise<void> {
    return spacetimeReducers.clearTreeWorkArea(buildingId);
  }

  setCarpenterPolearmReserve(buildingId: string, polearmReserve: number): Promise<void> {
    return spacetimeReducers.setCarpenterPolearmReserve(buildingId, polearmReserve);
  }

  setCarpenterCartServiceTarget(buildingId: string, targetTrips: number): Promise<void> {
    return spacetimeReducers.setCarpenterCartServiceTarget(buildingId, targetTrips);
  }

  setGuardhousePayPriority(buildingId: string, payPriority: number): Promise<void> {
    return spacetimeReducers.setGuardhousePayPriority(buildingId, payPriority);
  }

  setGuardhouseFoodReserve(buildingId: string, reservePerGuard: number): Promise<void> {
    return spacetimeReducers.setGuardhouseFoodReserve(buildingId, reservePerGuard);
  }

  setGuardhouseMusterPost(buildingId: string, watchtowerId: string | null): Promise<void> {
    return spacetimeReducers.setGuardhouseMusterPost(buildingId, watchtowerId);
  }

  setMarketplaceIronworkTarget(buildingId: string, ironworkTarget: number): Promise<void> {
    return spacetimeReducers.setMarketplaceIronworkTarget(buildingId, ironworkTarget);
  }

  setMarketplaceIronTarget(buildingId: string, ironTarget: number): Promise<void> {
    return spacetimeReducers.setMarketplaceIronTarget(buildingId, ironTarget);
  }

  setMarketplaceSaltTarget(buildingId: string, saltTarget: number): Promise<void> {
    return spacetimeReducers.setMarketplaceSaltTarget(buildingId, saltTarget);
  }

  setMarketplaceGoldReserveTarget(buildingId: string, goldReserveTarget: number): Promise<void> {
    return spacetimeReducers.setMarketplaceGoldReserveTarget(buildingId, goldReserveTarget);
  }

  setMarketplaceSeedGrainTarget(buildingId: string, seedGrainTarget: number): Promise<void> {
    return spacetimeReducers.setMarketplaceSeedGrainTarget(buildingId, seedGrainTarget);
  }

  setMarketplaceSpecialtyExportPolicy(buildingId: string, exportPolicy: number): Promise<void> {
    return spacetimeReducers.setMarketplaceSpecialtyExportPolicy(buildingId, exportPolicy);
  }

  setMarketplaceSpecialtyFamilyExportPolicy(
    buildingId: string,
    family: number,
    exportPolicy: number,
  ): Promise<void> {
    return spacetimeReducers.setMarketplaceSpecialtyFamilyExportPolicy(
      buildingId,
      family,
      exportPolicy,
    );
  }

  setApiaryHarvestPolicy(buildingId: string, harvestPolicy: number): Promise<void> {
    return spacetimeReducers.setApiaryHarvestPolicy(buildingId, harvestPolicy);
  }

  setHarvestReservePercent(buildingId: string, reservePercent: number): Promise<void> {
    return spacetimeReducers.setHarvestReservePercent(buildingId, reservePercent);
  }

  async assignBuildingLabor(buildingId: string, labor: number): Promise<void> {
    const clampedLabor = Math.max(0, Math.floor(labor));
    const previous = this.tableState.buildings.get(buildingId);
    if (previous) {
      const nextBuildings = new Map(this.tableState.buildings);
      nextBuildings.set(buildingId, { ...previous, assignedLabor: clampedLabor });
      this.tableState.buildings = nextBuildings;
      this.emit();
    }
    try {
      await spacetimeReducers.assignBuildingLabor(buildingId, clampedLabor);
      const connection = getConnection();
      if (connection) {
        this.tableSync.syncBuildings(connection);
      }
    } catch (error) {
      if (previous) {
        const nextBuildings = new Map(this.tableState.buildings);
        nextBuildings.set(buildingId, previous);
        this.tableState.buildings = nextBuildings;
        this.emit();
      }
      throw error;
    }
  }

  async rotateConstructionLabor(townHallId: string): Promise<{
    recalledWorkers: number;
    calledWorkers: number;
  }> {
    const totalPopulation = tableStatePopulation(this.tableState);
    const assignedLabor = Array.from(this.tableState.buildings.values()).reduce(
      (total, building) => total + building.assignedLabor,
      0,
    );
    const planningState = scopedTownHallPlanningState(this.tableState, townHallId);
    const plan = computeSettlementConstructionLaborPlan(
      planningState,
      Math.max(0, totalPopulation - assignedLabor),
    );
    if (plan.assignments.length === 0) {
      return { recalledWorkers: 0, calledWorkers: 0 };
    }
    const previousBuildings = this.tableState.buildings;
    this.tableState.buildings = applyConstructionLaborRotation(previousBuildings, plan);
    this.emit();
    try {
      await spacetimeReducers.rotateConstructionLabor(townHallId);
      const connection = getConnection();
      if (connection) this.tableSync.syncBuildings(connection);
      return {
        recalledWorkers: plan.recalledWorkers,
        calledWorkers: plan.calledWorkers,
      };
    } catch (error) {
      this.tableState.buildings = previousBuildings;
      this.emit();
      throw error;
    }
  }

  async recallIdleSeasonalLabor(townHallId: string): Promise<number> {
    const planningState = scopedTownHallPlanningState(this.tableState, townHallId);
    const plan = computeSettlementSeasonalLaborPlan(
      planningState,
      gameClock(this.tableState.simTick).month,
    );
    if (plan.reclaimableWorkers <= 0) return 0;
    const previousBuildings = this.tableState.buildings;
    this.tableState.buildings = applySeasonalLaborRecall(previousBuildings, plan);
    this.emit();
    try {
      await spacetimeReducers.recallIdleSeasonalLabor(townHallId);
      const connection = getConnection();
      if (connection) this.tableSync.syncBuildings(connection);
      return plan.reclaimableWorkers;
    } catch (error) {
      this.tableState.buildings = previousBuildings;
      this.emit();
      throw error;
    }
  }

  async callUpActiveSeasonalLabor(townHallId: string): Promise<number> {
    const totalPopulation = tableStatePopulation(this.tableState);
    const assignedLabor = Array.from(this.tableState.buildings.values()).reduce(
      (total, building) => total + building.assignedLabor,
      0,
    );
    const planningState = scopedTownHallPlanningState(this.tableState, townHallId);
    const plan = computeSettlementSeasonalCallupPlan(
      planningState,
      gameClock(this.tableState.simTick).month,
      Math.max(0, totalPopulation - assignedLabor),
    );
    if (plan.callupWorkers <= 0) return 0;
    const previousBuildings = this.tableState.buildings;
    this.tableState.buildings = applySeasonalLaborCallup(previousBuildings, plan);
    this.emit();
    try {
      await spacetimeReducers.callUpActiveSeasonalLabor(townHallId);
      const connection = getConnection();
      if (connection) this.tableSync.syncBuildings(connection);
      return plan.callupWorkers;
    } catch (error) {
      this.tableState.buildings = previousBuildings;
      this.emit();
      throw error;
    }
  }

  async recallTargetIdleProcessorLabor(townHallId: string): Promise<number> {
    const planningState = scopedTownHallPlanningState(this.tableState, townHallId);
    const plan = computeSettlementWorksiteStallPlan(
      planningState,
      gameClock(this.tableState.simTick).month,
    );
    if (plan.reclaimableWorkers <= 0) return 0;
    const previousBuildings = this.tableState.buildings;
    this.tableState.buildings = applyWorksiteStallRecall(previousBuildings, plan);
    this.emit();
    try {
      await spacetimeReducers.recallTargetIdleProcessorLabor(townHallId);
      const connection = getConnection();
      if (connection) this.tableSync.syncBuildings(connection);
      return plan.reclaimableWorkers;
    } catch (error) {
      this.tableState.buildings = previousBuildings;
      this.emit();
      throw error;
    }
  }

  async callUpTargetReadyProcessorLabor(townHallId: string): Promise<number> {
    const totalPopulation = tableStatePopulation(this.tableState);
    const assignedLabor = Array.from(this.tableState.buildings.values()).reduce(
      (total, building) => total + building.assignedLabor,
      0,
    );
    const planningState = scopedTownHallPlanningState(this.tableState, townHallId);
    const plan = computeSettlementProcessorLaborCallupPlan(
      planningState,
      Math.max(0, totalPopulation - assignedLabor),
    );
    if (plan.callupWorkers <= 0) return 0;
    const previousBuildings = this.tableState.buildings;
    this.tableState.buildings = applyProcessorLaborCallup(previousBuildings, plan);
    this.emit();
    try {
      await spacetimeReducers.callUpTargetReadyProcessorLabor(townHallId);
      const connection = getConnection();
      if (connection) this.tableSync.syncBuildings(connection);
      return plan.callupWorkers;
    } catch (error) {
      this.tableState.buildings = previousBuildings;
      this.emit();
      throw error;
    }
  }

  async balanceYearRoundLabor(townHallId: string): Promise<{
    recalledWorkers: number;
    calledWorkers: number;
  }> {
    const totalPopulation = tableStatePopulation(this.tableState);
    const assignedLabor = Array.from(this.tableState.buildings.values()).reduce(
      (total, building) => total + building.assignedLabor,
      0,
    );
    const planningState = scopedTownHallPlanningState(this.tableState, townHallId);
    const plan = computeSettlementYearRoundLaborRotation(
      planningState,
      Math.max(0, totalPopulation - assignedLabor),
    );
    if (plan.assignments.length === 0) {
      return { recalledWorkers: 0, calledWorkers: 0 };
    }
    const previousBuildings = this.tableState.buildings;
    this.tableState.buildings = applyYearRoundLaborRotation(previousBuildings, plan);
    this.emit();
    try {
      await spacetimeReducers.callUpYearRoundLabor(townHallId);
      const connection = getConnection();
      if (connection) this.tableSync.syncBuildings(connection);
      return {
        recalledWorkers: plan.recalledWorkers,
        calledWorkers: plan.calledWorkers,
      };
    } catch (error) {
      this.tableState.buildings = previousBuildings;
      this.emit();
      throw error;
    }
  }

  async setConstructionPriority(buildingId: string, priority: number): Promise<void> {
    const clampedPriority = Math.max(0, Math.min(3, Math.floor(priority)));
    const previous = this.tableState.buildings.get(buildingId);
    if (previous) {
      const nextBuildings = new Map(this.tableState.buildings);
      nextBuildings.set(buildingId, {
        ...previous,
        constructionPriority: clampedPriority,
        assignedLabor: clampedPriority === 0 ? 0 : previous.assignedLabor,
      });
      this.tableState.buildings = nextBuildings;
      this.emit();
    }
    try {
      await spacetimeReducers.setConstructionPriority(buildingId, clampedPriority);
      const connection = getConnection();
      if (connection) this.tableSync.syncBuildings(connection);
    } catch (error) {
      if (previous) {
        const nextBuildings = new Map(this.tableState.buildings);
        nextBuildings.set(buildingId, previous);
        this.tableState.buildings = nextBuildings;
        this.emit();
      }
      throw error;
    }
  }

  setTradingPostTradeRule(
    buildingId: string,
    commodityKind: number,
    mode: number,
    targetSurplus: number,
  ): Promise<void> {
    return spacetimeReducers.setTradingPostTradeRule(
      buildingId,
      commodityKind,
      mode,
      targetSurplus,
    );
  }

  upgradeChapel(buildingId: string): Promise<void> {
    return spacetimeReducers.upgradeChapel(buildingId);
  }

  demolishBuilding(buildingId: string): Promise<void> {
    return spacetimeReducers.demolishBuilding(buildingId);
  }

  getAuthoritativeWorldGeneration(): AuthoritativeWorldGeneration | null {
    return this.tableState.worldGeneration;
  }

  async configureWorld(settings: WorldGenerationSettings): Promise<void> {
    // Always reconfirm the idempotent server contract once per client
    // bootstrap. Immediately after reset_world, an unconfirmed subscription
    // can still expose the previous matching row while the reset transaction
    // is settling. Skipping the reducer in that window leaves configured=false
    // on the server and gates every simulation tick, even though placement is
    // already available to the client.
    await spacetimeReducers.configureWorld(settings);
    const connection = getConnection();
    if (connection) {
      syncWorldConfig(connection.db.world_config ? connection.db.world_config.iter() : [], this.tableState);
      if (this.tableState.worldGeneration?.configured) {
        applyAuthoritativeWorldGeneration(this.tableState.worldGeneration);
      }
      this.emit();
    }
  }

  private roadSyncFailedListener: ((error: unknown) => void) | null = null;
  private connectErrorListener: ((error: unknown) => void) | null = null;

  setConnectErrorListener(listener: ((error: unknown) => void) | null): void {
    this.connectErrorListener = listener;
  }

  setRoadSyncFailedListener(listener: ((error: unknown) => void) | null): void {
    this.roadSyncFailedListener = listener;
  }

  bootstrapWorld(
    registry: WorldLayoutRegistry,
    worldLayout: WorldLayout,
    getHeightAt?: (x: number, z: number) => number,
  ): Promise<void> {
    return spacetimeReducers.bootstrapWorld(registry, worldLayout, getHeightAt);
  }

  queueRoadSync(snapshot: RoadNetworkSnapshot): void {
    this.pendingRoadSnapshot = JSON.stringify(snapshot);
    if (this.roadSyncTimer !== null) return;
    this.roadSyncTimer = window.setTimeout(() => {
      this.roadSyncTimer = null;
      void this.flushRoadSync();
    }, 120);
  }

  async syncRoadNetworkNow(snapshot: RoadNetworkSnapshot): Promise<void> {
    this.pendingRoadSnapshot = JSON.stringify(snapshot);
    await this.flushRoadSync();
  }

  private async flushRoadSync(): Promise<void> {
    if (!this.connection || !this.pendingRoadSnapshot) return;
    const snapshotJson = this.pendingRoadSnapshot;
    this.pendingRoadSnapshot = null;
    try {
      await spacetimeReducers.syncRoadNetwork(snapshotJson);
    } catch (error) {
      console.error('[SpacetimeGameStore] Road sync failed:', error);
      this.roadSyncFailedListener?.(error);
    }
  }

  private startSubscriptions(): void {
    const connection = getConnection();
    if (!connection) return;

    if (this.subscribedConnection !== connection) {
      this.tableSync.attachHandlers(connection);
      this.subscribedConnection = connection;
      connection.subscriptionBuilder()
        .onApplied(() => {
          if (this.subscribedConnection !== connection) return;
          this.tableSync.syncAll(connection);
        })
        .onError((context) => {
          if (this.subscribedConnection !== connection) return;
          console.warn('[SpacetimeGameStore] subscription failed', context.event);
          this.connectErrorListener?.(context.event);
          this.emit();
        })
        .subscribe(GAME_TABLE_SUBSCRIPTIONS.map((table) => `SELECT * FROM ${table}`));
      // Publish transport/identity readiness immediately. GameRuntime will now
      // time out into an actionable error if the SDK never applies the initial
      // cache, instead of waiting forever for a table callback.
      this.emit();
      return;
    }

    this.tableSync.syncAll(connection);
  }

  private emit(): void {
    const snapshot = this.snapshot;
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private snapshotMap<K, V>(source: Map<K, V>): Map<K, V> {
    const cached = this.snapshotMapCache.get(source);
    if (cached) return cached as Map<K, V>;
    const snapshot = new Map(source);
    this.snapshotMapCache.set(source, snapshot);
    return snapshot;
  }

  private snapshotRecord<T extends object>(source: T): T {
    const cached = this.snapshotRecordCache.get(source);
    if (cached) return cached as T;
    const snapshot = { ...source };
    this.snapshotRecordCache.set(source, snapshot);
    return snapshot;
  }

  private snapshotRoads(source: RoadNetworkSnapshot | null): RoadNetworkSnapshot | null {
    if (!source) return null;
    const cached = this.snapshotRoadCache.get(source);
    if (cached) return cached;
    const snapshot = structuredClone(source);
    this.snapshotRoadCache.set(source, snapshot);
    return snapshot;
  }
}
