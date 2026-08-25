import * as THREE from 'three';
import type { LivestockHerdState, PastureState } from '../resources/types.ts';
import type { FarmFieldCorners } from './farmFieldMath.ts';
import { hashParcelSeed, organicParcelEdgePoints } from './organicParcelGeometry.ts';

const POST_GEOMETRY = new THREE.CylinderGeometry(0.09, 0.12, 1.32, 6);
const RAIL_GEOMETRY = new THREE.BoxGeometry(1, 0.09, 0.09);
const POST_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x4d3522, roughness: 0.96 });
const RAIL_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x6e4d2d, roughness: 0.94 });
const CATTLE_GRASS = new THREE.MeshStandardMaterial({ color: 0x627b40, roughness: 1, transparent: true, opacity: 0.18, depthWrite: false });
const SHEEP_GRASS = new THREE.MeshStandardMaterial({ color: 0x78834b, roughness: 1, transparent: true, opacity: 0.16, depthWrite: false });
const PANNAGE_GROUND = new THREE.MeshStandardMaterial({ color: 0x57442d, roughness: 1, transparent: true, opacity: 0.12, depthWrite: false });
const PASTURE_GATE_WIDTH_M = 2.2;

function addFenceSpan(
  group: THREE.Group,
  a: { x: number; z: number },
  b: { x: number; z: number },
  getHeightAt: (x: number, z: number) => number,
  interiorTarget: { x: number; z: number },
  seed: number,
): void {
  const points = organicParcelEdgePoints(a, b, {
    seed,
    spacing: 2.55,
    amplitude: 0.34,
    inwardTarget: interiorTarget,
  });
  for (let i = 0; i < points.length; i++) {
    const { x, z } = points[i]!;
    const post = new THREE.Mesh(POST_GEOMETRY, POST_MATERIAL);
    post.position.set(x, getHeightAt(x, z) + 0.66, z);
    post.rotation.z = ((seed + i) & 1) === 0 ? -0.018 : 0.025;
    post.castShadow = true;
    group.add(post);
    if (i === points.length - 1) continue;
    const { x: nx, z: nz } = points[i + 1]!;
    const segmentLength = Math.hypot(nx - x, nz - z);
    const mx = (x + nx) * 0.5;
    const mz = (z + nz) * 0.5;
    const yaw = Math.atan2(nz - z, nx - x);
    for (const lift of [0.43, 0.91]) {
      const rail = new THREE.Mesh(RAIL_GEOMETRY, RAIL_MATERIAL);
      rail.scale.x = segmentLength * 0.96;
      rail.rotation.y = -yaw;
      rail.position.set(mx, getHeightAt(mx, mz) + lift, mz);
      rail.castShadow = true;
      group.add(rail);
    }
  }
}

function addFenceEdge(
  group: THREE.Group,
  a: { x: number; z: number },
  b: { x: number; z: number },
  getHeightAt: (x: number, z: number) => number,
  interiorTarget: { x: number; z: number },
  seed: number,
  openingWidth = 0,
): void {
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  if (openingWidth <= 0 || length <= openingWidth + 1.2) {
    addFenceSpan(group, a, b, getHeightAt, interiorTarget, seed);
    return;
  }

  const halfOpeningT = openingWidth / (length * 2);
  const openingStart = {
    x: THREE.MathUtils.lerp(a.x, b.x, 0.5 - halfOpeningT),
    z: THREE.MathUtils.lerp(a.z, b.z, 0.5 - halfOpeningT),
  };
  const openingEnd = {
    x: THREE.MathUtils.lerp(a.x, b.x, 0.5 + halfOpeningT),
    z: THREE.MathUtils.lerp(a.z, b.z, 0.5 + halfOpeningT),
  };
  addFenceSpan(group, a, openingStart, getHeightAt, interiorTarget, seed ^ 0x6c8e9cf5);
  addFenceSpan(group, openingEnd, b, getHeightAt, interiorTarget, seed ^ 0x31f29c45);
}

function pastureSurface(
  corners: FarmFieldCorners,
  getHeightAt: (x: number, z: number) => number,
  herd: LivestockHerdState | undefined,
): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners.flatMap((point) => [
    point.x,
    getHeightAt(point.x, point.z) + 0.035,
    point.z,
  ]), 3));
  geometry.setIndex([0, 3, 1, 1, 3, 2]);
  geometry.computeVertexNormals();
  const material = herd?.species === 'swine'
    ? PANNAGE_GROUND
    : herd?.species === 'sheep'
      ? SHEEP_GRASS
      : CATTLE_GRASS;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.fpNoCollision = true;
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  return mesh;
}

function disposePastureGroup(group: THREE.Group): void {
  group.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry !== POST_GEOMETRY && mesh.geometry !== RAIL_GEOMETRY) mesh.geometry.dispose();
  });
  group.clear();
}

export class PastureMarkers {
  private readonly root = new THREE.Group();
  private readonly groups = new Map<string, THREE.Group>();
  private lastSignature = '';
  private readonly getHeightAt: (x: number, z: number) => number;

  constructor(
    parent: THREE.Group,
    getHeightAt: (x: number, z: number) => number,
  ) {
    this.getHeightAt = getHeightAt;
    this.root.name = 'Fenced pastures';
    parent.add(this.root);
  }

  syncPastures(
    pastures: Iterable<PastureState>,
    herds: Map<string, LivestockHerdState>,
  ): void {
    const list = [...pastures];
    const signature = list.map((pasture) => {
      const herd = herds.get(pasture.id);
      return `${pasture.id}:${herd?.species ?? 'none'}:${pasture.corners.map((point) => `${point.x.toFixed(2)},${point.z.toFixed(2)}`).join(';')}`;
    }).join('|');
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    for (const group of this.groups.values()) disposePastureGroup(group);
    this.groups.clear();
    this.root.clear();
    for (const pasture of list) {
      const corners = pasture.corners as FarmFieldCorners;
      const center = corners.reduce(
        (sum, point) => ({ x: sum.x + point.x * 0.25, z: sum.z + point.z * 0.25 }),
        { x: 0, z: 0 },
      );
      const parcelSeed = hashParcelSeed(pasture.id);
      const group = new THREE.Group();
      group.name = `Pasture ${pasture.id}`;
      group.userData.pastureId = pasture.id;
      group.add(pastureSurface(corners, this.getHeightAt, herds.get(pasture.id)));
      for (let edge = 0; edge < 4; edge++) {
        addFenceEdge(
          group,
          corners[edge],
          corners[(edge + 1) % 4],
          this.getHeightAt,
          center,
          parcelSeed ^ Math.imul(edge + 1, 0x45d9f3b),
          edge === 0 ? PASTURE_GATE_WIDTH_M : 0,
        );
      }
      this.root.add(group);
      this.groups.set(pasture.id, group);
    }
  }

  dispose(): void {
    for (const group of this.groups.values()) disposePastureGroup(group);
    this.groups.clear();
    this.root.removeFromParent();
  }
}
