import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { buildTree, forestBarkMaterial } from '@seedthree/core/tree.js';
import { forestCardMaterial } from '@seedthree/core/branch-cards.js';
import {
  createForestCanopyCompanions,
  createForestLodSelector,
  selectForestLods,
} from '@seedthree/core/forest-lod.js';
import {
  buildForestEdgeEcology,
  createForestEdgeEcology,
  type ForestEcologyStats,
} from '@seedthree/core/forest-ecology.js';
import { Rng } from '@seedthree/core/rng.js';
import type { Terrain } from '../../terrain/Terrain.ts';
import { CENTRAL_CLEARING_RADIUS } from '../../props/forestField.ts';
import type { ForestTreePlacement } from '../../props/forestPlacements.ts';
import {
  GORSKI_KOTAR_PRESETS,
  resolveSeedThreePreset,
  seedThreeScaleForPreset,
  type SeedThreePresetKey,
} from './gorskiKotarSpecies.ts';
import { GORSKI_KOTAR_SPECIES } from './gorskiKotarPresets.ts';
import { loadSeedThreeSpeciesAssets, type SeedThreeSpeciesAssets } from './seedThreeAssets.ts';
import { ensureSeedThreeBranchCards } from './seedThreeBranchCards.ts';
import type { SeedThreeForestController } from './seedThreeForestTypes.ts';
import {
  writeSeedThreeLodMatrices,
  type SeedThreeInstancedLodSet as InstancedLodSet,
  type SeedThreeTreeSlot as TreeSlot,
} from './seedThreeForestCompaction.ts';
import { yieldToMain } from '../../utils/yieldToMain.ts';

type SpeciesBucket = {
  preset: SeedThreePresetKey;
  slots: TreeSlot[];
  nearSet: InstancedLodSet;
  overviewSet: InstancedLodSet;
  successionSet: InstancedLodSet;
  successionSlots: TreeSlot[];
  nearSlotIndices: number[];
  overviewSlotIndices: number[];
  successionSlotIndices: number[];
};

export type SeedThreeForestInstances = {
  group: THREE.Group;
  ecology: ReturnType<typeof buildForestEdgeEcology>;
  placements: ForestTreePlacement[];
  buckets: SpeciesBucket[];
  slotByLayoutIndex: Array<{ bucketIndex: number; slotIndex: number } | null>;
  successionByLayoutIndex: Array<Array<{ bucketIndex: number; slotIndex: number }>>;
  hiddenMatrix: THREE.Matrix4;
  visibilitySelector: ReturnType<typeof createForestLodSelector>;
  successionEnabled: boolean;
  renderStats: SeedThreeForestRenderStats;
};

export type SeedThreeForestRenderStats = {
  totalTrees: number;
  visibleTrees: number;
  nearTrees: number;
  overviewTrees: number;
  culledTrees: number;
  revision: number;
};

const FOREST_LOD_OPTS = {
  mobileTarget: true,
  meshQuality: 0.78,
  lod1Dist: 48,
  lod2Dist: 96,
  lod1Density: 0.88,
  lod2Density: 0.72,
  lod1Pct: 42,
  lod2Pct: 14,
};

const FOREST_NEAR_DISTANCE = 108;
const FOREST_FIRST_PERSON_NEAR_DISTANCE = 132;
const FOREST_VISIBILITY_PADDING = 26;
const FOREST_SUCCESSION_OPTS = {
  neighborRadius: 32,
  maxCompanions: 2,
  denseNeighborCount: 4,
  minOffset: 3.2,
  maxOffset: 7.2,
  minScale: 0.3,
  maxScale: 0.46,
};
const FOREST_EDGE_ECOLOGY_OPTS = {
  protectedRadius: CENTRAL_CLEARING_RADIUS + 18,
  outerRadius: 175,
  neighborRadius: 34,
  minimumNeighbors: 2,
  minimumAnchorSpacing: 9,
  maxAnchors: 96,
  maxSaplings: 96,
  maxUnderstory: 192,
  maxDeadwood: 32,
  maxLitter: 192,
};

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const COMPOSE_POS = new THREE.Vector3();
const COMPOSE_QUAT = new THREE.Quaternion();
const COMPOSE_SCALE = new THREE.Vector3();
const COMPOSE_MATRIX = new THREE.Matrix4();

