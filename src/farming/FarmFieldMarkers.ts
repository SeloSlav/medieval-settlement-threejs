import * as THREE from 'three';
import {
  clearOverlayGeometry,
  polygonSegments,
  updateTerrainQuadGeometry,
  updateTerrainRibbonGeometry,
  type TerrainOverlaySegment,
} from '../placement/TerrainOverlayGeometry.ts';
import type { FarmCrop, FarmFieldState } from '../resources/types.ts';
import type { RendererBackendKind } from '../scene/RendererBackend.ts';
import { disposeObject3D } from '../utils/dispose.ts';
import type { Point2 } from '../utils/polygonGeometry.ts';
import { bilinearPoint, cropLabel, type FarmFieldCorners } from './farmFieldMath.ts';
import { createFieldPerimeterShrubGroup } from './FarmFieldPerimeterShrubs.ts';
import {
  hashParcelSeed,
  organicParcelBoundaryPoints,
  polylineSegments,
} from './organicParcelGeometry.ts';
import type { FieldPerimeterShrubCatalog } from '../props/ForestUndergrowth.ts';
import {
  createFieldSoilMaterial,
  FIELD_SOIL_IDENTITIES,
  type FieldSoilDebugMode,
  type FieldSoilIdentity,
} from '../terrain/fieldSoilMaterials.ts';
import {
  addSeedThreeGroundCoverInstanceAttributes,
  seedThreeGroundCoverWindVector,
} from '../vegetation/seedthree/seedThreeGroundCover.ts';
import type {
  FieldCropCatalog,
  FieldCropComponentAsset,
  FieldCropPhaseAsset,
} from '../vegetation/seedthree/fieldCropAssets.ts';

const FIELD_LIFT = 0.08;
const MIN_SURFACE_STEPS = 10;
const CEREAL_TUFTS_PER_SQUARE_METER = 1.9;
const FLAX_TUFTS_PER_SQUARE_METER = 1.55;
const FALLOW_TUFTS_PER_SQUARE_METER = 0.48;
const MAX_FIELD_TUFTS = 8_000;
const CEREAL_MATURE_PROGRESS = 0.76;
const GRAIN_HEAD_START_PROGRESS = 0.42;
const FIELD_SURFACE_SAMPLE_SPACING = 0.62;
const FIELD_EDGE_FADE_METERS = 0.92;
const FIELD_ROW_EDGE_INSET_METERS = 0.58;
const UP_AXIS = new THREE.Vector3(0, 1, 0);

