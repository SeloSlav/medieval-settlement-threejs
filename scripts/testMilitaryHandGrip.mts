import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { installMilitaryHandGrip, MILITARY_GRIP_BONES } from '../src/settlement/militaryHandGrip.ts';
import { applyMilitaryCarryPose, bindCombatWeaponRig, restoreCombatWeaponPose } from '../src/settlement/combatWeaponAnimation.ts';
import { attachMilitaryEquipment, createMilitaryEquipmentSources } from '../src/settlement/militaryEquipment.ts';

Object.assign(globalThis, {self:globalThis,createImageBitmap:async()=>({width:1,height:1,close(){}})});
Object.defineProperty(globalThis,'ProgressEvent',{value:class{constructor(public type:string){}}});
const sources = createMilitaryEquipmentSources();
for (const name of ['worker-male-common-01-v002','worker-female-common-01-v001','ottoman-raider-common-01-v001']) {
  const bytes = readFileSync(`public/assets/models/villagers/${name}.glb`);
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const original = clone(gltf.scene) as THREE.Group;
  // Installation owns the loaded source attributes. Keep the reference independent.
  original.traverse(o=>{if(o instanceof THREE.SkinnedMesh)o.geometry=o.geometry.clone();});
  installMilitaryHandGrip(gltf.scene);
  const count = (gltf.scene.getObjectByName('R_Hand') as THREE.Bone).children.length;
  installMilitaryHandGrip(gltf.scene);
  assert.equal((gltf.scene.getObjectByName('R_Hand') as THREE.Bone).children.length,count,'installation is idempotent');
  const originalMixer = new THREE.AnimationMixer(original);
  const modifiedMixer = new THREE.AnimationMixer(gltf.scene);
  const walk = gltf.animations.find(c=>c.name.toLowerCase()==='walk') ?? gltf.animations.find(c=>/walk/i.test(c.name))!;
  originalMixer.clipAction(walk).play(); modifiedMixer.clipAction(walk).play();
  let maxNeutralError = 0;
  for (const time of [0,.17,.48,.83]) {
    originalMixer.setTime(time); modifiedMixer.setTime(time);
    original.updateMatrixWorld(true);gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(o=>{
      if (!(o instanceof THREE.SkinnedMesh)) return;
      const reference = original.getObjectByName(o.name) as THREE.SkinnedMesh;
      const position=o.geometry.getAttribute('position');
      for(let i=0;i<position.count;i++) {
        const p=new THREE.Vector3().fromBufferAttribute(position,i);
        const a=o.applyBoneTransform(i,p.clone());
        const b=reference.applyBoneTransform(i,p.clone());
        maxNeutralError=Math.max(maxNeutralError,a.distanceTo(b));
      }
    });
  }
  assert.ok(maxNeutralError<1e-6,`${name}: unarmed animation changed by ${maxNeutralError}`);
  modifiedMixer.stopAllAction();

  for(const kind of ['spear','pike-kit','halberd','sidearm','sword-shield','crossbow'] as const) {
    const model=clone(gltf.scene) as THREE.Group;
    const equipment=attachMilitaryEquipment(model,sources[kind]);
    const rig=bindCombatWeaponRig(model,kind,equipment)!;
    const mixer=new THREE.AnimationMixer(model);mixer.clipAction(walk).play();
    for(let frame=0;frame<24;frame++) {
      restoreCombatWeaponPose(rig);mixer.setTime(frame/24);
      const before=rig.ownedBones.map(b=>b.quaternion.clone());
      applyMilitaryCarryPose(rig,kind,frame%2?'walk':'run');
      const shoulder=rig.armBones.rightUpperArm.getWorldPosition(new THREE.Vector3());
      const elbow=rig.armBones.rightForearm.getWorldPosition(new THREE.Vector3());
      const wrist=rig.armBones.rightHand.getWorldPosition(new THREE.Vector3());
      const armLength=shoulder.distanceTo(elbow)+elbow.distanceTo(wrist);
      assert.ok(elbow.y<shoulder.y-armLength*.32,`${name}/${kind}: elbow flared above its relaxed carrying range`);
      const forearm=wrist.clone().sub(elbow).normalize();
      const fingers=new THREE.Vector3(0,1,0).applyQuaternion(rig.armBones.rightHand.getWorldQuaternion(new THREE.Quaternion()));
      assert.ok(forearm.angleTo(fingers)<Math.PI*.27,`${name}/${kind}: wrist folded ${THREE.MathUtils.radToDeg(forearm.angleTo(fingers))} degrees`);
      if(kind==='spear'||kind==='pike-kit'||kind==='halberd') {
        const shaft=equipment.localToWorld(new THREE.Vector3());
        assert.ok(shaft.z>Math.max(shoulder.z,elbow.z)+armLength*.25,`${name}/${kind}: shaft intersects upper arm`);
      }
      assert.ok(rig.gripBones.every(b=>Math.abs(b.rotation.z)>1),'fingers close around the handle');
      restoreCombatWeaponPose(rig);
      rig.ownedBones.forEach((b,i)=>assert.deepEqual(b.quaternion.toArray(),before[i]!.toArray(),'every grip joint releases for the next animation'));
      assert.ok(MILITARY_GRIP_BONES.every(n=>(model.getObjectByName(n) as THREE.Bone).quaternion.angleTo(new THREE.Quaternion())<1e-7));
    }
  }
  console.log(`${name}: neutral skin error ${maxNeutralError.toExponential(2)}; elbow, wrist, shaft clearance and grip lifecycle passed.`);
}
