import * as THREE from 'three';
import type { MeshStandardNodeMaterial } from 'three/webgpu';
import type { Terrain } from '../terrain/Terrain.ts';
import {
  RENDER_WATER_MASK_THRESHOLD,
  type RiverField,
} from './RiverField.ts';
import { KUPA_WATERLINE_RADIUS } from './RiverLayout.ts';

const Y_OFFSET = 0.065;
const DEFAULT_BANK_WIDTH_METERS = 6.5;
const KUPA_BANK_MINIMUM_WIDTH_METERS = 9;
/** Hydraulic cross-section radius where the Kupa bank has regained its datum. */
export const KUPA_BANK_PRESENTATION_TOP_RADIUS = 0.88;
export const RIVER_BANK_INNER_MARGIN_METERS = 0.2;
const BANK_PROFILE_SEGMENTS = 4;
/** Small tangent overlap closes bends without stacking broad translucent wedges. */
const PATCH_TANGENT_HALF = 0.62;

type ShoreNode = {
  ix: number;
  iz: number;
  x: number;
  z: number;
  outwardX: number;
  outwardZ: number;
};

export function createRiverBankMeshes(
  terrain: Terrain,
  riverField: RiverField,
  material: MeshStandardNodeMaterial,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'River banks';

  const mesh = buildShorePatchMesh(terrain, riverField, material);
  mesh.name = 'River bank shore';
  mesh.renderOrder = 9;
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  group.add(mesh);

  return group;
}

function buildShorePatchMesh(
  terrain: Terrain,
  riverField: RiverField,
  material: MeshStandardNodeMaterial,
): THREE.Mesh {
  const shoreNodes = collectShoreNodes(riverField);
  const cellStep = (riverField.stepX + riverField.stepZ) * 0.5;
  const patchHalf = cellStep * PATCH_TANGENT_HALF;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (const node of shoreNodes.values()) {
    const outward = new THREE.Vector3(node.outwardX, 0, node.outwardZ).normalize();
    const tangent = new THREE.Vector3(-outward.z, 0, outward.x);
    const channel = riverField.layout.sampleChannel(node.x, node.z);
    const bankWidth = (
      riverField.layout.terrainPreset === 'kupa_valley' && channel
    )
      ? Math.max(
        KUPA_BANK_MINIMUM_WIDTH_METERS,
        channel.halfWidth * (
          KUPA_BANK_PRESENTATION_TOP_RADIUS - KUPA_WATERLINE_RADIUS
        ) - RIVER_BANK_INNER_MARGIN_METERS,
      )
      : DEFAULT_BANK_WIDTH_METERS;
    const verts: THREE.Vector3[] = [];
    for (let row = 0; row <= BANK_PROFILE_SEGMENTS; row += 1) {
      const t = row / BANK_PROFILE_SEGMENTS;
      const distance = RIVER_BANK_INNER_MARGIN_METERS
        + bankWidth * t;
      const left = new THREE.Vector3(node.x, 0, node.z)
        .addScaledVector(outward, distance)
        .addScaledVector(tangent, patchHalf);
      const right = new THREE.Vector3(node.x, 0, node.z)
        .addScaledVector(outward, distance)
        .addScaledVector(tangent, -patchHalf);
      pushOutOfWater(left, outward, riverField);
      pushOutOfWater(right, outward, riverField);
      verts.push(left, right);
    }

    const outerLeft = verts[verts.length - 2];
    const outerRight = verts[verts.length - 1];
    if (riverField.isRenderedWetAt(outerLeft.x, outerLeft.z)) continue;
    if (riverField.isRenderedWetAt(outerRight.x, outerRight.z)) continue;

    const base = positions.length / 3;
    for (let vertexIndex = 0; vertexIndex < verts.length; vertexIndex += 1) {
      const p = verts[vertexIndex];
      p.y = terrain.getHeightAt(p.x, p.z) + Y_OFFSET;
      positions.push(p.x, p.y, p.z);
      const row = Math.floor(vertexIndex / 2);
      const across = vertexIndex % 2;
      uvs.push(1 - row / BANK_PROFILE_SEGMENTS, across);
    }

    for (let row = 0; row < BANK_PROFILE_SEGMENTS; row += 1) {
      const innerLeft = base + row * 2;
      const innerRight = innerLeft + 1;
      const nextLeft = innerLeft + 2;
      const nextRight = innerLeft + 3;
      indices.push(
        innerLeft,
        innerRight,
        nextLeft,
        innerRight,
        nextRight,
        nextLeft,
      );
    }
  }

  return createMesh(positions, uvs, indices, material, terrain);
}

