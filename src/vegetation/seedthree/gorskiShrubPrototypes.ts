import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { generateDichotomous } from '@seedthree/core/dichotomous.js';
import { buildFoliage } from '@seedthree/core/leaf-cards.js';
import { Rng } from '@seedthree/core/rng.js';
import { bilberry } from '@seedthree/species/bilberry.js';
import { commonJuniper } from '@seedthree/species/common-juniper.js';
import { raspberry } from '@seedthree/species/raspberry.js';
import { commonHornbeamHedge } from '@seedthree/species/common-hornbeam-hedge.js';

export type GorskiShrubKind = 'bush' | 'fern' | 'juniper' | 'raspberry' | 'field-hornbeam';

export type GorskiShrubPrototype = {
  geometry: THREE.BufferGeometry;
  fruitAnchors: ReadonlyArray<THREE.Vector3>;
  triangleCount: number;
};

type SeedThreeShrubPreset = {
  name: string;
  params: Record<string, unknown>;
  foliage: Record<string, unknown> & {
    clustersPerBranch?: number;
    parentSprays?: number;
    clusterSize?: number;
  };
};

type SeedThreeStem = {
  terminal: boolean;
  points: THREE.Vector3[];
  children: SeedThreeStem[];
};

export const GORSKI_SHRUB_VARIANT_COUNT = 3;
export const BILBERRY_FRUIT_ANCHOR_LIMIT = 14;
export const JUNIPER_BERRY_ANCHOR_LIMIT = 20;
export const RASPBERRY_FRUIT_ANCHOR_LIMIT = 10;

const PRESETS = {
  bush: bilberry as SeedThreeShrubPreset,
  juniper: commonJuniper as SeedThreeShrubPreset,
  raspberry: raspberry as SeedThreeShrubPreset,
  'field-hornbeam': commonHornbeamHedge as SeedThreeShrubPreset,
} as const;

export function createGorskiShrubPrototype(
  kind: GorskiShrubKind,
  variant: number,
): GorskiShrubPrototype {
  if (kind === 'fern') return createFernPrototype(variant);
  const species = PRESETS[kind];
  const seed = `gorski:${species.name}:${Math.abs(variant) % GORSKI_SHRUB_VARIANT_COUNT}`;
  const skeletonRng = new Rng(seed);
  const tipClearance = (species.foliage.clusterSize ?? 0.3) * 0.9;
  const generated = generateDichotomous(
    { ...species.params, tipClearance },
    skeletonRng,
  ) as {
    stems: SeedThreeStem[];
    terminalStems: SeedThreeStem[];
    geometry: THREE.BufferGeometry;
  };

  const foliageMaterial = new THREE.MeshBasicMaterial();
  const foliageRng = new Rng(`${seed}:sprays`);
  const config = { ...species.foliage, mode: 'clusters' };
  const terminalFoliage = buildFoliage(
    generated.terminalStems,
    config,
    foliageRng,
    foliageMaterial,
    null,
  ) as THREE.InstancedMesh | null;
  const parentFraction = species.foliage.parentSprays ?? 0;
  const parentStems = generated.stems.filter(
    (stem) => !stem.terminal && stem.children.some((child) => child.terminal),
  );
  const parentFoliage = parentFraction > 0 && parentStems.length > 0
    ? buildFoliage(
      parentStems,
      {
        ...config,
        clustersPerBranch: Math.max(
          1,
          Math.round((species.foliage.clustersPerBranch ?? 2) * parentFraction),
        ),
      },
      new Rng(`${seed}:parent-sprays`),
      foliageMaterial,
      null,
    ) as THREE.InstancedMesh | null
    : null;

  const branchGeometry = copySurfaceGeometry(generated.geometry);
  const foliageGeometries = [terminalFoliage, parentFoliage]
    .filter((mesh): mesh is THREE.InstancedMesh => Boolean(mesh))
    .map(bakeInstancedSurfaceGeometry);
  const foliageGeometry = mergeGeometries(foliageGeometries, false);
  if (!foliageGeometry) throw new Error(`Unable to bake foliage for ${species.name}`);
  const geometry = mergeGeometries([branchGeometry, foliageGeometry], true);
  if (!geometry) throw new Error(`Unable to merge shrub prototype for ${species.name}`);
  addRootWeightAttribute(geometry);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.gorskiShrubKind = kind;
  geometry.userData.gorskiShrubVariant = variant;
  geometry.userData.seedThreeGenerator = 'dichotomous/sprayClusters';

  const fruitAnchors = kind === 'bush'
    ? selectFoliageSurfaceAnchors(terminalFoliage, BILBERRY_FRUIT_ANCHOR_LIMIT, 0.18, 0.0045)
    : kind === 'juniper'
      ? selectFoliageSurfaceAnchors(terminalFoliage, JUNIPER_BERRY_ANCHOR_LIMIT)
      : selectFruitAnchors(
        generated.terminalStems,
        kind === 'raspberry' ? RASPBERRY_FRUIT_ANCHOR_LIMIT : 0,
      );

  terminalFoliage?.geometry.dispose();
  parentFoliage?.geometry.dispose();
  foliageMaterial.dispose();
  branchGeometry.dispose();
  foliageGeometry.dispose();
  return {
    geometry,
    fruitAnchors,
    triangleCount: triangleCount(geometry),
  };
}

