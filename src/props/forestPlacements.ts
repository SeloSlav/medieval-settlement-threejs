import {
  CENTRAL_CLEARING_RADIUS,
  createForestCores,
  createForestSpawnConfig,
  distanceToNearest,
  fbm2,
  forestDensityAt,
  getEdgeHillFactor,
  hasMinimumDistance,
  isInsidePlayableExtent,
  isInsideTerrainExtent,
  mulberry32,
  pick,
  samplePointInForestCore,
  samplePointInHillEdgeBand,
  samplePointInPlayableExtent,
  type ForestCore,
  type ForestSpawnConfig,
} from './forestField.ts';

const TAU = Math.PI * 2;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

type TreePlacement = {
  x: number;
  z: number;
  species: TreeSpecies;
  form: TreeForm;
  scale: number;
};

type TreeForm = 'narrow' | 'broad' | 'young' | 'midstory';
type TreeCanopyKind = 'conifer' | 'broadleaf';
type ForestZone = 'core' | 'hillEdge' | 'sapling';

type TreeSpecies =
  | 'beech'
  | 'silverFir'
  | 'norwaySpruce'
  | 'sycamoreMaple'
  | 'norwayMaple'
  | 'ash'
  | 'wychElm'
  | 'lime'
  | 'hornbeam'
  | 'sessileOak'
  | 'scotsPine'
  | 'blackPine'
  | 'larch';

type LocalForestHabitat = {
  density: number;
  hillFactor: number;
  dampRavine: number;
  lowerWarmth: number;
  poorerGround: number;
  plantedPatch: number;
  /** Nearest forest-core conifer share; drives local evergreen vs beech mix. */
  coniferBias: number;
};

type TreeSpeciesProfile = {
  canopy: TreeCanopyKind;
  barkColor: number;
  foliageColor: number;
  heightMul: number;
  spreadMul: number;
  trunkMul: number;
  lowWhorl: number;
  crownSpan: number;
  radiusPower: number;
};

export type { TreeSpeciesProfile };

function createTreePlacements(
  rng: () => number,
  forestCores: ForestCore[],
  spawnConfig: ForestSpawnConfig,
  isBlockedAt?: (x: number, z: number) => boolean,
): TreePlacement[] {
  const placements: TreePlacement[] = [];
  let attempts = 0;

  while (placements.length < spawnConfig.treeTargetCount && attempts < spawnConfig.treeTargetCount * 48) {
    attempts++;
    const core = rng() < 0.82 ? pick(forestCores, rng) : undefined;
    const sampled = core
      ? samplePointInForestCore(core, rng)
      : samplePointInPlayableExtent(rng, spawnConfig.extent);
    const { x, z } = sampled;

    if (!isInsidePlayableExtent(x, z, spawnConfig.extent)) continue;
    if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS + rng() * 18) continue;

    const density = forestDensityAt(x, z, forestCores, spawnConfig.extent, spawnConfig.terrainExtent);
    if (density < 0.12 || rng() > density * 1.14) continue;

    const habitat = sampleLocalForestHabitat(x, z, density, spawnConfig, forestCores);
    const formNoise = valueNoise2(x * 0.025 + 37.2, z * 0.025 - 11.8);
    const species = pickTreeSpecies(rng, habitat, 'core');
    const form = pickTreeForm(rng, species, habitat, 'core', formNoise);
    const scale = pickTreeScale(rng, species, form, habitat);
    const minDistance = getTreePlacementSpacing(species, form, scale, habitat);
    if (!hasMinimumDistance(placements, x, z, minDistance)) continue;

    if (isTreePlacementBlocked(x, z, species, form, scale, isBlockedAt)) continue;

    placements.push({ x, z, species, form, scale });
  }

  return placements;
}

