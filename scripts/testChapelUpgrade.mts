import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createChapelMesh } from '../src/buildings/meshes/chapelMesh.ts';
import { getBuildingFootprintHalfExtents } from '../src/buildings/BuildingTerrainLayout.ts';
import { getBuildingCost } from '../src/resources/buildingEconomy.ts';
import {
  CHAPEL_TIER1_COFFER_CAPACITY,
  CHAPEL_TIER1_TITHE_MULTIPLIER,
  CHAPEL_TIER2_TITHE_MULTIPLIER,
  CHAPEL_TIER3_COFFER_CAPACITY,
  CHAPEL_TIER3_TITHE_MULTIPLIER,
} from '../src/generated/gameBalance.ts';
import {
  chapelTierDefinition,
  chapelUpgradeCost,
  normalizeChapelTier,
} from '../src/economy/chapelUpgrade.ts';
import { disposeObject3D } from '../src/utils/dispose.ts';

const source = (path: string): string => readFileSync(path, 'utf8');

assert.equal(normalizeChapelTier(undefined), 3, 'legacy church rows retain the former large model');
assert.equal(chapelTierDefinition(1).label, 'Small wooden church');
assert.equal(chapelTierDefinition(2).label, 'Small stone church');
assert.equal(chapelTierDefinition(3).label, 'Large stone church');
assert.deepEqual(
  getBuildingCost('chapel'),
  { timber: 24, stone: 2 },
  'the timber church must not require ironwork',
);

const tier2 = chapelUpgradeCost(1);
const tier3 = chapelUpgradeCost(2);
assert.ok(tier2);
assert.ok(tier3);
assert.equal(tier2.targetTier, 2);
assert.equal(tier3.targetTier, 3);
assert.deepEqual(tier2, {
  targetTier: 2,
  timber: 12,
  stone: 30,
  ironwork: 0,
  roofTiles: 24,
});
assert.deepEqual(tier3, {
  targetTier: 3,
  timber: 28,
  stone: 52,
  ironwork: 0,
  roofTiles: 48,
});
assert.equal(tier2.ironwork + tier3.ironwork, 0, 'church construction upgrades must not consume ironwork');
assert.ok(
  tier3.timber + tier3.stone + tier3.ironwork + tier3.roofTiles
    > tier2.timber + tier2.stone + tier2.ironwork + tier2.roofTiles,
);
assert.equal(chapelUpgradeCost(3), null);
assert.ok(CHAPEL_TIER1_COFFER_CAPACITY < CHAPEL_TIER3_COFFER_CAPACITY);
assert.ok(CHAPEL_TIER1_TITHE_MULTIPLIER < CHAPEL_TIER2_TITHE_MULTIPLIER);
assert.ok(CHAPEL_TIER2_TITHE_MULTIPLIER < CHAPEL_TIER3_TITHE_MULTIPLIER);

const sizes: THREE.Vector3[] = [];
const bounds: THREE.Box3[] = [];
let tierOneChurch: THREE.Group | null = null;
for (const tier of [1, 2, 3] as const) {
  const church = createChapelMesh(tier);
  assert.equal(church.name.toLowerCase(), chapelTierDefinition(tier).label.toLowerCase());
  assert.ok(church.getObjectByName('ChapelCofferChest'), `tier ${tier} needs its physical coffer`);
  const openings: THREE.Object3D[] = [];
  church.traverse((object) => {
    assert.doesNotMatch(
      object.name,
      /window (?:vertical mullion|horizontal transom)|door cross brace/i,
      `tier ${tier} openings must not retain generic cross bars`,
    );
    if (object.userData.facadeOpeningKind === 'door' || object.userData.facadeOpeningKind === 'window') {
      openings.push(object);
      assert.equal(object.userData.hasCrossBars, false);
    }
  });
  assert.equal(
    openings.length,
    tier === 3 ? 6 : 5,
    `tier ${tier} must expose every window and door procedurally`,
  );
  const box = new THREE.Box3().setFromObject(church);
  bounds.push(box);
  sizes.push(box.getSize(new THREE.Vector3()));
  if (tier === 1) tierOneChurch = church;
  else disposeObject3D(church);
}
assert.ok(tierOneChurch);

