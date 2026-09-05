import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { installMilitaryHandGrip } from '../src/settlement/militaryHandGrip.ts';
import { bindCombatWeaponRig, applyCombatWeaponPose, resetCombatWeaponRig, resolveCombatWeaponPresentation } from '../src/settlement/combatWeaponAnimation.ts';
import { createMilitaryEquipmentSources, attachMilitaryEquipment, setMilitaryEquipmentCombatStance } from '../src/settlement/militaryEquipment.ts';
Object.assign(globalThis,{self:globalThis,createImageBitmap:async()=>({width:1,height:1,close(){}})});
Object.defineProperty(globalThis,'ProgressEvent',{value:class{constructor(public type:string){}}});
const bytes=readFileSync('public/assets/models/villagers/worker-male-common-01-v002.glb');
const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
installMilitaryHandGrip(gltf.scene);const model=gltf.scene;
model.scale.setScalar(1.72/new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y);model.updateMatrixWorld(true);
const equipment=attachMilitaryEquipment(model,createMilitaryEquipmentSources()['sword-shield']);
const rig=bindCombatWeaponRig(model,'sword-shield',equipment)!;
const pos=(b:THREE.Object3D)=>b.getWorldPosition(new THREE.Vector3()).toArray().map(v=>+v.toFixed(3));
const mixer=new THREE.AnimationMixer(model);
for(const clipName of ['idle','walk','run','slash']){
 const clip=gltf.animations.find(c=>c.name===clipName);if(!clip)continue;
 mixer.stopAllAction();mixer.clipAction(clip).play();mixer.setTime(.3*clip.duration);model.updateMatrixWorld(true);
 const {rightUpperArm:u,rightForearm:e,rightHand:h}=rig.armBones;
 const origin=u.getWorldPosition(new THREE.Vector3()),ep=e.getWorldPosition(new THREE.Vector3()),hp=h.getWorldPosition(new THREE.Vector3());
 const up=ep.clone().sub(origin).normalize(),lo=hp.clone().sub(ep).normalize();
 const bend=lo.clone().addScaledVector(up,-lo.dot(up)).normalize().applyQuaternion(u.getWorldQuaternion(new THREE.Quaternion()).invert());
 console.log('authored',clipName,'bend',bend.toArray(),'elbowQuat',e.quaternion.toArray(),'handQuat',h.quaternion.toArray());
}
mixer.stopAllAction();
for(const phase of [0,.12,.4,.56,.65,.72,.76,.80,.82,.87,.91]){
 resetCombatWeaponRig(rig);setMilitaryEquipmentCombatStance(equipment,'melee');
 applyCombatWeaponPose(rig,{tool:'sword-shield',targetDistance:1.5,attackCooldown:(1-phase)*resolveCombatWeaponPresentation('sword-shield',1.5)!.attackSeconds,dtSeconds:0,logicalMode:'fight'});
 const q=rig.armBones.rightHand.quaternion,raw=2*Math.atan2(q.y,q.w);
 const twist=Math.atan2(Math.sin(raw),Math.cos(raw))*180/Math.PI;
 console.log(phase,JSON.stringify({twist,handQ:q.toArray(),shoulder:pos(rig.armBones.rightUpperArm),elbow:pos(rig.armBones.rightForearm),wrist:pos(rig.armBones.rightHand)}));
}
