import * as THREE from 'three';

export const MILITARY_GRIP_BONES = ['R_GripFingers', 'R_GripTips'] as const;

/** Add two finger hinges to the worker's otherwise rigid, open right hand.
 * This runs once on the shared source. Existing vertices, UVs and materials
 * are retained; neutral hinges reproduce the original skinning exactly.
 * Every soldier then closes the grip through the existing bone palette. */
export function installMilitaryHandGrip(root: THREE.Group): void {
  const hand = root.getObjectByName('R_Hand');
  if (!(hand instanceof THREE.Bone) || root.getObjectByName(MILITARY_GRIP_BONES[0])) return;
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
          .applyMatrix4(skeleton.boneInverses[handIndex]!);
        handLength = Math.max(handLength, local.y);
      }
    }
  }
  if (handLength < 0.01) return;
  const size = handLength / 0.102;
  const fingers = new THREE.Bone(); fingers.name = MILITARY_GRIP_BONES[0];
  fingers.position.set(0.01 * size, 0.048 * size, 0);
  const tips = new THREE.Bone(); tips.name = MILITARY_GRIP_BONES[1];
  tips.position.set(0, 0.025 * size, 0);
  hand.add(fingers); fingers.add(tips);
  root.updateMatrixWorld(true);

  // All material layers share this rig, including its inverse-bind layout.
  const replacements = new Map<THREE.Skeleton, THREE.Skeleton>();
  const originalBoneCount = skeleton.bones.length;
  for (const mesh of meshes) {
    const original = mesh.skeleton;
    let replacement = replacements.get(original);
    if (!replacement) {
      replacement = new THREE.Skeleton([...original.bones, fingers, tips], [
        ...original.boneInverses,
        fingers.matrixWorld.clone().invert(), tips.matrixWorld.clone().invert(),
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
        .applyMatrix4(skeleton.boneInverses[handIndex]!).divideScalar(size);
      const influences: Array<[number, number]> = [];
      for (let slot = 0; slot < 4; slot++) {
        const joint = oldJoints.getComponent(vertex, slot);
        const weight = oldWeights.getComponent(vertex, slot);
        if (weight <= 0) continue;
        // The thumb lies on +Z; leave its authored opposing pose intact.
        if (joint !== handIndex || local.z > 0.022 || local.y <= 0.042) {
          influences.push([joint, weight]);
          continue;
        }
        const curl = THREE.MathUtils.smoothstep(local.y, 0.042, 0.055);
        const tip = THREE.MathUtils.smoothstep(local.y, 0.071, 0.088);
        influences.push([handIndex, weight * (1 - curl)],
          [originalBoneCount, weight * curl * (1 - tip)],
          [originalBoneCount + 1, weight * curl * tip]);
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
