import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installStaticTransformBoundary, invalidateStaticTransformBoundary, isRetainedRenderSubtree, retainDynamicTransformSubtree } from '../src/scene/StaticTransformBoundary.ts';
import { ChimneySmokeEmitter } from '../src/residences/ResidenceChimneySmoke.ts';

const scene = new THREE.Scene(), parent = new THREE.Group(), house = new THREE.Group(), fixture = new THREE.Group();
scene.add(parent); parent.add(house); house.add(fixture);
const child = new THREE.Object3D(); fixture.add(child);
house.position.set(5, 2, -3); fixture.rotation.y = .7; child.position.set(2, 3, 4);
const expected = scene.clone(true);
let visits = 0;
const original = child.updateMatrixWorld;
child.updateMatrixWorld = function(force) { visits++; original.call(this, force); };
installStaticTransformBoundary(house);
const compare = () => {
  scene.updateMatrixWorld(true); expected.updateMatrixWorld(true);
  const actualNodes: THREE.Object3D[] = [], expectedNodes: THREE.Object3D[] = [];
  scene.traverse(o => actualNodes.push(o)); expected.traverse(o => expectedNodes.push(o));
  assert.equal(actualNodes.length, expectedNodes.length);
  actualNodes.forEach((node, i) => assert.deepEqual(node.matrixWorld.elements, expectedNodes[i]!.matrixWorld.elements));
};
compare(); const first = visits;
for (let i = 0; i < 20; i++) compare();
assert.equal(visits, first, 'Idle rigid descendants should not be traversed');
parent.position.x = expected.children[0]!.position.x = 13;
compare(); assert.ok(visits > first, 'Moving an ancestor updates the entire house');
const expectedHouse = expected.children[0]!.children[0]!;
house.scale.set(2, 1, 3); expectedHouse.scale.copy(house.scale); compare();
fixture.position.z = expectedHouse.children[0]!.position.z = 7;
child.visible = false; invalidateStaticTransformBoundary(house); compare();
child.visible = true;
const added = new THREE.Object3D(); added.position.set(7, 3, 1);
house.add(added); expectedHouse.add(added.clone()); invalidateStaticTransformBoundary(house); compare();
house.remove(added); expectedHouse.remove(expectedHouse.children[1]!); invalidateStaticTransformBoundary(house); compare();

const retained = new THREE.Group(), stock = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
house.add(retained); retained.add(stock); stock.layers.mask = 0;
invalidateStaticTransformBoundary(house); scene.updateMatrixWorld(true);
assert.equal(isRetainedRenderSubtree(retained), true, 'A fully batched source keeps gameplay ownership without renderer traversal');
stock.layers.mask = 1; stock.visible = false;
invalidateStaticTransformBoundary(house); scene.updateMatrixWorld(true);
assert.equal(isRetainedRenderSubtree(retained), false, 'Visibility may return between state updates');
stock.visible = true;
assert.equal(isRetainedRenderSubtree(stock), false);

const chimney = new THREE.Object3D(); chimney.position.set(1, 6, 2); house.add(chimney);
const smoke = new ChimneySmokeEmitter(chimney, 0); smoke.setActive(true);
invalidateStaticTransformBoundary(house); scene.updateMatrixWorld(true);
for (let i = 0; i < 12; i++) {
  smoke.tick(1 / 60); scene.updateMatrixWorld(true);
  const emitter = chimney.children[0]!;
  assert.equal(isRetainedRenderSubtree(emitter), false, 'An initially empty smoke owner must remain in renderer traversal');
  assert.ok(emitter.children.length > 0);
  for (const puff of emitter.children) {
    const matrix = new THREE.Matrix4().compose(puff.position, puff.quaternion, puff.scale);
    assert.deepEqual(puff.matrixWorld.elements, matrix.premultiply(emitter.matrixWorld).elements, 'Smoke moves beneath an idle house boundary');
  }
}
smoke.setActive(false); assert.equal(chimney.children[0]!.children.length, 0); smoke.dispose();

// Static ancestors must not suppress nested rotating or particle subtrees.
const mixed = new THREE.Group(), mount = new THREE.Group(), island = new THREE.Group();
const rigid = new THREE.Object3D(), rotor = new THREE.Object3D();
scene.add(mixed); mixed.add(rigid, mount); mount.add(island); island.add(rotor);
mixed.position.set(-8, 6, 4); mixed.scale.set(2, 1.5, .8); mount.rotation.y = .45;
rotor.position.set(1, 2, 3);
retainDynamicTransformSubtree(island);
retainDynamicTransformSubtree(rotor); // Nested declarations must not double-update.
installStaticTransformBoundary(mixed);
let rigidVisits = 0, rotorVisits = 0;
rigid.updateMatrixWorld = function(force) { rigidVisits++; THREE.Object3D.prototype.updateMatrixWorld.call(this, force); };
rotor.updateMatrixWorld = function(force) { rotorVisits++; THREE.Object3D.prototype.updateMatrixWorld.call(this, force); };
scene.updateMatrixWorld(true);
const mixedReference = mixed.clone(true);
const referenceIsland = mixedReference.children[1]!.children[0]!;
for (let frame = 0; frame < 90; frame++) {
  island.rotation.z = referenceIsland.rotation.z = frame * .045;
  rotor.scale.setScalar(1 + Math.sin(frame * .12) * .3);
  referenceIsland.children[0]!.scale.copy(rotor.scale);
  mixed.visible = frame % 3 !== 0;
  if (frame === 45) {
    mixed.position.x = mixedReference.position.x = 18;
    mount.position.y = mixedReference.children[1]!.position.y = 3;
    invalidateStaticTransformBoundary(mixed);
  }
  scene.updateMatrixWorld(true); mixedReference.updateMatrixWorld(true);
  const actual: THREE.Object3D[] = [], reference: THREE.Object3D[] = [];
  mixed.traverse(object => actual.push(object)); mixedReference.traverse(object => reference.push(object));
  actual.forEach((object, index) => assert.deepEqual(object.matrixWorld.elements, reference[index]!.matrixWorld.elements));
}
assert.equal(rigidVisits, 2, 'Rigid branches update only at first use and explicit edits');
assert.equal(rotorVisits, 91, 'Only the outermost registered island drives nested animation once per frame');
assert.equal(isRetainedRenderSubtree(island), false, 'Animated islands remain renderable even when initially empty');
mount.remove(island); invalidateStaticTransformBoundary(mixed); scene.updateMatrixWorld(true);
const removedVisits = rotorVisits; scene.updateMatrixWorld(true);
assert.equal(rotorVisits, removedVisits, 'Removing an island releases its update ownership');
console.log('Static residence transforms: exact ancestor/child edits, zero idle visits, live chimney smoke PASS');