function composeTreeMatrix(
  x: number,
  y: number,
  z: number,
  rotY: number,
  scale: number,
): THREE.Matrix4 {
  COMPOSE_QUAT.setFromAxisAngle(Y_AXIS, rotY);
  COMPOSE_POS.set(x, y, z);
  COMPOSE_SCALE.setScalar(scale);
  return COMPOSE_MATRIX.compose(COMPOSE_POS, COMPOSE_QUAT, COMPOSE_SCALE).clone();
}

function findLodLevel(tree: THREE.LOD, lodName: string): THREE.Object3D | undefined {
  const levels = tree.levels as Array<{ distance: number; object: THREE.Object3D }>;
  return levels.find((level) => level.object.userData.lodName === lodName)?.object;
}

function createInstancedLodSet(
  sourceLevel: THREE.Object3D | undefined,
  slots: TreeSlot[],
  rng: Rng,
  debugName: string,
  options: {
    includeBranches?: boolean;
    castShadow?: boolean;
  } = {},
): InstancedLodSet {
  const groupCount = slots.length;
  const lodSet: InstancedLodSet = { branches: null, cards: [] };
  if (!sourceLevel) return lodSet;
  const includeBranches = options.includeBranches ?? true;
  const castShadow = options.castShadow ?? true;

  for (const child of sourceLevel.children) {
    const instancedChild = child as THREE.InstancedMesh;
    if (includeBranches && child.type === 'Mesh' && !instancedChild.isInstancedMesh) {
      const mesh = child as THREE.Mesh;
      const geo = mesh.geometry.clone();
      geo.userData.forestClone = true;
      geo.setAttribute('aWindVec', new THREE.InstancedBufferAttribute(new Float32Array(groupCount * 3), 3));
      geo.setAttribute('aAnchorPos', new THREE.InstancedBufferAttribute(new Float32Array(groupCount * 3), 3));
      const im = new THREE.InstancedMesh(geo, forestBarkMaterial(mesh.material as THREE.Material), groupCount);
      im.name = `${debugName} branches`;
      im.castShadow = castShadow;
      im.receiveShadow = true;
      im.userData.neverCastShadow = !castShadow;
      // SeedThree performs conservative per-tree culling and compacts the live
      // instances; the aggregate mesh bound is intentionally not consulted.
      im.frustumCulled = false;
      lodSet.branches = im;
    } else if ((child as THREE.Group).isGroup) {
      for (const cardsMesh of (child as THREE.Group).children) {
        const instanced = cardsMesh as THREE.InstancedMesh;
        if (!instanced.isInstancedMesh) continue;
        const cardsPerTree = instanced.count;
        const total = cardsPerTree * groupCount;
        const geo = instanced.geometry.clone();
        geo.userData.forestClone = true;
        const thickness = new Float32Array(total);
        for (let t = 0; t < total; t++) thickness[t] = 0.4 + 0.6 * rng.next();
        geo.setAttribute('aThickness', new THREE.InstancedBufferAttribute(thickness, 1));
        geo.setAttribute('aTreeOrigin', new THREE.InstancedBufferAttribute(new Float32Array(total * 3), 3));
        geo.setAttribute('aWindVec', new THREE.InstancedBufferAttribute(new Float32Array(total * 3), 3));
        geo.setAttribute('aAnchorPos', new THREE.InstancedBufferAttribute(new Float32Array(total * 3), 3));

        const rebuilt = new Set(['aThickness', 'aTreeOrigin', 'aWindVec', 'aAnchorPos']);
        for (const [name, attr] of Object.entries(instanced.geometry.attributes)) {
          const instancedAttr = attr as THREE.InstancedBufferAttribute;
          if (!instancedAttr.isInstancedBufferAttribute || rebuilt.has(name)) continue;
          const arr = new Float32Array(total * instancedAttr.itemSize);
          for (let slot = 0; slot < groupCount; slot++) {
            arr.set(
              instancedAttr.array.subarray(0, cardsPerTree * instancedAttr.itemSize),
              slot * cardsPerTree * instancedAttr.itemSize,
            );
          }
          geo.setAttribute(name, new THREE.InstancedBufferAttribute(arr, instancedAttr.itemSize));
        }

        const fmat = instanced.userData.shareMaterial
          ? instanced.material
          : forestCardMaterial(instanced.material as THREE.Material);
        const im = new THREE.InstancedMesh(geo, fmat as THREE.Material, total) as THREE.InstancedMesh & {
          userData: Record<string, unknown>;
        };
        im.name = `${debugName} cards`;
        im.castShadow = castShadow;
        im.receiveShadow = true;
        im.frustumCulled = false;
        im.userData.neverCastShadow = !castShadow;
        im.userData.src = instanced;
        im.userData.k = cardsPerTree;

        const snap = new Float32Array(cardsPerTree * 16);
        const cardMatrix = new THREE.Matrix4();
        for (let j = 0; j < cardsPerTree; j++) {
          instanced.getMatrixAt(j, cardMatrix);
          snap.set(cardMatrix.elements, j * 16);
        }
        im.userData.srcMatrices = snap;
        im.userData.weights = (instanced.userData.windWeights as Float32Array | undefined)?.slice() ?? null;
        lodSet.cards.push(im);
      }
    }
  }

  return lodSet;
}

