import * as THREE from 'three';
import type { FireIncidentState } from '../fires/fireIncident.ts';
import type {
  BackyardGardenState,
  BuildingState,
  BurgageZoneState,
  ForagingNodeState,
  GraveyardState,
  LivestockHerdState,
  PastureState,
  ResidenceState,
} from '../resources/types.ts';
import type { CrowdViewState } from '../settlement/crowdView.ts';
import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';
import type { CombatAgentState } from '../security/combatAgents.ts';
import type { RiverLayout } from '../rivers/RiverLayout.ts';
import type {
  EnvironmentState,
  Season,
  WeatherKind,
} from '../world/seasonPolicy.ts';
import type { SettlementSchedule } from '../world/settlementSchedule.ts';
import { AmbientAudio } from './AmbientAudio.ts';
import { AMBIENT_LAYERS } from './audioCatalog.ts';
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
import { UiInteractionAudio } from './UiInteractionAudio.ts';
import type {
  BuildingAudioKind,
  ChapelBellTier,
  FootstepEvent,
  MusicTrackId,
  ThreatAlertSoundKind,
  UiSoundId,
} from './audioCatalog.ts';
import { FireAudio } from './FireAudio.ts';
import { BuildingAudio } from './BuildingAudio.ts';
import { WorldFoleyAudio } from './WorldFoleyAudio.ts';
import {
  getAmbienceVolume,
  getMusicVolume,
  getSoundEffectsVolume,
  isForestWindEnabled,
  isGameAudioEnabled,
  isMusicEnabled,
} from './audioPreferences.ts';
import { ForestWindAudio } from './ForestWindAudio.ts';
import { forestWindTargetMix } from './forestWindRules.ts';
import { setExternalSoundtrackActive } from './audioPlaybackState.ts';
import {
  AgentSelectionAudio,
  type AgentSelectionKind,
} from './AgentSelectionAudio.ts';
import { ProductionPocketAudio } from './ProductionPocketAudio.ts';
import { buildProductionPocketTargets } from './productionPocketRules.ts';

export type AmbientAudioControllerConfig = {
  getCameraTarget: () => { x: number; z: number };
  getOrbitDistance: () => number;
  isFirstPersonActive: () => boolean;
  getForestCanopyCover: (x: number, z: number) => number;
  getBuildings: () => ReadonlyMap<string, BuildingState>;
  getBurgageZones: () => Iterable<BurgageZoneState>;
  getResidences: () => ReadonlyMap<string, ResidenceState>;
  getFireIncidents: () => Iterable<FireIncidentState>;
  getDeliveryTrips: () => Iterable<DeliveryTripState>;
  getLivestockHerds: () => Iterable<LivestockHerdState>;
  getPastures: () => ReadonlyMap<string, PastureState>;
  getBackyardGardens: () => Iterable<BackyardGardenState>;
  getForagingNodes: () => Iterable<ForagingNodeState>;
  getGraveyards: () => Iterable<GraveyardState>;
  getCombatAgents: () => Iterable<CombatAgentState>;
  camera: THREE.Camera;
  audioParent: THREE.Object3D;
  getTerrainY: (x: number, z: number) => number;
  riverLayout: RiverLayout;
  getRiverWaterSurfaceY: (x: number, z: number) => number;
  unlockElement: HTMLElement;
  interactionRoot: HTMLElement;
  gameplayMusicInitiallyActive?: boolean;
};