function bakeInstancedSurfaceGeometry(mesh: THREE.InstancedMesh): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [];
  const matrix = new THREE.Matrix4();
  for (let index = 0; index < mesh.count; index++) {
    mesh.getMatrixAt(index, matrix);
    const piece = copySurfaceGeometry(mesh.geometry);
    piece.applyMatrix4(matrix);
    pieces.push(piece);
  }
  const merged = mergeGeometries(pieces, false);
  for (const piece of pieces) piece.dispose();
  if (!merged) throw new Error(`Unable to flatten ${mesh.name || 'SeedThree foliage'}`);
  return merged;
}

function copySurfaceGeometry(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv'] as const) {
    const attribute = source.getAttribute(name);
    if (attribute) geometry.setAttribute(name, attribute.clone());
  }
  if (source.index) geometry.setIndex(source.index.clone());
  return geometry;
}

function addRootWeightAttribute(geometry: THREE.BufferGeometry): void {
  geometry.computeBoundingBox();
  const positions = geometry.getAttribute('position');
  const minY = geometry.boundingBox?.min.y ?? 0;
  const height = Math.max(0.1, (geometry.boundingBox?.max.y ?? 1) - minY);
  const weights = new Float32Array(positions.count);
  for (let index = 0; index < positions.count; index++) {
    const heightFraction = THREE.MathUtils.clamp((positions.getY(index) - minY) / height, 0, 1);
    weights[index] = Math.pow(heightFraction, 1.45);
  }
  geometry.setAttribute('aRootWeight', new THREE.BufferAttribute(weights, 1));
}

function selectFruitAnchors(
  stems: ReadonlyArray<SeedThreeStem>,
  limit: number,
): THREE.Vector3[] {
  if (limit <= 0) return [];
  const candidates = stems
    .map((stem) => stem.points.at(-1)?.clone())
    .filter((point): point is THREE.Vector3 => Boolean(point))
    .sort((left, right) => right.y - left.y);
  const anchors: THREE.Vector3[] = [];
  for (const point of candidates) {
    if (point.y < 0.42) continue;
    if (anchors.some((anchor) => anchor.distanceToSquared(point) < 0.035)) continue;
    anchors.push(point.add(new THREE.Vector3(0, -0.035, 0)));
    if (anchors.length >= limit) break;
  }
  return anchors;
}

