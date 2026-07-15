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
  isUnauthorizedConnectError,
} from '../network/spacetimedbClient.ts';
import type { RoadNetworkSnapshot } from '../roads/RoadNetwork.ts';
import type { BackyardGardenKind } from '../residences/backyardGarden.ts';
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
  LivestockHerdState,
  PastureState,
  ResidenceState,
  ResourceStockpile,
  TreeEntityState,
} from '../resources/types.ts';
import { createEmptyStockpile } from '../resources/types.ts';
import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';
import type { WorldLayout } from '../resources/WorldLayout.ts';
import type { WorldLayoutRegistry } from '../resources/WorldLayoutRegistry.ts';
import type { WorldGenerationSettings } from '../world/worldGenerationSettings.ts';
import {
  generationMatchesServer,
  type AuthoritativeWorldGeneration,
} from '../world/worldConfigAuthority.ts';
import { getDraftWorldGeneration } from '../world/worldGenerationContext.ts';
import { inferNextBuildingId } from './spacetimeIds.ts';
import * as spacetimeReducers from './spacetimeReducers.ts';
import { applyAuthoritativeWorldGeneration } from '../world/worldGenerationContext.ts';
import { GameTableSync } from './spacetimeTableSync/gameTableSync.ts';
import { syncWorldConfig } from './spacetimeTableSync/syncWorldConfig.ts';
import type { GameTableSyncState } from './spacetimeTableSync/gameTableSyncState.ts';

export type SpacetimeGameSnapshot = {
  connected: boolean;
  identityHex: string | null;
  stockpile: ResourceStockpile;
  economicActivityTaxRate: number;
  parishPolicy: ParishPolicyState;
  monasteryPolicy: MonasteryPolicyState;
  marketState: RegionalMarketState;
  quarries: Map<string, ResourceNodeState>;
  foragingNodes: Map<string, ForagingNodeState>;
  trees: Map<string, TreeEntityState>;
  buildings: Map<string, BuildingState>;
  farmFields: Map<string, FarmFieldState>;
  pastures: Map<string, PastureState>;
  livestockHerds: Map<string, LivestockHerdState>;
  burgageZones: Map<string, BurgageZoneState>;
  residences: Map<string, ResidenceState>;
  backyardGardens: Map<string, BackyardGardenState>;
  deliveryTrips: Map<string, DeliveryTripState>;
  roads: RoadNetworkSnapshot | null;
  simTick: number;
  worldGeneration: AuthoritativeWorldGeneration | null;
};

export type SpacetimeGameStoreListener = (snapshot: SpacetimeGameSnapshot) => void;

function createEmptyTableState(): GameTableSyncState {
  return {
    identityHex: null,
    simTick: 0,
    worldGeneration: null,
    stockpile: createEmptyStockpile(),
    economicActivityTaxRate: ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT,
    parishPolicy: { ...DEFAULT_PARISH_POLICY },
    monasteryPolicy: { ...DEFAULT_MONASTERY_POLICY },
    marketState: { ...DEFAULT_REGIONAL_MARKET_STATE },
    quarries: new Map(),
    foragingNodes: new Map(),
    trees: new Map(),
    buildings: new Map(),
    farmFields: new Map(),
    pastures: new Map(),
    livestockHerds: new Map(),
    burgageZones: new Map(),
    residences: new Map(),
    backyardGardens: new Map(),
    deliveryTrips: new Map(),
    roads: null,
  };
}

export class SpacetimeGameStore {
  private connection: DbConnection | null = null;
  private readonly tableState = createEmptyTableState();
  private readonly listeners = new Set<SpacetimeGameStoreListener>();
  private roadSyncTimer: number | null = null;
  private pendingRoadSnapshot: string | null = null;
  private subscribedConnection: DbConnection | null = null;
  private readonly tableSync: GameTableSync;

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
      stockpile: { ...state.stockpile },
      economicActivityTaxRate: state.economicActivityTaxRate,
      parishPolicy: { ...state.parishPolicy },
      monasteryPolicy: { ...state.monasteryPolicy },
      marketState: { ...state.marketState },
      quarries: new Map(state.quarries),
      foragingNodes: new Map(state.foragingNodes),
      trees: new Map(state.trees),
      buildings: new Map(state.buildings),
      farmFields: new Map(state.farmFields),
      pastures: new Map(state.pastures),
      livestockHerds: new Map(state.livestockHerds),
      burgageZones: new Map(state.burgageZones),
      residences: new Map(state.residences),
      backyardGardens: new Map(state.backyardGardens),
      deliveryTrips: new Map(state.deliveryTrips),
      roads: state.roads ? structuredClone(state.roads) : null,
      simTick: state.simTick,
      worldGeneration: state.worldGeneration ? { ...state.worldGeneration } : null,
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

