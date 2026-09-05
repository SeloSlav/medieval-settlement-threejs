import * as THREE from 'three';

export type MountedRidingRig = {
  model: THREE.Object3D;
  joints: { bone: THREE.Bone; base: THREE.Quaternion; axis: 'y' | 'z'; angle: number }[];
  applied: boolean;
  modelRotation: THREE.Quaternion;
  parentInverse: THREE.Quaternion;
  offset: THREE.Quaternion;
  axis: THREE.Vector3;
};

/** Open the seated thighs and let the boots hang outside the horse's barrel. */
export function bindMountedRidingRig(model: THREE.Object3D): MountedRidingRig | null {
  const joints: MountedRidingRig['joints'] = [];
  for (const [name, axis, angle] of [
    ['L_Thigh', 'y', .30], ['R_Thigh', 'y', -.30],
    ['L_Calf', 'z', .14], ['R_Calf', 'z', -.14],
  ] as const) {
    const bone = model.getObjectByName(name) as THREE.Bone | undefined;
    if (!bone?.isBone) return null;
    joints.push({ bone, base: new THREE.Quaternion(), axis, angle });
  }
  return { model, joints, applied: false, modelRotation: new THREE.Quaternion(),
    parentInverse: new THREE.Quaternion(), offset: new THREE.Quaternion(), axis: new THREE.Vector3() };
}

/** Restore before the mixer evaluates so the correction never accumulates. */
export function restoreMountedRidingPose(rig: MountedRidingRig | null): void {
  if (!rig?.applied) return;
  for (const { bone, base } of rig.joints) bone.quaternion.copy(base);
  rig.applied = false;
}

export function applyMountedRidingPose(rig: MountedRidingRig | null): void {
  if (!rig) return;
  restoreMountedRidingPose(rig);
  rig.model.getWorldQuaternion(rig.modelRotation);
  for (const { bone, base, axis, angle } of rig.joints) {
    base.copy(bone.quaternion);
    bone.parent!.getWorldQuaternion(rig.parentInverse).invert();
    rig.axis.set(0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0)
      .applyQuaternion(rig.modelRotation).applyQuaternion(rig.parentInverse);
    rig.offset.setFromAxisAngle(rig.axis, angle);
    bone.quaternion.premultiply(rig.offset).normalize();
  }
  rig.applied = true;
}
