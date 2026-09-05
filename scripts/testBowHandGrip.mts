import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { installMilitaryHandGrip } from '../src/settlement/militaryHandGrip.ts';
import { applyCombatWeaponPose, applyMilitaryCarryPose, bindCombatWeaponRig, resetCombatWeaponRig, resolveCombatWeaponPresentation } from '../src/settlement/combatWeaponAnimation.ts';
import { attachMilitaryEquipment, createMilitaryEquipmentSources } from '../src/settlement/militaryEquipment.ts';

Object.assign(globalThis, { self: globalThis, createImageBitmap: async () => ({ width: 1, height: 1, close() {} }) });
Object.defineProperty(globalThis, 'ProgressEvent', { value: class { constructor(public type: string) {} } });
const sources = createMilitaryEquipmentSources();
const ray = new THREE.Raycaster(), point = new THREE.Vector3(), normal = new THREE.Vector3();
const collisionMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
let checked = 0;

for (const [name, height] of [['worker-male-common-01-v002', 1.72], ['ottoman-raider-common-01-v001', 1.72]] as const) {
  const bytes = readFileSync(name.startsWith('worker-') && process.env.WORKER_MODEL_OVERRIDE
    ? process.env.WORKER_MODEL_OVERRIDE : `public/assets/models/villagers/${name}.glb`);
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  installMilitaryHandGrip(gltf.scene);
  const model = gltf.scene;
  model.scale.setScalar(height / new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y);
  model.updateMatrixWorld(true);
  const equipment = attachMilitaryEquipment(model, sources.bow);
  const rig = bindCombatWeaponRig(model, 'bow', equipment)!;
  const skins: { mesh: THREE.SkinnedMesh; vertices: Map<number, number>; faces: number[][] }[] = [];
  model.traverse(object => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    const joints = object.geometry.getAttribute('skinIndex'), weights = object.geometry.getAttribute('skinWeight');
    const vertices = new Map<number, number>();
    for (let i = 0; i < joints.count; i++) {
      let best = .35, finger = -1;
      for (let slot = 0; slot < 4; slot++) {
        const index = rig.leftGripBones.indexOf(object.skeleton.bones[joints.getComponent(i, slot)]!);
        if (index >= 0 && weights.getComponent(i, slot) > best) { best = weights.getComponent(i, slot); finger = Math.floor(index / 2); }
      }
      if (finger >= 0) vertices.set(i, finger);
    }
    const indices = object.geometry.index;
    const faces: number[][] = [];
    for (let i = 0; i < (indices?.count ?? joints.count); i += 3) {
      const face = [0, 1, 2].map(j => indices ? indices.getX(i + j) : i + j);
      if (face.every(v => vertices.has(v))) faces.push(face);
    }
    skins.push({ mesh: object, vertices, faces });
  });
  let handle: THREE.Mesh | undefined;
  rig.rangedMount!.traverse(object => {
    if (object instanceof THREE.Mesh && !Array.isArray(object.material) && object.material.name === 'Oiled brown leather') handle = object;
  });
  assert.ok(handle, 'test the actual rendered leather handle');
  const collider = new THREE.Mesh(handle.geometry, collisionMaterial);
  collider.matrixAutoUpdate = false;
  let worst = 0;
  for (const mode of ['attack', 'idle', 'walk', 'run', 'flee']) {
    for (const phase of mode === 'attack' ? [0, .08, .18, .4, .55, .8, 1] : [0]) {
      resetCombatWeaponRig(rig);
      if (mode === 'attack') applyCombatWeaponPose(rig, { tool: 'bow', targetDistance: 8, attackCooldown: (1 - phase) * resolveCombatWeaponPresentation('bow', 8)!.attackSeconds, dtSeconds: 0, logicalMode: 'fight' });
      else applyMilitaryCarryPose(rig, 'bow', mode);
      model.updateWorldMatrix(true, true);
      collider.matrixWorld.copy(handle.matrixWorld);
      const inverse = collider.matrixWorld.clone().invert();
      const normalMatrix = new THREE.Matrix3().getNormalMatrix(collider.matrixWorld);
      const axis = new THREE.Vector3(1, 0, 0).transformDirection(collider.matrixWorld);
      const contacts = [Infinity, Infinity, Infinity, Infinity, Infinity];
      const check = (p: THREE.Vector3, finger: number) => {
        checked++;
        for (const sign of [-1, 1, 0]) {
          const direction = sign ? axis.clone().multiplyScalar(sign)
            : new THREE.Vector3(0, p.clone().applyMatrix4(inverse).y, 0).applyMatrix4(collider.matrixWorld).sub(p).normalize();
          ray.set(p, direction);
          const hit = ray.intersectObject(collider, false)[0];
          if (!hit) continue;
          contacts[finger] = Math.min(contacts[finger]!, hit.distance);
          const inside = normal.copy(hit.face!.normal).applyNormalMatrix(normalMatrix).dot(ray.ray.direction) > 0;
          if (inside) worst = Math.max(worst, hit.distance);
          assert.ok(!inside || hit.distance < .0005, `${name}/${mode}/${phase}: finger ${finger} intersects the handle by ${(hit.distance * 1000).toFixed(2)} mm`);
        }
      };
      for (const skin of skins) {
        const deformed = new Map<number, THREE.Vector3>();
        for (const [index, finger] of skin.vertices) {
          const p = skin.mesh.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(skin.mesh.matrixWorld);
          deformed.set(index, p); check(p, finger);
        }
        // Vertices alone can miss a broad finger triangle crossing the shaft.
        for (const face of skin.faces) {
          point.copy(deformed.get(face[0]!)!).add(deformed.get(face[1]!)!).add(deformed.get(face[2]!)!).divideScalar(3);
          check(point, skin.vertices.get(face[0]!)!);
        }
      }
      assert.ok(contacts.slice(0, 4).every(distance => distance < .006), `${name}: each finger must stay close to the grip (${contacts.map(v=>(v*1000).toFixed(2))} mm)`);
    }
  }
  console.log(`${name}: bow finger vertices and face centers clear the actual handle (maximum contact overlap ${(worst * 1000).toFixed(3)} mm).`);
}
collisionMaterial.dispose();
console.log(`${checked} bow hand surface samples checked across drawing and carrying.`);
