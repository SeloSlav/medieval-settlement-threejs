import type {
  BackyardGardenState,
  BuildingState,
  ForagingNodeState,
  GraveyardState,
  LivestockHerdState,
  PastureState,
  ResidenceState,
} from '../resources/types.ts';
import type { CrowdViewState } from '../settlement/crowdView.ts';
import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';
import { isRegionalMarketTrip } from '../logistics/deliveryTrips.ts';
import type { FireIncidentState } from '../fires/fireIncident.ts';
import type { CombatAgentState } from '../security/combatAgents.ts';
import type { Season, WeatherKind } from '../world/seasonPolicy.ts';
import {
  WORLD_FOLEY_CLIPS,
  type FootstepEvent,
  type FootstepSurface,
  type ThreatAlertSoundKind,
  type WorldNotificationSoundId,
  type WorldFoleySoundId,
} from './audioCatalog.ts';
import {
  buildFootstepVariantBag,
  resolveFootstepPlaybackTuning,
  type FootstepVariant,
} from './footstepPlayback.ts';

export const WORLD_FOLEY_MAX_ZOOM_DISTANCE = 50;
export const WORLD_FOLEY_FULL_VOLUME_DISTANCE = 10;
export const WORLD_FOLEY_CUTOFF_DISTANCE = 40;
export const WORLD_FOLEY_TAIL_SECONDS = 0.35;

const WORLD_FOLEY_POOL_SIZE = 8;
const WORLD_FOLEY_SAMPLE_INTERVAL_SECONDS = 0.1;
const CART_GLOBAL_INTERVAL_SECONDS = 1.2;
const ANIMAL_GLOBAL_INTERVAL_SECONDS = 4;
const STONE_STRUCTURE_KINDS = new Set<BuildingState['kind']>([
  'stone_quarry',
  'large_quarry',
  'mine',
  'well',
  'chapel',
  'monastery',
  'town_hall',
  'palisaded_refuge',
]);

type PoolEntry = {
  audio: HTMLAudioElement;
  baseGain: number;
};

type LocalPlaybackOptions = {
  playbackRate?: number;
  preservePitch?: boolean;
};

type StructureSnapshot = {
  complete: boolean;
  stone: boolean;
  x: number;
  z: number;
};

type ResidenceSnapshot = {
  tier: number;
  x: number;
  z: number;
};

type FireSnapshot = {
  status: FireIncidentState['status'];
  waterDelivered: number;
};

type AnimalCandidate = {
  id: string;
  kind: 'cattle' | 'sheep' | 'swine' | 'chicken' | 'deer' | 'horse';
  x: number;
  z: number;
};

export type WorldFoleyTick = {
  view: CrowdViewState;
  buildings: ReadonlyMap<string, BuildingState>;
  residences: ReadonlyMap<string, ResidenceState>;
  deliveryTrips: Iterable<DeliveryTripState>;
  fireIncidents: Iterable<FireIncidentState>;
  livestockHerds: Iterable<LivestockHerdState>;
  pastures: ReadonlyMap<string, PastureState>;
  backyardGardens: Iterable<BackyardGardenState>;
  foragingNodes: Iterable<ForagingNodeState>;
  graveyards: Iterable<GraveyardState>;
  combatAgents: Iterable<CombatAgentState>;
  season: Season;
  weather: WeatherKind;
};

export function worldFoleyGain(
  x: number,
  z: number,
  view: CrowdViewState | undefined,
): number {
  if (
    !view
    || view.orbitDistance == null
    || view.orbitDistance > WORLD_FOLEY_MAX_ZOOM_DISTANCE
  ) {
    return 0;
  }
  const listenerX = view.listenerX ?? view.centerX;
  const listenerZ = view.listenerZ ?? view.centerZ;
  const distance = Math.hypot(x - listenerX, z - listenerZ);
  if (distance <= WORLD_FOLEY_FULL_VOLUME_DISTANCE) return 1;
  if (distance >= WORLD_FOLEY_CUTOFF_DISTANCE) return 0;
  return 1 - (
    distance - WORLD_FOLEY_FULL_VOLUME_DISTANCE
  ) / (
    WORLD_FOLEY_CUTOFF_DISTANCE - WORLD_FOLEY_FULL_VOLUME_DISTANCE
  );
}

