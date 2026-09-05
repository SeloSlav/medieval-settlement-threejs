import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {clone} from 'three/examples/jsm/utils/SkeletonUtils.js';
import {installMilitaryHandGrip} from '../src/settlement/militaryHandGrip.ts';
import {applyCombatWeaponPose,bindCombatWeaponRig,restoreCombatWeaponPose,resolveCombatWeaponPresentation,resetCombatWeaponRig} from '../src/settlement/combatWeaponAnimation.ts';
import {attachMilitaryEquipment,createMilitaryEquipmentSources} from '../src/settlement/militaryEquipment.ts';

Object.assign(globalThis,{self:globalThis,createImageBitmap:async()=>({width:1,height:1,close(){}})});
Object.defineProperty(globalThis,'ProgressEvent',{value:class{constructor(public type:string){}}});
const sources=createMilitaryEquipmentSources();
let transitions=0;
for(const name of ['worker-male-common-01-v002','ottoman-raider-common-01-v001']) {
 const bytes=readFileSync(`public/assets/models/villagers/${name}.glb`);
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 installMilitaryHandGrip(gltf.scene);
 const height=new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3()).y;
 for(const kind of Object.keys(sources) as (keyof typeof sources)[]) {
  const model=clone(gltf.scene) as THREE.Group;model.scale.setScalar(1.72/height);
  const equipment=attachMilitaryEquipment(model,sources[kind]);
  const rig=bindCombatWeaponRig(model,kind,equipment)!;
  const mixer=new THREE.AnimationMixer(model);
  const bones:THREE.Bone[]=[];model.traverse(o=>{if(o instanceof THREE.Bone)bones.push(o);});
  const snapshot=()=>bones.map(b=>[...b.position.toArray(),...b.quaternion.toArray(),...b.scale.toArray()]);
  const duration=resolveCombatWeaponPresentation(kind,1.5)!.attackSeconds;
  for(const clipName of ['idle','walk','run','sit','hit_to_body_01','flee_01']) {
   const clip=gltf.animations.find(c=>c.name.toLowerCase()===clipName)??gltf.animations.find(c=>c.name.toLowerCase().includes(clipName));
   // Raiders obtain their riding pose from the production retargeter; that
   // mounted path is separately tested in the browser against the real horse.
   if(!clip){assert.equal(clipName,'sit');continue;}
   mixer.stopAllAction();mixer.clipAction(clip).play();
   for(const yaw of [0,.7,2.5])for(const phase of [0,.12,.56,.82,.91,1]) {
    restoreCombatWeaponPose(rig);mixer.setTime(.37);model.rotation.y=yaw;model.updateMatrixWorld(true);
    const base=snapshot();
    applyCombatWeaponPose(rig,{tool:kind,targetDistance:1.5,attackCooldown:(1-phase)*duration,logicalMode:'fight',dtSeconds:0});
    assert.equal(rig.meleeBody?.applied,true,'stationary melee owns a planted stance');
    restoreCombatWeaponPose(rig);
    assert.deepEqual(snapshot(),base,`${name}/${kind}/${clipName}: restoring must release every joint and hip translation`);
    for(const context of [{moving:true},{mounted:true}]) {
     applyCombatWeaponPose(rig,{tool:kind,targetDistance:1.5,attackCooldown:(1-phase)*duration,logicalMode:'fight',dtSeconds:0,...context});
     const after=snapshot();
     bones.forEach((b,i)=>{if(/^(Hip|[LR]_(Thigh|Calf|Foot))/.test(b.name))assert.deepEqual(after[i],base[i],'moving and mounted attacks must leave the existing lower-body pose intact');});
     restoreCombatWeaponPose(rig);assert.deepEqual(snapshot(),base);
    }
    transitions++;
   }
  }
  if(kind.endsWith('shield')) {
   resetCombatWeaponRig(rig);
   for(const cooldown of [.05,duration,.05,duration]) {
    restoreCombatWeaponPose(rig);
    const result=applyCombatWeaponPose(rig,{tool:kind,targetDistance:1.5,attackCooldown:cooldown,logicalMode:'fight',dtSeconds:.016,defensive:true});
    assert.equal(result?.event,null,'holding defense must never produce a melee contact event at cooldown wrap');
   }
   restoreCombatWeaponPose(rig);resetCombatWeaponRig(rig);
   applyCombatWeaponPose(rig,{tool:kind,targetDistance:1.5,attackCooldown:.05,logicalMode:'fight',dtSeconds:0});
   restoreCombatWeaponPose(rig);
   assert.equal(applyCombatWeaponPose(rig,{tool:kind,targetDistance:1.5,attackCooldown:duration,logicalMode:'fight',dtSeconds:0})?.event?.type,'melee-contact','attacking still emits contact when cooldown wraps');
   restoreCombatWeaponPose(rig);
  }
 }
}
console.log(`${transitions} melee transitions restored exactly; moving/riding legs and defensive event suppression passed.`);
