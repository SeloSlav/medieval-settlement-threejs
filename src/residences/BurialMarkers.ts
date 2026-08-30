import * as THREE from 'three';
import { timberMaterial } from '../buildings/buildingMaterials.ts';
import type { CorpseState, GraveyardState } from '../resources/types.ts';
import { disposeObject3D } from '../utils/dispose.ts';
import type { Point2 } from '../utils/polygonGeometry.ts';
import {
  BURGAGE_WOOD_FENCE_STYLE,
  createBurgageFenceBoxGeometry,
  sampleTerrainFenceBays,
} from './BurgageFencing.ts';
import { visibleGraveSitePlacements } from './graveyardLayout.ts';

const CART_FORWARD_EPSILON_SQ = 0.0025;
const LOCAL_FENCE_RAIL_AXIS = new THREE.Vector3(0, 0, 1);

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

type GraveyardFenceRun = readonly [Point2, Point2];

function splitFenceEdgeAroundOpening(start: Point2, end: Point2): GraveyardFenceRun[] {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  if (length < 0.5) return [];

  const openingWidth = Math.min(BURGAGE_WOOD_FENCE_STYLE.openingWidth, length * 0.42);
  const halfOpeningFraction = openingWidth / length * 0.5;
  const openingStartT = 0.5 - halfOpeningFraction;
  const openingEndT = 0.5 + halfOpeningFraction;
  return [
    [start, { x: start.x + dx * openingStartT, z: start.z + dz * openingStartT }],
    [{ x: start.x + dx * openingEndT, z: start.z + dz * openingEndT }, end],
  ];
}

function createGraveyardFence(
  graveyard: GraveyardState,
  getHeightAt: (x: number, z: number) => number,
): THREE.Group {
  const fence = new THREE.Group();
  fence.name = 'Graveyard wooden fencing';
  fence.userData.openingCount = 4;
  fence.userData.openingWidth = BURGAGE_WOOD_FENCE_STYLE.openingWidth;
  fence.userData.hasLintels = false;

  const runs: GraveyardFenceRun[] = [];
  for (let edge = 0; edge < 4; edge += 1) {
    const start = graveyard.corners[edge];
    const end = graveyard.corners[(edge + 1) % 4];
    runs.push(...splitFenceEdgeAroundOpening(start, end));
  }
  const bayRuns = runs
    .map(([start, end]) => sampleTerrainFenceBays(start, end, getHeightAt))
    .filter((bays) => bays.length > 0);

  const uniquePosts = new Map<string, { point: Point2; groundHeight: number }>();
  let railCount = 0;
  for (const bays of bayRuns) {
    const first = bays[0];
    uniquePosts.set(
      `${first.start.x.toFixed(5)},${first.start.z.toFixed(5)}`,
      { point: first.start, groundHeight: first.startGroundHeight },
    );
    for (const bay of bays) {
      uniquePosts.set(
        `${bay.end.x.toFixed(5)},${bay.end.z.toFixed(5)}`,
        { point: bay.end, groundHeight: bay.endGroundHeight },
      );
      railCount += BURGAGE_WOOD_FENCE_STYLE.railHeights.length;
    }
  }

  const fenceMaterial = timberMaterial('mid');
  const posts = new THREE.InstancedMesh(
    createBurgageFenceBoxGeometry(),
    fenceMaterial,
    uniquePosts.size,
  );
  posts.name = 'Graveyard boundary posts';
  posts.castShadow = false;
  posts.receiveShadow = false;
  posts.frustumCulled = false;

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const postMeshHeight = (
    BURGAGE_WOOD_FENCE_STYLE.postHeight + BURGAGE_WOOD_FENCE_STYLE.postBuryDepth
  );
  let postIndex = 0;
  for (const { point, groundHeight } of uniquePosts.values()) {
    position.set(
      point.x,
      groundHeight + (
        BURGAGE_WOOD_FENCE_STYLE.postHeight - BURGAGE_WOOD_FENCE_STYLE.postBuryDepth
      ) * 0.5,
      point.z,
    );
    quaternion.identity();
    scale.set(
      BURGAGE_WOOD_FENCE_STYLE.postWidth,
      postMeshHeight,
      BURGAGE_WOOD_FENCE_STYLE.postWidth,
    );
    matrix.compose(position, quaternion, scale);
    posts.setMatrixAt(postIndex, matrix);
    postIndex += 1;
  }
  posts.instanceMatrix.needsUpdate = true;

  const rails = new THREE.InstancedMesh(
    createBurgageFenceBoxGeometry(),
    fenceMaterial,
    railCount,
  );
  rails.name = 'Graveyard boundary rails';
  rails.castShadow = false;
  rails.receiveShadow = false;
  rails.frustumCulled = false;

  const railDirection = new THREE.Vector3();
  let railIndex = 0;
  for (const bays of bayRuns) {
    for (const bay of bays) {
      railDirection.set(
        bay.end.x - bay.start.x,
        bay.endGroundHeight - bay.startGroundHeight,
        bay.end.z - bay.start.z,
      );
      const railLength = railDirection.length();
      if (railLength <= 1e-6) continue;
      quaternion.setFromUnitVectors(
        LOCAL_FENCE_RAIL_AXIS,
        railDirection.multiplyScalar(1 / railLength),
      );
      position.set(
        (bay.start.x + bay.end.x) * 0.5,
        (bay.startGroundHeight + bay.endGroundHeight) * 0.5,
        (bay.start.z + bay.end.z) * 0.5,
      );
      for (const railHeight of BURGAGE_WOOD_FENCE_STYLE.railHeights) {
        position.y = (
          (bay.startGroundHeight + bay.endGroundHeight) * 0.5
          + BURGAGE_WOOD_FENCE_STYLE.terrainLift
          + railHeight
        );
        scale.set(
          BURGAGE_WOOD_FENCE_STYLE.railWidth,
          BURGAGE_WOOD_FENCE_STYLE.railHeight,
          railLength + BURGAGE_WOOD_FENCE_STYLE.railEndOverlap,
        );
        matrix.compose(position, quaternion, scale);
        rails.setMatrixAt(railIndex, matrix);
        railIndex += 1;
      }
    }
  }
  rails.instanceMatrix.needsUpdate = true;

  fence.add(posts, rails);
  return fence;
}

function createGraveyard(
  graveyard: GraveyardState,
  getHeightAt: (x: number, z: number) => number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = `Graveyard ${graveyard.id}`;
  group.add(createGraveyardFence(graveyard, getHeightAt));

  const graveSites = visibleGraveSitePlacements(graveyard);
  const visible = graveSites.length;
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

    for (let index = 0; index < graveSites.length; index += 1) {
      const site = graveSites[index]!;
      const moundY = getHeightAt(site.x, site.z);
      setInstance(mounds, index, site.x, moundY + 0.08, site.z, site.yaw);

      const headY = getHeightAt(site.headX, site.headZ);
      setInstance(heads, index, site.headX, headY + 0.36, site.headZ, site.yaw);
      setInstance(arms, index, site.headX, headY + 0.49, site.headZ, site.yaw);
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
      color: cause === 3 ? 0x65504a : cause === 1 ? 0x706e60 : 0x827a67,
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
  // Violent deaths keep the actual villager rig visible in its clamped fall
  // pose until collection. Other causes use the lightweight shrouded marker.
  groundBody.visible = corpse.cause !== 3 && corpse.state <= 1;
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