export class AmbientAudioController {
  private readonly audio = new AmbientAudio();
  private readonly spatialListener: THREE.AudioListener;
  private readonly forestWind = new ForestWindAudio();
  private readonly chapelBell = new ChapelBellPlayer();
  private readonly riverAudio: RiverAudio;
  private readonly productionPocketAudio: ProductionPocketAudio;
  private readonly soundtrack = new SoundtrackAudio();
  private readonly uiAudio = new UiAudio();
  private readonly uiInteractionAudio: UiInteractionAudio;
  private readonly agentSelectionAudio = new AgentSelectionAudio();
  private readonly fireAudio: FireAudio;
  private readonly buildingAudio = new BuildingAudio();
  private readonly worldFoley = new WorldFoleyAudio();
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
  private readonly ambientRuleState: AmbientRuleState = {
    overviewActive: false,
    foundersCampActive: false,
    villageActive: false,
    townInteriorActive: false,
  };
  private readonly buildingAudioView: CrowdViewState = {
    centerX: 0,
    centerZ: 0,
    viewRadius: 120,
    orbitDistance: 240,
  };
  private lastAmbientEvalAtMs = 0;
  private lastSettlementSignature = '';
  private settlementZones: ReturnType<typeof buildSettlementZones> = [];
  private schedule: SettlementSchedule | null = null;
  private presentationIsNight: boolean | null = null;
  private isRaining = false;
  private season: Season = 'summer';
  private weather: WeatherKind = 'fair';
  private enabled = true;
  private forestWindEnabled = false;
  private musicEnabled = true;
  private gameplayMusicActive = true;
  private externalScoreActive = false;
  private worldPaused = false;
  private running = false;
  private unlocked = false;
  private readonly onUnlock = (): void => {
    if (this.unlocked) return;
    this.unlocked = true;
    this.start();
  };

  constructor(config: AmbientAudioControllerConfig) {
    this.config = config;
    this.uiInteractionAudio = new UiInteractionAudio(
      config.interactionRoot,
      this.uiAudio,
    );
    this.spatialListener = new THREE.AudioListener();
    config.camera.add(this.spatialListener);
    this.riverAudio = new RiverAudio({
      camera: config.camera,
      parent: config.audioParent,
      listener: this.spatialListener,
      riverLayout: config.riverLayout,
      getWaterSurfaceY: config.getRiverWaterSurfaceY,
    });
    this.productionPocketAudio = new ProductionPocketAudio({
      listener: this.spatialListener,
      parent: config.audioParent,
      getGroundY: config.getTerrainY,
    });
    this.fireAudio = new FireAudio({
      getListener: config.getCameraTarget,
      getOrbitDistance: config.getOrbitDistance,
      getFireIncidents: config.getFireIncidents,
    });
    config.unlockElement.addEventListener('pointerdown', this.onUnlock, { capture: true });
    window.addEventListener('keydown', this.onUnlock, { capture: true });
    this.musicEnabled = isMusicEnabled();
    this.gameplayMusicActive = config.gameplayMusicInitiallyActive ?? true;
    this.forestWindEnabled = isForestWindEnabled();
    this.audio.setVolume(getAmbienceVolume());
    this.forestWind.setVolume(getAmbienceVolume());
    this.riverAudio.setVolume(getAmbienceVolume());
    this.productionPocketAudio.setVolume(getAmbienceVolume());
    this.setSoundEffectsVolume(getSoundEffectsVolume());
    this.soundtrack.setVolume(getMusicVolume());
    this.setEnabled(isGameAudioEnabled());
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastAmbientEvalAtMs = 0;
    this.riverAudio.start();
    this.productionPocketAudio.start();
    this.soundtrack.start();
  }

  syncSettlementSchedule(
    schedule: SettlementSchedule | null,
    presentationIsNight?: boolean,
  ): void {
    this.schedule = schedule;
    this.presentationIsNight = schedule
      ? presentationIsNight ?? schedule.dayNight.isNight
      : null;
  }

  syncEnvironment(
    environment: Pick<EnvironmentState, 'season' | 'weather'> | null,
  ): void {
    this.isRaining = environment?.weather === 'rain';
    this.season = environment?.season ?? 'summer';
    this.weather = environment?.weather ?? 'fair';
  }

