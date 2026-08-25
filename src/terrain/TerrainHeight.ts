import { BuildingTerrainLayout } from '../buildings/BuildingTerrainLayout.ts';
import type { RiverLayout } from '../rivers/RiverLayout.ts';
import type { QuarryLayout } from '../quarries/QuarryLayout.ts';
import { getActiveWorldDimensions, getActiveWorldGeneration } from '../world/worldGenerationContext.ts';
import {
  topographyScale,
  type WorldDimensions,
  type WorldGenerationSettings,
} from '../world/worldGenerationSettings.ts';
import { sampleLicPoljeTerrainFields } from './LicPoljeTerrainField.ts';

let activeRiverLayout: RiverLayout | null = null;
let activeQuarryLayout: QuarryLayout | null = null;
let activePlacedBuildingLayout: BuildingTerrainLayout | null = null;

export function setActiveRiverLayout(layout: RiverLayout | null): void {
  activeRiverLayout = layout;
}

export function getActiveRiverLayout(): RiverLayout | null {
  return activeRiverLayout;
}

export function setActiveQuarryLayout(layout: QuarryLayout | null): void {
  activeQuarryLayout = layout;
}

export function getActiveQuarryLayout(): QuarryLayout | null {
  return activeQuarryLayout;
}

export function setActivePlacedBuildingLayout(layout: BuildingTerrainLayout | null): void {
  activePlacedBuildingLayout = layout;
}

export function getActivePlacedBuildingLayout(): BuildingTerrainLayout | null {
  return activePlacedBuildingLayout;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function hash(x: number, z: number): number {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function valueNoise(x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = x - x0;
  const tz = z - z0;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const a = hash(x0, z0);
  const b = hash(x0 + 1, z0);
  const c = hash(x0, z0 + 1);
  const d = hash(x0 + 1, z0 + 1);
  const x0Lerp = a + (b - a) * sx;
  const x1Lerp = c + (d - c) * sx;
  return x0Lerp + (x1Lerp - x0Lerp) * sz;
}

function fbm(x: number, z: number, octaves: number): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    value += valueNoise(x * frequency, z * frequency) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / norm - 0.5;
}

function ridgedFbm(x: number, z: number, octaves: number): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = fbm(x * frequency, z * frequency, 1) + 0.5;
    const ridge = 1 - Math.abs(n * 2 - 1);
    value += ridge * ridge * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return value / norm;
}

function getEdgeHillFactor(
  x: number,
  z: number,
  dimensions: WorldDimensions,
): number {
  const { generationSize, terrainSize } = dimensions;
  const edgeDistance = Math.max(Math.abs(x), Math.abs(z));
  const hillStart = generationSize * 0.44;
  const hillEnd = terrainSize * 0.5;
  return smoothstep(hillStart, hillEnd, edgeDistance);
}

function getEdgeHillHeight(
  x: number,
  z: number,
  dimensions: WorldDimensions,
): number {
  const t = getEdgeHillFactor(x, z, dimensions);
  if (t <= 0) return 0;

  const ridge = fbm(x * 0.0085 + 37.5, z * 0.0085 - 22.4, 5) + 0.5;
  const detail = fbm(x * 0.026 - 6.2, z * 0.026 + 9.7, 3) + 0.5;
  const shoulder = t * t * (14 + ridge * 26);
  const crest = t * t * t * t * (14 + detail * 18);
  return shoulder + crest;
}

function getMacroDrainage(x: number, z: number): number {
  const warpX = fbm(x * 0.0018 + 14.2, z * 0.0018 - 9.4, 3) * 48;
  const warpZ = fbm(x * 0.0018 - 22.6, z * 0.0018 + 11.8, 3) * 48;
  const wx = x + warpX;
  const wz = z + warpZ;
  const broadValley = fbm(wx * 0.0026 + 31.5, wz * 0.0026 - 18.7, 5);
  const uplandRidge = ridgedFbm(wx * 0.0044 - 8.2, wz * 0.0044 + 26.4, 4);
  const terrace = fbm(wx * 0.0095 + 4.1, wz * 0.0095 - 2.8, 3);
  return broadValley * 7.8 - uplandRidge * 5.4 + terrace * 1.6;
}

function presetNoiseOffset(seed: number): { x: number; z: number } {
  return {
    x: ((seed >>> 4) & 0xfff) * 0.017,
    z: ((seed >>> 16) & 0xfff) * 0.019,
  };
}

// Risnjak National Park runs from roughly 290 m in the Kupa valley to
// 1,528 m on Veliki Risnjak. The authored terrain scale condenses that 1,238 m
// regional rise horizontally, so it renders a little over half on each side.
const KUPA_REGIONAL_RELIEF_METERS = 1_528 - 290;

