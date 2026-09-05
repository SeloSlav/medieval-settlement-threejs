import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { installMilitaryHandGrip } from '../src/settlement/militaryHandGrip.ts';
import { bindCombatWeaponRig, applyMilitaryCarryPose, resetCombatWeaponRig } from '../src/settlement/combatWeaponAnimation.ts';
import { attachMilitaryEquipment, createMilitaryEquipmentSources } from '../src/settlement/militaryEquipment.ts';
Object.assign(globalThis, { self: globalThis, createImageBitmap: async () => ({ width: 1, height: 1, close() {} }) });
Object.defineProperty(globalThis, 'ProgressEvent', { value: class { constructor(public type: string) {} } });
for (const name of ['worker-male-common-01-v002', 'ottoman-raider-common-01-v001']) {
 const bytes = readFileSync(`public/assets/models/villagers/${name}.glb`);
 const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
 const model = gltf.scene; installMilitaryHandGrip(model);
 const rig = bindCombatWeaponRig(model, 'sidearm-shield', attachMilitaryEquipment(model, createMilitaryEquipmentSources()['sidearm-shield']))!;
 const {leftUpperArm:u,leftForearm:f,leftHand:h}=rig.armBones;
 const rounded=(v:THREE.Vector3)=>v.toArray().map(n=>+n.toFixed(3));
 function inspect(label:string) {
  const upper=f.getWorldPosition(new THREE.Vector3()).sub(u.getWorldPosition(new THREE.Vector3())).normalize();
  const lower=h.getWorldPosition(new THREE.Vector3()).sub(f.getWorldPosition(new THREE.Vector3())).normalize();
  const bend=lower.clone().addScaledVector(upper,-lower.dot(upper)).normalize().applyQuaternion(u.getWorldQuaternion(new THREE.Quaternion()).invert());
  console.log(name,label,'flex',+(upper.angleTo(lower)*180/Math.PI).toFixed(2),'bend',rounded(bend),'forearm Euler',rounded(new THREE.Vector3().setFromEuler(new THREE.Euler().setFromQuaternion(f.quaternion))),'wrist Euler',rounded(new THREE.Vector3().setFromEuler(new THREE.Euler().setFromQuaternion(h.quaternion))));
 }
 inspect('bind');
 console.log('bind joints',[u,f,h].map(b=>({name:b.name,position:rounded(b.getWorldPosition(new THREE.Vector3()))})));
 if(name.startsWith('worker'))model.traverse(o=>{if(!(o instanceof THREE.SkinnedMesh))return;
  const seen=new Set<string>(),p=o.geometry.getAttribute('position'),j=o.geometry.getAttribute('skinIndex'),w=o.geometry.getAttribute('skinWeight');
  for(let i=p.count-126;i<p.count;i++){if(p.getX(i)<0)continue;const key=[p.getX(i),p.getY(i),p.getZ(i)].map(n=>n.toFixed(4)).join(',');if(seen.has(key))continue;seen.add(key);
   console.log('rim',key,[0,1,2,3].filter(s=>w.getComponent(i,s)>.01).map(s=>[o.skeleton.bones[j.getComponent(i,s)]!.name,+w.getComponent(i,s).toFixed(2)]));}
 });
 console.log('bones', [u,f,h,...rig.twistBones.left].map(b=>({name:b.name,parent:b.parent!.name,pos:rounded(b.position),axisX:rounded(new THREE.Vector3(1,0,0).applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion())))})));
 const mixer=new THREE.AnimationMixer(model);
 console.log('clips',gltf.animations.map(c=>c.name));
 for(const clip of gltf.animations.filter(c=>/idle|walk|attack|fight|swing/i.test(c.name))) {
  mixer.stopAllAction();mixer.clipAction(clip).play();mixer.setTime(clip.duration*.4);inspect(clip.name);
 }
 mixer.stopAllAction();resetCombatWeaponRig(rig);applyMilitaryCarryPose(rig,'sidearm-shield','walk');inspect('shield carry');
}
