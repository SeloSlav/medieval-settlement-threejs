import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { installMilitaryHandGrip } from '../src/settlement/militaryHandGrip.ts';
import { meleePalmLocal } from '../src/settlement/meleeHandGrip.ts';
import { applyCombatWeaponPose, bindCombatWeaponRig, resetCombatWeaponRig, resolveCombatWeaponPresentation } from '../src/settlement/combatWeaponAnimation.ts';
import { attachMilitaryEquipment, createMilitaryEquipmentSources, setMilitaryEquipmentCombatStance } from '../src/settlement/militaryEquipment.ts';
Object.assign(globalThis, {self:globalThis, createImageBitmap:async()=>({width:1,height:1,close(){}})});
Object.defineProperty(globalThis,'ProgressEvent',{value:class{constructor(public type:string){}}});
const sources=createMilitaryEquipmentSources();
const pos=(b:THREE.Object3D)=>b.getWorldPosition(new THREE.Vector3());
const rot=(b:THREE.Object3D)=>b.getWorldQuaternion(new THREE.Quaternion());
for(const name of ['worker-male-common-01-v002','ottoman-raider-common-01-v001']) {
 const bytes=readFileSync(`public/assets/models/villagers/${name}.glb`);
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 installMilitaryHandGrip(gltf.scene);
 const bounds=new THREE.Box3().setFromObject(gltf.scene);
 for(const kind of ['spear','spear-shield','pike-kit','halberd','sidearm','sidearm-shield','sword-shield','bow','crossbow'] as const) {
  for(const mounted of [false,true]) {
   if(mounted&&(name.startsWith('ottoman')||!['spear','spear-shield','sidearm','sidearm-shield','bow'].includes(kind)))continue;
   const model=clone(gltf.scene) as THREE.Group;model.scale.setScalar(1.72/bounds.getSize(new THREE.Vector3()).y);model.updateMatrixWorld(true);
   const equipment=attachMilitaryEquipment(model,sources[kind]);
   const rig=bindCombatWeaponRig(model,kind,equipment)!;
   if(mounted) {
    const sit=gltf.animations.find(c=>/^(sit|sitting)$/i.test(c.name));
    if(sit){const mixer=new THREE.AnimationMixer(model);mixer.clipAction(sit).play();mixer.setTime(.35);}
   }
   const presentation=resolveCombatWeaponPresentation(kind,1.5)!;
   const mounts=equipment.userData.workerToolMounts as THREE.Group[];
   const mount=mounts.find(m=>m.userData.workerToolCombatRole==='melee-held')??equipment;
   const max:Record<string,{value:number,phase:number}>={};
   const record=(label:string,v:number,p:number)=>{if(!max[label]||v>max[label].value)max[label]={value:Number(v.toFixed(4)),phase:p};};
   let previous:THREE.Quaternion[]=[];
   for(let f=0;f<=200;f++) {
    resetCombatWeaponRig(rig);setMilitaryEquipmentCombatStance(equipment,'melee');
    applyCombatWeaponPose(rig,{tool:kind,targetDistance:1.5,attackCooldown:(1-f/200)*presentation.attackSeconds,dtSeconds:0,logicalMode:'fight',mounted});
    const p=f/200;
    for(const left of [false,true]) {
     if(left&&(!mount.userData.workerToolSupportGripLocal||mounted))continue;
     const h=left?rig.armBones.leftHand:rig.armBones.rightHand,e=left?rig.armBones.leftForearm:rig.armBones.rightForearm;
     const offset=meleePalmLocal(h,left,new THREE.Vector3());
     const grip=new THREE.Vector3(...(mount.userData[left?'workerToolAttackSupportGripLocal':'workerToolAttackGripLocal']??mount.userData[left?'workerToolSupportGripLocal':'workerToolGripLocal']));
     if(left&&(kind==='spear'||kind==='pike-kit'))grip.y=mount.worldToLocal(h.localToWorld(offset.clone())).y;
     const contact=mount.localToWorld(grip);
     record(left?'leftError':'rightError',contact.distanceTo(h.localToWorld(offset)),p);
     record(left?'leftWrist':'rightWrist',THREE.MathUtils.radToDeg(new THREE.Vector3(0,1,0).applyQuaternion(rot(h)).angleTo(pos(h).sub(pos(e)))),p);
    }
    const now=rig.ownedBones.map(rot);
    if(previous.length)now.forEach((q,i)=>{
     const step=THREE.MathUtils.radToDeg(q.angleTo(previous[i]!));
     if(step>(max.jointStep?.value??0)) { record('jointStep',step,p);(max.jointStep as any).bone=rig.ownedBones[i]!.name; }
    });
    previous=now;
    if(f===166&&process.argv.includes('--bones'))console.log(kind,mounted,JSON.stringify({motion:rig.attackMotion,torso:Object.fromEntries(Object.entries(rig.torsoBones).map(([k,b])=>[k,rot(b).toArray()])),bones:Object.fromEntries(Object.entries(rig.armBones).map(([k,b])=>[k,pos(b).toArray()]))}));
   }
   console.log(name,kind,mounted?'mounted':'foot',JSON.stringify(max));
  }
 }
}
