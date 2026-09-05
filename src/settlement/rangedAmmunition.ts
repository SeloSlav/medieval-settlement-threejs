import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type AmmunitionKind = 'arrow' | 'bolt';
/** Metres, with the string contact at the origin and the point along +Z. */
export const AMMUNITION_DIMENSIONS = {
  arrow: { shaft: .82, radius: .0045, point: .045, featherLength: .112, featherWidth: .018, vanes: 3 },
  bolt: { shaft: .36, radius: .004, point: .025, featherLength: .065, featherWidth: .012, vanes: 2 },
} as const;

export function createAmmunitionMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .83, metalness: .08 });
  material.name = 'Ash arrows · banded goose feathers';
  return material;
}

/** A complete arrow is one mesh. Quiver tails retain exactly the same feather
 * geometry, colors and nock; only their concealed shaft and point are omitted. */
export function createAmmunitionGeometry(kind: AmmunitionKind, quiverTail = false): THREE.BufferGeometry {
  const d = AMMUNITION_DIMENSIONS[kind];
  const parts: THREE.BufferGeometry[] = [];
  const color = new THREE.Color();
  function part(source: THREE.BufferGeometry, tint: number) {
    const geometry = source.index ? source.toNonIndexed() : source;
    if (geometry !== source) source.dispose();
    color.setHex(tint);
    const colors = new Float32Array(geometry.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(geometry);
  }
  function cylinder(radius: number, from: number, to: number, tint: number) {
    const geometry = new THREE.CylinderGeometry(radius, radius, to - from, 6);
    geometry.rotateX(Math.PI / 2); geometry.translate(0, 0, (from + to) / 2);
    part(geometry, tint);
  }
  // The small dark collar leaves a readable string contact before the feathers.
  cylinder(d.radius * 1.18, 0, .022, 0x684b30);
  cylinder(d.radius, .022, quiverTail ? Math.min(.4, d.shaft) : d.shaft, 0x956a3b);
  if (!quiverTail) {
    const point = new THREE.ConeGeometry(d.radius * 2.1, d.point, 4);
    point.rotateX(Math.PI / 2); point.translate(0, 0, d.shaft + d.point / 2);
    part(point, 0x747d80);
  }

  const featherStartVertex = parts.reduce((sum, geometry) => sum + geometry.getAttribute('position').count, 0);
  for (let vane = 0; vane < d.vanes; vane++) {
    const positions: number[] = [], colors: number[] = [], uvs: number[] = [];
    const angle = vane * Math.PI * 2 / d.vanes;
    const radial = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
    const tangent = new THREE.Vector3(-Math.sin(angle), Math.cos(angle), 0);
    // A thin closed feather with a swept leading edge and a narrow bound root.
    const stations = [0, .23, .36, 1];
    const widths = [.002, d.featherWidth, d.featherWidth * .94, .001];
    const rings = stations.map((fraction, index) => {
      const z = .03 + fraction * d.featherLength;
      return [[d.radius, -.00045], [d.radius + widths[index]!, -.00045],
        [d.radius + widths[index]!, .00045], [d.radius, .00045]]
        .map(([r, t]) => radial.clone().multiplyScalar(r!).addScaledVector(tangent, t!).setZ(z));
    });
    function triangle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, tint: number) {
      color.setHex(tint);
      for (const p of [a, b, c]) {
        p.toArray(positions, positions.length); color.toArray(colors, colors.length);
        uvs.push(p.dot(radial) / (d.radius + d.featherWidth), (p.z - .03) / d.featherLength);
      }
    }
    const bodyColor = vane === 0 && kind === 'arrow' ? 0x9b8565 : 0xd7d1bd;
    const bandColor = vane === 0 && kind === 'arrow' ? 0x67513d : 0x958972;
    for (let section = 0; section < rings.length - 1; section++) {
      const a = rings[section]!, b = rings[section + 1]!;
      for (let edge = 0; edge < 4; edge++) {
        const next = (edge + 1) % 4;
        const tint = section === 1 ? bandColor : bodyColor;
        triangle(a[edge]!, a[next]!, b[edge]!, tint);
        triangle(a[next]!, b[next]!, b[edge]!, tint);
      }
    }
    const first = rings[0]!, last = rings.at(-1)!;
    triangle(first[0]!, first[2]!, first[1]!, bodyColor);
    triangle(first[0]!, first[3]!, first[2]!, bodyColor);
    triangle(last[0]!, last[1]!, last[2]!, bodyColor);
    triangle(last[0]!, last[2]!, last[3]!, bodyColor);
    const feather = new THREE.BufferGeometry();
    feather.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    feather.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    feather.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    feather.computeVertexNormals();
    parts.push(feather);
  }
  const geometry = mergeGeometries(parts, false)!;
  for (const piece of parts) piece.dispose();
  geometry.name = `${kind} · ${quiverTail ? 'quiver tail' : 'complete'} with banded feathers`;
  geometry.userData.featherStartVertex = featherStartVertex;
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

type SharedAmmo = { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial; users: number };
const shared = new Map<AmmunitionKind, SharedAmmo>();

/** Held ammunition and the projectile batch share GPU resources. The last
 * owner releases them; disposing one soldier must not invalidate other arrows. */
export function acquireAmmunitionAssets(kind: AmmunitionKind) {
  let assets = shared.get(kind);
  if (!assets) {
    assets = { geometry: createAmmunitionGeometry(kind), material: createAmmunitionMaterial(), users: 0 };
    shared.set(kind, assets);
  }
  assets.users++;
  const owned = assets;
  let released = false;
  return { geometry: assets.geometry, material: assets.material, release() {
    if (released) return;
    released = true;
    if (--owned.users === 0) {
      owned.geometry.dispose(); owned.material.dispose(); shared.delete(kind);
    }
  } };
}
