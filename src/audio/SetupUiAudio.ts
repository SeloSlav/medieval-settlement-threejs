import { type UiSoundId } from './audioCatalog.ts';
import {
  getSoundEffectsVolume,
  isGameAudioEnabled,
} from './audioPreferences.ts';
import { UiAudio } from './UiAudio.ts';

const ADJUSTMENT_SOUND_INTERVAL_MS = 42;
const SETUP_AUDIO_TAIL_MS = 1_800;

/**
 * Semantic UI audio for the pre-game setup flow.
 *
 * It inherits the normal game-audio preferences even though these panels are
 * mounted before AmbientAudioController. Fine controls are rate-limited and
 * pitch-mapped so a dragged range input reads as motion instead of chatter.
 */
export class SetupUiAudio {
  private readonly audio = new UiAudio();
  private lastAdjustmentAt = Number.NEGATIVE_INFINITY;

  constructor() {
    const enabled = isGameAudioEnabled();
    this.audio.setEnabled(enabled);
    this.audio.setVolume(getSoundEffectsVolume());
    if (enabled) {
      this.audio.preload([
        'setup_portrait_select',
        'setup_choice',
        'setup_preset',
        'setup_adjust',
        'setup_back',
        'setup_advance',
        'setup_commit',
        'error',
      ]);
    }
  }

  play(id: UiSoundId, playbackRate = 1): void {
    this.audio.play(id, {
      playbackRate,
      preservePitch: playbackRate === 1,
    });
  }

  playAdjustment(value: number, min: number, max: number): void {
    const now = performance.now();
    if (now - this.lastAdjustmentAt < ADJUSTMENT_SOUND_INTERVAL_MS) return;
    this.lastAdjustmentAt = now;
    const range = Math.max(1, max - min);
    const normalized = Math.max(0, Math.min(1, (value - min) / range));
    this.play('setup_adjust', 0.92 + normalized * 0.16);
  }

  playDirectionalAdjustment(step: number): void {
    this.play('setup_adjust', step < 0 ? 0.94 : 1.06);
  }

  disposeAfterTail(): void {
    window.setTimeout(() => this.audio.dispose(), SETUP_AUDIO_TAIL_MS);
  }
}
