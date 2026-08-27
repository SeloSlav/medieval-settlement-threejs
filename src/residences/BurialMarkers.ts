import * as THREE from 'three';
import type { CorpseState, GraveyardState } from '../resources/types.ts';
import { disposeObject3D } from '../utils/dispose.ts';

const MAX_VISIBLE_GRAVES = 180;
const CART_FORWARD_EPSILON_SQ = 0.0025;

function bilinear(
  corners: GraveyardState['corners'],
  u: number,
  v: number,
): { x: number; z: number } {
  const topX = corners[0].x + (corners[1].x - corners[0].x) * u;
  const topZ = corners[0].z + (corners[1].z - corners[0].z) * u;
  const bottomX = corners[3].x + (corners[2].x - corners[3].x) * u;
  const bottomZ = corners[3].z + (corners[2].z - corners[3].z) * u;
  return {
    x: topX + (bottomX - topX) * v,
    z: topZ + (bottomZ - topZ) * v,
  };
}

function setInstance(
  mesh: THREE.InstancedMesh,
  index: number,
  x: number,
  y: number,
  z: number,
  yaw = 0,
): void {
  const matrix = new THREE.Matrix4();
  matrix.compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    new THREE.Vector3(1, 1, 1),
  );
  mesh.setMatrixAt(index, matrix);
}

function createGraveyard(
  graveyard: GraveyardState,
  getHeightAt: (x: number, z: number) => number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = `Graveyard ${graveyard.id}`;
  const postTransforms: Array<[number, number, number]> = [];
  for (let edge = 0; edge < 4; edge += 1) {
    const start = graveyard.corners[edge];
    const end = graveyard.corners[(edge + 1) % 4];
    const distance = Math.hypot(end.x - start.x, end.z - start.z);
    const segments = Math.max(1, Math.ceil(distance / 3.2));
    for (let index = 0; index <= segments; index += 1) {
      const t = index / segments;
      const x = start.x + (end.x - start.x) * t;
      const z = start.z + (end.z - start.z) * t;
      postTransforms.push([x, getHeightAt(x, z) + 0.28, z]);
    }
  }
  const posts = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.11, 0.55, 0.11),
    new THREE.MeshStandardMaterial({ color: 0x716248, roughness: 1 }),
    postTransforms.length,
  );
  posts.name = 'Graveyard boundary posts';
  posts.castShadow = true;
  postTransforms.forEach(([x, y, z], index) => setInstance(posts, index, x, y, z));
  posts.instanceMatrix.needsUpdate = true;
  group.add(posts);

  const visible = Math.min(graveyard.burials, MAX_VISIBLE_GRAVES);
  if (visible > 0) {
    const mounds = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.48, 0.09, 1.05),
      new THREE.MeshStandardMaterial({ color: 0x534632, roughness: 1 }),
      visible,
    );
    const heads = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.16, 0.62, 0.09),
      new THREE.MeshStandardMaterial({ color: 0x8b846f, roughness: 0.96 }),
      visible,
    );
    const arms = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.42, 0.11, 0.09),
      new THREE.MeshStandardMaterial({ color: 0x8b846f, roughness: 0.96 }),
      visible,
    );
    mounds.name = 'Instanced grave mounds';
    heads.name = 'Instanced grave markers';
    arms.name = 'Instanced grave crosses';
    heads.castShadow = true;
    arms.castShadow = true;

    const columns = Math.max(
      2,
      Math.floor(Math.sqrt(Math.max(1, graveyard.capacity) * 1.45)),
    );
    const rows = Math.max(1, Math.ceil(graveyard.capacity / columns));
    for (let index = 0; index < visible; index += 1) {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const u = (column + 0.5) / columns;
      const v = (row + 0.5) / rows;
      const point = bilinear(graveyard.corners, 0.08 + u * 0.84, 0.08 + v * 0.84);
      const next = bilinear(
        graveyard.corners,
        0.08 + u * 0.84,
        Math.min(0.92, 0.08 + v * 0.84 + 0.02),
      );
      const rowLength = Math.max(1e-6, Math.hypot(next.x - point.x, next.z - point.z));
      const rowX = (next.x - point.x) / rowLength;
      const rowZ = (next.z - point.z) / rowLength;
      const yaw = Math.atan2(rowX, rowZ);
      const moundY = getHeightAt(point.x, point.z);
      setInstance(mounds, index, point.x, moundY + 0.08, point.z, yaw);

      const headX = point.x - rowX * 0.38;
      const headZ = point.z - rowZ * 0.38;
      const headY = getHeightAt(headX, headZ);
      setInstance(heads, index, headX, headY + 0.36, headZ, yaw);
      setInstance(arms, index, headX, headY + 0.49, headZ, yaw);
    }
    mounds.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    arms.instanceMatrix.needsUpdate = true;
    group.add(mounds, heads, arms);
  }

  group.userData.burials = graveyard.burials;
  group.userData.capacity = graveyard.capacity;
  return group;
}

function createShroudedBody(cause: CorpseState['cause']): THREE.Group {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.23, 0.78, 4, 8),
    new THREE.MeshStandardMaterial({
      color: cause === 1 ? 0x706e60 : 0x827a67,
      roughness: 1,
    }),
  );
  body.name = 'Shrouded body';
  body.rotation.z = Math.PI / 2;
  body.position.y = 0.25;
  group.add(body);
  return group;
}

