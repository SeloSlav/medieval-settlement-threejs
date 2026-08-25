export type TerrainFieldBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type LicPoljeTerrainFieldDebugMode =
  | 'final'
  | 'floor'
  | 'rim'
  | 'fan'
  | 'drainage'
  | 'ponor'
  | 'surface'
  | 'composite';

export type LicPoljeTerrainFields = {
  floorMask: number;
  mountainRim: number;
  alluvialFan: number;
  drainageGrade: number;
  ponorBowl: number;
  surfaceUndulation: number;
  height: number;
};

export type LicPoljeHydrologyAnchors = {
  spring: { x: number; z: number };
  ponor: { x: number; z: number };
};

export const LIC_POLJE_DEBUG_QUERY_PARAMETER = 'lic-polje-debug';

// Ličko polje is a high, elongated karst basin at 695–738 m, enclosed by
// mountains rising above 1,100 m. The game condenses that real relief into a
// readable map while preserving the basin/rim relationship.
// https://www.enciklopedija.hr/clanak/licko-polje-gorski-kotar
const LIC_POLJE_FIELD_PROFILE = {
  basin: {
    longRadius: 0.78,
    crossRadius: 0.46,
    floorStart: 0.7,
    rimFull: 1.06,
  },
  rim: {
    baseHeight: 92,
    ridgeHeight: 142,
    brokenPeakHeight: 38,
  },
  floor: {
    undulationMeters: 1.7,
    drainageFallMeters: 3.1,
    alluvialFanMeters: 1.8,
    ponorBowlMeters: 1.35,
  },
  hydrology: {
    springAlong: -0.56,
    springCross: -0.11,
    ponorAlong: 0.47,
    ponorCross: 0.09,
  },
} as const;

/**
 * Shared world-space field contract for the Ličko Polje preset.
 *
 * world XZ -> seeded basin frame -> floor/rim/fan/drainage/ponor fields
 * -> terrain height, river anchors, and optional field-debug colors.
 */
export function sampleLicPoljeTerrainFields(
  x: number,
  z: number,
  bounds: TerrainFieldBounds,
  relief: number,
  seed: number,
): LicPoljeTerrainFields {
  const frame = createFrame(bounds, seed);
  const local = worldToLocal(x, z, frame);
  const along = local.along / frame.half;
  const cross = local.cross / frame.half;
  const basinRadius = Math.hypot(
    along / LIC_POLJE_FIELD_PROFILE.basin.longRadius,
    cross / LIC_POLJE_FIELD_PROFILE.basin.crossRadius,
  );
  const mountainRim = smoothstep(
    LIC_POLJE_FIELD_PROFILE.basin.floorStart,
    LIC_POLJE_FIELD_PROFILE.basin.rimFull,
    basinRadius,
  );
  const floorMask = 1 - smoothstep(0.68, 1.02, basinRadius);

  const offset = seedNoiseOffset(seed);
  const rimRidge = ridgedFbm(
    (x + offset.x) * 0.0047,
    (z + offset.z) * 0.0047,
    5,
    seed ^ 0x4c31,
  );
  const brokenPeaks = ridgedFbm(
    (x - offset.z) * 0.011,
    (z + offset.x) * 0.011,
    3,
    seed ^ 0x19c7,
  );
  const surfaceUndulation = fbm01(
    (x + offset.x) * 0.0062,
    (z + offset.z) * 0.0062,
    4,
    seed ^ 0x2371,
  );

  const alluvialFan = ellipticalInfluence(
    along - LIC_POLJE_FIELD_PROFILE.hydrology.springAlong,
    cross - LIC_POLJE_FIELD_PROFILE.hydrology.springCross,
    0.24,
    0.2,
  ) * floorMask;
  const ponorBowl = ellipticalInfluence(
    along - LIC_POLJE_FIELD_PROFILE.hydrology.ponorAlong,
    cross - LIC_POLJE_FIELD_PROFILE.hydrology.ponorCross,
    0.12,
    0.105,
  ) * floorMask;
  const drainageGrade = clamp01(
    (LIC_POLJE_FIELD_PROFILE.hydrology.ponorAlong - along)
      / (LIC_POLJE_FIELD_PROFILE.hydrology.ponorAlong
        - LIC_POLJE_FIELD_PROFILE.hydrology.springAlong),
  );

  const rimHeight = Math.pow(mountainRim, 1.85) * (
    LIC_POLJE_FIELD_PROFILE.rim.baseHeight
    + rimRidge * LIC_POLJE_FIELD_PROFILE.rim.ridgeHeight
    + brokenPeaks * LIC_POLJE_FIELD_PROFILE.rim.brokenPeakHeight
  ) * relief;
  const floorHeight = (
    (surfaceUndulation - 0.5) * LIC_POLJE_FIELD_PROFILE.floor.undulationMeters
    + drainageGrade * LIC_POLJE_FIELD_PROFILE.floor.drainageFallMeters
    + alluvialFan * LIC_POLJE_FIELD_PROFILE.floor.alluvialFanMeters
    - ponorBowl * LIC_POLJE_FIELD_PROFILE.floor.ponorBowlMeters
  ) * (1 - mountainRim * 0.62) * relief;

  return {
    floorMask,
    mountainRim,
    alluvialFan,
    drainageGrade,
    ponorBowl,
    surfaceUndulation,
    height: rimHeight + floorHeight,
  };
}