function createHillEdgeTreePlacements(
  rng: () => number,
  spawnConfig: ForestSpawnConfig,
  existingTrees: TreePlacement[],
  isBlockedAt?: (x: number, z: number) => boolean,
): TreePlacement[] {
  const placements: TreePlacement[] = [];
  let attempts = 0;

  while (placements.length < spawnConfig.hillEdgeTreeTargetCount && attempts < spawnConfig.hillEdgeTreeTargetCount * 52) {
    attempts++;
    const { x, z } = samplePointInHillEdgeBand(rng, spawnConfig.playableSize, spawnConfig.terrainSize);

    if (!isInsideTerrainExtent(x, z, spawnConfig.terrainExtent)) continue;

    const hillFactor = getEdgeHillFactor(x, z, spawnConfig.playableSize, spawnConfig.terrainSize);
    if (hillFactor < 0.06) continue;

    const density = forestDensityAt(x, z, [], spawnConfig.extent, spawnConfig.terrainExtent);
    if (rng() > 0.22 + hillFactor * 0.74) continue;

    const habitat = sampleLocalForestHabitat(
      x,
      z,
      clamp(density + hillFactor * 0.42, 0, 1),
      spawnConfig,
      [],
    );
    const formNoise = valueNoise2(x * 0.025 + 37.2, z * 0.025 - 11.8);
    const species = pickTreeSpecies(rng, habitat, 'hillEdge');
    const form = pickTreeForm(rng, species, habitat, 'hillEdge', formNoise);
    const scale = pickTreeScale(rng, species, form, habitat);
    const minDistance = getTreePlacementSpacing(species, form, scale, habitat) * lerp(0.9, 0.62, hillFactor);
    if (!hasMinimumDistance(placements, x, z, minDistance)) continue;
    if (distanceToNearest(existingTrees, x, z) < minDistance * 0.82) continue;

    if (isTreePlacementBlocked(x, z, species, form, scale, isBlockedAt)) continue;

    placements.push({ x, z, species, form, scale });
  }

  return placements;
}

function createSaplingPlacements(
  rng: () => number,
  forestCores: ForestCore[],
  spawnConfig: ForestSpawnConfig,
  existingTrees: TreePlacement[],
  isBlockedAt?: (x: number, z: number) => boolean,
): TreePlacement[] {
  const placements: TreePlacement[] = [];
  let attempts = 0;

  while (placements.length < spawnConfig.saplingTargetCount && attempts < spawnConfig.saplingTargetCount * 42) {
    attempts++;
    const core = pick(forestCores, rng);
    const { x, z } = samplePointInForestCore(core, rng);

    if (!isInsidePlayableExtent(x, z, spawnConfig.extent)) continue;
    if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS + 8) continue;

    const density = forestDensityAt(x, z, forestCores, spawnConfig.extent, spawnConfig.terrainExtent);
    if (density < 0.42 || rng() > density * 1.06) continue;

    const minDistance = lerp(2.8, 1.9, density);
    if (!hasMinimumDistance(placements, x, z, minDistance)) continue;
    if (distanceToNearest(existingTrees, x, z) < 2.4) continue;
    const habitat = sampleLocalForestHabitat(x, z, density, spawnConfig, forestCores);
    const species = pickTreeSpecies(rng, habitat, 'sapling');
    const form = pickTreeForm(rng, species, habitat, 'sapling', valueNoise2(x * 0.032, z * 0.032));
    const scale = pickTreeScale(rng, species, form, habitat);
    if (isTreePlacementBlocked(x, z, species, form, scale, isBlockedAt)) continue;

    placements.push({
      x,
      z,
      species,
      form,
      scale,
    });
  }

  return placements;
}

function sampleLocalForestHabitat(
  x: number,
  z: number,
  density: number,
  spawnConfig: ForestSpawnConfig,
  forestCores: ForestCore[],
): LocalForestHabitat {
  const hillFactor = getEdgeHillFactor(x, z, spawnConfig.playableSize, spawnConfig.terrainSize);
  const dampNoise = fbm2(x * 0.017 + 9.4, z * 0.017 - 12.8, 4);
  const warmNoise = fbm2(x * 0.007 - 41.6, z * 0.007 + 27.1, 3);
  const poorNoise = fbm2(x * 0.021 + 18.2, z * 0.021 - 5.7, 3);
  const plantedNoise = fbm2(x * 0.012 - 34.6, z * 0.012 + 2.1, 3);

  return {
    density,
    hillFactor,
    dampRavine: saturate(smoothstep(0.52, 0.84, dampNoise) * (1 - hillFactor * 0.34) + density * 0.16),
    lowerWarmth: saturate(smoothstep(0.48, 0.78, warmNoise) * (1 - hillFactor * 0.82)),
    poorerGround: saturate(smoothstep(0.56, 0.86, poorNoise) * (0.42 + hillFactor * 0.48)),
    plantedPatch: saturate(smoothstep(0.62, 0.88, plantedNoise) * (0.28 + hillFactor * 0.86)),
    coniferBias: sampleConiferBias(x, z, forestCores, hillFactor),
  };
}

