import type { TerrainBounds } from '../terrain/Terrain.ts';
import type { RiverLayout } from '../rivers/RiverLayout.ts';
import { hashF64 } from '../rivers/riverHash.ts';
import { CENTRAL_CLEARING_RADIUS, hasMinimumDistance, mulberry32 } from '../props/forestField.ts';

export type QuarryKind = 'large' | 'small';

export type QuarrySite = {
  x: number;
  z: number;
  rotation: number;
  kind: QuarryKind;
  radiusX: number;
  radiusZ: number;
  pitDepth: number;
};

export type QuarryLayoutOptions = {
  bounds: TerrainBounds;
  seed?: number;
  riverLayout?: RiverLayout;
  playableHalf?: number;
  /** Finite surface deposits. */
  ordinarySiteCount?: number;
  /** Deep stone sources rolled by the regional resource plan. */
  richSiteCount?: number;
};

export type SerializedQuarryLayout = {
  seed: number;
  sites: QuarrySite[];
};

const MIN_LARGE_QUARRY_SPACING = 200;
const MIN_SMALL_QUARRY_SPACING = 110;
const RIVER_AVOIDANCE_MASK = 0.08;
const RIVER_CLEARANCE = 10;
const RIVER_FOOTPRINT_SAMPLE_STEP = 4;
const PLAYABLE_EDGE_CLEARANCE = 8;
const DRAIN_AVOIDANCE_RADIUS = 130;

export class QuarryLayout {
  readonly sites: QuarrySite[];
  readonly seed: number;

  private constructor(seed: number, sites: QuarrySite[]) {
    this.seed = seed;
    this.sites = sites;
  }

  static create(options: QuarryLayoutOptions): QuarryLayout {
    const seed = options.seed ?? 0x71a2e0d;
    const playableHalf = options.playableHalf ?? 410;
    const riverLayout = options.riverLayout;
    const rng = mulberry32(seed);
    const sites: QuarrySite[] = [];

    const richSiteCount = Math.max(0, Math.min(40, Math.floor(options.richSiteCount ?? 1)));
    for (let i = 0; i < richSiteCount; i++) {
      const largeSite = pickQuarrySite(
        rng,
        seed ^ (i + 1) * 0x3539,
        playableHalf,
        riverLayout,
        sites,
        'large',
      );
      if (largeSite) sites.push(largeSite);
    }

    const ordinarySiteCount = Math.max(0, Math.min(40, Math.floor(options.ordinarySiteCount ?? 2)));
    for (let i = 0; i < ordinarySiteCount; i++) {
      const smallSite = pickQuarrySite(rng, seed ^ (i + 3) * 0x5151, playableHalf, riverLayout, sites, 'small');
      if (smallSite) sites.push(smallSite);
    }

    return new QuarryLayout(seed, sites);
  }

  static fromSerialized(data: SerializedQuarryLayout): QuarryLayout {
    return new QuarryLayout(data.seed, data.sites);
  }

  serialize(): SerializedQuarryLayout {
    return { seed: this.seed, sites: this.sites };
  }

  getPitDepression(x: number, z: number): number {
    let depression = 0;
    for (const site of this.sites) {
      const blend = sampleSiteBlend(x, z, site, 0.08, 1.02);
      if (blend <= 0) continue;
      const bowl = blend * blend * site.pitDepth;
      depression = Math.max(depression, bowl);
    }
    return depression;
  }

  getPadBlend(x: number, z: number): number {
    let blend = 0;
    for (const site of this.sites) {
      const inner = site.kind === 'large' ? 0.08 : 0.12;
      const outer = site.kind === 'large' ? 1.06 : 1.08;
      blend = Math.max(blend, sampleSiteBlend(x, z, site, inner, outer));
    }
    return blend;
  }

  isBlockedForProps(x: number, z: number): boolean {
    for (const site of this.sites) {
      const margin = site.kind === 'large' ? 1.04 : 1.06;
      if (sampleSiteBlend(x, z, site, 0, margin) >= 0.42) return true;
    }
    return false;
  }

  isBlockedForGrass(x: number, z: number): boolean {
    for (const site of this.sites) {
      const margin = site.kind === 'large' ? 1.08 : 1.12;
      if (sampleSiteBlend(x, z, site, 0, margin) >= 0.28) return true;
    }
    return false;
  }
}