function createGravediggerCart(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Gravedigger handcart and attendant';
  const timber = new THREE.MeshStandardMaterial({ color: 0x5b3821, roughness: 1 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x2f241a, roughness: 1 });
  const wool = new THREE.MeshStandardMaterial({ color: 0x453f35, roughness: 1 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xa97b5a, roughness: 1 });

  const bed = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.16, 0.62), timber);
  bed.position.y = 0.36;
  group.add(bed);
  for (const side of [-1, 1]) {
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.055, 6, 12), iron);
    wheel.position.set(0, 0.28, side * 0.39);
    group.add(wheel);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.055, 0.055), timber);
    handle.position.set(-1.03, 0.43, side * 0.24);
    handle.rotation.z = -0.08;
    group.add(handle);
  }

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.27, 0.72, 8), wool);
  torso.position.set(-1.38, 1.08, 0);
  group.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), skin);
  head.position.set(-1.38, 1.58, 0);
  group.add(head);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.62, 6), wool);
    leg.position.set(-1.38, 0.47, side * 0.1);
    leg.rotation.z = side * 0.08;
    group.add(leg);
  }
  return group;
}

function createCorpseMarker(corpse: CorpseState): THREE.Group {
  const group = new THREE.Group();
  group.name = `Corpse ${corpse.id}`;
  const groundBody = createShroudedBody(corpse.cause);
  groundBody.name = 'Body awaiting collection';
  const cart = createGravediggerCart();
  const cartBody = createShroudedBody(corpse.cause);
  cartBody.name = 'Body on gravedigger cart';
  cartBody.position.set(0.1, 0.3, 0);
  cart.add(cartBody);
  group.add(groundBody, cart);
  group.userData.groundBody = groundBody;
  group.userData.cart = cart;
  group.userData.cartBody = cartBody;
  group.userData.cause = corpse.cause;
  return group;
}

function syncCorpseMarker(
  marker: THREE.Group,
  corpse: CorpseState,
  getHeightAt: (x: number, z: number) => number,
): void {
  const groundBody = marker.userData.groundBody as THREE.Group;
  const cart = marker.userData.cart as THREE.Group;
  const cartBody = marker.userData.cartBody as THREE.Group;
  groundBody.visible = corpse.state <= 1;
  cart.visible = corpse.state >= 1;
  cartBody.visible = corpse.state === 2;
  groundBody.position.set(
    corpse.x,
    getHeightAt(corpse.x, corpse.z) + 0.03,
    corpse.z,
  );

  const cartX = corpse.state === 0 ? corpse.x : corpse.cartX;
  const cartZ = corpse.state === 0 ? corpse.z : corpse.cartZ;
  const lastCartX = Number(marker.userData.lastCartX);
  const lastCartZ = Number(marker.userData.lastCartZ);
  if (
    Number.isFinite(lastCartX)
    && Number.isFinite(lastCartZ)
    && (cartX - lastCartX) ** 2 + (cartZ - lastCartZ) ** 2 > CART_FORWARD_EPSILON_SQ
  ) {
    cart.rotation.y = -Math.atan2(cartZ - lastCartZ, cartX - lastCartX);
  }
  cart.position.set(cartX, getHeightAt(cartX, cartZ) + 0.03, cartZ);
  marker.userData.lastCartX = cartX;
  marker.userData.lastCartZ = cartZ;
  marker.userData.transportState = corpse.state;
}

export class BurialMarkers {
  private readonly root: THREE.Group;
  private readonly graveyards = new Map<string, THREE.Group>();
  private readonly corpses = new Map<string, THREE.Group>();

  constructor(parent: THREE.Group) {
    this.root = new THREE.Group();
    this.root.name = 'Burial grounds and corpse carts';
    parent.add(this.root);
  }

  sync(
    graveyards: Iterable<GraveyardState>,
    corpses: Iterable<CorpseState>,
    getHeightAt: (x: number, z: number) => number,
  ): void {
    const nextGraveyards = new Set<string>();
    for (const graveyard of graveyards) {
      nextGraveyards.add(graveyard.id);
      let marker = this.graveyards.get(graveyard.id);
      if (
        !marker
        || marker.userData.burials !== graveyard.burials
        || marker.userData.capacity !== graveyard.capacity
      ) {
        if (marker) {
          this.root.remove(marker);
          disposeObject3D(marker);
        }
        marker = createGraveyard(graveyard, getHeightAt);
        this.root.add(marker);
        this.graveyards.set(graveyard.id, marker);
      }
    }
    for (const [id, marker] of this.graveyards) {
      if (nextGraveyards.has(id)) continue;
      this.root.remove(marker);
      disposeObject3D(marker);
      this.graveyards.delete(id);
    }

    const nextCorpses = new Set<string>();
    for (const corpse of corpses) {
      nextCorpses.add(corpse.id);
      let marker = this.corpses.get(corpse.id);
      if (!marker || marker.userData.cause !== corpse.cause) {
        if (marker) {
          this.root.remove(marker);
          disposeObject3D(marker);
        }
        marker = createCorpseMarker(corpse);
        this.root.add(marker);
        this.corpses.set(corpse.id, marker);
      }
      syncCorpseMarker(marker, corpse, getHeightAt);
    }
    for (const [id, marker] of this.corpses) {
      if (nextCorpses.has(id)) continue;
      this.root.remove(marker);
      disposeObject3D(marker);
      this.corpses.delete(id);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    disposeObject3D(this.root);
    this.graveyards.clear();
    this.corpses.clear();
  }
}
