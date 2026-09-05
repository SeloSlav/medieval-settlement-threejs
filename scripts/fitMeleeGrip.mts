import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { installMilitaryHandGrip } from '../src/settlement/militaryHandGrip.ts';
import { meleePalmLocal } from '../src/settlement/meleeHandGrip.ts';
import { applyCombatWeaponPose, bindCombatWeaponRig, restoreCombatWeaponPose, resolveCombatWeaponPresentation } from '../src/settlement/combatWeaponAnimation.ts';
import { attachMilitaryEquipment, createMilitaryEquipmentSources } from '../src/settlement/militaryEquipment.ts';
Object.assign(globalThis,{self:globalThis,createImageBitmap:async()=>({width:1,height:1,close(){}})});
Object.defineProperty(globalThis,'ProgressEvent',{value:class{constructor(public type:string){}}});
const sources=createMilitaryEquipmentSources();
const failures:string[]=[];
const shieldFit=process.argv.includes('--shield');
const defensive=process.argv.includes('--defend');
for(const name of ['worker-male-common-01-v002','ottoman-raider-common-01-v001']) {
 const bytes=readFileSync(`public/assets/models/villagers/${name}.glb`);
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 installMilitaryHandGrip(gltf.scene);
 const height=new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3()).y;
 for(const [kind,left] of shieldFit?[['spear-shield',true],['sidearm-shield',true],['sword-shield',true]] as const:defensive||process.argv.includes('--shielded')?[['spear-shield',false],['sidearm-shield',false],['sword-shield',false]] as const:[['spear',false],['spear',true],['pike-kit',false],['pike-kit',true],['halberd',false],['halberd',true],['sidearm',false],['sword-shield',false],['bow',false]] as const) {
  const filter=process.argv.find(a=>a.startsWith('--filter='))?.slice(9);
  if(filter&&!`${name}/${kind}/${left}`.includes(filter))continue;
  if(process.argv.includes('--left')&&!left)continue;
  if(process.argv.includes('--extra')&&!['pike-kit','sword-shield','bow'].includes(kind))continue;
  const model=clone(gltf.scene) as THREE.Group;model.scale.setScalar(1.72/height);model.updateMatrixWorld(true);
  const equipment=attachMilitaryEquipment(model,sources[kind]),rig=bindCombatWeaponRig(model,kind,equipment)!;
  const mount=shieldFit?rig.shieldMount!:(equipment.userData.workerToolMounts as THREE.Group[]).find(m=>m.userData.workerToolCombatRole==='melee-held')??equipment;
  const phase=Number(process.argv.find(a=>a.startsWith('--phase='))?.slice(8)??.56);
  applyCombatWeaponPose(rig,{tool:kind,targetDistance:1.5,attackCooldown:(1-phase)*resolveCombatWeaponPresentation(kind,1.5)!.attackSeconds,logicalMode:'fight',dtSeconds:0,defensive});
  const hand=left?rig.armBones.leftHand:rig.armBones.rightHand,bones=left?rig.leftGripBones:rig.gripBones;
  const axis=shieldFit?new THREE.Vector3(0,0,1):new THREE.Vector3(0,Math.SQRT1_2,Math.SQRT1_2);
  const center=(shieldFit?mount.userData.shieldGripLocal:
   mount.userData[left?'workerToolAttackSupportGripLocal':'workerToolAttackGripLocal']??mount.userData[left?'workerToolSupportGripLocal':'workerToolGripLocal']) as [number,number,number];
  const blade=!shieldFit&&(kind==='sidearm'||kind==='sidearm-shield'||kind==='sword-shield');
  const radius=shieldFit?.019:kind==='bow'?.022:kind==='spear'||kind==='spear-shield'?.0155:.018;
  const shift=Number(process.argv.find(a=>a.startsWith('--offset='))?.slice(9)??0);
  const shiftWorld=new THREE.Vector3(left?shift:-shift,0,0).multiply(hand.getWorldScale(new THREE.Vector3())).applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion()));
  const samples:{mesh:THREE.SkinnedMesh,indices:number[],faces:number[][]}[][]=Array.from({length:5},()=>[]);
  model.traverse(o=>{if(o instanceof THREE.SkinnedMesh){
   const skin=o.geometry.getAttribute('skinIndex'),weight=o.geometry.getAttribute('skinWeight');
   const index=o.geometry.index!;
   for(let finger=0;finger<5;finger++) {
    const indices:number[]=[];
    for(let v=0;v<skin.count;v++)for(let j=0;j<4;j++){
     const bi=bones.indexOf(o.skeleton.bones[skin.getComponent(v,j)]!);
     if(bi>=0&&Math.floor(bi/2)===finger&&weight.getComponent(v,j)>.35){indices.push(v);break;}
    }
    const set=new Set(indices),faces:number[][]=[];
    for(let i=0;i<index.count;i+=3){const f=[index.getX(i),index.getX(i+1),index.getX(i+2)];if(f.every(v=>set.has(v)))faces.push(f);}
    samples[finger]!.push({mesh:o,indices,faces});
   }
  }});
  const evaluatePose=(finger:number)=>{
   model.updateMatrixWorld(true);const inverse=mount.matrixWorld.clone().invert();
   const centerY=left&&(kind==='spear'||kind==='pike-kit')
    ?hand.localToWorld(meleePalmLocal(hand,true,new THREE.Vector3())).applyMatrix4(inverse).y:center[1];
   let overlap=0,gap=Infinity,count=0;
   const inspect=(p:THREE.Vector3)=>{
    p.sub(shiftWorld).applyMatrix4(inverse);
    if(Math.abs(p.y-centerY)>.075)return;
    const d=(shieldFit?(Math.hypot((p.x-center[0])/.019,(p.z-center[2])/.0135)-1)*.0135:Math.hypot(p.x,p.z/(blade?.84:1))-radius)*mount.getWorldScale(new THREE.Vector3()).x;
    overlap=Math.max(overlap,-d);gap=Math.min(gap,Math.abs(d));count++;
   };
   for(const {mesh,indices,faces} of samples[finger]!) {
    const deformed=new Map<number,THREE.Vector3>();
    for(const i of indices){const p=mesh.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);deformed.set(i,p);inspect(p.clone());}
    for(const f of faces)inspect(deformed.get(f[0]!)!.clone().add(deformed.get(f[1]!)!).add(deformed.get(f[2]!)!).divideScalar(3));
   }
   return {overlap,gap,count,score:16*Math.max(0,overlap-.0015)**2+gap**2};
  };
  const evaluate=(finger:number)=>{
   if(!process.argv.includes('--cycle-fit'))return evaluatePose(finger);
   const trial=bones.map(b=>b.quaternion.clone());
   let overlap=0,gap=0,count=0;
   for(const phase of [0,.1,.4,.56,.65,.85,.95,-1]) {
    restoreCombatWeaponPose(rig);
    applyCombatWeaponPose(rig,{tool:kind,targetDistance:1.5,attackCooldown:(1-Math.max(0,phase))*resolveCombatWeaponPresentation(kind,1.5)!.attackSeconds,logicalMode:'fight',dtSeconds:0,defensive:defensive||phase<0});
    bones.forEach((b,i)=>b.quaternion.copy(trial[i]!));
    const result=evaluatePose(finger);
    overlap=Math.max(overlap,result.overlap);gap=Math.max(gap,result.gap);count+=result.count;
   }
   return {overlap,gap,count,score:16*Math.max(0,overlap-.0015)**2+gap**2};
  };
  const before=Array.from({length:5},(_,i)=>evaluate(i));
  if(process.argv.includes('--verify')) {
   let gap=0,overlap=0,worstFrame=0,worstFinger=0;
   for(let frame=0;frame<=20;frame++) {
    restoreCombatWeaponPose(rig);
    applyCombatWeaponPose(rig,{tool:kind,targetDistance:1.5,attackCooldown:(1-frame/20)*resolveCombatWeaponPresentation(kind,1.5)!.attackSeconds,logicalMode:'fight',dtSeconds:0,defensive});
    for(let finger=0;finger<5;finger++) {
     const result=evaluate(finger);
     assert.ok(result.count>0,`${name}/${kind}/${left}/${finger}: missing finger surface samples`);
     gap=Math.max(gap,result.gap);
     if(result.overlap>overlap){overlap=result.overlap;worstFrame=frame;worstFinger=finger;}
    }
   }
   console.log(JSON.stringify({name,kind,left,maxGapMm:gap*1000,maxOverlapMm:overlap*1000,worstFrame,worstFinger}));
   if(gap>=.002||overlap>=.002)failures.push(`${name}/${kind}/${left}: gap ${gap*1000} mm, overlap ${overlap*1000} mm (limits 2 mm)`);
   continue;
  }
  const angles:number[][]=[];
  const onlyFinger=process.argv.find(a=>a.startsWith('--finger='))?.slice(9);
  for(let finger=0;finger<4;finger++) {
   if(onlyFinger!==undefined&&finger!==Number(onlyFinger)){angles.push([]);continue;}
   let best={score:Infinity,a:0,b:0};
   const step=process.argv.includes('--fine')?.05:.15;
   for(let a=step;a<=1.5;a+=step)for(let b=step;b<=1.95;b+=step) {
    bones[finger*2]!.quaternion.setFromAxisAngle(axis,left?-a:a);
    bones[finger*2+1]!.quaternion.setFromAxisAngle(axis,left?-b:b);
    const result=evaluate(finger);
    if(result.score<best.score)best={score:result.score,a,b};
   }
   angles.push([best.a,best.b].map(v=>+v.toFixed(3)));
   bones[finger*2]!.quaternion.setFromAxisAngle(axis,left?-best.a:best.a);
   bones[finger*2+1]!.quaternion.setFromAxisAngle(axis,left?-best.b:best.b);
  }
  let thumb={score:Infinity,yaw:0,roll:0};
  for(let yaw=-1.4;yaw<=1.4;yaw+=.2)for(let roll=-1;roll<=1.2;roll+=.2) {
   bones[8]!.quaternion.setFromEuler(new THREE.Euler(0,yaw,roll,'ZYX'));
   const result=evaluate(4);if(result.score<thumb.score)thumb={score:result.score,yaw,roll};
  }
  bones[8]!.quaternion.setFromEuler(new THREE.Euler(0,thumb.yaw,thumb.roll,'ZYX'));
  console.log(JSON.stringify({name,kind,left,shift,size:hand.userData.militaryGripScale,angles,thumb:[0,thumb.yaw,thumb.roll].map(v=>+v.toFixed(3)),
   before:before.map(r=>[+(r.gap*1000).toFixed(2),+(r.overlap*1000).toFixed(2)]),after:Array.from({length:5},(_,i)=>evaluate(i)).map(r=>[+(r.gap*1000).toFixed(2),+(r.overlap*1000).toFixed(2)])}));
 }
}
assert.deepEqual(failures,[],'melee fingers must contact each handle without visible penetration throughout the cycle');
