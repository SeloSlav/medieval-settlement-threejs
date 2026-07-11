/**
 * Game runtime — connects SpacetimeDB to the Three.js client.
 * All simulation runs in SpacetimeDB tick_sim; the client reads replicated tables only.
 */

import type { SpacetimeGameSnapshot, SpacetimeGameStore } from '../data/spacetimeGameStore.ts';
import type { GameState } from '../resources/types.ts';
import type { RoadNetworkSnapshot } from '../roads/RoadNetwork.ts';
import type { WorldLayout } from '../resources/WorldLayout.ts';
import type { WorldLayoutRegistry } from '../resources/WorldLayoutRegistry.ts';
import { assertWorldGenerationCompatible } from '../world/worldConfigAuthority.ts';
import { applyAuthoritativeWorldGeneration } from '../world/worldGenerationContext.ts';

export type GameRuntimeCallbacks = {
  onSnapshot: (snapshot: SpacetimeGameSnapshot, gameState: GameState) => void;
  onRoadsHydrated: (roads: RoadNetworkSnapshot) => void;
  onConnectError: (error: unknown) => void;
};

export class GameRuntime {
  readonly store: SpacetimeGameStore;
  private readonly registry: WorldLayoutRegistry;
  private readonly worldLayout: WorldLayout;
  private readonly callbacks: GameRuntimeCallbacks;
  private unsubscribe: (() => void) | null = null;
  private roadsHydrated = false;
  private worldBootstrapped = false;

  constructor(
    store: SpacetimeGameStore,
    registry: WorldLayoutRegistry,
    worldLayout: WorldLayout,
    callbacks: GameRuntimeCallbacks,
  ) {
    this.store = store;
    this.registry = registry;
    this.worldLayout = worldLayout;
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
      const gameState = this.store.toGameState(this.registry);
      this.callbacks.onSnapshot(snapshot, gameState);

      if (!this.worldBootstrapped && snapshot.connected) {
        this.worldBootstrapped = true;
        void this.ensureWorldBootstrap(snapshot).catch((error) => {
          console.warn('[GameRuntime] Failed to bootstrap world entities', error);
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

  private async ensureWorldBootstrap(snapshot: SpacetimeGameSnapshot): Promise<void> {
    await this.waitForWorldConfig();
    const local = this.worldLayout.settings;
    const server = this.store.getAuthoritativeWorldGeneration();
    assertWorldGenerationCompatible(local, server, snapshot.simTick);
    await this.store.configureWorld(local);
    const authoritative = this.store.getAuthoritativeWorldGeneration();
    if (authoritative?.configured) {
      applyAuthoritativeWorldGeneration(authoritative);
    }
    await this.store.bootstrapWorld(this.registry, this.worldLayout);
  }

  private waitForWorldConfig(maxAttempts = 40): Promise<void> {
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const poll = (): void => {
        if (this.store.getAuthoritativeWorldGeneration() !== null) {
          resolve();
          return;
        }
        attempts += 1;
        if (attempts >= maxAttempts) {
          reject(new Error('Timed out waiting for world_config subscription.'));
          return;
        }
        window.setTimeout(poll, 50);
      };
      poll();
    });
  }
}
