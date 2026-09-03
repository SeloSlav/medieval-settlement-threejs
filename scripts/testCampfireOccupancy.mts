import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BuildingMarkers } from '../src/buildings/BuildingMarkers.ts';
import { buildingMarkerSignatures } from '../src/buildings/buildingMarkerSignature.ts';
import { fireEffectFromRoot } from '../src/fires/FireEffect.ts';
import type { BuildingState } from '../src/resources/types.ts';
import type { Terrain } from '../src/terrain/Terrain.ts';

const parent = new THREE.Group();
const markers = new BuildingMarkers({
  terrain: { getHeightAt: () => 2.5 } as unknown as Terrain,
  parent,
});
let hunter = building({ id: 'hunter', kind: 'hunters_hall' });
let founders = building({ id: 'founders', kind: 'founders_camp', x: 30, foundingShelterActive: true });
const sync = () => markers.syncBuildings([hunter, founders]);
sync();

const hunterMesh = parent.getObjectByName("Hunter's camp") as THREE.Group;
const hearth = hunterMesh.getObjectByName('Hunter hearth')!;
const hunterRoot = campfireRoots(hunterMesh)[0]!;
const hunterFire = fireEffectFromRoot(hunterRoot)!;
const founderRoot = campfireRoots(parent.getObjectByName("Founders' camp and open stockyard")!)[0]!;
const founderFire = fireEffectFromRoot(founderRoot)!;
assert.equal(hunterFire.active, false, 'an unstaffed camp has no flame, smoke, sparks, or firelight');
assert.equal(hunterRoot.visible, false);
assert.equal(hunterFire.light.intensity, 0);
assert.equal(founderFire.active, true, 'founders are occupants even with zero assigned labor');
assert.equal(founderRoot.visible, true);
assert.equal(campfireRoots(hunterMesh).length, 1, 'static batching must preserve the runtime effect');
assert.ok(hearth.visible, 'an extinguished hearth remains present');

const unstaffedSignature = signature(hunter);
hunter = { ...hunter, assignedLabor: 1, actionCooldown: 999, firewood: 0, food: 0 };
const staffedSignature = signature(hunter);
assert.notEqual(unstaffedSignature.visual, staffedSignature.visual, 'staffing alone must invalidate snapshot presentation');
assert.equal(unstaffedSignature.collider, staffedSignature.collider, 'lighting does not rebuild collision');
assert.equal(staffedSignature.visual, signature({ ...hunter, assignedLabor: 3 }).visual);
sync();
assert.equal(campfireRoots(hunterMesh)[0], hunterRoot, 'staffing reuses the existing effect');
assert.equal(hunterFire.active, true, 'idle, empty-stock buildings still have occupied campfires');
assert.equal(hunterRoot.visible, true);
assert.ok(hunterFire.light.intensity > 0);
const fireOrigin = hunterRoot.getWorldPosition(new THREE.Vector3());
const hearthOrigin = hearth.getWorldPosition(new THREE.Vector3());
assert.ok(fireOrigin.distanceTo(hearthOrigin) < 1e-6, 'effects stay centred on the authored hearth');

const flameScale = hunterFire.flames[0]!.sprite.scale.clone();
const smokePosition = hunterFire.smoke[0]!.sprite.position.clone();
markers.tick(0.25);
assert.ok(hunterFire.flames[0]!.sprite.scale.distanceTo(flameScale) > 0, 'staffed flames flicker');
assert.ok(hunterFire.smoke[0]!.sprite.position.distanceTo(smokePosition) > 0, 'staffed smoke rises');
assert.equal(hunterFire.elapsedSeconds, 0.25);
assert.equal(founderFire.elapsedSeconds, 0.25);
markers.setCampfireNightLighting(1);
markers.tick(0);
assert.equal(hunterFire.nightLighting, 1);
assert.equal(founderFire.nightLighting, 1);

