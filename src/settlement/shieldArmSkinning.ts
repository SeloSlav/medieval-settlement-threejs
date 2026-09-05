import * as THREE from 'three';

export const SHIELD_CUFF_BONES = ['L_ShieldCuffBlend', 'L_ShieldCuffRoll', 'L_ShieldCuffRim'] as const;
export const SHIELD_CUFF_FOLLOW = [.25, .6, 1] as const;

/** Localize the shield elbow correction to the rolled cuff. Each helper is
 * an identity child of the original sleeve bone, with the same inverse bind.
 * Remapping an influence therefore preserves every ordinary animation exactly.
 * Only shield poses move these helpers; the upper sleeve keeps its own shape. */
export function installShieldArmSkinning(root: THREE.Group): void {
  if (root.getObjectByName(SHIELD_CUFF_BONES[0])) return;
  const cuff = root.getObjectByName('L_UpperarmTwist02');
  const forearm = root.getObjectByName('L_Forearm');
  if (!(cuff instanceof THREE.Bone) || !(forearm instanceof THREE.Bone)) return;
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse(o => { if (o instanceof THREE.SkinnedMesh) meshes.push(o); });
  const skeleton = meshes[0]?.skeleton;
  if (!skeleton) return;
  const cuffIndex = skeleton.bones.indexOf(cuff), forearmIndex = skeleton.bones.indexOf(forearm);
  if (cuffIndex < 0 || forearmIndex < 0) return;
  const helpers = SHIELD_CUFF_BONES.map(name => { const bone = new THREE.Bone(); bone.name = name; cuff.add(bone); return bone; });
  const originalCount = skeleton.bones.length;
  const replacements = new Map<THREE.Skeleton, THREE.Skeleton>();
  const processed = new Set<THREE.BufferGeometry>();
  const local = new THREE.Vector3();
  for (const mesh of meshes) {
    const original = mesh.skeleton;
    let replacement = replacements.get(original);
    if (!replacement) {
      replacement = new THREE.Skeleton([...original.bones, ...helpers],
        [...original.boneInverses, ...helpers.map(() => original.boneInverses[cuffIndex]!.clone())]);
      replacements.set(original, replacement);
    }
    mesh.skeleton = replacement;
    if (processed.has(mesh.geometry)) continue;
    processed.add(mesh.geometry);
    const position = mesh.geometry.getAttribute('position');
    const joints = mesh.geometry.getAttribute('skinIndex').clone();
    for (let vertex = 0; vertex < position.count; vertex++) {
      local.fromBufferAttribute(position, vertex).applyMatrix4(mesh.bindMatrix).applyMatrix4(original.boneInverses[forearmIndex]!);
      // Distance along the authored forearm, with zero at the elbow. Leave
      // the humerus and all other influences/weights completely untouched.
      if (local.y < -.025) continue;
      const band = local.y < -.013 ? 0 : local.y < -.004 ? 1 : 2;
      for (let slot = 0; slot < 4; slot++) if (joints.getComponent(vertex, slot) === cuffIndex) {
        joints.setComponent(vertex, slot, originalCount + band);
      }
    }
    mesh.geometry.setAttribute('skinIndex', joints);
  }
}
