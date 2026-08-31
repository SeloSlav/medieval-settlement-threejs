import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createBowyerFletcherMesh,
  createTradingPostMesh,
  createWeaponsmithArmorerMesh,
} from '../src/buildings/meshes/specialistWorkshopMeshes.ts';

function objectsNamed(root: THREE.Object3D, name: string): THREE.Object3D[] {
  const found: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (object.name === name) found.push(object);
  });
  return found;
}

function requireNamed(root: THREE.Object3D, name: string): THREE.Object3D {
  const object = root.getObjectByName(name);
  assert.ok(object, `${root.name} must contain ${name}`);
  return object;
}

function triangleCount(root: THREE.Object3D): number {
  let triangles = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry;
    triangles += geometry.index
      ? geometry.index.count / 3
      : (geometry.getAttribute('position')?.count ?? 0) / 3;
  });
  return triangles;
}

function deterministicSignature(root: THREE.Object3D): string {
  const box = new THREE.Box3().setFromObject(root);
  const names: string[] = [];
  root.traverse((object) => names.push(object.name));
  return JSON.stringify({
    names,
    triangles: triangleCount(root),
    bounds: [...box.min.toArray(), ...box.max.toArray()].map((value) => Number(value.toFixed(4))),
  });
}

function assertPerforatedEntrance(root: THREE.Group): void {
  const doors: THREE.Group[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Group && object.userData.facadeOpeningKind === 'door') doors.push(object);
  });
  assert.ok(doors.length >= 1, `${root.name} must own a semantic door opening`);
  assert.ok(
    objectsNamed(root, 'Gable shell positive-z perforated wall').length >= 1,
    `${root.name} front wall must be rebuilt around physical apertures`,
  );
  assert.ok(
    root.children.some((child) => child.name === 'Gable shell positive-z perforated wall'),
    `${root.name} aperture must belong to the shell rather than an overlay decal`,
  );
}

const armorer = createWeaponsmithArmorerMesh();
assert.equal(armorer.userData.proceduralPlanId, 'weaponsmith-armorer-secure-workshop-v1');
assertPerforatedEntrance(armorer);
requireNamed(armorer, 'Armorer joined working-bay shingle roof');
requireNamed(armorer, 'Armorer masonry forge stack');
requireNamed(armorer, 'Armorer heavy bench');
requireNamed(armorer, 'Armorer finished-work rack');
assert.equal(armorer.getObjectByName('Direct-process bloomery'), undefined, 'armorer must not inherit the smithy bloomery plan');
assert.ok(triangleCount(armorer) <= 13_000, 'armorer must remain inside its catalog triangle ceiling');
assert.equal(deterministicSignature(armorer), deterministicSignature(createWeaponsmithArmorerMesh()));

const bowyer = createBowyerFletcherMesh();
assert.equal(bowyer.userData.proceduralPlanId, 'bowyer-fletcher-seasoning-range-v1');
assertPerforatedEntrance(bowyer);
requireNamed(bowyer, 'Bowyer joined seasoning-bay shingle roof');
requireNamed(bowyer, 'Bowyer stave seasoning rack');
requireNamed(bowyer, 'Bowyer long tillering bench');
requireNamed(bowyer, 'Bowyer straw proofing target');
assert.equal(bowyer.getObjectByName('CarpenterTimberStockpile'), undefined, 'bowyer must not inherit carpenter inventory geometry');
assert.ok(triangleCount(bowyer) <= 12_000, 'bowyer must stay within the common workshop ceiling');
assert.equal(deterministicSignature(bowyer), deterministicSignature(createBowyerFletcherMesh()));

const tradingPost = createTradingPostMesh();
assert.equal(tradingPost.userData.proceduralPlanId, 'trading-post-secure-roadside-store-v1');
assertPerforatedEntrance(tradingPost);
requireNamed(tradingPost, 'Trading post loading-bay shingle roof');
assert.equal(objectsNamed(tradingPost, 'Trading post loading-bay post').length, 4);
requireNamed(tradingPost, 'Trading post road signboard');
const cartPortal = tradingPost.children.find((child) => (
  child instanceof THREE.Group
  && child.userData.facadeOpeningKind === 'door'
  && child.userData.facadeOpeningWidth >= 2.3
));
assert.ok(cartPortal, 'trading post must cut a wide physical cart portal');
assert.equal(cartPortal.userData.doubleLeaf, true, 'trading post cart portal must use two leaves');
const proceeds = requireNamed(tradingPost, 'TradingPostProceedsChest');
assert.equal(proceeds.visible, false, 'trading proceeds remain inventory-driven');
assert.equal(objectsNamed(tradingPost, 'TradingPostReceiptSegment').length, 3);
assert.equal(tradingPost.getObjectByName('StorehouseTimberStockpile'), undefined, 'trading post must not inherit village-storehouse stock bays');
assert.equal(deterministicSignature(tradingPost), deterministicSignature(createTradingPostMesh()));

console.log(
  `specialist workshop architecture passed: armorer ${triangleCount(armorer)} tris, `
  + `bowyer ${triangleCount(bowyer)} tris, trading post ${triangleCount(tradingPost)} tris`,
);
