import fs from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {installMilitaryHandGrip} from '../src/settlement/militaryHandGrip.ts';
import {createMilitaryEquipmentSources,attachMilitaryEquipment} from '../src/settlement/militaryEquipment.ts';
import {bindCombatWeaponRig,applyCombatWeaponPose,resolveCombatWeaponPresentation} from '../src/settlement/combatWeaponAnimation.ts';
Object.assign(globalThis,{self:globalThis,createImageBitmap:async()=>({width:1,height:1,close(){}})});
const source=createMilitaryEquipmentSources().crossbow;
for(const name of ['worker-male-common-01-v002','ottoman-raider-common-01-v001']){
 if(process.argv.includes('--raider')&&name.startsWith('worker-'))continue;
 const bytes=fs.readFileSync(`public/assets/models/villagers/${name}.glb`),gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 installMilitaryHandGrip(gltf.scene);const model=gltf.scene;model.scale.setScalar(1.72/new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y);
 const rig=bindCombatWeaponRig(model,'crossbow',attachMilitaryEquipment(model,source))!;
 applyCombatWeaponPose(rig,{tool:'crossbow',targetDistance:8,attackCooldown:.05*resolveCombatWeaponPresentation('crossbow',8)!.attackSeconds,dtSeconds:0,logicalMode:'fight'});model.updateMatrixWorld(true);
 let stock!:THREE.Mesh;rig.rangedMount!.traverse(o=>{if(o instanceof THREE.Mesh&&!Array.isArray(o.material)&&o.material.name==='Dark walnut stock')stock=o;});
 const collider=new THREE.Mesh(stock.geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));collider.matrixAutoUpdate=false;collider.matrixWorld.copy(stock.matrixWorld);
 const axis=new THREE.Vector3(1,0,0).transformDirection(collider.matrixWorld),ray=new THREE.Raycaster();
 console.log(name,'handSize',rig.armBones.rightHand.userData.militaryGripScale);
 for(let finger=0;finger<4;finger++){
  const filter=process.argv.find(a=>a.startsWith('--finger='))?.slice(9);if(filter!==undefined&&finger!==Number(filter))continue;
  const parts:{skin:THREE.SkinnedMesh,faces:number[][]}[]=[];
  model.traverse(o=>{if(o instanceof THREE.SkinnedMesh){const ids=o.geometry.getAttribute('skinIndex'),w=o.geometry.getAttribute('skinWeight'),idx=o.geometry.index!,set=new Set<number>();
   for(let i=0;i<ids.count;i++)for(let s=0;s<4;s++)if(rig.gripBones.slice(finger*2+(process.argv.includes('--tips')?1:0),finger*2+2).includes(o.skeleton.bones[ids.getComponent(i,s)]!)&&w.getComponent(i,s)>.35)set.add(i);
   const faces=Array.from(set,v=>[v,v,v]);for(let i=0;i<idx.count;i+=3){const f=[idx.getX(i),idx.getX(i+1),idx.getX(i+2)];if(f.every(v=>set.has(v))){faces.push(f,[f[0]!,f[1]!,f[1]!],[f[1]!,f[2]!,f[2]!],[f[2]!,f[0]!,f[0]!]);}}parts.push({skin:o,faces});
  }});
  const evaluate=()=>{model.updateMatrixWorld(true);let overlap=0,gap=Infinity;
   for(const {skin,faces}of parts)for(const f of faces){const p=f.map(v=>skin.getVertexPosition(v,new THREE.Vector3()).applyMatrix4(skin.matrixWorld)).reduce((a,b)=>a.add(b)).divideScalar(3);
    ray.set(p,axis);const hits=ray.intersectObject(collider,false).filter((h,i,list)=>i===0||h.distance-list[i-1]!.distance>1e-7);ray.set(p,axis.clone().negate());const back=ray.intersectObject(collider,false)[0];
    const distance=Math.min(hits[0]?.distance??Infinity,back?.distance??Infinity);gap=Math.min(gap,distance);if(hits.length%2)overlap=Math.max(overlap,distance);
   }return{overlap,gap};};
  console.log('before',finger,evaluate());
  let best={score:Infinity,spread:0,roll:0,a:0,b:0,overlap:Infinity,gap:Infinity};
  for(const spread of process.argv.includes('--spread')?[-.6,-.3,0,.3,.6]:[0])for(let roll=-1.2;roll<=1.5;roll+=.3)for(let a=0;a<=1.8;a+=.15)for(let b=0;b<=2.1;b+=.15){
   const curlAxis=new THREE.Vector3(0,Math.sin(roll),Math.cos(roll));rig.gripBones[finger*2]!.quaternion.setFromAxisAngle(curlAxis,a).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),spread));rig.gripBones[finger*2+1]!.quaternion.setFromAxisAngle(curlAxis,b);
   const r=evaluate(),score=1000*r.overlap**2+Math.max(0,r.gap-.001)**2+.00000001*(spread*spread+roll*roll+(a-.5)**2+(b-1.2)**2);if(score<best.score)best={score,spread,roll,a,b,...r};
  }
  console.log('fit',finger,best);
  const curlAxis=new THREE.Vector3(0,Math.sin(best.roll),Math.cos(best.roll));rig.gripBones[finger*2]!.quaternion.setFromAxisAngle(curlAxis,best.a).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),best.spread));rig.gripBones[finger*2+1]!.quaternion.setFromAxisAngle(curlAxis,best.b);
 }
}
