import * as THREE from 'three';
import type { EnvironmentState } from '../world/seasonPolicy.ts';
import {
  precipitationProfile,
  type PrecipitationKind,
  type PrecipitationProfile,
} from './precipitationPolicy.ts';

type ParticleLayer = {
  points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  opacity: number;
  speedScale: number;
  radiusScale: number;
  phase: number;
  swayPhase: number;
};

const VOLUME_HEIGHT = 72;
const VOLUME_FLOOR_BELOW_CAMERA = 20;
const RAIN_BASE_PARTICLES = 720;
const SNOW_BASE_PARTICLES = 620;

/**
 * Camera-local precipitation with a fixed particle budget.
 *
 * Static point clouds are vertically tiled and the two layer transforms move
 * around the camera. That keeps rain/snow to two draw calls with no per-particle
 * CPU uploads, while depth testing still lets roofs, trees, and terrain occlude it.
 */
export class PrecipitationRenderer {
  readonly group = new THREE.Group();

  private readonly camera: THREE.Camera;
  private readonly rainTexture = createRainTexture();
  private readonly snowTexture = createSnowTexture();
  private readonly rainLayers: ParticleLayer[];
  private readonly snowLayers: ParticleLayer[];
  private profile: PrecipitationProfile = precipitationProfile(null);
  private rainAmount = 0;
  private snowAmount = 0;
  private elapsed = 0;

  constructor(camera: THREE.Camera, parent: THREE.Object3D) {
    this.camera = camera;
    this.group.name = 'Camera-local rain and snow';
    this.group.frustumCulled = false;

    this.rainLayers = [
      this.createLayer('rain', RAIN_BASE_PARTICLES, 0xbed8e8, 1.08, 0.46, 1, 0.92, 0x73a5c7),
      this.createLayer('rain', Math.round(RAIN_BASE_PARTICLES * 0.58), 0xe1edf3, 1.75, 0.34, 1.18, 1.12, 0x9abbd0),
    ];
    this.snowLayers = [
      this.createLayer('snow', SNOW_BASE_PARTICLES, 0xf4fbff, 0.72, 0.82, 0.9, 0.88, 0xcbdde8),
      this.createLayer('snow', Math.round(SNOW_BASE_PARTICLES * 0.62), 0xffffff, 1.28, 0.68, 1.15, 1.1, 0xdceaf2),
    ];

    for (const layer of [...this.rainLayers, ...this.snowLayers]) {
      this.group.add(layer.points);
    }
    parent.add(this.group);
    this.applyVisibility();
  }

  setEnvironment(environment: EnvironmentState): void {
    this.profile = precipitationProfile(environment);
  }

  update(dt: number, cameraDistance: number, firstPersonActive: boolean): void {
    const frameDt = Math.min(0.05, Math.max(0, dt));
    this.elapsed += frameDt;

    const targetRain = this.profile.kind === 'rain' ? this.profile.intensity : 0;
    const targetSnow = this.profile.kind === 'snow' ? this.profile.intensity : 0;
    const blend = 1 - Math.exp(-frameDt * 1.8);
    this.rainAmount += (targetRain - this.rainAmount) * blend;
    this.snowAmount += (targetSnow - this.snowAmount) * blend;

    const radius = firstPersonActive
      ? 34
      : THREE.MathUtils.clamp(cameraDistance * 0.58, 44, 175);
    this.group.position.set(
      this.camera.position.x,
      this.camera.position.y - VOLUME_FLOOR_BELOW_CAMERA,
      this.camera.position.z,
    );

    this.updateLayers(this.rainLayers, this.rainAmount, radius, 'rain', frameDt);
    this.updateLayers(this.snowLayers, this.snowAmount, radius, 'snow', frameDt);
    this.applyVisibility();
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const layer of [...this.rainLayers, ...this.snowLayers]) {
      layer.points.geometry.dispose();
      layer.points.material.dispose();
    }
    this.rainTexture.dispose();
    this.snowTexture.dispose();
  }

  private createLayer(
    kind: Exclude<PrecipitationKind, 'none'>,
    count: number,
    color: number,
    size: number,
    opacity: number,
    speedScale: number,
    radiusScale: number,
    shadowColor: number,
  ): ParticleLayer {
    const seed = kind === 'rain' ? count * 19 + 71 : count * 29 + 131;
    const geometry = createParticleGeometry(count, seed, color, shadowColor);
    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      map: kind === 'rain' ? this.rainTexture : this.snowTexture,
      size,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      alphaTest: kind === 'rain' ? 0.035 : 0.02,
      depthTest: true,
      depthWrite: false,
      vertexColors: true,
      fog: true,
      blending: THREE.NormalBlending,
    });
    material.name = kind === 'rain' ? 'Depth-tested rain streaks' : 'Soft depth-tested snowflakes';

    const points = new THREE.Points(geometry, material);
    points.name = kind === 'rain' ? 'Recycled rain layer' : 'Recycled snow layer';
    points.frustumCulled = false;
    points.renderOrder = 36;

    return {
      points,
      opacity,
      speedScale,
      radiusScale,
      phase: seededUnit(seed ^ 0x9e3779b9) * VOLUME_HEIGHT,
      swayPhase: seededUnit(seed ^ 0x85ebca6b) * Math.PI * 2,
    };
  }

  private updateLayers(
    layers: ParticleLayer[],
    amount: number,
    radius: number,
    kind: Exclude<PrecipitationKind, 'none'>,
    dt: number,
  ): void {
    for (let index = 0; index < layers.length; index += 1) {
      const layer = layers[index];
      const fallSpeed = this.profile.fallSpeed * layer.speedScale;
      layer.phase = (layer.phase + fallSpeed * dt) % VOLUME_HEIGHT;

      const direction = index % 2 === 0 ? 1 : -0.65;
      const windTravel = fallSpeed > 0 ? layer.phase / fallSpeed * direction : 0;
      const snowSway = kind === 'snow'
        ? Math.sin(this.elapsed * (0.58 + index * 0.16) + layer.swayPhase) * radius * 0.035
        : 0;
      layer.points.position.set(
        windTravel * this.profile.windX + snowSway,
        -layer.phase,
        windTravel * this.profile.windZ,
      );
      layer.points.scale.set(radius * layer.radiusScale, 1, radius * layer.radiusScale);
      layer.points.material.opacity = layer.opacity * amount;
    }
  }

  private applyVisibility(): void {
    for (const layer of this.rainLayers) layer.points.visible = this.rainAmount > 0.008;
    for (const layer of this.snowLayers) layer.points.visible = this.snowAmount > 0.008;
  }
}

