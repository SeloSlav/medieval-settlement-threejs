import * as THREE from 'three';
import type { EnvironmentState } from '../world/seasonPolicy.ts';
import {
  precipitationProfile,
  type PrecipitationKind,
  type PrecipitationProfile,
} from './precipitationPolicy.ts';

type ParticleLayer = {
  mesh: THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  opacity: number;
  speedScale: number;
  radiusScale: number;
  phase: number;
  swayPhase: number;
};

const VOLUME_HEIGHT = 72;
const VOLUME_FLOOR_BELOW_CAMERA = 20;
const OVERVIEW_VOLUME_FLOOR_BELOW_CAMERA = 86;
const BASE_VOLUME_RADIUS = 92;
const OVERVIEW_MIN_VOLUME_RADIUS = 60;
const OVERVIEW_VOLUME_RADIUS_SCALE = 0.78;
const OVERVIEW_MAX_VOLUME_RADIUS = 185;
const RAIN_BASE_PARTICLES = 1_800;
const SNOW_BASE_PARTICLES = 1_400;
const RAIN_INNER_RADIUS_FRACTION = 0.18;

/**
 * Camera-local precipitation with a fixed particle budget.
 *
 * Static instanced cards are vertically tiled and the two layer transforms move
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
      this.createLayer('rain', RAIN_BASE_PARTICLES, 0xc8deea, 0.86, 0.68, 1, 0.92, 0x7ba9c5),
      this.createLayer('rain', Math.round(RAIN_BASE_PARTICLES * 0.58), 0xe7f1f5, 1.25, 0.48, 1.18, 1.12, 0x9fbfd2),
    ];
    this.snowLayers = [
      this.createLayer('snow', SNOW_BASE_PARTICLES, 0xe6eef2, 0.38, 0.58, 0.9, 0.88, 0xaebfc8),
      this.createLayer('snow', Math.round(SNOW_BASE_PARTICLES * 0.62), 0xf1f5f6, 0.55, 0.4, 1.15, 1.1, 0xc4d0d5),
    ];

    for (const layer of [...this.rainLayers, ...this.snowLayers]) {
      this.group.add(layer.mesh);
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
      : THREE.MathUtils.clamp(
        cameraDistance * OVERVIEW_VOLUME_RADIUS_SCALE,
        OVERVIEW_MIN_VOLUME_RADIUS,
        OVERVIEW_MAX_VOLUME_RADIUS,
      );
    const precipitationFloorBelowCamera = firstPersonActive
      ? VOLUME_FLOOR_BELOW_CAMERA
      : THREE.MathUtils.lerp(
        VOLUME_FLOOR_BELOW_CAMERA,
        OVERVIEW_VOLUME_FLOOR_BELOW_CAMERA,
        THREE.MathUtils.smoothstep(cameraDistance, 70, 260),
      );
    const overviewVisibility = firstPersonActive
      ? 1
      : THREE.MathUtils.lerp(
        1,
        0.12,
        THREE.MathUtils.smoothstep(cameraDistance, 105, 260),
      );
    this.group.position.set(
      this.camera.position.x,
      this.camera.position.y - precipitationFloorBelowCamera,
      this.camera.position.z,
    );

    this.updateLayers(this.rainLayers, this.rainAmount * overviewVisibility, radius, 'rain', frameDt);
    this.updateLayers(this.snowLayers, this.snowAmount * overviewVisibility, radius, 'snow', frameDt);
    this.applyVisibility();
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const layer of [...this.rainLayers, ...this.snowLayers]) {
      layer.mesh.geometry.dispose();
      layer.mesh.material.dispose();
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
    const geometry = kind === 'rain'
      ? createRainStreakGeometry()
      : createSnowflakeGeometry();
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: kind === 'rain' ? this.rainTexture : this.snowTexture,
      transparent: true,
      opacity: 0,
      alphaTest: kind === 'rain' ? 0.012 : 0.02,
      depthTest: true,
      depthWrite: false,
      vertexColors: true,
      fog: true,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    });
    material.name = kind === 'rain' ? 'Depth-tested rain streaks' : 'Soft depth-tested snowflakes';

    const mesh = createParticleInstances(
      geometry,
      material,
      count,
      seed,
      kind,
      size,
      color,
      shadowColor,
    );
    mesh.name = kind === 'rain' ? 'Recycled instanced rain layer' : 'Recycled instanced snow layer';
    mesh.frustumCulled = false;
    mesh.renderOrder = 36;

    return {
      mesh,
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
      layer.mesh.position.set(
        windTravel * this.profile.windX + snowSway,
        -layer.phase,
        windTravel * this.profile.windZ,
      );
      const coverageScale = THREE.MathUtils.clamp(
        radius * layer.radiusScale / BASE_VOLUME_RADIUS,
        0.62,
        1.38,
      );
      layer.mesh.scale.set(coverageScale, 1, coverageScale);
      layer.mesh.material.opacity = layer.opacity * amount;
    }
  }

  private applyVisibility(): void {
    for (const layer of this.rainLayers) layer.mesh.visible = this.rainAmount > 0.008;
    for (const layer of this.snowLayers) layer.mesh.visible = this.snowAmount > 0.008;
  }
}

function createParticleInstances(
  geometry: THREE.BufferGeometry,
  material: THREE.MeshBasicMaterial,
  count: number,
  seed: number,
  kind: Exclude<PrecipitationKind, 'none'>,
  size: number,
  brightColor: number,
  shadowColor: number,
): THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
  // Two identical vertical tiles prevent a visible empty band when a layer wraps.
  const mesh = new THREE.InstancedMesh(geometry, material, count * 2);
  const bright = new THREE.Color(brightColor);
  const shadow = new THREE.Color(shadowColor);
  const rng = mulberry32(seed);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();

  for (let index = 0; index < count; index += 1) {
    const angle = rng() * Math.PI * 2;
    const innerRadius = kind === 'rain' ? RAIN_INNER_RADIUS_FRACTION : 0;
    const radius = Math.sqrt(
      innerRadius * innerRadius + rng() * (1 - innerRadius * innerRadius),
    );
    const x = Math.cos(angle) * radius * BASE_VOLUME_RADIUS;
    const z = Math.sin(angle) * radius * BASE_VOLUME_RADIUS;
    const y = rng() * VOLUME_HEIGHT;
    const brightness = 0.48 + rng() * 0.52;
    color.copy(shadow).lerp(bright, brightness);
    const scaleVariance = kind === 'rain'
      ? 0.72 + rng() * 0.58
      : 0.62 + rng() * 0.78;
    scale.setScalar(size * scaleVariance);

    position.set(x, y, z);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, color);

    position.y += VOLUME_HEIGHT;
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index + count, matrix);
    mesh.setColorAt(index + count, color);
  }

  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

function createRainStreakGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const uvs: number[] = [];
  const halfWidth = 0.06;
  const halfHeight = 0.42;
  const windLeanX = 0.13;
  const windLeanZ = 0.055;
  appendVerticalQuad(
    positions,
    uvs,
    new THREE.Vector3(-halfWidth - windLeanX, -halfHeight, -windLeanZ),
    new THREE.Vector3(halfWidth - windLeanX, -halfHeight, -windLeanZ),
    new THREE.Vector3(halfWidth + windLeanX, halfHeight, windLeanZ),
    new THREE.Vector3(-halfWidth + windLeanX, halfHeight, windLeanZ),
  );
  appendVerticalQuad(
    positions,
    uvs,
    new THREE.Vector3(-windLeanX, -halfHeight, -halfWidth - windLeanZ),
    new THREE.Vector3(-windLeanX, -halfHeight, halfWidth - windLeanZ),
    new THREE.Vector3(windLeanX, halfHeight, halfWidth + windLeanZ),
    new THREE.Vector3(windLeanX, halfHeight, -halfWidth + windLeanZ),
  );
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere();
  return geometry;
}

function createSnowflakeGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const uvs: number[] = [];
  const halfSize = 0.4;
  appendVerticalQuad(
    positions,
    uvs,
    new THREE.Vector3(-halfSize, -halfSize, 0),
    new THREE.Vector3(halfSize, -halfSize, 0),
    new THREE.Vector3(halfSize, halfSize, 0),
    new THREE.Vector3(-halfSize, halfSize, 0),
  );
  appendVerticalQuad(
    positions,
    uvs,
    new THREE.Vector3(0, -halfSize, -halfSize),
    new THREE.Vector3(0, -halfSize, halfSize),
    new THREE.Vector3(0, halfSize, halfSize),
    new THREE.Vector3(0, halfSize, -halfSize),
  );
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeBoundingSphere();
  return geometry;
}

function appendVerticalQuad(
  positions: number[],
  uvs: number[],
  bottomLeft: THREE.Vector3,
  bottomRight: THREE.Vector3,
  topRight: THREE.Vector3,
  topLeft: THREE.Vector3,
): void {
  const vertices = [bottomLeft, bottomRight, topRight, bottomLeft, topRight, topLeft];
  const quadUvs = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];
  for (let index = 0; index < vertices.length; index += 1) {
    const vertex = vertices[index];
    positions.push(vertex.x, vertex.y, vertex.z);
    uvs.push(quadUvs[index][0], quadUvs[index][1]);
  }
}

function createRainTexture(): THREE.DataTexture {
  return createParticleTexture(32, (x, y) => {
    const vertical = Math.sin(Math.PI * y);
    const center = 0.5;
    const distance = Math.abs(x - center);
    const core = Math.exp(-(distance * distance) / 0.028);
    const head = Math.exp(-Math.pow(y - 0.82, 2) / 0.03);
    return core * Math.pow(Math.max(0, vertical), 0.34) * (0.72 + head * 0.28);
  }, 'Procedural rain streak sprite', false);
}

function createSnowTexture(): THREE.DataTexture {
  return createParticleTexture(32, (x, y) => {
    const dx = x - 0.5;
    const dy = y - 0.5;
    const radius = Math.hypot(dx, dy) * 2;
    if (radius >= 1) return 0;
    const core = Math.exp(-(radius * radius) / 0.2);
    const angle = Math.atan2(dy, dx);
    const arm = Math.pow(Math.abs(Math.cos(angle * 3)), 12)
      * Math.exp(-Math.pow(radius - 0.48, 2) / 0.11);
    return Math.max(core, arm * 0.24) * Math.pow(1 - radius, 0.46);
  }, 'Procedural soft snowflake sprite');
}

function createParticleTexture(
  size: number,
  sampleAlpha: (x: number, y: number) => number,
  name: string,
  generateMipmaps = true,
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
  texture.minFilter = generateMipmaps
    ? THREE.LinearMipmapLinearFilter
    : THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = generateMipmaps;
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