function sampleConiferBias(
  x: number,
  z: number,
  forestCores: ForestCore[],
  hillFactor: number,
): number {
  let bias = lerp(0.48, 0.72, hillFactor);
  if (forestCores.length === 0) return bias;

  let bestScore = Infinity;
  for (const core of forestCores) {
    const dist = Math.hypot(x - core.x, z - core.z);
    const score = dist / Math.max(core.radiusX, core.radiusZ);
    if (score < bestScore) {
      bestScore = score;
      bias = core.coniferBias;
    }
  }
  return bias;
}

function pickTreeSpecies(rng: () => number, habitat: LocalForestHabitat, zone: ForestZone): TreeSpecies {
  const weights: Array<{ species: TreeSpecies; weight: number }> = [];
  const cold = habitat.hillFactor;
  const damp = habitat.dampRavine;
  const warm = habitat.lowerWarmth;
  const poor = habitat.poorerGround;
  const planted = habitat.plantedPatch;
  const edgeLight = 1 - habitat.density;
  const dry = 1 - damp;

  // Gorski Kotar mix: beech–fir in moist valleys, spruce on cold slopes, pines on karst and ridges.
  addSpeciesWeight(weights, 'beech', 28 + damp * 9 + warm * 5 - cold * 7);
  addSpeciesWeight(weights, 'silverFir', 24 + cold * 12 + damp * 9 + habitat.density * 3 - warm * 3);
  addSpeciesWeight(weights, 'norwaySpruce', 11 + cold * 16 + planted * 8 + poor * 2);
  addSpeciesWeight(weights, 'scotsPine', 3.5 + poor * 9 + edgeLight * 5 + dry * 4 + cold * 2.5);
  addSpeciesWeight(weights, 'blackPine', 2.6 + poor * 7 + cold * 4 + edgeLight * 3 + dry * 2.5);
  addSpeciesWeight(weights, 'larch', 1.8 + planted * 4.5 + cold * 1.1);
  addSpeciesWeight(weights, 'sycamoreMaple', 3.5 + damp * 8 + warm * 2);
  addSpeciesWeight(weights, 'norwayMaple', 2.4 + warm * 4.5 + edgeLight * 1.4);
  addSpeciesWeight(weights, 'ash', 1.6 + damp * 6);
  addSpeciesWeight(weights, 'wychElm', 1.2 + damp * 4.8);
  addSpeciesWeight(weights, 'lime', 1.6 + warm * 4);
  addSpeciesWeight(weights, 'hornbeam', 0.85 + warm * 5.8 + edgeLight * 1.1);
  addSpeciesWeight(weights, 'sessileOak', 0.6 + warm * 4.8 + edgeLight * 2);

  applyConiferBiasToWeights(weights, habitat.coniferBias);

  if (zone === 'hillEdge') {
    multiplySpeciesWeight(weights, 'beech', 0.52);
    multiplySpeciesWeight(weights, 'silverFir', 1.14);
    multiplySpeciesWeight(weights, 'norwaySpruce', 1.42);
    multiplySpeciesWeight(weights, 'scotsPine', 1.75);
    multiplySpeciesWeight(weights, 'blackPine', 1.65);
    multiplySpeciesWeight(weights, 'larch', 1.65);
    multiplySpeciesWeight(weights, 'sessileOak', 0.34);
    multiplySpeciesWeight(weights, 'hornbeam', 0.45);
    multiplySpeciesWeight(weights, 'lime', 0.58);
  } else if (zone === 'sapling') {
    multiplySpeciesWeight(weights, 'beech', 1.18);
    multiplySpeciesWeight(weights, 'silverFir', 1.1);
    multiplySpeciesWeight(weights, 'norwaySpruce', 0.92);
    multiplySpeciesWeight(weights, 'sycamoreMaple', 1.2);
    multiplySpeciesWeight(weights, 'hornbeam', 1.32);
    multiplySpeciesWeight(weights, 'sessileOak', 0.42);
    multiplySpeciesWeight(weights, 'scotsPine', 1.15);
    multiplySpeciesWeight(weights, 'blackPine', 1.05);
    multiplySpeciesWeight(weights, 'larch', 0.38);
  }

  return pickWeightedSpecies(weights, rng);
}

