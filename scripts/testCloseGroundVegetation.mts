import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const grassSource = readFileSync(
  `${projectRoot}src/vegetation/seedthree/seedThreeGrass.ts`,
  'utf8',
);
const fieldSource = readFileSync(
  `${projectRoot}src/grass/GrassBladeField.ts`,
  'utf8',
);
const wildflowerSource = readFileSync(
  `${projectRoot}src/vegetation/seedthree/seedThreeWildflowers.ts`,
  'utf8',
);
const sceneSource = readFileSync(
  `${projectRoot}src/scene/SceneManager.ts`,
  'utf8',
);
const lodSource = readFileSync(
  `${projectRoot}src/grass/grassLodMath.ts`,
  'utf8',
);
const meadowTuftPath =
  `${projectRoot}public/assets/textures/vegetation/grass/close-meadow-tuft.png`;

assert.match(
  grassSource,
  /CLOSE_MEADOW_TUFT_PATH[\s\S]*?close-meadow-tuft\.png/,
  'close grass should use the generated Manor Lords-style meadow card',
);
assert.match(
  grassSource,
  /loadSeedThreeGroundCoverTextures[\s\S]*?createSeedThreeCardClumpGeometry[\s\S]*?createSeedThreeGroundCoverMaterial/,
  'the generated card must run through SeedThree ground-cover textures, geometry, and material',
);
assert.match(
  fieldSource,
  /createSeedThreeTuftVariants\(\)/,
  'the streamed field should use SeedThree tuft geometry',
);
assert.doesNotMatch(
  `${grassSource}\n${fieldSource}`,
  /function tuftGeometry|createGrassTuftGeometry|Grass blade stream|useSeedThreeClumps/,
  'the streamed field must not retain a parallel custom grass fallback',
);
assert.doesNotMatch(
  sceneSource,
  /useSeedThreeClumps/,
  'SceneManager should not conditionally switch away from SeedThree grass',
);
assert.match(
  fieldSource,
  /THREE\.MathUtils\.lerp\(0\.68, 1\.08, rng\(\)\)/,
  'full SeedThree grass tufts should use the larger close-meadow height',
);
assert.match(
  grassSource,
  /\.setHSL\(hue, saturation, lightness\)[\s\S]*?\.lerp\(GRASS_TINT_WHITE, 0\.46\)/,
  'grass tint should stay in muted olive and straw colors rather than boosted green',
);
assert.match(
  sceneSource,
  /rendererBackend: this\.rendererBackend/,
  'the shared SeedThree material should receive the active renderer backend',
);
assert.match(
  lodSource,
  /CLOSE_GROUND_FADE_START_ZOOM_PERCENT = 200/,
  'grass, wildflowers, and cattails should begin fading in at 200% zoom',
);
assert.match(
  fieldSource,
  /grassZoomVisible = displayOpacity > 0/,
  'the shared grass and wildflower stream should activate as soon as the fade begins',
);
assert.match(
  lodSource,
  /REED_LOD_VISIBILITY_THRESHOLD = 0/,
  'cattails should activate at the same fade boundary',
);
assert.match(
  fieldSource,
  /const target = rng\(\) < 0\.06 \? 0 : 3 \+ Math\.floor\(rng\(\) \* 2\)/,
  'wildflowers should occur in most chunks at three or four colonies',
);
assert.match(
  fieldSource,
  /MIN_WILDFLOWER_SPACING_SQ = 0\.9 \* 0\.9/,
  'wildflower colonies should be able to gather into natural patches',
);

const stalkBlock = wildflowerSource.slice(
  wildflowerSource.indexOf('const stalks = ['),
  wildflowerSource.indexOf('] as const;', wildflowerSource.indexOf('const stalks = [')),
);
assert.equal(
  (stalkBlock.match(/\{ x:/g) ?? []).length,
  5,
  'each wildflower colony should contain five readable stems',
);
assert.match(
  wildflowerSource,
  /heightScale: \[1\.05, 1\.4\]/,
  'the shortest species should still reach the close grass layer',
);
assert.match(
  wildflowerSource,
  /heightScale: \[1\.35, 1\.95\]/,
  'the tallest species should remain below a metre at the authored base height',
);

const meadowTuft = readFileSync(meadowTuftPath);
assert.ok(
  statSync(meadowTuftPath).size > 100_000,
  'the generated meadow card should remain a real authored texture',
);
assert.equal(meadowTuft.subarray(1, 4).toString('ascii'), 'PNG');
assert.equal(meadowTuft[25], 6, 'the generated meadow card should retain an RGBA alpha channel');

console.log('Close-ground vegetation contract tests passed.');
