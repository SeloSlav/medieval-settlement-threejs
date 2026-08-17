import * as THREE from 'three';
import { WIND_DIR } from '@seedthree/core/wind.js';
import type { FieldPerimeterShrubCatalog } from '../props/ForestUndergrowth.ts';
import type { FarmFieldState } from '../resources/types.ts';
import {
  isPointInPolygon2,
  polygonCentroid2,
  type Point2,
} from '../utils/polygonGeometry.ts';
import {
  hashParcelSeed,
  organicParcelBoundaryPoints,
  polylineSegments,
} from './organicParcelGeometry.ts';

export const FIELD_PERIMETER_SHRUB_SPACING_METERS = 1.35;
export const FIELD_PERIMETER_SHRUB_INSET_METERS = [0.48, 0.68] as const;
const FIELD_PERIMETER_MAX_SHRUBS = 320;
const TAU = Math.PI * 2;

export type FieldPerimeterShrubPlacement = {
  fieldId: string;
  x: number;
  z: number;
  yaw: number;
  scale: number;
  widthScale: number;
  leanDirection: number;
  lean: number;
  prototypeIndex: number;
  tint: readonly [number, number, number];
};

export function createFieldPerimeterShrubPlacements(
  fields: Iterable<FarmFieldState>,
): FieldPerimeterShrubPlacement[] {
  const placements: FieldPerimeterShrubPlacement[] = [];
  for (const field of fields) {
    const polygon = field.corners.map((point) => ({ x: point.x, z: point.z }));
    if (polygon.length < 3) continue;
    const center = polygonCentroid2(polygon);
    const seed = hashParcelSeed(`field-perimeter:${field.id}`);
    const boundary = organicParcelBoundaryPoints(polygon, hashParcelSeed(field.id), {
      spacing: 3.6,
      amplitude: 0.22,
    });
    const segments = polylineSegments(boundary, true);
    const perimeter = segments.reduce((sum, [start, end]) => (
      sum + Math.hypot(end.x - start.x, end.z - start.z)
    ), 0);
    const count = Math.max(
      8,
      Math.min(FIELD_PERIMETER_MAX_SHRUBS, Math.round(perimeter / FIELD_PERIMETER_SHRUB_SPACING_METERS)),
    );

    for (let index = 0; index < count; index += 1) {
      const jitter = (random01(seed, index, 0x51f15e) - 0.5) * 0.46;
      const boundaryPoint = sampleClosedPolyline(
        segments,
        perimeter,
        (index + 0.5 + jitter) / count,
      );
      const towardCenterX = center.x - boundaryPoint.x;
      const towardCenterZ = center.z - boundaryPoint.z;
      const towardCenterLength = Math.max(1e-5, Math.hypot(towardCenterX, towardCenterZ));
      const inset = THREE.MathUtils.lerp(
        FIELD_PERIMETER_SHRUB_INSET_METERS[0],
        FIELD_PERIMETER_SHRUB_INSET_METERS[1],
        random01(seed, index, 0x9d86a3),
      );
      let x = boundaryPoint.x + (towardCenterX / towardCenterLength) * inset;
      let z = boundaryPoint.z + (towardCenterZ / towardCenterLength) * inset;
      if (!isPointInPolygon2({ x, z }, polygon)) {
        // Convex authored fields normally take the narrow inset above. This
        // conservative fallback also keeps future irregular parcels inside
        // the authoritative grass/wildflower exclusion polygon.
        x = boundaryPoint.x + towardCenterX * 0.08;
        z = boundaryPoint.z + towardCenterZ * 0.08;
      }

      const scale = THREE.MathUtils.lerp(0.9, 1.16, random01(seed, index, 0xd1b54a));
      placements.push({
        fieldId: field.id,
        x,
        z,
        yaw: random01(seed, index, 0x6c8e9c) * TAU,
        scale,
        widthScale: scale * THREE.MathUtils.lerp(1, 1.18, random01(seed, index, 0xa4c73d)),
        leanDirection: random01(seed, index, 0x3f19b7) * TAU,
        lean: THREE.MathUtils.lerp(0.035, 0.12, random01(seed, index, 0x8875ad)),
        prototypeIndex: Math.floor(random01(seed, index, 0xc2b2ae) * catalogVariantCount()),
        tint: [
          THREE.MathUtils.lerp(0.76, 0.91, random01(seed, index, 0x165667)),
          THREE.MathUtils.lerp(0.81, 0.96, random01(seed, index, 0x27d4eb)),
          THREE.MathUtils.lerp(0.69, 0.84, random01(seed, index, 0x85ebca)),
        ],
      });
    }
  }
  return placements;
}