  tick(dtSeconds: number): void {
    if (!this.running || !this.audio.getEnabled()) return;
    this.soundtrack.tick(dtSeconds);
    if (this.worldPaused) return;

    const schedule = this.schedule;
    const buildingSnapshot = this.config.getBuildings();
    const residenceSnapshot = this.config.getResidences();
    if (schedule) {
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
      const listener = this.config.getCameraTarget();
      const orbitDistance = this.config.getOrbitDistance();
      const ambient = evaluateAmbientRules({
        settlementZones: this.settlementZones,
        cameraTarget: listener,
        orbitDistance,
        previous: this.ambientRuleState,
        isNight: this.presentationIsNight ?? false,
      });
      this.ambientRuleState.overviewActive = ambient.state.overviewActive;
      this.ambientRuleState.foundersCampActive = ambient.state.foundersCampActive;
      this.ambientRuleState.villageActive = ambient.state.villageActive;
      this.ambientRuleState.townInteriorActive = ambient.state.townInteriorActive;
      this.audio.setAmbientMix({
        baseLayer: ambient.baseLayer,
        overlayLayer: ambient.overlayLayer,
        overlayVolume: ambient.overlayLayer
          ? (AMBIENT_LAYERS[ambient.overlayLayer].volume ?? 1) * ambient.overlayMix
          : 0,
        detailLayer: ambient.detailLayer,
        detailVolume: ambient.detailLayer
          ? (AMBIENT_LAYERS[ambient.detailLayer].volume ?? 1) * ambient.detailMix
          : 0,
        weatherLayer: selectAmbientWeatherLayer(
          this.isRaining,
          ambient.state.overviewActive,
        ),
      });
      this.productionPocketAudio.setTargets(buildProductionPocketTargets({
        buildings: buildingSnapshot.values(),
        listener,
        orbitDistance,
        isNight: this.presentationIsNight ?? false,
        laborPaused: schedule?.laborPaused ?? false,
      }));
      this.forestWind.setTargetMix(forestWindTargetMix({
        canopyCover: this.config.getForestCanopyCover(listener.x, listener.z),
        orbitDistance,
        firstPersonActive: this.config.isFirstPersonActive(),
      }));
      this.soundtrack.syncContext({
        isNight: this.presentationIsNight ?? false,
        season: this.season,
        villageActive: ambient.state.villageActive,
      });
    }
    const scoreActive = this.soundtrack.isAudible() || this.externalScoreActive;
    this.audio.setScoreActive(scoreActive);
    this.forestWind.setScoreActive(scoreActive);
    this.productionPocketAudio.setScoreActive(scoreActive);
    this.audio.tick(dtSeconds);
    this.forestWind.tick(dtSeconds);
    this.riverAudio.tick(dtSeconds);
    this.productionPocketAudio.tick(dtSeconds);
    this.fireAudio.tick(dtSeconds);
    const listener = this.config.getCameraTarget();
    this.buildingAudioView.centerX = listener.x;
    this.buildingAudioView.centerZ = listener.z;
    this.buildingAudioView.listenerX = listener.x;
    this.buildingAudioView.listenerZ = listener.z;
    this.buildingAudioView.orbitDistance = this.config.getOrbitDistance();
    this.buildingAudio.tick(dtSeconds);
    this.worldFoley.tick(dtSeconds, {
      view: this.buildingAudioView,
      buildings: buildingSnapshot,
      residences: residenceSnapshot,
      deliveryTrips: this.config.getDeliveryTrips(),
      fireIncidents: this.config.getFireIncidents(),
      livestockHerds: this.config.getLivestockHerds(),
      pastures: this.config.getPastures(),
      backyardGardens: this.config.getBackyardGardens(),
      foragingNodes: this.config.getForagingNodes(),
      graveyards: this.config.getGraveyards(),
      combatAgents: this.config.getCombatAgents(),
      season: this.season,
      weather: this.weather,
    });
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.audio.setEnabled(enabled);
    this.forestWind.setEnabled(enabled && this.forestWindEnabled);
    this.riverAudio.setEnabled(enabled);
    this.productionPocketAudio.setEnabled(enabled);
    this.fireAudio.setEnabled(enabled);
    this.buildingAudio.setEnabled(enabled);
    this.worldFoley.setEnabled(enabled);
    this.soundtrack.setEnabled(
      enabled && this.musicEnabled && this.gameplayMusicActive,
    );
    this.uiAudio.setEnabled(enabled);
    if (enabled) this.uiInteractionAudio.preload();
    this.agentSelectionAudio.setEnabled(enabled);
    if (!enabled) {
      this.running = false;
      this.chapelBell.stop();
    } else if (this.unlocked) {
      this.start();
    }
  }

  setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = enabled;
    this.soundtrack.setEnabled(
      this.enabled && enabled && this.gameplayMusicActive,
    );
  }

  setGameplayMusicActive(active: boolean): void {
    this.gameplayMusicActive = active;
    this.soundtrack.setEnabled(
      this.enabled && this.musicEnabled && active,
    );
  }

  setExternalScoreActive(active: boolean): void {
    this.externalScoreActive = active;
    setExternalSoundtrackActive(active);
  }

  markMusicTrackPlayed(track: MusicTrackId): void {
    this.soundtrack.markTrackPlayed(track);
  }

  setForestWindEnabled(enabled: boolean): void {
    this.forestWindEnabled = enabled;
    this.forestWind.setEnabled(this.enabled && enabled);
  }

  setWorldPaused(paused: boolean): void {
    if (this.worldPaused === paused) return;
    this.worldPaused = paused;
    this.audio.setPaused(paused);
    this.forestWind.setPaused(paused);
    this.riverAudio.setPaused(paused);
    this.productionPocketAudio.setPaused(paused);
    this.fireAudio.setPaused(paused);
  }

  setMusicVolume(volume: number): void {
    this.soundtrack.setVolume(volume);
  }

  setAmbienceVolume(volume: number): void {
    this.audio.setVolume(volume);
    this.forestWind.setVolume(volume);
    this.riverAudio.setVolume(volume);
    this.productionPocketAudio.setVolume(volume);
  }

  setSoundEffectsVolume(volume: number): void {
    this.buildingAudio.setVolume(volume);
    this.worldFoley.setVolume(volume);
    this.fireAudio.setVolume(volume);
    this.chapelBell.setVolume(volume);
    this.uiAudio.setVolume(volume);
    this.agentSelectionAudio.setVolume(volume);
  }

  playUiSound(id: UiSoundId): void {
    this.uiAudio.play(id);
  }

  playAgentSelection(kind: AgentSelectionKind): void {
    this.agentSelectionAudio.play(kind);
  }

  playFootstep(event: FootstepEvent): void {
    this.worldFoley.playFootstep(event);
  }

  playThreatAlert(kind: ThreatAlertSoundKind): void {
    this.worldFoley.playThreatAlert(kind);
  }

  playBuildingSelection(
    kind: BuildingAudioKind,
    sourceId: string,
  ): void {
    this.buildingAudio.play(kind, sourceId);
  }

  playChapelSelection(tier: ChapelBellTier, sourceId: string): void {
    this.buildingAudio.playChapel(tier, sourceId);
  }

  dispose(): void {
    this.setExternalScoreActive(false);
    this.uiInteractionAudio.dispose();
    this.config.unlockElement.removeEventListener('pointerdown', this.onUnlock, { capture: true });
    window.removeEventListener('keydown', this.onUnlock, { capture: true });
    this.audio.dispose();
    this.forestWind.dispose();
    this.chapelBell.dispose();
    this.riverAudio.dispose();
    this.productionPocketAudio.dispose();
    this.spatialListener.removeFromParent();
    this.fireAudio.dispose();
    this.buildingAudio.dispose();
    this.worldFoley.dispose();
    this.soundtrack.dispose();
    this.uiAudio.dispose();
    this.agentSelectionAudio.dispose();
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
        chapel = {
          x: building.x,
          z: building.z,
          tier: building.chapelTier ?? 3,
        };
        chapels.push(chapel);
      } else {
        chapel.x = building.x;
        chapel.z = building.z;
        chapel.tier = building.chapelTier ?? 3;
      }
      chapelCount += 1;
    }
  }
  chapels.length = chapelCount;
}

function settlementSignature(buildings: BuildingState[], burgageZones: BurgageZoneState[]): string {
  const buildingPart = buildings
    .map((building) => (
      `${building.kind}:${building.x.toFixed(2)}:${building.z.toFixed(2)}`
      + `:${building.workRadius}:${building.constructionComplete === false ? 0 : 1}`
    ))
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
