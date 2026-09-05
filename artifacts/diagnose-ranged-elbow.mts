import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {installMilitaryHandGrip} from '../src/settlement/militaryHandGrip.ts';
import {createMilitaryEquipmentSources,attachMilitaryEquipment} from '../src/settlement/militaryEquipment.ts';
import {bindCombatWeaponRig,applyCombatWeaponPose,resolveCombatWeaponPresentation} from '../src/settlement/combatWeaponAnimation.ts';
Object.assign(globalThis,{self:globalThis,createImageBitmap:async()=>({width:1,height:1,close(){}})});
const bytes=fs.readFileSync('public/assets/models/villagers/worker-male-common-01-v002.glb');
const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
installMilitaryHandGrip(gltf.scene);
const model=gltf.scene;model.scale.setScalar(1.72/new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y);
const sources=createMilitaryEquipmentSources(),rig=bindCombatWeaponRig(model,'bow',attachMilitaryEquipment(model,sources.bow))!;
let mesh!:THREE.SkinnedMesh;model.traverse(o=>{if(o instanceof THREE.SkinnedMesh)mesh=o;});
const bones=[rig.armBones.leftUpperArm,rig.armBones.leftForearm,rig.armBones.leftHand,...rig.twistBones.left];
const reference=new Map(bones.map(b=>[b,b.getWorldQuaternion(new THREE.Quaternion())]));
const p=mesh.geometry.getAttribute('position');
const ids=mesh.geometry.getAttribute('skinIndex'),weights=mesh.geometry.getAttribute('skinWeight');
for(const group of [['L_Upperarm','L_UpperarmTwist01','L_UpperarmTwist02'],['L_Forearm','L_ForearmTwist01','L_ForearmTwist02']]){
 const vertices:THREE.Vector3[]=[];
 for(let i=0;i<p.count;i++) {let w=0;for(let j=0;j<4;j++)if(group.includes(mesh.skeleton.bones[ids.getComponent(i,j)]!.name))w+=weights.getComponent(i,j);if(w>.8)vertices.push(new THREE.Vector3().fromBufferAttribute(p,i));}
 const center=vertices.reduce((s,p)=>s.add(p),new THREE.Vector3()).divideScalar(vertices.length),axis=new THREE.Vector3(1,0,0);
 for(let n=0;n<50;n++){const v=new THREE.Vector3();for(const p of vertices){const d=p.clone().sub(center);v.addScaledVector(d,d.dot(axis));}axis.copy(v.normalize());}
 console.log('PCA',group[0],vertices.length,center.toArray(),axis.toArray());
}
for(let x=.12;x<.41;x+=.025){let n=0,y=0,z=0;for(let i=0;i<p.count;i++)if(Math.abs(p.getX(i)-x)<.008&&p.getY(i)>.72&&p.getY(i)<.88){n++;y+=p.getY(i);z+=p.getZ(i);}console.log('Mesh section',x.toFixed(3),n,y/n,z/n);}
applyCombatWeaponPose(rig,{tool:'bow',targetDistance:8,attackCooldown:.05*resolveCombatWeaponPresentation('bow',8)!.attackSeconds,dtSeconds:0,logicalMode:'fight'});model.updateMatrixWorld(true);
for(const b of bones){
 const i=mesh.skeleton.bones.indexOf(b),bind=mesh.skeleton.boneInverses[i]!.clone().invert();
 const bp=new THREE.Vector3(),bq=new THREE.Quaternion(),bs=new THREE.Vector3();bind.decompose(bp,bq,bs);
 const skinAxis=new THREE.Vector3(1,0,0).applyQuaternion(bq.clone().invert()).applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion()));
 console.log(JSON.stringify({bone:b.name,parent:b.parent?.name,position:b.position.toArray(),bindPosition:bp.toArray(),bindQ:bq.toArray(),localQ:b.quaternion.toArray(),skinAxis:skinAxis.toArray()}));
}
