import {
  WORKER_ACTIVITY_CLIPS,
  type WorkerActivitySoundKind,
} from './audioCatalog.ts';
import type { CrowdViewState } from '../settlement/crowdView.ts';
import { isGameAudioEnabled } from './audioPreferences.ts';

export const WORKER_SOUND_MAX_ZOOM_DISTANCE = 32;
export const WORKER_SOUND_FULL_VOLUME_DISTANCE = 12;
export const WORKER_SOUND_CUTOFF_DISTANCE = 32;

const WORKER_SOUND_POOL_SIZE = 4;
const WORKER_SOUND_GLOBAL_INTERVAL_SECONDS = 0.24;
const WORKER_SOUND_CADENCE_SECONDS: Record<WorkerActivitySoundKind, number> = {
  chop: 0.82,
  mine: 0.82,
  build: 0.82,
  cut_crop: 1.2,
  dig: 1.15,
  fish: 3,
  forage: 2,
  livestock: 4,
};

export type WorkerActivitySoundSource = {
  id: string;
  mode: WorkerActivitySoundKind;
  x: number;
  z: number;
};

type WorkerSoundSchedule = {
  mode: WorkerActivitySoundKind;
  nextPlayAt: number;
  sequence: number;
};

export function workerActivitySoundGain(
  x: number,
  z: number,
  view: CrowdViewState | undefined,
): number {
  if (
    !view
    || view.orbitDistance == null
    || view.orbitDistance > WORKER_SOUND_MAX_ZOOM_DISTANCE
  ) {
    return 0;
  }

  const listenerX = view.listenerX ?? view.centerX;
  const listenerZ = view.listenerZ ?? view.centerZ;
  const distance = Math.hypot(x - listenerX, z - listenerZ);
  if (distance <= WORKER_SOUND_FULL_VOLUME_DISTANCE) return 1;
  if (distance >= WORKER_SOUND_CUTOFF_DISTANCE) return 0;
  return 1 - (
    distance - WORKER_SOUND_FULL_VOLUME_DISTANCE
  ) / (
    WORKER_SOUND_CUTOFF_DISTANCE - WORKER_SOUND_FULL_VOLUME_DISTANCE
  );
}

/**
 * Plays short work impacts only for close, audible workers. A small
 * shared pool and global cadence prevent large crews from creating an audio
 * element per villager or producing a wall of overlapping effects.
 */
export class WorkerActivityAudio {
  private readonly pool: HTMLAudioElement[] = [];
  private readonly schedules = new Map<string, WorkerSoundSchedule>();
  private elapsedSeconds = 0;
  private lastGlobalPlayAt = Number.NEGATIVE_INFINITY;

  tick(
    dtSeconds: number,
    sources: readonly WorkerActivitySoundSource[],
    view: CrowdViewState | undefined,
  ): void {
    this.elapsedSeconds += Math.max(0, dtSeconds);
    const activeIds = new Set(sources.map((source) => source.id));
    for (const id of this.schedules.keys()) {
      if (!activeIds.has(id)) this.schedules.delete(id);
    }

    if (
      !isGameAudioEnabled()
      ||
      !view
      || view.orbitDistance == null
      || view.orbitDistance > WORKER_SOUND_MAX_ZOOM_DISTANCE
    ) {
      this.stopAll();
      return;
    }

    const candidates = sources
      .map((source) => ({
        source,
        gain: workerActivitySoundGain(source.x, source.z, view),
      }))
      .filter((candidate) => candidate.gain > 0)
      .sort((a, b) => b.gain - a.gain);

    for (const { source, gain } of candidates) {
      let schedule = this.schedules.get(source.id);
      if (!schedule || schedule.mode !== source.mode) {
        schedule = {
          mode: source.mode,
          nextPlayAt: this.elapsedSeconds + 0.16,
          sequence: 0,
        };
        this.schedules.set(source.id, schedule);
      }
      if (this.elapsedSeconds < schedule.nextPlayAt) continue;
      if (
        this.elapsedSeconds - this.lastGlobalPlayAt
        < WORKER_SOUND_GLOBAL_INTERVAL_SECONDS
      ) {
        break;
      }

      this.play(source, schedule, gain);
      schedule.sequence += 1;
      schedule.nextPlayAt = this.elapsedSeconds
        + WORKER_SOUND_CADENCE_SECONDS[source.mode]
        + deterministicJitter(source.id, schedule.sequence);
      this.lastGlobalPlayAt = this.elapsedSeconds;
      break;
    }
  }

  dispose(): void {
    this.stopAll();
    for (const audio of this.pool) audio.removeAttribute('src');
    this.pool.length = 0;
    this.schedules.clear();
  }

  private play(
    source: WorkerActivitySoundSource,
    schedule: WorkerSoundSchedule,
    gain: number,
  ): void {
    if (typeof Audio === 'undefined') return;
    while (this.pool.length < WORKER_SOUND_POOL_SIZE) {
      const audio = new Audio();
      audio.preload = 'auto';
      this.pool.push(audio);
    }

    const audio = this.pool.find((candidate) => candidate.paused) ?? this.pool[0];
    if (!audio) return;
    const clips = WORKER_ACTIVITY_CLIPS[source.mode];
    const variant = deterministicIndex(
      `${source.id}:${source.mode}:${schedule.sequence}`,
      clips.length,
    );
    const clip = clips[variant];
    if (!clip) return;

    audio.pause();
    audio.currentTime = 0;
    audio.src = clip.path;
    audio.volume = Math.min(1, Math.max(0, (clip.volume ?? 1) * gain));
    audio.playbackRate = 0.96 + deterministicIndex(
      `${source.id}:pitch:${schedule.sequence}`,
      7,
    ) * 0.012;
    void audio.play().catch(() => undefined);
  }

  private stopAll(): void {
    for (const audio of this.pool) {
      if (audio.paused) continue;
      audio.pause();
      audio.currentTime = 0;
    }
  }
}

function deterministicJitter(id: string, sequence: number): number {
  return (deterministicIndex(`${id}:cadence:${sequence}`, 9) - 4) * 0.018;
}

function deterministicIndex(value: string, count: number): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % Math.max(1, count);
}
