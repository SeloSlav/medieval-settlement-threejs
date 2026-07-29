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
const tuftPath =
  `${projectRoot}public/assets/textures/vegetation/grass/close-meadow-tuft.png`;

assert.match(
  grassSource,
  /CLOSE_MEADOW_TUFT_PATH[\s\S]*?close-meadow-tuft\.png/,
  'close grass should use the fine-blade meadow card',
);
assert.match(
  fieldSource,
  /THREE\.MathUtils\.lerp\(0\.38, 0\.72, rng\(\)\)/,
  'full grass tufts should remain at close meadow height',
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

const tuft = readFileSync(tuftPath);
assert.ok(statSync(tuftPath).size > 100_000, 'fine grass card should be a real authored texture');
assert.equal(tuft.subarray(1, 4).toString('ascii'), 'PNG');
assert.equal(tuft[25], 6, 'fine grass card should retain an RGBA alpha channel');

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
  /heightScale: \[0\.84, 1\.08\]/,
  'the shortest species should still reach the close grass layer',
);
assert.match(
  wildflowerSource,
  /heightScale: \[1\.12, 1\.55\]/,
  'the tallest species should remain below a metre at the authored base height',
);

console.log('Close-ground vegetation contract tests passed.');