const tierOneWindowPanes: THREE.Object3D[] = [];
const tierOneWindowFrames: THREE.Object3D[] = [];
const tierOneWallPosts: THREE.Object3D[] = [];
tierOneChurch.traverse((object) => {
  if (object.name.includes('window pane')) tierOneWindowPanes.push(object);
  if (object.name === 'Small wooden church window perimeter frame') tierOneWindowFrames.push(object);
  if (object.name.includes('wall post')) tierOneWallPosts.push(object);
});
assert.equal(tierOneWindowPanes.length, 4, 'the wooden church must retain two clear windows per side');
assert.equal(tierOneWindowFrames.length, 16, 'each wooden window must use a four-sided perimeter frame');
assert.equal(tierOneWallPosts.length, 6, 'the wooden wall frame must use three clear bay seams per side');

const positiveIntersectionVolume = (a: THREE.Object3D, b: THREE.Object3D): number => {
  const aBounds = new THREE.Box3().setFromObject(a);
  const bBounds = new THREE.Box3().setFromObject(b);
  const x = Math.max(0, Math.min(aBounds.max.x, bBounds.max.x) - Math.max(aBounds.min.x, bBounds.min.x));
  const y = Math.max(0, Math.min(aBounds.max.y, bBounds.max.y) - Math.max(aBounds.min.y, bBounds.min.y));
  const z = Math.max(0, Math.min(aBounds.max.z, bBounds.max.z) - Math.max(aBounds.min.z, bBounds.min.z));
  return x * y * z;
};
for (const pane of tierOneWindowPanes) {
  for (const frame of [...tierOneWindowFrames, ...tierOneWallPosts]) {
    assert.ok(
      positiveIntersectionVolume(pane, frame) < 1e-7,
      `${frame.name} must stay outside ${pane.name}`,
    );
  }
}

for (const tier of [1, 2] as const) {
  const church = tier === 1 ? tierOneChurch : createChapelMesh(tier);
  const bell = church.getObjectByName('Compact church bell');
  const upperBeam = church.getObjectByName('Compact church belfry upper beam');
  assert.ok(bell && upperBeam, `tier ${tier} must expose its compact bell suspension anchors`);
  const bellBounds = new THREE.Box3().setFromObject(bell);
  const beamBounds = new THREE.Box3().setFromObject(upperBeam);
  const suspensionGap = beamBounds.min.y - bellBounds.max.y;
  assert.ok(suspensionGap >= -1e-7, `tier ${tier} bell must remain below the upper belfry beam`);
  assert.ok(suspensionGap <= 0.05, `tier ${tier} bell must tuck immediately beneath the steeple`);
  if (tier === 2) disposeObject3D(church);
}
disposeObject3D(tierOneChurch);

assert.ok(sizes[1]!.x > sizes[0]!.x && sizes[1]!.z > sizes[0]!.z, 'tier two must enlarge the church');
assert.ok(sizes[2]!.x > sizes[1]!.x && sizes[2]!.z > sizes[1]!.z, 'tier three must enlarge the church again');
assert.ok(sizes[2]!.y > sizes[1]!.y, 'the final belfry must raise the landmark silhouette');
const footprint = getBuildingFootprintHalfExtents('chapel');
const finalBounds = bounds[2]!;
assert.ok(
  Math.max(Math.abs(finalBounds.min.x), Math.abs(finalBounds.max.x)) <= footprint.halfWidth,
  'the tier-one placement footprint must reserve the final church width',
);
assert.ok(
  Math.max(Math.abs(finalBounds.min.z), Math.abs(finalBounds.max.z)) <= footprint.halfDepth,
  'the tier-one placement footprint must reserve the final church depth',
);

const table = source('server/src/tables.rs');
const reducer = source('server/src/reducers/buildings.rs');
const coffer = source('server/src/economy/chapel_coffer.rs');
const tithe = source('server/src/simulation/chapel.rs');
const inspector = source('src/resources/inspector/chapelRenderer.ts');
const markerSignature = source('src/buildings/buildingMarkerSignature.ts');

assert.match(table, /#\[default\(3u8\)\]\s+pub chapel_tier: u8/);
assert.match(reducer, /pub fn upgrade_chapel[\s\S]*spend_aggregate_timber[\s\S]*spend_aggregate_stone[\s\S]*spend_aggregate_ironwork[\s\S]*spend_aggregate_roof_tiles[\s\S]*chapel_tier = cost\.target_tier/);
assert.match(coffer, /chapel_coffer_capacity_for_tier\(chapel\.chapel_tier\)/);
assert.match(tithe, /chapel_monthly_tithe_gold_for_tier\([\s\S]*chapel\.chapel_tier/);
assert.match(inspector, /data-action="upgrade-chapel"/);
assert.match(inspector, /upgrade\.ironwork[\s\S]*upgrade\.roofTiles/);
assert.match(markerSignature, /tier-\$\{building\.chapelTier/);

console.log('chapel three-tier upgrade tests passed');