export function createLicPoljeHydrologyAnchors(
  bounds: TerrainFieldBounds,
  seed: number,
): LicPoljeHydrologyAnchors {
  const frame = createFrame(bounds, seed);
  return {
    spring: localToWorld(
      LIC_POLJE_FIELD_PROFILE.hydrology.springAlong * frame.half,
      LIC_POLJE_FIELD_PROFILE.hydrology.springCross * frame.half,
      frame,
    ),
    ponor: localToWorld(
      LIC_POLJE_FIELD_PROFILE.hydrology.ponorAlong * frame.half,
      LIC_POLJE_FIELD_PROFILE.hydrology.ponorCross * frame.half,
      frame,
    ),
  };
}

/** Maps a named field to the existing three terrain-family channels. */
export function licPoljeTerrainDebugWeights(
  fields: LicPoljeTerrainFields,
  mode: LicPoljeTerrainFieldDebugMode,
): readonly [number, number, number] | null {
  if (mode === 'final') return null;
  if (mode === 'composite') {
    return normalizeWeights([
      fields.floorMask,
      fields.mountainRim,
      Math.max(fields.alluvialFan, fields.ponorBowl),
    ]);
  }
  const value = mode === 'floor'
    ? fields.floorMask
    : mode === 'rim'
      ? fields.mountainRim
      : mode === 'fan'
        ? fields.alluvialFan
        : mode === 'drainage'
          ? fields.drainageGrade
          : mode === 'ponor'
            ? fields.ponorBowl
            : fields.surfaceUndulation;
  return normalizeWeights([1 - value, 0.025, value]);
}

export function parseLicPoljeTerrainFieldDebugMode(
  search: string,
): LicPoljeTerrainFieldDebugMode {
  const raw = new URLSearchParams(search).get(LIC_POLJE_DEBUG_QUERY_PARAMETER);
  switch (raw) {
    case 'floor':
    case 'rim':
    case 'fan':
    case 'drainage':
    case 'ponor':
    case 'surface':
    case 'composite':
      return raw;
    default:
      return 'final';
  }
}

type LicPoljeFrame = {
  centerX: number;
  centerZ: number;
  half: number;
  alongX: number;
  alongZ: number;
  crossX: number;
  crossZ: number;
};

function createFrame(bounds: TerrainFieldBounds, seed: number): LicPoljeFrame {
  const angle = -0.58 + ((((seed >>> 9) & 0xff) / 0xff) - 0.5) * 0.1;
  const alongX = Math.cos(angle);
  const alongZ = Math.sin(angle);
  return {
    centerX: (bounds.minX + bounds.maxX) * 0.5,
    centerZ: (bounds.minZ + bounds.maxZ) * 0.5,
    half: Math.min(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) * 0.5,
    alongX,
    alongZ,
    crossX: -alongZ,
    crossZ: alongX,
  };
}

function worldToLocal(
  x: number,
  z: number,
  frame: LicPoljeFrame,
): { along: number; cross: number } {
  const dx = x - frame.centerX;
  const dz = z - frame.centerZ;
  return {
    along: dx * frame.alongX + dz * frame.alongZ,
    cross: dx * frame.crossX + dz * frame.crossZ,
  };
}

function localToWorld(
  along: number,
  cross: number,
  frame: LicPoljeFrame,
): { x: number; z: number } {
  return {
    x: frame.centerX + frame.alongX * along + frame.crossX * cross,
    z: frame.centerZ + frame.alongZ * along + frame.crossZ * cross,
  };
}

function seedNoiseOffset(seed: number): { x: number; z: number } {
  return {
    x: ((seed >>> 4) & 0xfff) * 0.017,
    z: ((seed >>> 16) & 0xfff) * 0.019,
  };
}

function ellipticalInfluence(
  x: number,
  z: number,
  radiusX: number,
  radiusZ: number,
): number {
  const distanceSq = (x / radiusX) ** 2 + (z / radiusZ) ** 2;
  return Math.exp(-distanceSq * 2.1);
}

function fbm01(x: number, z: number, octaves: number, seed: number): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave++) {
    value += valueNoise(x * frequency, z * frequency, seed + octave * 0x131) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return value / Math.max(norm, 1e-6);
}

function ridgedFbm(x: number, z: number, octaves: number, seed: number): number {
  const base = fbm01(x, z, octaves, seed);
  const ridge = 1 - Math.abs(base * 2 - 1);
  return ridge * ridge;
}

function valueNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = smoothCurve(x - x0);
  const tz = smoothCurve(z - z0);
  const a = hash2(x0, z0, seed);
  const b = hash2(x0 + 1, z0, seed);
  const c = hash2(x0, z0 + 1, seed);
  const d = hash2(x0 + 1, z0 + 1, seed);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}

function hash2(x: number, z: number, seed: number): number {
  let value = Math.imul(x ^ seed, 0x45d9f3b) ^ Math.imul(z ^ (seed >>> 7), 0x27d4eb2d);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  return (value >>> 0) / 0xffff_ffff;
}

function normalizeWeights(
  weights: readonly [number, number, number],
): readonly [number, number, number] {
  const sum = Math.max(1e-6, weights[0] + weights[1] + weights[2]);
  return [weights[0] / sum, weights[1] / sum, weights[2] / sum];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  return smoothCurve(clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0)));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