function collectShoreNodes(riverField: RiverField): Map<number, ShoreNode> {
  const { resolution, startX, startZ, stepX, stepZ } = riverField;
  const nodes = new Map<number, ShoreNode>();

  for (let iz = 0; iz < resolution; iz++) {
    for (let ix = 0; ix < resolution; ix++) {
      if (riverField.isRenderedWetAtGrid(ix, iz)) continue;

      let outwardX = 0;
      let outwardZ = 0;
      let wetNeighbors = 0;
      const neighborDirs: Array<[number, number, number, number]> = [
        [1, 0, -1, 0],
        [-1, 0, 1, 0],
        [0, 1, 0, -1],
        [0, -1, 0, 1],
      ];

      for (const [dx, dz, ox, oz] of neighborDirs) {
        if (!riverField.isRenderedWetAtGrid(ix + dx, iz + dz)) continue;
        outwardX += ox;
        outwardZ += oz;
        wetNeighbors += 1;
      }
      if (wetNeighbors === 0) continue;

      const len = Math.hypot(outwardX, outwardZ) || 1;
      const node = {
        ix,
        iz,
        x: startX + ix * stepX,
        z: startZ + iz * stepZ,
        outwardX: outwardX / len,
        outwardZ: outwardZ / len,
      };
      if (riverField.layout.terrainPreset === 'kupa_valley') {
        alignKupaShoreNodeToAnalyticNormal(node, riverField);
        snapKupaShoreNodeToAnalyticWaterline(node, riverField);
        alignKupaShoreNodeToAnalyticNormal(node, riverField);
      }
      nodes.set(nodeKey(ix, iz, resolution), node);
    }
  }

  return nodes;
}

function alignKupaShoreNodeToAnalyticNormal(
  node: ShoreNode,
  riverField: RiverField,
): void {
  const epsilon = Math.max(
    0.35,
    Math.min(1.2, (riverField.stepX + riverField.stepZ) * 0.18),
  );
  const gradientX = riverField.layout.sampleRiverMask(node.x + epsilon, node.z)
    - riverField.layout.sampleRiverMask(node.x - epsilon, node.z);
  const gradientZ = riverField.layout.sampleRiverMask(node.x, node.z + epsilon)
    - riverField.layout.sampleRiverMask(node.x, node.z - epsilon);
  const gradientLength = Math.hypot(gradientX, gradientZ);
  if (gradientLength <= 1e-6) return;
  // The river mask grows toward the wet center; the dry-bank normal points in
  // the opposite direction.
  node.outwardX = -gradientX / gradientLength;
  node.outwardZ = -gradientZ / gradientLength;
}

