/**
 * Game runtime — connects SpacetimeDB store to the Three.js app loop.
 * Render tick stays in App; simulation is server-authoritative via scheduled tick_sim.
 */

import type { SpacetimeGameSnapshot, SpacetimeGameStore } from '../data/spacetimeGameStore.ts';
import { getOrCreateAnonymousToken } from '../network/identityPersistence.ts';
import type { RoadNetworkSnapshot } from '../roads/RoadNetwork.ts';
import type { GameState } from '../resources/types.ts';
import type { WorldLayoutRegistry } from '../resources/WorldLayoutRegistry.ts';
import type { TreeRegistry } from '../resources/TreeRegistry.ts';

export type GameRuntimeCallbacks = {
  onSnapshot: (snapshot: SpacetimeGameSnapshot, gameState: GameState) => void;
  onRoadsHydrated: (roads: RoadNetworkSnapshot) => void;
  onConnectError: (error: unknown) => void;
};

export class GameRuntime {
  readonly store: SpacetimeGameStore;
  private readonly registry: WorldLayoutRegistry;
  private readonly seed: number;
  private readonly callbacks: GameRuntimeCallbacks;
  private unsubscribe: (() => void) | null = null;
  private roadsHydrated = false;
  private treeRegistry: TreeRegistry | null = null;

  constructor(
    store: SpacetimeGameStore,
    registry: WorldLayoutRegistry,
    seed: number,
    callbacks: GameRuntimeCallbacks,
  ) {
    this.store = store;
    this.registry = registry;
    this.seed = seed;
    this.callbacks = callbacks;
  }

  start(): void {
    const token = getOrCreateAnonymousToken();
    try {
      this.store.connectWithToken(token);
    } catch (error) {
      this.callbacks.onConnectError(error);
      return;
    }

    this.unsubscribe = this.store.subscribe((snapshot) => {
      const gameState = this.store.toGameState(this.seed, this.registry);
      this.callbacks.onSnapshot(snapshot, gameState);

      if (!this.roadsHydrated && snapshot.connected && snapshot.roads) {
        this.roadsHydrated = true;
        this.callbacks.onRoadsHydrated(snapshot.roads);
      }
    });
  }

  setTreeRegistry(treeRegistry: TreeRegistry): void {
    this.treeRegistry = treeRegistry;
    void this.bootstrapWorldIfReady();
  }

  async bootstrapWorldIfReady(): Promise<void> {
    if (!this.store.isConnected || !this.treeRegistry) return;
    await this.store.bootstrapQuarries(this.registry);
    await this.store.bootstrapTrees(this.treeRegistry.entries.map((entry) => ({
      id: entry.id,
      layoutIndex: entry.layoutIndex,
      woodYield: entry.woodYield,
      x: entry.x,
      z: entry.z,
    })));
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
