import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  STARTUP_MUSIC_FADE_OUT_MS,
  STARTUP_MUSIC_TRACK_ID,
  StartupMusicController,
  type StartupMusicEnvironment,
} from '../src/audio/StartupMusicController.ts';
import {
  MUSIC_TRACKS,
  STARTUP_MUSIC_CLIP,
  type MusicTrackId,
} from '../src/audio/audioCatalog.ts';
import { SoundtrackAudio } from '../src/audio/SoundtrackAudio.ts';
import {
  isSoundtrackActive,
  setExternalSoundtrackActive,
  setSoundtrackActive,
} from '../src/audio/audioPlaybackState.ts';

class FakeUnlockTarget {
  private readonly listeners = new Map<string, Set<EventListener>>();
  dispatching = false;

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener || typeof listener !== 'function') return;
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener || typeof listener !== 'function') return;
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    this.dispatching = true;
    try {
      for (const listener of [...(this.listeners.get(type) ?? [])]) {
        listener({ type } as Event);
      }
    } finally {
      this.dispatching = false;
    }
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

class FakeAudio {
  src = '';
  preload = 'none';
  loop = false;
  volume = 1;
  paused = true;
  playCount = 0;
  pauseCount = 0;
  loadCount = 0;
  playDuringDispatch = false;
  rejectNextPlay = false;
  private readonly unlockTarget: FakeUnlockTarget;
  private readonly listeners = new Map<string, Set<EventListener>>();

  constructor(unlockTarget: FakeUnlockTarget) {
    this.unlockTarget = unlockTarget;
  }

  play(): Promise<void> {
    this.playCount += 1;
    this.playDuringDispatch ||= this.unlockTarget.dispatching;
    if (this.rejectNextPlay) {
      this.rejectNextPlay = false;
      return Promise.reject(new Error('NotAllowedError'));
    }
    this.paused = false;
    return Promise.resolve();
  }

  pause(): void {
    this.pauseCount += 1;
    this.paused = true;
  }

  removeAttribute(name: string): void {
    if (name === 'src') this.src = '';
  }

  load(): void {
    this.loadCount += 1;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener || typeof listener !== 'function') return;
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener || typeof listener !== 'function') return;
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener({ type } as Event);
    }
  }
}

