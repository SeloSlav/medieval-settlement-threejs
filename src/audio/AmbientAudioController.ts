import type * as THREE from 'three';
import type { FireIncidentState } from '../fires/fireIncident.ts';
import type { BuildingState, BurgageZoneState } from '../resources/types.ts';
import type { RiverLayout } from '../rivers/RiverLayout.ts';
import type { EnvironmentState, Season } from '../world/seasonPolicy.ts';
import type { SettlementSchedule } from '../world/settlementSchedule.ts';
import { AmbientAudio } from './AmbientAudio.ts';
import {
  buildSettlementZones,
  evaluateAmbientRules,
  selectAmbientWeatherLayer,
  type AmbientRuleState,
} from './ambientRules.ts';
import { ChapelBellPlayer } from './ChapelBellPlayer.ts';
import type { ChapelBellPosition, ChapelBellTick } from './ChapelBellPlayer.ts';
import { RiverAudio } from './RiverAudio.ts';
import { SoundtrackAudio } from './SoundtrackAudio.ts';
import { UiAudio } from './UiAudio.ts';
import type { UiSoundId } from './audioCatalog.ts';
import { FireAudio } from './FireAudio.ts';
import {
  getAmbienceVolume,
  getMusicVolume,
  isGameAudioEnabled,
  isMusicEnabled,
} from './audioPreferences.ts';

export type AmbientAudioControllerConfig = {
  getCameraTarget: () => { x: number; z: number };
  getOrbitDistance: () => number;
  getBuildings: () => ReadonlyMap<string, BuildingState>;
  getBurgageZones: () => Iterable<BurgageZoneState>;
  getFireIncidents: () => Iterable<FireIncidentState>;
  camera: THREE.Camera;
  audioParent: THREE.Object3D;
  riverLayout: RiverLayout;
  getRiverWaterSurfaceY: (x: number, z: number) => number;
  unlockElement: HTMLElement;
};

export class AmbientAudioController {
  private readonly audio = new AmbientAudio();
  private readonly chapelBell = new ChapelBellPlayer();
  private readonly riverAudio: RiverAudio;
  private readonly soundtrack = new SoundtrackAudio();
  private readonly uiAudio = new UiAudio();
  private readonly fireAudio: FireAudio;
  private readonly config: AmbientAudioControllerConfig;
  private readonly chapelPositions: ChapelBellPosition[] = [];
  private lastChapelBuildingSnapshot: ReadonlyMap<string, BuildingState> | null = null;
  private readonly chapelTick: ChapelBellTick = {
    dtSeconds: 0,
    clockHour: 0,
    calendarMinute: 0,
    chapels: this.chapelPositions,
    listener: { x: 0, z: 0 },
    orbitDistance: 0,
    enabled: true,
  };
  private readonly ambientRuleState: AmbientRuleState = { overviewActive: false, villageActive: false };
  private lastAmbientEvalAtMs = 0;
  private lastSettlementSignature = '';
  private settlementZones: ReturnType<typeof buildSettlementZones> = [];
  private schedule: SettlementSchedule | null = null;
  private isRaining = false;
  private season: Season = 'summer';
  private enabled = true;
  private musicEnabled = true;
  private running = false;
  private unlocked = false;
  private readonly onUnlock = (): void => {
    if (this.unlocked) return;
    this.unlocked = true;
    this.start();
  };

  constructor(config: AmbientAudioControllerConfig) {
    this.config = config;
    this.riverAudio = new RiverAudio({
      camera: config.camera,
      parent: config.audioParent,
      riverLayout: config.riverLayout,
      getWaterSurfaceY: config.getRiverWaterSurfaceY,
    });
    this.fireAudio = new FireAudio({
      getListener: config.getCameraTarget,
      getOrbitDistance: config.getOrbitDistance,
      getFireIncidents: config.getFireIncidents,
    });
    config.unlockElement.addEventListener('pointerdown', this.onUnlock, { capture: true });
    window.addEventListener('keydown', this.onUnlock, { capture: true });
    this.musicEnabled = isMusicEnabled();
    this.audio.setVolume(getAmbienceVolume());
    this.riverAudio.setVolume(getAmbienceVolume());
    this.soundtrack.setVolume(getMusicVolume());
    this.setEnabled(isGameAudioEnabled());
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastAmbientEvalAtMs = 0;
    this.riverAudio.start();
    this.soundtrack.start();
  }

  syncSettlementSchedule(schedule: SettlementSchedule | null): void {
    this.schedule = schedule;
  }

  syncEnvironment(
    environment: Pick<EnvironmentState, 'season' | 'weather'> | null,
  ): void {
    this.isRaining = environment?.weather === 'rain';
    this.season = environment?.season ?? 'summer';
  }

