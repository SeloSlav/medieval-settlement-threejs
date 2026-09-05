import * as THREE from 'three';
import { offsetMilitaryHandGrip } from './militaryHandGrip.ts';

/** The oval handle and finger pose are authored together. Coordinates use
 * the bow's shooting frame (+Y shaft, +Z downrange) and the left hand frame. */
export const BOW_GRIP = { radiusX: .0135, radiusZ: .02, halfLength: .0625 } as const;
const axis = new THREE.Vector3(0, 0, 1);
function fit(handSize: number, palm: [number, number, number], fingers: number[][], thumb: [number, number, number]) {
  return { handSize, palm, fingers: fingers.flatMap(pair => pair.map(angle => new THREE.Quaternion().setFromAxisAngle(axis, -angle))),
    thumb: new THREE.Quaternion().setFromEuler(new THREE.Euler(...thumb)) };
}

// Fitted against the male combatant's bare hand and raider glove meshes.
// Their measured hand lengths identify the source fit on skeleton clones.
// The padded palms need different handle offsets, not just larger curls.
const fits = [
  fit(.7255025, [.010, .029, -.0071], [[.9, 1.35], [.7, 1.35], [.5, 1.35], [.1, 1.1]], [0, 0, 0]),
  fit(1.0345412, [.024, .030, -.0071], [[1.35, .8], [1.4, .6], [1.05, .95], [.65, 1]], [-.15, -.15, .15]),
];

export function bowHandGrip(hand: THREE.Bone): typeof fits[number] {
  const size = Number(hand.userData.militaryGripScale ?? fits[0]!.handSize);
  let selected = fits[0]!;
  for (const candidate of fits) if (Math.abs(candidate.handSize - size) < Math.abs(selected.handSize - size)) selected = candidate;
  return selected;
}

export function bowPalmLocal(hand: THREE.Bone, out: THREE.Vector3): THREE.Vector3 {
  return offsetMilitaryHandGrip(hand, out.set(...bowHandGrip(hand).palm));
}
