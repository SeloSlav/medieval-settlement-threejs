/**
 * Game runtime — connects SpacetimeDB to the Three.js client.
 * All simulation runs in SpacetimeDB tick_sim; the client reads replicated tables only.
 */

import type { SpacetimeGameSnapshot, SpacetimeGameStore } from '../data/spacetimeGameStore.ts';
import type { RoadNetworkSnapshot } from '../roads/RoadNetwork.ts';
import type { GameState } from '../resources/types.ts';
import type { WorldLayoutRegistry } from '../resources/WorldLayoutRegistry.ts';

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
  private worldBootstrapped = false;

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
    try {
      this.store.connect();
    } catch (error) {
      this.callbacks.onConnectError(error);
      return;
    }

    this.unsubscribe = this.store.subscribe((snapshot) => {
      const gameState = this.store.toGameState(this.seed, this.registry);
      this.callbacks.onSnapshot(snapshot, gameState);

      if (!this.worldBootstrapped && snapshot.connected) {
        this.worldBootstrapped = true;
        void this.store.bootstrapWorld(this.registry).catch((error) => {
          console.warn('[GameRuntime] Failed to bootstrap quarries', error);
          this.worldBootstrapped = false;
        });
      }

      if (!this.roadsHydrated && snapshot.connected && snapshot.roads) {
        this.roadsHydrated = true;
        this.callbacks.onRoadsHydrated(snapshot.roads);
      }
    });
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }
}
