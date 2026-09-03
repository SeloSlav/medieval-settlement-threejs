import * as THREE from 'three';

/** Static, support-driven drape: no per-frame solver or displacement/shadow mismatch. */
export const CAMP_CANOPY_DRAPE = {
  seed: 1550,
  innerSegments: 22,
  hemSegments: 6,
  overhangLength: 0.38,
  postRollRadius: 0.10,
  contactLift: 0.018,
  sagAcross: 0.28,
  sagAlong: 0.20,
  tensionFoldAmplitude: 0.09,
  hemRippleAmplitude: 0.06,
} as const;

type Supports = readonly [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];

/**
 * One continuous hide sheet. The four posts are interior contact points, not
 * corners of a rigid quad: surplus material rolls over them and hangs freely.
 * Coordinates measure the flat cutting pattern, including the hanging hems.
 */
export function createDrapedCanopyGeometry(
  supports: Supports,
  metersPerRepeat: number,
  seed: number = CAMP_CANOPY_DRAPE.seed,
): THREE.BufferGeometry {
  const style = CAMP_CANOPY_DRAPE;
  const [a, b, c, d] = supports;
  const width = b.x - a.x;
  const depth = d.z - a.z;
  if (
    !supports.every((point) => point.toArray().every(Number.isFinite))
    || !Number.isFinite(metersPerRepeat) || !Number.isFinite(seed)
    || width <= 0 || depth <= 0 || metersPerRepeat <= 0
    || Math.abs(c.x - b.x) > 1e-6 || Math.abs(d.x - a.x) > 1e-6
    || Math.abs(b.z - a.z) > 1e-6 || Math.abs(c.z - d.z) > 1e-6
  ) {
    throw new Error('Canopy requires positive dimensions and physical texture scale.');
  }
  const sampleAxis = (span: number): number[] => [
    ...Array.from({ length: style.hemSegments }, (_, i) =>
      -style.overhangLength * (1 - i / style.hemSegments)),
    ...Array.from({ length: style.innerSegments + 1 }, (_, i) => span * i / style.innerSegments),
    ...Array.from({ length: style.hemSegments }, (_, i) =>
      span + style.overhangLength * (i + 1) / style.hemSegments),
  ];
  const us = sampleAxis(width);
  const vs = sampleAxis(depth);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const pins = [[0, 0], [width, 0], [width, depth], [0, depth]] as const;

  const rollOverEdge = (distance: number, span: number, along: number) => {
    if (distance >= 0 && distance <= span) return { horizontal: distance, drop: 0 };
    const side = distance < 0 ? -1 : 1;
    const excess = distance < 0 ? -distance : distance - span;
    const angle = Math.min(Math.PI / 2, excess / style.postRollRadius);
    const loose = Math.max(0, excess - style.postRollRadius * Math.PI / 2);
    const ripple = Math.sin(along * Math.PI * 11 + seed * 0.37)
      * style.hemRippleAmplitude * loose / style.overhangLength;
    const unevenHem = (Math.sin(along * Math.PI * 7 + seed * 0.29) * 0.065
      + Math.sin(along * Math.PI * 13 - seed * 0.13) * 0.025)
      * (excess / style.overhangLength) ** 2;
    return {
      horizontal: (side < 0 ? 0 : span) + side * (
        Math.sin(angle) * style.postRollRadius + loose * 0.16 + ripple
      ),
      drop: (1 - Math.cos(angle)) * style.postRollRadius + loose + unevenHem,
    };
  };

  for (const v of vs) {
    for (const u of us) {
      const s = THREE.MathUtils.clamp(u / width, 0, 1);
      const t = THREE.MathUtils.clamp(v / depth, 0, 1);
      const across = rollOverEdge(u, width, v / depth);
      const along = rollOverEdge(v, depth, u / width);
      const supportHeight = THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(a.y, b.y, s),
        THREE.MathUtils.lerp(d.y, c.y, s),
        t,
      );
      const gravitySag = Math.sin(Math.PI * s) * style.sagAcross
        + Math.sin(Math.PI * t) * style.sagAlong;
      let tensionFolds = 0;
      // Folds fan away from the four contact points and die out in the field.
      for (const [index, [pinU, pinV]] of pins.entries()) {
        const dx = u - pinU;
        const dz = v - pinV;
        const radius = Math.hypot(dx, dz);
        const contactMask = THREE.MathUtils.smoothstep(radius, 0.10, 0.30);
        tensionFolds += Math.cos(Math.atan2(dz, dx) * 6 + index * 0.7)
          * Math.exp(-radius / 0.65) * contactMask * style.tensionFoldAmplitude;
      }
      positions.push(
        a.x + across.horizontal,
        supportHeight + style.contactLift - gravitySag
          - Math.hypot(across.drop, along.drop) + tensionFolds,
        a.z + along.horizontal,
      );
      uvs.push(
        (u + style.overhangLength) / metersPerRepeat,
        (v + style.overhangLength) / metersPerRepeat,
      );
    }
  }

  const columns = us.length;
  for (let v = 0; v < vs.length - 1; v += 1) {
    for (let u = 0; u < columns - 1; u += 1) {
      const i = v * columns + u;
      // Upward-facing top sheet; DoubleSide also shades its hanging underside.
      indices.push(i, i + columns, i + 1, i + 1, i + columns, i + columns + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.metricUvMeters = metersPerRepeat;
  geometry.userData.proceduralPhysicalUv = {
    uAxis: 'hide-cutting-pattern-across',
    vAxis: 'hide-cutting-pattern-along',
    physicalUSpan: width + 2 * style.overhangLength,
    physicalVSpan: depth + 2 * style.overhangLength,
  };
  const firstPin = style.hemSegments;
  const lastPin = firstPin + style.innerSegments;
  geometry.userData.clothDrape = {
    method: 'baked-four-contact-drape',
    seed,
    columns,
    rows: vs.length,
    supports: supports.map((point) => point.toArray()),
    contactVertexIndices: [
      firstPin * columns + firstPin,
      firstPin * columns + lastPin,
      lastPin * columns + lastPin,
      lastPin * columns + firstPin,
    ],
    overhangLength: style.overhangLength,
    postRollRadius: style.postRollRadius,
  };
  return geometry;
}
