import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installStaticTransformBoundary, invalidateStaticTransformBoundary, isRetainedRenderSubtree } from '../src/scene/StaticTransformBoundary.ts';
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
console.log('Static residence transforms: exact ancestor/child edits, zero idle visits, live chimney smoke PASS');