type FieldSample = {
  u: number;
  v: number;
  x: number;
  z: number;
  randomA: number;
  randomB: number;
  randomC: number;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function random01(seed: number, index: number, salt: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return ((value ^ (value >>> 15)) >>> 0) / 4_294_967_296;
}

function fieldDimensions(corners: FarmFieldCorners): { width: number; depth: number } {
  return {
    width: Math.hypot(
      corners[1].x - corners[0].x,
      corners[1].z - corners[0].z,
    ),
    depth: Math.hypot(
      corners[3].x - corners[0].x,
      corners[3].z - corners[0].z,
    ),
  };
}

function processedAt(field: FarmFieldState, v: number, noise: number): boolean {
  if (field.stage !== 'ploughing' && field.stage !== 'sowing' && field.stage !== 'harvesting') {
    return true;
  }
  const progress = clamp01(field.stageProgress);
  if (progress <= 0) return false;
  if (progress >= 1) return true;
  return v <= clamp01(progress + (noise - 0.5) * 0.075);
}

function surfaceColorAt(
  field: FarmFieldState,
  u: number,
  v: number,
  seed: number,
  vertexIndex: number,
): THREE.Color {
  const broadNoise = random01(
    seed,
    Math.floor(u * 17) + Math.floor(v * 19) * 23,
    0x13a6d45f,
  );
  const fineNoise = random01(seed, vertexIndex, 0x7f4a7c15);
  let color: THREE.Color;

  if (field.crop === 'fallow' && field.stage === 'growing') {
    color = new THREE.Color(broadNoise > 0.5 ? 0xe2ded1 : 0xd5d1c5);
  } else if (field.stage === 'ploughing') {
    color = new THREE.Color(broadNoise > 0.52 ? 0xdac8b7 : 0xe4d3c1);
  } else if (field.stage === 'sowing') {
    color = new THREE.Color(
      processedAt(field, v, broadNoise)
        ? (broadNoise > 0.5 ? 0xeee5d8 : 0xe3d8c9)
        : (broadNoise > 0.5 ? 0xd8c4b2 : 0xe1cfbd),
    );
  } else if (field.stage === 'harvesting') {
    color = new THREE.Color(
      processedAt(field, v, broadNoise)
        ? (broadNoise > 0.48 ? 0xeee0cc : 0xe4d5c1)
        : (broadNoise > 0.5 ? 0xd9c7b4 : 0xe1cfbc),
    );
  } else {
    color = new THREE.Color(broadNoise > 0.52 ? 0xdfcfbd : 0xe6d6c4);
  }

  color.multiplyScalar(0.97 + fineNoise * 0.07);
  return color;
}

function soilIdentityAt(
  field: FarmFieldState,
  v: number,
  noise: number,
): FieldSoilIdentity | null {
  if (field.stage === 'ploughing') {
    return processedAt(field, v, noise) ? 'ploughed' : null;
  }
  if (field.stage === 'sowing') {
    return processedAt(field, v, noise) ? 'seedbed' : 'ploughed';
  }
  if (field.stage === 'harvesting') {
    return processedAt(field, v, noise) ? 'harvested' : 'growing';
  }
  if (field.crop === 'fallow') return 'fallow';
  return 'growing';
}

function soilIdentityOrder(field: FarmFieldState): readonly FieldSoilIdentity[] {
  const progress = clamp01(field.stageProgress);
  if (field.stage === 'sowing') {
    if (progress <= 0.01) return ['ploughed'];
    if (progress >= 0.99) return ['seedbed'];
    return ['ploughed', 'seedbed'];
  }
  if (field.stage === 'harvesting') {
    if (progress <= 0.01) return ['growing'];
    if (progress >= 0.99) return ['harvested'];
    return ['growing', 'harvested'];
  }
  if (field.stage === 'ploughing') return progress <= 0.01 ? [] : ['ploughed'];
  if (field.crop === 'fallow') return ['fallow'];
  return ['growing'];
}

function fieldEdgeBlendAt(
  point: Point2,
  u: number,
  v: number,
  width: number,
  depth: number,
  seed: number,
): number {
  const edgeDistance = Math.min(
    u * width,
    (1 - u) * width,
    v * depth,
    (1 - v) * depth,
  );
  if (edgeDistance <= 0) return 0;
  const broad = Math.sin(point.x * 0.73 + point.z * 0.29 + seed * 0.000013) * 0.16;
  const detail = Math.sin(point.z * 1.41 - point.x * 0.37 + seed * 0.000031) * 0.075;
  const boundaryLock = THREE.MathUtils.smoothstep(edgeDistance, 0.06, 0.28);
  const warpedDistance = Math.max(0, edgeDistance + (broad + detail) * boundaryLock);
  return THREE.MathUtils.smoothstep(warpedDistance, 0, FIELD_EDGE_FADE_METERS);
}

function createSurface(
  field: FarmFieldState,
  corners: FarmFieldCorners,
  getHeightAt: (x: number, z: number) => number,
  rendererBackend: RendererBackendKind,
  debugMode: FieldSoilDebugMode,
): THREE.Mesh {
  const { width, depth } = fieldDimensions(corners);
  const uSteps = Math.max(
    MIN_SURFACE_STEPS,
    Math.min(96, Math.ceil(width / FIELD_SURFACE_SAMPLE_SPACING)),
  );
  const vSteps = Math.max(
    MIN_SURFACE_STEPS,
    Math.min(96, Math.ceil(depth / FIELD_SURFACE_SAMPLE_SPACING)),
  );
  const vertices: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const edgeBlends: number[] = [];
  const identities = soilIdentityOrder(field);
  const indicesByIdentity = new Map(
    identities.map((identity) => [identity, [] as number[]]),
  );
  const seed = hashString(field.id);
  for (let vIndex = 0; vIndex <= vSteps; vIndex += 1) {
    for (let uIndex = 0; uIndex <= uSteps; uIndex += 1) {
      const u = uIndex / uSteps;
      const v = vIndex / vSteps;
      const point = bilinearPoint(corners, u, v);
      vertices.push(point.x, getHeightAt(point.x, point.z) + FIELD_LIFT, point.z);
      // Raw world metres are retained as an inspection breadcrumb. The
      // materials own their state-specific physical scale and organic warp.
      uvs.push(point.x, point.z);
      edgeBlends.push(fieldEdgeBlendAt(point, u, v, width, depth, seed));
      const color = surfaceColorAt(
        field,
        u,
        v,
        seed,
        vIndex * (uSteps + 1) + uIndex,
      );
      colors.push(color.r, color.g, color.b);
    }
  }
  const stride = uSteps + 1;
  for (let v = 0; v < vSteps; v += 1) {
    for (let u = 0; u < uSteps; u += 1) {
      const cellIndex = v * uSteps + u;
      const cellNoise = random01(seed, cellIndex, 0x50f3a149);
      const cellV = (v + 0.5) / vSteps;
      const identity = soilIdentityAt(field, cellV, cellNoise);
      if (!identity) continue;
      const identityIndices = indicesByIdentity.get(identity);
      if (!identityIndices) continue;
      const a = v * stride + u;
      const b = a + 1;
      const d = (v + 1) * stride + u;
      const c = d + 1;
      identityIndices.push(a, d, b, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('uv1', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('fieldEdgeBlend', new THREE.Float32BufferAttribute(edgeBlends, 1));
  const combinedIndices: number[] = [];
  for (let materialIndex = 0; materialIndex < identities.length; materialIndex += 1) {
    const identity = identities[materialIndex]!;
    const stateIndices = indicesByIdentity.get(identity)!;
    if (stateIndices.length === 0) continue;
    const start = combinedIndices.length;
    combinedIndices.push(...stateIndices);
    geometry.addGroup(start, stateIndices.length, materialIndex);
  }
  geometry.setIndex(combinedIndices);
  geometry.computeVertexNormals();
  const materials = identities.map((identity) => createFieldSoilMaterial(
    identity,
    rendererBackend,
    debugMode,
  ));
  const mesh = new THREE.Mesh(
    geometry,
    materials.length === 1 ? materials[0]! : materials,
  );
  mesh.name = 'Worked field soil';
  mesh.receiveShadow = true;
  mesh.userData.fieldStage = field.stage;
  mesh.userData.fieldCrop = field.crop === 'wheat' ? 'maslin' : field.crop;
  mesh.userData.fieldStateCoverage = field.stage === 'ploughing'
    ? clamp01(field.stageProgress)
    : 1;
  mesh.userData.fieldSoilIdentities = identities;
  mesh.userData.fieldSoilPbr = Object.fromEntries(identities.map((identity) => [
    identity,
    FIELD_SOIL_IDENTITIES[identity],
  ]));
  mesh.userData.edgeTransition = {
    mode: 'continuous irregular alpha crossfade',
    widthMeters: FIELD_EDGE_FADE_METERS,
    coordinateDomain: 'world-xz-metres',
    minimum: Math.min(...edgeBlends),
    maximum: Math.max(...edgeBlends),
  };
  mesh.userData.debugModes = ['final', 'albedo', 'normal', 'roughness', 'edge-blend'];
  mesh.userData.activeDebugMode = debugMode;
  return mesh;
}

function createFurrows(
  field: FarmFieldState,
  corners: FarmFieldCorners,
  getHeightAt: (x: number, z: number) => number,
): THREE.LineSegments {
  const { width, depth } = fieldDimensions(corners);
  const vertices: number[] = [];
  const rows = Math.max(4, Math.min(52, Math.floor(depth / 0.72)));
  const segments = Math.max(6, Math.min(56, Math.ceil(width / 1.25)));
  const uInset = Math.min(0.22, FIELD_ROW_EDGE_INSET_METERS / Math.max(width, 0.01));
  const processedLimit = field.stage === 'ploughing'
    ? Math.max(0, Math.min(1, field.stageProgress))
    : 1;
  for (let row = 1; row < rows; row += 1) {
    const v = row / rows;
    if (v > processedLimit + 0.012) continue;
    for (let segment = 0; segment < segments; segment += 1) {
      for (const segmentT of [segment / segments, (segment + 1) / segments]) {
        const u = THREE.MathUtils.lerp(uInset, 1 - uInset, segmentT);
        const point = bilinearPoint(corners, u, v);
        vertices.push(
          point.x,
          getHeightAt(point.x, point.z) + FIELD_LIFT + 0.018,
          point.z,
        );
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  const furrows = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({
      color: field.crop === 'fallow' ? 0x33442d : 0x332218,
      transparent: true,
      opacity: field.stage === 'growing' ? 0.32 : 0.52,
      depthWrite: false,
    }),
  );
  furrows.name = 'Terrain-following field furrows';
  return furrows;
}

function createSeededDrills(
  field: FarmFieldState,
  corners: FarmFieldCorners,
  getHeightAt: (x: number, z: number) => number,
): THREE.LineSegments {
  const vertices: number[] = [];
  if (field.stage === 'sowing') {
    const { width, depth } = fieldDimensions(corners);
    const rows = Math.max(4, Math.min(56, Math.floor(depth / 0.64)));
    const segments = Math.max(6, Math.min(64, Math.ceil(width / 1.1)));
    const uInset = Math.min(0.22, FIELD_ROW_EDGE_INSET_METERS / Math.max(width, 0.01));
    const seed = hashString(field.id);
    for (let row = 1; row < rows; row += 1) {
      const v = row / rows;
      const noise = random01(seed, row, 0x17a0c4d1);
      if (!processedAt(field, v, noise)) continue;
      for (let segment = 0; segment < segments; segment += 1) {
        for (const segmentT of [segment / segments, (segment + 1) / segments]) {
          const u = THREE.MathUtils.lerp(uInset, 1 - uInset, segmentT);
          const point = bilinearPoint(corners, u, v);
          vertices.push(
            point.x,
            getHeightAt(point.x, point.z) + FIELD_LIFT + 0.023,
            point.z,
          );
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  const drills = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({
      color: 0x2c2118,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    }),
  );
  drills.name = 'Seeded drill rows';
  drills.userData.seededCoverage = field.stage === 'sowing'
    ? clamp01(field.stageProgress)
    : 0;
  return drills;
}

function createFieldEdge(
  fieldId: string,
  corners: FarmFieldCorners,
  getHeightAt: (x: number, z: number) => number,
): THREE.LineSegments {
  const points: THREE.Vector3[] = [];
  const boundary = organicParcelBoundaryPoints(corners, hashParcelSeed(fieldId), {
    spacing: 3.6,
    amplitude: 0.22,
  });
  for (const segment of polylineSegments(boundary, true)) {
    for (const point of segment) {
      points.push(new THREE.Vector3(
        point.x,
        getHeightAt(point.x, point.z) + FIELD_LIFT + 0.025,
        point.z,
      ));
    }
  }
  const edge = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({
      color: 0x6d604c,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
    }),
  );
  edge.name = 'Subtle earthen field edge';
  return edge;
}

function appendTriangle(
  positions: number[],
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
): void {
  positions.push(...a, ...b, ...c);
}

function appendQuad(
  positions: number[],
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
  d: readonly [number, number, number],
): void {
  appendTriangle(positions, a, b, c);
  appendTriangle(positions, a, c, d);
}

function appendCrossedStem(
  positions: number[],
  x: number,
  z: number,
  height: number,
  leanX: number,
  leanZ: number,
  width: number,
): void {
  appendQuad(
    positions,
    [x - width, 0, z],
    [x + width, 0, z],
    [x + leanX + width * 0.62, height, z + leanZ],
    [x + leanX - width * 0.62, height, z + leanZ],
  );
  appendQuad(
    positions,
    [x, 0, z - width],
    [x, 0, z + width],
    [x + leanX, height, z + leanZ + width * 0.62],
    [x + leanX, height, z + leanZ - width * 0.62],
  );
}

function appendCrossedStemSegment(
  positions: number[],
  x: number,
  z: number,
  baseY: number,
  endX: number,
  endZ: number,
  topY: number,
  width: number,
): void {
  appendQuad(
    positions,
    [x - width, baseY, z],
    [x + width, baseY, z],
    [endX + width * 0.62, topY, endZ],
    [endX - width * 0.62, topY, endZ],
  );
  appendQuad(
    positions,
    [x, baseY, z - width],
    [x, baseY, z + width],
    [endX, topY, endZ + width * 0.62],
    [endX, topY, endZ - width * 0.62],
  );
}

function appendLeaf(
  positions: number[],
  origin: readonly [number, number, number],
  tip: readonly [number, number, number],
  width: number,
): void {
  appendQuad(
    positions,
    [origin[0] - width, origin[1], origin[2]],
    [origin[0] + width, origin[1], origin[2]],
    [tip[0] + width * 0.16, tip[1], tip[2]],
    [tip[0] - width * 0.16, tip[1], tip[2]],
  );
}

const TUFT_STEMS = [
  { x: -0.105, z: 0.035, height: 0.93, leanX: -0.015, leanZ: 0.02 },
  { x: 0.015, z: -0.08, height: 1.04, leanX: 0.025, leanZ: -0.015 },
  { x: 0.115, z: 0.075, height: 0.86, leanX: 0.012, leanZ: 0.03 },
] as const;

function createCerealStalkGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  for (let index = 0; index < TUFT_STEMS.length; index += 1) {
    const stem = TUFT_STEMS[index]!;
    appendCrossedStem(
      positions,
      stem.x,
      stem.z,
      stem.height * 0.84,
      stem.leanX,
      stem.leanZ,
      0.009,
    );
    const direction = index % 2 === 0 ? 1 : -1;
    appendLeaf(
      positions,
      [stem.x, stem.height * 0.28, stem.z],
      [
        stem.x + direction * 0.16,
        stem.height * 0.47,
        stem.z + (index - 1) * 0.035,
      ],
      0.019,
    );
    appendLeaf(
      positions,
      [stem.x, stem.height * 0.48, stem.z],
      [
        stem.x - direction * 0.12,
        stem.height * 0.64,
        stem.z + (1 - index) * 0.026,
      ],
      0.015,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function appendEarPlane(
  positions: number[],
  x: number,
  z: number,
  baseY: number,
  topY: number,
  width: number,
  alongX: boolean,
): void {
  const midY = THREE.MathUtils.lerp(baseY, topY, 0.54);
  const point = (
    lateral: number,
    y: number,
  ): [number, number, number] => alongX
    ? [x + lateral, y, z]
    : [x, y, z + lateral];
  appendTriangle(positions, point(0, baseY), point(-width, midY), point(0, topY));
  appendTriangle(positions, point(0, baseY), point(0, topY), point(width, midY));
}

function appendAwn(
  positions: number[],
  x: number,
  z: number,
  y: number,
  lateral: number,
  alongX: boolean,
  rise = 0.105,
): void {
  const base = alongX
    ? [x + lateral * 0.24, y, z - 0.003] as const
    : [x - 0.003, y, z + lateral * 0.24] as const;
  const shoulder = alongX
    ? [x + lateral * 0.38, y + 0.018, z + 0.003] as const
    : [x + 0.003, y + 0.018, z + lateral * 0.38] as const;
  const tip = alongX
    ? [x + lateral, y + rise, z] as const
    : [x, y + rise, z + lateral] as const;
  appendTriangle(positions, base, shoulder, tip);
}

type GrainHeadProfile = 'rye' | 'barley' | 'wheat';

function createCerealHeadGeometry(profile: GrainHeadProfile): THREE.BufferGeometry {
  const positions: number[] = [];
  for (let stemIndex = 0; stemIndex < TUFT_STEMS.length; stemIndex += 1) {
    const stem = TUFT_STEMS[stemIndex]!;
    // Maslin deliberately mixes one slender rye ear into each wheat-heavy tuft.
    const stemProfile = profile === 'wheat' && stemIndex === 0 ? 'rye' : profile;
    const earWidth = stemProfile === 'wheat' ? 0.041 : stemProfile === 'barley' ? 0.027 : 0.03;
    const earLength = stemProfile === 'wheat' ? 0.21 : stemProfile === 'barley' ? 0.24 : 0.255;
    const awnLength = stemProfile === 'barley' ? 0.19 : stemProfile === 'wheat' ? 0.052 : 0.102;
    const awnRise = stemProfile === 'barley' ? 0.17 : stemProfile === 'wheat' ? 0.04 : 0.105;
    const levelCount = stemProfile === 'wheat' ? 6 : 5;
    const x = stem.x + stem.leanX;
    const z = stem.z + stem.leanZ;
    const baseY = stem.height * 0.78;
    const topY = baseY + earLength;
    appendEarPlane(positions, x, z, baseY, topY, earWidth, true);
    appendEarPlane(positions, x, z, baseY, topY, earWidth * 0.8, false);
    for (let level = 0; level < levelCount; level += 1) {
      const levelRatio = level / Math.max(1, levelCount - 1);
      const y = THREE.MathUtils.lerp(baseY + 0.025, topY - 0.035, levelRatio);
      const taper = 0.72 + Math.sin(levelRatio * Math.PI) * 0.28;
      const alongX = level % 2 === 0;
      for (const side of [-1, 1]) {
        appendAwn(
          positions,
          x,
          z,
          y + 0.006,
          side * awnLength * taper,
          alongX,
          awnRise,
        );
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function appendPanicleBranch(
  positions: number[],
  x: number,
  z: number,
  y: number,
  side: number,
  alongX: boolean,
  length: number,
): void {
  const endX = x + (alongX ? side * length : side * length * 0.18);
  const endZ = z + (alongX ? side * length * 0.18 : side * length);
  const endY = y - 0.025 - length * 0.08;
  const width = 0.006;
  appendQuad(
    positions,
    [x - width, y, z],
    [x + width, y, z],
    [endX + width * 0.6, endY, endZ],
    [endX - width * 0.6, endY, endZ],
  );
  appendQuad(
    positions,
    [endX - 0.017, endY + 0.012, endZ],
    [endX + 0.017, endY + 0.012, endZ],
    [endX + 0.011, endY - 0.046, endZ],
    [endX - 0.011, endY - 0.046, endZ],
  );
}

function createOatPanicleGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const stem of TUFT_STEMS) {
    const x = stem.x + stem.leanX;
    const z = stem.z + stem.leanZ;
    const baseY = stem.height * 0.79;
    appendCrossedStemSegment(positions, x, z, baseY - 0.045, x, z, baseY + 0.19, 0.005);
    for (let level = 0; level < 4; level += 1) {
      const y = baseY + level * 0.055;
      const length = 0.13 - level * 0.018;
      appendPanicleBranch(positions, x, z, y, -1, level % 2 === 0, length);
      appendPanicleBranch(positions, x, z, y + 0.018, 1, level % 2 === 0, length * 0.88);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createFlaxStemGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  for (let index = 0; index < TUFT_STEMS.length; index += 1) {
    const stem = TUFT_STEMS[index]!;
    const height = stem.height * 0.9;
    appendCrossedStem(positions, stem.x, stem.z, height, stem.leanX, stem.leanZ, 0.006);
    for (let branch = 0; branch < 3; branch += 1) {
      const direction = (branch + index) % 2 === 0 ? 1 : -1;
      const baseY = height * (0.56 + branch * 0.12);
      appendLeaf(
        positions,
        [stem.x, baseY, stem.z],
        [stem.x + direction * (0.12 - branch * 0.016), baseY + 0.085, stem.z + (branch - 1) * 0.035],
        0.012,
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function appendFlaxFlower(
  positions: number[],
  x: number,
  y: number,
  z: number,
  radius: number,
): void {
  for (let petal = 0; petal < 5; petal += 1) {
    const angle = petal / 5 * Math.PI * 2;
    const tangentX = Math.cos(angle + Math.PI / 2) * radius * 0.42;
    const tangentZ = Math.sin(angle + Math.PI / 2) * radius * 0.42;
    const tipX = x + Math.cos(angle) * radius;
    const tipZ = z + Math.sin(angle) * radius;
    appendTriangle(
      positions,
      [x - tangentX, y, z - tangentZ],
      [tipX, y + radius * 0.22, tipZ],
      [x + tangentX, y, z + tangentZ],
    );
  }
}

function createFlaxBlossomGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  for (let index = 0; index < TUFT_STEMS.length; index += 1) {
    const stem = TUFT_STEMS[index]!;
    const x = stem.x + stem.leanX;
    const z = stem.z + stem.leanZ;
    const y = stem.height * 0.9;
    const side = index % 2 === 0 ? -1 : 1;
    appendCrossedStemSegment(
      positions,
      x,
      z,
      y - 0.12,
      x + side * 0.075,
      z + 0.025,
      y - 0.055,
      0.004,
    );
    appendFlaxFlower(positions, x, y, z, 0.055);
    appendFlaxFlower(positions, x + side * 0.075, y - 0.055, z + 0.025, 0.044);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createStubbleGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const stems = [
    [-0.12, -0.06, 0.17],
    [-0.035, 0.1, 0.13],
    [0.07, -0.08, 0.2],
    [0.13, 0.07, 0.15],
  ] as const;
  for (const [x, z, height] of stems) {
    appendCrossedStem(positions, x, z, height, x * 0.08, z * 0.08, 0.012);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function fieldSamples(field: FarmFieldState, corners: FarmFieldCorners): FieldSample[] {
  const density = field.crop === 'fallow'
    ? FALLOW_TUFTS_PER_SQUARE_METER
    : field.crop === 'flax'
      ? FLAX_TUFTS_PER_SQUARE_METER
    : CEREAL_TUFTS_PER_SQUARE_METER;
  const fertilityDensity = 0.7 + clamp01(field.fertility) * 0.3;
  const targetCount = Math.max(
    24,
    Math.min(MAX_FIELD_TUFTS, Math.round(field.area * density * fertilityDensity)),
  );
  const { width, depth } = fieldDimensions(corners);
  const columns = Math.max(
    1,
    Math.ceil(Math.sqrt(targetCount * Math.max(0.15, width / Math.max(0.1, depth)))),
  );
  const rows = Math.max(1, Math.ceil(targetCount / columns));
  const seed = hashString(field.id);
  const samples: FieldSample[] = [];
  for (let row = 0; row < rows && samples.length < targetCount; row += 1) {
    for (let column = 0; column < columns && samples.length < targetCount; column += 1) {
      const index = row * columns + column;
      const randomA = random01(seed, index, 0x31f29c45);
      const randomB = random01(seed, index, 0x9e3779b9);
      const randomC = random01(seed, index, 0x6c8e9cf5);
      const u = (column + 0.14 + randomA * 0.72) / columns;
      const v = (row + 0.12 + randomB * 0.76) / rows;
      const point = bilinearPoint(corners, u, v);
      samples.push({
        u,
        v,
        x: point.x,
        z: point.z,
        randomA,
        randomB,
        randomC,
      });
    }
  }
  return samples;
}

function withNaturalVariation(base: THREE.Color, random: number): THREE.Color {
  const color = base.clone();
  color.offsetHSL((random - 0.5) * 0.035, (random - 0.5) * 0.09, (random - 0.5) * 0.14);
  return color;
}

function cerealMaturity(field: FarmFieldState): number {
  if (field.stage === 'harvesting') return 1;
  if (field.stage !== 'growing') return 0;
  return clamp01(field.stageProgress / CEREAL_MATURE_PROGRESS);
}

function createInstancedTufts(
  geometry: THREE.BufferGeometry,
  samples: readonly FieldSample[],
  getHeightAt: (x: number, z: number) => number,
  baseColor: THREE.Color,
  name: string,
  heightScale: (sample: FieldSample) => number,
  widthScale: (sample: FieldSample) => number,
): THREE.InstancedMesh {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, samples.length);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]!;
    position.set(
      sample.x,
      getHeightAt(sample.x, sample.z) + FIELD_LIFT + 0.012,
      sample.z,
    );
    euler.set(
      (sample.randomB - 0.5) * 0.065,
      sample.randomA * Math.PI * 2,
      (sample.randomC - 0.5) * 0.065,
    );
    quaternion.setFromEuler(euler);
    const width = widthScale(sample);
    scale.set(width, heightScale(sample), width);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, withNaturalVariation(baseColor, sample.randomC));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  return mesh;
}

function createSoilClods(
  field: FarmFieldState,
  corners: FarmFieldCorners,
  getHeightAt: (x: number, z: number) => number,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'Broken worked-earth detail';
  if (field.crop === 'fallow' && field.stage === 'growing') return group;
  const samples = fieldSamples(field, corners).filter((sample, index) => (
    index % 18 === 0
    && (
      field.stage === 'growing'
      || field.stage === 'sowing'
      || processedAt(field, sample.v, sample.randomA)
    )
  ));
  if (samples.length === 0) return group;

  const geometry = new THREE.DodecahedronGeometry(0.09, 0);
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    flatShading: true,
    emissive: 0x1b130e,
    emissiveIntensity: 0.28,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, samples.length);
  mesh.name = 'Irregular soil clods';
  mesh.receiveShadow = true;
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]!;
    position.set(
      sample.x,
      getHeightAt(sample.x, sample.z) + FIELD_LIFT + 0.022,
      sample.z,
    );
    quaternion.setFromAxisAngle(UP_AXIS, sample.randomA * Math.PI * 2);
    scale.set(
      0.7 + sample.randomB * 0.72,
      0.2 + sample.randomC * 0.22,
      0.68 + sample.randomA * 0.68,
    );
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(
      index,
      withNaturalVariation(new THREE.Color(0x6e5946), sample.randomB),
    );
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  group.add(mesh);
  return group;
}

function cropColors(field: FarmFieldState, maturity: number): {
  stalk: THREE.Color;
  head: THREE.Color;
} {
  const palette = {
    rye: { young: 0x60753a, matureStalk: 0x9d732e, youngHead: 0x82914b, matureHead: 0xd2b576 },
    oats: { young: 0x71813f, matureStalk: 0xaa8b45, youngHead: 0x8b9952, matureHead: 0xcab47b },
    barley: { young: 0x687b38, matureStalk: 0xb08a38, youngHead: 0x91a151, matureHead: 0xd7bd72 },
    wheat: { young: 0x64743b, matureStalk: 0xa67c34, youngHead: 0x89934f, matureHead: 0xd1aa63 },
    flax: { young: 0x50784c, matureStalk: 0x7f8d4a, youngHead: 0x7ea9db, matureHead: 0x79aee6 },
    fallow: { young: 0x65794a, matureStalk: 0x718053, youngHead: 0x718053, matureHead: 0x718053 },
  }[field.crop];
  const young = new THREE.Color(palette.young);
  const matureStalk = new THREE.Color(palette.matureStalk);
  const youngHead = new THREE.Color(palette.youngHead);
  const matureHead = new THREE.Color(palette.matureHead);
  return {
    stalk: young.lerp(matureStalk, THREE.MathUtils.smoothstep(maturity, 0.38, 0.9)),
    head: youngHead.lerp(matureHead, THREE.MathUtils.smoothstep(maturity, 0.48, 0.92)),
  };
}

function createLegacyCropStand(
  field: FarmFieldState,
  corners: FarmFieldCorners,
  getHeightAt: (x: number, z: number) => number,
): THREE.Group {
  const crops = new THREE.Group();
  crops.name = 'Stage-aware crop stand';
  if (
    field.stage === 'ploughing'
    || field.stage === 'sowing'
    || (field.crop !== 'fallow' && field.stage !== 'growing' && field.stage !== 'harvesting')
  ) {
    return crops;
  }

  const samples = fieldSamples(field, corners);
  if (field.crop === 'fallow') {
    const cover = samples.filter((sample) => sample.randomC > 0.11);
    const tufts = createInstancedTufts(
      createCerealStalkGeometry(),
      cover,
      getHeightAt,
      new THREE.Color(0x65794a),
      'Fallow grasses and volunteer plants',
      (sample) => 0.18 + clamp01(field.stageProgress) * (0.16 + sample.randomB * 0.08),
      (sample) => 0.72 + sample.randomA * 0.34,
    );
    tufts.castShadow = false;
    crops.add(tufts);
    return crops;
  }

  const maturity = cerealMaturity(field);
  const harvestProgress = field.stage === 'harvesting'
    ? clamp01(field.stageProgress)
    : 0;
  const standing: FieldSample[] = [];
  const harvested: FieldSample[] = [];
  for (const sample of samples) {
    const boundaryNoise = (sample.randomC - 0.5) * 0.14
      + Math.sin(sample.u * Math.PI * 5.2) * 0.028;
    if (field.stage === 'harvesting' && sample.v < harvestProgress + boundaryNoise) {
      harvested.push(sample);
    } else {
      standing.push(sample);
    }
  }

  const colors = cropColors(field, maturity);
  const matureHeight = {
    rye: 1.12,
    oats: 0.92,
    barley: 0.84,
    wheat: 0.9,
    flax: 0.82,
    fallow: 0.42,
  }[field.crop];
  const plantHeight = (sample: FieldSample): number => (
    THREE.MathUtils.lerp(0.2, matureHeight, THREE.MathUtils.smoothstep(maturity, 0.02, 0.88))
    * (0.87 + sample.randomB * 0.22)
  );
  const plantWidth = (sample: FieldSample): number => 0.84 + sample.randomA * 0.3;
  if (standing.length > 0) {
    crops.add(createInstancedTufts(
      field.crop === 'flax' ? createFlaxStemGeometry() : createCerealStalkGeometry(),
      standing,
      getHeightAt,
      colors.stalk,
      field.crop === 'flax'
        ? 'Standing flax stems'
        : field.crop === 'rye'
          ? 'Standing cereal stalks'
          : `Standing ${cropLabel(field.crop).toLowerCase()} stalks`,
      plantHeight,
      plantWidth,
    ));
    if (maturity >= GRAIN_HEAD_START_PROGRESS) {
      const headGeometry = field.crop === 'flax'
        ? createFlaxBlossomGeometry()
        : field.crop === 'oats'
          ? createOatPanicleGeometry()
          : createCerealHeadGeometry(field.crop === 'barley' ? 'barley' : field.crop === 'wheat' ? 'wheat' : 'rye');
      const headName = field.crop === 'flax'
        ? 'Flax blue blossoms'
        : field.crop === 'oats'
          ? 'Oat drooping panicles'
          : field.crop === 'barley'
            ? 'Barley long-awn heads'
            : field.crop === 'wheat'
              ? 'Wheat–rye maslin heads'
              : 'Pale awned grain heads';
      const heads = createInstancedTufts(
        headGeometry,
        standing,
        getHeightAt,
        colors.head,
        headName,
        plantHeight,
        plantWidth,
      );
      heads.castShadow = false;
      crops.add(heads);
    }
  }

  if (harvested.length > 0) {
    const stubble = createInstancedTufts(
      createStubbleGeometry(),
      harvested,
      getHeightAt,
      new THREE.Color(0xb18b4d),
      field.crop === 'flax' ? 'Pulled flax stubble' : 'Cut cereal stubble',
      (sample) => 0.76 + sample.randomB * 0.48,
      (sample) => 0.82 + sample.randomA * 0.28,
    );
    stubble.castShadow = false;
    crops.add(stubble);
  }
  return crops;
}

function cropComponentName(
  field: FarmFieldState,
  asset: FieldCropPhaseAsset,
): string {
  const cropName = field.crop === 'wheat' ? 'maslin' : field.crop;
  const component = field.crop === 'wheat'
    ? asset.speciesKey === 'rye' ? 'rye component' : 'wheat component'
    : asset.speciesKey;
  return `SeedThree ${cropName} ${component} ${asset.phase} cards`;
}

function createSeedThreeCropInstances(
  field: FarmFieldState,
  component: FieldCropComponentAsset,
  samples: readonly FieldSample[],
  maturity: number,
  getHeightAt: (x: number, z: number) => number,
): THREE.InstancedMesh | null {
  if (samples.length === 0) return null;
  const phaseAsset = maturity >= GRAIN_HEAD_START_PROGRESS
    ? component.mature
    : component.young;
  const geometry = phaseAsset.geometry.clone();
  const attributes = addSeedThreeGroundCoverInstanceAttributes(geometry, samples.length);
  const mesh = new THREE.InstancedMesh(geometry, phaseAsset.material, samples.length);
  mesh.name = cropComponentName(field, phaseAsset);
  // Dense crossed cards otherwise shadow one another into a black mass. The
  // worked soil, clods and perimeter vegetation retain the grounding shadows.
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.fieldCropSharedMaterial = true;
  mesh.userData.seedThreeFieldCrop = true;
  mesh.userData.gameCrop = field.crop === 'wheat' ? 'maslin' : field.crop;
  mesh.userData.seedThreeSpecies = phaseAsset.speciesName;
  mesh.userData.seedThreeLatin = phaseAsset.latin;
  mesh.userData.seedThreeCropPhase = phaseAsset.phase;
  mesh.userData.pbrTextureFiles = phaseAsset.textureFiles;

  const phaseProgress = phaseAsset.phase === 'young'
    ? THREE.MathUtils.smoothstep(maturity, 0.015, GRAIN_HEAD_START_PROGRESS)
    : THREE.MathUtils.smoothstep(maturity, GRAIN_HEAD_START_PROGRESS, 0.9);
  const startHeight = phaseAsset.phase === 'young'
    ? 0.075
    : component.young.referenceHeightMeters * 0.9;
  const targetHeightBase = THREE.MathUtils.lerp(
    startHeight,
    phaseAsset.referenceHeightMeters,
    phaseProgress,
  );
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const tint = new THREE.Color();
  const wind = new THREE.Vector3();
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]!;
    const height = targetHeightBase * (0.9 + sample.randomB * 0.19);
    const width = height * (0.9 + sample.randomA * 0.16);
    const yaw = sample.randomA * Math.PI * 2;
    position.set(
      sample.x,
      getHeightAt(sample.x, sample.z) + FIELD_LIFT - height * 0.055,
      sample.z,
    );
    quaternion.setFromAxisAngle(UP_AXIS, yaw);
    scale.set(width, height, width);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);

    tint.setHSL(
      phaseAsset.phase === 'young' ? 0.28 : 0.13,
      phaseAsset.phase === 'young' ? 0.12 : 0.035,
      0.92 + (sample.randomC - 0.5) * 0.1,
    );
    attributes.tint.setXYZ(index, tint.r, tint.g, tint.b);
    attributes.anchor.setXYZ(index, position.x, position.y, position.z);
    seedThreeGroundCoverWindVector(yaw, scale, wind);
    attributes.wind.setXYZ(index, wind.x, wind.y, wind.z);
    mesh.setColorAt(index, tint);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  attributes.tint.needsUpdate = true;
  attributes.anchor.needsUpdate = true;
  attributes.wind.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  return mesh;
}

function createSeedThreeCropStand(
  field: FarmFieldState,
  corners: FarmFieldCorners,
  getHeightAt: (x: number, z: number) => number,
  cropCatalog: FieldCropCatalog,
): THREE.Group {
  const crops = new THREE.Group();
  crops.name = 'SeedThree stage-aware crop stand';
  crops.userData.seedThreeOwned = true;
  crops.userData.gameCrop = field.crop === 'wheat' ? 'maslin' : field.crop;
  if (
    field.stage === 'ploughing'
    || field.stage === 'sowing'
    || (field.crop !== 'fallow' && field.stage !== 'growing' && field.stage !== 'harvesting')
  ) return crops;
  if (field.crop === 'fallow') {
    // Worked fallow is a land state, not a crop species. Its volunteer cover is
    // deliberately kept separate from the SeedThree crop-species contract.
    return createLegacyCropStand(field, corners, getHeightAt);
  }

  const maturity = cerealMaturity(field);
  const harvestProgress = field.stage === 'harvesting'
    ? clamp01(field.stageProgress)
    : 0;
  const standing: FieldSample[] = [];
  const harvested: FieldSample[] = [];
  for (const sample of fieldSamples(field, corners)) {
    const boundaryNoise = (sample.randomC - 0.5) * 0.14
      + Math.sin(sample.u * Math.PI * 5.2) * 0.028;
    if (field.stage === 'harvesting' && sample.v < harvestProgress + boundaryNoise) {
      harvested.push(sample);
    } else {
      standing.push(sample);
    }
  }

  const components = cropCatalog.components(field.crop);
  let cumulativeShare = 0;
  for (let componentIndex = 0; componentIndex < components.length; componentIndex += 1) {
    const component = components[componentIndex]!;
    const lower = cumulativeShare;
    cumulativeShare += component.share;
    const componentSamples = components.length === 1
      ? standing
      : standing.filter((sample) => (
        sample.randomC >= lower
        && (componentIndex === components.length - 1 || sample.randomC < cumulativeShare)
      ));
    const mesh = createSeedThreeCropInstances(
      field,
      component,
      componentSamples,
      maturity,
      getHeightAt,
    );
    if (mesh) crops.add(mesh);
  }

  if (harvested.length > 0) {
    const stubble = createInstancedTufts(
      createStubbleGeometry(),
      harvested,
      getHeightAt,
      new THREE.Color(0xb18b4d),
      field.crop === 'flax' ? 'Pulled flax stubble' : 'Cut cereal stubble',
      (sample) => 0.76 + sample.randomB * 0.48,
      (sample) => 0.82 + sample.randomA * 0.28,
    );
    stubble.castShadow = false;
    stubble.userData.deadCropResidue = true;
    crops.add(stubble);
  }
  return crops;
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    const renderable = object as THREE.Mesh;
    if (renderable.userData.fieldPerimeterSharedResource) {
      (renderable as THREE.InstancedMesh).dispose?.();
      return;
    }
    renderable.geometry?.dispose();
    const materials = Array.isArray(renderable.material) ? renderable.material : renderable.material ? [renderable.material] : [];
    for (const material of materials) {
      if (renderable.userData.fieldCropSharedMaterial === true) continue;
      material.dispose();
    }
  });
  root.clear();
}

export type FarmFieldMarkerOptions = {
  maxAnisotropy?: number;
  rendererBackend?: RendererBackendKind;
  soilDebugMode?: FieldSoilDebugMode;
  useSeedThreePerimeterShrubs?: boolean;
  useSeedThreeCrops?: boolean;
};

export class FarmFieldMarkers {
  private readonly root = new THREE.Group();
  private lastSignature = '';
  private readonly getHeightAt: (x: number, z: number) => number;
  private latestFields: FarmFieldState[] = [];
  private perimeterShrubs: FieldPerimeterShrubCatalog | null = null;
  private perimeterReady: Promise<void> = Promise.resolve();
  private cropCatalog: FieldCropCatalog | null = null;
  private cropReady: Promise<void> = Promise.resolve();
  private readonly seedThreeCropsRequested: boolean;
  private readonly rendererBackend: RendererBackendKind;
  private readonly soilDebugMode: FieldSoilDebugMode;
  private disposed = false;

  constructor(
    parent: THREE.Group,
    getHeightAt: (x: number, z: number) => number,
    options: FarmFieldMarkerOptions = {},
  ) {
    this.getHeightAt = getHeightAt;
    this.seedThreeCropsRequested = options.useSeedThreeCrops === true;
    this.rendererBackend = options.rendererBackend ?? 'webgl';
    this.soilDebugMode = options.soilDebugMode ?? 'final';
    this.root.name = 'Farm fields';
    parent.add(this.root);

    if (options.useSeedThreePerimeterShrubs) {
      this.perimeterReady = import('../props/ForestUndergrowth.ts').then(
        ({ createFieldPerimeterShrubCatalog }) => createFieldPerimeterShrubCatalog(
          options.maxAnisotropy ?? 4,
          options.rendererBackend,
        ),
      ).then(
        (catalog) => {
          if (this.disposed) {
            catalog.dispose();
            return;
          }
          this.perimeterShrubs = catalog;
          this.lastSignature = '';
          this.syncFields(this.latestFields);
        },
        (error: unknown) => {
          console.warn(
            '[SeedThree] field-perimeter shrub assets failed to load; the field edge will remain unplanted.',
            error,
          );
        },
      );
    }

    if (this.seedThreeCropsRequested) {
      this.cropReady = import('../vegetation/seedthree/fieldCropAssets.ts').then(
        ({ createFieldCropCatalog }) => createFieldCropCatalog(
          options.maxAnisotropy ?? 4,
          options.rendererBackend,
        ),
      ).then(
        (catalog) => {
          if (this.disposed) {
            catalog.dispose();
            return;
          }
          this.cropCatalog = catalog;
          this.lastSignature = '';
          this.syncFields(this.latestFields);
        },
        (error: unknown) => {
          console.warn(
            '[SeedThree] field-crop assets failed to load; crop stands will remain hidden rather than using proxy species.',
            error,
          );
        },
      );
    }
  }

  syncFields(fields: Iterable<FarmFieldState>): void {
    const list = [...fields];
    this.latestFields = list;
    const signature = list.map((field) => [
      field.id,
      field.crop,
      field.stage,
      Math.round(clamp01(field.stageProgress) * 40),
      Math.round(clamp01(field.fertility) * 20),
      field.corners.map((point) => `${point.x.toFixed(2)},${point.z.toFixed(2)}`).join(';'),
    ].join(':')).join('|');
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    disposeObject(this.root);
    for (const field of list) {
      const corners = field.corners as FarmFieldCorners;
      const group = new THREE.Group();
      group.name = `Field ${field.id}`;
      group.userData.visualContract = {
        seed: hashString(field.id),
        state: field.crop === 'fallow'
          ? 'fallow'
          : field.stage === 'ploughing' && field.stageProgress <= 0.01
            ? 'unploughed'
            : field.stage === 'ploughing'
              ? 'ploughed'
              : field.stage === 'sowing'
                ? field.stageProgress <= 0.01
                  ? 'ploughed'
                  : 'seeded'
                : field.stage,
        processedCoverage: field.stage === 'ploughing'
          ? clamp01(field.stageProgress)
          : 1,
        seededCoverage: field.stage === 'sowing'
          ? clamp01(field.stageProgress)
          : 0,
        soilIdentities: soilIdentityOrder(field),
        soilCoordinateDomain: 'world-xz-metres',
        soilOrganicRepeat: true,
        soilEdgeFadeMeters: FIELD_EDGE_FADE_METERS,
        crop: field.crop === 'wheat' ? 'maslin' : field.crop,
        cropAssetOwner: field.crop === 'fallow' ? 'none' : 'SeloSlav/SeedThree',
      };
      group.add(createSurface(
        field,
        corners,
        this.getHeightAt,
        this.rendererBackend,
        this.soilDebugMode,
      ));
      group.add(createFurrows(field, corners, this.getHeightAt));
      group.add(createSeededDrills(field, corners, this.getHeightAt));
      group.add(createSoilClods(field, corners, this.getHeightAt));
      group.add(this.cropCatalog
        ? createSeedThreeCropStand(field, corners, this.getHeightAt, this.cropCatalog)
        : this.seedThreeCropsRequested
          ? new THREE.Group()
          : createLegacyCropStand(field, corners, this.getHeightAt));
      group.add(createFieldEdge(field.id, corners, this.getHeightAt));
      this.root.add(group);
    }
    if (this.perimeterShrubs && list.length > 0) {
      this.root.add(createFieldPerimeterShrubGroup(
        list,
        this.getHeightAt,
        this.perimeterShrubs,
      ));
    }
  }

  whenPerimeterReady(): Promise<void> {
    return this.perimeterReady;
  }

  whenCropsReady(): Promise<void> {
    return this.cropReady;
  }

  dispose(): void {
    this.disposed = true;
    disposeObject(this.root);
    this.perimeterShrubs?.dispose();
    this.perimeterShrubs = null;
    this.cropCatalog?.dispose();
    this.cropCatalog = null;
    this.root.removeFromParent();
  }
}

/** Persistent exclusion overlay for the building that owns a linked parcel. */
export class LandParcelOriginFootprintPreview {
  readonly group = new THREE.Group();
  private readonly getHeightAt: (x: number, z: number) => number;
  private readonly fill: THREE.Mesh;
  private readonly border: THREE.Mesh;
  private lastSignature = '';

  constructor(getHeightAt: (x: number, z: number) => number) {
    this.getHeightAt = getHeightAt;
    this.group.name = 'Linked land-parcel origin footprint warning';
    this.group.frustumCulled = false;
    this.group.visible = false;

    this.fill = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0xff3e35,
        transparent: true,
        opacity: 0.28,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        fog: false,
        toneMapped: false,
      }),
    );
    this.fill.name = 'Linked chapel blocked footprint fill';
    this.fill.renderOrder = 16;
    this.fill.frustumCulled = false;
    this.group.add(this.fill);

    this.border = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0xff3e35,
        transparent: true,
        opacity: 0.94,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -5,
        polygonOffsetUnits: -5,
        fog: false,
        toneMapped: false,
      }),
    );
    this.border.name = 'Linked chapel blocked footprint border';
    this.border.renderOrder = 17;
    this.border.frustumCulled = false;
    this.group.add(this.border);
  }

  show(corners: FarmFieldCorners | null): void {
    if (!corners) {
      this.lastSignature = '';
      this.group.visible = false;
      return;
    }
    const signature = corners
      .map((point) => `${point.x.toFixed(3)},${point.z.toFixed(3)}`)
      .join('|');
    if (signature === this.lastSignature) {
      this.group.visible = true;
      return;
    }
    this.lastSignature = signature;
    this.group.visible = true;
    updateTerrainQuadGeometry(
      this.fill.geometry,
      corners,
      this.getHeightAt,
      0.12,
      7,
      7,
    );
    updateTerrainRibbonGeometry(
      this.border.geometry,
      polygonSegments(corners),
      this.getHeightAt,
      {
        width: 0.3,
        lift: 0.18,
        sampleSpacing: 0.75,
      },
    );
  }

  dispose(): void {
    clearOverlayGeometry(this.fill.geometry);
    clearOverlayGeometry(this.border.geometry);
    disposeObject3D(this.group, true);
    this.group.removeFromParent();
    this.group.clear();
  }
}

export class FarmFieldPreview {
  readonly group = new THREE.Group();
  private readonly getHeightAt: (x: number, z: number) => number;
  private readonly fill: THREE.Mesh;
  private readonly border: THREE.Mesh;
  private readonly guides: THREE.Mesh;
  private readonly cornerMarkers: THREE.InstancedMesh;
  private readonly hoverMarker: THREE.Mesh;
  private readonly cornerMatrix = new THREE.Matrix4();
  private lastSignature = '';

  constructor(getHeightAt: (x: number, z: number) => number) {
    this.getHeightAt = getHeightAt;
    this.group.name = 'Terrain-hugging land parcel preview';
    this.group.frustumCulled = false;
    this.group.visible = false;

    this.fill = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0xfffdf5,
        transparent: true,
        opacity: 0.11,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    this.fill.name = 'Farmland preview fill';
    this.fill.renderOrder = 12;
    this.fill.frustumCulled = false;
    this.group.add(this.fill);

    this.guides = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0xfffdf5,
        transparent: true,
        opacity: 0.48,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      }),
    );
    this.guides.name = 'Farmland internal guides';
    this.guides.renderOrder = 14;
    this.guides.frustumCulled = false;
    this.group.add(this.guides);

    this.border = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0xfffdf5,
        transparent: true,
        opacity: 0.94,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    );
    this.border.name = 'Farmland dotted border';
    this.border.renderOrder = 15;
    this.border.frustumCulled = false;
    this.group.add(this.border);

    // Use the same cursor ring and fixed corner anchors as residence plots.
    const cornerGeometry = new THREE.RingGeometry(0.25, 0.46, 20);
    cornerGeometry.rotateX(-Math.PI * 0.5);
    const markerMaterial = new THREE.MeshBasicMaterial({
      color: 0xfffdf5,
      transparent: true,
      opacity: 0.96,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.cornerMarkers = new THREE.InstancedMesh(cornerGeometry, markerMaterial, 4);
    this.cornerMarkers.name = 'Land parcel corner anchors';
    this.cornerMarkers.renderOrder = 17;
    this.cornerMarkers.frustumCulled = false;
    this.cornerMarkers.count = 0;
    this.cornerMarkers.visible = false;
    this.group.add(this.cornerMarkers);

    const hoverGeometry = new THREE.RingGeometry(0.22, 0.52, 20);
    hoverGeometry.rotateX(-Math.PI * 0.5);
    const hoverMaterial = markerMaterial.clone();
    hoverMaterial.opacity = 0.82;
    this.hoverMarker = new THREE.Mesh(hoverGeometry, hoverMaterial);
    this.hoverMarker.name = 'Land parcel hover anchor';
    this.hoverMarker.renderOrder = 17;
    this.hoverMarker.frustumCulled = false;
    this.hoverMarker.visible = false;
    this.group.add(this.hoverMarker);
  }

  show(
    corners: FarmFieldCorners | null,
    valid: boolean,
    _crop: FarmCrop,
    draftPath: readonly Point2[] = [],
    mode: 'field' | 'pasture' | 'graveyard' | 'vineyard' = 'field',
    placedPoints: readonly Point2[] = corners ?? [],
    hoverPoint: Point2 | null = null,
  ): void {
    const markerColor = corners ? valid ? 0xfffdf5 : 0xff5d50 : 0xffd27a;
    (this.cornerMarkers.material as THREE.MeshBasicMaterial).color.setHex(markerColor);
    (this.hoverMarker.material as THREE.MeshBasicMaterial).color.setHex(markerColor);
    this.cornerMarkers.count = Math.min(4, placedPoints.length);
    this.cornerMarkers.visible = this.cornerMarkers.count > 0;
    for (let index = 0; index < this.cornerMarkers.count; index += 1) {
      const point = placedPoints[index];
      this.cornerMatrix.makeTranslation(
        point.x,
        this.getHeightAt(point.x, point.z) + 0.2,
        point.z,
      );
      this.cornerMarkers.setMatrixAt(index, this.cornerMatrix);
    }
    this.cornerMarkers.instanceMatrix.needsUpdate = this.cornerMarkers.visible;
    this.hoverMarker.visible = hoverPoint !== null;
    if (hoverPoint) {
      this.hoverMarker.position.set(
        hoverPoint.x,
        this.getHeightAt(hoverPoint.x, hoverPoint.z) + 0.2,
        hoverPoint.z,
      );
    }
    if (!corners) {
      if (draftPath.length >= 2) {
        const signature = `draft|${mode}|${draftPath
          .map((point) => `${point.x.toFixed(2)},${point.z.toFixed(2)}`)
          .join('|')}`;
        if (signature === this.lastSignature) return;
        this.lastSignature = signature;
        this.group.visible = true;
        this.fill.visible = false;
        this.guides.visible = false;
        this.border.visible = true;
        (this.border.material as THREE.MeshBasicMaterial).color.setHex(0xffd27a);
        const segments: TerrainOverlaySegment[] = [];
        for (let index = 1; index < draftPath.length; index += 1) {
          segments.push([draftPath[index - 1], draftPath[index]]);
        }
        updateTerrainRibbonGeometry(
          this.border.geometry,
          segments,
          this.getHeightAt,
          {
            width: 0.16,
            lift: 0.16,
            sampleSpacing: 0.8,
          },
        );
        return;
      }
      this.lastSignature = '';
      this.fill.visible = false;
      this.guides.visible = false;
      this.border.visible = false;
      this.group.visible = this.cornerMarkers.visible || this.hoverMarker.visible;
      return;
    }

    const signature = `${mode}|${valid ? 1 : 0}|${corners
      .map((point) => `${point.x.toFixed(2)},${point.z.toFixed(2)}`)
      .join('|')}`;
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.group.visible = true;
    this.fill.visible = true;
    this.border.visible = true;

    const validColor = mode === 'pasture'
      ? 0xe8f3c8
      : mode === 'vineyard'
        ? 0xffe0a1
        : mode === 'graveyard'
          ? 0xe6e1d4
          : 0xfffdf5;
    const color = valid ? validColor : 0xff5d50;
    for (const mesh of [this.fill, this.guides, this.border]) {
      (mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    }
    (this.fill.material as THREE.MeshBasicMaterial).opacity = valid ? 0.11 : 0.085;

    updateTerrainQuadGeometry(
      this.fill.geometry,
      corners,
      this.getHeightAt,
      0.095,
      9,
      9,
    );
    updateTerrainRibbonGeometry(
      this.border.geometry,
      polygonSegments(corners),
      this.getHeightAt,
      {
        width: 0.18,
        lift: 0.16,
        sampleSpacing: 0.9,
        dashLength: mode === 'pasture' ? 2.1 : mode === 'vineyard' ? 1.15 : 1.5,
        gapLength: mode === 'pasture' ? 0.45 : mode === 'vineyard' ? 0.5 : 0.82,
      },
    );

    const width = Math.hypot(
      corners[1].x - corners[0].x,
      corners[1].z - corners[0].z,
    );
    const guideCount = Math.max(1, Math.min(16, Math.round(width / 5.2)));
    const guideSegments: TerrainOverlaySegment[] = [];
    for (let index = 1; index < guideCount; index += 1) {
      const u = index / guideCount;
      guideSegments.push([
        bilinearPoint(corners, u, 0),
        bilinearPoint(corners, u, 1),
      ]);
    }
    if (mode === 'field' || mode === 'vineyard') {
      updateTerrainRibbonGeometry(
        this.guides.geometry,
        guideSegments,
        this.getHeightAt,
        {
          width: mode === 'vineyard' ? 0.095 : 0.075,
          lift: 0.135,
          sampleSpacing: 0.8,
        },
      );
      this.guides.visible = Boolean(
        this.guides.geometry.getAttribute('position')?.count,
      );
    } else {
      clearOverlayGeometry(this.guides.geometry);
      this.guides.visible = false;
    }
  }

  dispose(): void {
    clearOverlayGeometry(this.fill.geometry);
    clearOverlayGeometry(this.border.geometry);
    clearOverlayGeometry(this.guides.geometry);
    disposeObject3D(this.group, true);
    this.group.removeFromParent();
    this.group.clear();
  }
}