export function createFieldPerimeterShrubGroup(
  fields: Iterable<FarmFieldState>,
  getHeightAt: (x: number, z: number) => number,
  catalog: FieldPerimeterShrubCatalog,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'SeedThree field-perimeter shrubs';
  const placements = createFieldPerimeterShrubPlacements(fields);
  const buckets = catalog.prototypes.map(() => [] as FieldPerimeterShrubPlacement[]);
  for (const placement of placements) {
    buckets[placement.prototypeIndex % buckets.length]!.push(placement);
  }

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const color = new THREE.Color();
  const wind = new THREE.Vector3();
  const windQuaternion = new THREE.Quaternion();
  const yAxis = new THREE.Vector3(0, 1, 0);

  for (let prototypeIndex = 0; prototypeIndex < catalog.prototypes.length; prototypeIndex += 1) {
    const prototype = catalog.prototypes[prototypeIndex]!;
    const bucket = buckets[prototypeIndex]!;
    if (bucket.length === 0) continue;
    const tintAttribute = new THREE.InstancedBufferAttribute(new Float32Array(bucket.length * 3), 3);
    const anchorAttribute = new THREE.InstancedBufferAttribute(new Float32Array(bucket.length * 3), 3);
    const windAttribute = new THREE.InstancedBufferAttribute(new Float32Array(bucket.length * 3), 3);
    prototype.geometry.setAttribute('aTint', tintAttribute);
    prototype.geometry.setAttribute('aAnchorPos', anchorAttribute);
    prototype.geometry.setAttribute('aWindVec', windAttribute);

    const mesh = new THREE.InstancedMesh(
      prototype.geometry,
      catalog.materials,
      bucket.length,
    );
    mesh.name = `SeedThree field-perimeter hornbeam hedge shrubs variant ${prototypeIndex + 1}`;
    mesh.count = bucket.length;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.renderOrder = 4;
    mesh.userData.fieldPerimeterSharedResource = true;
    mesh.userData.boundaryLayer = 'inside-before-meadow-grass-and-wildflowers';
    mesh.userData.prototypeTriangleCount = prototype.triangleCount;

    for (let index = 0; index < bucket.length; index += 1) {
      const placement = bucket[index]!;
      position.set(
        placement.x,
        getHeightAt(placement.x, placement.z) + 0.08,
        placement.z,
      );
      quaternion.setFromEuler(new THREE.Euler(
        Math.cos(placement.leanDirection) * placement.lean,
        placement.yaw,
        Math.sin(placement.leanDirection) * placement.lean * 0.7,
        'YXZ',
      ));
      scale.set(placement.widthScale, placement.scale, placement.widthScale);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);

      const [r, g, b] = placement.tint;
      tintAttribute.setXYZ(index, r, g, b);
      anchorAttribute.setXYZ(index, position.x, position.y, position.z);
      windQuaternion.setFromAxisAngle(yAxis, -placement.yaw);
      wind.copy(WIND_DIR).applyQuaternion(windQuaternion);
      wind.set(
        wind.x / scale.x,
        wind.y / scale.y,
        wind.z / scale.z,
      );
      windAttribute.setXYZ(index, wind.x, wind.y, wind.z);
      mesh.setColorAt(index, color.setRGB(r, g, b));
    }

    mesh.instanceMatrix.needsUpdate = true;
    tintAttribute.needsUpdate = true;
    anchorAttribute.needsUpdate = true;
    windAttribute.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  group.userData.placementCount = placements.length;
  group.userData.spacingMeters = FIELD_PERIMETER_SHRUB_SPACING_METERS;
  group.userData.insetMeters = [...FIELD_PERIMETER_SHRUB_INSET_METERS];
  group.userData.boundaryLayer = 'inside-before-meadow-grass-and-wildflowers';
  return group;
}

function catalogVariantCount(): number {
  return 3;
}

function sampleClosedPolyline(
  segments: ReadonlyArray<readonly [Point2, Point2]>,
  totalLength: number,
  fraction: number,
): Point2 {
  if (segments.length === 0 || totalLength <= 1e-6) return { x: 0, z: 0 };
  const wrappedFraction = ((fraction % 1) + 1) % 1;
  const target = wrappedFraction * totalLength;
  let traversed = 0;
  for (const [start, end] of segments) {
    const length = Math.hypot(end.x - start.x, end.z - start.z);
    if (traversed + length >= target) {
      const t = length <= 1e-6 ? 0 : (target - traversed) / length;
      return {
        x: start.x + (end.x - start.x) * t,
        z: start.z + (end.z - start.z) * t,
      };
    }
    traversed += length;
  }
  return { ...segments.at(-1)![1] };
}

function random01(seed: number, index: number, salt: number): number {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1) ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return ((value ^ (value >>> 15)) >>> 0) / 4_294_967_296;
}
