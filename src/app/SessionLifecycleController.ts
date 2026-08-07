import type { SpacetimeGameStore } from '../data/spacetimeGameStore.ts';
import type { SessionConnectionGate } from '../network/SessionConnectionGate.ts';
import type { LoadingScreen } from '../ui/LoadingScreen.ts';
import type { SessionConnectionOverlay } from '../ui/SessionConnectionOverlay.ts';
import type { BuildToolbar } from '../ui/BuildToolbar.ts';
import type { RoadTool } from '../roads/RoadTool.ts';
import type { BuildingTool } from '../buildings/BuildingTool.ts';
import type { BurgageTool } from '../residences/BurgageTool.ts';
import type { FarmFieldTool } from '../farming/FarmFieldTool.ts';
import type { FirstPersonController } from '../camera/FirstPersonController.ts';
import {
  formatBootstrapFailure,
  formatConnectionUnavailable,
  formatWorldGenerationMismatch,
} from './connectionRecoveryHints.ts';

export type SessionLifecycleDeps = {
  sessionGate: SessionConnectionGate;
  loadingScreen: LoadingScreen | null;
  connectionOverlay: SessionConnectionOverlay;
  spacetimeStore: SpacetimeGameStore;
  toolbar: BuildToolbar | null;
  roadTool: RoadTool | null;
  buildingTool: BuildingTool | null;
  burgageTool: BurgageTool | null;
  farmFieldTool: FarmFieldTool | null;
  firstPersonController: FirstPersonController | null;
  recoverSession?: () => void;
  beginNewWorld?: () => void;
};

const DISCONNECT_OVERLAY_DELAY_MS = 4_000;

export class SessionLifecycleController {
  private reconnectTimer: number | null = null;
  private disconnectOverlayTimer: number | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private presentationReady = false;
  private readonly deps: SessionLifecycleDeps;

  constructor(deps: SessionLifecycleDeps) {
    this.deps = deps;
    this.unsubscribeStore = deps.spacetimeStore.subscribe((snapshot) => {
      this.onStoreSnapshot(snapshot.connected && snapshot.identityHex !== null);
    });
  }

  dispose(): void {
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.clearReconnectTimer();
    this.clearDisconnectOverlayTimer();
  }

  onReady(): void {
    this.deps.sessionGate.markReady();
    this.deps.loadingScreen?.clearErrorState();
    // App clears the overlay only after the fully populated forest frame is
    // ready, so connection completion cannot expose a half-built world.
    this.deps.loadingScreen?.setProgress({
      label: 'Entering world…',
      detail: 'Preparing terrain and woodland',
      phase: 'vegetation',
      fraction: 0.82,
    });
    this.deps.connectionOverlay.hide();
    this.deps.toolbar?.setGameplayEnabled(true);
    this.clearReconnectTimer();
    this.clearDisconnectOverlayTimer();
    this.dismissLoadingWhenPlayable();
  }

  onPresentationReady(): void {
    this.presentationReady = true;
    this.dismissLoadingWhenPlayable();
  }

  onBootstrapFailed(error: unknown, retry: () => void): void {
    const presentation = formatBootstrapFailure(error);
    this.deps.loadingScreen?.setErrorState(
      presentation,
      retry,
      this.newWorldRecoveryAction(presentation.showNewWorldAction),
    );
  }

  onWorldGenerationMismatch(message: string, retry: () => void): void {
    this.deps.sessionGate.markBlocked(message);
    const presentation = formatWorldGenerationMismatch(message);
    this.deps.loadingScreen?.setErrorState(
      presentation,
      retry,
      this.newWorldRecoveryAction(presentation.showNewWorldAction),
    );
  }

  onBootConnectionFailure(): void {
    if (this.deps.spacetimeStore.isConnected) {
      this.deps.recoverSession?.();
      return;
    }
    if (this.deps.sessionGate.hasEverBeenReady()) {
      this.scheduleDisconnectOverlay();
      this.scheduleReconnect();
      return;
    }
    const presentation = formatConnectionUnavailable();
    this.deps.loadingScreen?.setErrorState(
      presentation,
      () => this.retryConnection(),
    );
    this.scheduleReconnect();
  }

