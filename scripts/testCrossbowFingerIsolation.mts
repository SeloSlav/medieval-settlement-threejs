import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {installMilitaryHandGrip} from '../src/settlement/militaryHandGrip.ts';
import {createMilitaryEquipmentSources,attachMilitaryEquipment} from '../src/settlement/militaryEquipment.ts';
import {bindCombatWeaponRig,applyCombatWeaponPose,resetCombatWeaponRig,resolveCombatWeaponPresentation} from '../src/settlement/combatWeaponAnimation.ts';
Object.assign(globalThis,{self:globalThis,createImageBitmap:async()=>({width:1,height:1,close(){}})});
const snapshot:Record<string,string>={},source=createMilitaryEquipmentSources().crossbow;
for(const name of ['worker-male-common-01-v002','ottoman-raider-common-01-v001']){
 const bytes=fs.readFileSync(`public/assets/models/villagers/${name}.glb`),gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 installMilitaryHandGrip(gltf.scene);const model=gltf.scene;model.scale.setScalar(1.72/new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y);
 const rig=bindCombatWeaponRig(model,'crossbow',attachMilitaryEquipment(model,source))!,hash=createHash('sha256');
 for(let frame=0;frame<=100;frame++){
  resetCombatWeaponRig(rig);applyCombatWeaponPose(rig,{tool:'crossbow',targetDistance:8,attackCooldown:(1-frame/100)*resolveCombatWeaponPresentation('crossbow',8)!.attackSeconds,dtSeconds:0,logicalMode:'fight'});model.updateMatrixWorld(true);
  for(const b of rig.ownedBones)if(!rig.gripBones.includes(b))hash.update(JSON.stringify([b.name,b.position.toArray(),b.quaternion.toArray(),b.scale.toArray(),b.matrixWorld.toArray()]));
  hash.update(JSON.stringify(rig.rangedMount!.matrixWorld.toArray()));
 }
 snapshot[name]=hash.digest('hex');
}
const path='scripts/fixtures/crossbow-original-hand-path.json';
if(process.argv.includes('--record'))fs.writeFileSync(path,JSON.stringify(snapshot,null,2));
else assert.deepEqual(snapshot,JSON.parse(fs.readFileSync(path,'utf8')),'Finger fitting must preserve the original wrist, elbow, torso and stock path');
console.log('Original crossbow arm, wrist and stock transforms preserved over 202 poses.');
