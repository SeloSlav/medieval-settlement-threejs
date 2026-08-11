import type { TerrainBounds } from '../terrain/Terrain.ts';
import type { WorldTerrainPreset } from '../world/worldTerrainPresets.ts';
import { hashF64 } from './riverHash.ts';

export type RiverPoint = {
  x: number;
  z: number;
  progress: number;
  halfWidth: number;
  channelDepth: number;
};

export type RiverCorridor = {
  points: RiverPoint[];
};

export type InlandWaterBodyKind = 'pond' | 'lake';

export type InlandWaterBody = {
  x: number;
  z: number;
  radiusX: number;
  radiusZ: number;
  rotation: number;
  depth: number;
  kind: InlandWaterBodyKind;
};

export type RiverLayoutOptions = {
  bounds: TerrainBounds;
  seed?: number;
  riverCount?: number;
  tributaryCount?: number;
  drain?: { x: number; z: number };
  terrainPreset?: WorldTerrainPreset;
};

export type SerializedRiverLayout = {
  bounds: TerrainBounds;
  seed: number;
  drain: { x: number; z: number };
  terrainPreset?: WorldTerrainPreset;
  corridors: RiverCorridor[];
  inlandWaterBodies?: InlandWaterBody[];
};

const TAU = Math.PI * 2;
const CONFLUENCE_LAKE_RADIUS = 54;
const GENERATION_TO_TERRAIN_RATIO = 820 / 1080;
const SEGMENT_CELL_SIZE = 32;

type IndexedRiverSegment = {
  a: RiverPoint;
  b: RiverPoint;
};

export class RiverLayout {
  readonly corridors: RiverCorridor[];
  readonly inlandWaterBodies: readonly InlandWaterBody[];
  readonly drain: { x: number; z: number };
  readonly seed: number;
  readonly terrainPreset: WorldTerrainPreset;
  private readonly bounds: TerrainBounds;
  private readonly segmentCells: Map<string, IndexedRiverSegment[]>;

  private constructor(
    bounds: TerrainBounds,
    seed: number,
    drain: { x: number; z: number },
    corridors: RiverCorridor[],
    inlandWaterBodies: InlandWaterBody[],
    terrainPreset: WorldTerrainPreset = 'custom',
  ) {
    this.bounds = bounds;
    this.seed = seed;
    this.drain = drain;
    this.corridors = corridors;
    this.inlandWaterBodies = inlandWaterBodies;
    this.terrainPreset = terrainPreset;
    this.segmentCells = buildRiverSegmentCells(corridors);
  }

  static create(options: RiverLayoutOptions): RiverLayout {
    const seed = options.seed ?? 0x7e57e1e;
    const bounds = options.bounds;
    const riverCount = options.riverCount ?? 4;
    const tributaryCount = options.tributaryCount ?? 1;
    const drain = options.drain ?? { x: 0, z: -88 };
    const terrainPreset = options.terrainPreset ?? 'custom';

    if (terrainPreset === 'kupa_valley') {
      const corridor = buildKupaCorridor(bounds, seed);
      const mouth = corridor.points[corridor.points.length - 1];
      return new RiverLayout(
        bounds,
        seed,
        mouth ? { x: mouth.x, z: mouth.z } : drain,
        [corridor],
        [],
        terrainPreset,
      );
    }

    if (terrainPreset === 'vinodol_coast') {
      const coastalDrain = {
        x: coastalShoreX(bounds, seed, (bounds.minZ + bounds.maxZ) * 0.5),
        z: (bounds.minZ + bounds.maxZ) * 0.5,
      };
      return new RiverLayout(bounds, seed, coastalDrain, [], [], terrainPreset);
    }

    if (terrainPreset === 'delnice_meadow') {
      return new RiverLayout(
        bounds,
        seed,
        drain,
        [],
        [buildDelnicePond(bounds, seed)],
        terrainPreset,
      );
    }

    const corridors: RiverCorridor[] = [];
    for (let i = 0; i < riverCount; i++) {
      const jitter = hashF64(seed ^ 0x5151, i, 0) * 0.22 - 0.11;
      const edgeAngle = (i / riverCount) * TAU + jitter;
      const mountainAngle = -Math.PI * 0.5 + (hashF64(seed ^ 0x7171, i, 2) - 0.5) * Math.PI * 0.95;
      const angle = mountainAngle * 0.58 + edgeAngle * 0.42;
      const start = pointOnBoundsEdge(angle, bounds);
      corridors.push(buildCorridor(start, drain, seed ^ (i + 1) * 0x1337, i));
    }

    if (tributaryCount > 0 && corridors.length > 0) {
      for (let i = 0; i < tributaryCount; i++) {
        const parent = corridors[i % corridors.length];
        const branchPoint = parent.points[Math.floor(parent.points.length * (0.36 + i * 0.08))];
        if (!branchPoint) continue;
        const angle = hashF64(seed ^ 0x9393, i, 2) * TAU;
        const start = {
          x: branchPoint.x + Math.cos(angle) * 58,
          z: branchPoint.z + Math.sin(angle) * 58,
        };
        const tributary = buildCorridor(start, drain, seed ^ (i + 11) * 0x2424, i + 100, 0.62);
        if (tributary.points.length > 30) corridors.push(tributary);
      }
    }

    return new RiverLayout(
      bounds,
      seed,
      drain,
      corridors,
      [buildConfluenceLake(drain)],
      terrainPreset,
    );
  }

