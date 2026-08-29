export const SUBREGION_KINDS = [
  'meadow',
  'woodland',
  'farmland',
  'rural',
  'urban',
] as const;

export type SubregionKind = (typeof SUBREGION_KINDS)[number];

export type SubregionDefinition = {
  kind: SubregionKind;
  label: string;
  color: string;
  rgb: readonly [number, number, number];
  affinity: string;
  effect: string;
  maximumBonus: number;
};

export const SUBREGION_DEFINITIONS: readonly SubregionDefinition[] = [
  {
    kind: 'meadow',
    label: 'Meadow',
    color: '#d5b84f',
    rgb: [213, 184, 79],
    affinity: 'Pollination',
    effect: 'Realm-wide apiary forage and pollination',
    maximumBonus: 0.20,
  },
  {
    kind: 'woodland',
    label: 'Woodland',
    color: '#397148',
    rgb: [57, 113, 72],
    affinity: 'Forestry',
    effect: 'Realm-wide woodcutter throughput',
    maximumBonus: 0.18,
  },
  {
    kind: 'farmland',
    label: 'Farmland',
    color: '#b8783f',
    rgb: [184, 120, 63],
    affinity: 'Cultivation',
    effect: 'Realm-wide field harvest yield',
    maximumBonus: 0.15,
  },
  {
    kind: 'rural',
    label: 'Rural',
    color: '#83a35b',
    rgb: [131, 163, 91],
    affinity: 'Husbandry',
    effect: 'Realm-wide pasture capacity and haymaking',
    maximumBonus: 0.12,
  },
  {
    kind: 'urban',
    label: 'Urban',
    color: '#8b6d88',
    rgb: [139, 109, 136],
    affinity: 'Industry',
    effect: 'Realm-wide workshop throughput',
    maximumBonus: 0.12,
  },
] as const;

export function subregionDefinition(kind: SubregionKind): SubregionDefinition {
  return SUBREGION_DEFINITIONS.find((definition) => definition.kind === kind)!;
}

/** Fraction of untouched natural land that begins as woodland. */
export function naturalWoodlandFraction(forestDensity: number): number {
  const density = Math.max(0, Math.min(100, Number.isFinite(forestDensity) ? forestDensity : 50));
  return 0.18 + density / 100 * 0.42;
}

/**
 * Broad seeded woodland/meadow field used only for the natural remainder.
 * Farmland, rural, and urban claims are layered over it from live game state.
 */
export function sampleNaturalSubregion(
  x: number,
  z: number,
  worldSeed: number,
  forestDensity: number,
): 'meadow' | 'woodland' {
  const score = naturalWoodlandField(x, z, worldSeed);
  return score < naturalWoodlandFraction(forestDensity) ? 'woodland' : 'meadow';
}

/** Exposed debug field for deterministic overlay and seed-sweep tests. */
export function naturalWoodlandField(x: number, z: number, worldSeed: number): number {
  const safeX = Number.isFinite(x) ? x : 0;
  const safeZ = Number.isFinite(z) ? z : 0;
  const seed = worldSeed >>> 0;
  const warpX = valueNoise2(safeX * 0.0017, safeZ * 0.0017, seed, 0x243f_6a88) - 0.5;
  const warpZ = valueNoise2(safeX * 0.0017, safeZ * 0.0017, seed, 0x85a3_08d3) - 0.5;
  const warpedX = safeX + warpX * 78;
  const warpedZ = safeZ + warpZ * 78;
  return 0.74 * valueNoise2(warpedX * 0.0032, warpedZ * 0.0032, seed, 0x6e62_43a1)
    + 0.26 * valueNoise2(
      warpedX * 0.0074 + 17.3,
      warpedZ * 0.0074 - 11.7,
      seed,
      0xf055_3a18,
    );
}

function valueNoise2(x: number, z: number, seed: number, salt: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fade(fx);
  const sz = fade(fz);
  const a = hashGrid2(ix, iz, seed, salt);
  const b = hashGrid2(ix + 1, iz, seed, salt);
  const c = hashGrid2(ix, iz + 1, seed, salt);
  const d = hashGrid2(ix + 1, iz + 1, seed, salt);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sz);
}

function hashGrid2(x: number, z: number, seed: number, salt: number): number {
  let hash = (seed ^ salt) >>> 0;
  hash = (hash ^ Math.imul(x | 0, 0x27d4_eb2d)) >>> 0;
  hash = (hash ^ Math.imul(z | 0, 0x1656_67b1)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb_352d) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 15), 0x846c_a68b) >>> 0;
  return ((hash ^ (hash >>> 16)) >>> 0) / 0x1_0000_0000;
}

function fade(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}
