import fs from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {installMilitaryHandGrip} from '../src/settlement/militaryHandGrip.ts';
import {createMilitaryEquipmentSources,attachMilitaryEquipment} from '../src/settlement/militaryEquipment.ts';
import {bindCombatWeaponRig,applyCombatWeaponPose,applyMilitaryCarryPose,resetCombatWeaponRig,resolveCombatWeaponPresentation} from '../src/settlement/combatWeaponAnimation.ts';
Object.assign(globalThis,{self:globalThis,createImageBitmap:async()=>({width:1,height:1,close(){}})});
const bytes=fs.readFileSync('public/assets/models/villagers/worker-male-common-01-v002.glb');
const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
installMilitaryHandGrip(gltf.scene);const model=gltf.scene;
model.scale.setScalar(1.72/new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y);
const rig=bindCombatWeaponRig(model,'bow',attachMilitaryEquipment(model,createMilitaryEquipmentSources().bow))!;
applyCombatWeaponPose(rig,{tool:'bow',targetDistance:8,attackCooldown:.05*resolveCombatWeaponPresentation('bow',8)!.attackSeconds,dtSeconds:0,logicalMode:'fight'});model.updateMatrixWorld(true);
let handle!:THREE.Mesh;rig.rangedMount!.traverse(o=>{if(o instanceof THREE.Mesh&&!Array.isArray(o.material)&&o.material.name==='Oiled brown leather')handle=o;});
const collider=new THREE.Mesh(handle.geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));collider.matrixAutoUpdate=false;collider.matrixWorld.copy(handle.matrixWorld);
const axis=new THREE.Vector3(1,0,0).transformDirection(collider.matrixWorld),ray=new THREE.Raycaster(),normalMatrix=new THREE.Matrix3().getNormalMatrix(collider.matrixWorld);
for(let finger=0;finger<4;finger++){
 const parts:{skin:THREE.SkinnedMesh,faces:number[][]}[]=[];
 model.traverse(o=>{if(o instanceof THREE.SkinnedMesh){const ids=o.geometry.getAttribute('skinIndex'),w=o.geometry.getAttribute('skinWeight'),index=o.geometry.index!,vertices=new Set<number>();
  for(let i=0;i<ids.count;i++)for(let s=0;s<4;s++)if(rig.leftGripBones.slice(finger*2,finger*2+2).includes(o.skeleton.bones[ids.getComponent(i,s)]!)&&w.getComponent(i,s)>.35)vertices.add(i);
  const faces=Array.from(vertices,v=>[v,v,v]);for(let i=0;i<index.count;i+=3){const f=[index.getX(i),index.getX(i+1),index.getX(i+2)];if(f.every(v=>vertices.has(v)))faces.push(f);}parts.push({skin:o,faces});
 }});
 const evaluate=()=>{const pose=rig.leftGripBones.map(b=>b.quaternion.clone());let overlap=0,gap=0;
  for(const phase of [0,.18,.4,.55,.8,-1]){
   resetCombatWeaponRig(rig);
   if(phase<0)applyMilitaryCarryPose(rig,'bow','walk');else applyCombatWeaponPose(rig,{tool:'bow',targetDistance:8,attackCooldown:(1-phase)*resolveCombatWeaponPresentation('bow',8)!.attackSeconds,dtSeconds:0,logicalMode:'fight'});
   rig.leftGripBones[finger*2]!.quaternion.copy(pose[finger*2]!);rig.leftGripBones[finger*2+1]!.quaternion.copy(pose[finger*2+1]!);
   model.updateMatrixWorld(true);collider.matrixWorld.copy(handle.matrixWorld);axis.set(1,0,0).transformDirection(collider.matrixWorld);normalMatrix.getNormalMatrix(collider.matrixWorld);let phaseGap=Infinity;
  for(const {skin,faces}of parts)for(const f of faces){const p=f.map(v=>skin.getVertexPosition(v,new THREE.Vector3()).applyMatrix4(skin.matrixWorld)).reduce((a,b)=>a.add(b)).divideScalar(3);
   for(const sign of [-1,1]){ray.set(p,axis.clone().multiplyScalar(sign));const hit=ray.intersectObject(collider,false)[0];if(hit){phaseGap=Math.min(phaseGap,hit.distance);if(hit.face!.normal.clone().applyNormalMatrix(normalMatrix).dot(ray.ray.direction)>0)overlap=Math.max(overlap,hit.distance);}}
  }gap=Math.max(gap,phaseGap);
  }return{overlap,gap};};
 let best={score:Infinity,a:0,b:0,overlap:Infinity,gap:Infinity};
 for(let a=0;a<=1.5;a+=.1)for(let b=0;b<=2.1;b+=.1){
  rig.leftGripBones[finger*2]!.quaternion.setFromAxisAngle(new THREE.Vector3(0,0,1),-a);rig.leftGripBones[finger*2+1]!.quaternion.setFromAxisAngle(new THREE.Vector3(0,0,1),-b);
  const r=evaluate(),score=100*r.overlap**2+Math.max(0,r.gap-.001)**2;if(score<best.score)best={score,a,b,...r};
 }
 console.log(finger,best);
 rig.leftGripBones[finger*2]!.quaternion.setFromAxisAngle(new THREE.Vector3(0,0,1),-best.a);rig.leftGripBones[finger*2+1]!.quaternion.setFromAxisAngle(new THREE.Vector3(0,0,1),-best.b);
}