  static fromSerialized(data: SerializedRiverLayout): RiverLayout {
    return new RiverLayout(
      data.bounds,
      data.seed,
      data.drain,
      data.corridors,
      data.inlandWaterBodies ?? defaultInlandWaterBodies(
        data.bounds,
        data.seed,
        data.drain,
        data.terrainPreset ?? 'custom',
      ),
      data.terrainPreset ?? 'custom',
    );
  }

  serialize(): SerializedRiverLayout {
    return {
      bounds: this.bounds,
      seed: this.seed,
      drain: this.drain,
      terrainPreset: this.terrainPreset,
      corridors: this.corridors,
      inlandWaterBodies: [...this.inlandWaterBodies],
    };
  }

  getValleyDepression(x: number, z: number): number {
    const inlandWater = this.sampleInlandWater(x, z);
    const hit = this.sampleCorridor(x, z);
    const corridorDepth = hit
      ? (1 - smoothstep(hit.halfWidth * 0.28, hit.halfWidth * 0.95, hit.distance)) *
        hit.channelDepth *
        (1 - smoothstep(hit.halfWidth * 0.28, hit.halfWidth * 0.95, hit.distance))
      : 0;
    return Math.max(inlandWater.depth, corridorDepth);
  }

  sampleRiverMask(x: number, z: number): number {
    const inlandWater = this.sampleInlandWater(x, z);
    const hit = this.sampleCorridor(x, z);
    const corridorMask = hit
      ? 1 - smoothstep(hit.halfWidth * 0.28, hit.halfWidth * 0.72, hit.distance)
      : 0;
    const coastMask = this.terrainPreset === 'vinodol_coast'
      ? sampleCoastalSea(x, z, this.bounds, this.seed)
      : 0;
    return Math.max(inlandWater.mask, corridorMask, coastMask);
  }

  sampleInlandWaterMask(x: number, z: number): number {
    return this.sampleInlandWater(x, z).mask;
  }

  isInlandWaterAt(x: number, z: number): boolean {
    return this.sampleInlandWaterMask(x, z) >= 0.48;
  }

  getCoastalShoreX(z: number): number | null {
    return this.terrainPreset === 'vinodol_coast'
      ? coastalShoreX(this.bounds, this.seed, z)
      : null;
  }

  getWaterSurfaceOverride(_x: number, _z: number): number | null {
    return this.terrainPreset === 'vinodol_coast' ? -4.4 : null;
  }

  isWaterAt(x: number, z: number): boolean {
    return this.sampleRiverMask(x, z) >= 0.48;
  }

