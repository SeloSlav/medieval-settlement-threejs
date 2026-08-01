import { BuildingTerrainLayout } from '../buildings/BuildingTerrainLayout.ts';
import type { RiverLayout } from '../rivers/RiverLayout.ts';
import type { QuarryLayout } from '../quarries/QuarryLayout.ts';
import { getActiveWorldDimensions, getActiveWorldGeneration } from '../world/worldGenerationContext.ts';
import { topographyScale } from '../world/worldGenerationSettings.ts';

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

function getEdgeHillFactor(x: number, z: number): number {
  const { playableSize, terrainSize } = getActiveWorldDimensions();
  const edgeDistance = Math.max(Math.abs(x), Math.abs(z));
  const hillStart = playableSize * 0.44;
  const hillEnd = terrainSize * 0.5;
  return smoothstep(hillStart, hillEnd, edgeDistance);
}

function getEdgeHillHeight(x: number, z: number): number {
  const t = getEdgeHillFactor(x, z);
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

function sampleKupaValleyHeight(x: number, z: number, relief: number, seed: number): number {
  const { playableHalf } = getActiveWorldDimensions();
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
  const mountainRelief = sideSlope * (48 + ridge * 48) * relief;
  const valleyUndulation = fbm(
    (x + offset.x) * 0.0065,
    (z + offset.z) * 0.0065,
    4,
  ) * (1.3 + sideSlope * 4.2) * relief;
  const riverGrade = -z / Math.max(1, playableHalf) * 1.6;
  const forestShoulder = Math.pow(sideSlope, 2.2) * 18 * relief;
  return mountainRelief
    + forestShoulder
    + valleyUndulation
    + riverGrade
    + getEdgeHillHeight(x, z) * relief * 0.46;
}

function sampleRisnjakPassHeight(x: number, z: number, relief: number, seed: number): number {
  const { playableHalf } = getActiveWorldDimensions();
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
  return mountain + saddle + meadow + getEdgeHillHeight(x, z) * relief * 0.58;
}

function sampleVinodolCoastHeight(x: number, z: number, relief: number, seed: number): number {
  const { playableHalf } = getActiveWorldDimensions();
  const offset = presetNoiseOffset(seed);
  const shoreX = activeRiverLayout?.getCoastalShoreX(z) ?? -playableHalf * 0.6;
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
    + getEdgeHillHeight(x, z) * relief * ridgeRise * 0.42;
}

export function sampleRawTerrainHeight(x: number, z: number): number {
  const settings = getActiveWorldGeneration();
  const layout = activeRiverLayout;
  const basinX = layout?.drain.x ?? 0;
  const basinZ = layout?.drain.z ?? -88;
  const relief = topographyScale(settings.topography);
  if (settings.terrainPreset === 'kupa_valley') {
    return sampleKupaValleyHeight(x, z, relief, settings.seed);
  }
  if (settings.terrainPreset === 'risnjak_pass') {
    return sampleRisnjakPassHeight(x, z, relief, settings.seed);
  }
  if (settings.terrainPreset === 'vinodol_coast') {
    return sampleVinodolCoastHeight(x, z, relief, settings.seed);
  }
  const n1 = fbm(x * 0.014, z * 0.014, 4) * 5.6 * relief;
  const n2 = fbm(x * 0.04 + 18.4, z * 0.04 - 9.2, 3) * 1.2 * relief;
  const broad = (Math.sin(x * 0.012 + z * 0.005) * 1.35 + Math.cos(z * 0.011) * 1.0) * relief;
  const basin = -Math.exp(-((x - basinX) * (x - basinX) + (z - basinZ) * (z - basinZ)) / 62000) * 3.4 * relief;
  return n1 + n2 + broad + basin + getMacroDrainage(x, z) * relief + getEdgeHillHeight(x, z) * relief;
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
