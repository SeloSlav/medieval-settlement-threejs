/**
 * Global, code-only switch for the Croatian naïve-art treatment.
 *
 * Set this to false to keep the existing bloom/day-night grade without the
 * painterly palette, pigment texture, and dark contour treatment.
 */
export const CROATIAN_NAIVE_ART_POST_PROCESSING_ENABLED = true;

export const CROATIAN_NAIVE_ART_NEIGHBOR_SAMPLE_COUNT = 5;

/**
 * Shared values for the GLSL and TSL implementations. Keeping the two
 * backends on one preset prevents WebGPU and WebGL from drifting visually.
 */
export const CROATIAN_NAIVE_ART_STYLE = Object.freeze({
  bilateralSharpness: 7,
  bloomRadius: 0.36,
  bloomStrength: 0.14,
  bloomThreshold: 0.78,
  cardinalWeight: 0.18,
  centerWeight: 0.28,
  colorfulness: 1.08,
  contourEnd: 0.38,
  contourStart: 0.11,
  contourStrength: 0.5,
  filterRadiusPixels: 1.25,
  grainScaleX: 593,
  grainScaleY: 341,
  grainStrength: 0.0032,
  paletteSteps: 9,
  paletteStrength: 0.14,
  painterlySmoothing: 0.44,
  shadowEnd: 0.46,
  shadowStart: 0.055,
  shadowTint: [0.92, 0.98, 0.84] as const,
  shadowUnderpaint: [0.025, 0.034, 0.018] as const,
  shadowUnderpaintStrength: 0.14,
});

export type NaiveArtRgb = readonly [number, number, number];

export type NaiveArtNeighborhood = Readonly<{
  center: NaiveArtRgb;
  north: NaiveArtRgb;
  east: NaiveArtRgb;
  south: NaiveArtRgb;
  west: NaiveArtRgb;
}>;

export type NaiveArtNeighborhoodResult = Readonly<{
  color: NaiveArtRgb;
  structureEdge: number;
}>;

/**
 * CPU reference for the single-pass GPU neighborhood kernel. It is kept pure
 * so regression tests can prove that flat areas stay flat, texture noise is
 * simplified, and hard silhouettes are preserved.
 */
export function filterCroatianNaiveArtNeighborhood(
  neighborhood: NaiveArtNeighborhood,
): NaiveArtNeighborhoodResult {
  const style = CROATIAN_NAIVE_ART_STYLE;
  const centerLuma = rgbLuma(neighborhood.center);
  const weightedColor: [number, number, number] = [
    neighborhood.center[0] * style.centerWeight,
    neighborhood.center[1] * style.centerWeight,
    neighborhood.center[2] * style.centerWeight,
  ];
  let weightSum = style.centerWeight;

  const neighbors = [
    [neighborhood.north, style.cardinalWeight],
    [neighborhood.east, style.cardinalWeight],
    [neighborhood.south, style.cardinalWeight],
    [neighborhood.west, style.cardinalWeight],
  ] as const;

  for (const [sample, spatialWeight] of neighbors) {
    const rangeWeight = Math.exp(
      -Math.abs(rgbLuma(sample) - centerLuma) * style.bilateralSharpness,
    );
    const weight = spatialWeight * rangeWeight;
    weightedColor[0] += sample[0] * weight;
    weightedColor[1] += sample[1] * weight;
    weightedColor[2] += sample[2] * weight;
    weightSum += weight;
  }

  const filtered: NaiveArtRgb = [
    weightedColor[0] / weightSum,
    weightedColor[1] / weightSum,
    weightedColor[2] / weightSum,
  ];
  const color: NaiveArtRgb = [
    lerp(neighborhood.center[0], filtered[0], style.painterlySmoothing),
    lerp(neighborhood.center[1], filtered[1], style.painterlySmoothing),
    lerp(neighborhood.center[2], filtered[2], style.painterlySmoothing),
  ];

  const n = rgbLuma(neighborhood.north);
  const e = rgbLuma(neighborhood.east);
  const s = rgbLuma(neighborhood.south);
  const w = rgbLuma(neighborhood.west);
  const gradientX = e - w;
  const gradientY = s - n;
  const filteredLuma = rgbLuma(filtered);
  const structureSignal =
    Math.hypot(gradientX, gradientY) * 0.5
    + Math.abs(centerLuma - filteredLuma) * 0.8;

  return {
    color,
    structureEdge: smoothstep(
      style.contourStart,
      style.contourEnd,
      structureSignal,
    ),
  };
}

function rgbLuma(color: NaiveArtRgb): number {
  return color[0] * 0.2126 + color[1] * 0.7152 + color[2] * 0.0722;
}

function lerp(from: number, to: number, amount: number): number {
  return from + (to - from) * amount;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
