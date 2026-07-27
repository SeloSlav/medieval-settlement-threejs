/**
 * Global, code-only switch for the Croatian naïve-art treatment.
 *
 * Set this to false to keep the existing bloom/day-night grade without the
 * painterly palette, pigment texture, and dark contour treatment.
 */
export const CROATIAN_NAIVE_ART_POST_PROCESSING_ENABLED = true;

/**
 * Shared values for the GLSL and TSL implementations. Keeping the two
 * backends on one preset prevents WebGPU and WebGL from drifting visually.
 */
export const CROATIAN_NAIVE_ART_STYLE = Object.freeze({
  colorfulness: 1.1,
  contourEnd: 0.26,
  contourStart: 0.08,
  contourStrength: 0.72,
  grainScaleX: 593,
  grainScaleY: 341,
  grainStrength: 0.0045,
  paletteSteps: 7,
  paletteStrength: 0.18,
  shadowEnd: 0.46,
  shadowStart: 0.055,
  shadowTint: [0.92, 0.98, 0.84] as const,
  shadowUnderpaint: [0.025, 0.034, 0.018] as const,
  shadowUnderpaintStrength: 0.28,
});
