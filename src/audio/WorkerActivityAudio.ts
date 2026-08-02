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
  activeGeneration: number;
};

type WorkerSoundCandidate = {
  id: string;
  mode: WorkerActivitySoundKind;
  gain: number;
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
  private readonly candidatePool: WorkerSoundCandidate[] = [];
  private readonly candidates: WorkerSoundCandidate[] = [];
  private activeGeneration = 0;
  private elapsedSeconds = 0;
  private lastGlobalPlayAt = Number.NEGATIVE_INFINITY;

  tick(
    dtSeconds: number,
    sources: readonly WorkerActivitySoundSource[],
    view: CrowdViewState | undefined,
  ): void {
    this.elapsedSeconds += Math.max(0, dtSeconds);
    const activeGeneration = ++this.activeGeneration;
    for (const source of sources) {
      const schedule = this.schedules.get(source.id);
      if (schedule) schedule.activeGeneration = activeGeneration;
    }
    for (const [id, schedule] of this.schedules) {
      if (schedule.activeGeneration !== activeGeneration) this.schedules.delete(id);
    }

    const candidates = this.candidates;
    candidates.length = 0;

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

    for (const source of sources) {
      const gain = workerActivitySoundGain(source.x, source.z, view);
      if (gain <= 0) continue;
      const candidateIndex = candidates.length;
      let candidate = this.candidatePool[candidateIndex];
      if (!candidate) {
        candidate = { id: source.id, mode: source.mode, gain };
        this.candidatePool.push(candidate);
      } else {
        candidate.id = source.id;
        candidate.mode = source.mode;
        candidate.gain = gain;
      }
      candidates.push(candidate);
    }
    if (candidates.length > 1) {
      candidates.sort((left, right) => right.gain - left.gain);
    }

    for (const candidate of candidates) {
      let schedule = this.schedules.get(candidate.id);
      if (!schedule || schedule.mode !== candidate.mode) {
        schedule = {
          mode: candidate.mode,
          nextPlayAt: this.elapsedSeconds + 0.16,
          sequence: 0,
          activeGeneration,
        };
        this.schedules.set(candidate.id, schedule);
      }
      if (this.elapsedSeconds < schedule.nextPlayAt) continue;
      if (
        this.elapsedSeconds - this.lastGlobalPlayAt
        < WORKER_SOUND_GLOBAL_INTERVAL_SECONDS
      ) {
        break;
      }

      this.play(candidate, schedule, candidate.gain);
      schedule.sequence += 1;
      schedule.nextPlayAt = this.elapsedSeconds
        + WORKER_SOUND_CADENCE_SECONDS[candidate.mode]
        + deterministicJitter(candidate.id, schedule.sequence);
      this.lastGlobalPlayAt = this.elapsedSeconds;
      break;
    }
  }

  dispose(): void {
    this.stopAll();
    for (const audio of this.pool) audio.removeAttribute('src');
    this.pool.length = 0;
    this.schedules.clear();
    this.candidates.length = 0;
    this.candidatePool.length = 0;
  }

  private play(
    source: WorkerSoundCandidate,
    schedule: WorkerSoundSchedule,
    gain: number,
  ): void {
    if (typeof Audio === 'undefined') return;
    while (this.pool.length < WORKER_SOUND_POOL_SIZE) {
      const audio = new Audio();
      audio.preload = 'auto';
      this.pool.push(audio);
    }

    let audio: HTMLAudioElement | undefined;
    for (const candidate of this.pool) {
      if (!candidate.paused) continue;
      audio = candidate;
      break;
    }
    audio ??= this.pool[0];
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
