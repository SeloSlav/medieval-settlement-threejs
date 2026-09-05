import * as THREE from 'three';

export type AttackMotionFamily = 'spear-pike' | 'sword-shield' | 'halberd' | 'bow' | 'crossbow';
export type WeaponAttackMotion = {
  grip: THREE.Vector3;
  orientation: THREE.Quaternion;
  lean: number;
  turn: number;
  draw: number;
  extension: number;
  reload: number;
};

/** Positions are relative to the shoulder midpoint, in measured arm lengths.
 * +Z is the target, -X the fighter's right. Weapon +Y is its working axis.
 * Each cycle ends at contact/release and starts with its recovery. */
const horizontal = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
  new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)));
export type MeleeAttackContext = { mounted?: boolean; shield?: boolean; defensive?: boolean };
// Continuous, cyclic tracks. Contact is at the server's cooldown wrap (0/1),
// followed by deceleration, recovery, chambering, and a short committed strike.
// Grip X stays outside the ribs; a two-handed shaft never sweeps through them.
type MeleeKey = readonly [time: number, x: number, y: number, z: number,
  pitch: number, yaw: number, roll: number, lean: number, turn: number];
const cuts: readonly MeleeKey[] = [
  [0, -.38, -.12, .84, 1.25, .18, -.38, .22, .46],
  [.12, -.40, -.62, .60, 2.30, .28, -.32, .26, .58],
  [.38, -.57, -.36, .40, .45, -.20, -.22, .04, -.18],
  [.56, -.62, -.10, .36, .05, -.30, -.26, .02, -.36],
  [.82, -.66, .39, .10, -.92, -.32, -.38, -.12, -.78],
  [.91, -.54, .26, .62, .28, -.05, -.48, .08, -.08],
];
const mountedCuts: readonly MeleeKey[] = [
  [0, -1.06, -.28, .55, 1.48, -.52, .55, .16, .22],
  [.12, -1.10, -.62, .24, 2.12, -.60, .48, .20, .34],
  [.38, -.78, -.16, .18, .20, -.35, -.18, .02, -.22],
  [.56, -.76, .02, .14, -.15, -.40, -.22, 0, -.34],
  [.82, -.78, .46, .02, -.82, -.50, -.42, -.10, -.65],
  [.91, -1.00, .20, .42, .55, -.50, .24, .05, -.06],
];
const thrusts: readonly MeleeKey[] = [
  [0, -.51, -.40, .37, -Math.PI / 2, 0, Math.PI, .17, -.64],
  [.10, -.51, -.40, .38, -Math.PI / 2, 0, Math.PI, .19, -.62],
  [.38, -.53, -.46, .28, -Math.PI / 2, 0, Math.PI, .03, -.65],
  [.56, -.53, -.46, .26, -Math.PI / 2, 0, Math.PI, .02, -.67],
  [.83, -.53, -.48, .04, -Math.PI / 2, 0, Math.PI, -.06, -.88],
  [.92, -.52, -.42, .32, -Math.PI / 2, 0, Math.PI, .07, -.64],
];
const chops: readonly MeleeKey[] = [
  [0, -.39, -.22, .38, 1.25, .08, -.22, .22, -.50],
  [.12, -.39, -.40, .30, 1.65, .10, -.30, .28, -.32],
  [.38, -.46, -.34, .40, .35, -.14, -.24, .04, -.25],
  [.56, -.48, -.18, .38, .10, -.20, -.24, .02, -.38],
  [.82, -.48, .20, .34, -.58, -.18, -.20, -.13, -.72],
  [.91, -.43, .06, .46, .38, -.04, -.14, .06, -.20],
];

function rotation(x: number, y: number, z: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
}
function key(grip: [number, number, number], orientation: THREE.Quaternion, lean: number, turn: number) {
  return { grip: new THREE.Vector3(...grip), orientation, lean, turn };
}
const bowAim = key([-.15, .12, 1.1], rotation(0, 0, 0), -.01, -1.35);
const bowNock = key([-.1, -.16, .78], rotation(.18, 0, -.05), .025, -.55);
const crossbowAim = key([-.12, .22, .54], horizontal, -.01, -.38);
const crossbowLoad = key([-.1, -.32, .36], horizontal.clone().multiply(rotation(-.5, 0, 0)), .08, -.45);