function selectFoliageSurfaceAnchors(
  foliage: THREE.InstancedMesh | null,
  limit: number,
  minimumHeight = 0.42,
  minimumSeparationSq = 0.012,
): THREE.Vector3[] {
  if (!foliage || limit <= 0) return [];
  const matrix = new THREE.Matrix4();
  const candidates: THREE.Vector3[] = [];
  for (let index = 0; index < foliage.count; index++) {
    foliage.getMatrixAt(index, matrix);
    const across = ((((index * 17) % 7) / 6) - 0.5) * 0.46;
    const along = 0.2 + ((index * 5) % 4) * 0.13;
    const face = index % 2 === 0 ? 0.04 : -0.04;
    candidates.push(new THREE.Vector3(across, along, face).applyMatrix4(matrix));
  }
  candidates.sort((left, right) => (
    right.y + Math.hypot(right.x, right.z) * 0.22
  ) - (
    left.y + Math.hypot(left.x, left.z) * 0.22
  ));
  const anchors: THREE.Vector3[] = [];
  for (const point of candidates) {
    if (point.y < minimumHeight) continue;
    if (anchors.some((anchor) => anchor.distanceToSquared(point) < minimumSeparationSq)) continue;
    anchors.push(point);
    if (anchors.length >= limit) break;
  }
  return anchors;
}

function createFernPrototype(variant: number): GorskiShrubPrototype {
  const rng = new Rng(`gorski:fern:${Math.abs(variant) % GORSKI_SHRUB_VARIANT_COUNT}`);
  const fronds: THREE.BufferGeometry[] = [];
  const frondCount = 9 + (variant % 3);
  for (let index = 0; index < frondCount; index++) {
    const angle = (index / frondCount) * Math.PI * 2 + rng.vary(0, 0.18);
    const length = rng.range(0.58, 0.92);
    const rise = rng.range(0.38, 0.72);
    const radial = rng.range(0.36, 0.66);
    const start = new THREE.Vector3(Math.cos(angle) * 0.025, 0, Math.sin(angle) * 0.025);
    const end = new THREE.Vector3(Math.cos(angle) * radial, rise, Math.sin(angle) * radial);
    const control1 = start.clone().lerp(end, 0.33).add(new THREE.Vector3(0, rise * 0.35, 0));
    const control2 = start.clone().lerp(end, 0.72).add(new THREE.Vector3(0, rise * 0.18, 0));
    const curve = new THREE.CubicBezierCurve3(start, control1, control2, end);
    fronds.push(createCurvedFrondRibbon(curve, length * rng.range(0.22, 0.31)));
  }
  const geometry = mergeGeometries(fronds, false);
  for (const frond of fronds) frond.dispose();
  if (!geometry) throw new Error('Unable to build Gorski fern prototype');
  // The fern albedo already carries a narrow, green rachis beneath the pinnae.
  // A second bark-textured tube made the same stem read as a thick black branch
  // and could protrude from the alpha-cutout leaf silhouette at the frond tip.
  geometry.clearGroups();
  geometry.addGroup(0, geometry.index?.count ?? geometry.getAttribute('position').count, 0);
  addRootWeightAttribute(geometry);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.gorskiShrubKind = 'fern';
  geometry.userData.gorskiShrubVariant = variant;
  geometry.userData.seedThreeGenerator = 'curved-radial-card-fronds';
  geometry.userData.fernRachisStrategy = 'foliage-card-owned';
  return { geometry, fruitAnchors: [], triangleCount: triangleCount(geometry) };
}

function createCurvedFrondRibbon(
  curve: THREE.Curve<THREE.Vector3>,
  maximumWidth: number,
): THREE.BufferGeometry {
  const segments = 7;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let segment = 0; segment <= segments; segment++) {
    const t = segment / segments;
    const center = curve.getPoint(t);
    const tangent = curve.getTangent(t).normalize();
    const right = new THREE.Vector3().crossVectors(tangent, up);
    if (right.lengthSq() < 1e-5) right.set(1, 0, 0);
    right.normalize();
    const width = maximumWidth * Math.sin(Math.PI * Math.pow(t, 0.82));
    for (const side of [-1, 1]) {
      positions.push(
        center.x + right.x * width * side,
        center.y + right.y * width * side,
        center.z + right.z * width * side,
      );
      normals.push(0, 1, 0);
      uvs.push(side < 0 ? 0 : 1, t);
    }
    if (segment < segments) {
      const base = segment * 2;
      indices.push(base, base + 1, base + 3, base, base + 3, base + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

function triangleCount(geometry: THREE.BufferGeometry): number {
  return (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
}
