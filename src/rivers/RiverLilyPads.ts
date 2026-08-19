import * as THREE from 'three';
import type { Terrain } from '../terrain/Terrain.ts';
import { loadBitmapTexture } from '../utils/textureLoad.ts';
import { SpatialHash2D } from '../utils/SpatialHash2D.ts';
import type { RiverField } from './RiverField.ts';
import { getStillWaterSurfaceY } from './RiverWaterLevel.ts';

type LilyPadPlacement = {
  x: number;
  z: number;
  diameter: number;
  aspect: number;
  yaw: number;
  tiltX: number;
  tiltZ: number;
  tint: THREE.Color;
  surfaceOffset: number;
};

export type RiverLilyPadField = {
  group: THREE.Group;
  dispose: () => void;
};

export const LILY_PAD_TEXTURE_PATH = '/assets/textures/vegetation/aquatic/water-lily-pad.png';
export const LILY_SHORE_FADE_IN_METERS = 0.82;
export const LILY_SHORE_FADE_OUT_START_METERS = 4.8;
export const LILY_SHORE_REACH_METERS = 8.2;

const TAU = Math.PI * 2;
const LILY_PEAK_OPACITY = 0.94;

const matrix = new THREE.Matrix4();
const quaternion = new THREE.Quaternion();
const position = new THREE.Vector3();
const scale = new THREE.Vector3();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');

export async function createRiverLilyPads(
  terrain: Terrain,
  riverField: RiverField,
  rng: () => number,
  maxAnisotropy: number,
): Promise<RiverLilyPadField> {
  const placements = createLilyPadPlacements(riverField, rng);
  const texture = await loadBitmapTexture(LILY_PAD_TEXTURE_PATH, maxAnisotropy, {
    srgb: true,
    anisotropyLimit: 8,
    wrapping: THREE.ClampToEdgeWrapping,
  });
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({
    name: 'Textured pond and lake lily pads',
    map: texture,
    color: 0xffffff,
    roughness: 0.86,
    metalness: 0,
    side: THREE.DoubleSide,
    vertexColors: true,
    transparent: true,
    opacity: LILY_PEAK_OPACITY,
    alphaTest: 0.01,
    depthWrite: true,
  });

  const capacity = Math.max(placements.length, 1);
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = 'Textured pond and lake lily-pad rafts';
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.renderOrder = 2.4;
  mesh.count = placements.length;
  mesh.visible = placements.length > 0;

  placements.forEach((placement, index) => {
    const y = getStillWaterSurfaceY(terrain, riverField, placement.x, placement.z);
    position.set(placement.x, y + 0.035 + placement.surfaceOffset, placement.z);
    euler.set(placement.tiltX, placement.yaw, placement.tiltZ);
    quaternion.setFromEuler(euler);
    scale.set(
      placement.diameter * placement.aspect,
      1,
      placement.diameter / placement.aspect,
    );
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, placement.tint);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  const group = new THREE.Group();
  group.name = 'Pond and lake lily pads';
  group.add(mesh);

  return {
    group,
    dispose() {
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}

export function lilyPadShorePresence(shoreDistanceMeters: number): number {
  if (!Number.isFinite(shoreDistanceMeters)) return 0;
  const edgeFade = smoothstep(0.18, LILY_SHORE_FADE_IN_METERS, shoreDistanceMeters);
  const channelFade = 1 - smoothstep(
    LILY_SHORE_FADE_OUT_START_METERS,
    LILY_SHORE_REACH_METERS,
    shoreDistanceMeters,
  );
  return edgeFade * channelFade;
}

function createLilyPadPlacements(
  riverField: RiverField,
  rng: () => number,
): LilyPadPlacement[] {
  const placements: LilyPadPlacement[] = [];
  const placementIndex = new SpatialHash2D<LilyPadPlacement>(0.72);
  const { resolution, startX, startZ, stepX, stepZ } = riverField;

  for (let gridZ = 0; gridZ < resolution; gridZ++) {
    for (let gridX = 0; gridX < resolution; gridX++) {
      const cellIndex = gridZ * resolution + gridX;
      if (riverField.riverMask[cellIndex] < 0.48) continue;

      const wx = startX + gridX * stepX;
      const wz = startZ + gridZ * stepZ;
      const x = wx + (rng() - 0.5) * stepX * 0.82;
      const z = wz + (rng() - 0.5) * stepZ * 0.82;
      if (!riverField.isRenderedWetAt(x, z)) continue;
      if (!riverField.layout.isInlandWaterAt(x, z)) continue;

      const shore = riverField.sampleShoreDistance(x, z);
      const shorePresence = lilyPadShorePresence(shore);
      if (shorePresence <= 0) continue;

      // Low-frequency noise gives the edge broken rafts and open breathing
      // pockets instead of a procedural-looking continuous green outline.
      const raftNoise = valueNoise2D(x * 0.092 + 17.3, z * 0.092 - 8.6);
      const raftPresence = smoothstep(0.22, 0.78, raftNoise);
      const chance = shorePresence * (0.045 + Math.pow(raftPresence, 1.35) * 0.56);
      if (rng() > chance) continue;

      const diameter = THREE.MathUtils.lerp(0.28, 1.22, Math.pow(rng(), 1.38))
        * THREE.MathUtils.lerp(0.76, 1, shorePresence);
      const separation = 0.26 + diameter * 0.16;
      if (placementIndex.hasPointWithin(x, z, separation)) continue;

      const tintStrength = 0.82 + rng() * 0.18;
      const tint = new THREE.Color().setHSL(
        0.255 + (rng() - 0.5) * 0.035,
        0.2 + rng() * 0.12,
        tintStrength,
      );
      const placement: LilyPadPlacement = {
        x,
        z,
        diameter,
        aspect: 0.84 + rng() * 0.3,
        yaw: rng() * TAU,
        tiltX: (rng() - 0.5) * 0.026,
        tiltZ: (rng() - 0.5) * 0.026,
        tint,
        surfaceOffset: rng() * 0.014,
      };
      placements.push(placement);
      placementIndex.add(placement);
    }
  }

  return placements;
}

function hashNoise2D(x: number, z: number): number {
  const value = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function valueNoise2D(x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = x - x0;
  const tz = z - z0;
  const ux = tx * tx * (3 - 2 * tx);
  const uz = tz * tz * (3 - 2 * tz);
  const top = THREE.MathUtils.lerp(hashNoise2D(x0, z0), hashNoise2D(x0 + 1, z0), ux);
  const bottom = THREE.MathUtils.lerp(hashNoise2D(x0, z0 + 1), hashNoise2D(x0 + 1, z0 + 1), ux);
  return THREE.MathUtils.lerp(top, bottom, uz);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = THREE.MathUtils.clamp((value - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