function createSpeciesBucket(
  presetKey: SeedThreePresetKey,
  slots: TreeSlot[],
  successionSlots: TreeSlot[],
  prototype: THREE.LOD,
  rng: Rng,
): SpeciesBucket {
  const nearLevel = findLodLevel(prototype, 'LOD2');
  // Prefer SeedThree's deepest authored overview rung; live visual validation
  // confirms its reduced whole-limb cards retain a readable settlement-scale
  // crown while materially reducing distant tree instances.
  const overviewLevel = findLodLevel(prototype, 'LOD4')
    ?? findLodLevel(prototype, 'LOD3')
    ?? nearLevel;
  const nearSet = createInstancedLodSet(
    nearLevel,
    slots,
    rng,
    `${presetKey} near LOD2`,
  );
  const overviewSet = createInstancedLodSet(
    overviewLevel,
    slots,
    new Rng(`overview:${presetKey}`),
    `${presetKey} overview ${overviewLevel?.userData.lodName ?? 'LOD2'}`,
  );
  // Succession crowns reuse SeedThree's lowest-cost authored foliage cards,
  // omit duplicate trunks, and never enter the shadow-caster pass.
  const successionSet = createInstancedLodSet(
    overviewLevel,
    successionSlots,
    new Rng(`succession:${presetKey}`),
    `${presetKey} overview succession`,
    { includeBranches: false, castShadow: false },
  );
  const nearSlotIndices = slots.map((_, index) => index);
  const overviewSlotIndices: number[] = [];
  const successionSlotIndices: number[] = [];
  writeSeedThreeLodMatrices(nearSet, slots, nearSlotIndices);
  writeSeedThreeLodMatrices(overviewSet, slots, overviewSlotIndices);
  writeSeedThreeLodMatrices(successionSet, successionSlots, successionSlotIndices);
  return {
    preset: presetKey,
    slots,
    nearSet,
    overviewSet,
    successionSet,
    successionSlots,
    nearSlotIndices,
    overviewSlotIndices,
    successionSlotIndices,
  };
}

