import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AuthoredRigEvaluatorGroup } from '../src/scene/AuthoredRigEvaluatorGroup.ts';
import { AuthoredInstanceWorldTransforms } from '../src/scene/AuthoredInstanceWorldTransforms.ts';

const world = new THREE.Group(), movingParent = new THREE.Group(), evaluators = new AuthoredRigEvaluatorGroup();
world.add(movingParent); movingParent.add(evaluators);
const models = Array.from({length:600}, (_, i) => {
  const actor = new THREE.Group(), model = new THREE.Group();
  actor.position.set(i%25,0,Math.floor(i/25));model.scale.setScalar(.7+i*.0001);
  actor.add(model);evaluators.add(actor);return model;
});
const cache = new AuthoredInstanceWorldTransforms();
let ancestorUpdates = 0;
const original = movingParent.updateWorldMatrix;
movingParent.updateWorldMatrix = function(parents,children) { ancestorUpdates++;original.call(this,parents,children); };
const expectedWorld = (node:THREE.Object3D):THREE.Matrix4 => {
  const local = node.matrixAutoUpdate ? new THREE.Matrix4().compose(node.position,node.quaternion,node.scale) : node.matrix.clone();
  return node.parent ? expectedWorld(node.parent).multiply(local) : local;
};
for(let frame=0;frame<20;frame++) {
  movingParent.rotation.y = frame*.1;world.position.x=frame;
  cache.reset();const before=ancestorUpdates;
  for(const [i,model] of models.entries()) {
    model.parent!.rotation.y=frame+i*.01;model.position.y=frame*.01;
    cache.update(model);assert.deepEqual(model.matrixWorld.elements,expectedWorld(model).elements);
  }
  assert.equal(ancestorUpdates-before,1,'600 actors share one ancestor update per pose commit');
}
const detachedParent = new THREE.Group();detachedParent.scale.set(2,3,4);detachedParent.add(models[0]!);
cache.update(models[0]!);assert.deepEqual(models[0]!.matrixWorld.elements,expectedWorld(models[0]!).elements);
const alternate = new AuthoredRigEvaluatorGroup();movingParent.add(alternate);alternate.position.z=7;alternate.add(models[1]!);
cache.update(models[1]!);assert.deepEqual(models[1]!.matrixWorld.elements,expectedWorld(models[1]!).elements);
console.log('Authored instance transforms PASS: 12,000 exact actor matrices, shared ancestors, reparenting, ordinary-root fallback');
