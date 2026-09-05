import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { installMilitaryHandGrip } from '../src/settlement/militaryHandGrip.ts';
import { applyCombatWeaponPose, bindCombatWeaponRig, resetCombatWeaponRig, resolveCombatWeaponPresentation } from '../src/settlement/combatWeaponAnimation.ts';
import { attachMilitaryEquipment, createMilitaryEquipmentSources, setMilitaryEquipmentCombatStance } from '../src/settlement/militaryEquipment.ts';
Object.assign(globalThis,{self:globalThis,createImageBitmap:async()=>({width:1,height:1,close(){}})});
Object.defineProperty(globalThis,'ProgressEvent',{value:class{constructor(public type:string){}}});
const sources=createMilitaryEquipmentSources(), ray=new THREE.Ray(), hit=new THREE.Vector3();
const pos=(b:THREE.Object3D)=>b.getWorldPosition(new THREE.Vector3());
for(const name of ['worker-male-common-01-v002','ottoman-raider-common-01-v001']) {
 const bytes=readFileSync(`public/assets/models/villagers/${name}.glb`);
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 installMilitaryHandGrip(gltf.scene);
 const bounds=new THREE.Box3().setFromObject(gltf.scene);
 for(const kind of ['spear','spear-shield','pike-kit','halberd','sidearm','sidearm-shield','sword-shield','bow','crossbow'] as const) {
  if(process.argv[2]&&!kind.includes(process.argv[2]))continue;
  const model=clone(gltf.scene) as THREE.Group;model.scale.setScalar(1.72/bounds.getSize(new THREE.Vector3()).y);model.updateMatrixWorld(true);
  const equipment=attachMilitaryEquipment(model,sources[kind]),rig=bindCombatWeaponRig(model,kind,equipment)!;
  const mount=(equipment.userData.workerToolMounts as THREE.Group[]).find(m=>m.userData.workerToolCombatRole==='melee-held')??equipment;
  const presentation=resolveCombatWeaponPresentation(kind,1.5)!;
  const inverse=mount.matrixWorld.clone().invert(),localBounds=new THREE.Box3();
  mount.traverse(o=>{if(o instanceof THREE.Mesh){const p=o.geometry.getAttribute('position');for(let i=0;i<p.count;i++)localBounds.expandByPoint(new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(o.matrixWorld).applyMatrix4(inverse));}});
  const meshes:THREE.SkinnedMesh[]=[];model.traverse(o=>{if(o instanceof THREE.SkinnedMesh)meshes.push(o);});
  const problems:Record<string,{frames:number[],example:any}>={};
  for(let f=0;f<=100;f+=2) {
   resetCombatWeaponRig(rig);setMilitaryEquipmentCombatStance(equipment,'melee');
   applyCombatWeaponPose(rig,{tool:kind,targetDistance:1.5,attackCooldown:(1-f/100)*presentation.attackSeconds,dtSeconds:0,logicalMode:'fight'});
   model.updateMatrixWorld(true);
   const anchors=[mount.localToWorld(new THREE.Vector3(...mount.userData.workerToolGripLocal))];
   if(mount.userData.workerToolSupportGripLocal)anchors.push(mount.localToWorld(new THREE.Vector3(...mount.userData.workerToolSupportGripLocal)));
   const rays:{label:string,a:THREE.Vector3,b:THREE.Vector3,limb?:boolean}[]=[];
   for(const offset of [[0,0],[.012,0],[-.012,0],[0,.012],[0,-.012]])rays.push({label:'weapon/body',a:mount.localToWorld(new THREE.Vector3(offset[0],localBounds.min.y,offset[1])),b:mount.localToWorld(new THREE.Vector3(offset[0],localBounds.max.y,offset[1]))});
   for(const left of [false,true]) {
    const arm=rig.armBones;
    rays.push({label:`${left?'left':'right'} forearm/torso`,a:pos(left?arm.leftForearm:arm.rightForearm),b:pos(left?arm.leftHand:arm.rightHand),limb:true});
   }
   for(const mesh of meshes) {
    const attribute=mesh.geometry.getAttribute('position'),weights=mesh.geometry.getAttribute('skinWeight'),skin=mesh.geometry.getAttribute('skinIndex');
    const vertices=Array.from({length:attribute.count},(_,i)=>mesh.localToWorld(mesh.applyBoneTransform(i,new THREE.Vector3().fromBufferAttribute(attribute,i))));
    const tags=vertices.map((_,i)=>{let weight=0,bone=0;for(let j=0;j<4;j++)if(weights.getComponent(i,j)>weight){weight=weights.getComponent(i,j);bone=skin.getComponent(i,j);}return mesh.skeleton.bones[bone]!.name;});
    const indices=mesh.geometry.index;
    for(const segment of rays) {
     ray.origin.copy(segment.a);ray.direction.copy(segment.b).sub(segment.a);const length=ray.direction.length();ray.direction.normalize();
     for(let i=0;i<(indices?.count??vertices.length);i+=3) {
      const a=indices?indices.getX(i):i,b=indices?indices.getX(i+1):i+1,c=indices?indices.getX(i+2):i+2;
      if(segment.limb&&![tags[a],tags[b],tags[c]].every(t=>/Spine|Waist|Head|Hip|Pelvis/.test(t!)))continue;
      if(!ray.intersectTriangle(vertices[a]!,vertices[b]!,vertices[c]!,false,hit)||hit.distanceTo(segment.a)>length)continue;
      if(!segment.limb&&anchors.some(p=>p.distanceTo(hit)<.085))continue;
      const label=`${segment.label}:${tags[a]}`;
      const entry=problems[label]??={frames:[],example:{point:hit.toArray().map(n=>+n.toFixed(3)),phase:f/100,handDistance:Math.min(...anchors.map(p=>p.distanceTo(hit)))}};
      if(!entry.frames.includes(f/100))entry.frames.push(f/100);
      break;
     }
    }
   }
   if(rig.shieldMount) {
    const shield=rig.shieldMount;
    const a=mount.localToWorld(new THREE.Vector3(0,localBounds.min.y,0)),b=mount.localToWorld(new THREE.Vector3(0,localBounds.max.y,0));
    ray.origin.copy(a);ray.direction.copy(b).sub(a);const length=ray.direction.length();ray.direction.normalize();
    const raycaster=new THREE.Raycaster(ray.origin,ray.direction,0,length);
    const intersections=raycaster.intersectObject(shield,true);
    if(intersections.length){const entry=problems['weapon/shield']??={frames:[],example:intersections[0]!.point.toArray()};entry.frames.push(f/100);}
   }
  }
  console.log(name,kind,JSON.stringify(problems));
 }
}