function sampleKupaValleyHeight(
  x: number,
  z: number,
  relief: number,
  seed: number,
  dimensions: WorldDimensions,
): number {
  const { generationHalf: playableHalf } = dimensions;
  const offset = presetNoiseOffset(seed);
  const normalizedX = x / playableHalf;
  const westSlope = smoothstep(0.31, 0.94, -normalizedX);
  const eastSlope = smoothstep(0.34, 0.94, normalizedX);
  const sideSlope = Math.max(westSlope, eastSlope);
  const ridge = ridgedFbm(
    (x + offset.x) * 0.0048,
    (z + offset.z) * 0.0048,
    4,
  );
  const mountainRelief = sideSlope
    * KUPA_REGIONAL_RELIEF_METERS
    * (0.3 + ridge * 0.3)
    * relief;
  const valleyUndulation = fbm(
    (x + offset.x) * 0.0065,
    (z + offset.z) * 0.0065,
    4,
  ) * (1.3 + sideSlope * 4.2) * relief;
  const riverGrade = -z / Math.max(1, playableHalf) * 1.6;
  const forestShoulder = Math.pow(sideSlope, 2.2)
    * KUPA_REGIONAL_RELIEF_METERS
    * 0.055
    * relief;
  return mountainRelief
    + forestShoulder
    + valleyUndulation
    + riverGrade
    + getEdgeHillHeight(x, z, dimensions) * relief * 0.46;
}

function sampleCustomMountainHeight(
  x: number,
  z: number,
  topography: number,
  seed: number,
  dimensions: WorldDimensions,
): number {
  const alpineStrength = smoothstep(62, 100, topography);
  if (alpineStrength <= 0) return 0;

  const { generationHalf: playableHalf } = dimensions;
  const offset = presetNoiseOffset(seed);
  const normalizedX = Math.abs(x) / playableHalf;
  const normalizedZ = Math.abs(z) / playableHalf;
  const sideMassif = Math.max(
    smoothstep(0.28, 0.94, normalizedX),
    smoothstep(0.34, 0.98, normalizedZ) * 0.82,
  );
  if (sideMassif <= 0) return 0;

  const longRidge = ridgedFbm(
    (x + offset.x) * 0.0038,
    (z + offset.z) * 0.0038,
    5,
  );
  const brokenPeaks = ridgedFbm(
    (x - offset.z) * 0.0082,
    (z + offset.x) * 0.0082,
    4,
  );
  const massifHeight = 95
    + longRidge * 350
    + Math.pow(brokenPeaks, 2.35) * 650;
  return sideMassif * Math.pow(alpineStrength, 1.25) * massifHeight;
}

function sampleRisnjakPassHeight(
  x: number,
  z: number,
  relief: number,
  seed: number,
  dimensions: WorldDimensions,
): number {
  const { generationHalf: playableHalf } = dimensions;
  const offset = presetNoiseOffset(seed);
  const angle = 0.31 + ((seed & 0xff) / 0xff - 0.5) * 0.12;
  const crossPass = x * Math.cos(angle) + z * Math.sin(angle);
  const alongPass = -x * Math.sin(angle) + z * Math.cos(angle);
  const cross = Math.abs(crossPass) / playableHalf;
  const along = Math.abs(alongPass) / playableHalf;
  const sideSlope = smoothstep(0.2, 0.86, cross);
  const endRise = smoothstep(0.56, 1.08, along) * (1 - sideSlope * 0.55);
  const ridge = ridgedFbm(
    (x + offset.x) * 0.0062,
    (z + offset.z) * 0.0062,
    5,
  );
  const crag = ridgedFbm(
    (x - offset.z) * 0.016,
    (z + offset.x) * 0.016,
    3,
  );
  const mountain = sideSlope * (54 + ridge * 62 + crag * 13) * relief;
  const saddle = endRise * (18 + ridge * 24) * relief;
  const meadow = fbm(
    (x + offset.x) * 0.008,
    (z + offset.z) * 0.008,
    4,
  ) * (2.4 + sideSlope * 4.8) * relief;
  return mountain + saddle + meadow + getEdgeHillHeight(x, z, dimensions) * relief * 0.58;
}

function sampleDelniceMeadowHeight(
  x: number,
  z: number,
  relief: number,
  seed: number,
  dimensions: WorldDimensions,
): number {
  const { terrainSize } = dimensions;
  const terrainHalf = terrainSize * 0.5;
  const offset = presetNoiseOffset(seed);
  const edge = Math.max(Math.abs(x), Math.abs(z)) / Math.max(1, terrainHalf);
  const mountainRing = smoothstep(0.62, 0.96, edge);
  const ridge = ridgedFbm(
    (x + offset.x) * 0.0046,
    (z + offset.z) * 0.0046,
    5,
  );
  const brokenPeaks = ridgedFbm(
    (x - offset.z) * 0.011,
    (z + offset.x) * 0.011,
    3,
  );
  const meadowUndulation = fbm(
    (x + offset.x) * 0.006,
    (z + offset.z) * 0.006,
    4,
  ) * 1.15;
  const mountainHeight = mountainRing * mountainRing * (
    96 + ridge * 150 + brokenPeaks * 42
  ) * relief;
  return meadowUndulation * (1 - mountainRing * 0.72) * relief
    + mountainHeight;
}

