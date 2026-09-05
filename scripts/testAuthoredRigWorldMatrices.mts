import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AuthoredRigWorldMatrices } from '../src/scene/AuthoredRigWorldMatrices.ts';
import { AuthoredRigEvaluatorGroup } from '../src/scene/AuthoredRigEvaluatorGroup.ts';

const scene = new THREE.Group();
const boundary = new AuthoredRigEvaluatorGroup();
const actor = new THREE.Group();
scene.add(boundary); boundary.add(actor);
const nodes: THREE.Object3D[] = [actor];
for (let i=1;i<90;i++) {
  const bone = new THREE.Bone();
  bone.position.set(i*.01,.07,-.03);
  nodes[Math.floor((i-1)/3)]!.add(bone);
  nodes.push(bone);
}
const reference = scene.clone(true);
const referenceActor = reference.children[0]!.children[0]!;
const expected: THREE.Object3D[] = [];
referenceActor.traverse(node=>expected.push(node));
const actual: THREE.Object3D[] = [];
actor.traverse(node=>actual.push(node));
const updater = new AuthoredRigWorldMatrices(actor);
for(let frame=0;frame<180;frame++) {
  scene.position.set(frame*.003,.4,-2); reference.position.copy(scene.position);
  scene.rotation.y=frame*.002; reference.rotation.copy(scene.rotation);
  actor.scale.set(1,.95,1.03); referenceActor.scale.copy(actor.scale);
  for(let i=1;i<actual.length;i++) {
    const node=actual[i]!, other=expected[i]!;
    if(i%3===0) node.quaternion.setFromEuler(new THREE.Euler(Math.sin(frame*.02+i)*.1,0,.1));
    if(i%7===0) node.position.x=Math.sin(frame*.01+i)*.1;
    other.position.copy(node.position); other.quaternion.copy(node.quaternion); other.scale.copy(node.scale);
    if(i===5) {
      node.matrixAutoUpdate=other.matrixAutoUpdate=false;
      node.matrix.makeRotationY(frame*.01); other.matrix.copy(node.matrix);
    }
  }
  updater.update();
  referenceActor.updateWorldMatrix(true,true);
  for(let i=0;i<actual.length;i++) assert.deepEqual(actual[i]!.matrixWorld.elements,expected[i]!.matrixWorld.elements,`frame ${frame}, bone ${i}`);
}
let automaticRigUpdates=0;
actor.updateMatrixWorld=()=>{automaticRigUpdates++;};
for(let pass=0;pass<16;pass++) scene.updateMatrixWorld(true);
assert.equal(automaticRigUpdates,0,'render passes must not re-evaluate hidden rigs');
assert.equal(actor.visible,true,'evaluation boundary must preserve actor visibility');
console.log('Authored rig matrix parity: 90 bones, 180 frames, parent motion, nonuniform scale, manual matrices; no duplicate render-pass evaluation.');