export async function createSeedThreeForest(
  placements: ForestTreePlacement[],
  terrain: Terrain,
  maxAnisotropy: number,
  treeSeed: number,
  renderer: WebGPURenderer,
  isBlockedAt?: (x: number, z: number) => boolean,
): Promise<SeedThreeForestInstances> {
  const rng = new Rng(`gorski-kotar:${treeSeed}`);
  const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  const group = new THREE.Group();
  group.name = 'SeedThree Gorski Kotar forest';

  const assetsByPreset = new Map<SeedThreePresetKey, SeedThreeSpeciesAssets>();
  const prototypeByPreset = new Map<SeedThreePresetKey, THREE.LOD>();

  for (const presetKey of GORSKI_KOTAR_PRESETS) {
    const species = GORSKI_KOTAR_SPECIES[presetKey];
    if (!species) continue;
    const assets = await loadSeedThreeSpeciesAssets(species, maxAnisotropy);
    assetsByPreset.set(presetKey, assets);
    const branchCards = await ensureSeedThreeBranchCards(
      renderer,
      species,
      assets,
      FOREST_LOD_OPTS.mobileTarget,
    );
    if (!branchCards) {
      console.warn('[SeedThree] no branch cards for', presetKey, '— foliage may be missing');
    }
    const { group: prototype } = buildTree(species, `prototype:${presetKey}`, assets, {
      ...FOREST_LOD_OPTS,
      branchCards: branchCards ?? undefined,
    });
    prototypeByPreset.set(presetKey, prototype as THREE.LOD);
    await yieldToMain();
  }

  const placementsByPreset = new Map<SeedThreePresetKey, TreeSlot[]>();
  const successionByPreset = new Map<SeedThreePresetKey, TreeSlot[]>();
  const sourceByLayoutIndex: Array<{
    preset: SeedThreePresetKey;
    scale: number;
    rotation: number;
    slot: TreeSlot;
  } | null> = Array.from({ length: placements.length }, () => null);
  const visibilityItems: Array<{ x: number; y: number; z: number; radius: number }> = Array.from(
    { length: placements.length },
    () => ({ x: 0, y: 0, z: 0, radius: 1 }),
  );
  const slotByLayoutIndex: Array<{ bucketIndex: number; slotIndex: number } | null> = Array.from(
    { length: placements.length },
    () => null,
  );

  placements.forEach((placement, layoutIndex) => {
    const preset = resolveSeedThreePreset(placement.species);
    const scale = seedThreeScaleForPreset(preset, placement.scale);
    const rootY = terrain.getHeightAt(placement.x, placement.z);
    const rotY = rng.range(0, Math.PI * 2);
    const matrix = composeTreeMatrix(placement.x, rootY - 0.15 * scale, placement.z, rotY, scale);
    const speciesHeight = Number(GORSKI_KOTAR_SPECIES[preset]?.params?.scale ?? 20) * scale;
    const visibilityRadius = Math.max(5, speciesHeight * 0.58);
    const visibilityCenter = new THREE.Vector3(
      placement.x,
      rootY + speciesHeight * 0.5,
      placement.z,
    );
    const slot: TreeSlot = {
      layoutIndex,
      matrix,
      pos: new THREE.Vector3(placement.x, rootY, placement.z),
      visibilityCenter,
      visibilityRadius,
      enabled: true,
    };
    visibilityItems[layoutIndex] = {
      x: visibilityCenter.x,
      y: visibilityCenter.y,
      z: visibilityCenter.z,
      radius: visibilityRadius,
    };
    const bucket = placementsByPreset.get(preset) ?? [];
    bucket.push(slot);
    placementsByPreset.set(preset, bucket);
    sourceByLayoutIndex[layoutIndex] = {
      preset,
      scale,
      rotation: rotY,
      slot,
    };
  });

  const companionSpecs = createForestCanopyCompanions(
    visibilityItems,
    FOREST_SUCCESSION_OPTS,
  );
  companionSpecs.forEach((specs, layoutIndex) => {
    const source = sourceByLayoutIndex[layoutIndex];
    if (!source) return;
    for (const spec of specs) {
      const x = source.slot.pos.x + spec.offsetX;
      const z = source.slot.pos.z + spec.offsetZ;
      // The founders' meadow remains a deliberate negative space. Companions
      // only thicken the established edge beyond it and are rejected by the
      // same road/building/water predicate used for gameplay placements.
      if (Math.hypot(x, z) < CENTRAL_CLEARING_RADIUS + 4) continue;
      if (isBlockedAt?.(x, z)) continue;
      const scale = source.scale * spec.scale;
      const rootY = terrain.getHeightAt(x, z);
      const speciesHeight = Number(
        GORSKI_KOTAR_SPECIES[source.preset]?.params?.scale ?? 20,
      ) * scale;
      const slot: TreeSlot = {
        layoutIndex,
        matrix: composeTreeMatrix(
          x,
          rootY - 0.15 * scale,
          z,
          source.rotation + spec.rotation,
          scale,
        ),
        pos: new THREE.Vector3(x, rootY, z),
        visibilityCenter: new THREE.Vector3(
          x,
          rootY + speciesHeight * 0.5,
          z,
        ),
        visibilityRadius: Math.max(2, speciesHeight * 0.58),
        enabled: true,
        visibilityParent: source.slot,
      };
      const successionSlots = successionByPreset.get(source.preset) ?? [];
      successionSlots.push(slot);
      successionByPreset.set(source.preset, successionSlots);
    }
  });
  const ecologySpecs = createForestEdgeEcology(
    visibilityItems,
    {
      ...FOREST_EDGE_ECOLOGY_OPTS,
      isBlockedAt: (x, z) => isBlockedAt?.(x, z) ?? false,
    },
  );
  const ecology = buildForestEdgeEcology(ecologySpecs, {
    name: 'SeedThree layered Gorski clearing-edge ecology',
    getHeightAt: (x, z) => terrain.getHeightAt(x, z),
  });

  const buckets: SpeciesBucket[] = [];
  const successionByLayoutIndex: Array<Array<{ bucketIndex: number; slotIndex: number }>> =
    Array.from({ length: placements.length }, () => []);

  for (const presetKey of GORSKI_KOTAR_PRESETS) {
    const slots = placementsByPreset.get(presetKey);
    if (!slots?.length) continue;
    const prototype = prototypeByPreset.get(presetKey);
    if (!prototype) continue;

    const bucketIndex = buckets.length;
    slots.forEach((slot, slotIndex) => {
      slotByLayoutIndex[slot.layoutIndex] = { bucketIndex, slotIndex };
    });

    const successionSlots = successionByPreset.get(presetKey) ?? [];
    successionSlots.forEach((slot, slotIndex) => {
      successionByLayoutIndex[slot.layoutIndex]?.push({ bucketIndex, slotIndex });
    });
    buckets.push(createSpeciesBucket(
      presetKey,
      slots,
      successionSlots,
      prototype,
      new Rng(`bucket:${presetKey}:${treeSeed}`),
    ));
  }

  for (const bucket of buckets) {
    if (bucket.nearSet.branches) group.add(bucket.nearSet.branches);
    for (const cardMesh of bucket.nearSet.cards) group.add(cardMesh);
    if (bucket.overviewSet.branches) group.add(bucket.overviewSet.branches);
    for (const cardMesh of bucket.overviewSet.cards) group.add(cardMesh);
    for (const cardMesh of bucket.successionSet.cards) group.add(cardMesh);
  }
  group.add(ecology.group);

  const visibilitySelector = createForestLodSelector(visibilityItems, {
    cellSize: 48,
    frustumPadding: FOREST_VISIBILITY_PADDING,
    nearDistance: FOREST_NEAR_DISTANCE,
    lodHysteresis: 14,
    minimumCameraMove: 2.25,
    minimumDirectionAngle: THREE.MathUtils.degToRad(1),
  });
  return {
    group,
    ecology,
    placements,
    buckets,
    slotByLayoutIndex,
    successionByLayoutIndex,
    hiddenMatrix,
    visibilitySelector,
    successionEnabled: false,
    renderStats: {
      totalTrees: placements.length,
      visibleTrees: placements.length,
      nearTrees: placements.length,
      overviewTrees: 0,
      culledTrees: 0,
      revision: 0,
    },
  };
}

