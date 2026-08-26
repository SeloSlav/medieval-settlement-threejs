import * as THREE from 'three';
import type { TreeLayoutEntry, TreePhase } from '../../resources/types.ts';
import type { TreeRegistry } from '../../resources/TreeRegistry.ts';
import {
  routeAgentPolyline,
  routeAgentPolylineWithDeferredObstacle,
} from '../../settlement/agentNavigation.ts';
import type { PointXZ, RockObstacle } from '../../utils/pathGeometry.ts';
import type { FpWalkProbePhase } from './fpAirborneWalkPolicy.ts';

const STATIC_CELL_SIZE_M = 8;
const PREPARE_RADIUS_M = 9;
const ROCK_QUERY_RADIUS_M = 12;
const PLAYER_COLLISION_SKIN_M = 0.012;
const LANDING_LIP_M = 0.16;
const MAX_RESOLVE_ITERATIONS = 3;

type TreeCollisionState = {
  phase: TreePhase;
  growthProgress: number;
};

export type FpCollisionWorldConfig = {
  getStaticRoots: () => readonly THREE.Object3D[];
  getHeightAt: (x: number, z: number) => number;
  getRockObstaclesNear?: (x: number, z: number, radius: number) => readonly RockObstacle[];
  getRockObstaclesNearInto?: (
    x: number,
    z: number,
    radius: number,
    results: RockObstacle[],
  ) => readonly RockObstacle[];
  getRockStateVersion?: () => unknown;
  getTreeRegistry?: () => TreeRegistry | null;
  getTreeState?: (treeId: string) => TreeCollisionState | undefined;
  getTreeStateVersion?: () => unknown;
  getTreeActivityVersion?: () => unknown;
  isTreeLayoutActive?: (layoutIndex: number) => boolean;
  /** Extra non-mesh hazards used by crowd routing, such as open water. */
  isAgentNavigationBlocked?: (x: number, z: number, radius: number) => boolean;
  /** Cheap conservative broad phase for the extra crowd-navigation hazard. */
  mayAgentNavigationPathBeBlocked?: (
    path: readonly PointXZ[],
    radius: number,
  ) => boolean;
};

export type FpBoxCollider = {
  shape: 'box';
  centerX: number;
  centerZ: number;
  halfX: number;
  halfZ: number;
  yaw: number;
  /** Cached once with the static collider so hot movement/path probes avoid trig. */
  cosYaw?: number;
  sinYaw?: number;
  minY: number;
  maxY: number;
  allowStep?: boolean;
  /** Bridge rails can reduce body padding while retaining their physical box. */
  playerRadiusScale?: number;
};

export type FpCylinderCollider = {
  shape: 'cylinder';
  x: number;
  z: number;
  radius: number;
  minY: number;
  maxY: number;
  allowStep?: boolean;
  playerRadiusScale?: number;
};

export type FpCollider = FpBoxCollider | FpCylinderCollider;

type ResolvePlayerOptions = {
  bodyHeight: number;
  footRadius: number;
  maxStepHeight: number;
  grounded: boolean;
};

const _worldBox = new THREE.Box3();
const _localBox = new THREE.Box3();
const _geometryBox = new THREE.Box3();
const _instanceMatrix = new THREE.Matrix4();
const _worldMatrix = new THREE.Matrix4();
const _relativeMatrix = new THREE.Matrix4();
const _inverseRootMatrix = new THREE.Matrix4();
const _center = new THREE.Vector3();
const _size = new THREE.Vector3();
const _worldScale = new THREE.Vector3();
const _worldQuaternion = new THREE.Quaternion();
const _worldPosition = new THREE.Vector3();
const _localXAxis = new THREE.Vector3();

/**
 * Client-only first-person collision cache.
 *
 * Static settlement geometry is reduced to simple boxes only when invalidated.
 * Each movement frame then queries a small spatial-hash neighborhood and adds
 * nearby tree/rock cylinders, keeping the hot path independent of world size.
 */
