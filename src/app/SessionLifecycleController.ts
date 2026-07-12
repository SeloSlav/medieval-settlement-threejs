import type { SpacetimeGameStore } from '../data/spacetimeGameStore.ts';
import type { SessionConnectionGate } from '../network/SessionConnectionGate.ts';
import type { LoadingScreen } from '../ui/LoadingScreen.ts';
import type { SessionConnectionOverlay } from '../ui/SessionConnectionOverlay.ts';
import type { BuildToolbar } from '../ui/BuildToolbar.ts';
import type { RoadTool } from '../roads/RoadTool.ts';
import type { BuildingTool } from '../buildings/BuildingTool.ts';
import type { BurgageTool } from '../residences/BurgageTool.ts';
import type { FirstPersonController } from '../camera/FirstPersonController.ts';

export type SessionLifecycleDeps = {
  sessionGate: SessionConnectionGate;
  loadingScreen: LoadingScreen | null;
  connectionOverlay: SessionConnectionOverlay;
  spacetimeStore: SpacetimeGameStore;
  toolbar: BuildToolbar | null;
  roadTool: RoadTool | null;
  buildingTool: BuildingTool | null;
  burgageTool: BurgageTool | null;
  firstPersonController: FirstPersonController | null;
};

export class SessionLifecycleController {
  private reconnectTimer: number | null = null;
  private readonly deps: SessionLifecycleDeps;

  constructor(deps: SessionLifecycleDeps) {
    this.deps = deps;
  }

  dispose(): void {
    this.clearReconnectTimer();
  }

  onReady(): void {
    this.deps.sessionGate.markReady();
    this.deps.loadingScreen?.dismiss();
    this.deps.connectionOverlay.hide();
    this.deps.toolbar?.setGameplayEnabled(true);
    this.clearReconnectTimer();
  }

  onLost(): void {
    this.deps.sessionGate.markDisconnected();
    this.deactivateAllTools();
    this.deps.toolbar?.setGameplayEnabled(false);
    this.deps.connectionOverlay.show(
      'Connection lost',
      'Retrying SpacetimeDB connection…',
    );
    this.scheduleReconnect();
  }

  onBootConnectionFailure(): void {
    if (this.deps.sessionGate.hasEverBeenReady()) {
      if (this.deps.spacetimeStore.isConnected) {
        return;
      }
      this.onLost();
      return;
    }
    this.deps.loadingScreen?.setErrorState(
      {
        label: 'SpacetimeDB unavailable',
        detail: 'Run `spacetime start` and `npm run deploy:local`, then retry.',
      },
      () => this.retryConnection(),
    );
    this.scheduleReconnect();
  }

  onBootstrapFailed(error: unknown, retry: () => void): void {
    const message = error instanceof Error ? error.message : 'World bootstrap failed.';
    this.deps.loadingScreen?.setErrorState(
      { label: 'World bootstrap failed', detail: message },
      retry,
    );
  }

  onWorldGenerationMismatch(message: string, retry: () => void): void {
    this.deps.sessionGate.markBlocked(message);
    this.deps.loadingScreen?.setErrorState(
      { label: 'World settings mismatch', detail: message },
      retry,
    );
  }

  retryConnection(): void {
    this.deps.sessionGate.markConnecting();
    this.deps.loadingScreen?.setProgress({
      label: 'Connecting…',
      detail: 'Retrying SpacetimeDB connection',
    });
    try {
      this.deps.spacetimeStore.connect();
    } catch (error) {
      console.warn('[SessionLifecycle] SpacetimeDB reconnect failed:', error);
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null || this.deps.sessionGate.isReady()) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.deps.sessionGate.isReady()) return;
      if (!this.deps.spacetimeStore.isConnected) {
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
    if (this.deps.firstPersonController?.isActive()) {
      this.deps.firstPersonController.deactivate();
    }
  }
}
