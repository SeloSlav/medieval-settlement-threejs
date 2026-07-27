import type { SpacetimeGameSnapshot } from '../data/spacetimeGameStore.ts';
import { SIM_REALTIME_RATE } from '../generated/gameBalance.ts';
import { simElapsedSeconds } from '../world/gameCalendar.ts';
import type { AmbientAudioController } from '../audio/AmbientAudioController.ts';
import type { BuildingMarkers } from '../buildings/BuildingMarkers.ts';
import type { ResidenceMarkers } from '../residences/ResidenceMarkers.ts';
import type { VillagerRenderer } from '../settlement/VillagerRenderer.ts';
import type { GameState } from '../resources/types.ts';
import type { SceneManager } from '../scene/SceneManager.ts';
import type { SettlementHud } from '../ui/SettlementHud.ts';
import { gameClockAtElapsedSeconds } from '../world/gameCalendar.ts';
import {
  deriveSettlementScheduleFromClock,
  settlementScheduleDirtyKey,
  type SettlementSchedule,
} from '../world/settlementSchedule.ts';
import {
  applyVisualQaClock,
  type VisualQaConditions,
} from './visualQaConditions.ts';

export type SettlementPresentationTargets = {
  settlementHud: SettlementHud | null;
  sceneManager: SceneManager | null;
  buildingMarkers: BuildingMarkers | null;
  residenceMarkers: ResidenceMarkers | null;
  villagers: VillagerRenderer | null;
  ambientAudio: AmbientAudioController | null;
};

type SnapshotAnchor = {
  simTick: number;
  elapsedSeconds: number;
  receivedAtMs: number;
  gameSpeed: SpacetimeGameSnapshot['gameSpeed'];
};

function advanceSimElapsedSeconds(
  elapsedSeconds: number,
  realElapsedSeconds: number,
  gameSpeed: SpacetimeGameSnapshot['gameSpeed'],
): number {
  return elapsedSeconds
    + Math.max(0, realElapsedSeconds) * gameSpeed * SIM_REALTIME_RATE;
}

export function interpolatedSimElapsedSeconds(
  simTick: number,
  realElapsedSeconds: number,
  gameSpeed: SpacetimeGameSnapshot['gameSpeed'],
): number {
  return advanceSimElapsedSeconds(
    simElapsedSeconds(simTick),
    realElapsedSeconds,
    gameSpeed,
  );
}

export class SettlementPresentationController {
  private lastDirtyKey = '';
  private anchor: SnapshotAnchor | null = null;
  private lastSnapshot: Pick<
    SpacetimeGameSnapshot,
    'simTick' | 'parishPolicy' | 'gameSpeed'
  > | null = null;
  private lastGameState: GameState | null = null;
  private readonly now: () => number;
  private readonly visualQaConditions: VisualQaConditions | null;

  constructor(
    now: () => number = () => performance.now(),
    visualQaConditions: VisualQaConditions | null = null,
  ) {
    this.now = now;
    this.visualQaConditions = visualQaConditions;
  }

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

    const nowMs = this.now();
    const elapsedSeconds = this.anchor?.simTick === snapshot.simTick
      ? this.elapsedSecondsAt(nowMs)
      : simElapsedSeconds(snapshot.simTick);

    this.lastDirtyKey = dirtyKey;
    this.lastSnapshot = snapshot;
    this.lastGameState = gameState;
    this.anchor = {
      simTick: snapshot.simTick,
      elapsedSeconds,
      receivedAtMs: nowMs,
      gameSpeed: snapshot.gameSpeed,
    };

    const schedule = this.derivePresentationSchedule(
      elapsedSeconds,
      snapshot.parishPolicy,
      gameState,
    );
    this.applyPresentation(targets, schedule);
    return schedule;
  }

  /** Smooth dawn/dusk between authoritative snapshots at the current global speed. */
  tick(targets: SettlementPresentationTargets): void {
    if (!this.anchor || !this.lastSnapshot) return;

    const elapsedSeconds = this.elapsedSecondsAt(this.now());
    const schedule = this.derivePresentationSchedule(
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

  private elapsedSecondsAt(nowMs: number): number {
    if (!this.anchor) return 0;
    const driftSeconds = (nowMs - this.anchor.receivedAtMs) / 1000;
    return advanceSimElapsedSeconds(
      this.anchor.elapsedSeconds,
      driftSeconds,
      this.anchor.gameSpeed,
    );
  }

  private derivePresentationSchedule(
    elapsedSeconds: number,
    parishPolicy: SpacetimeGameSnapshot['parishPolicy'],
    gameState: GameState | null,
  ): SettlementSchedule {
    const clock = gameClockAtElapsedSeconds(elapsedSeconds);
    return deriveSettlementScheduleFromClock(
      this.visualQaConditions
        ? applyVisualQaClock(clock, this.visualQaConditions)
        : clock,
      parishPolicy,
      gameState,
    );
  }

  private applyPresentation(targets: SettlementPresentationTargets, schedule: SettlementSchedule): void {
    targets.settlementHud?.setSettlementClock(schedule);
    targets.sceneManager?.applyDayNight(schedule.dayNight);
    targets.buildingMarkers?.setFoundersCampfireNightLighting(
      schedule.dayNight.nightAmount,
    );
    targets.residenceMarkers?.setChimneySmokeAllowed(schedule.dayNight.smokeAllowed);
    targets.residenceMarkers?.setHouseholdLighting(
      schedule.clock,
      schedule.dayNight.eveningWindowGlow,
    );
    targets.villagers?.setSchedule(schedule.clock, schedule.laborPaused);
    targets.ambientAudio?.syncSettlementSchedule(schedule);
  }
}