export class FpCollisionWorld {
  private readonly config: FpCollisionWorldConfig;
  private readonly staticIndex = new StaticColliderIndex();
  private readonly nearby: FpCollider[] = [];
  private readonly dynamicColliders: FpCylinderCollider[] = [];
  private readonly nearbyRocks: RockObstacle[] = [];
  private readonly nearbyTrees: TreeLayoutEntry[] = [];
  private dynamicColliderCount = 0;
  private lastPrepareX = Number.NaN;
  private lastPrepareZ = Number.NaN;
  private lastTreeRegistry: TreeRegistry | null = null;
  private lastRockStateVersion: unknown;
  private lastTreeStateVersion: unknown;
  private lastTreeActivityVersion: unknown;
  private hasPreparedDynamic = false;
  private staticDirty = true;

  constructor(config: FpCollisionWorldConfig) {
    this.config = config;
  }

  invalidateStatic(): void {
    this.staticDirty = true;
  }

  /**
   * Builds a lightweight crowd route around the same static buildings and
   * fences used by first-person collision.
   */
  routeAgentPath(
    path: readonly PointXZ[],
    radius = 0.28,
  ): PointXZ[] | null {
    if (this.staticDirty) this.rebuildStaticIndex();
    const isStaticBlocked = (x: number, z: number): boolean =>
      this.staticIndex.diskOverlaps(x, z, radius);
    const isNavigationBlocked = this.config.isAgentNavigationBlocked;
    if (!isNavigationBlocked) return routeAgentPolyline(path, isStaticBlocked);
    const mayNavigationPathBeBlocked = this.config.mayAgentNavigationPathBeBlocked;
    return routeAgentPolylineWithDeferredObstacle(
      path,
      isStaticBlocked,
      (x, z) => isNavigationBlocked(x, z, radius),
      mayNavigationPathBeBlocked
        ? (candidate) => mayNavigationPathBeBlocked(candidate, radius)
        : undefined,
    );
  }

  prepare(x: number, z: number): void {
    const staticWasDirty = this.staticDirty;
    if (staticWasDirty) this.rebuildStaticIndex();

    const treeRegistry = this.config.getTreeRegistry?.() ?? null;
    const rockStateVersion = this.config.getRockStateVersion?.();
    const treeStateVersion = this.config.getTreeStateVersion?.();
    const treeActivityVersion = this.config.getTreeActivityVersion?.();
    const versionsAvailable = rockStateVersion !== undefined
      && treeStateVersion !== undefined
      && treeActivityVersion !== undefined;
    if (
      !staticWasDirty
      && versionsAvailable
      && this.hasPreparedDynamic
      && x === this.lastPrepareX
      && z === this.lastPrepareZ
      && treeRegistry === this.lastTreeRegistry
      && Object.is(rockStateVersion, this.lastRockStateVersion)
      && Object.is(treeStateVersion, this.lastTreeStateVersion)
      && Object.is(treeActivityVersion, this.lastTreeActivityVersion)
    ) {
      return;
    }

    this.nearby.length = 0;
    this.dynamicColliderCount = 0;
    this.staticIndex.queryCircleInto(x, z, PREPARE_RADIUS_M, this.nearby);
    this.appendNearbyRocks(x, z);
    this.appendNearbyTrees(x, z, treeRegistry);
    this.lastPrepareX = x;
    this.lastPrepareZ = z;
    this.lastTreeRegistry = treeRegistry;
    this.lastRockStateVersion = rockStateVersion;
    this.lastTreeStateVersion = treeStateVersion;
    this.lastTreeActivityVersion = treeActivityVersion;
    this.hasPreparedDynamic = versionsAvailable;
  }

