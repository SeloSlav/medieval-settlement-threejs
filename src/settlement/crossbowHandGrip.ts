import * as THREE from 'three';

/** Finger-only stock fits; the authored wrist and reload path remain unchanged. */
const curlAxis = new THREE.Vector3(0, 0, 1);
function fit(handSize: number, fingers: readonly (readonly [root: number, tip: number])[]) {
  return { handSize, fingers: fingers.flatMap(pair => pair.map(angle => new THREE.Quaternion().setFromAxisAngle(curlAxis, angle))) };
}

// Open the knuckles slightly and curl the distal joints over the stock. A
// shared curl plane avoids the splayed, twisted webbing of the sword grip.
// The measured hand sizes identify the male villager and raider source meshes.
const fits = [
  fit(1.0014218, [[0, 1.8], [-.25, 1.8], [-.3, 2.2], [-.3, 2.2]]),
  fit(1.1208673, [[-.4, 1.95], [-.4, 2.1], [-.4, 2.2], [-.4, 2.2]]),
];

export function crossbowFingerGrip(hand: THREE.Bone): readonly THREE.Quaternion[] {
  const size = Number(hand.userData.militaryGripScale ?? fits[0]!.handSize);
  let selected = fits[0]!;
  for (const candidate of fits) if (Math.abs(candidate.handSize - size) < Math.abs(selected.handSize - size)) selected = candidate;
  return selected.fingers;
}
