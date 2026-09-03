import {
  forestDensityAt,
  type ForestCore,
} from '../props/forestField.ts';

/**
 * Field contract for the one-time 2D illustrated terrain bake:
 *
 * stable world XZ
 *   -> accepted tree placements + sampled terrain height
 *   -> exact tree-glyph projection + equal-height paths
 *   -> spatially faithful woodland + dotted charcoal contours
 *
 * Keep these perceptual constants together so visual tuning does not become a
 * collection of unrelated thresholds hidden in the canvas renderer.
 */
export const ILLUSTRATED_TERRAIN_FIELDS = {
  woodland: {
    neighbourhoodRadiusMapFraction: 0.032,
    densityStart: 0.24,
    densityFull: 0.72,
    neighbourSupportStart: 0.18,
    neighbourSupportFull: 0.5,
  },
} as const;

/**
 * Presentation constants are grouped by perceptual role so the quiet terrain
 * layer cannot accidentally compete with live roads, footprints, or stamps.
 * Values are authored for the farthest illustrated-map mip, where repeated
 * dark strokes otherwise merge into solid badges.
 */
export const ILLUSTRATED_TERRAIN_STYLE = {
  paper: {
    // Screenshot-space match for the supplied Manor Lords reference. Keep the
    // sheet a warm low-chroma grey; the older yellow parchment and the recent
    // near-white ivory both miss the material identity.
    base: { r: 184, g: 174, b: 160 },
    waterWash: { r: 126, g: 137, b: 135 },
    terrainInk: { r: 64, g: 59, b: 53 },
    broadMottleAmplitude: 19,
    broadMottleCellAuthorPixels: 94,
    middleMottleAmplitude: 9,
    middleMottleCellAuthorPixels: 27,
    grainAmplitude: 5.5,
    fibreAmplitude: 1.7,
    edgeDarkening: 22,
    edgePatinaWidthAuthorPixels: 58,
    stain: { r: 79, g: 73, b: 64 },
    stainCount: 46,
    stainAlphaMin: 0.038,
    stainAlphaRange: 0.076,
    bleach: { r: 222, g: 214, b: 201 },
    bleachCount: 15,
    bleachAlphaMin: 0.012,
    bleachAlphaRange: 0.028,
    fibreCount: 210,
    foxingCount: 360,
  },
  contours: {
    ink: { r: 64, g: 59, b: 53 },
    alpha: 0.5,
    indexAlpha: 0.63,
    lineWidthAuthorPixels: 0.86,
    indexWidthAuthorPixels: 1.1,
    spacingAuthorPixels: 2.7,
    markLengthMinAuthorPixels: 0.18,
    markLengthRangeAuthorPixels: 1.2,
    driftAuthorPixels: 0.5,
    rubAlphaScale: 0.12,
    rubWidthScale: 2.2,
  },
  grassland: {
    glyphSpacingAuthorPixels: 22,
    patchCellAuthorPixels: 68,
    ink: { r: 64, g: 59, b: 53 },
    alpha: 0.24,
    lineWidthAuthorPixels: 0.46,
  },
  woodland: {
    outlineAlpha: 0.45,
    fillAlpha: 0.055,
    lineWidthAuthorPixels: 0.48,
    minimumGlyphSpacingAuthorPixels: 2.75,
    maximumGlyphCount: 5_400,
    canopyDiameterScale: 1.48,
    minimumSymbolScaleAuthorPixels: 0.54,
    maximumSymbolScaleAuthorPixels: 1.5,
    broadleafSilhouetteVariants: 16,
    coniferSilhouetteVariants: 8,
  },
} as const;

export const ILLUSTRATED_TERRAIN_FIELD_CONTRACT =
  'world-xz>accepted-tree-placements,terrain-height>exact-tree-glyphs,equal-height-paths>species-glyphs,dotted-charcoal-contours';

export type IllustratedWoodlandField = {
  /** Authoritative generated forest density at the requested world point. */
  density: number;
  /** Nine-tap world-space average used to reject salt-and-pepper placement. */
  broadDensity: number;
  /** Fraction of neighbouring samples that belong to the same woodland mass. */
  neighbourSupport: number;
  /** Approximate local forest boundary strength, useful for diagnostics/tuning. */
  boundary: number;
  /** Final categorical field consumed by the overlapping glyph-cluster pass. */
  clumpMass: number;
};

