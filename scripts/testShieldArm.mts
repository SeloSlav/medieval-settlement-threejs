import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { installMilitaryHandGrip } from '../src/settlement/militaryHandGrip.ts';
import { applyCombatWeaponPose, applyMilitaryCarryPose, bindCombatWeaponRig, restoreCombatWeaponPose, resolveCombatWeaponPresentation } from '../src/settlement/combatWeaponAnimation.ts';
import { attachMilitaryEquipment, createMilitaryEquipmentSources } from '../src/settlement/militaryEquipment.ts';

Object.assign(globalThis, { self: globalThis, createImageBitmap: async () => ({ width: 1, height: 1, close() {} }) });
Object.defineProperty(globalThis, 'ProgressEvent', { value: class { constructor(public type: string) {} } });
const sources = createMilitaryEquipmentSources();
let poses = 0, maxSkinStretch = 0, maxSkinGrowth = 0, maxJointStep = 0;
for (const name of ['worker-male-common-01-v002', 'ottoman-raider-common-01-v001']) {
  const bytes = readFileSync(`public/assets/models/villagers/${name}.glb`);
  const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  const originalVertices = doc.meshes[0].extras?.elbowRepair?.originalVertices as number | undefined;
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  installMilitaryHandGrip(gltf.scene);
  const height = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3()).y;
  const referenceModel = clone(gltf.scene) as THREE.Group;
  const referenceRig = bindCombatWeaponRig(referenceModel, 'crossbow', attachMilitaryEquipment(referenceModel, sources.crossbow))!;
  applyMilitaryCarryPose(referenceRig, 'crossbow', 'walk');
  const referenceShoulder = referenceRig.armBones.rightUpperArm.getWorldPosition(new THREE.Vector3());
  const referenceElbow = referenceRig.armBones.rightForearm.getWorldPosition(new THREE.Vector3());
  const referenceWrist = referenceRig.armBones.rightHand.getWorldPosition(new THREE.Vector3());
  const referenceLength = referenceShoulder.distanceTo(referenceElbow) + referenceElbow.distanceTo(referenceWrist);
  const mirroredReach = referenceWrist.clone().sub(referenceShoulder).divideScalar(referenceLength);
  mirroredReach.x *= -1;
  const mirroredElbow = referenceElbow.clone().sub(referenceShoulder).divideScalar(referenceLength);
  mirroredElbow.x *= -1;
  for (const kind of ['sidearm-shield', 'spear-shield', 'sword-shield'] as const) {
    const model = clone(gltf.scene) as THREE.Group;
    model.scale.setScalar(1.72 / height); model.rotation.y = .63;
    const equipment = attachMilitaryEquipment(model, sources[kind]);
    const rig = bindCombatWeaponRig(model, kind, equipment)!;
    const shield = rig.shieldMount!;
    const mountPosition = shield.position.clone(), mountRotation = shield.quaternion.clone();
    const { leftUpperArm: upper, leftForearm: forearm, leftHand: hand } = rig.armBones;
    const leftBones = [upper, forearm, hand, ...rig.twistBones.left];
    const edges: { mesh: THREE.SkinnedMesh; a: number; b: number; length: number }[] = [];
    model.traverse(mesh => {
      if (!(mesh instanceof THREE.SkinnedMesh) || originalVertices === undefined) return;
      const p = mesh.geometry.getAttribute('position'), index = mesh.geometry.index!;
      for (let i = 0; i < index.count; i += 3) {
        const face = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
        if (!face.every(v => v >= originalVertices && p.getX(v) > 0)) continue;
        for (let j = 0; j < 3; j++) {
          const a = face[j]!, b = face[(j + 1) % 3]!;
          const length = new THREE.Vector3().fromBufferAttribute(p, a).distanceTo(new THREE.Vector3().fromBufferAttribute(p, b)) * model.scale.x;
          if (length > .015) edges.push({ mesh, a, b, length });
        }
      }
    });
    const mixer = new THREE.AnimationMixer(model);
    for (const mode of ['idle', 'walk', 'run', 'flee', 'hurt', 'attack', 'hit']) {
      const combat = mode === 'attack' || mode === 'hit';
      const cutting = mode === 'attack' && kind !== 'spear-shield';
      const clipName = mode === 'attack' ? 'slash' : mode === 'hurt' || mode === 'hit' ? 'hit_to_body_01' : mode === 'flee' ? 'flee_01' : mode;
      const clip = gltf.animations.find(c => c.name === clipName)!;
      assert.ok(clip, `${name}/${mode}: missing clip`);
      mixer.stopAllAction(); mixer.clipAction(clip).reset().play();
      let previous: THREE.Quaternion[] | undefined;
      for (let frame = 0; frame <= 60; frame++) {
        mixer.setTime(frame / 60 * clip.duration);
        const before = rig.ownedBones.map(b => [...b.position.toArray(), ...b.quaternion.toArray(), ...b.scale.toArray()]);
        if (combat) applyCombatWeaponPose(rig, { tool: kind, targetDistance: 8,
          attackCooldown: (1 - frame / 60) * resolveCombatWeaponPresentation(kind, 8)!.attackSeconds, dtSeconds: 0,
          logicalMode: mode === 'hit' ? 'hurt' : 'fight' });
        else applyMilitaryCarryPose(rig, kind, mode);
        model.updateMatrixWorld(true);
        const shoulder = upper.getWorldPosition(new THREE.Vector3()), elbow = forearm.getWorldPosition(new THREE.Vector3()), wrist = hand.getWorldPosition(new THREE.Vector3());
        const u = elbow.clone().sub(shoulder).normalize(), f = wrist.clone().sub(elbow).normalize();
        const flex = THREE.MathUtils.radToDeg(u.angleTo(f));
        assert.ok(flex > 95 && flex < 120, `${name}/${kind}/${mode}: shield elbow over-folded to ${flex} degrees`);
        const bend = f.clone().addScaledVector(u, -f.dot(u)).normalize().applyQuaternion(upper.getWorldQuaternion(new THREE.Quaternion()).invert());
        assert.ok(bend.z > .99, 'shield elbow bends through its hinge, without sideways inversion');
        const fingers = new THREE.Vector3(0, 1, 0).applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion()));
        assert.ok(f.angleTo(fingers) < .001, 'shield wrist stays straight');
        const outward = elbow.clone().sub(shoulder).applyQuaternion(model.getWorldQuaternion(new THREE.Quaternion()).invert());
        const armLength = shoulder.distanceTo(elbow) + elbow.distanceTo(wrist);
        const elbowDrop = combat ? (cutting ? .12 : .2) * armLength : .15;
        assert.ok(outward.x > 0 && outward.x < (cutting ? .30 * armLength : .09) && outward.y < -elbowDrop,
          `${name}/${kind}/${mode}: shield elbow stays below and outside the shoulder (${outward.toArray()})`);
        const reach = wrist.clone().sub(shoulder).applyQuaternion(model.getWorldQuaternion(new THREE.Quaternion()).invert()).divideScalar(armLength);
        if (cutting) {
          assert.ok(reach.x >= -.321 && reach.x <= -.099 && reach.y >= -.321 && reach.y <= -.119 && Math.abs(reach.z - .50) < .001,
            'the cutting shield moves down and outward within a compact frontal guard');
        } else {
          assert.ok(reach.distanceTo(combat ? new THREE.Vector3(-.32, -.12, .50) : mirroredReach) < .001,
            'other combat poses raise the shield; carrying keeps the approved relaxed reach');
        }
        // The asset's left forearm is longer than the right. Preserve that
        // anatomy while comparing the same crossbow reach and bend plane.
        if(!combat) {
        const direction = mirroredReach.clone().normalize(), distance = mirroredReach.length();
        const bendDirection = mirroredElbow.clone().addScaledVector(direction, -mirroredElbow.dot(direction)).normalize();
        const upperFraction = shoulder.distanceTo(elbow) / armLength, lowerFraction = elbow.distanceTo(wrist) / armLength;
        const along = (upperFraction ** 2 - lowerFraction ** 2 + distance ** 2) / (2 * distance);
        const expectedElbow = direction.multiplyScalar(along).addScaledVector(bendDirection, Math.sqrt(upperFraction ** 2 - along ** 2));
        assert.ok(outward.clone().divideScalar(armLength).distanceTo(expectedElbow) < .001, 'shield elbow uses the mirrored crossbow bend plane with original limb proportions');
        } else {
          assert.ok(Math.abs(outward.z/armLength-.50)<.001,'raised elbow and wrist share the frontal shield plane');
          const normal=new THREE.Vector3(0,0,1).transformDirection(shield.matrixWorld);
          const facing=new THREE.Vector3(0,0,1).applyQuaternion(model.getWorldQuaternion(new THREE.Quaternion()));
          assert.ok(normal.dot(facing)>.999,'raised shield faces the threat');
        }
        rig.ownedBones.forEach((b, i) => assert.deepEqual(b.position.toArray(), before[i]!.slice(0, 3), `${b.name}: carrying cannot lengthen the arm`));
        const current = leftBones.map(b => b.getWorldQuaternion(new THREE.Quaternion()).normalize());
        if (previous && frame < 60) current.forEach((q, i) => { maxJointStep = Math.max(maxJointStep, q.angleTo(previous![i]!)); });
        previous = current;
        if (frame % 10 === 0) for (const edge of edges) {
          const a = edge.mesh.getVertexPosition(edge.a, new THREE.Vector3()).applyMatrix4(edge.mesh.matrixWorld);
          const b = edge.mesh.getVertexPosition(edge.b, new THREE.Vector3()).applyMatrix4(edge.mesh.matrixWorld);
          const length = a.distanceTo(b);
          maxSkinStretch = Math.max(maxSkinStretch, length / edge.length);
          maxSkinGrowth = Math.max(maxSkinGrowth, length - edge.length);
        }
        restoreCombatWeaponPose(rig);
        rig.ownedBones.forEach((b, i) => assert.deepEqual([...b.position.toArray(), ...b.quaternion.toArray(), ...b.scale.toArray()], before[i], `${b.name}: shield pose leaked into the base clip`));
        assert.deepEqual(shield.position.toArray(), mountPosition.toArray());
        assert.deepEqual(shield.quaternion.toArray(), mountRotation.toArray());
        poses++;
      }
    }
  }
}
assert.ok(maxJointStep < .2, 'shield joints cannot flip between adjacent clip frames');
console.log(`${poses} shield poses: mirrored crossbow reach/elbow, neutral wrist, original bone positions and exact restoration passed. Maximum adjacent joint step ${THREE.MathUtils.radToDeg(maxJointStep).toFixed(2)} degrees; source skin-edge growth ${(maxSkinGrowth * 1000).toFixed(2)}mm (${maxSkinStretch.toFixed(3)}x).`);
