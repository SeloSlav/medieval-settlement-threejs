import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {installMilitaryHandGrip} from '../src/settlement/militaryHandGrip.ts';
import {createMilitaryEquipmentSources,attachMilitaryEquipment} from '../src/settlement/militaryEquipment.ts';
import {bindCombatWeaponRig,applyCombatWeaponPose,resetCombatWeaponRig,resolveCombatWeaponPresentation} from '../src/settlement/combatWeaponAnimation.ts';
Object.assign(globalThis,{self:globalThis,createImageBitmap:async()=>({width:1,height:1,close(){}})});
const sources=createMilitaryEquipmentSources(),material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),ray=new THREE.Raycaster();
for(const name of ['worker-male-common-01-v002','ottoman-raider-common-01-v001']){
 const bytes=fs.readFileSync(`public/assets/models/villagers/${name}.glb`),gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 installMilitaryHandGrip(gltf.scene);const model=gltf.scene;model.scale.setScalar(1.72/new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y);
 const rig=bindCombatWeaponRig(model,'crossbow',attachMilitaryEquipment(model,sources.crossbow))!;
 let stock!:THREE.Mesh;rig.rangedMount!.traverse(o=>{if(o instanceof THREE.Mesh&&!Array.isArray(o.material)&&o.material.name==='Dark walnut stock')stock=o;});assert.ok(stock);
 const collider=new THREE.Mesh(stock.geometry,material);collider.matrixAutoUpdate=false;
 const parts:{skin:THREE.SkinnedMesh,faces:number[][]}[]=[];
 model.traverse(o=>{if(o instanceof THREE.SkinnedMesh){const ids=o.geometry.getAttribute('skinIndex'),w=o.geometry.getAttribute('skinWeight'),idx=o.geometry.index!,set=new Set<number>();
  for(let i=0;i<ids.count;i++){let weight=0;for(let s=0;s<4;s++){const b=o.skeleton.bones[ids.getComponent(i,s)]!;if(b===rig.armBones.rightHand||rig.gripBones.includes(b))weight+=w.getComponent(i,s);}if(weight>.5)set.add(i);}
  const faces=Array.from(set,v=>[v,v,v]);for(let i=0;i<idx.count;i+=3){const f=[idx.getX(i),idx.getX(i+1),idx.getX(i+2)];if(f.every(v=>set.has(v)))faces.push(f);}parts.push({skin:o,faces});
 }});
 let worst=0,worstPhase=0,samples=0;
 for(let frame=0;frame<=100;frame++){
  const phase=frame/100;resetCombatWeaponRig(rig);applyCombatWeaponPose(rig,{tool:'crossbow',targetDistance:8,attackCooldown:(1-phase)*resolveCombatWeaponPresentation('crossbow',8)!.attackSeconds,dtSeconds:0,logicalMode:'fight'});model.updateMatrixWorld(true);collider.matrixWorld.copy(stock.matrixWorld);
  const axis=new THREE.Vector3(1,0,0).transformDirection(collider.matrixWorld);let depth=0,where:unknown;
  if(process.argv.includes('--diagnose')&&[0,20,40].includes(frame)){const h=rig.armBones.rightHand;console.log('palm',phase,stock.worldToLocal(h.localToWorld(new THREE.Vector3(-.01,.044,-.0071).multiplyScalar(h.userData.militaryGripScale))).toArray());}
  for(const {skin,faces}of parts)for(const f of faces){const p=f.map(v=>skin.getVertexPosition(v,new THREE.Vector3()).applyMatrix4(skin.matrixWorld)).reduce((a,b)=>a.add(b)).divideScalar(3);samples++;
   ray.set(p,axis);const hits=ray.intersectObject(collider,false).filter((h,i,list)=>i===0||h.distance-list[i-1]!.distance>1e-7);if(hits.length%2){ray.set(p,axis.clone().negate());const back=ray.intersectObject(collider,false)[0];const distance=Math.min(hits[0]!.distance,back?.distance??Infinity);if(distance>depth)where=stock.worldToLocal(p.clone()).toArray();depth=Math.max(depth,distance);}
  }
  if(depth>worst){worst=depth;worstPhase=phase;}
  if(process.argv.includes('--diagnose')&&frame%10===0)console.log(name,phase,(depth*1000).toFixed(2),where);
 }
 console.log(`${name}: maximum hand/stock penetration ${(worst*1000).toFixed(2)} mm at ${worstPhase}; ${samples} surface samples`);
 if(!process.argv.includes('--diagnose'))assert.ok(worst<.001,`${name}: right hand crosses the crossbow stock`);
}