  tick(dtSeconds: number): void {
    if (!this.running || !this.audio.getEnabled()) return;

    const schedule = this.schedule;
    if (schedule) {
      const buildingSnapshot = this.config.getBuildings();
      if (buildingSnapshot !== this.lastChapelBuildingSnapshot) {
        syncPlacedChapels(buildingSnapshot.values(), this.chapelPositions);
        this.lastChapelBuildingSnapshot = buildingSnapshot;
      }
      this.chapelTick.dtSeconds = dtSeconds;
      this.chapelTick.clockHour = schedule.clock.hour;
      this.chapelTick.calendarMinute = schedule.clock.totalDays * 24 * 60
        + schedule.clock.hour * 60
        + schedule.clock.minute;
      this.chapelTick.listener = this.config.getCameraTarget();
      this.chapelTick.orbitDistance = this.config.getOrbitDistance();
      this.chapelBell.tick(this.chapelTick);
    }

    const nowMs = performance.now();
    if (nowMs - this.lastAmbientEvalAtMs >= 100) {
      this.lastAmbientEvalAtMs = nowMs;
      this.refreshSettlementZones();
      const ambient = evaluateAmbientRules({
        settlementZones: this.settlementZones,
        cameraTarget: this.config.getCameraTarget(),
        orbitDistance: this.config.getOrbitDistance(),
        previous: this.ambientRuleState,
        isNight: schedule?.dayNight.isNight ?? false,
      });
      this.ambientRuleState.overviewActive = ambient.state.overviewActive;
      this.ambientRuleState.villageActive = ambient.state.villageActive;
      this.audio.setAmbientMix({
        baseLayer: ambient.baseLayer,
        overlayLayer: ambient.overlayLayer,
        weatherLayer: selectAmbientWeatherLayer(
          this.isRaining,
          ambient.state.overviewActive,
        ),
      });
      this.soundtrack.syncContext({
        isNight: schedule?.dayNight.isNight ?? false,
        season: this.season,
        villageActive: ambient.state.villageActive,
      });
    }
    this.soundtrack.tick(dtSeconds);
    this.audio.setScoreActive(this.soundtrack.isAudible());
    this.audio.tick(dtSeconds);
    this.riverAudio.tick(dtSeconds);
    this.fireAudio.tick(dtSeconds);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.audio.setEnabled(enabled);
    this.riverAudio.setEnabled(enabled);
    this.fireAudio.setEnabled(enabled);
    this.soundtrack.setEnabled(enabled && this.musicEnabled);
    this.uiAudio.setEnabled(enabled);
    if (!enabled) {
      this.running = false;
      this.chapelBell.stop();
    } else if (this.unlocked) {
      this.start();
    }
  }

  setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = enabled;
    this.soundtrack.setEnabled(this.enabled && enabled);
  }

  setMusicVolume(volume: number): void {
    this.soundtrack.setVolume(volume);
  }

  setAmbienceVolume(volume: number): void {
    this.audio.setVolume(volume);
    this.riverAudio.setVolume(volume);
  }

  playUiSound(id: UiSoundId): void {
    this.uiAudio.play(id);
  }

  dispose(): void {
    this.config.unlockElement.removeEventListener('pointerdown', this.onUnlock, { capture: true });
    window.removeEventListener('keydown', this.onUnlock, { capture: true });
    this.audio.dispose();
    this.chapelBell.dispose();
    this.riverAudio.dispose();
    this.fireAudio.dispose();
    this.soundtrack.dispose();
    this.uiAudio.dispose();
    this.running = false;
    this.unlocked = false;
    this.schedule = null;
    this.lastChapelBuildingSnapshot = null;
    this.chapelPositions.length = 0;
    this.isRaining = false;
  }

  private refreshSettlementZones(): void {
    const buildings = [...this.config.getBuildings().values()];
    const burgageZones = [...this.config.getBurgageZones()];
    const signature = settlementSignature(buildings, burgageZones);
    if (signature === this.lastSettlementSignature) return;
    this.lastSettlementSignature = signature;
    this.settlementZones = buildSettlementZones(buildings, burgageZones);
  }
}

function syncPlacedChapels(
  buildings: Iterable<BuildingState>,
  chapels: ChapelBellPosition[],
): void {
  let chapelCount = 0;
  for (const building of buildings) {
    if (building.kind === 'chapel' && building.constructionComplete !== false) {
      let chapel = chapels[chapelCount];
      if (!chapel) {
        chapel = { x: building.x, z: building.z };
        chapels.push(chapel);
      } else {
        chapel.x = building.x;
        chapel.z = building.z;
      }
      chapelCount += 1;
    }
  }
  chapels.length = chapelCount;
}

function settlementSignature(buildings: BuildingState[], burgageZones: BurgageZoneState[]): string {
  const buildingPart = buildings
    .map((building) => `${building.kind}:${building.x.toFixed(2)}:${building.z.toFixed(2)}:${building.workRadius}`)
    .sort()
    .join('|');
  const zonePart = burgageZones
    .map((zone) => (
      `${zone.id}:${zone.cornerA.x.toFixed(2)},${zone.cornerA.z.toFixed(2)}`
      + `-${zone.cornerB.x.toFixed(2)},${zone.cornerB.z.toFixed(2)}`
      + `-${zone.cornerC.x.toFixed(2)},${zone.cornerC.z.toFixed(2)}`
      + `-${zone.cornerD.x.toFixed(2)},${zone.cornerD.z.toFixed(2)}`
    ))
    .sort()
    .join('|');
  return `${buildingPart}§${zonePart}`;
}
