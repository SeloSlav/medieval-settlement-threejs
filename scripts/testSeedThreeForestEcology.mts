import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { buildForestEdgeEcology } from '../vendor/seedthree/src/core/forest-ecology.js';

const saplingCount = 55;
const ecology = {
  anchorCount: saplingCount,
  saplings: Array.from({ length: saplingCount }, (_, index) => ({
    x: 60 + index,
    z: 80 + index * 0.5,
    scale: 1,
    rotation: index * 0.37,
    variant: index % 3,
    sourceIndex: index,
  })),
  understory: [],
  deadwood: [],
  litter: [],
};
const built = buildForestEdgeEcology(ecology, { getHeightAt: () => 0 });
assert.equal(built.stats.counts.saplings, saplingCount);
assert.equal(built.stats.draws, 2, 'sapling trunks and crowns must remain two immutable draws');
assert.equal(built.stats.instances, saplingCount * 2, 'one trunk and one crown instance per placement');

const crowns = built.group.getObjectByName(
  'SeedThree ecology clustered sapling crowns',
) as THREE.InstancedMesh;
assert.ok(crowns?.isInstancedMesh);
assert.equal(crowns.count, saplingCount, 'the ecology crown draw must preserve all 55 placements');
const crownTriangles = crowns.geometry.index
  ? crowns.geometry.index.count / 3
  : crowns.geometry.attributes.position.count / 3;
const oldCrownTriangles = 40;
assert.ok(
  crownTriangles >= 250,
  'the crown must carry enough faceted whorls and branch sprays to avoid paper-cone silhouettes',
);
assert.equal(
  built.stats.triangles - crownTriangles * saplingCount,
  24 * saplingCount,
  'the richer crown must not alter the existing six-sided trunk geometry',
);
assert.ok(crowns.geometry.boundingBox);
const crownSize = crowns.geometry.boundingBox!.getSize(new THREE.Vector3());
assert.ok(crownSize.x > 2.1 && crownSize.z > 2, 'lateral sprays must break both crown axes');
assert.ok(
  crownSize.y > 2.6 && crowns.geometry.boundingBox!.max.y > 3.9,
  'the authored crown must retain a readable young-fir leader',
);

const palette = Array.from({ length: 3 }, (_, index) => {
  const color = new THREE.Color();
  crowns.getColorAt(index, color);
  return color;
});
assert.equal(new Set(palette.map((color) => color.getHex())).size, 3);
assert.ok(
  palette.every((color) => color.g < 0.14),
  'ecology crowns must stay in the dark evergreen range under white material lighting',
);

const source = readFileSync(
  join(process.cwd(), 'vendor/seedthree/src/core/forest-ecology.js'),
  'utf8',
);
assert.match(source, /const sprayWhorls = \[[\s\S]*count: 4[\s\S]*count: 3[\s\S]*count: 3/);
assert.match(source, /new ConeGeometry\(1\.08, 1\.02, 12, 2\)/);
assert.match(source, /const crownPalette = \[0x2f5339, 0x274833, 0x385b3c\]/);

console.log(JSON.stringify({
  crownTriangles,
  oldCrownTriangles,
  perCrownTriangleDelta: crownTriangles - oldCrownTriangles,
  totalCrownTriangleDelta: (crownTriangles - oldCrownTriangles) * saplingCount,
  draws: built.stats.draws,
  saplings: built.stats.counts.saplings,
}));
built.dispose();
