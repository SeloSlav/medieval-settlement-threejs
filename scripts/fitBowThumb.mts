import fs from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {installMilitaryHandGrip} from '../src/settlement/militaryHandGrip.ts';
import {createMilitaryEquipmentSources,attachMilitaryEquipment} from '../src/settlement/militaryEquipment.ts';
import {bindCombatWeaponRig,applyCombatWeaponPose,resolveCombatWeaponPresentation} from '../src/settlement/combatWeaponAnimation.ts';
Object.assign(globalThis,{self:globalThis,createImageBitmap:async()=>({width:1,height:1,close(){}})});
const sources=createMilitaryEquipmentSources(),material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
for(const name of ['worker-male-common-01-v002','ottoman-raider-common-01-v001']){
 const bytes=fs.readFileSync(`public/assets/models/villagers/${name}.glb`);
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 installMilitaryHandGrip(gltf.scene);const model=gltf.scene;
 model.scale.setScalar(1.72/new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y);
 const rig=bindCombatWeaponRig(model,'bow',attachMilitaryEquipment(model,sources.bow))!;
 applyCombatWeaponPose(rig,{tool:'bow',targetDistance:8,attackCooldown:.05*resolveCombatWeaponPresentation('bow',8)!.attackSeconds,dtSeconds:0,logicalMode:'fight'});
 model.updateMatrixWorld(true);
 const thumb=rig.leftGripBones[8]!,parts:{skin:THREE.SkinnedMesh,faces:number[][]}[]=[],colliders:THREE.Mesh[]=[];
 model.traverse(o=>{if(o instanceof THREE.SkinnedMesh){
  const ids=o.geometry.getAttribute('skinIndex'),w=o.geometry.getAttribute('skinWeight'),index=o.geometry.index!,vertices=new Set<number>();
  for(let i=0;i<ids.count;i++)for(let s=0;s<4;s++)if(o.skeleton.bones[ids.getComponent(i,s)]===thumb&&w.getComponent(i,s)>.05)vertices.add(i);
  const faces:number[][]=Array.from(vertices,v=>[v,v,v]);for(let i=0;i<index.count;i+=3){const f=[index.getX(i),index.getX(i+1),index.getX(i+2)];if(f.some(v=>vertices.has(v)))faces.push(f);}parts.push({skin:o,faces});
 }});
 rig.rangedMount!.traverse(o=>{if(o instanceof THREE.Mesh&& !Array.isArray(o.material)&&['Oiled brown leather','Waxed ash weapon haft'].includes(o.material.name)){
  const mesh=new THREE.Mesh(o.geometry,material);mesh.name=o.material.name;mesh.matrixAutoUpdate=false;mesh.matrixWorld.copy(o.matrixWorld);colliders.push(mesh);
 }});
 console.log(name,'colliders',colliders.length);if(colliders.length<2)throw new Error('Need both wood and leather');
 const shift=Number(process.argv.find(a=>a.startsWith('--offset='))?.slice(9)??0);
 const delta=new THREE.Vector3(0,shift,0).multiply(rig.armBones.leftHand.getWorldScale(new THREE.Vector3())).applyQuaternion(rig.armBones.leftHand.getWorldQuaternion(new THREE.Quaternion()));
 for(const c of colliders)c.matrixWorld.setPosition(new THREE.Vector3().setFromMatrixPosition(c.matrixWorld).add(delta));
 const ray=new THREE.Raycaster(),axis=new THREE.Vector3(1,0,0).transformDirection(rig.rangedMount!.matrixWorld);
 const normals=colliders.map(c=>new THREE.Matrix3().getNormalMatrix(c.matrixWorld));
 const evaluate=()=>{model.updateMatrixWorld(true);let worst=0,penalty=0,where:unknown;
  for(const {skin,faces}of parts)for(const f of faces){const a=skin.getVertexPosition(f[0]!,new THREE.Vector3()).applyMatrix4(skin.matrixWorld),b=skin.getVertexPosition(f[1]!,new THREE.Vector3()).applyMatrix4(skin.matrixWorld),c=skin.getVertexPosition(f[2]!,new THREE.Vector3()).applyMatrix4(skin.matrixWorld);
   for(const p of [a,b,c,a.clone().add(b).multiplyScalar(.5),b.clone().add(c).multiplyScalar(.5),a.clone().add(c).multiplyScalar(.5),a.clone().add(b).add(c).divideScalar(3)]){
    // The visible regression is the web/thumb protruding through the stave
    // above the wrap. The full leather/finger fit has its separate regression.
    if(rig.rangedMount!.worldToLocal(p.clone()).y<=.0625)continue;
    for(let j=0;j<colliders.length;j++){ray.set(p,axis);const hits=ray.intersectObject(colliders[j]!,false).filter((h,i,hits)=>i===0||h.distance-hits[i-1]!.distance>1e-7);if(hits.length%2){ray.set(p,axis.clone().negate());const back=ray.intersectObject(colliders[j]!,false)[0];const distance=Math.min(hits[0]!.distance,back?.distance??Infinity);if(distance>worst)where={part:colliders[j]!.name,point:rig.rangedMount!.worldToLocal(p.clone()).toArray(),face:f};worst=Math.max(worst,distance);penalty+=distance**2;}}
   }
  }return{worst,penalty,where};};
 const base=evaluate();console.log('before',base);
 if(process.argv.includes('--inspect')){for(const {skin}of parts)for(const v of (base.where as any)?.face??[]){const ids=skin.geometry.getAttribute('skinIndex'),w=skin.geometry.getAttribute('skinWeight');console.log(v,Array.from({length:4},(_,s)=>[skin.skeleton.bones[ids.getComponent(v,s)]!.name,w.getComponent(v,s)]));}continue;}
 if(process.argv.includes('--verify')){if(base.worst>.0005)throw new Error(`${name}: thumb penetrates wood/handle by ${base.worst*1000} mm`);continue;}
 let best={score:Infinity,angles:[0,0,0],worst:Infinity};
 for(let x=-1.5;x<=1.5;x+=.3)for(let y=-1.5;y<=1.5;y+=.3)for(let z=-1.5;z<=1.5;z+=.3){
  thumb.quaternion.setFromEuler(new THREE.Euler(x,y,z));const r=evaluate(),score=r.penalty*100000+(x*x+y*y+z*z)*.001;
  if(score<best.score)best={score,angles:[x,y,z],worst:r.worst};
 }
 console.log('fit',best);
}
