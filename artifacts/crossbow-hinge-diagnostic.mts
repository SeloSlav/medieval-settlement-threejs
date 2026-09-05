import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { installMilitaryHandGrip } from '../src/settlement/militaryHandGrip.ts';
import { applyCombatWeaponPose, bindCombatWeaponRig, resetCombatWeaponRig } from '../src/settlement/combatWeaponAnimation.ts';
import { attachMilitaryEquipment, createMilitaryEquipmentSources } from '../src/settlement/militaryEquipment.ts';
Object.assign(globalThis, {self:globalThis,createImageBitmap:async()=>({width:1,height:1,close(){}})});
Object.defineProperty(globalThis,'ProgressEvent',{value:class{constructor(public type:string){}}});
for(const name of ['worker-male-common-01-v002','ottoman-raider-common-01-v001']){
 const bytes=readFileSync(`public/assets/models/villagers/${name}.glb`);
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 const model=gltf.scene; installMilitaryHandGrip(model);
 const height=new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y;
 model.scale.setScalar(1.72/height);model.updateMatrixWorld(true);
 const rig=bindCombatWeaponRig(model,'crossbow',attachMilitaryEquipment(model,createMilitaryEquipmentSources().crossbow))!;
 let previous:THREE.Quaternion[]=[];
 let maxStep=0,maxFrame=0,maxBone='';
 for(let frame=0;frame<=100;frame++){
  resetCombatWeaponRig(rig);
  applyCombatWeaponPose(rig,{tool:'crossbow',targetDistance:8,attackCooldown:2.45*(1-frame/100),dtSeconds:0,logicalMode:'fight'});
  const entries=[];
  for(const left of [false,true]){
   const upper=left?rig.armBones.leftUpperArm:rig.armBones.rightUpperArm;
   const fore=left?rig.armBones.leftForearm:rig.armBones.rightForearm;
   const hand=left?rig.armBones.leftHand:rig.armBones.rightHand;
   const s=upper.getWorldPosition(new THREE.Vector3()),e=fore.getWorldPosition(new THREE.Vector3()),w=hand.getWorldPosition(new THREE.Vector3());
   const u=e.clone().sub(s).normalize(),f=w.clone().sub(e).normalize();
   const bend=f.clone().addScaledVector(u,-f.dot(u));
   if(bend.lengthSq()>1e-10)bend.normalize();
   bend.applyQuaternion(upper.getWorldQuaternion(new THREE.Quaternion()).invert());
   entries.push({side:left?'L':'R',flex:+THREE.MathUtils.radToDeg(u.angleTo(f)).toFixed(1),hinge:bend.toArray().map(v=>+v.toFixed(2)),elbow:e.toArray().map(v=>+v.toFixed(3))});
  }
  const rotations=rig.ownedBones.map(b=>b.getWorldQuaternion(new THREE.Quaternion()));
  rotations.forEach((q,i)=>{if(previous[i]){const step=THREE.MathUtils.radToDeg(q.angleTo(previous[i]));if(step>maxStep){maxStep=step;maxFrame=frame;maxBone=rig.ownedBones[i]!.name;}}});previous=rotations;
  if(frame%5===0)console.log(name,frame,JSON.stringify(entries));
 }
 console.log('MAX',name,maxStep,maxFrame,maxBone);
}
