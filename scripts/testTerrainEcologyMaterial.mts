import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const source = readFileSync(
  `${projectRoot}src/terrain/TerrainGrassMaterial.ts`,
  'utf8',
);

const ecologyStart = source.indexOf('function buildGrassBlendNodes');
const ecologyEnd = source.indexOf('function buildTerrainFrostMask');
assert.ok(ecologyStart >= 0 && ecologyEnd > ecologyStart);
const ecologySource = source.slice(ecologyStart, ecologyEnd);

assert.match(ecologySource, /Domain-warped oblique waves/);
assert.match(ecologySource, /attribute\('normal', 'vec3'\)/);
assert.match(ecologySource, /const lowland = sub/);
assert.match(ecologySource, /const moisture = smoothstep/);
assert.match(ecologySource, /const dryShoulder = smoothstep/);
assert.match(ecologySource, /const broadSoilValue = mix/);
assert.match(ecologySource, /function applyRiparianEcologyColor/);
assert.match(ecologySource, /pow\([\s\S]*?shoreBlend,[\s\S]*?float\(0\.38\)/);
assert.doesNotMatch(
  ecologySource,
  /\bfract\b|\bfloor\b|\bmod\b/,
  'the ecological pass must not regress to visibly tiled hash/checker cells',
);
assert.equal(
  (source.match(/\btexture\(/g) ?? []).length,
  17,
  'the ecological pass must not add terrain texture reads',
);
assert.equal(
  (source.match(/new MeshStandardNodeMaterial\(\)/g) ?? []).length,
  2,
  'the ecological hierarchy must remain within the existing terrain draws',
);
assert.match(source, /applyTerrainWetColor/);
assert.match(source, /buildTerrainFrostMask/);
assert.match(source, /weather\.wetness/);
assert.match(source, /weather\.frost/);

console.log('Terrain ecological material contract tests passed.');
