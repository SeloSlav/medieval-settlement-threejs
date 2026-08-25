// Project-owned SeedThree preset for common dogwood (Cornus sanguinea).
//
// Dogwood is not a miniature single-trunk tree. Mature woodland-edge plants
// continually renew a stool of slender basal shoots, producing an upright,
// outward-arching thicket with opposite leaves. Keeping that morphology here
// makes the three production prototypes reproducible without adding files to
// the SeedThree vendor submodule.

export const COMMON_DOGWOOD_BRANCH_ALBEDO = 'common_dogwood_branch_albedo.png';
export const COMMON_DOGWOOD_SINGLE_ALBEDO = 'common_dogwood_single_albedo.png';

export const COMMON_DOGWOOD_BRANCH_TEXTURE_FILES = {
  albedo: COMMON_DOGWOOD_BRANCH_ALBEDO,
  normal: 'common_dogwood_branch_normal.png',
  roughness: 'common_dogwood_branch_roughness.png',
} as const;

export const COMMON_DOGWOOD_LEAF_TEXTURE_FILES = {
  albedo: COMMON_DOGWOOD_SINGLE_ALBEDO,
  normal: 'common_dogwood_single_normal.png',
  roughness: 'common_dogwood_single_roughness.png',
  translucency: 'common_dogwood_single_translucency.png',
} as const;

export const COMMON_DOGWOOD_SEED_PREFIX = 'gorski:Gorski Common Dogwood';

export type CommonDogwoodVariant = {
  readonly id: 'open-arching' | 'upright-thicket' | 'dense-stool';
  readonly stemCount: number;
  /** Intended unscaled prototype height; final bounds are generator-derived. */
  readonly authoredHeight: number;
  readonly params: {
    readonly trunks: number;
    readonly trunkSplayDeg: number;
    readonly firstForkHeight: number;
    readonly armLength: number;
    readonly branchiness: number;
    readonly forkSpread: number;
    readonly armBend: number;
    readonly gnarliness: number;
  };
};

/**
 * Three fixed stool architectures, from an airy edge-grown bush to a dense
 * coppice-like thicket. Stem counts deliberately stay inside dogwood's
 * characteristic 10-30 basal-shoot envelope.
 */
export const COMMON_DOGWOOD_VARIANTS: readonly CommonDogwoodVariant[] = [
  {
    id: 'open-arching',
    stemCount: 12,
    authoredHeight: 2.45,
    params: {
      trunks: 12,
      trunkSplayDeg: 20,
      firstForkHeight: 0.84,
      armLength: 0.68,
      branchiness: 0.42,
      forkSpread: 20,
      armBend: 15,
      gnarliness: 5,
    },
  },
  {
    id: 'upright-thicket',
    stemCount: 19,
    authoredHeight: 2.6,
    params: {
      trunks: 19,
      trunkSplayDeg: 15,
      firstForkHeight: 0.88,
      armLength: 0.71,
      branchiness: 0.48,
      forkSpread: 17,
      armBend: 11,
      gnarliness: 4,
    },
  },
  {
    id: 'dense-stool',
    stemCount: 27,
    authoredHeight: 2.75,
    params: {
      trunks: 27,
      trunkSplayDeg: 18,
      firstForkHeight: 0.92,
      armLength: 0.74,
      branchiness: 0.52,
      forkSpread: 18,
      armBend: 13,
      gnarliness: 5,
    },
  },
] as const;

export const commonDogwood = {
  name: 'Gorski Common Dogwood',
  latin: 'Cornus sanguinea',
  category: 'shrub',
  bark: COMMON_DOGWOOD_BRANCH_ALBEDO,
  leaf: COMMON_DOGWOOD_SINGLE_ALBEDO,
  biome: 'temperate',
  tileWorldSize: 0.42,
  plantSink: 0.018,
  foliageType: 'singleLeaves',
  foliage: {
    mode: 'leaves',
    leavesPerBranch: 8,
    size: 0.145,
    sizeVar: 0.2,
    widthRatio: 0.67,
    taper: 0.18,
    startFrac: 0.12,
    downAngle: 50,
    downAngleV: 12,
    droop: 12,
    droopV: 8,
    bend: 0.03,
    // Cornus leaves are opposite; successive pairs turn around the shoot.
    whorlSize: 2,
    rotate: 92,
    rotateV: 5,
    quads: 1,
    alphaTest: 0.42,
    tint: 0xffffff,
    transmit: [0.3, 0.46, 0.18],
    flutterScale: 0.42,
    // Leaf the last woody tier as well as the terminal shoots so the crown is
    // a continuous thicket rather than isolated pom-poms at branch tips.
    parentSprays: 1,
  },
  params: {
    trunks: 19,
    trunkSplayDeg: 15,
    firstForkHeight: 0.88,
    armLength: 0.71,
    armFalloff: 0.86,
    forkGenerations: 3,
    branchiness: 0.48,
    forkSpread: 17,
    forkTriChance: 0.025,
    curlUp: 0.58,
    armBend: 11,
    gnarliness: 4,
    continuationKink: 5,
    forkRadiusKeep: 0.7,
    forkBaseScale: 0.84,
    trunkRadius: 0.012,
    trunkFlare: 0.75,
    branchRepel: 0.56,
    minRadius: 0.0022,
    radialSegs: 5,
    segCurveRes: 3,
    tileWorldSize: 0.42,
    barkGrainU: true,
    windWeightScale: 0.18,
  },
} as const;

export function normalizeCommonDogwoodVariant(variant: number): number {
  const integerVariant = Number.isFinite(variant) ? Math.trunc(variant) : 0;
  return Math.abs(integerVariant) % COMMON_DOGWOOD_VARIANTS.length;
}

/** Returns a fresh preset so SeedThree can safely merge generator defaults. */
export function createCommonDogwoodVariantPreset(variant: number) {
  const variantIndex = normalizeCommonDogwoodVariant(variant);
  const morphology = COMMON_DOGWOOD_VARIANTS[variantIndex];
  return {
    variantIndex,
    morphology,
    seed: `${COMMON_DOGWOOD_SEED_PREFIX}:${variantIndex}`,
    preset: {
      ...commonDogwood,
      params: {
        ...commonDogwood.params,
        ...morphology.params,
      },
    },
  };
}
