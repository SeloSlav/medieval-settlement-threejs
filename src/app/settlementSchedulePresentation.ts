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
import { hasActiveRaiderThreat } from '../security/combatAgents.ts';
import { computeFixedSkyState } from '../scene/fixedSkyPresentation.ts';
import {
  getSkyPresentationPreference,
  type FixedSkyPresetId,
} from '../scene/skyPresentationPreference.ts';
import type { DayNightLightingState } from '../world/dayNightPresentation.ts';

const HOUSEHOLD_LIGHTING_VISUAL_SCALE = 0.92;

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
    'simTick' | 'parishPolicy' | 'monasteryPolicy' | 'gameSpeed' | 'combatAgents'
  > | null = null;
  private lastGameState: GameState | null = null;
  private lastStaffedChapel = false;
  private lastRaidThreatActive = false;
  private tickSchedule: SettlementSchedule | null = null;
  private fixedSkyState: DayNightLightingState | null = null;
  private fixedSkyPreset: FixedSkyPresetId | null = null;
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
    snapshot: Pick<
      SpacetimeGameSnapshot,
      'simTick' | 'parishPolicy' | 'monasteryPolicy' | 'gameSpeed' | 'combatAgents'
    >,
    gameState: GameState | null,
    connected: boolean,
  ): SettlementSchedule | null {
    if (!connected) {
      this.reset();
      targets.ambientAudio?.syncSettlementSchedule(null);
      return null;
    }

    const raidThreatActive = hasActiveRaiderThreat(snapshot.combatAgents.values());
    const monasteryFeastsEnabled =
      snapshot.monasteryPolicy?.feastsEnabled ?? true;
    const dirtyKey = [
      settlementScheduleDirtyKey(snapshot, gameState),
      snapshot.gameSpeed,
      monasteryFeastsEnabled ? 'feasts-on' : 'feasts-off',
      raidThreatActive ? 'incursion' : 'all-clear',
    ].join('|');
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
      raidThreatActive,
    );
    this.lastStaffedChapel = schedule.staffedChapel;
    this.lastRaidThreatActive = raidThreatActive;
    this.applyPresentation(
      targets,
      schedule,
      monasteryFeastsEnabled,
    );
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
      this.lastRaidThreatActive,
      this.lastStaffedChapel,
      this.tickSchedule ?? undefined,
    );
    this.tickSchedule = schedule;
    const monasteryFeastsEnabled =
      this.lastSnapshot.monasteryPolicy?.feastsEnabled ?? true;
    this.applyPresentation(
      targets,
      schedule,
      monasteryFeastsEnabled,
    );
  }

  reset(): void {
    this.lastDirtyKey = '';
    this.anchor = null;
    this.lastSnapshot = null;
    this.lastGameState = null;
    this.lastStaffedChapel = false;
    this.lastRaidThreatActive = false;
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
    raidThreatActive: boolean,
    staffedChapelOverride?: boolean,
    target?: SettlementSchedule,
  ): SettlementSchedule {
    const clock = gameClockAtElapsedSeconds(
      elapsedSeconds,
      this.visualQaConditions ? undefined : target?.clock,
    );
    const schedule = deriveSettlementScheduleFromClock(
      this.visualQaConditions
        ? applyVisualQaClock(clock, this.visualQaConditions)
        : clock,
      parishPolicy,
      gameState,
      staffedChapelOverride,
      target,
    );
    if (!raidThreatActive || schedule.laborPaused) return schedule;
    if (target) {
      schedule.laborPaused = true;
      return schedule;
    }
    return { ...schedule, laborPaused: true };
  }

  private applyPresentation(
    targets: SettlementPresentationTargets,
    schedule: SettlementSchedule,
    monasteryFeastsEnabled: boolean,
  ): void {
    const presentationDayNight = this.resolveSceneLighting(schedule);
    targets.settlementHud?.setSettlementClock(schedule);
    targets.sceneManager?.applyDayNight(presentationDayNight);
    targets.buildingMarkers?.setFoundersCampfireNightLighting(
      presentationDayNight.nightAmount * HOUSEHOLD_LIGHTING_VISUAL_SCALE,
    );
    targets.residenceMarkers?.setChimneySmokeAllowed(presentationDayNight.smokeAllowed);
    targets.residenceMarkers?.setHouseholdLighting(
      schedule.clock,
      presentationDayNight.eveningWindowGlow * HOUSEHOLD_LIGHTING_VISUAL_SCALE,
    );
    targets.villagers?.setSchedule(
      schedule.clock,
      schedule.laborPaused,
      monasteryFeastsEnabled,
      schedule.clock.isSunday
        && schedule.sabbathObservance
        && schedule.staffedChapel,
      schedule.holiday,
    );
    targets.ambientAudio?.syncSettlementSchedule(
      presentationDayNight === schedule.dayNight
        ? schedule
        : { ...schedule, dayNight: presentationDayNight },
    );
  }

  private resolveSceneLighting(schedule: SettlementSchedule): DayNightLightingState {
    const preference = getSkyPresentationPreference();
    if (!preference.cycleDisabled) return schedule.dayNight;

    if (!this.fixedSkyState || this.fixedSkyPreset !== preference.preset) {
      this.fixedSkyState = computeFixedSkyState(preference.preset, this.fixedSkyState ?? undefined);
      this.fixedSkyPreset = preference.preset;
    }
    return this.fixedSkyState;
  }
}