hunter = { ...hunter, assignedLabor: 0 };
sync();
const elapsedBeforeIdle = hunterFire.elapsedSeconds;
const litSmokeBeforeIdle = hunterRoot.userData.litSmokeElapsedSeconds;
markers.tick(0.25);
assert.equal(hunterFire.active, false);
assert.equal(hunterFire.light.intensity, 0);
assert.equal(hunterFire.elapsedSeconds, elapsedBeforeIdle, 'inactive effects do no animation work');
assert.equal(hunterRoot.userData.litSmokeElapsedSeconds, litSmokeBeforeIdle, 'firelit smoke stops too');
assert.equal(founderFire.elapsedSeconds, 0.5, 'founders remain lit independent of staffing');

hunter = { ...hunter, assignedLabor: 2 };
sync();
assert.equal(hunterFire.active, true, 'restaffing relights the same campfire');
markers.setDestroyedBuildingIds(new Set(['hunter']));
assert.equal(hunterFire.active, false, 'a destroyed occupied building cannot emit firelight');
markers.setDestroyedBuildingIds(new Set());
assert.equal(hunterFire.active, true);

hunter = { ...hunter, constructionComplete: false, fireRepairActive: true };
sync();
assert.equal(fireEffectFromRoot(hunterRoot), hunterFire, 'repairs retain the completed mesh');
assert.equal(hunterFire.active, false, 'repair workers do not occupy an unfinished worksite');
hunter = { ...hunter, constructionComplete: true, fireRepairActive: false };
sync();
assert.equal(hunterFire.active, true);

founders = { ...founders, foundingShelterActive: false };
sync();
assert.equal(founderFire.active, false, 'packing away the occupied shelter area extinguishes its fire');
const founderElapsed = founderFire.elapsedSeconds;
markers.tick(0.25);
assert.equal(founderFire.elapsedSeconds, founderElapsed);

hunter = { ...hunter, constructionComplete: false, constructionProgress: 0.3 };
sync();
assert.equal(fireEffectFromRoot(hunterRoot), null, 'mesh replacement disposes the old effect');
assert.equal(campfireRoots(parent).length, 1, 'unfinished construction has no campfire effect');
hunter = { ...hunter, constructionComplete: true };
sync();
const replacement = campfireRoots(parent.getObjectByName("Hunter's camp")!)[0]!;
assert.notEqual(replacement, hunterRoot);
assert.equal(fireEffectFromRoot(replacement)?.active, true);
markers.syncBuildings([]);
assert.equal(fireEffectFromRoot(replacement), null, 'removing a building releases its fire effect');
assert.equal(fireEffectFromRoot(founderRoot), null);
markers.tick(0.25);
markers.dispose();
console.log('Campfires track occupancy, animate fire and smoke, and clean up across the building lifecycle.');

function campfireRoots(root: THREE.Object3D): THREE.Group[] {
  const result: THREE.Group[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Group && object.userData.runtimeCampfireEffect === true) result.push(object);
  });
  return result;
}

function signature(state: BuildingState) {
  return buildingMarkerSignatures(new Map([[state.id, state]]));
}

function building(overrides: Partial<BuildingState>): BuildingState {
  return {
    id: 'camp', kind: 'hunters_hall', x: 12, z: -8, yaw: Math.PI / 3,
    workRadius: 0, actionCooldown: 0, assignedLabor: 0,
    timber: 0, firewood: 0, stone: 0, water: 0, food: 0,
    ale: 0, preservedFood: 0, honey: 0, wine: 0, wool: 0, cloth: 0,
    ironwork: 0, polearms: 0, gold: 0, waterCapacity: 0,
    constructionComplete: true, constructionProgress: 1,
    constructionRequiredTimber: 0, constructionRequiredStone: 0,
    constructionDeliveredTimber: 0, constructionDeliveredStone: 0,
    constructionReservedTimber: 0, constructionReservedStone: 0,
    constructionTreasuryTimber: 0, constructionTreasuryStone: 0,
    storehouseAcceptsTimber: true, storehouseAcceptsStone: true, storehouseAcceptsFirewood: true,
    ...overrides,
  };
}
