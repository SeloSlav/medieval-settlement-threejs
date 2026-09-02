import * as THREE from 'three';
import {
  PRODUCTION_POCKET_CLIPS,
  type AudioClipDefinition,
} from './audioCatalog.ts';
import { AMBIENT_SCORE_DUCK_GAIN } from './AmbientAudio.ts';
import {
  PRODUCTION_POCKET_CUTOFF_DISTANCE,
  PRODUCTION_POCKET_FULL_VOLUME_DISTANCE,
  PRODUCTION_POCKET_KINDS,
  type ProductionPocketKind,
  type ProductionPocketTarget,
} from './productionPocketRules.ts';

type ProductionPocketSource = {
  audio: THREE.PositionalAudio;
  loaded: boolean;
  loading: boolean;
  loadGeneration: number;
  currentMix: number;
  targetMix: number;
  targetPosition: THREE.Vector3;
};

export type ProductionPocketAudioConfig = {
  listener: THREE.AudioListener;
  parent: THREE.Object3D;
  getGroundY: (x: number, z: number) => number;
};

const SOURCE_HEIGHT = 2.2;
const MIX_FADE_IN_SECONDS = 3;
const MIX_FADE_OUT_SECONDS = 4.5;
const POSITION_FOLLOW_SPEED = 6;
const SCORE_DUCK_ATTACK_SECONDS = 2.5;
const SCORE_DUCK_RELEASE_SECONDS = 4;

/**
 * A bounded family of HRTF loops. Each family follows its nearest audible,
 * staffed workshop, while the rule layer limits the overall mix to two
 * production pockets so a dense town never becomes an undifferentiated roar.
 */
export class ProductionPocketAudio {
  private readonly listener: THREE.AudioListener;
  private readonly getGroundY: ProductionPocketAudioConfig['getGroundY'];
  private readonly sources = {} as Record<ProductionPocketKind, ProductionPocketSource>;
  private enabled = true;
  private paused = false;
  private started = false;
  private ambienceVolume = 1;
  private currentScoreDuckGain = 1;
  private targetScoreDuckGain = 1;

  constructor(config: ProductionPocketAudioConfig) {
    this.listener = config.listener;
    this.getGroundY = config.getGroundY;
    for (const kind of PRODUCTION_POCKET_KINDS) {
      const audio = new THREE.PositionalAudio(this.listener);
      const clip = PRODUCTION_POCKET_CLIPS[kind];
      audio.name = `Production ambience: ${kind}`;
      audio.panner.panningModel = 'HRTF';
      audio.setDistanceModel('linear');
      audio.setRefDistance(PRODUCTION_POCKET_FULL_VOLUME_DISTANCE);
      audio.setMaxDistance(PRODUCTION_POCKET_CUTOFF_DISTANCE);
      audio.setRolloffFactor(1);
      audio.setLoop(clip.loop ?? true);
      audio.setVolume(0);
      config.parent.add(audio);
      this.sources[kind] = {
        audio,
        loaded: false,
        loading: false,
        loadGeneration: 0,
        currentMix: 0,
        targetMix: 0,
        targetPosition: new THREE.Vector3(),
      };
    }
  }

  start(): void {
    if (!this.enabled) return;
    this.started = true;
    void this.listener.context.resume()
      .catch(() => undefined)
      .then(() => this.ensurePlayback());
  }

  setTargets(targets: readonly ProductionPocketTarget[]): void {
    for (const kind of PRODUCTION_POCKET_KINDS) {
      this.sources[kind].targetMix = 0;
    }
    if (!this.enabled) return;
    for (const target of targets) {
      const source = this.sources[target.kind];
      source.targetMix = clamp01(target.mixGain);
      source.targetPosition.set(
        target.x,
        this.getGroundY(target.x, target.z) + SOURCE_HEIGHT,
        target.z,
      );
      if (source.audio.position.lengthSq() <= 1e-6) {
        source.audio.position.copy(source.targetPosition);
      }
      this.ensureLoaded(target.kind);
    }
  }

