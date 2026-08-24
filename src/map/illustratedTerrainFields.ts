import {
  forestDensityAt,
  type ForestCore,
} from '../props/forestField.ts';

/**
 * Field contract for the one-time 2D illustrated terrain bake:
 *
 * stable world XZ
 *   -> accepted tree placements + normalized elevation + slope/ridge
 *   -> exact tree-glyph projection + mountain prominence
 *   -> spatially faithful woodland + layered ridge marks
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
  elevation: {
    contourQuantiles: [0.38, 0.53, 0.66, 0.77, 0.86, 0.93],
    lowQuantile: 0.12,
    shoulderQuantile: 0.62,
    summitQuantile: 0.95,
    mountainSpacingAuthorPixels: 52,
    mountainStart: 0.28,
    guaranteedSummitElevation: 0.9,
    guaranteedCoverageRadiusSpacing: 0.68,
    reliefGateStartMeters: 7,
    reliefGateFullMeters: 30,
    narrowSummitReliefWeight: 0.55,
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
    alpha: 0.14,
    lineWidthAuthorPixels: 0.48,
  },
  grassland: {
    glyphSpacingAuthorPixels: 22,
    patchCellAuthorPixels: 68,
    ink: { r: 64, g: 59, b: 53 },
    alpha: 0.24,
    lineWidthAuthorPixels: 0.46,
  },
  mountains: {
    outlineAlphaMin: 0.22,
    outlineAlphaProminence: 0.1,
    fillAlphaMin: 0.012,
    fillAlphaProminence: 0.018,
    baselineAlphaMin: 0.13,
    baselineAlphaProminence: 0.08,
    scaleBase: 0.48,
    scaleProminence: 0.22,
    scaleVariation: 0.08,
  },
  woodland: {
    outlineAlpha: 0.42,
    fillAlpha: 0.032,
    lineWidthAuthorPixels: 0.46,
    minimumGlyphSpacingAuthorPixels: 2.9,
    maximumGlyphCount: 5_200,
    canopyDiameterScale: 1.34,
    minimumSymbolScaleAuthorPixels: 0.46,
    maximumSymbolScaleAuthorPixels: 1.34,
    broadleafSilhouetteVariants: 16,
    coniferSilhouetteVariants: 8,
  },
} as const;

export const ILLUSTRATED_TERRAIN_FIELD_CONTRACT =
  'world-xz>accepted-tree-placements,elevation,slope-ridge>exact-tree-glyphs,mountain-prominence>species-glyphs,ridge-marks';

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
  low: number;
  shoulder: number;
  summit: number;
  broadRelief: number;
  extremeRelief: number;
  robustRelief: number;
  reliefGate: number;
};

export type IllustratedElevationField = {
  normalizedElevation: number;
  slope: number;
  ridge: number;
  edgeHighland: number;
  mountainProminence: number;
};

/** Robust quantiles prevent one quarry pit or single spike owning the art. */
export function resolveIllustratedElevationStats(
  heightSamples: ArrayLike<number>,
): IllustratedElevationStats {
  const sorted = Array.from(heightSamples, (value) => Number.isFinite(value) ? value : 0)
    .sort((a, b) => a - b);
  if (sorted.length === 0) {
    return {
      minimum: 0,
      maximum: 0,
      low: 0,
      shoulder: 0,
      summit: 0,
      broadRelief: 0,
      extremeRelief: 0,
      robustRelief: 0,
      reliefGate: 0,
    };
  }
  const minimum = sorted[0] ?? 0;
  const maximum = sorted[sorted.length - 1] ?? minimum;
  const low = sampleQuantile(sorted, ILLUSTRATED_TERRAIN_FIELDS.elevation.lowQuantile);
  const shoulder = sampleQuantile(sorted, ILLUSTRATED_TERRAIN_FIELDS.elevation.shoulderQuantile);
  const broadSummit = sampleQuantile(sorted, ILLUSTRATED_TERRAIN_FIELDS.elevation.summitQuantile);
  const extremeRelief = Math.max(0, maximum - low);
  const broadRelief = Math.max(0, broadSummit - low);
  // A sub-five-percent summit lies above the broad quantile by definition.
  // Preserve the broad statistic for ordinary ranges, but let a weighted
  // extreme open the relief gate so the exhaustive summit audit can see it.
  const robustRelief = Math.max(
    broadRelief,
    extremeRelief * ILLUSTRATED_TERRAIN_FIELDS.elevation.narrowSummitReliefWeight,
  );
  const summit = Math.max(broadSummit, low + extremeRelief * 0.92);
  return {
    minimum,
    maximum,
    low,
    shoulder,
    summit,
    broadRelief,
    extremeRelief,
    robustRelief,
    reliefGate: smoothstep(
      ILLUSTRATED_TERRAIN_FIELDS.elevation.reliefGateStartMeters,
      ILLUSTRATED_TERRAIN_FIELDS.elevation.reliefGateFullMeters,
      robustRelief,
    ),
  };
}

/**
 * Converts sampled terrain causes into the one field that may emit mountains.
 * `neighbourRange` and `heightAboveNeighbourMean` are measured in metres;
 * `edgeProximity` is 0 at map centre and 1 at its outer boundary.
 */
export function sampleIllustratedElevationField(options: {
  height: number;
  neighbourRange: number;
  heightAboveNeighbourMean: number;
  edgeProximity: number;
  stats: IllustratedElevationStats;
}): IllustratedElevationField {
  const span = Math.max(options.stats.summit - options.stats.low, 0.001);
  const shoulderNormalized = saturate(
    (options.stats.shoulder - options.stats.low) / span,
  );
  const normalizedElevation = saturate((options.height - options.stats.low) / span);
  const highland = smoothstep(shoulderNormalized, 1, normalizedElevation);
  const slope = smoothstep(0.025, 0.3, Math.max(0, options.neighbourRange) / span);
  const ridge = smoothstep(
    0.008,
    0.12,
    Math.max(0, options.heightAboveNeighbourMean) / span,
  );
  const edgeHighland = highland * smoothstep(0.62, 0.96, saturate(options.edgeProximity));
  const mountainProminence = options.stats.reliefGate * saturate(
    highland * 0.72
      + slope * 0.14
      + ridge * 0.2
      + edgeHighland * 0.16,
  );
  return {
    normalizedElevation,
    slope,
    ridge,
    edgeHighland,
    mountainProminence,
  };
}

/**
 * The exhaustive grid audit uses this categorical contract. It is deliberately
 * independent of placement randomness: a genuinely high/prominent sampled
 * summit must be covered by a range, while flat maps fail through reliefGate.
 */
export function isGuaranteedIllustratedMountainSummit(
  field: IllustratedElevationField,
): boolean {
  return field.normalizedElevation
      >= ILLUSTRATED_TERRAIN_FIELDS.elevation.guaranteedSummitElevation
    && field.mountainProminence
      >= ILLUSTRATED_TERRAIN_FIELDS.elevation.mountainStart;
}

function sampleQuantile(sorted: readonly number[], quantile: number): number {
  if (sorted.length <= 1) return sorted[0] ?? 0;
  const index = saturate(quantile) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.min(sorted.length - 1, lower + 1);
  const t = index - lower;
  return (sorted[lower] ?? 0) * (1 - t) + (sorted[upper] ?? 0) * t;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (Math.abs(edge1 - edge0) <= 1e-9) return value < edge0 ? 0 : 1;
  const t = saturate((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function saturate(value: number): number {
  return Math.max(0, Math.min(1, value));
}
