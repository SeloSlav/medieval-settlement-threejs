import * as THREE from 'three';

type Leg = { thigh: THREE.Bone; calf: THREE.Bone; foot: THREE.Bone; anchor: THREE.Vector3; orientation: THREE.Quaternion };
export type MeleeBodyRig = {
  model: THREE.Group; hip: THREE.Bone; legs: Leg[];
  bones: THREE.Bone[]; reference: THREE.Quaternion[]; base: THREE.Quaternion[];
  hipAnchor: THREE.Vector3; hipPosition: THREE.Vector3; applied: boolean;
  vectors: THREE.Vector3[]; rotations: THREE.Quaternion[];
};

/** Own the attacking lower body independently of the locomotion and riding
 * rigs. World-space ankle anchors stay planted while the hips load and drive. */
export function bindMeleeBodyRig(model: THREE.Group): MeleeBodyRig | null {
  const hip = model.getObjectByName('Hip') as THREE.Bone | undefined;
  if (!hip?.isBone) return null;
  const legs: Leg[] = [];
  const bones = [hip];
  const inverse = model.getWorldQuaternion(new THREE.Quaternion()).invert();
  for (const side of ['L_', 'R_']) {
    const thigh = model.getObjectByName(`${side}Thigh`) as THREE.Bone;
    const calf = model.getObjectByName(`${side}Calf`) as THREE.Bone;
    const foot = model.getObjectByName(`${side}Foot`) as THREE.Bone;
    if (!thigh?.isBone || !calf?.isBone || !foot?.isBone) return null;
    legs.push({ thigh, calf, foot, anchor: model.worldToLocal(foot.getWorldPosition(new THREE.Vector3())),
      orientation: foot.getWorldQuaternion(new THREE.Quaternion()).premultiply(inverse) });
    bones.push(thigh, calf, foot);
  }
  return { model, hip, legs, bones, reference: bones.map(b=>b.quaternion.clone()), base: bones.map(b=>b.quaternion.clone()),
    hipAnchor: model.worldToLocal(hip.getWorldPosition(new THREE.Vector3())), hipPosition: hip.position.clone(),
    applied: false, vectors: Array.from({length:10},()=>new THREE.Vector3()), rotations: Array.from({length:4},()=>new THREE.Quaternion()) };
}

export function restoreMeleeBodyPose(rig: MeleeBodyRig | null): void {
  if (!rig?.applied) return;
  rig.bones.forEach((b,i)=>b.quaternion.copy(rig.base[i]!));
  rig.hip.position.copy(rig.hipPosition);
  rig.applied=false;
}

export function applyMeleeBodyPose(rig: MeleeBodyRig | null, turn: number, lean: number): void {
  if (!rig) return;
  restoreMeleeBodyPose(rig);
  const v=rig.vectors, q=rig.rotations;
  rig.bones.forEach((b,i)=>{rig.base[i]!.copy(b.quaternion);b.quaternion.copy(rig.reference[i]!);});
  rig.hipPosition.copy(rig.hip.position);rig.applied=true;
  const body=rig.model.getWorldQuaternion(q[0]!);
  const {thigh,calf,foot}=rig.legs[0]!;
  const legLength=thigh.getWorldPosition(v[0]!).distanceTo(calf.getWorldPosition(v[1]!))
    +v[1]!.distanceTo(foot.getWorldPosition(v[2]!));
  const drive=THREE.MathUtils.clamp((lean+.12)/.40,0,1);
  const target=rig.model.localToWorld(v[3]!.copy(rig.hipAnchor));
  target.add(v[4]!.set(.015+.045*drive,-.075-.035*drive,-.06+.14*drive).multiplyScalar(legLength).applyQuaternion(body));
  rig.hip.position.copy(rig.hip.parent!.worldToLocal(target));
  const up=v[4]!.set(0,1,0).applyQuaternion(body).applyQuaternion(rig.hip.parent!.getWorldQuaternion(q[1]!).invert());
  rig.hip.quaternion.premultiply(q[2]!.setFromAxisAngle(up,turn*.34));
  rig.hip.updateWorldMatrix(true,true);
  for (let i=0;i<rig.legs.length;i++) {
    const leg=rig.legs[i]!;
    const ankle=rig.model.localToWorld(v[3]!.copy(leg.anchor));
    ankle.add(v[4]!.set(i===0?.04:-.04,0,i===0?.20:-.18).multiplyScalar(legLength).applyQuaternion(body));
    plantLeg(rig,leg,ankle,body);
  }
}

function plantLeg(rig: MeleeBodyRig, leg: Leg, target: THREE.Vector3, body: THREE.Quaternion): void {
  const v=rig.vectors,q=rig.rotations;
  const origin=leg.thigh.getWorldPosition(v[0]!);
  const knee=leg.calf.getWorldPosition(v[1]!);
  const ankle=leg.foot.getWorldPosition(v[2]!);
  const upper=origin.distanceTo(knee), lower=knee.distanceTo(ankle);
  const direction=v[4]!.copy(target).sub(origin);
  const reach=THREE.MathUtils.clamp(direction.length(),Math.abs(upper-lower)+1e-5,upper+lower-1e-5);
  direction.normalize();
  const along=(upper*upper-lower*lower+reach*reach)/(2*reach);
  const height=Math.sqrt(Math.max(0,upper*upper-along*along));
  const bend=v[5]!.set(0,0,1).applyQuaternion(body);
  bend.addScaledVector(direction,-bend.dot(direction)).normalize();
  const kneeTarget=v[6]!.copy(origin).addScaledVector(direction,along).addScaledVector(bend,height);
  aim(rig,leg.thigh,leg.calf,kneeTarget);
  aim(rig,leg.calf,leg.foot,target);
  const world=q[2]!.copy(body).multiply(leg.orientation);
  leg.foot.quaternion.copy(leg.foot.parent!.getWorldQuaternion(q[1]!).invert()).multiply(world);
  leg.foot.updateWorldMatrix(true,true);
}

function aim(rig:MeleeBodyRig,bone:THREE.Bone,child:THREE.Bone,target:THREE.Vector3):void {
  const v=rig.vectors,q=rig.rotations;
  const direction=v[7]!.copy(target).sub(bone.getWorldPosition(v[8]!)).normalize();
  direction.applyQuaternion(bone.parent!.getWorldQuaternion(q[1]!).invert());
  const axis=v[8]!.copy(child.position).normalize().applyQuaternion(bone.quaternion);
  bone.quaternion.premultiply(q[3]!.setFromUnitVectors(axis,direction));
  bone.updateWorldMatrix(true,true);
}