export function createWeaponAttackMotion(): WeaponAttackMotion {
  return { grip: new THREE.Vector3(), orientation: new THREE.Quaternion(), lean: 0, turn: 0, draw: 0, extension: 0, reload: 0 };
}

export function sampleWeaponAttackMotion(family: AttackMotionFamily, progress: number, out: WeaponAttackMotion,
  context: MeleeAttackContext = {}): WeaponAttackMotion {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  out.draw = 0; out.extension = 0; out.reload = 0;
  if (family === 'bow') {
    const lower = p < .18 ? smooth(p, 0, .18) : 1 - smooth(p, .18, .4);
    mix(bowAim, bowNock, lower, out);
    out.draw = p < .18 ? 1 - smooth(p, 0, .18) : smooth(p, .34, .72);
    out.extension = out.draw;
    // Open the stance with the draw, so the string hand can still reach the
    // bow during loading instead of chasing it from behind a turned shoulder.
    out.turn = THREE.MathUtils.lerp(bowNock.turn, bowAim.turn, out.draw);
  } else if (family === 'crossbow') {
    const lower = p < .18 ? smooth(p, 0, .18) : 1 - smooth(p, .66, .86);
    mix(crossbowAim, crossbowLoad, lower, out);
    out.reload = smooth(p, .2, .5);
  } else {
    const track = family === 'spear-pike' ? thrusts : family === 'halberd' ? chops : context.mounted ? mountedCuts : cuts;
    sampleMelee(track, p, out);
    if (context.shield && !context.mounted && family === 'sword-shield') {
      const outside=p<.38?1:p<.82?1-smooth(p,.38,.68):smooth(p,.82,1);
      out.grip.x -= .22*outside;
    }
    if (family === 'spear-pike' && (context.shield || context.mounted)) {
      out.grip.x -= context.mounted ? .24 : .12;
      out.turn *= .65;
      out.lean *= .75;
    }
    if (context.defensive) {
      if(family==='spear-pike')out.grip.set(context.mounted?-.88:-.66,-.72,.34);
      else out.grip.set(context.mounted?-.94:-.63,context.mounted?-.65:-.92,context.mounted?.14:.20);
      out.orientation.copy(rotation(family === 'spear-pike' ? 1.32 : 2.50, -.32, .12));
      out.lean = .10; out.turn = -.28;
    }
  }
  return out;
}

const meleeEuler = new THREE.Euler();
function sampleMelee(track: readonly MeleeKey[], p: number, out: WeaponAttackMotion): void {
  let i = track.length - 1;
  for (let j = 0; j < track.length - 1; j++) if (p < track[j + 1]![0]) { i = j; break; }
  const a = track[i]!, b = track[(i + 1) % track.length]!;
  const previous = track[(i + track.length - 1) % track.length]!, next = track[(i + 2) % track.length]!;
  const dt = (b[0] - a[0] + 1) % 1, before = (a[0] - previous[0] + 1) % 1, after = (next[0] - b[0] + 1) % 1;
  const t = (p - a[0]) / dt, t2 = t * t, t3 = t2 * t;
  const component = (c: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8): number => {
    const slope = (b[c] - a[c]) / dt;
    const tangent = (l: number, r: number) => l * r <= 0 ? 0 : 2 * l * r / (l + r);
    const m0 = tangent((a[c] - previous[c]) / before, slope) * dt;
    const m1 = tangent(slope, (next[c] - b[c]) / after) * dt;
    return (2*t3 - 3*t2 + 1)*a[c] + (t3 - 2*t2 + t)*m0 + (-2*t3 + 3*t2)*b[c] + (t3 - t2)*m1;
  };
  out.grip.set(component(1), component(2), component(3));
  out.orientation.setFromEuler(meleeEuler.set(component(4), component(5), component(6)));
  out.lean = component(7); out.turn = component(8);
}

function smooth(p: number, a: number, b: number): number { return THREE.MathUtils.smoothstep(p, a, b); }
function mix(a: ReturnType<typeof key>, b: ReturnType<typeof key>, t: number, out: WeaponAttackMotion): void {
  out.grip.copy(a.grip).lerp(b.grip, t);
  out.orientation.copy(a.orientation).slerp(b.orientation, t);
  out.lean = THREE.MathUtils.lerp(a.lean, b.lean, t);
  out.turn = THREE.MathUtils.lerp(a.turn, b.turn, t);
}