export function worldFoleyTailGain(remainingSeconds: number): number {
  const normalized = Math.min(
    1,
    Math.max(0, remainingSeconds / WORLD_FOLEY_TAIL_SECONDS),
  );
  return normalized * normalized * (3 - 2 * normalized);
}

/**
 * One bounded pool for event-driven world details. State transitions produce
 * authored one-shots, while carts, animals, and weather use sparse schedules.
 */
export class WorldFoleyAudio {
  private readonly pool: PoolEntry[] = [];
  private readonly buildingSnapshots = new Map<string, StructureSnapshot>();
  private readonly residenceSnapshots = new Map<string, ResidenceSnapshot>();
  private readonly fireSnapshots = new Map<string, FireSnapshot>();
  private readonly fireSequences = new Map<string, number>();
  private readonly tripPhases = new Map<string, DeliveryTripState['phase']>();
  private readonly cartNextAt = new Map<string, number>();
  private readonly cartSequences = new Map<string, number>();
  private readonly animalNextAt = new Map<string, number>();
  private readonly animalSequences = new Map<string, number>();
  private readonly graveyardBurials = new Map<string, number>();
  private readonly footstepSequences: Record<FootstepSurface, number> = {
    grass: 0,
    forest: 0,
    dirt: 0,
    timber: 0,
    stone: 0,
    water: 0,
  };
  private readonly lastFootstepVariants: Record<FootstepSurface, number> = {
    grass: 0,
    forest: 0,
    dirt: 0,
    timber: 0,
    stone: 0,
    water: 0,
  };
  private readonly footstepVariantBags: Record<FootstepSurface, FootstepVariant[]> = {
    grass: [],
    forest: [],
    dirt: [],
    timber: [],
    stone: [],
    water: [],
  };
  private view: CrowdViewState | null = null;
  private elapsedSeconds = 0;
  private sampleAccumulatorSeconds = WORLD_FOLEY_SAMPLE_INTERVAL_SECONDS;
  private lastCartPlayAt = Number.NEGATIVE_INFINITY;
  private lastAnimalPlayAt = Number.NEGATIVE_INFINITY;
  private nextWinterAt = 4;
  private nextAutumnAt = 5;
  private nextRoofRainAt = 3;
  private initializedStructures = false;
  private initializedFires = false;
  private initializedTrips = false;
  private initializedBurials = false;
  private enabled = true;
  private volume = 1;

  tick(dtSeconds: number, input: WorldFoleyTick): void {
    const dt = Math.max(0, dtSeconds);
    this.elapsedSeconds += dt;
    this.view = input.view;
    this.updateTailEnvelopes();
    if (!this.enabled) return;

    this.sampleAccumulatorSeconds += dt;
    if (this.sampleAccumulatorSeconds < WORLD_FOLEY_SAMPLE_INTERVAL_SECONDS) return;
    this.sampleAccumulatorSeconds %= WORLD_FOLEY_SAMPLE_INTERVAL_SECONDS;

    const deliveryTrips = [...input.deliveryTrips];
    this.syncStructures(input.buildings, input.residences);
    this.syncFires(input.fireIncidents, input.buildings, input.residences);
    this.syncTrips(deliveryTrips);
    this.syncBurials(input.graveyards);

    if ((input.view.orbitDistance ?? 240) > WORLD_FOLEY_MAX_ZOOM_DISTANCE) return;
    this.playScheduledCart(deliveryTrips);
    this.playScheduledAnimal(input);
    this.playScheduledSeason(input.season, input.weather, input.buildings);
  }

  playFootstep(event: FootstepEvent): void {
    if (!this.enabled) return;
    const sequence = this.footstepSequences[event.surface];
    this.footstepSequences[event.surface] = sequence + 1;
    const bag = this.footstepVariantBags[event.surface];
    if (bag.length === 0) {
      bag.push(...buildFootstepVariantBag(
        event.surface,
        Math.floor(sequence / 3),
        this.lastFootstepVariants[event.surface],
      ));
    }
    const variant = bag.shift() ?? 1;
    this.lastFootstepVariants[event.surface] = variant;
    const tuning = resolveFootstepPlaybackTuning(event, sequence);
    this.playLocal(
      `footstep_${event.surface}_${variant}` as WorldFoleySoundId,
      tuning.gain,
      { playbackRate: tuning.playbackRate, preservePitch: false },
    );
  }