  /** Unit vector along the nearest river corridor segment (downstream). */
  sampleFlowDirection(x: number, z: number): { dx: number; dz: number } | null {
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestHalfWidth = 0;
    let bestDx = 0;
    let bestDz = 0;

    for (const { a, b } of this.segmentsAt(x, z)) {
      const hit = distanceToSegment(x, z, a.x, a.z, b.x, b.z);
      if (hit.distance >= bestDistance) continue;
      bestDistance = hit.distance;
      bestHalfWidth = lerp(a.halfWidth, b.halfWidth, hit.t);
      const segDx = b.x - a.x;
      const segDz = b.z - a.z;
      const segLen = Math.hypot(segDx, segDz);
      if (segLen > 1e-6) {
        bestDx = segDx / segLen;
        bestDz = segDz / segLen;
      }
    }

    if (!Number.isFinite(bestDistance) || bestDistance > bestHalfWidth * 0.95) return null;
    const len = Math.hypot(bestDx, bestDz);
    if (len < 1e-6) return null;
    return { dx: bestDx / len, dz: bestDz / len };
  }

  buildRiverMaskGrid(resolution: number): Float32Array {
    const mask = new Float32Array(resolution * resolution);
    const spanX = this.bounds.maxX - this.bounds.minX;
    const spanZ = this.bounds.maxZ - this.bounds.minZ;
    const stepX = spanX / (resolution - 1);
    const stepZ = spanZ / (resolution - 1);

    for (let iz = 0; iz < resolution; iz++) {
      for (let ix = 0; ix < resolution; ix++) {
        const x = this.bounds.minX + ix * stepX;
        const z = this.bounds.minZ + iz * stepZ;
        mask[iz * resolution + ix] = this.sampleRiverMask(x, z);
      }
    }
    return mask;
  }

  private sampleCorridor(
    x: number,
    z: number,
  ): { distance: number; halfWidth: number; channelDepth: number; progress: number } | null {
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestHalfWidth = 0;
    let bestDepth = 0;
    let bestProgress = 0;

    for (const { a, b } of this.segmentsAt(x, z)) {
      const hit = distanceToSegment(x, z, a.x, a.z, b.x, b.z);
      if (hit.distance >= bestDistance) continue;
      bestDistance = hit.distance;
      bestHalfWidth = lerp(a.halfWidth, b.halfWidth, hit.t);
      bestDepth = lerp(a.channelDepth, b.channelDepth, hit.t);
      bestProgress = lerp(a.progress, b.progress, hit.t);
    }

    if (!Number.isFinite(bestDistance) || bestDistance > bestHalfWidth * 0.95) return null;
    return {
      distance: bestDistance,
      halfWidth: bestHalfWidth,
      channelDepth: bestDepth,
      progress: bestProgress,
    };
  }

  private sampleInlandWater(x: number, z: number): { mask: number; depth: number } {
    let mask = 0;
    let depth = 0;
    for (let index = 0; index < this.inlandWaterBodies.length; index++) {
      const sample = sampleInlandWaterBody(
        x,
        z,
        this.inlandWaterBodies[index],
        index === 0 ? this.seed : this.seed ^ Math.imul(index, 0x45d9f3b),
      );
      mask = Math.max(mask, sample.mask);
      depth = Math.max(depth, sample.depth);
    }
    return { mask, depth };
  }

  private segmentsAt(x: number, z: number): ReadonlyArray<IndexedRiverSegment> {
    return this.segmentCells.get(segmentCellKey(
      Math.floor(x / SEGMENT_CELL_SIZE),
      Math.floor(z / SEGMENT_CELL_SIZE),
    )) ?? [];
  }
}

function buildKupaCorridor(bounds: TerrainBounds, seed: number): RiverCorridor {
  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  const centerX = (bounds.minX + bounds.maxX) * 0.5 - spanX * 0.09;
  const pointCount = Math.max(2, Math.ceil(spanZ / 2.6) + 1);
  const phase = hashF64(seed ^ 0x6b75, 1, 7) * TAU;
  const points: RiverPoint[] = [];

  for (let index = 0; index < pointCount; index++) {
    const progress = index / (pointCount - 1);
    const z = lerp(bounds.maxZ, bounds.minZ, progress);
    const broadMeander = Math.sin(progress * TAU * 1.28 + phase) * spanX * 0.014;
    const localMeander = Math.sin(progress * TAU * 4.1 - phase * 0.7) * spanX * 0.0045;
    const widthNoise = hashF64(seed ^ 0x4b50, Math.floor(progress * 24), 3);
    points.push({
      x: centerX + broadMeander + localMeander,
      z,
      progress,
      halfWidth: 25 + widthNoise * 10,
      channelDepth: 2.15 + widthNoise * 0.7,
    });
  }
  return { points };
}

