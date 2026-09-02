import {
  UI_SOUNDS,
  type UiSoundId,
} from './audioCatalog.ts';

const UI_AUDIO_POOL_SIZE = 4;

export type UiAudioPlayOptions = {
  playbackRate?: number;
  preservePitch?: boolean;
};

/** Small shared pool for tactile placement and validation feedback. */
export class UiAudio {
  private readonly pool: HTMLAudioElement[] = [];
  private readonly preloaders: HTMLAudioElement[] = [];
  private enabled = true;
  private volume = 1;
  private playRevision = 0;

  getPlayRevision(): number {
    return this.playRevision;
  }

  preload(ids: readonly UiSoundId[]): void {
    if (!this.enabled || typeof Audio === 'undefined') return;
    for (const id of ids) {
      const clip = UI_SOUNDS[id];
      if (!clip || this.preloaders.some((audio) => audio.src.endsWith(clip.path))) continue;
      const audio = new Audio();
      audio.preload = 'auto';
      audio.src = clip.path;
      audio.load();
      this.preloaders.push(audio);
    }
  }

  play(id: UiSoundId, options: UiAudioPlayOptions = {}): void {
    if (!this.enabled || typeof Audio === 'undefined') return;
    while (this.pool.length < UI_AUDIO_POOL_SIZE) {
      const audio = new Audio();
      audio.preload = 'auto';
      this.pool.push(audio);
    }
    const audio = this.pool.find((candidate) => candidate.paused)
      ?? this.pool[0];
    const clip = UI_SOUNDS[id];
    if (!audio || !clip) return;
    this.playRevision += 1;
    audio.pause();
    audio.currentTime = 0;
    audio.src = clip.path;
    audio.volume = Math.max(0, Math.min(1, (clip.volume ?? 1) * this.volume));
    audio.preservesPitch = options.preservePitch ?? true;
    audio.playbackRate = Math.max(0.5, Math.min(2, options.playbackRate ?? 1));
    void audio.play().catch(() => undefined);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) return;
    for (const audio of this.pool) {
      audio.pause();
      audio.currentTime = 0;
    }
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
  }

  dispose(): void {
    this.setEnabled(false);
    for (const audio of this.pool) audio.removeAttribute('src');
    for (const audio of this.preloaders) audio.removeAttribute('src');
    this.pool.length = 0;
    this.preloaders.length = 0;
  }
}
