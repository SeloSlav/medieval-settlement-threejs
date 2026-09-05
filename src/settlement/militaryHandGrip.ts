import * as THREE from 'three';

export const MILITARY_GRIP_BONES = [
  'R_GripIndex', 'R_GripIndexTip', 'R_GripMiddle', 'R_GripMiddleTip',
  'R_GripRing', 'R_GripRingTip', 'R_GripPinky', 'R_GripPinkyTip', 'R_GripThumb',
] as const;
export const MILITARY_LEFT_GRIP_BONES = MILITARY_GRIP_BONES.map(name => name.replace('R_', 'L_'));
const FINGER_JOINTS = [
  [0.052, 0.012, 0.022], [0.05, -0.002, 0.026],
  [0.045, -0.017, 0.024], [0.038, -0.033, 0.02],
] as const;

/** Authored palm reference relative to a corrected anatomical wrist pivot. */
export function offsetMilitaryHandGrip(hand: THREE.Bone, point: THREE.Vector3): THREE.Vector3 {
  const origin = hand.userData.militaryGripOrigin as readonly number[] | undefined;
  if (origin) { point.x += origin[0]!; point.y += origin[1]!; point.z += origin[2]!; }
  return point;
}

/** Add finger and thumb hinges to the worker's otherwise rigid, open right hand.
 * This runs once on the shared source. Existing vertices, UVs and materials
 * are retained; neutral hinges reproduce the original skinning exactly.
 * Every soldier then closes the grip through the existing bone palette. */
export function installMilitaryHandGrip(root: THREE.Group): void {
  installHand(root, false);
  installHand(root, true);
}

function installHand(root: THREE.Group, left: boolean): void {
  const names = left ? MILITARY_LEFT_GRIP_BONES : MILITARY_GRIP_BONES;
  const mirror = left ? -1 : 1;
  const hand = root.getObjectByName(left ? 'L_Hand' : 'R_Hand');
  if (!(hand instanceof THREE.Bone) || root.getObjectByName(names[0]!)) return;
  const gripOrigin = offsetMilitaryHandGrip(hand, new THREE.Vector3());
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse(object => { if (object instanceof THREE.SkinnedMesh) meshes.push(object); });
  const skeleton = meshes[0]?.skeleton;
  if (!skeleton) return;
  const handIndex = skeleton.bones.indexOf(hand);
  if (handIndex < 0) return;
  const local = new THREE.Vector3();
  let handLength = 0;
  for (const mesh of meshes) {
    const position = mesh.geometry.getAttribute('position');
    const joints = mesh.geometry.getAttribute('skinIndex');
    const weights = mesh.geometry.getAttribute('skinWeight');
    for (let vertex = 0; vertex < position.count; vertex++) {
      for (let slot = 0; slot < 4; slot++) {
        if (joints.getComponent(vertex, slot) !== handIndex || weights.getComponent(vertex, slot) < 0.8) continue;
        local.fromBufferAttribute(position, vertex).applyMatrix4(mesh.bindMatrix)
          .applyMatrix4(skeleton.boneInverses[handIndex]!).sub(gripOrigin);
        handLength = Math.max(handLength, local.y);
      }
    }
  }
  if (handLength < 0.01) return;
  const size = handLength / 0.102;
  hand.userData.militaryGripScale = size;
  const gripBones: THREE.Bone[] = [];
  for (let i = 0; i < FINGER_JOINTS.length; i++) {
    const [y, z, length] = FINGER_JOINTS[i]!;
    const finger = new THREE.Bone(); finger.name = names[i * 2]!;
    finger.position.set(mirror * 0.01 * size, y * size, z * size).add(gripOrigin);
    const tip = new THREE.Bone(); tip.name = names[i * 2 + 1]!;
    tip.position.set(0, length * size, 0);
    hand.add(finger); finger.add(tip); gripBones.push(finger, tip);
  }
  const thumbBone = new THREE.Bone(); thumbBone.name = names[8]!;
  thumbBone.position.set(mirror * 0.003 * size, 0.028 * size, 0.016 * size).add(gripOrigin);
  hand.add(thumbBone); gripBones.push(thumbBone);
  root.updateMatrixWorld(true);

  // All material layers share this rig, including its inverse-bind layout.
  const replacements = new Map<THREE.Skeleton, THREE.Skeleton>();
  const originalBoneCount = skeleton.bones.length;
  for (const mesh of meshes) {
    const original = mesh.skeleton;
    let replacement = replacements.get(original);
    if (!replacement) {
      replacement = new THREE.Skeleton([...original.bones, ...gripBones], [
        ...original.boneInverses,
        ...gripBones.map(bone => bone.matrixWorld.clone().invert()),
      ]);
      replacements.set(original, replacement);
    }
    mesh.skeleton = replacement;
  }
  const processed = new Set<THREE.BufferGeometry>();
  for (const mesh of meshes) {
    if (processed.has(mesh.geometry)) continue;
    processed.add(mesh.geometry);
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const oldJoints = geometry.getAttribute('skinIndex');
    const oldWeights = geometry.getAttribute('skinWeight');
    const joints = new THREE.Uint16BufferAttribute(oldJoints.count * 4, 4);
    const weights = new THREE.Float32BufferAttribute(oldWeights.count * 4, 4);
    for (let vertex = 0; vertex < position.count; vertex++) {
      local.fromBufferAttribute(position, vertex).applyMatrix4(mesh.bindMatrix)
        .applyMatrix4(skeleton.boneInverses[handIndex]!).sub(gripOrigin).divideScalar(size);
      const influences: Array<[number, number]> = [];
      for (let slot = 0; slot < 4; slot++) {
        const joint = oldJoints.getComponent(vertex, slot);
        const weight = oldWeights.getComponent(vertex, slot);
        if (weight <= 0) continue;
        if (joint !== handIndex || local.y <= 0.032) {
          influences.push([joint, weight]);
          continue;
        }
        // The thumb lies on +Z and ends before the long fingers. Blend its
        // webbing smoothly; a hard Z cutoff leaves strips of the index finger
        // unbent at the transition into the palm.
        const thumb = THREE.MathUtils.smoothstep(local.z, 0.012, 0.027)
          * (1 - THREE.MathUtils.smoothstep(local.y, 0.062, 0.078));
        const finger = local.z > 0.005 ? 0 : local.z > -0.01 ? 1 : local.z > -0.026 ? 2 : 3;
        const [rootY, , length] = FINGER_JOINTS[finger]!;
        const curl = THREE.MathUtils.smoothstep(local.y, rootY - 0.006, rootY + 0.008) * (1 - thumb);
        const thumbWeight = thumb * THREE.MathUtils.smoothstep(local.y, 0.032, 0.05);
        const tip = THREE.MathUtils.smoothstep(local.y, rootY + length - 0.003, rootY + length + 0.009);
        influences.push([handIndex, weight * (1 - curl - thumbWeight)],
          [originalBoneCount + finger * 2, weight * curl * (1 - tip)],
          [originalBoneCount + finger * 2 + 1, weight * curl * tip],
          [originalBoneCount + 8, weight * thumbWeight]);
      }
      influences.sort((a, b) => b[1] - a[1]);
      const total = influences.slice(0, 4).reduce((sum, item) => sum + item[1], 0);
      for (let slot = 0; slot < 4; slot++) {
        joints.setComponent(vertex, slot, influences[slot]?.[0] ?? 0);
        weights.setComponent(vertex, slot, (influences[slot]?.[1] ?? 0) / (total || 1));
      }
    }
    geometry.setAttribute('skinIndex', joints);
    geometry.setAttribute('skinWeight', weights);
  }
}
