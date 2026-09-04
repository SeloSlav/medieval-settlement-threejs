import {
  BUILDING_AUDIO_CLIPS,
  CHAPEL_BELL_CLIP,
  type AudioClipDefinition,
  type BuildingAudioKind,
  type ChapelBellTier,
} from './audioCatalog.ts';

export const BUILDING_AUDIO_TAIL_SECONDS = 0.45;

const BUILDING_AUDIO_POOL_SIZE = 3;

type BuildingAudioPoolEntry = {
  audio: HTMLAudioElement;
  baseGain: number;
};

/** Smooth gain envelope applied to the decoded cue tail, separate from generation. */
export function buildingAudioTailGain(remainingSeconds: number): number {
  const normalized = Math.min(
    1,
    Math.max(0, remainingSeconds / BUILDING_AUDIO_TAIL_SECONDS),
  );
  return normalized * normalized * (3 - 2 * normalized);
}

/**
 * Plays a structure's authored cue only when the player explicitly selects
 * that building or residence. The frame tick only maintains playback tails;
 * it never discovers or schedules nearby sources on its own.
 */
export class BuildingAudio {
  private readonly pool: BuildingAudioPoolEntry[] = [];
  private enabled = true;
  private volume = 1;
  private playSequence = 0;

  tick(_dtSeconds: number): void {
    this.updateTailEnvelopes();
  }

  play(kind: BuildingAudioKind, sourceId: string): void {
    this.playClip(BUILDING_AUDIO_CLIPS[kind], sourceId, true);
  }

  playChapel(_tier: ChapelBellTier, sourceId: string): void {
    this.playClip(CHAPEL_BELL_CLIP, sourceId, false);
  }

  private playClip(
    clip: AudioClipDefinition,
    sourceId: string,
    varyPlaybackRate: boolean,
  ): void {
    if (!this.enabled || typeof Audio === 'undefined') return;
    while (this.pool.length < BUILDING_AUDIO_POOL_SIZE) {
      const audio = new Audio();
      audio.preload = 'auto';
      this.pool.push({ audio, baseGain: 0 });
    }
    const entry = this.pool.find(({ audio }) => audio.paused) ?? this.pool[0];
    if (!entry) return;
    const sequence = this.playSequence;
    this.playSequence += 1;

    entry.audio.pause();
    entry.audio.currentTime = 0;
    entry.audio.src = clip.path;
    entry.baseGain = Math.min(1, Math.max(0, clip.volume ?? 1));
    entry.audio.volume = entry.baseGain * this.volume;
    entry.audio.playbackRate = varyPlaybackRate
      ? 0.985 + deterministicIndex(`${sourceId}:pitch:${sequence}`, 5) * 0.0075
      : 1;
    void entry.audio.play().catch(() => undefined);
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
