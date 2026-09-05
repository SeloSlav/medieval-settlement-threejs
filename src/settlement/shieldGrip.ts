import * as THREE from 'three';

export type ShieldSize = 'small' | 'medium' | 'large';

/** Shield frame: +Z faces the threat, +X runs from the fist toward the elbow. */
export function shieldGripLayout(size: ShieldSize) {
  return {
    grip: [size === 'small' ? -.05 : -.075, .015, -.095] as const,
    gripLength: size === 'small' ? .105 : .112,
  };
}

// With a neutral left wrist: fingers +Y, palm +X, thumb +Z. The shield sits
// against the back of the hand, with its grip perpendicular to the forearm.
export const SHIELD_HAND_FRAME = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
  new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0),
));
export const SHIELD_HANDLE_RADII = [.019, .0135] as const;
const fingerAxis = new THREE.Vector3(0, 0, 1);
function handFit(size: number, palm: [number, number, number], curls: number[][], thumb: [number, number, number]) {
  return { size, palm, fingers: curls.flatMap(pair => pair.map(angle => new THREE.Quaternion().setFromAxisAngle(fingerAxis, -angle))),
    thumb: new THREE.Quaternion().setFromEuler(new THREE.Euler(...thumb)) };
}
// Independent fits for the male worker's bare hand and raider's padded glove.
// These apply only while a shield is mounted on the left hand.
const handFits = [
  handFit(.7255025, [.010, .029, -.0071], [[.9, 1.35], [.7, 1.35], [.5, 1.35], [.1, 1.1]], [0, 0, 0]),
  handFit(1.0345412, [.024, .030, -.0071], [[1.35, .8], [1.4, .6], [1.05, .95], [.65, 1]], [-.15, -.15, .15]),
];
export function shieldHandFit(hand: THREE.Bone): typeof handFits[number] {
  const size = Number(hand.userData.militaryGripScale ?? handFits[0]!.size);
  return handFits.reduce((best, candidate) => Math.abs(candidate.size - size) < Math.abs(best.size - size) ? candidate : best);
}
