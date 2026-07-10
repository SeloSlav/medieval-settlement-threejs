/// <reference types="vite/client" />
/**
 * SpacetimeDB game store — replicated game state from server tables.
 * Data flow: SpacetimeDB → store → App / ForestVisualSync / RoadNetwork.
 */

import type { DbConnection } from '../generated/index.ts';
import type {
  Building,
  PlayerResources,
  Quarry,
  QuarryBootstrap,
  TreeBootstrap,
  TreeEntity,
} from '../generated/types.ts';
import { connect, getConnection, isConnected } from '../network/spacetimedbClient.ts';
import type { RoadNetworkSnapshot } from '../roads/RoadNetwork.ts';
import type {
  BuildingKind,
  BuildingState,
  GameState,
  QuarryNodeState,
  ResourceStockpile,
  TreeEntityState,
  TreePhase,
} from '../resources/types.ts';
import { createEmptyStockpile, isBuildingKind, isTreePhase } from '../resources/types.ts';
import type { WorldLayoutRegistry } from '../resources/WorldLayoutRegistry.ts';

export type SpacetimeGameSnapshot = {
  connected: boolean;
  identityHex: string | null;
  stockpile: ResourceStockpile;
  quarries: Map<string, QuarryNodeState>;
  trees: Map<string, TreeEntityState>;
  buildings: Map<string, BuildingState>;
  roads: RoadNetworkSnapshot | null;
  simTick: number;
};

export type SpacetimeGameStoreListener = (snapshot: SpacetimeGameSnapshot) => void;

const EMPTY_ROAD_SNAPSHOT: RoadNetworkSnapshot = {
  nextNodeId: 1,
  nextEdgeId: 1,
  nodes: [],
  edges: [],
};

export class SpacetimeGameStore {
  private connection: DbConnection | null = null;
  private identityHex: string | null = null;
  private readonly listeners = new Set<SpacetimeGameStoreListener>();
  private stockpile: ResourceStockpile = createEmptyStockpile();
  private quarries = new Map<string, QuarryNodeState>();
  private trees = new Map<string, TreeEntityState>();
  private buildings = new Map<string, BuildingState>();
  private roads: RoadNetworkSnapshot | null = null;
  private simTick = 0;
  private bootstrappedQuarries = false;
  private bootstrappedTrees = false;
  private roadSyncTimer: number | null = null;
  private pendingRoadSnapshot: string | null = null;

  get isConnected(): boolean {
    return isConnected();
  }

  get snapshot(): SpacetimeGameSnapshot {
    return {
      connected: this.isConnected,
      identityHex: this.identityHex,
      stockpile: { ...this.stockpile },
      quarries: new Map(this.quarries),
      trees: new Map(this.trees),
      buildings: new Map(this.buildings),
      roads: this.roads ? structuredClone(this.roads) : null,
      simTick: this.simTick,
    };
  }