  sampleSupportTopY(
    x: number,
    z: number,
    probeTopY: number,
    footY: number,
    footRadius: number,
    maxStepHeight: number,
    phase: FpWalkProbePhase,
  ): number {
    const highestAllowed = phase === 'ground'
      ? Math.min(probeTopY, footY + maxStepHeight)
      : probeTopY;
    let top = Number.NEGATIVE_INFINITY;

    for (const collider of this.nearby) {
      if (
        collider.maxY > highestAllowed + PLAYER_COLLISION_SKIN_M
        || collider.maxY <= top
        || (phase === 'ground' && collider.allowStep === false)
      ) {
        continue;
      }
      if (diskOverlapsCollider(x, z, playerRadiusForCollider(footRadius, collider), collider)) {
        top = collider.maxY;
      }
    }

    return top;
  }

  resolvePlayer(
    position: THREE.Vector3,
    previousX: number,
    previousZ: number,
    velocity: THREE.Vector3,
    options: ResolvePlayerOptions,
  ): void {
    for (let iteration = 0; iteration < MAX_RESOLVE_ITERATIONS; iteration++) {
      let resolvedAny = false;
      for (const collider of this.nearby) {
        if (!bodyOverlapsVertically(position.y, velocity.y, collider, options)) continue;
        const playerRadius = playerRadiusForCollider(options.footRadius, collider);
        const resolved = collider.shape === 'box'
          ? resolveBoxCollision(
              position,
              previousX,
              previousZ,
              velocity,
              playerRadius,
              collider,
            )
          : resolveCylinderCollision(position, velocity, playerRadius, collider);
        resolvedAny = resolvedAny || resolved;
      }
      if (!resolvedAny) break;
    }
  }

  private rebuildStaticIndex(): void {
    this.staticIndex.clear();
    for (const root of this.config.getStaticRoots()) {
      root.updateWorldMatrix(true, true);
      appendRootColliders(root, this.staticIndex);
    }
    this.staticDirty = false;
  }

  private appendNearbyRocks(x: number, z: number): void {
    const rocks = this.config.getRockObstaclesNearInto
      ? this.config.getRockObstaclesNearInto(
          x,
          z,
          ROCK_QUERY_RADIUS_M,
          this.nearbyRocks,
        )
      : this.config.getRockObstaclesNear?.(x, z, ROCK_QUERY_RADIUS_M);
    if (!rocks) return;

    for (const rock of rocks) {
      const radius = Math.max(
        0.28,
        rock.collisionRadius ?? rock.scale * 1.25,
      );
      const terrainY = this.config.getHeightAt(rock.x, rock.z);
      const minY = rock.collisionMinY ?? terrainY;
      const maxY = rock.collisionMaxY ?? terrainY + Math.max(0.24, rock.scale * 0.92);
      if (maxY <= minY + 0.02) continue;
      this.appendDynamicCollider(rock.x, rock.z, radius, minY, maxY);
    }
  }

  private appendNearbyTrees(
    x: number,
    z: number,
    registry: TreeRegistry | null,
  ): void {
    if (!registry) return;

    const trees = registry.treesInRadiusInto(
      x,
      z,
      ROCK_QUERY_RADIUS_M,
      this.nearbyTrees,
    );
    for (const tree of trees) {
      if (this.config.isTreeLayoutActive && !this.config.isTreeLayoutActive(tree.layoutIndex)) {
        continue;
      }
      const state = this.config.getTreeState?.(tree.id);
      if (!state) continue;

      const terrainY = this.config.getHeightAt(tree.x, tree.z);
      if (state.phase === 'stump') {
        this.appendDynamicCollider(
          tree.x,
          tree.z,
          Math.max(0.2, tree.scale * 0.34),
          terrainY,
          terrainY + Math.max(0.22, tree.scale * 0.42),
          true,
        );
        continue;
      }

      if (state.phase === 'growing') {
        const growth = THREE.MathUtils.clamp(state.growthProgress, 0, 1);
        this.appendDynamicCollider(
          tree.x,
          tree.z,
          Math.max(0.13, tree.scale * THREE.MathUtils.lerp(0.12, 0.3, growth)),
          terrainY,
          terrainY + Math.max(0.45, tree.scale * THREE.MathUtils.lerp(0.8, 5.2, growth)),
          false,
        );
        continue;
      }

      const formScale = tree.form === 'young' || tree.form === 'midstory' ? 0.72 : 1;
      this.appendDynamicCollider(
        tree.x,
        tree.z,
        Math.max(0.2, tree.scale * 0.36 * formScale),
        terrainY,
        terrainY + Math.max(4, tree.scale * 12 * formScale),
        false,
      );
    }
  }

