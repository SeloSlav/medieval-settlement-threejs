import * as THREE from 'three';
import type { RiverLayout } from '../rivers/RiverLayout.ts';
import { RIVER_WATER_CLIP } from './audioCatalog.ts';

export const RIVER_AUDIO_FULL_VOLUME_DISTANCE = 9;
export const RIVER_AUDIO_CUTOFF_DISTANCE = 120;

const POSITION_REFRESH_SECONDS = 0.08;
const POSITION_FOLLOW_SPEED = 8;
const VOLUME_FADE_SPEED = 3;
const RIVER_WATER_HALF_WIDTH_MULTIPLIER = 0.62;
const CONFLUENCE_WATER_RADIUS = 48;

export type RiverSoundPoint = {
  x: number;
  z: number;
  distance: number;
};

export type RiverAudioConfig = {
  camera: THREE.Camera;
  parent: THREE.Object3D;
  /** Shared world-audio listener; omitted only by isolated legacy callers. */
  listener?: THREE.AudioListener;
  riverLayout: RiverLayout;
  getWaterSurfaceY: (x: number, z: number) => number;
};

/** Still inland water such as ponds must never enable the rushing river loop. */
export function hasAmbientRiverSound(
  riverLayout: Pick<RiverLayout, 'corridors'>,
): boolean {
  return riverLayout.corridors.some((corridor) => corridor.points.length >= 2);
}

/**
 * Models the river as an extended sound source by returning the closest point
 * on its water surface, rather than treating the whole river as one emitter.
 */
export function nearestRiverSoundPoint(
  riverLayout: Pick<RiverLayout, 'corridors' | 'drain'>,
  x: number,
  z: number,
  out: RiverSoundPoint = { x: 0, z: 0, distance: 0 },
): RiverSoundPoint {
  let hasBest = false;

  for (const corridor of riverLayout.corridors) {
    for (let index = 0; index < corridor.points.length - 1; index++) {
      const a = corridor.points[index];
      const b = corridor.points[index + 1];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const lengthSq = abx * abx + abz * abz;
      const t = lengthSq <= 1e-6
        ? 0
        : clamp01(((x - a.x) * abx + (z - a.z) * abz) / lengthSq);
      hasBest = considerWaterDisc(
        out,
        hasBest,
        x,
        z,
        a.x + abx * t,
        a.z + abz * t,
        lerp(a.halfWidth, b.halfWidth, t) * RIVER_WATER_HALF_WIDTH_MULTIPLIER,
      );
    }
  }

  // The corridors converge into the broad lake at the drain.
  hasBest = considerWaterDisc(
    out,
    hasBest,
    x,
    z,
    riverLayout.drain.x,
    riverLayout.drain.z,
    CONFLUENCE_WATER_RADIUS,
  );

  if (!hasBest) {
    out.x = riverLayout.drain.x;
    out.z = riverLayout.drain.z;
    out.distance = Math.hypot(x - riverLayout.drain.x, z - riverLayout.drain.z);
  }
  return out;
}

function considerWaterDisc(
  out: RiverSoundPoint,
  hasBest: boolean,
  x: number,
  z: number,
  centerX: number,
  centerZ: number,
  radius: number,
): boolean {
  const dx = x - centerX;
  const dz = z - centerZ;
  const centerDistance = Math.hypot(dx, dz);
  const surfaceDistance = Math.max(0, centerDistance - radius);
  if (hasBest && surfaceDistance >= out.distance) return true;

  if (centerDistance <= radius || centerDistance <= 1e-6) {
    out.x = x;
    out.z = z;
    out.distance = 0;
    return true;
  }
  const scale = radius / centerDistance;
  out.x = centerX + dx * scale;
  out.z = centerZ + dz * scale;
  out.distance = surfaceDistance;
  return true;
}

/**
 * One continuously playing HRTF source follows the nearest river surface.
 * That is acoustically equivalent to selecting the nearest part of a long,
 * distributed source, without playing dozens of identical loops at once.
 */
export class RiverAudio {
  private readonly config: RiverAudioConfig;
  private readonly listener: THREE.AudioListener;
  private readonly ownsListener: boolean;
  private readonly source: THREE.PositionalAudio;
  private readonly hasRiverSound: boolean;
  private readonly targetPosition = new THREE.Vector3();
  private readonly nearestPoint: RiverSoundPoint = { x: 0, z: 0, distance: 0 };
  private refreshElapsed = POSITION_REFRESH_SECONDS;
  private loadGeneration = 0;
  private currentVolume = 0;
  private hasPosition = false;
  private loaded = false;
  private started = false;
  private enabled = true;
  private paused = false;
  private ambienceVolume = 1;