export type IllustratedWoodlandFieldOptions = {
  x: number;
  z: number;
  neighbourhoodRadius: number;
  densityAt: (x: number, z: number) => number;
};

const WOODLAND_NEIGHBOUR_DIRECTIONS = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
] as const;

/**
 * Samples a coherent woodland field in stable world metres. A single dense
 * point cannot become a tree icon: it needs broad neighbouring support before
 * it can become an illustrated clump.
 */
export function sampleIllustratedWoodlandField(
  options: IllustratedWoodlandFieldOptions,
): IllustratedWoodlandField {
  const radius = Math.max(0.001, options.neighbourhoodRadius);
  const density = saturate(options.densityAt(options.x, options.z));
  let neighbourSum = 0;
  let supportedNeighbours = 0;
  let minimum = density;
  let maximum = density;

  for (const [offsetX, offsetZ] of WOODLAND_NEIGHBOUR_DIRECTIONS) {
    const diagonalScale = offsetX !== 0 && offsetZ !== 0 ? Math.SQRT1_2 : 1;
    const sample = saturate(options.densityAt(
      options.x + offsetX * radius * diagonalScale,
      options.z + offsetZ * radius * diagonalScale,
    ));
    neighbourSum += sample;
    if (sample >= ILLUSTRATED_TERRAIN_FIELDS.woodland.densityStart) {
      supportedNeighbours++;
    }
    minimum = Math.min(minimum, sample);
    maximum = Math.max(maximum, sample);
  }

  const neighbourMean = neighbourSum / WOODLAND_NEIGHBOUR_DIRECTIONS.length;
  const broadDensity = density * 0.32 + neighbourMean * 0.68;
  const neighbourSupport = supportedNeighbours / WOODLAND_NEIGHBOUR_DIRECTIONS.length;
  const densityMass = smoothstep(
    ILLUSTRATED_TERRAIN_FIELDS.woodland.densityStart,
    ILLUSTRATED_TERRAIN_FIELDS.woodland.densityFull,
    density * 0.46 + broadDensity * 0.54,
  );
  const coherence = smoothstep(
    ILLUSTRATED_TERRAIN_FIELDS.woodland.neighbourSupportStart,
    ILLUSTRATED_TERRAIN_FIELDS.woodland.neighbourSupportFull,
    neighbourSupport,
  );

  return {
    density,
    broadDensity,
    neighbourSupport,
    boundary: saturate((maximum - minimum) * 0.8 + (1 - coherence) * densityMass * 0.25),
    clumpMass: saturate(densityMass * coherence),
  };
}

export function sampleGeneratedWoodlandField(options: {
  x: number;
  z: number;
  neighbourhoodRadius: number;
  forestCores: readonly ForestCore[];
  generationExtent: number;
  terrainExtent: number;
}): IllustratedWoodlandField {
  return sampleIllustratedWoodlandField({
    x: options.x,
    z: options.z,
    neighbourhoodRadius: options.neighbourhoodRadius,
    densityAt: (x, z) => forestDensityAt(
      x,
      z,
      options.forestCores,
      options.generationExtent,
      options.terrainExtent,
    ),
  });
}

export type IllustratedElevationStats = {
  minimum: number;
  maximum: number;
};

/** Keep the full height range so narrow summits still receive contours. */
export function resolveIllustratedElevationStats(
  heightSamples: ArrayLike<number>,
): IllustratedElevationStats {
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let index = 0; index < heightSamples.length; index++) {
    const height = heightSamples[index];
    if (!Number.isFinite(height)) continue;
    minimum = Math.min(minimum, height);
    maximum = Math.max(maximum, height);
  }
  return minimum === Infinity ? { minimum: 0, maximum: 0 } : { minimum, maximum };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (Math.abs(edge1 - edge0) <= 1e-9) return value < edge0 ? 0 : 1;
  const t = saturate((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function saturate(value: number): number {
  return Math.max(0, Math.min(1, value));
}