export function setSeedThreeTreeVisible(
  forest: SeedThreeForestInstances,
  layoutIndex: number,
  visible: boolean,
): void {
  const mapping = forest.slotByLayoutIndex[layoutIndex];
  if (!mapping) return;
  const bucket = forest.buckets[mapping.bucketIndex];
  if (!bucket) return;
  const slot = bucket.slots[mapping.slotIndex];
  if (!slot) return;
  slot.enabled = visible;
}

export function commitSeedThreeForestMatrices(forest: SeedThreeForestInstances): void {
  let totalTrees = 0;
  let nearTrees = 0;
  let overviewTrees = 0;
  for (const bucket of forest.buckets) {
    writeSeedThreeLodMatrices(bucket.nearSet, bucket.slots, bucket.nearSlotIndices);
    writeSeedThreeLodMatrices(bucket.overviewSet, bucket.slots, bucket.overviewSlotIndices);
    writeSeedThreeLodMatrices(
      bucket.successionSet,
      bucket.successionSlots,
      bucket.successionSlotIndices,
    );
    totalTrees += bucket.slots.reduce(
      (count, slot) => count + (slot.enabled ? 1 : 0),
      0,
    );
    nearTrees += bucket.nearSlotIndices.reduce(
      (count, slotIndex) => count + (bucket.slots[slotIndex]?.enabled ? 1 : 0),
      0,
    );
    overviewTrees += bucket.overviewSlotIndices.reduce(
      (count, slotIndex) => count + (bucket.slots[slotIndex]?.enabled ? 1 : 0),
      0,
    );
  }
  const visibleTrees = nearTrees + overviewTrees;
  forest.renderStats = {
    totalTrees,
    visibleTrees,
    nearTrees,
    overviewTrees,
    culledTrees: Math.max(0, totalTrees - visibleTrees),
    revision: forest.renderStats.revision,
  };
}