  constructor(config: RiverAudioConfig) {
    this.config = config;
    this.listener = config.listener ?? new THREE.AudioListener();
    this.ownsListener = config.listener == null;
    this.source = new THREE.PositionalAudio(this.listener);
    this.hasRiverSound = hasAmbientRiverSound(config.riverLayout);
    this.source.name = 'Spatial river water audio';
    this.source.panner.panningModel = 'HRTF';
    this.source
      .setDistanceModel('linear')
      .setRefDistance(RIVER_AUDIO_FULL_VOLUME_DISTANCE)
      .setMaxDistance(RIVER_AUDIO_CUTOFF_DISTANCE)
      .setRolloffFactor(1);
    this.source.setLoop(RIVER_WATER_CLIP.loop ?? true);
    this.source.setPlaybackRate(1);
    this.source.setVolume(0);
    if (this.ownsListener) config.camera.add(this.listener);
    config.parent.add(this.source);
    if (!this.hasRiverSound) {
      this.enabled = false;
    } else {
      this.load();
    }
  }

  start(): void {
    if (!this.enabled) return;
    this.started = true;
    void this.listener.context.resume()
      .catch(() => undefined)
      .then(() => this.ensurePlayback());
  }

  tick(dtSeconds: number): void {
    if (!this.enabled || !this.started || this.paused) return;
    const dt = Math.max(0, dtSeconds);
    this.refreshElapsed += dt;
    if (this.refreshElapsed >= POSITION_REFRESH_SECONDS || !this.hasPosition) {
      this.refreshElapsed = 0;
      const cameraPosition = this.config.camera.position;
      const point = nearestRiverSoundPoint(
        this.config.riverLayout,
        cameraPosition.x,
        cameraPosition.z,
        this.nearestPoint,
      );
      this.targetPosition.set(
        point.x,
        this.config.getWaterSurfaceY(point.x, point.z) + 0.18,
        point.z,
      );
      if (!this.hasPosition) {
        this.source.position.copy(this.targetPosition);
        this.hasPosition = true;
      }
    }

    const followAlpha = 1 - Math.exp(-dt * POSITION_FOLLOW_SPEED);
    this.source.position.lerp(this.targetPosition, followAlpha);
    const targetVolume = this.loaded ? riverAudioGain(this.ambienceVolume) : 0;
    const volumeAlpha = 1 - Math.exp(-dt * VOLUME_FADE_SPEED);
    this.currentVolume = THREE.MathUtils.lerp(this.currentVolume, targetVolume, volumeAlpha);
    this.source.setVolume(this.currentVolume);
    this.ensurePlayback();
  }

  setVolume(volume: number): void {
    this.ambienceVolume = clamp01(volume);
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      if (this.source.isPlaying) this.source.pause();
      return;
    }
    this.ensurePlayback();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled && this.hasRiverSound;
    if (this.enabled) {
      if (this.started) this.start();
      return;
    }
    this.stopPlayback();
  }

  dispose(): void {
    this.loadGeneration += 1;
    this.started = false;
    this.enabled = false;
    this.stopPlayback();
    this.source.disconnect();
    this.source.removeFromParent();
    if (this.ownsListener) this.listener.removeFromParent();
  }

  private load(): void {
    const generation = ++this.loadGeneration;
    new THREE.AudioLoader().load(
      RIVER_WATER_CLIP.path,
      (buffer) => {
        if (generation !== this.loadGeneration) return;
        this.source.setBuffer(buffer);
        this.loaded = true;
        this.ensurePlayback();
      },
      undefined,
      () => {
        if (generation === this.loadGeneration) this.loaded = false;
      },
    );
  }

  private ensurePlayback(): void {
    if (
      !this.enabled
      || !this.started
      || this.paused
      || !this.loaded
      || !this.hasPosition
      || this.source.isPlaying
    ) {
      return;
    }
    try {
      this.source.play();
    } catch {
      // A later interaction/tick retries if the browser still blocks playback.
    }
  }

  private stopPlayback(): void {
    if (this.source.isPlaying) this.source.stop();
    this.currentVolume = 0;
    this.source.setVolume(0);
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function riverAudioGain(ambienceVolume: number): number {
  return (RIVER_WATER_CLIP.volume ?? 1) * clamp01(ambienceVolume);
}