  playThreatAlert(kind: ThreatAlertSoundKind): void {
    const sounds: Record<ThreatAlertSoundKind, WorldFoleySoundId> = {
      'wildlife-town-entry': 'event_wildlife_town_entry',
      'bandit-camp-established': 'event_bandit_camp_established',
      'bandit-town-entry': 'event_bandits_town_entry',
      'ottoman-map-entry': 'event_ottoman_raiders_detected',
    };
    const sound = sounds[kind];
    this.playLocal(sound, 1, { playbackRate: 1, preservePitch: true });
  }

  playNotification(id: WorldNotificationSoundId): void {
    this.playLocal(id, 1, { playbackRate: 1, preservePitch: true });
  }

  playParcelRemoval(x: number, z: number): void {
    const spatialGain = worldFoleyGain(x, z, this.view ?? undefined);
    this.playLocal('parcel_remove', spatialGain > 0 ? spatialGain : 0.55);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stopAll();
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    this.updateTailEnvelopes();
  }

  dispose(): void {
    this.stopAll();
    for (const entry of this.pool) entry.audio.removeAttribute('src');
    this.pool.length = 0;
    this.buildingSnapshots.clear();
    this.residenceSnapshots.clear();
    this.fireSnapshots.clear();
    this.fireSequences.clear();
    this.tripPhases.clear();
    this.cartNextAt.clear();
    this.cartSequences.clear();
    this.animalNextAt.clear();
    this.animalSequences.clear();
    this.graveyardBurials.clear();
    this.view = null;
  }

  private syncStructures(
    buildings: ReadonlyMap<string, BuildingState>,
    residences: ReadonlyMap<string, ResidenceState>,
  ): void {
    if (!this.initializedStructures) {
      for (const building of buildings.values()) {
        this.buildingSnapshots.set(building.id, structureSnapshot(building));
      }
      for (const residence of residences.values()) {
        this.residenceSnapshots.set(residence.id, residenceSnapshot(residence));
      }
      this.initializedStructures = true;
      return;
    }

    const removedBuildings: StructureSnapshot[] = [];
    for (const [id, prior] of this.buildingSnapshots) {
      if (!buildings.has(id)) removedBuildings.push(prior);
    }
    const removedResidences: ResidenceSnapshot[] = [];
    for (const [id, prior] of this.residenceSnapshots) {
      if (!residences.has(id)) removedResidences.push(prior);
    }
    const removalCount = removedBuildings.length + removedResidences.length;
    if (removalCount > 0 && removalCount <= 8) {
      for (const prior of removedBuildings) {
        this.playAt(
          prior.stone ? 'demolition_stone' : 'demolition_timber',
          prior.x,
          prior.z,
        );
      }
      for (const prior of removedResidences) {
        this.playAt(
          prior.tier >= 2 ? 'demolition_stone' : 'demolition_timber',
          prior.x,
          prior.z,
        );
      }
    }

    for (const building of buildings.values()) {
      const next = structureSnapshot(building);
      const prior = this.buildingSnapshots.get(building.id);
      if (prior && !prior.complete && next.complete) {
        this.playNotification('event_building_complete');
      }
      this.buildingSnapshots.set(building.id, next);
    }
    for (const id of this.buildingSnapshots.keys()) {
      if (!buildings.has(id)) this.buildingSnapshots.delete(id);
    }

    for (const residence of residences.values()) {
      const next = residenceSnapshot(residence);
      const prior = this.residenceSnapshots.get(residence.id);
      if (prior && prior.tier === 0 && next.tier > 0) {
        this.playNotification('event_building_complete');
      } else if (prior && next.tier > prior.tier) {
        this.playAt('event_residence_upgrade', next.x, next.z);
      }
      this.residenceSnapshots.set(residence.id, next);
    }
    for (const id of this.residenceSnapshots.keys()) {
      if (!residences.has(id)) this.residenceSnapshots.delete(id);
    }
  }