function coastalShoreX(bounds: TerrainBounds, seed: number, z: number): number {
  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  const normalizedZ = (z - bounds.minZ) / Math.max(1, spanZ);
  const phase = hashF64(seed ^ 0x560d, 4, 9) * TAU;
  const broad = Math.sin(normalizedZ * TAU * 1.35 + phase) * spanX * 0.018;
  const coves = Math.sin(normalizedZ * TAU * 3.7 - phase * 0.55) * spanX * 0.007;
  // Keep the authored Adriatic frontage at a stable share of the full map
  // across every supported size.
  return bounds.minX + spanX * 0.272 + broad + coves;
}

function sampleCoastalSea(
  x: number,
  z: number,
  bounds: TerrainBounds,
  seed: number,
): number {
  const shoreX = coastalShoreX(bounds, seed, z);
  return 1 - smoothstep(shoreX - 5, shoreX + 2.5, x);
}

function buildRiverSegmentCells(
  corridors: ReadonlyArray<RiverCorridor>,
): Map<string, IndexedRiverSegment[]> {
  const cells = new Map<string, IndexedRiverSegment[]>();
  for (const corridor of corridors) {
    for (let i = 0; i < corridor.points.length - 1; i++) {
      const segment = {
        a: corridor.points[i],
        b: corridor.points[i + 1],
      };
      const reach = Math.max(segment.a.halfWidth, segment.b.halfWidth) * 0.95;
      const minCellX = Math.floor((Math.min(segment.a.x, segment.b.x) - reach) / SEGMENT_CELL_SIZE);
      const maxCellX = Math.floor((Math.max(segment.a.x, segment.b.x) + reach) / SEGMENT_CELL_SIZE);
      const minCellZ = Math.floor((Math.min(segment.a.z, segment.b.z) - reach) / SEGMENT_CELL_SIZE);
      const maxCellZ = Math.floor((Math.max(segment.a.z, segment.b.z) + reach) / SEGMENT_CELL_SIZE);
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
        for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
          const key = segmentCellKey(cellX, cellZ);
          const bucket = cells.get(key);
          if (bucket) bucket.push(segment);
          else cells.set(key, [segment]);
        }
      }
    }
  }
  return cells;
}

function segmentCellKey(cellX: number, cellZ: number): string {
  return `${cellX},${cellZ}`;
}