  private newWorldRecoveryAction(enabled: boolean) {
    if (!enabled || !this.canBeginNewWorld()) return undefined;
    return {
      label: 'Start new world…',
      handler: () => {
        this.deps.beginNewWorld?.();
      },
    };
  }

  private canBeginNewWorld(): boolean {
    const snapshot = this.deps.spacetimeStore.snapshot;
    return this.deps.spacetimeStore.isConnected && snapshot.identityHex !== null;
  }

  retryConnection(): void {
    this.deps.sessionGate.markConnecting();
    this.clearDisconnectOverlayTimer();
    this.deps.loadingScreen?.clearErrorState();
    if (this.deps.sessionGate.hasEverBeenReady()) {
      this.deps.connectionOverlay.show(
        'Reconnecting…',
        'Contacting the authoritative settlement server. Controls remain paused until it answers.',
      );
    } else {
      this.deps.loadingScreen?.setProgress({
        label: 'Connecting…',
        detail: 'Retrying SpacetimeDB connection',
        phase: 'connecting',
        fraction: 0,
      });
    }
    try {
      this.deps.spacetimeStore.connect();
    } catch (error) {
      console.warn('[SessionLifecycle] SpacetimeDB reconnect failed:', error);
    }
    this.scheduleReconnect();
  }

  private onStoreSnapshot(transportLive: boolean): void {
    if (transportLive) {
      this.clearDisconnectOverlayTimer();
      this.deps.connectionOverlay.hide();
      if (!this.deps.sessionGate.isReady()) {
        this.deps.recoverSession?.();
      }
      return;
    }

    if (!this.deps.sessionGate.hasEverBeenReady()) {
      return;
    }

    this.scheduleDisconnectOverlay();
    if (this.deps.sessionGate.isReady()) {
      this.deps.sessionGate.markDisconnected();
      this.deactivateAllTools();
      this.deps.toolbar?.setGameplayEnabled(false);
    }
    this.scheduleReconnect();
  }

  private scheduleDisconnectOverlay(): void {
    if (this.disconnectOverlayTimer !== null) return;
    this.disconnectOverlayTimer = window.setTimeout(() => {
      this.disconnectOverlayTimer = null;
      if (this.deps.spacetimeStore.isConnected) {
        this.deps.recoverSession?.();
        this.deps.connectionOverlay.hide();
        return;
      }
      this.deps.connectionOverlay.show(
        'Connection lost',
        'This client has paused its controls. Settlement state remains authoritative on the server while reconnection continues.',
        () => this.retryConnection(),
      );
    }, DISCONNECT_OVERLAY_DELAY_MS);
  }

  private dismissLoadingWhenPlayable(): void {
    if (!this.presentationReady || !this.deps.sessionGate.isReady()) return;
    this.deps.loadingScreen?.dismiss();
  }

  private clearDisconnectOverlayTimer(): void {
    if (this.disconnectOverlayTimer === null) return;
    window.clearTimeout(this.disconnectOverlayTimer);
    this.disconnectOverlayTimer = null;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null || this.deps.sessionGate.isReady()) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.deps.sessionGate.isReady()) return;
      if (this.deps.spacetimeStore.isConnected) {
        this.deps.recoverSession?.();
      } else {
        try {
          this.deps.spacetimeStore.connect();
        } catch (error) {
          console.warn('[SessionLifecycle] SpacetimeDB reconnect failed:', error);
        }
      }
      if (!this.deps.sessionGate.isReady()) {
        this.scheduleReconnect();
      }
    }, 3000);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer === null) return;
    window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private deactivateAllTools(): void {
    this.deps.roadTool?.setEnabled(false);
    this.deps.buildingTool?.setMode('off');
    this.deps.burgageTool?.setEnabled(false);
    this.deps.farmFieldTool?.setEnabled(false);
    if (this.deps.firstPersonController?.isActive()) {
      this.deps.firstPersonController.deactivate();
    }
  }
}