  private syncFires(
    incidents: Iterable<FireIncidentState>,
    buildings: ReadonlyMap<string, BuildingState>,
    residences: ReadonlyMap<string, ResidenceState>,
  ): void {
    const activeIds = new Set<string>();
    let fireAlarmNeeded = false;
    for (const incident of incidents) {
      activeIds.add(incident.id);
      const prior = this.fireSnapshots.get(incident.id);
      if (this.initializedFires) {
        if (!prior && incident.status === 'burning') {
          this.playAt('fire_ignite', incident.x, incident.z);
          fireAlarmNeeded = true;
        } else if (prior) {
          if (incident.waterDelivered > prior.waterDelivered + 1e-6) {
            const sequence = this.fireSequences.get(incident.id) ?? 0;
            const sound: WorldFoleySoundId = sequence % 3 === 2
              ? 'fire_steam'
              : sequence % 2 === 0 ? 'fire_bucket_1' : 'fire_bucket_2';
            this.playAt(sound, incident.x, incident.z);
            this.fireSequences.set(incident.id, sequence + 1);
          }
          if (prior.status === 'burning' && incident.status === 'extinguished') {
            this.playAt('fire_extinguish', incident.x, incident.z);
          } else if (prior.status === 'burning' && incident.status === 'destroyed') {
            const target = incident.targetKind === 'building'
              ? buildings.get(incident.targetId)
              : residences.get(incident.targetId);
            const stone = target && 'kind' in target
              ? structureSnapshot(target).stone
              : (target?.tier ?? 0) >= 2;
            this.playAt(
              stone ? 'demolition_stone' : 'demolition_timber',
              incident.x,
              incident.z,
            );
          }
        }
      }
      this.fireSnapshots.set(incident.id, {
        status: incident.status,
        waterDelivered: incident.waterDelivered,
      });
    }
    if (fireAlarmNeeded) this.playNotification('event_fire_alarm');
    for (const id of this.fireSnapshots.keys()) {
      if (!activeIds.has(id)) {
        this.fireSnapshots.delete(id);
        this.fireSequences.delete(id);
      }
    }
    this.initializedFires = true;
  }

  private syncTrips(trips: Iterable<DeliveryTripState>): void {
    const activeIds = new Set<string>();
    for (const trip of trips) {
      activeIds.add(trip.id);
      const priorPhase = this.tripPhases.get(trip.id);
      if (this.initializedTrips) {
        if (!priorPhase) {
          this.playAt('cart_load', trip.x, trip.z);
        } else if (priorPhase !== trip.phase) {
          if (trip.phase === 'unloading') {
            this.playAt('cart_unload', trip.x, trip.z);
            if (isRegionalMarketTrip(trip)) {
              this.playAt('event_trade_arrival', trip.x, trip.z);
            }
          } else if (priorPhase === 'unloading' && trip.phase === 'inbound') {
            this.playAt('cart_load', trip.x, trip.z);
          }
        }
      }
      this.tripPhases.set(trip.id, trip.phase);
      if (!this.cartNextAt.has(trip.id)) {
        this.cartNextAt.set(
          trip.id,
          this.elapsedSeconds + 0.5 + deterministicIndex(`${trip.id}:cart`, 20) / 10,
        );
      }
    }
    for (const id of this.tripPhases.keys()) {
      if (!activeIds.has(id)) {
        this.tripPhases.delete(id);
        this.cartNextAt.delete(id);
        this.cartSequences.delete(id);
      }
    }
    this.initializedTrips = true;
  }

  private playScheduledCart(trips: Iterable<DeliveryTripState>): void {
    if (this.elapsedSeconds - this.lastCartPlayAt < CART_GLOBAL_INTERVAL_SECONDS) return;
    let selected: DeliveryTripState | null = null;
    let selectedGain = 0;
    for (const trip of trips) {
      if (trip.phase === 'unloading') continue;
      if (this.elapsedSeconds < (this.cartNextAt.get(trip.id) ?? Number.POSITIVE_INFINITY)) continue;
      const gain = worldFoleyGain(trip.x, trip.z, this.view ?? undefined);
      if (gain <= selectedGain) continue;
      selected = trip;
      selectedGain = gain;
    }
    if (!selected) return;
    const sequence = this.cartSequences.get(selected.id) ?? 0;
    const sounds: readonly WorldFoleySoundId[] = [
      'cart_roll_1',
      'cart_roll_2',
      'cart_cargo_1',
      'cart_roll_1',
      'cart_roll_2',
      'cart_cargo_2',
    ];
    this.playAt(sounds[sequence % sounds.length] ?? 'cart_roll_1', selected.x, selected.z);
    this.cartSequences.set(selected.id, sequence + 1);
    this.cartNextAt.set(
      selected.id,
      this.elapsedSeconds + 2.4 + deterministicIndex(`${selected.id}:${sequence}`, 18) / 10,
    );
    this.lastCartPlayAt = this.elapsedSeconds;
  }