  private connectWithOptionalToken(token: string | undefined, isRetry: boolean): DbConnection {
    const { dbName } = getSpacetimeConfig();

    this.connection = connect(token, {
      onIdentity: (identity) => {
        this.tableState.identityHex = identity.toHexString();
        this.startSubscriptions();
        this.emit();
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

  toGameState(_registry: WorldLayoutRegistry): GameState {
    const state = this.tableState;
    const seed = state.worldGeneration?.configured
      ? state.worldGeneration.seed
      : getDraftWorldGeneration().seed;

    return {
      seed,
      tick: state.simTick,
      stockpile: { ...state.stockpile },
      quarries: new Map(state.quarries),
      foragingNodes: new Map(state.foragingNodes),
      trees: new Map(state.trees),
      buildings: new Map(state.buildings),
      farmFields: new Map(state.farmFields),
      pastures: new Map(state.pastures),
      livestockHerds: new Map(state.livestockHerds),
      burgageZones: new Map(state.burgageZones),
      residences: new Map(state.residences),
      backyardGardens: new Map(state.backyardGardens),
      deliveryTrips: new Map(state.deliveryTrips),
      nextBuildingId: inferNextBuildingId(state.buildings),
    };
  }

  placeBackyardGarden(residenceId: string, kind: BackyardGardenKind): Promise<void> {
    return spacetimeReducers.placeBackyardGarden(residenceId, kind);
  }

  demolishBackyardGarden(residenceId: string): Promise<void> {
    return spacetimeReducers.demolishBackyardGarden(residenceId);
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

  placeBuilding(kind: BuildingKind, x: number, z: number): Promise<void> {
    return spacetimeReducers.placeBuilding(kind, x, z);
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

  setFarmFieldPriority(fieldId: string, priority: number): Promise<void> {
    return spacetimeReducers.setFarmFieldPriority(fieldId, priority);
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

  demolishPasture(pastureId: string): Promise<void> {
    return spacetimeReducers.demolishPasture(pastureId);
  }

  setLivestockSpecies(buildingId: string, species: Exclude<LivestockSpecies, 'swine'>): Promise<void> {
    return spacetimeReducers.setLivestockSpecies(buildingId, species);
  }

  setEconomicActivityTaxRate(taxRate: number): Promise<void> {
    return spacetimeReducers.setEconomicActivityTaxRate(taxRate);
  }

  setChapelParishPolicy(
    autoSweepEnabled: boolean,
    cofferReserveGold: number,
    sabbathObservanceEnabled: boolean,
  ): Promise<void> {
    return spacetimeReducers.setChapelParishPolicy(
      autoSweepEnabled,
      cofferReserveGold,
      sabbathObservanceEnabled,
    );
  }

  setMonasteryPolicy(titheShare: number, feastsEnabled: boolean): Promise<void> {
    return spacetimeReducers.setMonasteryPolicy(titheShare, feastsEnabled);
  }

  setStorehousePolicy(
    buildingId: string,
    acceptsTimber: boolean,
    acceptsStone: boolean,
    acceptsFirewood: boolean,
  ): Promise<void> {
    return spacetimeReducers.setStorehousePolicy(
      buildingId,
      acceptsTimber,
      acceptsStone,
      acceptsFirewood,
    );
  }

  async assignBuildingLabor(buildingId: string, labor: number): Promise<void> {
    const clampedLabor = Math.max(0, Math.floor(labor));
    const previous = this.tableState.buildings.get(buildingId);
    if (previous) {
      this.tableState.buildings.set(buildingId, { ...previous, assignedLabor: clampedLabor });
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
        this.tableState.buildings.set(buildingId, previous);
        this.emit();
      }
      throw error;
    }
  }

  marketplaceTrade(buildingId: string, tradeId: string): Promise<void> {
    return spacetimeReducers.marketplaceTrade(buildingId, tradeId);
  }

  collectChapelCoffer(buildingId: string): Promise<void> {
    return spacetimeReducers.collectChapelCoffer(buildingId);
  }

  demolishBuilding(buildingId: string): Promise<void> {
    return spacetimeReducers.demolishBuilding(buildingId);
  }

  getAuthoritativeWorldGeneration(): AuthoritativeWorldGeneration | null {
    return this.tableState.worldGeneration;
  }

  async configureWorld(settings: WorldGenerationSettings): Promise<void> {
    const server = this.tableState.worldGeneration;
    if (server?.configured && generationMatchesServer(server, settings)) {
      return;
    }
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

  bootstrapWorld(registry: WorldLayoutRegistry, worldLayout: WorldLayout): Promise<void> {
    return spacetimeReducers.bootstrapWorld(registry, worldLayout);
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
      connection.subscriptionBuilder().subscribe('SELECT * FROM world_config');
      connection.subscriptionBuilder().subscribe('SELECT * FROM player_resources');
      connection.subscriptionBuilder().subscribe('SELECT * FROM quarry');
      connection.subscriptionBuilder().subscribe('SELECT * FROM foraging_node');
      connection.subscriptionBuilder().subscribe('SELECT * FROM tree_entity');
      connection.subscriptionBuilder().subscribe('SELECT * FROM building');
      connection.subscriptionBuilder().subscribe('SELECT * FROM farm_field');
      connection.subscriptionBuilder().subscribe('SELECT * FROM burgage_zone');
      connection.subscriptionBuilder().subscribe('SELECT * FROM residence');
      connection.subscriptionBuilder().subscribe('SELECT * FROM backyard_garden');
      connection.subscriptionBuilder().subscribe('SELECT * FROM residence_need');
      connection.subscriptionBuilder().subscribe('SELECT * FROM delivery_trip');
      connection.subscriptionBuilder().subscribe('SELECT * FROM road_network_state');
      this.tableSync.attachHandlers(connection);
      this.subscribedConnection = connection;
    }

    this.tableSync.syncAll(connection);
    this.emit();
  }

  private emit(): void {
    const snapshot = this.snapshot;
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}