function buildCorridor(
  start: { x: number; z: number },
  drain: { x: number; z: number },
  seed: number,
  riverIndex: number,
  scale = 1,
): RiverCorridor {
  const controlCount = 11;
  const dx = drain.x - start.x;
  const dz = drain.z - start.z;
  const length = Math.max(1, Math.hypot(dx, dz));
  const perpX = -dz / length;
  const perpZ = dx / length;
  const upstreamReach = Math.min(140, length * 0.2);
  const upstream = {
    x: start.x - (dx / length) * upstreamReach,
    z: start.z - (dz / length) * upstreamReach,
  };
  const controls: Array<{ x: number; z: number }> = [upstream, start];

  for (let i = 1; i < controlCount; i++) {
    const t = i / controlCount;
    const baseX = start.x + dx * t;
    const baseZ = start.z + dz * t;
    const convergence = smoothstep(0.68, 1, t);
    const upstreamDamp = 1 - smoothstep(0, 0.24, t) * 0.82;
    const meanderEnvelope =
      Math.sin(t * Math.PI) * (72 + hashF64(seed ^ 0x6161, i, riverIndex) * 48) * scale * (1 - convergence * 0.88) * upstreamDamp;
    const waveA = Math.sin(t * (7.4 + riverIndex * 0.31) + seed * 0.002) * 0.58;
    const waveB = Math.sin(t * (12.8 + riverIndex * 0.17) - seed * 0.003) * 0.42;
    const offset = meanderEnvelope * (waveA + waveB);
    controls.push({
      x: baseX + perpX * offset,
      z: baseZ + perpZ * offset,
    });
  }
  controls.push(drain);

  const dense = catmullRomSamples(controls, 12);
  const resampled = resampleByDistance(dense, 2.6);
  const points: RiverPoint[] = resampled.map((point, index) => {
    const progress = index / Math.max(1, resampled.length - 1);
    let halfWidth = lerp(2.4, 12, Math.pow(progress, 0.68)) * scale;
    const headwaterBlend = 1 - smoothstep(0, 0.18, progress);
    halfWidth = lerp(halfWidth, Math.max(halfWidth, 8.5 * scale), headwaterBlend);
    let channelDepth = lerp(0.9, 2.65, Math.pow(progress, 0.82)) * scale;
    channelDepth = lerp(channelDepth, Math.max(channelDepth, 1.65 * scale), headwaterBlend * 0.75);
    const distToDrain = Math.hypot(point.x - drain.x, point.z - drain.z);
    const mouthBlend = 1 - smoothstep(0, 130, distToDrain);
    halfWidth = lerp(halfWidth, 26, mouthBlend * 0.82);
    channelDepth = lerp(channelDepth, 3.65, mouthBlend * 0.6);
    return { x: point.x, z: point.z, progress, halfWidth, channelDepth };
  });

  return { points };
}

function pointOnBoundsEdge(angle: number, bounds: TerrainBounds): { x: number; z: number } {
  const cx = (bounds.minX + bounds.maxX) * 0.5;
  const cz = (bounds.minZ + bounds.maxZ) * 0.5;
  const halfX = (bounds.maxX - bounds.minX) * 0.5;
  const halfZ = (bounds.maxZ - bounds.minZ) * 0.5;
  const dx = Math.cos(angle);
  const dz = Math.sin(angle);
  let t = Number.POSITIVE_INFINITY;
  if (Math.abs(dx) > 1e-6) t = Math.min(t, halfX / Math.abs(dx));
  if (Math.abs(dz) > 1e-6) t = Math.min(t, halfZ / Math.abs(dz));
  return { x: cx + dx * t, z: cz + dz * t };
}

function resampleByDistance(
  points: Array<{ x: number; z: number }>,
  spacing: number,
): Array<{ x: number; z: number }> {
  if (points.length < 2) return points.slice();
  const out: Array<{ x: number; z: number }> = [points[0]];
  let carry = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.z - a.z);
    if (segLen <= 1e-4) continue;

    let traveled = spacing - carry;
    while (traveled < segLen) {
      const t = traveled / segLen;
      out.push({
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
      });
      traveled += spacing;
    }
    carry = segLen - (traveled - spacing);
  }

  out.push(points[points.length - 1]);
  return out;
}

function buildConfluenceLake(
  drain: { x: number; z: number },
): InlandWaterBody {
  return {
    x: drain.x,
    z: drain.z,
    radiusX: CONFLUENCE_LAKE_RADIUS,
    radiusZ: CONFLUENCE_LAKE_RADIUS,
    rotation: 0,
    depth: 4.1,
    kind: 'lake',
  };
}

function buildDelnicePond(bounds: TerrainBounds, seed: number): InlandWaterBody {
  const terrainHalf = Math.min(
    bounds.maxX - bounds.minX,
    bounds.maxZ - bounds.minZ,
  ) * 0.5;
  const generationHalf = terrainHalf * GENERATION_TO_TERRAIN_RATIO;
  const angle = hashF64(seed ^ 0x4310, 7, 13) * TAU;
  const distance = generationHalf * (0.62 + hashF64(seed ^ 0x2d71, 5, 11) * 0.06);
  const baseRadius = Math.max(32, Math.min(46, generationHalf * 0.105));
  return {
    x: Math.cos(angle) * distance,
    z: Math.sin(angle) * distance,
    radiusX: baseRadius * (1.08 + hashF64(seed ^ 0x4a91, 3, 17) * 0.18),
    radiusZ: baseRadius * (0.78 + hashF64(seed ^ 0x37c5, 9, 19) * 0.16),
    rotation: hashF64(seed ^ 0x6e21, 11, 23) * Math.PI,
    depth: 3.2 + hashF64(seed ^ 0x51a7, 13, 29) * 0.9,
    kind: 'pond',
  };
}

