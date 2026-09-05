import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { installMilitaryHandGrip } from '../src/settlement/militaryHandGrip.ts';
import { bowPalmLocal } from '../src/settlement/bowHandGrip.ts';
import { applyCombatWeaponPose, bindCombatWeaponRig, resetCombatWeaponRig, restoreCombatWeaponPose, resolveCombatWeaponPresentation } from '../src/settlement/combatWeaponAnimation.ts';
import { attachMilitaryEquipment, createMilitaryEquipmentSources, setMilitaryEquipmentCombatStance } from '../src/settlement/militaryEquipment.ts';

Object.assign(globalThis, {self:globalThis, createImageBitmap:async()=>({width:1,height:1,close(){}})});
Object.defineProperty(globalThis,'ProgressEvent',{value:class{constructor(public type:string){}}});
const sources=createMilitaryEquipmentSources();
const benchmarkRigs: {rig:NonNullable<ReturnType<typeof bindCombatWeaponRig>>,kind:keyof typeof sources,duration:number}[]=[];
for(const [name,height] of [['worker-male-common-01-v002',1.72],['ottoman-raider-common-01-v001',1.72]] as const){
 const bytes=readFileSync(`public/assets/models/villagers/${name}.glb`);
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 installMilitaryHandGrip(gltf.scene);
 const bounds=new THREE.Box3().setFromObject(gltf.scene);
 for(const kind of Object.keys(sources) as (keyof typeof sources)[]){
  const model=clone(gltf.scene) as THREE.Group;model.scale.setScalar(height/(bounds.max.y-bounds.min.y));model.updateMatrixWorld(true);
  const equipment=attachMilitaryEquipment(model,sources[kind]);
  const rig=bindCombatWeaponRig(model,kind,equipment)!;
  const base=rig.ownedBones.map(b=>b.quaternion.clone());
  const presentation=resolveCombatWeaponPresentation(kind,8)!;
  benchmarkRigs.push({rig,kind,duration:presentation.attackSeconds});
  let primaryError=0,supportError=0,maxWrist=0,worstFrame=0,maxStep=0,stepFrame=0,maxOther=0,otherFrame=0;
  const previousHands:THREE.Quaternion[]=[];
  const points:THREE.Vector3[]=[];
  let firstPose:THREE.Quaternion[]=[];
  for(let frame=0;frame<=100;frame++){
   resetCombatWeaponRig(rig);
   setMilitaryEquipmentCombatStance(equipment,presentation.stance);
   applyCombatWeaponPose(rig,{tool:kind,targetDistance:8,attackCooldown:(1-frame/100)*presentation.attackSeconds,dtSeconds:0,logicalMode:'fight'});
   assert.ok(rig.ownedBones.every(b=>b.quaternion.toArray().every(Number.isFinite)),`${name}/${kind}: nonfinite pose`);
   if(frame===0)firstPose=rig.ownedBones.map(b=>b.getWorldQuaternion(new THREE.Quaternion()));
   if(frame===100)rig.ownedBones.forEach((b,i)=>{const angle=b.getWorldQuaternion(new THREE.Quaternion()).normalize().angleTo(firstPose[i]!.clone().normalize());assert.ok(angle<1e-4,`${name}/${kind}/${b.name}: recovery seam ${angle} radians`);});
   if(kind==='bow'){
    const shoulder=rig.armBones.leftUpperArm.getWorldPosition(new THREE.Vector3());
    const elbow=rig.armBones.leftForearm.getWorldPosition(new THREE.Vector3()).sub(shoulder);
    const reach=rig.armBones.leftHand.getWorldPosition(new THREE.Vector3()).sub(shoulder).normalize();
    const up=new THREE.Vector3(0,1,0).applyQuaternion(rig.attackOrientation);
    const bend=elbow.clone().addScaledVector(reach,-elbow.dot(reach));
    assert.ok(bend.dot(up)<1e-4,`${name}/${frame}: bow elbow must flex downward rather than hyperextend (${bend.dot(up)})`);
    assert.ok(Math.abs(bend.dot(new THREE.Vector3().crossVectors(reach,up).normalize()))<1e-4,'bow elbow cannot kink sideways toward the torso');
    const hand=rig.armBones.leftHand;
    const delta=hand.quaternion.clone().multiply(rig.referenceQuaternions.get(hand)!.clone().invert());
    assert.ok(2*Math.atan2(Math.abs(delta.y),Math.abs(delta.w))<.12,'bow wrist must not absorb a large axial twist');
   }
   if(kind==='crossbow' && (frame===0 || frame>=86)){
    const shoulder=rig.armBones.rightUpperArm.getWorldPosition(new THREE.Vector3());
    const elbow=rig.armBones.rightForearm.getWorldPosition(new THREE.Vector3());
    const wrist=rig.armBones.rightHand.getWorldPosition(new THREE.Vector3());
    const bodyInverse=model.getWorldQuaternion(new THREE.Quaternion()).invert();
    const upper=elbow.clone().sub(shoulder).applyQuaternion(bodyInverse);
    const lower=wrist.clone().sub(elbow).applyQuaternion(bodyInverse);
    assert.ok(upper.y < -rig.armLength*.15,`${name}/${frame}: crossbow trigger elbow must stay below the shoulder at fire`);
    assert.ok(lower.y > rig.armLength*.2,`${name}/${frame}: crossbow forearm must rise naturally to the trigger`);
    const bodyElbow=elbow.clone().sub(rig.bodyCenter).applyQuaternion(bodyInverse);
    assert.ok(bodyElbow.x < 0,`${name}/${frame}: crossbow trigger elbow must stay on the right side, not invert across the chest`);
   }
   if(kind==='bow' && rig.nockedArrow?.visible){
    const draw=rig.armBones.rightHand.localToWorld(new THREE.Vector3(-.026,.056,-.0071)
      .multiplyScalar(Number(rig.armBones.rightHand.userData.militaryGripScale??1)));
    const nock=rig.nockedArrow.localToWorld(new THREE.Vector3());
    assert.ok(nock.distanceTo(draw)<.001,'arrow nock stays at the drawing fingers');
    const local=rig.rangedMount!.worldToLocal(nock.clone());
    const direction=new THREE.Vector3(0,0,1).applyQuaternion(rig.nockedArrow.quaternion);
    const rest=local.addScaledVector(direction,-local.z/direction.z);
    assert.ok(rest.y>.0625 && rest.x>.02,'arrow passes above and beside the bow grip');
    if(frame>=72){
     const shoulder=rig.armBones.leftUpperArm.getWorldPosition(new THREE.Vector3());
     const elbow=rig.armBones.leftForearm.getWorldPosition(new THREE.Vector3());
     const wrist=rig.armBones.leftHand.getWorldPosition(new THREE.Vector3());
     const extension=shoulder.distanceTo(wrist)/(shoulder.distanceTo(elbow)+elbow.distanceTo(wrist));
     assert.ok(Math.abs(extension-1)<1e-6,`${name}: aiming bow arm must be completely straight (${extension})`);
     const head=model.getObjectByName('Head')!.getWorldPosition(new THREE.Vector3());
     assert.ok(draw.x<head.x-.025 && draw.z>head.z,'full draw anchors on the right side in front of the head');
     assert.ok(draw.z-head.z<rig.armLength*.15,'drawing hand must come back to the cheek');
     assert.ok(Math.abs(wrist.x-shoulder.x)<.002,'straight bow arm must aim forward from the shoulder, not across the chest');
    }
   }
   const hand=kind==='bow'?rig.armBones.leftHand:rig.armBones.rightHand;
   const mount=kind==='bow'?rig.rangedMount!:equipment;
   const center=mount.localToWorld(new THREE.Vector3(...mount.userData.workerToolGripLocal));
   const palm=hand.localToWorld(kind==='bow'?bowPalmLocal(hand,new THREE.Vector3()):new THREE.Vector3(-.01,.044,-.0071).multiplyScalar(Number(hand.userData.militaryGripScale??1)));
   if(kind!=='crossbow'||frame<=14||frame>=72)primaryError=Math.max(primaryError,center.distanceTo(palm));
   if(mount.userData.workerToolSupportGripLocal){
    const left=rig.armBones.leftHand;
    const support=mount.localToWorld(new THREE.Vector3(...mount.userData.workerToolSupportGripLocal));
    const anchor=left.localToWorld(new THREE.Vector3(kind==='crossbow'?.014:.005,.0383,-.0071));
    supportError=Math.max(supportError,support.distanceTo(anchor));
   }
   const wrist=hand.getWorldPosition(new THREE.Vector3());
   const elbow=(kind==='bow'?rig.armBones.leftForearm:rig.armBones.rightForearm).getWorldPosition(new THREE.Vector3());
   const fingerAxis=new THREE.Vector3(0,1,0).applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion()));
   const angle=THREE.MathUtils.radToDeg(fingerAxis.angleTo(wrist.sub(elbow)));
   if(angle>maxWrist){maxWrist=angle;worstFrame=frame;}
   if(kind==='bow'||mount.userData.workerToolSupportGripLocal){
    const h=kind==='bow'?rig.armBones.rightHand:rig.armBones.leftHand;
    const e=kind==='bow'?rig.armBones.rightForearm:rig.armBones.leftForearm;
    const direction=h.getWorldPosition(new THREE.Vector3()).sub(e.getWorldPosition(new THREE.Vector3()));
    const angle=THREE.MathUtils.radToDeg(new THREE.Vector3(0,1,0).applyQuaternion(h.getWorldQuaternion(new THREE.Quaternion())).angleTo(direction));
    if(angle>maxOther){maxOther=angle;otherFrame=frame;}
   }
   for(const [i,h] of [rig.armBones.rightHand,rig.armBones.leftHand].entries()){
    const rotation=h.getWorldQuaternion(new THREE.Quaternion());
    if(previousHands[i]){const step=THREE.MathUtils.radToDeg(rotation.angleTo(previousHands[i]!));if(step>maxStep){maxStep=step;stepFrame=frame;}}
    previousHands[i]=rotation;
   }
   points.push(center);
   restoreCombatWeaponPose(rig);
   rig.ownedBones.forEach((b,i)=>assert.deepEqual(b.quaternion.toArray(),base[i]!.toArray(),'pose restores every owned joint'));
  }
  if(kind==='spear'||kind==='pike-kit')assert.ok(points[100]!.z-points[84]!.z>.2,'both grips must advance in the thrust');
  assert.ok(primaryError<.002,`${name}/${kind}: primary hand lost the handle`);
  assert.ok(supportError<.002,`${name}/${kind}: supporting hand cannot reach the handle`);
  assert.ok(maxWrist<30,`${name}/${kind}: wrist folded ${maxWrist} degrees at ${worstFrame}`);
  assert.ok(maxOther<30,`${name}/${kind}: supporting/drawing wrist folded ${maxOther} degrees at ${otherFrame}`);
  assert.ok(maxStep<22,`${name}/${kind}: elbow/grip solution jumped ${maxStep} degrees at phase ${stepFrame/100}`);
  if(kind==='bow')assert.ok(maxStep<8,`${name}: bow draw must remain smooth through loading and full extension`);
  console.log(`${name}/${kind}: primary=${primaryError.toFixed(4)}m support=${supportError.toFixed(4)}m wrist=${maxWrist.toFixed(1)}deg @ ${worstFrame}, other=${maxOther.toFixed(1)} @ ${otherFrame}, step=${maxStep.toFixed(1)} @ ${stepFrame}`);
 }
}
if(process.argv.includes('--benchmark')){
 const samples:number[]=[];
 for(let frame=0;frame<300;frame++){
  const start=performance.now();
  for(const {rig,kind,duration} of benchmarkRigs){
   restoreCombatWeaponPose(rig);
   applyCombatWeaponPose(rig,{tool:kind,targetDistance:8,attackCooldown:(1-(frame%100)/100)*duration,dtSeconds:1/60,logicalMode:'fight'});
  }
  if(frame>=60)samples.push(performance.now()-start);
 }
 samples.sort((a,b)=>a-b);
 console.log(`27 mixed attack rigs: median ${samples[Math.floor(samples.length*.5)]!.toFixed(2)}ms, p95 ${samples[Math.floor(samples.length*.95)]!.toFixed(2)}ms (CPU overlay only).`);
}