function applyConiferBiasToWeights(
  weights: Array<{ species: TreeSpecies; weight: number }>,
  coniferBias: number,
): void {
  const coniferMul = lerp(0.76, 1.34, coniferBias);
  const broadleafMul = lerp(1.2, 0.84, coniferBias);
  for (const entry of weights) {
    if (getTreeSpeciesProfile(entry.species).canopy === 'conifer') {
      entry.weight *= coniferMul;
    } else {
      entry.weight *= broadleafMul;
    }
  }
}

function addSpeciesWeight(
  weights: Array<{ species: TreeSpecies; weight: number }>,
  species: TreeSpecies,
  weight: number,
): void {
  weights.push({ species, weight: Math.max(0.04, weight) });
}

function multiplySpeciesWeight(
  weights: Array<{ species: TreeSpecies; weight: number }>,
  species: TreeSpecies,
  multiplier: number,
): void {
  const entry = weights.find((candidate) => candidate.species === species);
  if (entry) entry.weight *= multiplier;
}

function pickWeightedSpecies(
  weights: Array<{ species: TreeSpecies; weight: number }>,
  rng: () => number,
): TreeSpecies {
  const total = weights.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng() * total;
  for (const entry of weights) {
    roll -= entry.weight;
    if (roll <= 0) return entry.species;
  }
  return 'beech';
}

function pickTreeForm(
  rng: () => number,
  species: TreeSpecies,
  habitat: LocalForestHabitat,
  zone: ForestZone,
  formNoise: number,
): TreeForm {
  const profile = getTreeSpeciesProfile(species);
  if (zone === 'sapling') return profile.canopy === 'conifer' ? 'young' : 'midstory';

  const youngChance = clamp(
    0.2 - habitat.density * 0.12 + habitat.hillFactor * 0.05 + (formNoise - 0.5) * 0.08,
    0.06,
    0.24,
  );
  if (profile.canopy === 'conifer') return rng() < youngChance ? 'young' : 'narrow';

  const subcanopyBias =
    species === 'hornbeam'
      ? 0.34
      : species === 'lime' || species === 'norwayMaple'
        ? 0.16
        : species === 'ash' || species === 'wychElm'
          ? 0.1
          : 0.04;
  const midstoryChance = clamp(
    subcanopyBias + habitat.density * 0.12 + habitat.dampRavine * 0.08 - habitat.lowerWarmth * 0.04,
    0.02,
    0.42,
  );
  if (rng() < youngChance * 0.48) return 'young';
  if (rng() < midstoryChance) return 'midstory';
  return 'broad';
}

function pickTreeScale(
  rng: () => number,
  species: TreeSpecies,
  form: TreeForm,
  habitat: LocalForestHabitat,
): number {
  const profile = getTreeSpeciesProfile(species);
  if (form === 'young') {
    const highSiteMul = profile.canopy === 'conifer' ? lerp(0.96, 1.1, habitat.hillFactor) : 1;
    return lerp(0.58, 0.98, Math.pow(rng(), 0.72)) * highSiteMul;
  }
  if (form === 'midstory') {
    const dampMul = lerp(0.92, 1.12, habitat.dampRavine);
    return lerp(0.78, 1.22, Math.pow(rng(), 0.82)) * dampMul;
  }

  const densityMul = lerp(1.08, 0.94, habitat.density);
  const highSiteMul =
    profile.canopy === 'conifer'
      ? lerp(0.98, 1.1, habitat.hillFactor)
      : lerp(1.05, 0.93, habitat.hillFactor);
  const speciesScale =
    species === 'silverFir'
      ? lerp(1.04, 1.82, Math.pow(rng(), 0.66))
      : species === 'norwaySpruce'
        ? lerp(0.94, 1.66, Math.pow(rng(), 0.7))
        : species === 'beech'
          ? lerp(1.0, 1.7, Math.pow(rng(), 0.72))
          : species === 'sessileOak'
            ? lerp(0.9, 1.5, Math.pow(rng(), 0.8))
            : species === 'scotsPine'
              ? lerp(0.88, 1.48, Math.pow(rng(), 0.74))
              : species === 'blackPine'
                ? lerp(0.9, 1.42, Math.pow(rng(), 0.76))
                : species === 'larch'
                ? lerp(0.92, 1.56, Math.pow(rng(), 0.72))
                : lerp(0.86, 1.48, Math.pow(rng(), 0.78));
  return speciesScale * densityMul * highSiteMul;
}