  private appendDynamicCollider(
    x: number,
    z: number,
    radius: number,
    minY: number,
    maxY: number,
    allowStep?: boolean,
  ): void {
    let collider = this.dynamicColliders[this.dynamicColliderCount];
    if (!collider) {
      collider = {
        shape: 'cylinder',
        x,
        z,
        radius,
        minY,
        maxY,
        allowStep,
      };
      this.dynamicColliders.push(collider);
    } else {
      collider.x = x;
      collider.z = z;
      collider.radius = radius;
      collider.minY = minY;
      collider.maxY = maxY;
      collider.allowStep = allowStep;
    }
    this.dynamicColliderCount += 1;
    this.nearby.push(collider);
  }
}

class StaticColliderIndex {
  private readonly cells = new Map<number, Map<number, FpCollider[]>>();
  private readonly querySeen = new Set<FpCollider>();

  clear(): void {
    this.cells.clear();
  }

  add(collider: FpCollider): void {
    const bounds = colliderBoundsXZ(collider);
    const minCellX = Math.floor(bounds.minX / STATIC_CELL_SIZE_M);
    const maxCellX = Math.floor(bounds.maxX / STATIC_CELL_SIZE_M);
    const minCellZ = Math.floor(bounds.minZ / STATIC_CELL_SIZE_M);
    const maxCellZ = Math.floor(bounds.maxZ / STATIC_CELL_SIZE_M);
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      let row = this.cells.get(cellX);
      if (!row) {
        row = new Map();
        this.cells.set(cellX, row);
      }
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
        const bucket = row.get(cellZ);
        if (bucket) bucket.push(collider);
        else row.set(cellZ, [collider]);
      }
    }
  }

  queryCircleInto(x: number, z: number, radius: number, out: FpCollider[]): void {
    const minCellX = Math.floor((x - radius) / STATIC_CELL_SIZE_M);
    const maxCellX = Math.floor((x + radius) / STATIC_CELL_SIZE_M);
    const minCellZ = Math.floor((z - radius) / STATIC_CELL_SIZE_M);
    const maxCellZ = Math.floor((z + radius) / STATIC_CELL_SIZE_M);
    this.querySeen.clear();
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      const row = this.cells.get(cellX);
      if (!row) continue;
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
        const bucket = row.get(cellZ);
        if (!bucket) continue;
        for (const collider of bucket) {
          if (this.querySeen.has(collider)) continue;
          this.querySeen.add(collider);
          out.push(collider);
        }
      }
    }
  }

  diskOverlaps(x: number, z: number, radius: number): boolean {
    const minCellX = Math.floor((x - radius) / STATIC_CELL_SIZE_M);
    const maxCellX = Math.floor((x + radius) / STATIC_CELL_SIZE_M);
    const minCellZ = Math.floor((z - radius) / STATIC_CELL_SIZE_M);
    const maxCellZ = Math.floor((z + radius) / STATIC_CELL_SIZE_M);
    this.querySeen.clear();
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      const row = this.cells.get(cellX);
      if (!row) continue;
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
        const bucket = row.get(cellZ);
        if (!bucket) continue;
        for (const collider of bucket) {
          if (this.querySeen.has(collider)) continue;
          this.querySeen.add(collider);
          if (diskOverlapsCollider(x, z, radius, collider)) return true;
        }
      }
    }
    return false;
  }
}