  private playScheduledAnimal(input: WorldFoleyTick): void {
    if (this.elapsedSeconds - this.lastAnimalPlayAt < ANIMAL_GLOBAL_INTERVAL_SECONDS) return;
    const candidates: AnimalCandidate[] = [];
    for (const herd of input.livestockHerds) {
      if (herd.headCount <= 0) continue;
      const pasture = input.pastures.get(herd.pastureId);
      if (!pasture) continue;
      const center = pasture.corners.reduce(
        (sum, point) => ({
          x: sum.x + point.x / pasture.corners.length,
          z: sum.z + point.z / pasture.corners.length,
        }),
        { x: 0, z: 0 },
      );
      candidates.push({
        id: `herd:${herd.pastureId}`,
        kind: herd.species === 'horses' ? 'horse' : herd.species,
        x: center.x,
        z: center.z,
      });
    }
    for (const garden of input.backyardGardens) {
      const kind = garden.kind === 'chicken_pen'
        ? 'chicken'
        : garden.kind === 'goat_pen'
          ? 'sheep'
          : garden.kind === 'pig_pen'
            ? 'swine'
            : null;
      if (!kind) continue;
      const residence = input.residences.get(garden.residenceId);
      if (!residence) continue;
      candidates.push({
        id: `${kind}:${garden.residenceId}`,
        kind,
        x: residence.x,
        z: residence.z,
      });
    }
    for (const node of input.foragingNodes) {
      if (node.resource !== 'game' || node.remaining <= 0) continue;
      candidates.push({
        id: `deer:${node.nodeId}`,
        kind: 'deer',
        x: node.x,
        z: node.z,
      });
    }

    let selected: AnimalCandidate | null = null;
    let selectedGain = 0;
    for (const candidate of candidates) {
      let nextAt = this.animalNextAt.get(candidate.id);
      if (nextAt == null) {
        nextAt = this.elapsedSeconds
          + 3
          + deterministicIndex(`${candidate.id}:animal`, 90) / 10;
        this.animalNextAt.set(candidate.id, nextAt);
      }
      if (this.elapsedSeconds < nextAt) continue;
      const gain = worldFoleyGain(candidate.x, candidate.z, this.view ?? undefined);
      if (gain <= selectedGain) continue;
      selected = candidate;
      selectedGain = gain;
    }
    if (!selected) return;
    const sequence = this.animalSequences.get(selected.id) ?? 0;
    this.playAt(
      `animal_${selected.kind}_${sequence % 2 + 1}` as WorldFoleySoundId,
      selected.x,
      selected.z,
    );
    this.animalSequences.set(selected.id, sequence + 1);
    this.animalNextAt.set(
      selected.id,
      this.elapsedSeconds + 16 + deterministicIndex(`${selected.id}:${sequence}`, 140) / 10,
    );
    this.lastAnimalPlayAt = this.elapsedSeconds;
  }

  private playScheduledSeason(
    season: Season,
    weather: WeatherKind,
    buildings: ReadonlyMap<string, BuildingState>,
  ): void {
    if (season === 'winter' && this.elapsedSeconds >= this.nextWinterAt) {
      this.playLocal('season_winter_gust', 1);
      this.nextWinterAt = this.elapsedSeconds + 12
        + deterministicIndex(`winter:${Math.floor(this.elapsedSeconds)}`, 120) / 10;
    }
    if (season === 'autumn' && this.elapsedSeconds >= this.nextAutumnAt) {
      this.playLocal('season_autumn_leaves', 1);
      this.nextAutumnAt = this.elapsedSeconds + 10
        + deterministicIndex(`autumn:${Math.floor(this.elapsedSeconds)}`, 100) / 10;
    }
    if (weather !== 'rain' || this.elapsedSeconds < this.nextRoofRainAt) return;
    const listenerX = this.view?.listenerX ?? this.view?.centerX ?? 0;
    const listenerZ = this.view?.listenerZ ?? this.view?.centerZ ?? 0;
    let nearest: BuildingState | null = null;
    let nearestDistance = 24;
    for (const building of buildings.values()) {
      if (building.constructionComplete === false) continue;
      const distance = Math.hypot(building.x - listenerX, building.z - listenerZ);
      if (distance >= nearestDistance) continue;
      nearest = building;
      nearestDistance = distance;
    }
    if (nearest) this.playAt('season_rain_roof', nearest.x, nearest.z);
    this.nextRoofRainAt = this.elapsedSeconds + 6
      + deterministicIndex(`roof:${Math.floor(this.elapsedSeconds)}`, 70) / 10;
  }

