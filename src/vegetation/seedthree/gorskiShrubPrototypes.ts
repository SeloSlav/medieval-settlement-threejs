import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildMergedMesh, generateDichotomous } from '@seedthree/core/dichotomous.js';
import { buildFoliage } from '@seedthree/core/leaf-cards.js';
import { Rng } from '@seedthree/core/rng.js';
import { bilberry } from '@seedthree/species/bilberry.js';
import { commonJuniper } from '@seedthree/species/common-juniper.js';
import { raspberry } from '@seedthree/species/raspberry.js';
import { commonHornbeamHedge } from '@seedthree/species/common-hornbeam-hedge.js';
import { aronia } from '@seedthree/species/aronia.js';
import { rosehip } from '@seedthree/species/rosehip.js';
import {
  commonDogwood,
  createCommonDogwoodVariantPreset,
  type CommonDogwoodArchitecture,
} from './commonDogwoodPreset.ts';
import {
  applyCommonDogwoodArchitecture,
  type CommonDogwoodArchitectureStats,
} from './commonDogwoodArchitecture.ts';
import { stingingNettle } from './stingingNettlePreset.ts';

export type GorskiShrubKind = 'bush' | 'fern' | 'juniper' | 'raspberry' | 'field-hornbeam' | 'aronia' | 'rosehip' | 'nettle' | 'dogwood';

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
    leavesPerBranch?: number;
    whorlSize?: number;
  };
};

type SeedThreeStem = {
  terminal: boolean;
  points: THREE.Vector3[];
  orients: THREE.Quaternion[];
  total: number;
  children: SeedThreeStem[];
};

export const GORSKI_SHRUB_VARIANT_COUNT = 3;
export const RASPBERRY_FRUIT_ANCHOR_LIMIT = 10;
export const GORSKI_SHRUB_TERMINAL_TAPER_START = 0.68;
export const GORSKI_SHRUB_TERMINAL_TIP_RADIUS_SCALE = 0.04;

const PRESETS = {
  bush: bilberry as SeedThreeShrubPreset,
  juniper: commonJuniper as SeedThreeShrubPreset,
  raspberry: raspberry as SeedThreeShrubPreset,
  'field-hornbeam': commonHornbeamHedge as SeedThreeShrubPreset,
  aronia: aronia as SeedThreeShrubPreset,
  rosehip: rosehip as SeedThreeShrubPreset,
  nettle: stingingNettle as SeedThreeShrubPreset,
  dogwood: commonDogwood as SeedThreeShrubPreset,
} as const;