function appendRootColliders(root: THREE.Object3D, index: StaticColliderIndex): void {
  if (!isCollisionVisible(root)) return;

  if (root.name === 'Building markers' || root.name === 'Residences') {
    for (const child of root.children) {
      if (child.userData.fpCollisionAggregate === true && isCollisionVisible(child)) {
        const collider = aggregateObjectCollider(child, false);
        if (collider) index.add(collider);
      } else if (
        child.userData.fpCollisionChildrenOnly === true
        && isCollisionVisible(child)
      ) {
        appendExplicitAggregateColliders(child, index);
      }
    }
    return;
  }

  const allowStep = root.name !== 'Burgage fencing' && root.name !== 'Fenced pastures';
  appendObjectColliders(root, index, allowStep);
}

function appendExplicitAggregateColliders(
  object: THREE.Object3D,
  index: StaticColliderIndex,
): void {
  if (!isCollisionVisible(object) || shouldSkipObject(object)) return;
  if (object.userData.fpCollisionAggregate === true) {
    const collider = aggregateObjectCollider(object, false);
    if (collider) index.add(collider);
    return;
  }
  for (const child of object.children) {
    appendExplicitAggregateColliders(child, index);
  }
}

function appendObjectColliders(
  object: THREE.Object3D,
  index: StaticColliderIndex,
  allowStep: boolean,
  inheritedPlayerRadiusScale = 1,
): void {
  if (!isCollisionVisible(object) || shouldSkipObject(object)) return;
  const requestedPlayerRadiusScale = object.userData.fpPlayerRadiusScale;
  const playerRadiusScale = typeof requestedPlayerRadiusScale === 'number'
    ? THREE.MathUtils.clamp(requestedPlayerRadiusScale, 0.25, 1)
    : inheritedPlayerRadiusScale;
  const objectAllowsStep = (
    allowStep
    && object.userData.fpCollisionAllowStep !== false
    && !object.name.toLowerCase().includes('fence')
  );
  if (object.userData.fpCollisionAggregate === true) {
    const collider = aggregateObjectCollider(object, false, playerRadiusScale);
    if (collider) index.add(collider);
    return;
  }

  const mesh = object as THREE.Mesh;
  if (mesh.isMesh && mesh.geometry) {
    appendMeshColliders(mesh, index, objectAllowsStep, playerRadiusScale);
    return;
  }

  for (const child of object.children) {
    appendObjectColliders(child, index, objectAllowsStep, playerRadiusScale);
  }
}

function appendMeshColliders(
  mesh: THREE.Mesh,
  index: StaticColliderIndex,
  allowStep: boolean,
  playerRadiusScale: number,
): void {
  const geometry = mesh.geometry;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  if (!geometry.boundingBox) return;

  if (mesh instanceof THREE.InstancedMesh) {
    for (let instanceIndex = 0; instanceIndex < mesh.count; instanceIndex++) {
      mesh.getMatrixAt(instanceIndex, _instanceMatrix);
      if (matrixHasCollapsedScale(_instanceMatrix)) continue;
      _worldMatrix.multiplyMatrices(mesh.matrixWorld, _instanceMatrix);
      _worldBox.copy(geometry.boundingBox).applyMatrix4(_worldMatrix);
      const collider = worldAabbCollider(_worldBox, allowStep, playerRadiusScale);
      if (collider) index.add(collider);
    }
    return;
  }

  _worldBox.copy(geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
  const collider = worldAabbCollider(_worldBox, allowStep, playerRadiusScale);
  if (collider) index.add(collider);
}

function aggregateObjectCollider(
  root: THREE.Object3D,
  allowStep: boolean,
  playerRadiusScale = 1,
): FpBoxCollider | null {
  _localBox.makeEmpty();
  _inverseRootMatrix.copy(root.matrixWorld).invert();

  root.traverse((object) => {
    if (
      object === root
      || !isCollisionVisible(object)
      || shouldSkipObjectOrAncestor(object, root)
    ) {
      return;
    }
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geometry = mesh.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox) return;

    if (mesh instanceof THREE.InstancedMesh) {
      for (let instanceIndex = 0; instanceIndex < mesh.count; instanceIndex++) {
        mesh.getMatrixAt(instanceIndex, _instanceMatrix);
        if (matrixHasCollapsedScale(_instanceMatrix)) continue;
        _worldMatrix.multiplyMatrices(mesh.matrixWorld, _instanceMatrix);
        _relativeMatrix.multiplyMatrices(_inverseRootMatrix, _worldMatrix);
        _geometryBox.copy(geometry.boundingBox).applyMatrix4(_relativeMatrix);
        _localBox.union(_geometryBox);
      }
      return;
    }

    _relativeMatrix.multiplyMatrices(_inverseRootMatrix, mesh.matrixWorld);
    _geometryBox.copy(geometry.boundingBox).applyMatrix4(_relativeMatrix);
    _localBox.union(_geometryBox);
  });

  if (_localBox.isEmpty()) return null;
  _localBox.getCenter(_center);
  _localBox.getSize(_size);
  root.getWorldScale(_worldScale);
  root.getWorldQuaternion(_worldQuaternion);
  root.getWorldPosition(_worldPosition);

  const localCenterY = _center.y;
  _center.applyMatrix4(root.matrixWorld);
  _localXAxis.set(1, 0, 0).applyQuaternion(_worldQuaternion);
  const yaw = Math.atan2(-_localXAxis.z, _localXAxis.x);
  const halfY = Math.abs(_size.y * _worldScale.y) * 0.5;
  const worldCenterY = _worldPosition.y + localCenterY * _worldScale.y;

  return validateBoxCollider({
    shape: 'box',
    centerX: _center.x,
    centerZ: _center.z,
    halfX: Math.abs(_size.x * _worldScale.x) * 0.5,
    halfZ: Math.abs(_size.z * _worldScale.z) * 0.5,
    yaw,
    minY: worldCenterY - halfY,
    maxY: worldCenterY + halfY,
    allowStep,
    playerRadiusScale,
  });
}

