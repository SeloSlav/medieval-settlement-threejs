import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {installMilitaryHandGrip} from '../src/settlement/militaryHandGrip.ts';
import {createMilitaryEquipmentSources,attachMilitaryEquipment} from '../src/settlement/militaryEquipment.ts';
import {bindCombatWeaponRig,applyCombatWeaponPose,resetCombatWeaponRig,resolveCombatWeaponPresentation} from '../src/settlement/combatWeaponAnimation.ts';

Object.assign(globalThis,{self:globalThis,createImageBitmap:async()=>({width:1,height:1,close(){}})});
const source=createMilitaryEquipmentSources().crossbow;
// Check the visible regression: fingertips emerging from the stock's opposite
// wall. This is not a claim that the fixed palm/stock contact has no embedding.
// The original arm path is separately pinned by testCrossbowFingerIsolation.
for(const name of ['worker-male-common-01-v002','ottoman-raider-common-01-v001']){
 const bytes=fs.readFileSync(`public/assets/models/villagers/${name}.glb`);
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 installMilitaryHandGrip(gltf.scene);
 const model=gltf.scene;model.scale.setScalar(1.72/new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y);
 const rig=bindCombatWeaponRig(model,'crossbow',attachMilitaryEquipment(model,source))!;
 let stock!:THREE.Mesh;
 rig.rangedMount!.traverse(o=>{if(o instanceof THREE.Mesh&&!Array.isArray(o.material)&&o.material.name==='Dark walnut stock')stock=o;});
 assert.ok(stock);
 const collider=new THREE.Mesh(stock.geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));collider.matrixAutoUpdate=false;
 const parts:{skin:THREE.SkinnedMesh,faces:number[][]}[]=[];
 model.traverse(o=>{
  if(!(o instanceof THREE.SkinnedMesh))return;
  const ids=o.geometry.getAttribute('skinIndex'),weights=o.geometry.getAttribute('skinWeight'),idx=o.geometry.index!,selected=new Set<number>();
  for(let i=0;i<ids.count;i++)for(let s=0;s<4;s++)if(rig.gripBones.slice(0,8).includes(o.skeleton.bones[ids.getComponent(i,s)]!)&&weights.getComponent(i,s)>.35)selected.add(i);
  const faces=Array.from(selected,v=>[v,v,v]);
  for(let i=0;i<idx.count;i+=3){const f=[idx.getX(i),idx.getX(i+1),idx.getX(i+2)];if(f.every(v=>selected.has(v)))faces.push(f,[f[0]!,f[1]!,f[1]!],[f[1]!,f[2]!,f[2]!],[f[2]!,f[0]!,f[0]!]);}
  parts.push({skin:o,faces});
 });
 const ray=new THREE.Raycaster(),axis=new THREE.Vector3(),inverse=new THREE.Matrix4();
 let worst=0,samples=0;
 const inspect=()=>{
  model.updateMatrixWorld(true);collider.matrixWorld.copy(stock.matrixWorld);inverse.copy(stock.matrixWorld).invert();axis.set(1,0,0).transformDirection(stock.matrixWorld);
  let depth=0;
  for(const {skin,faces} of parts){
   const nodes:{p:THREE.Vector3,outside:boolean,boundary:boolean,depth:number,edges:number[]}[]=[],vertices=new Map<number,number>(),welded=new Map<string,number>();
   const node=(p:THREE.Vector3)=>{
    const key=p.toArray().map(v=>Math.round(v*100000)).join(',');if(welded.has(key))return welded.get(key)!;
    samples++;ray.near=0;ray.far=Infinity;ray.set(p,axis);
    const hits=ray.intersectObject(collider,false).filter((h,i,list)=>i===0||h.distance-list[i-1]!.distance>1e-7);
    const outside=p.clone().applyMatrix4(inverse).x<=0&&hits.length%2===0;
    nodes.push({p,outside,boundary:hits.length===0,depth:hits[0]?.distance??0,edges:[]});welded.set(key,nodes.length-1);return nodes.length-1;
   };
   const vertex=(v:number)=>{if(!vertices.has(v))vertices.set(v,node(skin.getVertexPosition(v,new THREE.Vector3()).applyMatrix4(skin.matrixWorld)));return vertices.get(v)!;};
   const connect=(a:number,b:number)=>{
    if(a===b||!nodes[a]!.outside||!nodes[b]!.outside)return;
    const delta=nodes[b]!.p.clone().sub(nodes[a]!.p),length=delta.length();
    ray.near=.000001;ray.far=Math.max(.000001,length-.000001);ray.set(nodes[a]!.p,delta.normalize());
    if(length>.000002&&ray.intersectObject(collider,false).length)return;
    nodes[a]!.edges.push(b);nodes[b]!.edges.push(a);
   };
   for(const face of faces){
    const ids=face.map(vertex);
    if(face[0]===face[1]&&face[1]===face[2])continue;
    const center=node(ids.map(i=>nodes[i]!.p).reduce((a,b)=>a.add(b),new THREE.Vector3()).divideScalar(3));
    for(let i=0;i<3;i++){connect(ids[i]!,ids[(i+1)%3]!);connect(ids[i]!,center);}
   }
   const visited=new Set<number>();
   for(let start=0;start<nodes.length;start++){
    if(visited.has(start)||!nodes[start]!.outside)continue;
    const pending=[start];let boundary=false,protrusion=0;
    while(pending.length){const i=pending.pop()!;if(visited.has(i))continue;visited.add(i);const n=nodes[i]!;boundary ||= n.boundary;protrusion=Math.max(protrusion,n.depth);pending.push(...n.edges.filter(j=>!visited.has(j)));}
    // A connected path around the upper/lower edge is a wrapped fingertip.
    // A disconnected island on the wall is a finger passing through wood.
    if(!boundary)depth=Math.max(depth,protrusion);
   }
  }
  return depth;
 };
 for(const phase of [0,.86,.90,.95,1]){
  resetCombatWeaponRig(rig);applyCombatWeaponPose(rig,{tool:'crossbow',targetDistance:8,attackCooldown:(1-phase)*resolveCombatWeaponPresentation('crossbow',8)!.attackSeconds,dtSeconds:0,logicalMode:'fight'});
  worst=Math.max(worst,inspect());
 }
 console.log(`${name}: far stock wall finger protrusion ${(worst*1000).toFixed(2)} mm; ${samples} surface samples`);
 assert.ok(worst<.001,`${name}: isolated fingers protrude through the far stock wall`);
 // Confirm the old generic sword curl reproduces the reported artifact.
 const old=[[.15,1.4],[.42,1.35],[.75,1.4],[1.03,1.35]].flat();
 for(let i=0;i<8;i++)rig.gripBones[i]!.quaternion.setFromAxisAngle(new THREE.Vector3(0,Math.SQRT1_2,Math.SQRT1_2),old[i]!);
 assert.ok(inspect()>.002,`${name}: the regression probe must detect the original sword curl's exposed fingertips`);
}
