import type { CrowdViewState } from '../settlement/crowdView.ts';
import type {
  BuildingState,
  ResidenceState,
} from '../resources/types.ts';
import {
  BUILDING_AUDIO_CLIPS,
  type BuildingAudioKind,
} from './audioCatalog.ts';

export const BUILDING_AUDIO_MAX_ZOOM_DISTANCE = 44;
export const BUILDING_AUDIO_FULL_VOLUME_DISTANCE = 10;
export const BUILDING_AUDIO_CUTOFF_DISTANCE = 34;
export const BUILDING_AUDIO_TAIL_SECONDS = 0.45;

const BUILDING_AUDIO_POOL_SIZE = 3;
const BUILDING_AUDIO_GLOBAL_INTERVAL_SECONDS = 2.4;
const BUILDING_AUDIO_SOURCE_INTERVAL_SECONDS = 18;
const BUILDING_AUDIO_SAMPLE_INTERVAL_SECONDS = 0.1;

type BuildingAudioSchedule = {
  kind: BuildingAudioKind;
  nextPlayAt: number;
  sequence: number;
  activeGeneration: number;
};

type BuildingAudioCandidate = {
  id: string;
  kind: BuildingAudioKind;
  gain: number;
};

type BuildingAudioPoolEntry = {
  audio: HTMLAudioElement;
  baseGain: number;
};

export function buildingAudioGain(
  x: number,
  z: number,
  view: CrowdViewState | undefined,
): number {
  if (
    !view
    || view.orbitDistance == null
    || view.orbitDistance > BUILDING_AUDIO_MAX_ZOOM_DISTANCE
  ) {
    return 0;
  }
  const listenerX = view.listenerX ?? view.centerX;
  const listenerZ = view.listenerZ ?? view.centerZ;
  const distance = Math.hypot(x - listenerX, z - listenerZ);
  if (distance <= BUILDING_AUDIO_FULL_VOLUME_DISTANCE) return 1;
  if (distance >= BUILDING_AUDIO_CUTOFF_DISTANCE) return 0;
  return 1 - (
    distance - BUILDING_AUDIO_FULL_VOLUME_DISTANCE
  ) / (
    BUILDING_AUDIO_CUTOFF_DISTANCE - BUILDING_AUDIO_FULL_VOLUME_DISTANCE
  );
}

/** Smooth gain envelope applied to the decoded cue tail, separate from generation. */
export function buildingAudioTailGain(remainingSeconds: number): number {
  const normalized = Math.min(
    1,
    Math.max(0, remainingSeconds / BUILDING_AUDIO_TAIL_SECONDS),
  );
  return normalized * normalized * (3 - 2 * normalized);
}

/**
 * Adds sparse physical character to nearby completed structures. The shared
 * pool and cadence keep a dense settlement quiet and bounded; every cue gets
 * a short playback envelope before its encoded endpoint.
 */
export class BuildingAudio {
  private readonly pool: BuildingAudioPoolEntry[] = [];
  private readonly schedules = new Map<string, BuildingAudioSchedule>();
  private readonly candidatePool: BuildingAudioCandidate[] = [];
  private readonly candidates: BuildingAudioCandidate[] = [];
  private activeGeneration = 0;
  private enabled = true;
  private volume = 1;
  private elapsedSeconds = 0;
  private sampleAccumulatorSeconds = BUILDING_AUDIO_SAMPLE_INTERVAL_SECONDS;
  private lastGlobalPlayAt = Number.NEGATIVE_INFINITY;