function worldAabbCollider(
  box: THREE.Box3,
  allowStep: boolean,
  playerRadiusScale: number,
): FpBoxCollider | null {
  box.getCenter(_center);
  box.getSize(_size);
  return validateBoxCollider({
    shape: 'box',
    centerX: _center.x,
    centerZ: _center.z,
    halfX: _size.x * 0.5,
    halfZ: _size.z * 0.5,
    yaw: 0,
    minY: box.min.y,
    maxY: box.max.y,
    allowStep,
    playerRadiusScale,
  });
}

function validateBoxCollider(collider: FpBoxCollider): FpBoxCollider | null {
  if (
    !Number.isFinite(collider.centerX)
    || !Number.isFinite(collider.centerZ)
    || !Number.isFinite(collider.minY)
    || !Number.isFinite(collider.maxY)
    || collider.halfX < 0.025
    || collider.halfZ < 0.025
    || collider.halfX > 55
    || collider.halfZ > 55
    || collider.maxY <= collider.minY + 0.015
  ) {
    return null;
  }
  collider.cosYaw = Math.cos(collider.yaw);
  collider.sinYaw = Math.sin(collider.yaw);
  collider.playerRadiusScale = THREE.MathUtils.clamp(
    collider.playerRadiusScale ?? 1,
    0.25,
    1,
  );
  return collider;
}

function playerRadiusForCollider(radius: number, collider: FpCollider): number {
  return radius * (collider.playerRadiusScale ?? 1);
}

function shouldSkipObject(object: THREE.Object3D): boolean {
  if (object.userData.fpNoCollision === true) return true;
  const name = object.name.toLowerCase();
  return name.includes('shadow')
    || name.includes('smoke')
    || name.includes('rigged roaming hen');
}

function shouldSkipObjectOrAncestor(
  object: THREE.Object3D,
  root: THREE.Object3D,
): boolean {
  let current: THREE.Object3D | null = object;
  while (current && current !== root) {
    if (shouldSkipObject(current)) return true;
    current = current.parent;
  }
  return false;
}