  tick(dtSeconds: number): void {
    if (!this.enabled || !this.started || this.paused) return;
    const dt = Math.max(0, dtSeconds);
    const duckSeconds = this.targetScoreDuckGain < this.currentScoreDuckGain
      ? SCORE_DUCK_ATTACK_SECONDS
      : SCORE_DUCK_RELEASE_SECONDS;
    this.currentScoreDuckGain = moveToward(
      this.currentScoreDuckGain,
      this.targetScoreDuckGain,
      dt * (1 - AMBIENT_SCORE_DUCK_GAIN) / duckSeconds,
    );
    const positionAlpha = 1 - Math.exp(-dt * POSITION_FOLLOW_SPEED);

    for (const kind of PRODUCTION_POCKET_KINDS) {
      const state = this.sources[kind];
      const fadeSeconds = state.targetMix > state.currentMix
        ? MIX_FADE_IN_SECONDS
        : MIX_FADE_OUT_SECONDS;
      state.currentMix = moveToward(
        state.currentMix,
        state.targetMix,
        dt / fadeSeconds,
      );
      state.audio.position.lerp(state.targetPosition, positionAlpha);
      state.audio.setVolume(productionPocketVolume(
        PRODUCTION_POCKET_CLIPS[kind],
        state.currentMix,
        this.ambienceVolume,
        this.currentScoreDuckGain,
      ));
      if (state.targetMix > 0 && state.loaded && !state.audio.isPlaying) {
        this.play(state);
      } else if (
        state.targetMix <= 0
        && state.currentMix <= 0.0001
        && state.audio.isPlaying
      ) {
        state.audio.pause();
      }
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) {
      if (this.started) this.ensurePlayback();
      return;
    }
    this.setTargets([]);
    for (const state of Object.values(this.sources)) {
      state.currentMix = 0;
      state.audio.setVolume(0);
      if (state.audio.isPlaying) state.audio.pause();
    }
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      for (const state of Object.values(this.sources)) {
        if (state.audio.isPlaying) state.audio.pause();
      }
    } else {
      this.ensurePlayback();
    }
  }

  setVolume(volume: number): void {
    this.ambienceVolume = clamp01(volume);
  }

  setScoreActive(active: boolean): void {
    this.targetScoreDuckGain = active ? AMBIENT_SCORE_DUCK_GAIN : 1;
  }

  dispose(): void {
    this.enabled = false;
    this.started = false;
    for (const state of Object.values(this.sources)) {
      state.loadGeneration += 1;
      if (state.audio.isPlaying) state.audio.stop();
      state.audio.disconnect();
      state.audio.removeFromParent();
    }
  }

  private ensureLoaded(kind: ProductionPocketKind): void {
    const state = this.sources[kind];
    if (state.loaded || state.loading) return;
    state.loading = true;
    const generation = ++state.loadGeneration;
    new THREE.AudioLoader().load(
      PRODUCTION_POCKET_CLIPS[kind].path,
      (buffer) => {
        if (generation !== state.loadGeneration) return;
        state.audio.setBuffer(buffer);
        state.loaded = true;
        state.loading = false;
        if (state.targetMix > 0) this.play(state);
      },
      undefined,
      () => {
        if (generation === state.loadGeneration) state.loading = false;
      },
    );
  }

  private ensurePlayback(): void {
    if (!this.enabled || !this.started || this.paused) return;
    for (const state of Object.values(this.sources)) {
      if (state.targetMix > 0 && state.loaded && !state.audio.isPlaying) {
        this.play(state);
      }
    }
  }

  private play(state: ProductionPocketSource): void {
    if (!this.enabled || !this.started || this.paused || state.audio.isPlaying) return;
    try {
      state.audio.play();
    } catch {
      // The next unlocked tick retries if browser autoplay policy intervenes.
    }
  }
}

export function productionPocketVolume(
  clip: AudioClipDefinition,
  mix: number,
  ambienceVolume: number,
  scoreDuckGain: number,
): number {
  return clamp01(
    (clip.volume ?? 1)
    * clamp01(mix)
    * clamp01(ambienceVolume)
    * clamp01(scoreDuckGain),
  );
}

function moveToward(current: number, target: number, step: number): number {
  if (Math.abs(current - target) <= step) return target;
  return current < target ? current + step : current - step;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