function getTreePlacementSpacing(
  species: TreeSpecies,
  form: TreeForm,
  scale: number,
  habitat: LocalForestHabitat,
): number {
  const profile = getTreeSpeciesProfile(species);
  const canopyRadius = getEstimatedCanopyRadius(species, form, scale);
  const densitySpacing = lerp(1.08, 0.72, habitat.density);
  const formMul = form === 'young' ? 0.86 : form === 'midstory' ? 0.78 : profile.canopy === 'broadleaf' ? 1.12 : 0.96;
  const habitatMul = lerp(1.04, 0.86, habitat.hillFactor);
  return Math.max(form === 'young' || form === 'midstory' ? 2.2 : 3.4, canopyRadius * densitySpacing * formMul * habitatMul);
}

export function getEstimatedCanopyRadius(species: TreeSpecies, form: TreeForm, scale: number): number {
  const profile = getTreeSpeciesProfile(species);
  if (form === 'young') return 2.1 * scale * profile.spreadMul;
  if (form === 'midstory') return 2.5 * scale * profile.spreadMul;
  if (profile.canopy === 'broadleaf') return 4.2 * scale * profile.spreadMul;
  return 3.15 * scale * profile.spreadMul;
}

export function getTreeSpeciesProfile(species: TreeSpecies): TreeSpeciesProfile {
  switch (species) {
    case 'beech':
      return {
        canopy: 'broadleaf',
        barkColor: 0xbbb7aa,
        foliageColor: 0x6f8f53,
        heightMul: 1.04,
        spreadMul: 1.04,
        trunkMul: 0.92,
        lowWhorl: 0.5,
        crownSpan: 0.38,
        radiusPower: 0.82,
      };
    case 'silverFir':
      return {
        canopy: 'conifer',
        barkColor: 0x77766d,
        foliageColor: 0x526b45,
        heightMul: 1.18,
        spreadMul: 1.1,
        trunkMul: 1.04,
        lowWhorl: 0.16,
        crownSpan: 0.78,
        radiusPower: 1.08,
      };
    case 'norwaySpruce':
      return {
        canopy: 'conifer',
        barkColor: 0x5c5147,
        foliageColor: 0x46583f,
        heightMul: 1.1,
        spreadMul: 0.86,
        trunkMul: 0.94,
        lowWhorl: 0.13,
        crownSpan: 0.82,
        radiusPower: 1.38,
      };
    case 'sycamoreMaple':
      return {
        canopy: 'broadleaf',
        barkColor: 0x8b8679,
        foliageColor: 0x779a5a,
        heightMul: 0.98,
        spreadMul: 1.08,
        trunkMul: 0.9,
        lowWhorl: 0.46,
        crownSpan: 0.42,
        radiusPower: 0.78,
      };
    case 'norwayMaple':
      return {
        canopy: 'broadleaf',
        barkColor: 0x756f63,
        foliageColor: 0x829c54,
        heightMul: 0.9,
        spreadMul: 1.0,
        trunkMul: 0.86,
        lowWhorl: 0.45,
        crownSpan: 0.43,
        radiusPower: 0.8,
      };
    case 'ash':
      return {
        canopy: 'broadleaf',
        barkColor: 0x8f897d,
        foliageColor: 0x6d8b5c,
        heightMul: 1.02,
        spreadMul: 0.92,
        trunkMul: 0.82,
        lowWhorl: 0.55,
        crownSpan: 0.34,
        radiusPower: 0.9,
      };
    case 'wychElm':
      return {
        canopy: 'broadleaf',
        barkColor: 0x675d51,
        foliageColor: 0x5f8053,
        heightMul: 0.94,
        spreadMul: 0.98,
        trunkMul: 0.9,
        lowWhorl: 0.48,
        crownSpan: 0.4,
        radiusPower: 0.82,
      };
    case 'lime':
      return {
        canopy: 'broadleaf',
        barkColor: 0x7a7468,
        foliageColor: 0x789b58,
        heightMul: 0.86,
        spreadMul: 1.04,
        trunkMul: 0.84,
        lowWhorl: 0.43,
        crownSpan: 0.44,
        radiusPower: 0.74,
      };
    case 'hornbeam':
      return {
        canopy: 'broadleaf',
        barkColor: 0xa5a094,
        foliageColor: 0x66864f,
        heightMul: 0.72,
        spreadMul: 0.86,
        trunkMul: 0.7,
        lowWhorl: 0.38,
        crownSpan: 0.5,
        radiusPower: 0.84,
      };
    case 'sessileOak':
      return {
        canopy: 'broadleaf',
        barkColor: 0x5d5144,
        foliageColor: 0x657a43,
        heightMul: 0.9,
        spreadMul: 1.18,
        trunkMul: 1.08,
        lowWhorl: 0.42,
        crownSpan: 0.43,
        radiusPower: 0.72,
      };
    case 'scotsPine':
      return {
        canopy: 'conifer',
        barkColor: 0xa87048,
        foliageColor: 0x5a7548,
        heightMul: 1.02,
        spreadMul: 0.8,
        trunkMul: 0.84,
        lowWhorl: 0.34,
        crownSpan: 0.54,
        radiusPower: 0.96,
      };
    case 'blackPine':
      return {
        canopy: 'conifer',
        barkColor: 0x4a3d32,
        foliageColor: 0x4a6348,
        heightMul: 1.06,
        spreadMul: 0.74,
        trunkMul: 0.88,
        lowWhorl: 0.4,
        crownSpan: 0.5,
        radiusPower: 0.92,
      };
    case 'larch':
      return {
        canopy: 'conifer',
        barkColor: 0x7d5e43,
        foliageColor: 0x8fa85c,
        heightMul: 0.98,
        spreadMul: 0.82,
        trunkMul: 0.86,
        lowWhorl: 0.24,
        crownSpan: 0.7,
        radiusPower: 1.16,
      };
    default: {
      const _exhaustive: never = species;
      throw new Error(`Unhandled tree species: ${_exhaustive}`);
    }
  }
}