function isCollisionVisible(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

function matrixHasCollapsedScale(matrix: THREE.Matrix4): boolean {
  const elements = matrix.elements;
  const scaleXSq = elements[0] ** 2 + elements[1] ** 2 + elements[2] ** 2;
  const scaleYSq = elements[4] ** 2 + elements[5] ** 2 + elements[6] ** 2;
  const scaleZSq = elements[8] ** 2 + elements[9] ** 2 + elements[10] ** 2;
  return scaleXSq < 1e-8 || scaleYSq < 1e-8 || scaleZSq < 1e-8;
}

function colliderBoundsXZ(collider: FpCollider): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  if (collider.shape === 'cylinder') {
    return {
      minX: collider.x - collider.radius,
      maxX: collider.x + collider.radius,
      minZ: collider.z - collider.radius,
      maxZ: collider.z + collider.radius,
    };
  }

  const cos = Math.abs(collider.cosYaw ?? Math.cos(collider.yaw));
  const sin = Math.abs(collider.sinYaw ?? Math.sin(collider.yaw));
  const extentX = collider.halfX * cos + collider.halfZ * sin;
  const extentZ = collider.halfX * sin + collider.halfZ * cos;
  return {
    minX: collider.centerX - extentX,
    maxX: collider.centerX + extentX,
    minZ: collider.centerZ - extentZ,
    maxZ: collider.centerZ + extentZ,
  };
}

function diskOverlapsCollider(
  x: number,
  z: number,
  radius: number,
  collider: FpCollider,
): boolean {
  if (collider.shape === 'cylinder') {
    const combinedRadius = radius + collider.radius;
    return (x - collider.x) ** 2 + (z - collider.z) ** 2 <= combinedRadius ** 2;
  }

  const dx = x - collider.centerX;
  const dz = z - collider.centerZ;
  const cos = collider.cosYaw ?? Math.cos(collider.yaw);
  const sin = collider.sinYaw ?? Math.sin(collider.yaw);
  const localX = dx * cos - dz * sin;
  const localZ = dx * sin + dz * cos;
  const closestX = THREE.MathUtils.clamp(localX, -collider.halfX, collider.halfX);
  const closestZ = THREE.MathUtils.clamp(localZ, -collider.halfZ, collider.halfZ);
  return (localX - closestX) ** 2 + (localZ - closestZ) ** 2 <= radius ** 2;
}

function bodyOverlapsVertically(
  footY: number,
  verticalVelocity: number,
  collider: FpCollider,
  options: ResolvePlayerOptions,
): boolean {
  if (collider.minY >= footY + options.bodyHeight - PLAYER_COLLISION_SKIN_M) return false;
  if (collider.maxY <= footY + PLAYER_COLLISION_SKIN_M) return false;
  if (
    options.grounded
    && collider.allowStep !== false
    && collider.maxY <= footY + options.maxStepHeight
  ) {
    return false;
  }
  if (
    !options.grounded
    && verticalVelocity <= 0
    && collider.maxY <= footY + LANDING_LIP_M
  ) {
    return false;
  }
  return true;
}

function resolveCylinderCollision(
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  playerRadius: number,
  collider: FpCylinderCollider,
): boolean {
  const dx = position.x - collider.x;
  const dz = position.z - collider.z;
  const combinedRadius = playerRadius + collider.radius;
  const distanceSq = dx * dx + dz * dz;
  if (distanceSq >= combinedRadius * combinedRadius) return false;

  let normalX: number;
  let normalZ: number;
  let distance: number;
  if (distanceSq > 1e-10) {
    distance = Math.sqrt(distanceSq);
    normalX = dx / distance;
    normalZ = dz / distance;
  } else {
    distance = 0;
    const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
    normalX = horizontalSpeed > 1e-6 ? -velocity.x / horizontalSpeed : 1;
    normalZ = horizontalSpeed > 1e-6 ? -velocity.z / horizontalSpeed : 0;
  }

  const push = combinedRadius - distance + PLAYER_COLLISION_SKIN_M;
  position.x += normalX * push;
  position.z += normalZ * push;
  removeVelocityIntoNormal(velocity, normalX, normalZ);
  return true;
}

