import * as THREE from 'three';

export type ShieldSize = 'small' | 'medium' | 'large';

/** Shield frame: +Z faces the threat, +X runs from the fist toward the elbow. */
export function shieldGripLayout(size: ShieldSize) {
  return {
    grip: [size === 'small' ? -.05 : -.075, .015, -.095] as const,
    strapX: size === 'small' ? .065 : .105,
    strapY: .015,
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

/** A leather loop with an actual forearm opening, fixed to the rear board at
 * both ends. The ribbon has thickness, outward faces and no hidden back bar. */
export function createShieldArmStrap(): THREE.BufferGeometry {
  const path = [[.067, -.022], [.066, -.065], [.045, -.121], [0, -.144],
    [-.045, -.121], [-.066, -.065], [-.067, -.022]];
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  let distance = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!, before = path[Math.max(0, i - 1)]!, after = path[Math.min(path.length - 1, i + 1)]!;
    const tangent = new THREE.Vector2(after[0]! - before[0]!, after[1]! - before[1]!).normalize();
    if (i) distance += Math.hypot(p[0]! - before[0]!, p[1]! - before[1]!);
    for (const [x, depth] of [[-.017, -.003], [.017, -.003], [.017, .003], [-.017, .003]]) {
      positions.push(x!, p[0]! - tangent.y * depth!, p[1]! + tangent.x * depth!);
      uvs.push((x! + .017) / .034, distance / .034);
    }
    if (i) for (let edge = 0; edge < 4; edge++) {
      const a = (i - 1) * 4 + edge, b = (i - 1) * 4 + (edge + 1) % 4;
      indices.push(a, b, a + 4, b, b + 4, a + 4);
    }
  }
  const last = (path.length - 1) * 4;
  indices.push(0, 2, 1, 0, 3, 2, last, last + 1, last + 2, last, last + 2, last + 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}
