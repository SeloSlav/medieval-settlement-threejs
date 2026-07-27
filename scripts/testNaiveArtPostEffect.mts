import assert from 'node:assert/strict';
import {
  CROATIAN_NAIVE_ART_NEIGHBOR_SAMPLE_COUNT,
  CROATIAN_NAIVE_ART_POST_PROCESSING_ENABLED,
  CROATIAN_NAIVE_ART_STYLE,
  filterCroatianNaiveArtNeighborhood,
  type NaiveArtNeighborhood,
  type NaiveArtRgb,
} from '../src/scene/naiveArtPostEffect.ts';
import { buildGradeGlslFragmentShader } from '../src/scene/postGradeShader.ts';

assert.equal(
  CROATIAN_NAIVE_ART_POST_PROCESSING_ENABLED,
  true,
  'the Croatian naïve-art treatment should ship enabled',
);

const enabledShader = buildGradeGlslFragmentShader(true);
assert.match(enabledShader, /buildCroatianNaiveArtBasis/);
assert.match(enabledShader, /applyCroatianNaiveArtTone/);
assert.match(enabledShader, /naiveArtBilateralWeight/);
assert.match(enabledShader, /gradientX/);
assert.match(enabledShader, /naiveArtPaperNoise/);

const disabledShader = buildGradeGlslFragmentShader(false);
assert.doesNotMatch(disabledShader, /buildCroatianNaiveArtBasis/);
assert.doesNotMatch(disabledShader, /applyCroatianNaiveArtTone/);
assert.doesNotMatch(disabledShader, /naiveArtBilateralWeight/);
assert.doesNotMatch(disabledShader, /naiveArtPaperNoise/);
assert.match(disabledShader, /color = adjustSaturation\(color, saturation\)/);

assert.equal(
  CROATIAN_NAIVE_ART_NEIGHBOR_SAMPLE_COUNT,
  9,
  'the painterly kernel should stay within a predictable nine-tap texture budget',
);

const flatColor = rgb(0.42, 0.58, 0.24);
const flatResult = filterCroatianNaiveArtNeighborhood(
  neighborhoodFromRows([
    [flatColor, flatColor, flatColor],
    [flatColor, flatColor, flatColor],
    [flatColor, flatColor, flatColor],
  ]),
);
assert.ok(
  flatResult.color.every((channel, index) => Math.abs(channel - flatColor[index]) < 1e-12),
  'flat painted areas must remain perfectly flat',
);
assert.equal(flatResult.structureEdge, 0, 'flat painted areas must not grow false contours');

const quietColor = rgb(0.48, 0.5, 0.28);
const noisyCenter = rgb(0.54, 0.56, 0.34);
const noisyResult = filterCroatianNaiveArtNeighborhood(
  neighborhoodFromRows([
    [quietColor, quietColor, quietColor],
    [quietColor, noisyCenter, quietColor],
    [quietColor, quietColor, quietColor],
  ]),
);
assert.ok(
  Math.abs(noisyResult.color[0] - quietColor[0])
    < Math.abs(noisyCenter[0] - quietColor[0]),
  'small material noise should be pulled into a calmer local color mass',
);

const shadow = rgb(0.08, 0.09, 0.05);
const light = rgb(0.82, 0.76, 0.48);
const hardEdgeResult = filterCroatianNaiveArtNeighborhood(
  neighborhoodFromRows([
    [shadow, shadow, light],
    [shadow, shadow, light],
    [shadow, shadow, light],
  ]),
);
assert.ok(
  hardEdgeResult.color[0] < 0.12,
  'the bilateral range gate must not smear a bright surface into a dark silhouette',
);
assert.ok(
  hardEdgeResult.structureEdge > 0.9,
  'a hard object boundary should produce a strong structural contour',
);

assert.ok(
  CROATIAN_NAIVE_ART_STYLE.paletteSteps >= 5
    && CROATIAN_NAIVE_ART_STYLE.paletteSteps <= 10,
  'the palette should be simplified without collapsing broad landscape gradients',
);
assert.ok(
  CROATIAN_NAIVE_ART_STYLE.contourStrength > 0
    && CROATIAN_NAIVE_ART_STYLE.contourStrength < 1,
  'the contour should darken edges without replacing the underlying object color',
);
assert.ok(
  CROATIAN_NAIVE_ART_STYLE.grainStrength > 0
    && CROATIAN_NAIVE_ART_STYLE.grainStrength < 0.03,
  'pigment variation should remain subtle',
);
assert.ok(
  CROATIAN_NAIVE_ART_STYLE.bloomStrength > 0.12
    && CROATIAN_NAIVE_ART_STYLE.bloomThreshold < 0.82,
  'the enabled preset should lift luminous reverse-glass highlights',
);

console.log('Croatian naïve-art post-effect tests passed.');

function rgb(red: number, green: number, blue: number): NaiveArtRgb {
  return [red, green, blue];
}

function neighborhoodFromRows(
  rows: readonly [
    readonly [NaiveArtRgb, NaiveArtRgb, NaiveArtRgb],
    readonly [NaiveArtRgb, NaiveArtRgb, NaiveArtRgb],
    readonly [NaiveArtRgb, NaiveArtRgb, NaiveArtRgb],
  ],
): NaiveArtNeighborhood {
  return {
    northWest: rows[0][0],
    north: rows[0][1],
    northEast: rows[0][2],
    west: rows[1][0],
    center: rows[1][1],
    east: rows[1][2],
    southWest: rows[2][0],
    south: rows[2][1],
    southEast: rows[2][2],
  };
}
