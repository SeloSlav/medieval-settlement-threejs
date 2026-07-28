import {
  UI_SOUNDS,
  type UiSoundId,
} from './audioCatalog.ts';

const UI_AUDIO_POOL_SIZE = 4;

/** Small shared pool for tactile placement and validation feedback. */
export class UiAudio {
  private readonly pool: HTMLAudioElement[] = [];
  private enabled = true;

  play(id: UiSoundId): void {
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
    audio.pause();
    audio.currentTime = 0;
    audio.src = clip.path;
    audio.volume = Math.max(0, Math.min(1, clip.volume ?? 1));
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

  dispose(): void {
    this.setEnabled(false);
    for (const audio of this.pool) audio.removeAttribute('src');
    this.pool.length = 0;
  }
}
