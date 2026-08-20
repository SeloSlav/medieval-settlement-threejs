/**
 * Game runtime — connects SpacetimeDB to the Three.js client.
 * All simulation runs in SpacetimeDB tick_sim; the client reads replicated tables only.
 */

import type { SpacetimeGameSnapshot, SpacetimeGameStore } from '../data/spacetimeGameStore.ts';
import type { GameState } from '../resources/types.ts';
import type { RoadNetworkSnapshot } from '../roads/RoadNetwork.ts';
import type { WorldLayout } from '../resources/WorldLayout.ts';
import type { WorldLayoutRegistry } from '../resources/WorldLayoutRegistry.ts';
import {
  assertWorldGenerationCompatible,
  WorldGenerationMismatchError,
} from '../world/worldConfigAuthority.ts';
import { applyAuthoritativeWorldGeneration } from '../world/worldGenerationContext.ts';

export type GameRuntimeCallbacks = {
  onSnapshot: (snapshot: SpacetimeGameSnapshot, gameState: GameState) => void;
  onRoadsHydrated: (roads: RoadNetworkSnapshot) => void;
  onConnectError: (error: unknown) => void;
  onBootstrapFailed?: (error: unknown) => void;
  onSessionReady?: () => void;
  getTerrainHeight?: (x: number, z: number) => number;
  getRoadSnapshot?: () => RoadNetworkSnapshot;
};

export class GameRuntime {
  readonly store: SpacetimeGameStore;
  private readonly registry: WorldLayoutRegistry;
  private readonly worldLayout: WorldLayout;
  private readonly callbacks: GameRuntimeCallbacks;
  private unsubscribe: (() => void) | null = null;
  private roadsHydrated = false;
  private roadSnapshotRef: RoadNetworkSnapshot | null = null;
  private bootstrapComplete = false;
  private bootstrapInFlight = false;
  private bootstrapBlocked = false;
  private sessionReadyEmitted = false;
  private gameplayEntryInFlight = false;
  private gameplayEntryAttempt = 0;

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
      const gameState = this.store.toGameState(this.registry, snapshot);
      this.callbacks.onSnapshot(snapshot, gameState);

      if (!snapshot.connected || !snapshot.identityHex) {
        if (this.gameplayEntryInFlight || this.sessionReadyEmitted) {
          this.gameplayEntryAttempt += 1;
          this.gameplayEntryInFlight = false;
        }
        if (!snapshot.connected && (this.sessionReadyEmitted || this.roadsHydrated)) {
          this.sessionReadyEmitted = false;
          this.roadsHydrated = false;
          this.roadSnapshotRef = null;
        }
        return;
      }

      this.requestWorldBootstrap();

      this.syncRoads(snapshot);
      this.tryEmitSessionReady();
    });
  }

  /** Re-evaluate session readiness after transport reconnects. */
  recoverSession(): void {
    const snapshot = this.store.snapshot;
    if (!snapshot.connected || !snapshot.identityHex) return;

    if (this.bootstrapComplete) {
      this.syncRoads(snapshot);
      this.tryEmitSessionReady();
      return;
    }

    this.requestWorldBootstrap();
  }

  dispose(): void {
    this.gameplayEntryAttempt += 1;
    this.gameplayEntryInFlight = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private syncRoads(snapshot: SpacetimeGameSnapshot): void {
    if (!snapshot.roads) return;
    const changed = snapshot.roads !== this.roadSnapshotRef;
    this.roadSnapshotRef = snapshot.roads;
    this.roadsHydrated = true;
    if (changed) {
      this.callbacks.onRoadsHydrated(snapshot.roads);
    }
  }

  private requestWorldBootstrap(): void {
    if (
      this.bootstrapComplete
      || this.bootstrapInFlight
      || this.bootstrapBlocked
      || !this.store.isConnected
      || !this.store.snapshot.identityHex
    ) {
      return;
    }
    this.bootstrapInFlight = true;
    void this.ensureWorldBootstrap()
      .catch((error) => {
        if (error instanceof WorldGenerationMismatchError) {
          this.bootstrapBlocked = true;
        }
        console.warn('[GameRuntime] Failed to bootstrap world entities', error);
        this.callbacks.onBootstrapFailed?.(error);
      })
      .finally(() => {
        this.bootstrapInFlight = false;
      });
  }

  private async ensureWorldBootstrap(): Promise<void> {
    await this.waitForWorldConfig();
    const local = this.worldLayout.settings;
    const server = this.store.getAuthoritativeWorldGeneration();
    assertWorldGenerationCompatible(local, server, this.store.snapshot.simTick);
    try {
      await this.store.configureWorld(local);
    } catch (error) {
      if (isWorldSetupLockError(error)) {
        const current = this.store.getAuthoritativeWorldGeneration();
        assertWorldGenerationCompatible(
          local,
          current,
          Math.max(1, this.store.snapshot.simTick),
        );
        throw new WorldGenerationMismatchError(
          'The server locked different world settings while this terrain was being prepared. '
          + 'Reload to adopt the server\'s saved map settings without resetting the settlement.',
        );
      }
      throw error;
    }
    const authoritative = this.store.getAuthoritativeWorldGeneration();
    if (authoritative?.configured) {
      applyAuthoritativeWorldGeneration(authoritative);
    }
    await this.store.bootstrapWorld(
      this.registry,
      this.worldLayout,
      this.callbacks.getTerrainHeight,
    );
    const localRoadSnapshot = this.callbacks.getRoadSnapshot?.();
    if (localRoadSnapshot) {
      // Publish the seed-aware river navigation attachment even in a roadless
      // new settlement. Later road edits retain it in the same snapshot.
      await this.store.syncRoadNetworkNow(localRoadSnapshot);
    }
    this.bootstrapComplete = true;
    this.syncRoads(this.store.snapshot);
    this.tryEmitSessionReady();
  }

  private tryEmitSessionReady(): void {
    if (
      this.sessionReadyEmitted
      || this.gameplayEntryInFlight
      || !this.bootstrapComplete
      || !this.roadsHydrated
    ) {
      return;
    }
    if (!this.store.isConnected || !this.store.snapshot.identityHex) {
      return;
    }

    const attempt = ++this.gameplayEntryAttempt;
    this.gameplayEntryInFlight = true;
    void this.store.enterWorld()
      .then(() => {
        if (
          attempt !== this.gameplayEntryAttempt
          || !this.store.isConnected
          || !this.store.snapshot.identityHex
        ) {
          return;
        }
        this.sessionReadyEmitted = true;
        this.callbacks.onSessionReady?.();
      })
      .catch((error) => {
        if (attempt !== this.gameplayEntryAttempt) return;
        console.warn('[GameRuntime] Failed to enter active gameplay session', error);
        this.callbacks.onBootstrapFailed?.(error);
      })
      .finally(() => {
        if (attempt !== this.gameplayEntryAttempt) return;
        this.gameplayEntryInFlight = false;
      });
  }

  private waitForWorldConfig(maxAttempts = 80): Promise<void> {
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

function isWorldSetupLockError(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : '';
  return message.includes('Cannot change world setup after the simulation has started.')
    || message.includes('Cannot change world generation after the simulation has started.');
}