  private syncBurials(graveyards: Iterable<GraveyardState>): void {
    const activeIds = new Set<string>();
    for (const graveyard of graveyards) {
      activeIds.add(graveyard.id);
      const prior = this.graveyardBurials.get(graveyard.id);
      if (this.initializedBurials && prior != null && graveyard.burials > prior) {
        const center = graveyardCenter(graveyard);
        this.playAt('event_burial', center.x, center.z);
      }
      this.graveyardBurials.set(graveyard.id, graveyard.burials);
    }
    for (const id of this.graveyardBurials.keys()) {
      if (!activeIds.has(id)) this.graveyardBurials.delete(id);
    }
    this.initializedBurials = true;
  }

  private playAt(id: WorldFoleySoundId, x: number, z: number): void {
    const gain = worldFoleyGain(x, z, this.view ?? undefined);
    if (gain <= 0) return;
    this.playLocal(id, gain);
  }

  private playLocal(
    id: WorldFoleySoundId,
    gain: number,
    options: LocalPlaybackOptions = {},
  ): void {
    if (!this.enabled || typeof Audio === 'undefined') return;
    while (this.pool.length < WORLD_FOLEY_POOL_SIZE) {
      const audio = new Audio();
      audio.preload = 'auto';
      this.pool.push({ audio, baseGain: 0 });
    }
    const entry = this.pool.find(({ audio }) => audio.paused) ?? this.pool[0];
    if (!entry) return;
    const clip = WORLD_FOLEY_CLIPS[id];
    entry.audio.pause();
    entry.audio.currentTime = 0;
    entry.audio.src = clip.path;
    entry.baseGain = Math.min(1, Math.max(0, (clip.volume ?? 1) * gain));
    entry.audio.volume = entry.baseGain * this.volume;
    entry.audio.preservesPitch = options.preservePitch ?? true;
    entry.audio.playbackRate = options.playbackRate ?? (
      0.985 + deterministicIndex(
        `${id}:${Math.floor(this.elapsedSeconds * 10)}`,
        5,
      ) * 0.0075
    );
    void entry.audio.play().catch(() => undefined);
  }

  private updateTailEnvelopes(): void {
    for (const entry of this.pool) {
      const { audio } = entry;
      if (audio.paused) continue;
      const remaining = Number.isFinite(audio.duration)
        ? Math.max(0, audio.duration - audio.currentTime)
        : WORLD_FOLEY_TAIL_SECONDS;
      audio.volume = Math.min(
        1,
        entry.baseGain * this.volume * worldFoleyTailGain(remaining),
      );
    }
  }

  private stopAll(): void {
    for (const { audio } of this.pool) {
      if (audio.paused) continue;
      audio.pause();
      audio.currentTime = 0;
    }
  }
}

function structureSnapshot(building: BuildingState): StructureSnapshot {
  const timber = Math.max(0, building.constructionRequiredTimber);
  const stone = Math.max(0, building.constructionRequiredStone);
  return {
    complete: building.constructionComplete !== false,
    stone: STONE_STRUCTURE_KINDS.has(building.kind)
      || stone >= Math.max(1, timber * 0.45),
    x: building.x,
    z: building.z,
  };
}

function residenceSnapshot(residence: ResidenceState): ResidenceSnapshot {
  return { tier: residence.tier, x: residence.x, z: residence.z };
}

function graveyardCenter(graveyard: GraveyardState): { x: number; z: number } {
  let x = 0;
  let z = 0;
  for (const corner of graveyard.corners) {
    x += corner.x;
    z += corner.z;
  }
  return { x: x / graveyard.corners.length, z: z / graveyard.corners.length };
}

function deterministicIndex(value: string, count: number): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % Math.max(1, count);
}