  tick(
    dtSeconds: number,
    buildings: Iterable<BuildingState>,
    residences: Iterable<ResidenceState>,
    view: CrowdViewState | undefined,
  ): void {
    const dt = Math.max(0, dtSeconds);
    this.elapsedSeconds += dt;
    this.updateTailEnvelopes();
    if (!this.enabled) return;

    this.sampleAccumulatorSeconds += dt;
    if (this.sampleAccumulatorSeconds < BUILDING_AUDIO_SAMPLE_INTERVAL_SECONDS) return;
    this.sampleAccumulatorSeconds %= BUILDING_AUDIO_SAMPLE_INTERVAL_SECONDS;

    const candidates = this.candidates;
    candidates.length = 0;
    if (
      !view
      || view.orbitDistance == null
      || view.orbitDistance > BUILDING_AUDIO_MAX_ZOOM_DISTANCE
    ) {
      this.stopAll();
      return;
    }

    const activeGeneration = ++this.activeGeneration;
    for (const building of buildings) {
      if (building.constructionComplete === false) continue;
      this.addCandidate(
        `building:${building.id}`,
        building.kind,
        building.x,
        building.z,
        view,
        activeGeneration,
      );
    }
    for (const residence of residences) {
      if (
        residence.tier <= 0
        || residence.abandoned
        || residence.population <= 0
      ) {
        continue;
      }
      this.addCandidate(
        `residence:${residence.id}`,
        'residence',
        residence.x,
        residence.z,
        view,
        activeGeneration,
      );
    }

    for (const [id, schedule] of this.schedules) {
      if (schedule.activeGeneration !== activeGeneration) this.schedules.delete(id);
    }
    if (candidates.length === 0) {
      this.stopAll();
      return;
    }
    candidates.sort((left, right) => (
      right.gain - left.gain
      || left.id.localeCompare(right.id)
    ));
    if (
      this.elapsedSeconds - this.lastGlobalPlayAt
      < BUILDING_AUDIO_GLOBAL_INTERVAL_SECONDS
    ) {
      return;
    }

    for (const candidate of candidates) {
      const schedule = this.schedules.get(candidate.id);
      if (!schedule || this.elapsedSeconds < schedule.nextPlayAt) continue;
      this.play(candidate, schedule);
      schedule.sequence += 1;
      schedule.nextPlayAt = this.elapsedSeconds
        + BUILDING_AUDIO_SOURCE_INTERVAL_SECONDS
        + deterministicIndex(`${candidate.id}:cadence:${schedule.sequence}`, 11);
      this.lastGlobalPlayAt = this.elapsedSeconds;
      break;
    }
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
    this.schedules.clear();
    this.candidates.length = 0;
    this.candidatePool.length = 0;
  }

  private addCandidate(
    id: string,
    kind: BuildingAudioKind,
    x: number,
    z: number,
    view: CrowdViewState,
    activeGeneration: number,
  ): void {
    const gain = buildingAudioGain(x, z, view);
    if (gain <= 0) return;
    let schedule = this.schedules.get(id);
    if (!schedule || schedule.kind !== kind) {
      schedule = {
        kind,
        nextPlayAt: this.elapsedSeconds
          + 0.8
          + deterministicIndex(`${id}:initial`, 37) / 10,
        sequence: 0,
        activeGeneration,
      };
      this.schedules.set(id, schedule);
    } else {
      schedule.activeGeneration = activeGeneration;
    }

    const candidateIndex = this.candidates.length;
    let candidate = this.candidatePool[candidateIndex];
    if (!candidate) {
      candidate = { id, kind, gain };
      this.candidatePool.push(candidate);
    } else {
      candidate.id = id;
      candidate.kind = kind;
      candidate.gain = gain;
    }
    this.candidates.push(candidate);
  }

  private play(
    candidate: BuildingAudioCandidate,
    schedule: BuildingAudioSchedule,
  ): void {
    if (typeof Audio === 'undefined') return;
    while (this.pool.length < BUILDING_AUDIO_POOL_SIZE) {
      const audio = new Audio();
      audio.preload = 'auto';
      this.pool.push({ audio, baseGain: 0 });
    }
    const entry = this.pool.find(({ audio }) => audio.paused) ?? this.pool[0];
    if (!entry) return;
    const clip = BUILDING_AUDIO_CLIPS[candidate.kind];

    entry.audio.pause();
    entry.audio.currentTime = 0;
    entry.audio.src = clip.path;
    entry.baseGain = Math.min(1, Math.max(
      0,
      (clip.volume ?? 1) * candidate.gain,
    ));
    entry.audio.volume = entry.baseGain * this.volume;
    entry.audio.playbackRate = 0.985 + deterministicIndex(
      `${candidate.id}:pitch:${schedule.sequence}`,
      5,
    ) * 0.0075;
    void entry.audio.play().catch(() => undefined);
  }

  private updateTailEnvelopes(): void {
    for (const entry of this.pool) {
      const { audio } = entry;
      if (audio.paused) continue;
      const remaining = Number.isFinite(audio.duration)
        ? Math.max(0, audio.duration - audio.currentTime)
        : BUILDING_AUDIO_TAIL_SECONDS;
      audio.volume = Math.min(
        1,
        entry.baseGain * this.volume * buildingAudioTailGain(remaining),
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

function deterministicIndex(value: string, count: number): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % Math.max(1, count);
}