  subscribe(listener: SpacetimeGameStoreListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  connectWithToken(token: string): DbConnection {
    this.connection = connect(
      token,
      (identity) => {
        this.identityHex = identity.toHexString();
        this.startSubscriptions();
        this.emit();
      },
      (error) => {
        console.warn('[SpacetimeGameStore] connect error', error);
        this.emit();
      },
      () => {
        this.identityHex = null;
        this.emit();
      },
    );
    return this.connection;
  }

  toGameState(seed: number, registry: WorldLayoutRegistry): GameState {
    const quarries = new Map(this.quarries);
    for (const definition of registry.definitionList) {
      if (quarries.has(definition.id)) continue;
      quarries.set(definition.id, {
        nodeId: definition.id,
        kind: definition.kind,
        resource: definition.resource,
        remaining: definition.maxYield,
        maxYield: definition.maxYield,
      });
    }

    return {
      seed,
      tick: this.simTick,
      stockpile: { ...this.stockpile },
      quarries,
      trees: new Map(this.trees),
      buildings: new Map(this.buildings),
      nextBuildingId: inferNextBuildingId(this.buildings),
    };
  }

  async bootstrapQuarries(registry: WorldLayoutRegistry): Promise<void> {
    if (this.bootstrappedQuarries || !this.connection) return;
    const quarries: QuarryBootstrap[] = registry.definitionList.map((definition) => ({
      quarryId: definition.id,
      x: definition.x,
      z: definition.z,
      maxYield: definition.maxYield,
    }));
    await this.callReducer('bootstrapQuarries', { quarries });
    this.bootstrappedQuarries = true;
  }

  async bootstrapTrees(entries: Array<{ id: string; layoutIndex: number; woodYield: number; x: number; z: number }>): Promise<void> {
    if (this.bootstrappedTrees || !this.connection || entries.length === 0) return;
    const trees: TreeBootstrap[] = entries.map((entry) => ({
      treeId: entry.id,
      layoutIndex: entry.layoutIndex,
      woodYield: entry.woodYield,
      x: entry.x,
      z: entry.z,
    }));
    await this.callReducer('bootstrapTrees', { trees });
    this.bootstrappedTrees = true;
  }

  async placeBuilding(kind: BuildingKind, x: number, z: number): Promise<void> {
    await this.callReducer('placeBuilding', { kind, x, z });
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
    await this.callReducer('syncRoadNetwork', { snapshotJson });
  }

  private startSubscriptions(): void {
    const connection = getConnection();
    if (!connection) return;

    connection.subscriptionBuilder().subscribe('SELECT * FROM world_config');
    connection.subscriptionBuilder().subscribe('SELECT * FROM player_resources');
    connection.subscriptionBuilder().subscribe('SELECT * FROM quarry');
    connection.subscriptionBuilder().subscribe('SELECT * FROM tree_entity');
    connection.subscriptionBuilder().subscribe('SELECT * FROM building');
    connection.subscriptionBuilder().subscribe('SELECT * FROM road_network_state');

    this.syncAllFromDb(connection);
    this.attachTableHandlers(connection);
  }

  private attachTableHandlers(connection: DbConnection): void {
    const db = connection.db as {
      world_config?: TableHandle;
      player_resources?: TableHandle;
      quarry?: TableHandle;
      tree_entity?: TableHandle;
      building?: TableHandle;
      road_network_state?: TableHandle;
    };

    db.world_config?.onInsert(() => this.syncAllFromDb(connection));
    db.world_config?.onUpdate(() => this.syncAllFromDb(connection));
    db.player_resources?.onInsert(() => this.syncAllFromDb(connection));
    db.player_resources?.onUpdate(() => this.syncAllFromDb(connection));
    db.quarry?.onInsert(() => this.syncAllFromDb(connection));
    db.quarry?.onUpdate(() => this.syncAllFromDb(connection));
    db.quarry?.onDelete(() => this.syncAllFromDb(connection));
    db.tree_entity?.onInsert(() => this.syncAllFromDb(connection));
    db.tree_entity?.onUpdate(() => this.syncAllFromDb(connection));
    db.tree_entity?.onDelete(() => this.syncAllFromDb(connection));
    db.building?.onInsert(() => this.syncAllFromDb(connection));
    db.building?.onUpdate(() => this.syncAllFromDb(connection));
    db.building?.onDelete(() => this.syncAllFromDb(connection));
    db.road_network_state?.onInsert(() => this.syncAllFromDb(connection));
    db.road_network_state?.onUpdate(() => this.syncAllFromDb(connection));
    db.road_network_state?.onDelete(() => this.syncAllFromDb(connection));
  }

  private syncAllFromDb(connection: DbConnection): void {
    const db = connection.db as {
      world_config?: { iter: () => Iterable<{ simTick: bigint | number }> };
      player_resources?: { iter: () => Iterable<PlayerResources> };
      quarry?: { iter: () => Iterable<Quarry> };
      tree_entity?: { iter: () => Iterable<TreeEntity> };
      building?: { iter: () => Iterable<Building> };
      road_network_state?: { iter: () => Iterable<{ owner: { toHexString: () => string }; snapshotJson: string }> };
    };

    const worldRows = db.world_config ? [...db.world_config.iter()] : [];
    if (worldRows.length > 0) {
      this.simTick = Number(worldRows[0].simTick);
    }

    this.stockpile = createEmptyStockpile();
    if (db.player_resources && this.identityHex) {
      for (const row of db.player_resources.iter()) {
        if (row.owner.toHexString() !== this.identityHex) continue;
        this.stockpile = {
          wood: row.wood,
          stone: row.stone,
          water: row.water,
        };
        break;
      }
    }

    this.quarries = new Map();
    if (db.quarry) {
      for (const row of db.quarry.iter()) {
        this.quarries.set(row.quarryId, {
          nodeId: row.quarryId,
          kind: 'quarry',
          resource: 'stone',
          remaining: row.remaining,
          maxYield: row.maxYield,
        });
      }
    }

    this.trees = new Map();
    if (db.tree_entity) {
      for (const row of db.tree_entity.iter()) {
        const phase = normalizeTreePhase(row.phase);
        this.trees.set(row.treeId, {
          treeId: row.treeId,
          layoutIndex: Number(row.layoutIndex),
          phase,
          growthProgress: row.growthProgress,
        });
      }
    }

    this.buildings = new Map();
    if (db.building && this.identityHex) {
      for (const row of db.building.iter()) {
        if (row.owner.toHexString() !== this.identityHex) continue;
        if (!isBuildingKind(row.kind)) continue;
        this.buildings.set(`building-${row.id}`, {
          id: `building-${row.id}`,
          kind: row.kind,
          x: row.x,
          z: row.z,
          workRadius: row.workRadius,
          actionCooldown: row.actionCooldown,
        });
      }
    }

    this.roads = null;
    if (db.road_network_state && this.identityHex) {
      for (const row of db.road_network_state.iter()) {
        if (row.owner.toHexString() !== this.identityHex) continue;
        try {
          this.roads = JSON.parse(row.snapshotJson) as RoadNetworkSnapshot;
        } catch {
          this.roads = { ...EMPTY_ROAD_SNAPSHOT };
        }
        break;
      }
    }

    this.emit();
  }

  private async callReducer(name: string, args: Record<string, unknown>): Promise<void> {
    const connection = getConnection();
    if (!connection) throw new Error('Not connected to SpacetimeDB.');
    const reducers = connection.reducers as unknown as Record<string, (payload: Record<string, unknown>) => Promise<unknown>>;
    const fn = reducers[name];
    if (!fn) {
      throw new Error(`Reducer ${name} is missing from generated bindings.`);
    }
    await fn(args);
  }

  private emit(): void {
    const snapshot = this.snapshot;
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

type TableHandle = {
  onInsert: (cb: () => void) => void;
  onUpdate: (cb: () => void) => void;
  onDelete: (cb: () => void) => void;
};

function normalizeTreePhase(value: string): TreePhase {
  if (isTreePhase(value)) return value;
  return 'mature';
}

function inferNextBuildingId(buildings: Map<string, BuildingState>): number {
  let maxId = 0;
  for (const building of buildings.values()) {
    const match = /^building-(\d+)$/.exec(building.id);
    if (!match) continue;
    maxId = Math.max(maxId, Number.parseInt(match[1], 10));
  }
  return maxId + 1;
}
