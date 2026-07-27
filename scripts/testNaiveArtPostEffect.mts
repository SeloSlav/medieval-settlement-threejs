import assert from 'node:assert/strict';
import {
  CROATIAN_NAIVE_ART_POST_PROCESSING_ENABLED,
  CROATIAN_NAIVE_ART_STYLE,
} from '../src/scene/naiveArtPostEffect.ts';
import { buildGradeGlslFragmentShader } from '../src/scene/postGradeShader.ts';

assert.equal(
  CROATIAN_NAIVE_ART_POST_PROCESSING_ENABLED,
  true,
  'the Croatian naïve-art treatment should ship enabled',
);

const enabledShader = buildGradeGlslFragmentShader(true);
assert.match(enabledShader, /applyCroatianNaiveArt\(color, vUv\)/);
assert.match(enabledShader, /fwidth\(paintedColorLuma\)/);
assert.match(enabledShader, /naiveArtPaperNoise/);

const disabledShader = buildGradeGlslFragmentShader(false);
assert.doesNotMatch(disabledShader, /applyCroatianNaiveArt/);
assert.doesNotMatch(disabledShader, /naiveArtPaperNoise/);
assert.match(disabledShader, /color = adjustSaturation\(color, saturation\)/);

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

console.log('Croatian naïve-art post-effect tests passed.');
