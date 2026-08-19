import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { buildForestEdgeEcology } from '../vendor/seedthree/src/core/forest-ecology.js';
import {
  HARVEST_STUMP_HIDE_DISTANCE,
  HARVEST_STUMP_SHOW_DISTANCE,
  shouldShowHarvestStumps,
} from '../src/props/RoadStumps.ts';

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
assert.doesNotMatch(
  source,
  /attribute\('instanceColor'/,
  'instanceColor is an InstancedMesh varying and must not be read as a zero-valued geometry attribute',
);
assert.match(
  source,
  /NodeMaterial automatically multiplies colorNode[\s\S]*material\.colorNode = mix\(vec3\(0\.92, 0\.78, 0\.6\), vec3\(1\), seasonalLeaf\)/,
  'the material must defer palette application to Three NodeMaterial’s built-in instance-color path',
);

console.log(JSON.stringify({
  crownTriangles,
  oldCrownTriangles,
  perCrownTriangleDelta: crownTriangles - oldCrownTriangles,
  totalCrownTriangleDelta: (crownTriangles - oldCrownTriangles) * saplingCount,
  draws: built.stats.draws,
  saplings: built.stats.counts.saplings,
}));
built.dispose();

const understoryCount = 12;
const understoryBuilt = buildForestEdgeEcology({
  anchorCount: understoryCount,
  saplings: [],
  understory: Array.from({ length: understoryCount }, (_, index) => ({
    x: 70 + index,
    z: 55 + index * 0.75,
    scale: 1,
    rotation: index * 0.41,
    variant: index % 3,
    sourceIndex: index,
  })),
  deadwood: [],
  litter: [],
}, { getHeightAt: () => 0 });
assert.equal(understoryBuilt.stats.draws, 1, 'all understory shrubs must remain one instanced draw');
assert.equal(understoryBuilt.stats.instances, understoryCount);
const understory = understoryBuilt.group.getObjectByName(
  'SeedThree ecology beech-fir understory clusters',
) as THREE.InstancedMesh;
assert.ok(understory?.isInstancedMesh);
assert.equal(understory.count, understoryCount);
assert.ok(
  understory.instanceColor,
  'the built-in InstancedMesh color varying must carry the authored shrub palette',
);
const understoryTriangles = understory.geometry.index!.count / 3;
assert.ok(
  understoryTriangles >= 250,
  'rounded foliage lobes and woody twigs must replace the old 40-triangle cone cluster',
);
const seasonalLeaf = understory.geometry.getAttribute('aSeasonalLeaf');
const seasonalValues = new Set(Array.from(seasonalLeaf.array));
assert.deepEqual(
  [...seasonalValues].sort(),
  [0, 1],
  'one geometry must distinguish retained woody twigs from dormant foliage',
);
const deciduousInstances = understory.geometry.getAttribute('aDeciduous');
assert.deepEqual(
  [...new Set(Array.from(deciduousInstances.array))].sort(),
  [0, 1],
  'the existing fir variant must remain evergreen while both broadleaf variants enter dormancy',
);
assert.equal(understoryBuilt.setDeciduousDormancy(1), true);
assert.equal(
  (understory.material as THREE.Material).userData.forestSeasonalDormancy.value,
  1,
  'winter must drop only the deciduous understory foliage in the existing draw',
);
assert.equal(understoryBuilt.setDeciduousDormancy(1), false);
understoryBuilt.dispose();

const stumpSource = readFileSync(
  join(process.cwd(), 'src/props/RoadStumps.ts'),
  'utf8',
);
const forestBuilderSource = readFileSync(
  join(process.cwd(), 'src/vegetation/seedthree/seedThreeForestBuilder.ts'),
  'utf8',
);
assert.match(stumpSource, /resolveBark\?\.\(placement\.species\)/);
assert.match(stumpSource, /Fresh stump growth rings/);
assert.match(stumpSource, /\[barkMaterial, cutFaceMaterial, barkMaterial\]/);
assert.match(stumpSource, /mesh\.visible = nextCount > 0/);
assert.match(forestBuilderSource, /resolveSeedThreeHarvestStumpBark/);
assert.match(forestBuilderSource, /map:\s*assets\.barkTexture/);
assert.match(forestBuilderSource, /normalMap:\s*assets\.barkNormal/);
assert.match(forestBuilderSource, /roughnessMap:\s*assets\.barkRoughness/);

assert.equal(HARVEST_STUMP_HIDE_DISTANCE, 144);
assert.equal(HARVEST_STUMP_SHOW_DISTANCE, 128);
let harvestStumpsVisible = true;
harvestStumpsVisible = shouldShowHarvestStumps(harvestStumpsVisible, 144.01, false);
assert.equal(harvestStumpsVisible, false, 'stumps must disappear beyond the 144 m cutoff');
harvestStumpsVisible = shouldShowHarvestStumps(harvestStumpsVisible, 136, false);
assert.equal(harvestStumpsVisible, false, 'the hysteresis band must prevent zoom flicker');
harvestStumpsVisible = shouldShowHarvestStumps(harvestStumpsVisible, 128, false);
assert.equal(harvestStumpsVisible, true, 'stumps must return once the camera is within 128 m');
assert.equal(
  shouldShowHarvestStumps(false, 999, true),
  true,
  'first-person mode must keep nearby stump detail enabled regardless of orbit telemetry',
);
