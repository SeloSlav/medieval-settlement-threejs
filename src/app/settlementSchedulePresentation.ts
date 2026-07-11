import type { SpacetimeGameSnapshot } from '../data/spacetimeGameStore.ts';
import { simElapsedSeconds } from '../world/gameCalendar.ts';
import type { ResidenceMarkers } from '../residences/ResidenceMarkers.ts';
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
};

type SnapshotAnchor = {
  simTick: number;
  receivedAtMs: number;
};

export class SettlementPresentationController {
  private lastDirtyKey = '';
  private anchor: SnapshotAnchor | null = null;
  private lastSnapshot: Pick<SpacetimeGameSnapshot, 'simTick' | 'parishPolicy'> | null = null;
  private lastGameState: GameState | null = null;

  sync(
    targets: SettlementPresentationTargets,
    snapshot: Pick<SpacetimeGameSnapshot, 'simTick' | 'parishPolicy'>,
    gameState: GameState | null,
    connected: boolean,
  ): SettlementSchedule | null {
    if (!connected) {
      this.reset();
      return null;
    }

    const dirtyKey = settlementScheduleDirtyKey(snapshot, gameState);
    if (dirtyKey === this.lastDirtyKey) {
      return null;
    }

    this.lastDirtyKey = dirtyKey;
    this.lastSnapshot = snapshot;
    this.lastGameState = gameState;
    this.anchor = { simTick: snapshot.simTick, receivedAtMs: performance.now() };

    const schedule = deriveSettlementSchedule(snapshot, gameState);
    this.applyPresentation(targets, schedule);
    return schedule;
  }

  /** Smooth dawn/dusk between authoritative sim snapshots (1 real second = 1 sim second). */
  tick(targets: SettlementPresentationTargets): void {
    if (!this.anchor || !this.lastSnapshot) return;

    const driftSeconds = (performance.now() - this.anchor.receivedAtMs) / 1000;
    const elapsedSeconds = simElapsedSeconds(this.anchor.simTick) + driftSeconds;
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
    targets.residenceMarkers?.setEveningWindowGlow(schedule.dayNight.eveningWindowGlow);
  }
}