export function createGorskiShrubPrototype(
  kind: GorskiShrubKind,
  variant: number,
): GorskiShrubPrototype {
  if (kind === 'fern') return createFernPrototype(variant);
  const dogwoodVariant = kind === 'dogwood'
    ? createCommonDogwoodVariantPreset(variant)
    : null;
  const species = (dogwoodVariant?.preset ?? PRESETS[kind]) as SeedThreeShrubPreset;
  const variantIndex = Math.abs(Math.trunc(variant)) % GORSKI_SHRUB_VARIANT_COUNT;
  const seed = dogwoodVariant?.seed ?? `gorski:${species.name}:${variantIndex}`;
  const skeletonRng = new Rng(seed);
  const tipClearance = (species.foliage.clusterSize ?? 0.3) * 0.9;
  const generatorParams = {
    ...species.params,
    // Leaf-bearing shrub shoots finish as a narrow growing point. Keeping
    // this integration-owned leaves SeedThree's thick cactus/yucca tips
    // unchanged while removing the blunt stem above the last leaf whorl.
    terminalTaperStart: GORSKI_SHRUB_TERMINAL_TAPER_START,
    terminalTipRadiusScale: GORSKI_SHRUB_TERMINAL_TIP_RADIUS_SCALE,
    tipClearance,
  };
  const generated = generateDichotomous(
    generatorParams,
    skeletonRng,
  ) as {
    stems: SeedThreeStem[];
    terminalStems: SeedThreeStem[];
    geometry: THREE.BufferGeometry;
  };
  let dogwoodArchitecture: CommonDogwoodArchitectureStats | null = null;
  if (dogwoodVariant) {
    dogwoodArchitecture = applyCommonDogwoodArchitecture(
      generated.stems,
      dogwoodVariant.morphology.architecture,
      dogwoodVariant.morphology.params.trunkSplayDeg,
      seed,
    );
    // The architecture pass deliberately preserves topology and only moves
    // existing stems, so rewrite SeedThree's connected tube mesh in place.
    buildMergedMesh(generated.stems, generatorParams, generated.geometry);
  }

  const foliageMaterial = new THREE.MeshBasicMaterial();
  const config = {
    ...species.foliage,
    mode: kind === 'nettle' || kind === 'dogwood' ? 'leaves' : 'clusters',
  };
  const terminalFoliage = dogwoodVariant
    ? buildDogwoodFoliageCohorts(
      generated.terminalStems,
      config,
      dogwoodVariant.morphology.architecture,
      seed,
      'terminal',
      foliageMaterial,
    )
    : [buildFoliage(
      generated.terminalStems,
      config,
      new Rng(`${seed}:sprays`),
      foliageMaterial,
      null,
    ) as THREE.InstancedMesh | null].filter(
      (mesh): mesh is THREE.InstancedMesh => Boolean(mesh),
    );
  const parentFraction = species.foliage.parentSprays ?? 0;
  const parentStems = generated.stems.filter(
    (stem) => !stem.terminal && stem.children.some((child) => child.terminal),
  );
  const parentConfig = {
    ...config,
    clustersPerBranch: Math.max(
      1,
      Math.round((species.foliage.clustersPerBranch ?? 2) * parentFraction),
    ),
  };
  const parentFoliage = parentFraction > 0 && parentStems.length > 0
    ? dogwoodVariant
      ? buildDogwoodFoliageCohorts(
        parentStems,
        parentConfig,
        dogwoodVariant.morphology.architecture,
        seed,
        'parent',
        foliageMaterial,
      )
      : [buildFoliage(
        parentStems,
        parentConfig,
        new Rng(`${seed}:parent-sprays`),
        foliageMaterial,
        null,
      ) as THREE.InstancedMesh | null].filter(
        (mesh): mesh is THREE.InstancedMesh => Boolean(mesh),
      )
    : [];

  const branchGeometry = copySurfaceGeometry(generated.geometry);
  if (dogwoodVariant) addDogwoodBranchWindProfile(branchGeometry, generated.geometry);
  const foliageMeshes = [...terminalFoliage, ...parentFoliage];
  const foliageGeometries = foliageMeshes
    .map((mesh) => bakeInstancedSurfaceGeometry(mesh, Boolean(dogwoodVariant)));
  const foliageGeometry = mergeGeometries(foliageGeometries, false);
  if (!foliageGeometry) throw new Error(`Unable to bake foliage for ${species.name}`);
  const geometry = mergeGeometries([branchGeometry, foliageGeometry], true);
  if (!geometry) throw new Error(`Unable to merge shrub prototype for ${species.name}`);
  if (dogwoodVariant) {
    interleaveDogwoodWindProfile(geometry);
  } else {
    addRootWeightAttribute(geometry);
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.gorskiShrubKind = kind;
  geometry.userData.gorskiShrubVariant = variant;
  geometry.userData.seedThreeGenerator = kind === 'nettle'
    ? 'dichotomous/opposite-paired-leaves'
    : kind === 'dogwood'
      ? 'basal-thicket/opposite-leaf-pairs'
      : 'dichotomous/sprayClusters';
  if (dogwoodVariant) {
    const { morphology } = dogwoodVariant;
    geometry.userData.gorskiShrubVariant = dogwoodVariant.variantIndex;
    geometry.userData.dogwoodStemCount = morphology.stemCount;
    geometry.userData.dogwoodGroundOriginStemCount = morphology.stemCount;
    geometry.userData.dogwoodStemBaseMaxY = 0;
    geometry.userData.dogwoodSeed = dogwoodVariant.seed;
    geometry.userData.dogwoodVariantId = morphology.id;
    geometry.userData.dogwoodAuthoredHeight = morphology.authoredHeight;
    geometry.userData.dogwoodFirstForkHeight = morphology.params.firstForkHeight;
    geometry.userData.dogwoodFoliageStartFraction = species.foliage.startFrac;
    geometry.userData.dogwoodArchitecture = 'irregular-stool-v1';
    geometry.userData.dogwoodRootBaseSpread = dogwoodArchitecture!.rootBaseSpread;
    geometry.userData.dogwoodRootAzimuthGapCv = dogwoodArchitecture!.rootAzimuthGapCv;
    geometry.userData.dogwoodFirstForkLengthRange = dogwoodArchitecture!.firstForkLengthRange;
    geometry.userData.dogwoodForkSiblingLengthRatio = dogwoodArchitecture!.meanForkSiblingLengthRatio;
    geometry.userData.dogwoodCrownCentroidOffsetRatio = dogwoodArchitecture!.crownCentroidOffsetRatio;
  }

  const fruitLimit = kind === 'raspberry'
    ? RASPBERRY_FRUIT_ANCHOR_LIMIT
    : kind === 'aronia'
      ? 12
      : kind === 'rosehip'
        ? 10
        : 0;
  const fruitAnchors = selectFruitAnchors(generated.terminalStems, fruitLimit);

  for (const mesh of foliageMeshes) mesh.geometry.dispose();
  foliageMaterial.dispose();
  branchGeometry.dispose();
  foliageGeometry.dispose();
  return {
    geometry,
    fruitAnchors,
    triangleCount: triangleCount(geometry),
  };
}

function buildDogwoodFoliageCohorts(
  stems: SeedThreeStem[],
  config: SeedThreeShrubPreset['foliage'],
  architecture: CommonDogwoodArchitecture,
  seed: string,
  layer: 'terminal' | 'parent',
  material: THREE.Material,
): THREE.InstancedMesh[] {
  if (stems.length === 0) return [];
  const whorlSize = Math.max(1, Math.round(Number(config.whorlSize ?? 2)));
  const leavesPerBranch = Math.max(
    whorlSize,
    Math.round(Number(config.leavesPerBranch ?? 8) / whorlSize) * whorlSize,
  );
  const nodesPerStem = leavesPerBranch / whorlSize;
  const densityRng = new Rng(`${seed}:${layer}:density-v1`);
  const gapAzimuth = architecture.lightGapAzimuthDeg * Math.PI / 180;
  const gapHalfWidth = architecture.foliageGapDeg * Math.PI / 360;
  const tipHeights = stems.map((stem) => stem.points.at(-1)!.y);
  const minimumTipHeight = Math.min(...tipHeights);
  const tipHeightSpan = Math.max(0.001, Math.max(...tipHeights) - minimumTipHeight);
  const weights = stems.map((stem, stemIndex) => {
    const tip = stem.points.at(-1)!;
    const angularDistance = Math.abs(shortestSignedAngle(
      Math.atan2(tip.z, tip.x) - gapAzimuth,
    ));
    const gapInfluence = 1 - THREE.MathUtils.smoothstep(
      angularDistance,
      gapHalfWidth * 0.58,
      gapHalfWidth * 1.18,
    );
    const gapWeight = THREE.MathUtils.lerp(
      1,
      architecture.foliageGapRetention,
      gapInfluence,
    );
    const massDirection = gapAzimuth + Math.PI;
    const massWeight = 1 + architecture.foliageMassBias * Math.cos(
      Math.atan2(tip.z, tip.x) - massDirection,
    );
    const heightPosition = (tipHeights[stemIndex]! - minimumTipHeight) / tipHeightSpan;
    const heightWeight = 1 + architecture.foliageHeightBias * (heightPosition * 2 - 1);
    const localVariation = 1 + densityRng.vary(
      0,
      architecture.foliageDensityVariation,
    );
    return Math.max(0.05, gapWeight * massWeight * heightWeight * localVariation);
  });
  const nodeCounts = allocateWeightedCounts(
    weights,
    stems.length * nodesPerStem,
    1,
    nodesPerStem + 4,
  );
  const cohorts = new Map<number, SeedThreeStem[]>();
  for (let index = 0; index < stems.length; index++) {
    const nodes = nodeCounts[index]!;
    const cohort = cohorts.get(nodes) ?? [];
    cohort.push(stems[index]!);
    cohorts.set(nodes, cohort);
  }

  const meshes: THREE.InstancedMesh[] = [];
  for (const [nodes, cohort] of [...cohorts].sort((left, right) => left[0] - right[0])) {
    const mesh = buildFoliage(
      cohort,
      {
        ...config,
        leavesPerBranch: nodes * whorlSize,
      },
      new Rng(`${seed}:${layer}:nodes:${nodes}`),
      material,
      null,
    ) as THREE.InstancedMesh | null;
    if (mesh) meshes.push(mesh);
  }
  return meshes;
}

function allocateWeightedCounts(
  weights: number[],
  target: number,
  minimum: number,
  maximum: number,
): number[] {
  const counts = new Array<number>(weights.length).fill(minimum);
  const remainingTarget = Math.max(0, target - minimum * weights.length);
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const fractions = weights.map((weight, index) => {
    const desired = remainingTarget * weight / Math.max(0.001, weightSum);
    const whole = Math.min(maximum - minimum, Math.floor(desired));
    counts[index] += whole;
    return desired - whole;
  });
  let remaining = target - counts.reduce((sum, count) => sum + count, 0);
  const descending = weights.map((_, index) => index).sort(
    (left, right) => fractions[right]! - fractions[left]!,
  );
  while (remaining > 0) {
    let changed = false;
    for (const index of descending) {
      if (counts[index]! >= maximum) continue;
      counts[index]!++;
      remaining--;
      changed = true;
      if (remaining === 0) break;
    }
    if (!changed) throw new Error('Dogwood foliage cohort allocation exhausted its upper bound');
  }
  while (remaining < 0) {
    let changed = false;
    for (const index of [...descending].reverse()) {
      if (counts[index]! <= minimum) continue;
      counts[index]!--;
      remaining++;
      changed = true;
      if (remaining === 0) break;
    }
    if (!changed) throw new Error('Dogwood foliage cohort allocation exhausted its lower bound');
  }
  return counts;
}

function shortestSignedAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function bakeInstancedSurfaceGeometry(
  mesh: THREE.InstancedMesh,
  preserveDogwoodWindProfile = false,
): THREE.BufferGeometry {
  const pieces: THREE.BufferGeometry[] = [];
  const matrix = new THREE.Matrix4();
  const sourceWeights = mesh.geometry.userData.windWeights as ArrayLike<number> | undefined;
  const sourcePhases = mesh.geometry.getAttribute('aThickness');
  for (let index = 0; index < mesh.count; index++) {
    mesh.getMatrixAt(index, matrix);
    const piece = copySurfaceGeometry(mesh.geometry);
    if (preserveDogwoodWindProfile) {
      const vertexCount = piece.getAttribute('position').count;
      const rootWeight = Number(sourceWeights?.[index] ?? 0);
      const leafPhase = sourcePhases ? sourcePhases.getX(index) : 0.7;
      piece.setAttribute(
        'aRootWeight',
        new THREE.BufferAttribute(new Float32Array(vertexCount).fill(rootWeight), 1),
      );
      piece.setAttribute(
        'aLeafPhase',
        new THREE.BufferAttribute(new Float32Array(vertexCount).fill(leafPhase), 1),
      );
    }
    piece.applyMatrix4(matrix);
    pieces.push(piece);
  }
  const merged = mergeGeometries(pieces, false);
  for (const piece of pieces) piece.dispose();
  if (!merged) throw new Error(`Unable to flatten ${mesh.name || 'SeedThree foliage'}`);
  return merged;
}

function addDogwoodBranchWindProfile(
  target: THREE.BufferGeometry,
  source: THREE.BufferGeometry,
): void {
  const sourceWind = source.getAttribute('aWind');
  const vertexCount = target.getAttribute('position').count;
  if (!sourceWind || sourceWind.count !== vertexCount) {
    throw new Error('Common dogwood branches require SeedThree fork-continuous wind weights');
  }
  target.setAttribute('aRootWeight', sourceWind.clone());
  target.setAttribute(
    'aLeafPhase',
    new THREE.BufferAttribute(new Float32Array(vertexCount), 1),
  );
}

/**
 * Dogwood keeps SeedThree's twig weight and per-leaf phase without adding a
 * ninth portable WebGPU vertex buffer. Both logical attributes share one
 * interleaved buffer; the other shrub species retain their cheaper scalar
 * height profile.
 */
function interleaveDogwoodWindProfile(geometry: THREE.BufferGeometry): void {
  const rootWeight = geometry.getAttribute('aRootWeight');
  const leafPhase = geometry.getAttribute('aLeafPhase');
  if (!rootWeight || !leafPhase || rootWeight.count !== leafPhase.count) {
    throw new Error('Common dogwood wind profile is incomplete after prototype merge');
  }
  const data = new THREE.InterleavedBuffer(new Float32Array(rootWeight.count * 2), 2);
  const interleavedRootWeight = new THREE.InterleavedBufferAttribute(data, 1, 0);
  const interleavedLeafPhase = new THREE.InterleavedBufferAttribute(data, 1, 1);
  for (let index = 0; index < rootWeight.count; index++) {
    interleavedRootWeight.setX(index, rootWeight.getX(index));
    interleavedLeafPhase.setX(index, leafPhase.getX(index));
  }
  geometry.setAttribute('aRootWeight', interleavedRootWeight);
  geometry.setAttribute('aLeafPhase', interleavedLeafPhase);
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