function resolveBoxCollision(
  position: THREE.Vector3,
  previousX: number,
  previousZ: number,
  velocity: THREE.Vector3,
  playerRadius: number,
  collider: FpBoxCollider,
): boolean {
  const centerDx = position.x - collider.centerX;
  const centerDz = position.z - collider.centerZ;
  const cos = collider.cosYaw ?? Math.cos(collider.yaw);
  const sin = collider.sinYaw ?? Math.sin(collider.yaw);
  const localX = centerDx * cos - centerDz * sin;
  const localZ = centerDx * sin + centerDz * cos;
  const closestX = THREE.MathUtils.clamp(localX, -collider.halfX, collider.halfX);
  const closestZ = THREE.MathUtils.clamp(localZ, -collider.halfZ, collider.halfZ);
  const dx = localX - closestX;
  const dz = localZ - closestZ;
  const distanceSq = dx * dx + dz * dz;
  if (distanceSq >= playerRadius * playerRadius) return false;

  let localNormalX: number;
  let localNormalZ: number;
  let push: number;
  if (distanceSq > 1e-10) {
    const distance = Math.sqrt(distanceSq);
    localNormalX = dx / distance;
    localNormalZ = dz / distance;
    push = playerRadius - distance + PLAYER_COLLISION_SKIN_M;
  } else {
    const previousDx = previousX - collider.centerX;
    const previousDz = previousZ - collider.centerZ;
    const previousLocalX = previousDx * cos - previousDz * sin;
    const previousLocalZ = previousDx * sin + previousDz * cos;
    const distanceToLeft = localX + collider.halfX;
    const distanceToRight = collider.halfX - localX;
    const distanceToBack = localZ + collider.halfZ;
    const distanceToFront = collider.halfZ - localZ;
    const minimum = Math.min(distanceToLeft, distanceToRight, distanceToBack, distanceToFront);

    if (
      Math.abs(previousLocalX) > collider.halfX
      && Math.abs(previousLocalZ) <= collider.halfZ + playerRadius
    ) {
      localNormalX = previousLocalX < 0 ? -1 : 1;
      localNormalZ = 0;
      push = collider.halfX + playerRadius - Math.abs(localX) + PLAYER_COLLISION_SKIN_M;
    } else if (
      Math.abs(previousLocalZ) > collider.halfZ
      && Math.abs(previousLocalX) <= collider.halfX + playerRadius
    ) {
      localNormalX = 0;
      localNormalZ = previousLocalZ < 0 ? -1 : 1;
      push = collider.halfZ + playerRadius - Math.abs(localZ) + PLAYER_COLLISION_SKIN_M;
    } else if (minimum === distanceToLeft) {
      localNormalX = -1;
      localNormalZ = 0;
      push = distanceToLeft + playerRadius + PLAYER_COLLISION_SKIN_M;
    } else if (minimum === distanceToRight) {
      localNormalX = 1;
      localNormalZ = 0;
      push = distanceToRight + playerRadius + PLAYER_COLLISION_SKIN_M;
    } else if (minimum === distanceToBack) {
      localNormalX = 0;
      localNormalZ = -1;
      push = distanceToBack + playerRadius + PLAYER_COLLISION_SKIN_M;
    } else {
      localNormalX = 0;
      localNormalZ = 1;
      push = distanceToFront + playerRadius + PLAYER_COLLISION_SKIN_M;
    }
  }

  const normalX = localNormalX * cos + localNormalZ * sin;
  const normalZ = -localNormalX * sin + localNormalZ * cos;
  position.x += normalX * push;
  position.z += normalZ * push;
  removeVelocityIntoNormal(velocity, normalX, normalZ);
  return true;
}

function removeVelocityIntoNormal(
  velocity: THREE.Vector3,
  normalX: number,
  normalZ: number,
): void {
  const intoSurface = velocity.x * normalX + velocity.z * normalZ;
  if (intoSurface >= 0) return;
  velocity.x -= normalX * intoSurface;
  velocity.z -= normalZ * intoSurface;
}