function defaultInlandWaterBodies(
  bounds: TerrainBounds,
  seed: number,
  drain: { x: number; z: number },
  terrainPreset: WorldTerrainPreset,
): InlandWaterBody[] {
  if (terrainPreset === 'delnice_meadow') return [buildDelnicePond(bounds, seed)];
  if (terrainPreset === 'kupa_valley' || terrainPreset === 'vinodol_coast') return [];
  return [buildConfluenceLake(drain)];
}

function sampleInlandWaterBody(
  x: number,
  z: number,
  body: InlandWaterBody,
  seed: number,
): { mask: number; depth: number } {
  const dx = x - body.x;
  const dz = z - body.z;
  const cos = Math.cos(body.rotation);
  const sin = Math.sin(body.rotation);
  const localX = dx * cos + dz * sin;
  const localZ = -dx * sin + dz * cos;
  const normalizedDistance = Math.hypot(
    localX / Math.max(1, body.radiusX),
    localZ / Math.max(1, body.radiusZ),
  );
  const meanRadius = Math.sqrt(body.radiusX * body.radiusZ);
  const shoreNoise =
    (valueNoise2D(x * 0.045 + seed * 0.001, z * 0.045 - 6.8, seed) - 0.5) * 9 +
    (valueNoise2D(x * 0.11 - 3.2, z * 0.11 + 8.1, seed ^ 0x33) - 0.5) * 4;
  const shoreScale = Math.max(0.2, 1 + shoreNoise / Math.max(1, meanRadius));
  const distance = normalizedDistance / shoreScale;
  if (distance > 1.05) return { mask: 0, depth: 0 };
  const mask = 1 - smoothstep(0.2, 1, distance);
  const depth = (1 - smoothstep(0.15, 1, distance)) * body.depth;
  return { mask, depth };
}

function valueNoise2D(x: number, z: number, seed = 0): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hashF64(seed, x0, z0);
  const b = hashF64(seed, x0 + 1, z0);
  const c = hashF64(seed, x0, z0 + 1);
  const d = hashF64(seed, x0 + 1, z0 + 1);
  const ab = a + (b - a) * ux;
  const cd = c + (d - c) * ux;
  return ab + (cd - ab) * uz;
}

function catmullRomSamples(
  controls: Array<{ x: number; z: number }>,
  samplesPerSegment: number,
): Array<{ x: number; z: number }> {
  if (controls.length < 2) return controls.slice();
  const out: Array<{ x: number; z: number }> = [];

  for (let i = 0; i < controls.length - 1; i++) {
    const p0 = controls[Math.max(0, i - 1)];
    const p1 = controls[i];
    const p2 = controls[i + 1];
    const p3 = controls[Math.min(controls.length - 1, i + 2)];
    for (let s = 0; s < samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      out.push(catmullRom(p0, p1, p2, p3, t));
    }
  }
  out.push(controls[controls.length - 1]);
  return out;
}

function catmullRom(
  p0: { x: number; z: number },
  p1: { x: number; z: number },
  p2: { x: number; z: number },
  p3: { x: number; z: number },
  t: number,
): { x: number; z: number } {
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x:
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    z:
      0.5 *
      (2 * p1.z +
        (-p0.z + p2.z) * t +
        (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
        (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
  };
}

function distanceToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): { distance: number; t: number } {
  const abx = bx - ax;
  const abz = bz - az;
  const lenSq = abx * abx + abz * abz;
  const t = lenSq <= 1e-6 ? 0 : clamp01(((px - ax) * abx + (pz - az) * abz) / lenSq);
  const cx = ax + abx * t;
  const cz = az + abz * t;
  return { distance: Math.hypot(px - cx, pz - cz), t };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
}