function createParticleGeometry(
  count: number,
  seed: number,
  brightColor: number,
  shadowColor: number,
): THREE.BufferGeometry {
  // Two identical vertical tiles prevent a visible empty band when a layer wraps.
  const positions = new Float32Array(count * 2 * 3);
  const colors = new Float32Array(count * 2 * 3);
  const bright = new THREE.Color(brightColor);
  const shadow = new THREE.Color(shadowColor);
  const rng = mulberry32(seed);

  for (let index = 0; index < count; index += 1) {
    const angle = rng() * Math.PI * 2;
    const radius = Math.sqrt(rng());
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const y = rng() * VOLUME_HEIGHT;
    const brightness = 0.48 + rng() * 0.52;
    const color = shadow.clone().lerp(bright, brightness);

    writeParticle(positions, colors, index, x, y, z, color);
    writeParticle(positions, colors, index + count, x, y + VOLUME_HEIGHT, z, color);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function writeParticle(
  positions: Float32Array,
  colors: Float32Array,
  index: number,
  x: number,
  y: number,
  z: number,
  color: THREE.Color,
): void {
  const offset = index * 3;
  positions[offset] = x;
  positions[offset + 1] = y;
  positions[offset + 2] = z;
  colors[offset] = color.r;
  colors[offset + 1] = color.g;
  colors[offset + 2] = color.b;
}

function createRainTexture(): THREE.DataTexture {
  return createParticleTexture(32, (x, y) => {
    const vertical = Math.sin(Math.PI * y);
    const center = 0.46 + (y - 0.5) * 0.16;
    const distance = Math.abs(x - center);
    const core = Math.exp(-(distance * distance) / 0.0015);
    const head = Math.exp(-Math.pow(y - 0.82, 2) / 0.03);
    return core * Math.pow(Math.max(0, vertical), 0.34) * (0.72 + head * 0.28);
  }, 'Procedural rain streak sprite');
}

function createSnowTexture(): THREE.DataTexture {
  return createParticleTexture(32, (x, y) => {
    const dx = x - 0.5;
    const dy = y - 0.5;
    const radius = Math.hypot(dx, dy) * 2;
    if (radius >= 1) return 0;
    const core = Math.exp(-(radius * radius) / 0.16);
    const angle = Math.atan2(dy, dx);
    const arm = Math.pow(Math.abs(Math.cos(angle * 3)), 18)
      * Math.exp(-Math.pow(radius - 0.48, 2) / 0.11);
    return Math.max(core, arm * 0.72) * Math.pow(1 - radius, 0.28);
  }, 'Procedural soft snowflake sprite');
}

function createParticleTexture(
  size: number,
  sampleAlpha: (x: number, y: number) => number,
  name: string,
): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const alpha = THREE.MathUtils.clamp(
        sampleAlpha((x + 0.5) / size, (y + 0.5) / size),
        0,
        1,
      );
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = Math.round(alpha * 255);
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.name = name;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function seededUnit(seed: number): number {
  return mulberry32(seed)();
}