export function updateSeedThreeForestCamera(
  forest: SeedThreeForestInstances,
  camera: THREE.Camera,
  firstPersonActive: boolean,
  casterBounds: { minX: number; maxX: number; minZ: number; maxZ: number },
): boolean {
  const selection = selectForestLods(forest.visibilitySelector, camera, {
    nearDistance: firstPersonActive
      ? FOREST_FIRST_PERSON_NEAR_DISTANCE
      : FOREST_NEAR_DISTANCE,
    frustumPadding: firstPersonActive
      ? FOREST_VISIBILITY_PADDING + 8
      : FOREST_VISIBILITY_PADDING,
    casterBounds,
    // Matches the directional-shadow fitter's broad-canopy horizontal margin.
    casterPadding: 14,
  });
  const successionEnabled = !firstPersonActive;
  if (!selection.changed && forest.successionEnabled === successionEnabled) return false;

  for (const bucket of forest.buckets) {
    bucket.nearSlotIndices = [];
    bucket.overviewSlotIndices = [];
    bucket.successionSlotIndices = [];
  }
  for (const layoutIndex of selection.nearIndices as number[]) {
    const mapping = forest.slotByLayoutIndex[layoutIndex];
    if (mapping) forest.buckets[mapping.bucketIndex]?.nearSlotIndices.push(mapping.slotIndex);
  }
  for (const layoutIndex of selection.overviewIndices as number[]) {
    const mapping = forest.slotByLayoutIndex[layoutIndex];
    if (mapping) forest.buckets[mapping.bucketIndex]?.overviewSlotIndices.push(mapping.slotIndex);
  }
  if (successionEnabled) {
    // Main-view only: do not submit visual-density crowns that exist solely to
    // satisfy the directional shadow caster union.
    for (const layoutIndex of selection.viewIndices as number[]) {
      for (const mapping of forest.successionByLayoutIndex[layoutIndex] ?? []) {
        forest.buckets[mapping.bucketIndex]?.successionSlotIndices.push(mapping.slotIndex);
      }
    }
  }
  forest.successionEnabled = successionEnabled;
  commitSeedThreeForestMatrices(forest);
  forest.renderStats.revision = selection.revision;
  return true;
}

export function getSeedThreeForestStructuralStats(forest: SeedThreeForestInstances): {
  draws: number;
  triangles: number;
  instances: number;
  trees: SeedThreeForestRenderStats;
  ecology: ForestEcologyStats;
} {
  let draws = 0;
  let triangles = 0;
  let instances = 0;
  forest.group.traverse((object: THREE.Object3D) => {
    const mesh = object as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh || mesh.count <= 0) return;
    draws++;
    instances += mesh.count;
    const geometryTriangles = mesh.geometry.index
      ? mesh.geometry.index.count / 3
      : mesh.geometry.attributes.position.count / 3;
    triangles += geometryTriangles * mesh.count;
  });
  return {
    draws,
    triangles: Math.round(triangles),
    instances,
    trees: { ...forest.renderStats },
    ecology: {
      ...forest.ecology.stats,
      counts: { ...forest.ecology.stats.counts },
    },
  };
}

export function setSeedThreeForestShadows(forest: SeedThreeForestInstances, enabled: boolean): void {
  forest.group.traverse((object: THREE.Object3D) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = enabled && mesh.userData.neverCastShadow !== true;
  });
}

export function disposeSeedThreeForest(forest: SeedThreeForestInstances): void {
  forest.group.traverse((object: THREE.Object3D) => {
    const mesh = object as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh) return;
    if (mesh.userData.forestEcology === true) return;
    if (mesh.geometry.userData.forestClone) mesh.geometry.dispose();
    mesh.dispose();
  });
  forest.ecology.dispose();
}

export function createSeedThreeForestController(forest: SeedThreeForestInstances): SeedThreeForestController {
  return {
    hideTree: (layoutIndex) => setSeedThreeTreeVisible(forest, layoutIndex, false),
    showTree: (layoutIndex) => setSeedThreeTreeVisible(forest, layoutIndex, true),
    commit: () => commitSeedThreeForestMatrices(forest),
    updateCamera: (camera, firstPersonActive, casterBounds) =>
      updateSeedThreeForestCamera(forest, camera, firstPersonActive, casterBounds),
    getStructuralStats: () => getSeedThreeForestStructuralStats(forest),
    setShadows: (enabled) => setSeedThreeForestShadows(forest, enabled),
    dispose: () => disposeSeedThreeForest(forest),
  };
}