function createHarness(rejectInitialPlay = false) {
  const unlockTarget = new FakeUnlockTarget();
  const audioInstances: FakeAudio[] = [];
  const frames = new Map<number, FrameRequestCallback>();
  const timeouts = new Map<number, () => void>();
  const cancelledFrames: number[] = [];
  const cancelledTimeouts: number[] = [];
  let nextFrameId = 1;
  let nextTimeoutId = 1;
  let nowMs = 1_000;
  const environment: StartupMusicEnvironment = {
    unlockTarget: unlockTarget as never,
    createAudio: () => {
      const audio = new FakeAudio(unlockTarget);
      audio.rejectNextPlay = rejectInitialPlay && audioInstances.length === 0;
      audioInstances.push(audio);
      return audio as never;
    },
    now: () => nowMs,
    requestFrame: (callback) => {
      const frameId = nextFrameId;
      nextFrameId += 1;
      frames.set(frameId, callback);
      return frameId;
    },
    cancelFrame: (frameId) => {
      cancelledFrames.push(frameId);
      frames.delete(frameId);
    },
    scheduleTimeout: (callback) => {
      const timeoutId = nextTimeoutId;
      nextTimeoutId += 1;
      timeouts.set(timeoutId, callback);
      return timeoutId;
    },
    cancelTimeout: (timeoutId) => {
      cancelledTimeouts.push(timeoutId);
      timeouts.delete(timeoutId);
    },
  };
  return {
    unlockTarget,
    audioInstances,
    environment,
    cancelledFrames,
    cancelledTimeouts,
    runFrame(timestampMs: number) {
      nowMs = timestampMs;
      const pending = [...frames.entries()];
      frames.clear();
      for (const [, callback] of pending) callback(timestampMs);
    },
    runTimeouts() {
      const pending = [...timeouts.values()];
      timeouts.clear();
      for (const callback of pending) callback();
    },
    get pendingFrames() {
      return frames.size;
    },
    get pendingTimeouts() {
      return timeouts.size;
    },
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

assert.equal(STARTUP_MUSIC_TRACK_ID, 'a_charter_beneath_the_firs');
assert.equal(STARTUP_MUSIC_FADE_OUT_MS, 7_000);
assert.strictEqual(
  MUSIC_TRACKS[STARTUP_MUSIC_TRACK_ID],
  STARTUP_MUSIC_CLIP,
  'the planning theme must remain available to the gameplay soundtrack',
);
const soundtrackAfterPlanning = new SoundtrackAudio();
soundtrackAfterPlanning.markTrackPlayed(STARTUP_MUSIC_TRACK_ID);
assert.notEqual(
  (soundtrackAfterPlanning as unknown as { pickTrack: () => MusicTrackId }).pickTrack(),
  STARTUP_MUSIC_TRACK_ID,
  'gameplay must not immediately repeat the planning cue',
);
setSoundtrackActive(false);
setExternalSoundtrackActive(true);
assert.equal(
  isSoundtrackActive(),
  true,
  'startup score ownership must survive an inactive gameplay soundtrack',
);
setExternalSoundtrackActive(false);
assert.equal(isSoundtrackActive(), false);

const audibility: boolean[] = [];
const retryHarness = createHarness(true);
const controller = new StartupMusicController({
  enabled: true,
  musicVolume: 0.5,
  environment: retryHarness.environment,
  onAudibilityChange: (audible) => audibility.push(audible),
});
controller.start();
controller.start();
assert.equal(retryHarness.audioInstances.length, 1, 'startup must own one audio element');
const audio = retryHarness.audioInstances[0]!;
assert.equal(audio.src, STARTUP_MUSIC_CLIP.path);
assert.equal(audio.preload, 'auto');
assert.equal(audio.loop, true, 'setup music must survive arbitrarily long world setup');
assert.equal(
  audio.volume,
  (STARTUP_MUSIC_CLIP.volume ?? 1) * 0.5,
  'startup music must use the authored cue gain and saved music volume',
);
assert.equal(audio.playCount, 1, 'startup should attempt autoplay immediately');
await flushPromises();
assert.equal(controller.isAudible(), false);
assert.equal(retryHarness.unlockTarget.listenerCount('pointerdown'), 1);
assert.equal(retryHarness.unlockTarget.listenerCount('keydown'), 1);

retryHarness.unlockTarget.dispatch('pointerdown');
assert.equal(audio.playCount, 2, 'the first gesture must retry blocked autoplay');
assert.equal(
  audio.playDuringDispatch,
  true,
  'the retry must occur synchronously while browser user activation is live',
);
await flushPromises();
assert.equal(controller.isAudible(), true);
assert.deepEqual(audibility, [true]);
assert.equal(retryHarness.unlockTarget.listenerCount('pointerdown'), 0);
assert.equal(retryHarness.unlockTarget.listenerCount('keydown'), 0);
retryHarness.unlockTarget.dispatch('keydown');
assert.equal(audio.playCount, 2, 'successful unlock must remove retry listeners');

controller.setMusicVolume(0.25);
assert.equal(
  audio.volume,
  (STARTUP_MUSIC_CLIP.volume ?? 1) * 0.25,
  'live music-volume changes must reach the startup cue during its handoff',
);
const startVolume = audio.volume;
const fadePromise = controller.fadeOut(1_000);
assert.strictEqual(controller.fadeOut(1_000), fadePromise, 'handoff must be idempotent');
assert.equal(retryHarness.pendingFrames, 1);
assert.equal(retryHarness.pendingTimeouts, 1);
retryHarness.runFrame(1_500);
assert.ok(audio.volume > 0 && audio.volume < startVolume, 'fade midpoint must lower gain');
assert.equal(audio.volume, startVolume * 0.5, 'fade midpoint must use a smooth half-gain envelope');
retryHarness.runFrame(2_000);
await fadePromise;
assert.equal(audio.volume, 0);
assert.equal(audio.paused, true);
assert.equal(audio.src, '');
assert.equal(audio.loadCount, 1, 'completed handoff must release the media resource');
assert.equal(controller.isAudible(), false);
assert.deepEqual(audibility, [true, false]);
assert.equal(retryHarness.pendingTimeouts, 0);
retryHarness.unlockTarget.dispatch('pointerdown');
assert.equal(audio.playCount, 2, 'the startup cue must never restart after handoff');

const noGestureHarness = createHarness(true);
const noGestureController = new StartupMusicController({
  enabled: true,
  environment: noGestureHarness.environment,
});
noGestureController.start();
await flushPromises();
const noGestureAudio = noGestureHarness.audioInstances[0]!;
await noGestureController.fadeOut();
noGestureHarness.unlockTarget.dispatch('pointerdown');
assert.equal(
  noGestureAudio.playCount,
  1,
  'a fast no-interaction load must disarm startup playback before gameplay',
);

const disabledHarness = createHarness();
new StartupMusicController({
  enabled: false,
  environment: disabledHarness.environment,
}).start();
assert.equal(disabledHarness.audioInstances.length, 0, 'Music Off must skip media creation');
new StartupMusicController({
  enabled: true,
  musicVolume: 0,
  environment: disabledHarness.environment,
}).start();
assert.equal(disabledHarness.audioInstances.length, 0, 'zero music volume must stay silent');

const disposeHarness = createHarness();
const disposeController = new StartupMusicController({
  enabled: true,
  environment: disposeHarness.environment,
});
disposeController.start();
await flushPromises();
const disposeAudio = disposeHarness.audioInstances[0]!;
const interruptedFade = disposeController.fadeOut();
assert.equal(disposeHarness.pendingFrames, 1);
disposeController.dispose();
disposeController.dispose();
await interruptedFade;
assert.equal(disposeHarness.pendingFrames, 0);
assert.equal(disposeHarness.cancelledFrames.length, 1);
assert.equal(disposeHarness.cancelledTimeouts.length, 1);
assert.equal(disposeAudio.paused, true);

const backgroundHarness = createHarness();
const backgroundController = new StartupMusicController({
  enabled: true,
  environment: backgroundHarness.environment,
});
backgroundController.start();
await flushPromises();
const backgroundAudio = backgroundHarness.audioInstances[0]!;
const backgroundFade = backgroundController.fadeOut();
assert.equal(backgroundHarness.pendingFrames, 1);
backgroundHarness.runTimeouts();
await backgroundFade;
assert.equal(
  backgroundAudio.paused,
  true,
  'timeout fallback must finish the handoff when background tabs suspend animation frames',
);
assert.equal(backgroundHarness.pendingFrames, 0);

const errorHarness = createHarness();
const errorController = new StartupMusicController({
  enabled: true,
  environment: errorHarness.environment,
});
errorController.start();
await flushPromises();
const errorAudio = errorHarness.audioInstances[0]!;
assert.equal(errorController.isAudible(), true);
errorAudio.emit('error');
assert.equal(errorController.isAudible(), false, 'media failure must clear external score state');
assert.equal(errorAudio.src, '', 'media failure must release the failed startup resource');

const preferenceHarness = createHarness();
const preferenceController = new StartupMusicController({
  enabled: true,
  environment: preferenceHarness.environment,
});
preferenceController.start();
await flushPromises();
const preferenceAudio = preferenceHarness.audioInstances[0]!;
preferenceController.setMusicEnabled(false);
assert.equal(preferenceAudio.paused, true, 'Music Off must stop a fading startup cue immediately');
assert.equal(preferenceController.isAudible(), false);
preferenceHarness.unlockTarget.dispatch('pointerdown');
assert.equal(preferenceAudio.playCount, 1, 'a muted startup cue must remain permanently disarmed');

const appSource = readFileSync(
  new URL('../src/app/App.ts', import.meta.url),
  'utf8',
);
const startupIndex = appSource.indexOf('this.startupMusic = new StartupMusicController');
const bootstrapIndex = appSource.indexOf('session = await bootstrapAppSession');
assert.ok(startupIndex >= 0 && bootstrapIndex > startupIndex, 'music must start before setup prompts');
assert.match(appSource, /deferGameplayMusic: this\.startupMusic !== null/);
assert.match(appSource, /onFirstPlayable: \(\) => \{[\s\S]*?this\.handoffStartupMusic\(\);/);
assert.match(appSource, /markMusicTrackPlayed\(STARTUP_MUSIC_TRACK_ID\)/);
const handoffSource = appSource.slice(appSource.indexOf('private handoffStartupMusic'));
const markPlayedIndex = handoffSource.indexOf('markMusicTrackPlayed(STARTUP_MUSIC_TRACK_ID)');
const gameplayActivationIndex = handoffSource.indexOf(
  'setGameplayMusicActive(true)',
  markPlayedIndex,
);
assert.ok(
  markPlayedIndex >= 0 && gameplayActivationIndex > markPlayedIndex,
  'the planning cue must be marked before gameplay music is activated',
);
assert.match(appSource, /this\.startupMusic\?\.setGameAudioEnabled\(enabled\)/);
assert.match(appSource, /this\.startupMusic\?\.setMusicEnabled\(enabled\)/);
assert.match(appSource, /this\.startupMusic\?\.setMusicVolume\(volume\)/);

console.log('test:startup-music passed');