function pickQuarrySite(
  rng: () => number,
  seed: number,
  playableHalf: number,
  riverLayout: RiverLayout | undefined,
  existing: QuarrySite[],
  kind: QuarryKind,
): QuarrySite | null {
  const margin = playableHalf * 0.08;
  const maxAttempts = kind === 'large' ? 280 : 220;
  const minSpacing = kind === 'large' ? MIN_LARGE_QUARRY_SPACING : MIN_SMALL_QUARRY_SPACING;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const x = (rng() * 2 - 1) * (playableHalf - margin);
    const z = (rng() * 2 - 1) * (playableHalf - margin);
    if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS + 48) continue;
    if (Math.hypot(x, z + 88) < DRAIN_AVOIDANCE_RADIUS) continue;
    if (!hasMinimumDistance(existing, x, z, minSpacing)) continue;

    const suitability = quarrySuitabilityAt(x, z, playableHalf);
    if (suitability < 0.34 || rng() > suitability * 0.94) continue;

    const rotation = hashF64(seed, attempt, kind === 'large' ? 1 : 2) * Math.PI;
    const site = createQuarrySite(kind, x, z, rotation, seed, attempt);
    if (!quarrySiteFitsPlayableArea(site, playableHalf)) continue;
    if (riverLayout && quarrySiteOverlapsRiver(site, riverLayout)) continue;
    return site;
  }

  return createFallbackSite(existing, kind, seed, playableHalf, riverLayout);
}

function createFallbackSite(
  existing: QuarrySite[],
  kind: QuarryKind,
  seed: number,
  playableHalf: number,
  riverLayout: RiverLayout | undefined,
): QuarrySite | null {
  const presets: Array<{ x: number; z: number; rotation: number }> =
    kind === 'large'
      ? [
          { x: 168, z: 142, rotation: 0.42 },
          { x: -182, z: 96, rotation: 1.18 },
          { x: 124, z: -176, rotation: 2.04 },
        ]
      : [
          { x: -148, z: -118, rotation: 0.86 },
          { x: 196, z: -64, rotation: 1.62 },
          { x: -96, z: 184, rotation: 2.38 },
        ];

  for (let i = 0; i < presets.length; i++) {
    const preset = presets[i];
    const minSpacing = kind === 'large' ? MIN_LARGE_QUARRY_SPACING : MIN_SMALL_QUARRY_SPACING;
    if (!hasMinimumDistance(existing, preset.x, preset.z, minSpacing)) continue;
    const site = createQuarrySite(kind, preset.x, preset.z, preset.rotation, seed, i + 1000);
    if (!quarrySiteFitsPlayableArea(site, playableHalf)) continue;
    if (riverLayout && quarrySiteOverlapsRiver(site, riverLayout)) continue;
    return site;
  }

  // Suitability is intentionally relaxed here, but hard constraints (dry footprint,
  // playable bounds, center clearing, and quarry spacing) are never relaxed.
  const fallbackRng = mulberry32(seed ^ (kind === 'large' ? 0x1a93f : 0x2b74d));
  const minSpacing = kind === 'large' ? MIN_LARGE_QUARRY_SPACING : MIN_SMALL_QUARRY_SPACING;
  const margin = playableHalf * 0.08;
  for (let attempt = 0; attempt < 720; attempt++) {
    const x = (fallbackRng() * 2 - 1) * (playableHalf - margin);
    const z = (fallbackRng() * 2 - 1) * (playableHalf - margin);
    if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS + 48) continue;
    if (Math.hypot(x, z + 88) < DRAIN_AVOIDANCE_RADIUS) continue;
    if (!hasMinimumDistance(existing, x, z, minSpacing)) continue;
    const rotation = hashF64(seed ^ 0x6f31, attempt, kind === 'large' ? 1 : 2) * Math.PI;
    const site = createQuarrySite(kind, x, z, rotation, seed ^ 0x4d21, attempt);
    if (!quarrySiteFitsPlayableArea(site, playableHalf)) continue;
    if (riverLayout && quarrySiteOverlapsRiver(site, riverLayout)) continue;
    return site;
  }

  return null;
}