function snapKupaShoreNodeToAnalyticWaterline(
  node: ShoreNode,
  riverField: RiverField,
): void {
  const cellReach = Math.hypot(riverField.stepX, riverField.stepZ);
  const dryX = node.x;
  const dryZ = node.z;
  let wetDistance = cellReach;
  let wetX = dryX - node.outwardX * wetDistance;
  let wetZ = dryZ - node.outwardZ * wetDistance;

  // Averaged corner normals occasionally need more than one cell to reach the
  // analytic channel. Keep the search tightly bounded to the local shoreline.
  while (
    wetDistance <= cellReach * 3
    && riverField.layout.sampleRiverMask(wetX, wetZ) < RENDER_WATER_MASK_THRESHOLD
  ) {
    wetDistance += cellReach * 0.5;
    wetX = dryX - node.outwardX * wetDistance;
    wetZ = dryZ - node.outwardZ * wetDistance;
  }
  if (riverField.layout.sampleRiverMask(wetX, wetZ) < RENDER_WATER_MASK_THRESHOLD) return;

  let dryT = 0;
  let wetT = wetDistance;
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const candidateT = (dryT + wetT) * 0.5;
    const candidateX = dryX - node.outwardX * candidateT;
    const candidateZ = dryZ - node.outwardZ * candidateT;
    if (
      riverField.layout.sampleRiverMask(candidateX, candidateZ)
      >= RENDER_WATER_MASK_THRESHOLD
    ) {
      wetT = candidateT;
    } else {
      dryT = candidateT;
    }
  }
  const boundaryT = (dryT + wetT) * 0.5;
  node.x = dryX - node.outwardX * boundaryT;
  node.z = dryZ - node.outwardZ * boundaryT;
}

function pushOutOfWater(
  pos: THREE.Vector3,
  outward: THREE.Vector3,
  riverField: RiverField,
): void {
  for (let step = 0; step < 8 && riverField.isRenderedWetAt(pos.x, pos.z); step++) {
    if (riverField.layout.terrainPreset !== 'kupa_valley') {
      pos.addScaledVector(outward, 0.42);
      continue;
    }
    // Tangent-expanded patches can straddle the inside of a tight bend even
    // when the shore-node normal is correct. Follow the local analytic mask
    // gradient so every inner corner walks toward dry ground.
    const epsilon = 0.45;
    const gradientX = riverField.layout.sampleRiverMask(pos.x + epsilon, pos.z)
      - riverField.layout.sampleRiverMask(pos.x - epsilon, pos.z);
    const gradientZ = riverField.layout.sampleRiverMask(pos.x, pos.z + epsilon)
      - riverField.layout.sampleRiverMask(pos.x, pos.z - epsilon);
    const gradientLength = Math.hypot(gradientX, gradientZ);
    if (gradientLength <= 1e-6) {
      pos.addScaledVector(outward, 0.42);
      continue;
    }
    pos.x -= gradientX / gradientLength * 0.42;
    pos.z -= gradientZ / gradientLength * 0.42;
  }
}

function createMesh(
  positions: number[],
  uvs: number[],
  indices: number[],
  material: MeshStandardNodeMaterial,
  terrain: Terrain,
): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  // uv0 remains the analytic waterline-to-meadow blend. A world-projected
  // second set prevents every short shoreline patch from restarting the same
  // carbonate texture and exposing a tiled seam at each cell boundary.
  const mineralUvs = new Float32Array((positions.length / 3) * 2);
  for (let offset = 0; offset < positions.length; offset += 3) {
    const vertexIndex = offset / 3;
    mineralUvs[vertexIndex * 2] = positions[offset] * 0.16;
    mineralUvs[vertexIndex * 2 + 1] = positions[offset + 2] * 0.16;
  }
  geometry.setAttribute('uv1', new THREE.BufferAttribute(mineralUvs, 2));
  geometry.setAttribute('uv2', new THREE.BufferAttribute(mineralUvs, 2));
  const normals = new Float32Array(positions.length);
  const epsilon = 0.65;
  const normal = new THREE.Vector3();
  for (let offset = 0; offset < positions.length; offset += 3) {
    const x = positions[offset];
    const z = positions[offset + 2];
    const slopeX = (
      terrain.getHeightAt(x + epsilon, z) - terrain.getHeightAt(x - epsilon, z)
    ) / (epsilon * 2);
    const slopeZ = (
      terrain.getHeightAt(x, z + epsilon) - terrain.getHeightAt(x, z - epsilon)
    ) / (epsilon * 2);
    normal.set(-slopeX, 1, -slopeZ).normalize();
    normals[offset] = normal.x;
    normals[offset + 1] = normal.y;
    normals[offset + 2] = normal.z;
  }
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.computeBoundingSphere();
  return new THREE.Mesh(geometry, material);
}

function nodeKey(ix: number, iz: number, resolution: number): number {
  return iz * resolution + ix;
}
