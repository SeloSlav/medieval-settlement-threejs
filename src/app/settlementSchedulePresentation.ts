import type { SpacetimeGameSnapshot } from '../data/spacetimeGameStore.ts';
import { SIM_REALTIME_RATE } from '../generated/gameBalance.ts';
import { simElapsedSeconds } from '../world/gameCalendar.ts';
import type { AmbientAudioController } from '../audio/AmbientAudioController.ts';
import type { ResidenceMarkers } from '../residences/ResidenceMarkers.ts';
import type { VillagerRenderer } from '../settlement/VillagerRenderer.ts';
import type { GameState } from '../resources/types.ts';
import type { SceneManager } from '../scene/SceneManager.ts';
import type { SettlementHud } from '../ui/SettlementHud.ts';
import {
  deriveSettlementSchedule,
  deriveInterpolatedSettlementSchedule,
  settlementScheduleDirtyKey,
  type SettlementSchedule,
} from '../world/settlementSchedule.ts';

export type SettlementPresentationTargets = {
  settlementHud: SettlementHud | null;
  sceneManager: SceneManager | null;
  residenceMarkers: ResidenceMarkers | null;
  villagers: VillagerRenderer | null;
  ambientAudio: AmbientAudioController | null;
};

type SnapshotAnchor = {
  simTick: number;
  receivedAtMs: number;
  gameSpeed: SpacetimeGameSnapshot['gameSpeed'];
};

export function interpolatedSimElapsedSeconds(
  simTick: number,
  realElapsedSeconds: number,
  gameSpeed: SpacetimeGameSnapshot['gameSpeed'],
): number {
  return simElapsedSeconds(simTick)
    + Math.max(0, realElapsedSeconds) * gameSpeed * SIM_REALTIME_RATE;
}

export class SettlementPresentationController {
  private lastDirtyKey = '';
  private anchor: SnapshotAnchor | null = null;
  private lastSnapshot: Pick<
    SpacetimeGameSnapshot,
    'simTick' | 'parishPolicy' | 'gameSpeed'
  > | null = null;
  private lastGameState: GameState | null = null;

  sync(
    targets: SettlementPresentationTargets,
    snapshot: Pick<SpacetimeGameSnapshot, 'simTick' | 'parishPolicy' | 'gameSpeed'>,
    gameState: GameState | null,
    connected: boolean,
  ): SettlementSchedule | null {
    if (!connected) {
      this.reset();
      targets.ambientAudio?.syncSettlementSchedule(null);
      return null;
    }

    const dirtyKey = `${settlementScheduleDirtyKey(snapshot, gameState)}|${snapshot.gameSpeed}`;
    if (dirtyKey === this.lastDirtyKey) {
      return null;
    }

    this.lastDirtyKey = dirtyKey;
    this.lastSnapshot = snapshot;
    this.lastGameState = gameState;
    this.anchor = {
      simTick: snapshot.simTick,
      receivedAtMs: performance.now(),
      gameSpeed: snapshot.gameSpeed,
    };

    const schedule = deriveSettlementSchedule(snapshot, gameState);
    this.applyPresentation(targets, schedule);
    return schedule;
  }

  /** Smooth dawn/dusk between authoritative snapshots at the current global speed. */
  tick(targets: SettlementPresentationTargets): void {
    if (!this.anchor || !this.lastSnapshot) return;

    const driftSeconds = (performance.now() - this.anchor.receivedAtMs) / 1000;
    const elapsedSeconds = interpolatedSimElapsedSeconds(
      this.anchor.simTick,
      driftSeconds,
      this.anchor.gameSpeed,
    );
    const schedule = deriveInterpolatedSettlementSchedule(
      elapsedSeconds,
      this.lastSnapshot.parishPolicy,
      this.lastGameState,
    );
    this.applyPresentation(targets, schedule);
  }

  reset(): void {
    this.lastDirtyKey = '';
    this.anchor = null;
    this.lastSnapshot = null;
    this.lastGameState = null;
  }

  private applyPresentation(targets: SettlementPresentationTargets, schedule: SettlementSchedule): void {
    targets.settlementHud?.setSettlementClock(schedule);
    targets.sceneManager?.applyDayNight(schedule.dayNight);
    targets.residenceMarkers?.setChimneySmokeAllowed(schedule.dayNight.smokeAllowed);
    targets.residenceMarkers?.setHouseholdLighting(
      schedule.clock,
      schedule.dayNight.eveningWindowGlow,
    );
    targets.villagers?.setSchedule(schedule.clock, schedule.laborPaused);
    targets.ambientAudio?.syncSettlementSchedule(schedule);
  }
}
