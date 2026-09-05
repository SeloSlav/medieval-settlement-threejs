import * as THREE from 'three';
import { deflectWaterAroundRock, waterBankVelocityScale } from './WaterHydraulics.ts';
import { getRiverWaterColumnDepth } from './RiverWaterLevel.ts';
import {
  RENDER_WATER_MASK_THRESHOLD,
  type RiverField,
} from './RiverField.ts';
import {
  computeRiverRockRapidFoam,
  createRiverChannelRockPlacements,
  getRiverChannelRockContactRadius,
  RIVER_ROCK_MIN_WAKE_LENGTH_METERS,
  RIVER_ROCK_WAKE_LENGTH_PER_SCALE,
} from './RiverChannelRocks.ts';

export const WATER_CLIP_FEATHER = -0.62;
export const WATER_ALPHA_FEATHER_IN = 0.46;
export const WATER_FOAM_REACH = 1.3;
export const RIVER_SURFACE_FIELD_MAX_TEXEL_METERS = 2.5;
export const RIVER_SURFACE_FIELD_MAX_RESOLUTION = 1024;

// Five taps are enough to preserve sub-texel contact rings and split wakes at
// the 1024² large-map tier. The pattern is deliberately symmetric so it only
// anti-aliases the authored wake; it cannot introduce a preferred grid axis.
const RAPID_SOURCE_TEXEL_TAPS = [
  { x: 0, z: 0, weight: 0.36 },
  { x: -0.32, z: -0.32, weight: 0.16 },
  { x: 0.32, z: -0.32, weight: 0.16 },
  { x: -0.32, z: 0.32, weight: 0.16 },
  { x: 0.32, z: 0.32, weight: 0.16 },
] as const;

export type RiverWaterShoreMaps = {
  shoreTexture: THREE.DataTexture;
  /** RG: velocity m/s, B: water depth m, A: signed shore distance m. */
  hydraulicTexture?: THREE.DataTexture;
  originX: number;
  originZ: number;
  invSpanX: number;
  invSpanZ: number;
  resolution?: number;
  /** Deterministic obstacle budget baked into the green foam/source channel. */
  channelRockCount?: number;
};

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function computeWaterFeatherAlpha(signed: number): number {
  return smoothstep(
    WATER_CLIP_FEATHER - 0.08,
    WATER_ALPHA_FEATHER_IN + 0.12,
    signed,
  );
}

export function computeWaterFoamBase(foamSigned: number): number {
  return foamSigned >= 0
    ? 1 - smoothstep(0.08, WATER_FOAM_REACH, foamSigned)
    : 1 - smoothstep(-0.24, 0.1, foamSigned);
}

export function encodeFlowComponent(value: number): number {
  return Math.round(Math.max(0, Math.min(255, (value * 0.5 + 0.5) * 255)));
}

export function encodeWaterFlowDirection(
  flow: Readonly<{ dx: number; dz: number }> | null,
): readonly [number, number] {
  // The neutral encoding is meaningful: the material uses vector magnitude to
  // distinguish still/open water from a river current. Its shader supplies the
  // fallback direction only after making that classification.
  return [
    encodeFlowComponent(flow?.dx ?? 0),
    encodeFlowComponent(flow?.dz ?? 0),
  ];
}

