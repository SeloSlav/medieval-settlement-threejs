import assert from 'node:assert/strict';
import * as THREE from 'three';
import { InstanceDrawCompaction } from '../src/scene/InstanceDrawCompaction.ts';

const groupSize = 17, capacity = groupSize * 57 + 3;
const geometry = new THREE.SphereGeometry(.4, 5, 4);
const material = new THREE.MeshBasicMaterial();
const source = new THREE.InstancedMesh(geometry, material, capacity);
const matrix = new THREE.Matrix4();
const identity = new THREE.InstancedBufferAttribute(Float32Array.from({length:capacity},(_,i)=>i),1);
geometry.setAttribute('canonicalRow',identity);
for(let row=0;row<capacity;row++) {
  source.setMatrixAt(row,matrix.makeTranslation((row%31-15)*2,Math.sin(row),Math.floor(row/31)*2-30));
}
source.instanceMatrix.needsUpdate=true;
let revision=0;
const counts=Array.from({length:Math.ceil(capacity/groupSize)},()=>groupSize);
const helper=new InstanceDrawCompaction(source,.3,{
  instanceGroupSize:groupSize,groupInstanceCount:group=>counts[group]!,selectionVersion:()=>revision,
});
const camera=new THREE.PerspectiveCamera(48,1.5,.1,95),frustum=new THREE.Frustum(),projection=new THREE.Matrix4();
for(let state=0;state<80;state++) {
  // Prefix changes can happen without modifying any canonical attributes.
  counts[state%counts.length]=state%19;
  revision++;
  source.count=state%11===0?0:state%7===0?capacity-37:capacity;
  if(state%5===0) {
    const row=(state*31)%capacity;
    source.instanceMatrix.array[row*16+12]=Math.sin(state)*30;
    source.instanceMatrix.clearUpdateRanges();source.instanceMatrix.addUpdateRange(row*16+12,1);
    source.instanceMatrix.needsUpdate=true;
  }
  camera.position.set(Math.sin(state*.43)*33,9,Math.cos(state*.43)*33);
  camera.lookAt(0,0,0);camera.updateMatrixWorld(true);
  for(const view of [camera,null]) {
    helper.prepare(view);
    if(view)frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse),camera.coordinateSystem,camera.reversedDepth);
    const expected:number[]=[];
    for(let row=0;row<source.count;row++) {
      if(row%groupSize>=Math.min(groupSize,counts[Math.floor(row/groupSize)]!))continue;
      source.getMatrixAt(row,matrix);
      const sphere=geometry.boundingSphere!.clone().applyMatrix4(matrix);sphere.radius+=.3;
      if(!view||frustum.intersectsSphere(sphere))expected.push(row);
    }
    assert.deepEqual(Array.from(helper.draw.geometry.getAttribute('canonicalRow').array.slice(0,helper.draw.count)),expected,`state=${state},camera=${!!view}`);
  }
}
helper.dispose();source.dispose();geometry.dispose();material.dispose();
console.log('160 sparse-group selections match independent per-instance visibility, including prefix edits and count restoration.');