function isTreePlacementBlocked(
  x: number,
  z: number,
  species: TreeSpecies,
  form: TreeForm,
  scale: number,
  isBlockedAt?: (x: number, z: number) => boolean,
): boolean {
  if (!isBlockedAt) return false;
  if (isBlockedAt(x, z)) return true;
  const canopyRadius = getEstimatedCanopyRadius(species, form, scale) * 0.86;
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * TAU;
    if (isBlockedAt(x + Math.cos(angle) * canopyRadius, z + Math.sin(angle) * canopyRadius)) return true;
  }
  return false;
}

export function valueNoise2(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = noiseFade(fx);
  const sz = noiseFade(fz);
  const a = hashGrid2(ix, iz);
  const b = hashGrid2(ix + 1, iz);
  const c = hashGrid2(ix, iz + 1);
  const d = hashGrid2(ix + 1, iz + 1);
  const x0 = lerp(a, b, sx);
  const x1 = lerp(c, d, sx);
  return lerp(x0, x1, sz);
}

function hashGrid2(x: number, z: number): number {
  const value = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function noiseFade(value: number): number {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = saturate((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function saturate(value: number): number {
  return clamp(value, 0, 1);
}

export type ForestTreePlacement = TreePlacement;

/** Deterministic tree layout used by ForestManager and server world bootstrap. */
export function computeForestTreePlacements(
  playableSize = 820,
  terrainSize = 1080,
  isBlockedAt?: (x: number, z: number) => boolean,
  options?: { treeSeed?: number; densityScale?: number; forestCores?: ForestCore[] },
): ForestTreePlacement[] {
  const rng = mulberry32(options?.treeSeed ?? 0x5eedf0a5);
  const spawnConfig = createForestSpawnConfig(playableSize, terrainSize, options?.densityScale ?? 1);
  const forestCores = options?.forestCores ?? createForestCores(rng, spawnConfig);
  const treePlacements = createTreePlacements(rng, forestCores, spawnConfig, isBlockedAt);
  const hillEdgePlacements = createHillEdgeTreePlacements(rng, spawnConfig, treePlacements, isBlockedAt);
  const saplingPlacements = createSaplingPlacements(rng, forestCores, spawnConfig, treePlacements, isBlockedAt);
  return [...treePlacements, ...hillEdgePlacements, ...saplingPlacements];
}