export function createRiverWaterShoreMaps(
  riverField: RiverField,
  options: { includeChannelRocks?: boolean } = {},
): RiverWaterShoreMaps {
  const {
    resolution: fieldResolution,
    startX,
    startZ,
    spanX,
    spanZ,
    organicSignedDistance,
    layout,
  } = riverField;
  const fieldTexelMeters = Math.max(
    spanX / Math.max(1, fieldResolution - 1),
    spanZ / Math.max(1, fieldResolution - 1),
  );
  const resolution = fieldTexelMeters > RIVER_SURFACE_FIELD_MAX_TEXEL_METERS
    ? Math.min(RIVER_SURFACE_FIELD_MAX_RESOLUTION, fieldResolution * 2)
    : fieldResolution;
  const stepX = spanX / (resolution - 1);
  const stepZ = spanZ / (resolution - 1);
  const data = new Uint8Array(resolution * resolution * 4);
  const hydraulic = new Float32Array(resolution * resolution * 4);

  for (let iz = 0; iz < resolution; iz++) {
    for (let ix = 0; ix < resolution; ix++) {
      const i = iz * resolution + ix;
      const wx = startX + ix * stepX;
      const wz = startZ + iz * stepZ;
      const foamSigned = resolution === fieldResolution
        ? organicSignedDistance[i] ?? 0
        : riverField.sampleOrganicSignedDistance(wx, wz);
      const feather = computeWaterFeatherAlpha(foamSigned);
      const flow = layout.sampleFlowDirection(wx, wz);
      const [flowX, flowZ] = encodeWaterFlowDirection(flow);
      const offset = i * 4;
      data[offset] = Math.round(feather * 255);
      // Green is reserved for obstacle/riffle energy. The visual shore ramp is
      // reconstructed from red, so river foam no longer forms an unbroken
      // decorative outline around every bank.
      data[offset + 1] = 0;
      data[offset + 2] = flowX;
      data[offset + 3] = flowZ;
      const speed = (layout.sampleFlowSpeed(wx, wz) ?? 0) * waterBankVelocityScale(foamSigned);
      hydraulic[offset] = (flow?.dx ?? 0) * speed;
      hydraulic[offset + 1] = (flow?.dz ?? 0) * speed;
      hydraulic[offset + 2] = getRiverWaterColumnDepth(riverField, wx, wz, foamSigned);
      hydraulic[offset + 3] = foamSigned;
    }
  }

  const channelRocks = options.includeChannelRocks === false
    ? []
    : createRiverChannelRockPlacements(riverField);
  for (const rock of channelRocks) {
    if (rock.rapidEnergy <= 0.001) continue;
    let sampledPeak = 0;
    const wakeLength = Math.max(
      RIVER_ROCK_MIN_WAKE_LENGTH_METERS,
      rock.scale * RIVER_ROCK_WAKE_LENGTH_PER_SCALE,
    );
    const reach = wakeLength + rock.scale * 2.2 + 2;
    const minGridX = Math.max(0, Math.floor((rock.x - reach - startX) / stepX));
    const maxGridX = Math.min(
      resolution - 1,
      Math.ceil((rock.x + reach - startX) / stepX),
    );
    const minGridZ = Math.max(0, Math.floor((rock.z - reach - startZ) / stepZ));
    const maxGridZ = Math.min(
      resolution - 1,
      Math.ceil((rock.z + reach - startZ) / stepZ),
    );

    for (let iz = minGridZ; iz <= maxGridZ; iz += 1) {
      for (let ix = minGridX; ix <= maxGridX; ix += 1) {
        const i = iz * resolution + ix;
        const wx = startX + ix * stepX;
        const wz = startZ + iz * stepZ;
        if (
          layout.sampleRiverMask(wx, wz)
          < RENDER_WATER_MASK_THRESHOLD
        ) continue;
        const h = i * 4;
        const velocity = deflectWaterAroundRock(hydraulic[h], hydraulic[h + 1], wx, wz, rock);
        hydraulic[h] = velocity[0];
        hydraulic[h + 1] = velocity[1];
        const rapidFoam = sampleRapidSourceTexel(rock, wx, wz, stepX, stepZ);
        if (rapidFoam <= 0) continue;
        sampledPeak = Math.max(sampledPeak, rapidFoam);
        const offset = i * 4 + 1;
        data[offset] = Math.max(data[offset], Math.round(rapidFoam * 255));
      }
    }

    // Only the rare ring that misses all five taps receives a conservative
    // fallback. Writing one nearest wet texel avoids the former 2x2 minimum
    // splat that appeared as a repeated rectangle around every boulder.
    if (sampledPeak < rock.rapidEnergy * 0.12) {
      const contactRadius = getRiverChannelRockContactRadius(rock.scale);
      splatNearestRapidSource(
        data,
        resolution,
        startX,
        startZ,
        stepX,
        stepZ,
        riverField,
        rock.x - rock.flowX * contactRadius,
        rock.z - rock.flowZ * contactRadius,
        rock.rapidEnergy * 0.76,
      );
    }
  }

  const shoreTexture = new THREE.DataTexture(
    data,
    resolution,
    resolution,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  shoreTexture.colorSpace = THREE.NoColorSpace;
  shoreTexture.wrapS = THREE.ClampToEdgeWrapping;
  shoreTexture.wrapT = THREE.ClampToEdgeWrapping;
  shoreTexture.minFilter = THREE.LinearFilter;
  shoreTexture.magFilter = THREE.LinearFilter;
  shoreTexture.generateMipmaps = false;
  shoreTexture.needsUpdate = true;

  const hydraulicHalf = new Uint16Array(hydraulic.length);
  for (let i = 0; i < hydraulic.length; i++) hydraulicHalf[i] = THREE.DataUtils.toHalfFloat(hydraulic[i]);
  const hydraulicTexture = new THREE.DataTexture(hydraulicHalf, resolution, resolution, THREE.RGBAFormat, THREE.HalfFloatType);
  hydraulicTexture.name = 'Water velocity depth and signed shoreline';
  hydraulicTexture.minFilter = hydraulicTexture.magFilter = THREE.LinearFilter;
  hydraulicTexture.generateMipmaps = false;
  hydraulicTexture.needsUpdate = true;

  return {
    shoreTexture,
    hydraulicTexture,
    originX: startX,
    originZ: startZ,
    invSpanX: 1 / spanX,
    invSpanZ: 1 / spanZ,
    resolution,
    channelRockCount: channelRocks.length,
  };
}

function sampleRapidSourceTexel(
  rock: Parameters<typeof computeRiverRockRapidFoam>[0],
  x: number,
  z: number,
  stepX: number,
  stepZ: number,
): number {
  let peak = 0;
  let coverage = 0;
  for (const tap of RAPID_SOURCE_TEXEL_TAPS) {
    const sample = computeRiverRockRapidFoam(
      rock,
      x + tap.x * stepX,
      z + tap.z * stepZ,
    );
    peak = Math.max(peak, sample);
    coverage += sample * tap.weight;
  }
  // Geometric mean retains a thin energetic strand when only one tap crosses
  // it, while suppressing the square full-texel plateaus produced by a max.
  return Math.sqrt(peak * coverage);
}

function splatNearestRapidSource(
  data: Uint8Array,
  resolution: number,
  startX: number,
  startZ: number,
  stepX: number,
  stepZ: number,
  riverField: RiverField,
  x: number,
  z: number,
  strength: number,
): void {
  if (strength <= 0) return;
  const gx = (x - startX) / stepX;
  const gz = (z - startZ) / stepZ;
  const centerX = Math.round(gx);
  const centerZ = Math.round(gz);
  for (let radius = 0; radius <= 2; radius += 1) {
    let selectedOffset = -1;
    let selectedDistance = Number.POSITIVE_INFINITY;
    for (let iz = centerZ - radius; iz <= centerZ + radius; iz += 1) {
      if (iz < 0 || iz >= resolution) continue;
      for (let ix = centerX - radius; ix <= centerX + radius; ix += 1) {
        if (ix < 0 || ix >= resolution) continue;
        if (radius > 0 && Math.abs(ix - centerX) < radius && Math.abs(iz - centerZ) < radius) {
          continue;
        }
        const wx = startX + ix * stepX;
        const wz = startZ + iz * stepZ;
        if (
          riverField.layout.sampleRiverMask(wx, wz)
          < RENDER_WATER_MASK_THRESHOLD
        ) continue;
        const distance = (gx - ix) ** 2 + (gz - iz) ** 2;
        if (distance < selectedDistance) {
          selectedDistance = distance;
          selectedOffset = (iz * resolution + ix) * 4 + 1;
        }
      }
    }
    if (selectedOffset < 0) continue;
    data[selectedOffset] = Math.max(
      data[selectedOffset],
      Math.round(Math.min(1, strength) * 255),
    );
    return;
  }
}

export function disposeRiverWaterShoreMaps(maps: RiverWaterShoreMaps): void {
  maps.shoreTexture.dispose();
  maps.hydraulicTexture?.dispose();
}
