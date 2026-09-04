import * as THREE from 'three';
import { TREE_SHADOW_CAST_LAYER } from '../scene/SceneLayers.ts';
import { BUILDING_DETAIL_CASTER_BATCH_FLAG } from './buildingDetailShadowBatch.ts';
import {
  BUILDING_DETAIL_SHADOW_CASTER_FLAG,
  isBuildingDetailShadowCaster,
} from './buildingShadowProxy.ts';

export const FOUNDERS_CAMP_MAJOR_SHADOW_CASTER_FLAG =
  'foundersCampMajorShadowCaster';
export const FOUNDERS_CAMP_SHADOW_SOURCE_FLAG =
  'foundersCampShadowSource';

export type FoundersCampShadowCasterStats = {
  readonly authoredSourceDraws: number;
  readonly authoredSourceTriangles: number;
  readonly tentCount: number;
  readonly shadowDraws: number;
  readonly shadowTriangles: number;
};

const TENT_HALF_WIDTH = 1.62;
const TENT_HALF_DEPTH = 1.92;
const TENT_EAVE_Y = 0.2;
const TENT_RIDGE_Y = 2.32;
const installedCasters = new WeakMap<THREE.Object3D, FoundersCampShadowCasterStats>();

/**
 * Replaces the camp's many material-preserving detail casters with one tiny,
 * shadow-only union of its three dominant A-frame silhouettes. Props remain
 * fully authored in the color pass, while ropes, cookware, stock, and trim no
 * longer create their own depth pipelines during the first placement frame.
 */
export function installFoundersCampShadowCasters(
  root: THREE.Group,
): FoundersCampShadowCasterStats {
  const existing = installedCasters.get(root);
  if (existing) return existing;

  let authoredSourceDraws = 0;
  let authoredSourceTriangles = 0;
  root.traverse((object) => {
    if (!isBuildingDetailShadowCaster(object)) return;
    const source = object as THREE.Mesh<THREE.BufferGeometry>;
    const instances = (source as THREE.InstancedMesh).isInstancedMesh
      ? (source as THREE.InstancedMesh).count
      : 1;
    authoredSourceDraws += 1;
    authoredSourceTriangles += geometryTriangles(source.geometry) * instances;
    source.castShadow = false;
    source.userData[BUILDING_DETAIL_SHADOW_CASTER_FLAG] = false;
    source.userData[FOUNDERS_CAMP_SHADOW_SOURCE_FLAG] = true;
  });

  const shelters = root.getObjectByName('FoundingShelters');
  if (!(shelters instanceof THREE.Group)) {
    throw new Error('Founders camp shadow setup requires FoundingShelters.');
  }

  shelters.updateWorldMatrix(true, true);
  const positions: number[] = [];
  let tentCount = 0;
  for (const child of shelters.children) {
    if (!(child instanceof THREE.Group) || child.name !== 'Founding canvas tent') continue;
    child.updateMatrix();
    appendCoarseTent(positions, child.matrix);
    tentCount += 1;
  }
  if (tentCount === 0) {
    throw new Error('Founders camp shadow setup found no canvas tents.');
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  material.name = 'Founders camp major-form shadow material';

  const caster = new THREE.Mesh(geometry, material);
  caster.name = 'Founders camp major-form shadow caster';
  caster.layers.set(TREE_SHADOW_CAST_LAYER);
  caster.castShadow = true;
  caster.receiveShadow = false;
  caster.userData[BUILDING_DETAIL_SHADOW_CASTER_FLAG] = true;
  caster.userData[BUILDING_DETAIL_CASTER_BATCH_FLAG] = true;
  caster.userData[FOUNDERS_CAMP_MAJOR_SHADOW_CASTER_FLAG] = true;
  caster.userData.fpNoCollision = true;

  const group = new THREE.Group();
  group.name = 'Founders camp major-form shadow casters';
  group.userData[BUILDING_DETAIL_CASTER_BATCH_FLAG] = true;
  group.userData.fpNoCollision = true;
  group.add(caster);
  shelters.add(group);

  const stats: FoundersCampShadowCasterStats = {
    authoredSourceDraws,
    authoredSourceTriangles,
    tentCount,
    shadowDraws: 1,
    shadowTriangles: positions.length / 9,
  };
  installedCasters.set(root, stats);
  root.userData.foundersCampShadowCasterStats = stats;
  return stats;
}

export function getFoundersCampShadowCasterStats(
  root: THREE.Object3D,
): FoundersCampShadowCasterStats | null {
  return installedCasters.get(root) ?? null;
}

function appendCoarseTent(
  target: number[],
  transform: THREE.Matrix4,
): void {
  const frontLeft = new THREE.Vector3(-TENT_HALF_WIDTH, TENT_EAVE_Y, -TENT_HALF_DEPTH);
  const frontRidge = new THREE.Vector3(0, TENT_RIDGE_Y, -TENT_HALF_DEPTH);
  const frontRight = new THREE.Vector3(TENT_HALF_WIDTH, TENT_EAVE_Y, -TENT_HALF_DEPTH);
  const backLeft = new THREE.Vector3(-TENT_HALF_WIDTH, TENT_EAVE_Y, TENT_HALF_DEPTH);
  const backRidge = new THREE.Vector3(0, TENT_RIDGE_Y, TENT_HALF_DEPTH);
  const backRight = new THREE.Vector3(TENT_HALF_WIDTH, TENT_EAVE_Y, TENT_HALF_DEPTH);
  const triangles = [
    frontLeft, backLeft, backRidge,
    frontLeft, backRidge, frontRidge,
    frontRidge, backRidge, backRight,
    frontRidge, backRight, frontRight,
    frontLeft, frontRidge, frontRight,
    backLeft, backRight, backRidge,
    frontLeft, frontRight, backRight,
    frontLeft, backRight, backLeft,
  ];
  for (const point of triangles) {
    const transformed = point.clone().applyMatrix4(transform);
    target.push(transformed.x, transformed.y, transformed.z);
  }
}

function geometryTriangles(geometry: THREE.BufferGeometry): number {
  return (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
}