function sampleVinodolCoastHeight(
  x: number,
  z: number,
  relief: number,
  seed: number,
  dimensions: WorldDimensions,
  riverLayout: RiverLayout | null,
): number {
  const { generationHalf: playableHalf } = dimensions;
  const offset = presetNoiseOffset(seed);
  const shoreX = riverLayout?.getCoastalShoreX(z) ?? -playableHalf * 0.6;
  const inland = x - shoreX;
  const coastalNoise = fbm(
    (x + offset.x) * 0.009,
    (z + offset.z) * 0.009,
    4,
  );
  if (inland <= 0) {
    const seabedShelf = smoothstep(-playableHalf * 0.45, 0, inland) * 0.7;
    return -7.4 + seabedShelf + coastalNoise * 0.12;
  }

  const beachRise = smoothstep(0, 58, inland) * 2.8;
  const ridgeRise = smoothstep(playableHalf * 0.6, playableHalf * 1.48, inland);
  const karstRidge = ridgeRise * (
    54
    + ridgedFbm((x - offset.z) * 0.0055, (z + offset.x) * 0.0055, 5) * 48
  ) * relief;
  const shelfUndulation = coastalNoise * (1.25 + ridgeRise * 5) * relief;
  const dryTerraces = Math.sin((inland + z * 0.12) * 0.025) * ridgeRise * 2.4;
  return 0.7
    + beachRise
    + karstRidge
    + shelfUndulation
    + dryTerraces
    + getEdgeHillHeight(x, z, dimensions) * relief * ridgeRise * 0.42;
}

function sampleLicPoljeHeight(
  x: number,
  z: number,
  relief: number,
  seed: number,
  dimensions: WorldDimensions,
): number {
  const { terrainSize } = dimensions;
  const terrainHalf = terrainSize * 0.5;
  return sampleLicPoljeTerrainFields(
    x,
    z,
    { minX: -terrainHalf, maxX: terrainHalf, minZ: -terrainHalf, maxZ: terrainHalf },
    relief,
    seed,
  ).height;
}

/** Pure terrain sample used by world generation before the scene owns globals. */
export function sampleWorldRawTerrainHeight(
  x: number,
  z: number,
  settings: WorldGenerationSettings,
  dimensions: WorldDimensions,
  layout: RiverLayout | null = null,
): number {
  const basinX = layout?.drain.x ?? 0;
  const basinZ = layout?.drain.z ?? -88;
  const relief = topographyScale(settings.topography);
  if (settings.terrainPreset === 'kupa_valley') {
    return sampleKupaValleyHeight(x, z, relief, settings.seed, dimensions);
  }
  if (settings.terrainPreset === 'risnjak_pass') {
    return sampleRisnjakPassHeight(x, z, relief, settings.seed, dimensions);
  }
  if (settings.terrainPreset === 'delnice_meadow') {
    return sampleDelniceMeadowHeight(x, z, relief, settings.seed, dimensions);
  }
  if (settings.terrainPreset === 'vinodol_coast') {
    return sampleVinodolCoastHeight(x, z, relief, settings.seed, dimensions, layout);
  }
  if (settings.terrainPreset === 'lic_polje') {
    return sampleLicPoljeHeight(x, z, relief, settings.seed, dimensions);
  }
  const n1 = fbm(x * 0.014, z * 0.014, 4) * 5.6 * relief;
  const n2 = fbm(x * 0.04 + 18.4, z * 0.04 - 9.2, 3) * 1.2 * relief;
  const broad = (Math.sin(x * 0.012 + z * 0.005) * 1.35 + Math.cos(z * 0.011) * 1.0) * relief;
  const basin = -Math.exp(-((x - basinX) * (x - basinX) + (z - basinZ) * (z - basinZ)) / 62000) * 3.4 * relief;
  return n1
    + n2
    + broad
    + basin
    + getMacroDrainage(x, z) * relief
    + getEdgeHillHeight(x, z, dimensions) * relief
    + sampleCustomMountainHeight(x, z, settings.topography, settings.seed, dimensions);
}

export function sampleRawTerrainHeight(x: number, z: number): number {
  return sampleWorldRawTerrainHeight(
    x,
    z,
    getActiveWorldGeneration(),
    getActiveWorldDimensions(),
    activeRiverLayout,
  );
}

export function sampleNaturalTerrainHeight(x: number, z: number): number {
  const raw = sampleRawTerrainHeight(x, z);
  const riverLayout = activeRiverLayout;
  const quarryLayout = activeQuarryLayout;
  let height = raw;
  if (riverLayout) height -= riverLayout.getValleyDepression(x, z);
  if (quarryLayout) height -= quarryLayout.getPitDepression(x, z);
  return height;
}

export function sampleHeightWithBuildingPads(
  x: number,
  z: number,
  layout: BuildingTerrainLayout | null,
): number {
  const natural = sampleNaturalTerrainHeight(x, z);
  if (!layout || layout.sites.length === 0) return natural;
  return natural + layout.getPlatformRaise(x, z, natural);
}

export function sampleBaseTerrainHeight(x: number, z: number): number {
  const natural = sampleNaturalTerrainHeight(x, z);
  const placedLayout = activePlacedBuildingLayout;
  if (!placedLayout || placedLayout.sites.length === 0) return natural;
  return natural + placedLayout.getPlatformRaise(x, z, natural);
}