function createQuarrySite(
  kind: QuarryKind,
  x: number,
  z: number,
  rotation: number,
  seed: number,
  attempt: number,
): QuarrySite {
  if (kind === 'large') {
    return {
      x,
      z,
      rotation,
      kind,
      radiusX: lerp(48, 64, hashF64(seed, attempt, 3)),
      radiusZ: lerp(36, 52, hashF64(seed, attempt, 4)),
      pitDepth: lerp(10.8, 14.4, hashF64(seed, attempt, 5)),
    };
  }
  return {
    x,
    z,
    rotation,
    kind,
    radiusX: lerp(24, 32, hashF64(seed, attempt, 3)),
    radiusZ: lerp(18, 26, hashF64(seed, attempt, 4)),
    pitDepth: lerp(5.4, 7.2, hashF64(seed, attempt, 5)),
  };
}

function quarrySiteFitsPlayableArea(site: QuarrySite, playableHalf: number): boolean {
  const extent = Math.hypot(site.radiusX, site.radiusZ) + RIVER_CLEARANCE + PLAYABLE_EDGE_CLEARANCE;
  return Math.abs(site.x) + extent <= playableHalf && Math.abs(site.z) + extent <= playableHalf;
}

export function quarrySiteOverlapsRiver(site: QuarrySite, riverLayout: RiverLayout): boolean {
  const radiusX = site.radiusX * 1.08 + RIVER_CLEARANCE;
  const radiusZ = site.radiusZ * 1.08 + RIVER_CLEARANCE;
  const cos = Math.cos(site.rotation);
  const sin = Math.sin(site.rotation);
  const xSteps = Math.ceil(radiusX / RIVER_FOOTPRINT_SAMPLE_STEP);
  const zSteps = Math.ceil(radiusZ / RIVER_FOOTPRINT_SAMPLE_STEP);

  for (let ix = -xSteps; ix <= xSteps; ix++) {
    const localX = ix / xSteps * radiusX;
    for (let iz = -zSteps; iz <= zSteps; iz++) {
      const localZ = iz / zSteps * radiusZ;
      if ((localX / radiusX) ** 2 + (localZ / radiusZ) ** 2 > 1) continue;
      const x = site.x + localX * cos - localZ * sin;
      const z = site.z + localX * sin + localZ * cos;
      if (riverLayout.sampleRiverMask(x, z) > RIVER_AVOIDANCE_MASK) return true;
    }
  }

  return false;
}

function quarrySuitabilityAt(x: number, z: number, playableHalf: number): number {
  const edgeDistance = Math.max(Math.abs(x), Math.abs(z));
  const ridgeBias = smoothstep(playableHalf * 0.34, playableHalf * 0.78, edgeDistance) * 0.28;
  const stoneNoise = valueNoise2(x * 0.016 + 24.6, z * 0.016 - 11.3);
  const openGround = 1 - smoothstep(0.68, 0.96, valueNoise2(x * 0.008 + 5.2, z * 0.008 - 8.4));
  return saturate(ridgeBias + stoneNoise * 0.46 + openGround * 0.18);
}

function sampleSiteBlend(
  x: number,
  z: number,
  site: QuarrySite,
  innerFade: number,
  outerFade: number,
): number {
  const dx = x - site.x;
  const dz = z - site.z;
  const cos = Math.cos(site.rotation);
  const sin = Math.sin(site.rotation);
  const localX = dx * cos + dz * sin;
  const localZ = -dx * sin + dz * cos;
  const normDist = Math.hypot(localX / site.radiusX, localZ / site.radiusZ);
  return 1 - smoothstep(innerFade, outerFade, normDist);
}

function valueNoise2(x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = x - x0;
  const tz = z - z0;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const a = hashGrid2(x0, z0);
  const b = hashGrid2(x0 + 1, z0);
  const c = hashGrid2(x0, z0 + 1);
  const d = hashGrid2(x0 + 1, z0 + 1);
  const x0Lerp = a + (b - a) * sx;
  const x1Lerp = c + (d - c) * sx;
  return x0Lerp + (x1Lerp - x0Lerp) * sz;
}

function hashGrid2(x: number, z: number): number {
  const value = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = saturate((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function saturate(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
