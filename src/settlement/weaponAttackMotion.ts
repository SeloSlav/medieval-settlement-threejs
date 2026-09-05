import * as THREE from 'three';

export type AttackMotionFamily = 'spear-pike' | 'sword-shield' | 'halberd' | 'bow' | 'crossbow';
export type WeaponAttackMotion = {
  grip: THREE.Vector3;
  orientation: THREE.Quaternion;
  lean: number;
  turn: number;
  draw: number;
  reload: number;
};

/** Positions are relative to the shoulder midpoint, in measured arm lengths.
 * +Z is the target, -X the fighter's right. Weapon +Y is its working axis.
 * Each cycle ends at contact/release and starts with its recovery. */
const horizontal = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
  new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)));
const keys = {
  'spear-pike': [
    key([-.02, -.48, .34], horizontal, .025, -.7),
    key([-.04, -.48, .1], horizontal, -.015, -.75),
    key([.04, -.36, .64], horizontal, .11, -.65),
  ],
  'sword-shield': [
    key([-.36, -.16, .64], rotation(.32, -.18, -.1), .015, -.12),
    key([-.5, .35, .43], rotation(-.62, -.25, -.26), -.035, -.3),
    key([.12, -.4, .8], rotation(1.95, .3, .15), .1, .24),
  ],
  halberd: [
    key([-.04, -.25, .5], rotation(.25, 0, -.06), .02, -.3),
    key([.12, .05, .5], rotation(-.4, -.15, -.12), -.04, -.35),
    key([.1, -.32, .4], rotation(1.35, .08, .06), .12, -.1),
  ],
} as const;

function rotation(x: number, y: number, z: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
}
function key(grip: [number, number, number], orientation: THREE.Quaternion, lean: number, turn: number) {
  return { grip: new THREE.Vector3(...grip), orientation, lean, turn };
}
const bowAim = key([-.15, .12, 1.1], rotation(0, 0, 0), -.01, -.95);
const bowNock = key([-.1, -.16, .78], rotation(.18, 0, -.05), .025, -.95);
const crossbowAim = key([-.12, .22, .54], horizontal, -.01, -.38);
const crossbowLoad = key([-.1, -.32, .36], horizontal.clone().multiply(rotation(-.5, 0, 0)), .08, -.45);

export function createWeaponAttackMotion(): WeaponAttackMotion {
  return { grip: new THREE.Vector3(), orientation: new THREE.Quaternion(), lean: 0, turn: 0, draw: 0, reload: 0 };
}

export function sampleWeaponAttackMotion(family: AttackMotionFamily, progress: number, out: WeaponAttackMotion): WeaponAttackMotion {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  out.draw = 0; out.reload = 0;
  if (family === 'bow') {
    const lower = p < .18 ? smooth(p, 0, .18) : 1 - smooth(p, .18, .4);
    mix(bowAim, bowNock, lower, out);
    out.draw = p < .12 ? 1 - smooth(p, 0, .12) : smooth(p, .34, .72);
  } else if (family === 'crossbow') {
    const lower = p < .18 ? smooth(p, 0, .18) : 1 - smooth(p, .66, .86);
    mix(crossbowAim, crossbowLoad, lower, out);
    out.reload = smooth(p, .2, .5);
  } else {
    const [guard, wind, contact] = keys[family];
    if (p < .28) mix(contact, guard, smooth(p, 0, .28), out);
    else if (p < .56) mix(guard, guard, 0, out);
    else if (p < .84) mix(guard, wind, smooth(p, .56, .84), out);
    else mix(wind, contact, smooth(p, .84, 1), out);
  }
  return out;
}

function smooth(p: number, a: number, b: number): number { return THREE.MathUtils.smoothstep(p, a, b); }
function mix(a: ReturnType<typeof key>, b: ReturnType<typeof key>, t: number, out: WeaponAttackMotion): void {
  out.grip.copy(a.grip).lerp(b.grip, t);
  out.orientation.copy(a.orientation).slerp(b.orientation, t);
  out.lean = THREE.MathUtils.lerp(a.lean, b.lean, t);
  out.turn = THREE.MathUtils.lerp(a.turn, b.turn, t);
}
