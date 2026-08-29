import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  MAX_ANIMATED_SKELETON_BYTES,
  SettlementCrowdRenderer,
  animatedRigsPerShard,
  type CrowdRenderAgent,
} from '../src/settlement/SettlementCrowdRenderer.ts';

(globalThis as typeof globalThis & { self: typeof globalThis }).self = globalThis;
(globalThis as typeof globalThis & {
  createImageBitmap: (blob: Blob) => Promise<ImageBitmap>;
}).createImageBitmap = async () => ({
  width: 1,
  height: 1,
  close() {},
} as ImageBitmap);

const ASSETS = [
  ['man', 'public/assets/models/villagers/worker-male-common-01-v001.glb'],
  // TEMP: female villagers share this source until their dedicated labeled GLB
  // and matching semantic animation set are supplied.
  ['woman', 'public/assets/models/villagers/worker-male-common-01-v001.glb'],
] as const;
const CLOSE_AGENT_COUNT = 72;
const BENCHMARK_FRAMES = 600;
const EXPECTED_LAYERS = { man: 1, woman: 1 } as const;
const TARGET_HEIGHTS = { man: 1.72, woman: 1.64 } as const;

type ParsedSource = {
  variant: 'man' | 'woman';
  scene: THREE.Group;
  idle: THREE.AnimationClip;
  walk: THREE.AnimationClip;
  meshes: THREE.SkinnedMesh[];
  submissions: number;
};

const sources: ParsedSource[] = [];
for (const [variant, path] of ASSETS) {
  const gltf = await parseGlb(path);
  const meshes: THREE.SkinnedMesh[] = [];
  gltf.scene.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) meshes.push(mesh);
  });
  assert.equal(
    meshes.length,
    EXPECTED_LAYERS[variant],
    `${variant} source topology changed from its authored body layers`,
  );
  const idle = findClip(gltf.animations, 'idle');
  const walk = findClip(gltf.animations, 'walk');
  assert.ok(idle && walk, `${variant} source must retain authored idle and walk clips`);

  const referenceSkeleton = meshes[0]!.skeleton;
  const referenceBoneNames = referenceSkeleton.bones.map((bone) => bone.name);
  const referenceInverses = referenceSkeleton.boneInverses;
  const referenceBindMatrix = meshes[0]!.bindMatrix;
  const referenceLayerMatrix = meshes[0]!.matrixWorld;
  for (const mesh of meshes) {
    assert.equal(
      mesh.skeleton,
      referenceSkeleton,
      `${variant}/${mesh.name} must share the authored skeleton object`,
    );
    assert.deepEqual(
      mesh.skeleton.bones.map((bone) => bone.name),
      referenceBoneNames,
      `${variant}/${mesh.name} must share one exact bone ordering for aggregate skinning`,
    );
    assert.equal(
      mesh.skeleton.bones.length,
      referenceSkeleton.bones.length,
      `${variant}/${mesh.name} must retain the shared bone count`,
    );
    for (let index = 0; index < referenceInverses.length; index++) {
      assert.ok(
        matrixEquals(mesh.skeleton.boneInverses[index]!, referenceInverses[index]!),
        `${variant}/${mesh.name} bone inverse ${index} diverged`,
      );
    }
    assert.ok(
      matrixEquals(mesh.bindMatrix, referenceBindMatrix),
      `${variant}/${mesh.name} bind matrix diverged`,
    );
    assert.ok(
      matrixEquals(mesh.matrixWorld, referenceLayerMatrix),
      `${variant}/${mesh.name} layer transform diverged`,
    );
    assert.equal(
      mesh.geometry.getAttribute('color'),
      undefined,
      `${variant}/${mesh.name} introduced vertex colors that require multiplicative baking`,
    );
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    assert.ok(material instanceof THREE.MeshStandardMaterial);
    assert.ok(material.map, `${variant}/${mesh.name} must retain its authored color texture`);
    for (const attribute of ['position', 'normal', 'skinIndex', 'skinWeight']) {
      assert.ok(
        mesh.geometry.getAttribute(attribute),
        `${variant}/${mesh.name} must retain ${attribute} for exact GPU skinning`,
      );
    }
    assert.equal(
      Object.keys(mesh.geometry.morphAttributes).length,
      0,
      `${variant}/${mesh.name} unexpectedly introduced morph semantics`,
    );
  }

  const submissions = meshes.reduce((sum, mesh) => sum + meshSubmissionCount(mesh), 0);
  assert.equal(
    submissions,
    EXPECTED_LAYERS[variant],
    `${variant} close-view submissions must match the authored material layers`,
  );
  sources.push({ variant, scene: gltf.scene, idle, walk, meshes, submissions });
}

for (const source of sources) {
  verifyAggregateSkeletonEquivalence(source);
}

type AggregateBatchHarness = {
  animatedGroup: THREE.Group;
  color: THREE.Color;
  animated: Map<string, { skeleton: THREE.Skeleton }>;
  animatedPool: Map<string, unknown[]>;
  idlePooledVisualCount: number;
  animatedBatches: Record<'man' | 'woman', AggregateRuntimeBatch> | null;
  fallbackBody: DisposableLayer;
  fallbackLegs: DisposableLayer;
  fallbackHead: DisposableLayer;
  sources: null;
  toolSources: null;
  group: THREE.Group;
  disposed: boolean;
  createAnimatedBatch(
    variant: 'man' | 'woman',
    source: {
      scene: THREE.Group;
      bounds: THREE.Box3;
      sourceHeight: number;
      targetHeight: number;
    },
  ): AggregateRuntimeBatch;
  updateAnimatedBatches(
    agents: readonly CrowdRenderAgent[],
    animatedIds: ReadonlySet<string>,
  ): void;
  dispose(): void;
};
type DisposableLayer = {
  mesh: THREE.InstancedMesh;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
};
type AggregateRuntimeBatch = {
  variant: 'man' | 'woman';
  bonesPerRig: number;
  rigsPerShard: number;
  shards: Array<{
    skeleton: THREE.Skeleton;
    skeletonBytes: number;
    layers: Array<{
      mesh: THREE.SkinnedMesh;
      geometry: THREE.BufferGeometry;
      material: THREE.MeshStandardMaterial;
      materialName: string;
      sourceVertexCount: number;
      sourceDrawCount: number;
      slotColors: Uint32Array;
      initializedColors: Uint8Array;
      dirtyColors: Uint8Array;
    }>;
  }>;
};
const aggregateHarness = Object.create(
  SettlementCrowdRenderer.prototype,
) as AggregateBatchHarness;
aggregateHarness.animatedGroup = new THREE.Group();
aggregateHarness.color = new THREE.Color();
aggregateHarness.animated = new Map();
let aggregateLayerMeshes = 0;
let aggregateGeometryBytes = 0;
const aggregateBatches = {} as Record<'man' | 'woman', AggregateRuntimeBatch>;
const aggregateConstructionStartedAt = performance.now();
for (const source of sources) {
  if (source.variant === 'woman' && ASSETS[0][1] === ASSETS[1][1]) {
    aggregateBatches.woman = aggregateBatches.man;
    continue;
  }
  const bounds = new THREE.Box3().setFromObject(source.scene);
  const batch = aggregateHarness.createAnimatedBatch(source.variant, {
    scene: source.scene,
    bounds,
    sourceHeight: bounds.max.y - bounds.min.y,
    targetHeight: TARGET_HEIGHTS[source.variant],
  });
  aggregateBatches[source.variant] = batch;
  const sourceBoneCount = source.meshes[0]!.skeleton.bones.length;
  const expectedRigsPerShard = animatedRigsPerShard(sourceBoneCount);
  assert.equal(batch.rigsPerShard, expectedRigsPerShard);
  assert.equal(
    batch.shards.length,
    Math.ceil(CLOSE_AGENT_COUNT / expectedRigsPerShard),
  );
  for (const [shardIndex, shard] of batch.shards.entries()) {
    assert.equal(shard.layers.length, EXPECTED_LAYERS[source.variant]);
    assert.equal(
      shard.skeleton.bones.length,
      sourceBoneCount * batch.rigsPerShard,
    );
    assert.equal(shard.skeletonBytes, sourceBoneCount * batch.rigsPerShard * 16 * 4);
    assert.ok(
      shard.skeletonBytes <= MAX_ANIMATED_SKELETON_BYTES,
      `${source.variant} shard ${shardIndex} exceeds hard 15,872-byte limit`,
    );
    assert.ok(
      shard.skeletonBytes <= 16_384,
      `${source.variant} shard ${shardIndex} exceeds WebGL2 minimum UBO size`,
    );
    aggregateLayerMeshes += shard.layers.length;
    for (const layer of shard.layers) {
      assert.equal(
        layer.geometry.getAttribute('position').count,
        layer.sourceVertexCount * batch.rigsPerShard,
      );
      assert.equal(layer.material.vertexColors, true);
      assert.equal(layer.material.color.getHex(), 0xffffff);
      assert.equal(layer.mesh.castShadow, false);
      assert.equal(layer.mesh.receiveShadow, false);
      assert.equal(layer.mesh.frustumCulled, false);
      for (const attribute of Object.values(layer.geometry.attributes)) {
        aggregateGeometryBytes += attribute.array.byteLength;
      }
      aggregateGeometryBytes += layer.geometry.index?.array.byteLength ?? 0;
    }
  }
}
const aggregateConstructionMs = performance.now() - aggregateConstructionStartedAt;
const uniqueAggregateBatches = [...new Set(Object.values(aggregateBatches))];
assert.equal(
  aggregateLayerMeshes,
  uniqueAggregateBatches.reduce(
    (sum, batch) => sum + batch.shards.length * EXPECTED_LAYERS[batch.variant],
    0,
  ),
  'every exact-capacity shard must retain all authored material layers',
);

const roots: THREE.Group[] = [];
const mixers: THREE.AnimationMixer[] = [];
const rootSkeletons: THREE.Skeleton[] = [];
let clonedSkinnedMeshes = 0;
let clonedBones = 0;
let clonedMaterials = 0;
let baselineSubmissions = 0;
const constructionStartedAt = performance.now();
for (let index = 0; index < CLOSE_AGENT_COUNT; index++) {
  const source = sources[index % sources.length]!;
  const root = cloneSkinned(source.scene) as THREE.Group;
  root.position.set(index % 12, 0, Math.floor(index / 12));
  root.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    if (!rootSkeletons[index]) rootSkeletons[index] = mesh.skeleton;
    clonedSkinnedMeshes += 1;
    clonedBones += mesh.skeleton.bones.length;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mesh.material = Array.isArray(mesh.material)
      ? materials.map((material) => material.clone())
      : materials[0]!.clone();
    clonedMaterials += materials.length;
  });
  const mixer = new THREE.AnimationMixer(root);
  const clip = index % 3 === 0 ? source.walk : source.idle;
  const action = mixer.clipAction(clip, root);
  action.play();
  action.time = index / CLOSE_AGENT_COUNT * clip.duration;
  roots.push(root);
  mixers.push(mixer);
  baselineSubmissions += source.submissions;
}
const constructionMs = performance.now() - constructionStartedAt;

assert.equal(baselineSubmissions, 72, '72 exact close villagers must expose one textured body submission each');
assert.equal(mixers.length, 72, 'the baseline must exercise the current 72 independent mixers');
assert.equal(clonedSkinnedMeshes, 72);
assert.equal(clonedMaterials, 72);

let checksum = 0;
const mixerStartedAt = performance.now();
for (let frame = 0; frame < BENCHMARK_FRAMES; frame++) {
  for (let index = 0; index < mixers.length; index++) {
    mixers[index]!.update(1 / 60);
    checksum += roots[index]!.children.length;
  }
}
const mixerMs = performance.now() - mixerStartedAt;
assert.ok(checksum > 0);

const aggregateAgents: CrowdRenderAgent[] = Array.from(
  { length: CLOSE_AGENT_COUNT },
  (_, index) => ({
    id: `aggregate:${index}`,
    slot: index,
    x: index % 12,
    y: 0,
    z: Math.floor(index / 12),
    yaw: index * 0.1,
    appearanceSeed: index * 2654435761 >>> 0,
    variant: index % 2 === 0 ? 'man' : 'woman',
    mode: index % 3 === 0 ? 'walk' : 'idle',
    tunicColor: 0x835f3f + index,
    skinColor: 0xc9946a,
    hairColor: 0x3d2b22,
    tool: null,
    movementSpeed: 1.2,
    active: true,
  }),
);
for (let index = 0; index < aggregateAgents.length; index++) {
  aggregateHarness.animated.set(aggregateAgents[index]!.id, {
    skeleton: rootSkeletons[index]!,
  });
}
aggregateHarness.animatedBatches = aggregateBatches;
const aggregateIds = new Set(aggregateAgents.map((agent) => agent.id));
const aggregateUpdateStartedAt = performance.now();
for (let frame = 0; frame < BENCHMARK_FRAMES; frame++) {
  aggregateHarness.updateAnimatedBatches(aggregateAgents, aggregateIds);
}
const aggregateUpdateMs = performance.now() - aggregateUpdateStartedAt;
let balancedBodySubmissions = 0;
for (const batch of uniqueAggregateBatches) {
  const variantAgents = aggregateAgents.filter(
    (agent) => aggregateBatches[agent.variant] === batch,
  );
  for (const [shardIndex, shard] of batch.shards.entries()) {
    const activeInShard = Math.min(
      batch.rigsPerShard,
      Math.max(0, variantAgents.length - shardIndex * batch.rigsPerShard),
    );
    for (let shardSlot = 0; shardSlot < activeInShard; shardSlot++) {
      const agent = variantAgents[
        shardIndex * batch.rigsPerShard + shardSlot
      ]!;
      const visual = aggregateHarness.animated.get(agent.id)!;
      const boneOffset = shardSlot * batch.bonesPerRig;
      for (let bone = 0; bone < batch.bonesPerRig; bone++) {
        assert.equal(
          shard.skeleton.bones[boneOffset + bone],
          visual.skeleton.bones[bone],
          `${batch.variant} shard ${shardIndex} slot ${shardSlot} bone ${bone} remapped`,
        );
        assert.equal(
          shard.skeleton.boneInverses[boneOffset + bone],
          visual.skeleton.boneInverses[bone],
          `${batch.variant} shard ${shardIndex} slot ${shardSlot} inverse ${bone} remapped`,
        );
      }
    }
    for (const layer of shard.layers) {
      assert.equal(layer.mesh.visible, activeInShard > 0);
      assert.equal(
        layer.geometry.drawRange.count,
        activeInShard * layer.sourceDrawCount,
        `${batch.variant}/${layer.materialName} shard ${shardIndex} must draw its exact active prefix`,
      );
      if (activeInShard > 0) balancedBodySubmissions += 1;
      assert.deepEqual(
        layer.geometry.getAttribute('color').updateRanges,
        [],
        'unchanged aggregate appearance must not republish vertex colors',
      );
    }
  }
}
assert.equal(
  balancedBodySubmissions,
  12,
  '72 temporarily shared worker rigs must submit exactly twelve body draws',
);

const manSkeletons = rootSkeletons.filter((_, index) => index % 2 === 0);
const allManAgents = aggregateAgents.map((agent, index) => ({
  ...agent,
  id: `all-man:${index}`,
  variant: 'man' as const,
}));
aggregateHarness.animated.clear();
for (let index = 0; index < allManAgents.length; index++) {
  aggregateHarness.animated.set(allManAgents[index]!.id, {
    skeleton: manSkeletons[index % manSkeletons.length]!,
  });
}
aggregateHarness.updateAnimatedBatches(
  allManAgents,
  new Set(allManAgents.map((agent) => agent.id)),
);
let allManBodySubmissions = 0;
for (const batch of uniqueAggregateBatches) {
  for (const shard of batch.shards) {
    for (const layer of shard.layers) {
      const expectedVisible = true;
      assert.equal(layer.mesh.visible, expectedVisible);
      assert.equal(
        layer.geometry.drawRange.count,
        expectedVisible
          ? batch.rigsPerShard * layer.sourceDrawCount
          : 0,
      );
      if (layer.mesh.visible) allManBodySubmissions += 1;
    }
  }
}
assert.equal(
  allManBodySubmissions,
  12,
  '72 six-rig textured workers must submit exactly twelve body draws',
);

for (const mixer of mixers) {
  mixer.stopAllAction();
  mixer.uncacheRoot(mixer.getRoot());
}
for (const root of roots) {
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.material) return;
    const values = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of values) materials.add(material);
  });
  for (const material of materials) material.dispose();
}
let skeletonDisposals = 0;
let geometryDisposals = 0;
let materialDisposals = 0;
for (const batch of uniqueAggregateBatches) {
  for (const shard of batch.shards) {
    const disposeSkeleton = shard.skeleton.dispose.bind(shard.skeleton);
    shard.skeleton.dispose = () => {
      skeletonDisposals += 1;
      disposeSkeleton();
    };
    for (const layer of shard.layers) {
      layer.geometry.addEventListener('dispose', () => {
        geometryDisposals += 1;
      });
      layer.material.addEventListener('dispose', () => {
        materialDisposals += 1;
      });
    }
  }
}
const makeDisposableLayer = (): DisposableLayer => {
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.MeshStandardMaterial();
  return {
    geometry,
    material,
    mesh: new THREE.InstancedMesh(geometry, material, 1),
  };
};
aggregateHarness.animated.clear();
aggregateHarness.animatedPool = new Map();
aggregateHarness.idlePooledVisualCount = 0;
aggregateHarness.fallbackBody = makeDisposableLayer();
aggregateHarness.fallbackLegs = makeDisposableLayer();
aggregateHarness.fallbackHead = makeDisposableLayer();
aggregateHarness.sources = null;
aggregateHarness.toolSources = null;
aggregateHarness.group = new THREE.Group();
aggregateHarness.disposed = false;
aggregateHarness.dispose();
const totalShardCount = uniqueAggregateBatches.reduce(
  (sum, batch) => sum + batch.shards.length,
  0,
);
assert.equal(skeletonDisposals, totalShardCount);
assert.equal(geometryDisposals, aggregateLayerMeshes);
assert.equal(materialDisposals, aggregateLayerMeshes);
assert.equal(aggregateHarness.animatedBatches, null);
assert.equal(aggregateHarness.animatedGroup.children.length, 0);

console.log(
  'Crowd source-model batching contract passed '
    + `(72 clones: ${baselineSubmissions} submissions, ${mixers.length} mixers, `
    + `${clonedSkinnedMeshes} skinned layers, ${clonedBones.toLocaleString()} bone references; `
    + `construction ${constructionMs.toFixed(1)} ms; `
    + `${BENCHMARK_FRAMES} mixer frames ${mixerMs.toFixed(1)} ms / `
    + `${(mixerMs / BENCHMARK_FRAMES).toFixed(3)} ms per frame; `
    + `aggregate ${balancedBodySubmissions} balanced / ${allManBodySubmissions} one-variant body submissions, `
    + `${totalShardCount} shards at ${MAX_ANIMATED_SKELETON_BYTES.toLocaleString()} bytes max, `
    + `${(aggregateGeometryBytes / 1024 / 1024).toFixed(1)} MiB geometry built in `
    + `${aggregateConstructionMs.toFixed(1)} ms; `
    + `${BENCHMARK_FRAMES} batch-map frames ${aggregateUpdateMs.toFixed(1)} ms / `
    + `${(aggregateUpdateMs / BENCHMARK_FRAMES).toFixed(3)} ms per frame).`,
);

async function parseGlb(path: string) {
  const bytes = fs.readFileSync(path);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Promise<Awaited<ReturnType<GLTFLoader['loadAsync']>>>((resolve, reject) => {
    new GLTFLoader().parse(buffer, '', resolve, reject);
  });
}

function findClip(
  clips: readonly THREE.AnimationClip[],
  name: string,
): THREE.AnimationClip | undefined {
  return clips.find((clip) => {
    const normalized = clip.name.toLowerCase();
    return normalized === name
      || normalized.endsWith(`|${name}`)
      || normalized.endsWith(`_${name}`);
  });
}

function meshSubmissionCount(mesh: THREE.SkinnedMesh): number {
  if (!Array.isArray(mesh.material)) return 1;
  return mesh.geometry.groups.reduce((count, group) => (
    mesh.material[group.materialIndex ?? 0] ? count + 1 : count
  ), 0);
}

function matrixEquals(a: THREE.Matrix4, b: THREE.Matrix4): boolean {
  for (let index = 0; index < 16; index++) {
    if (Math.abs(a.elements[index]! - b.elements[index]!) > 1e-8) return false;
  }
  return true;
}

function verifyAggregateSkeletonEquivalence(source: ParsedSource): void {
  const sourceBounds = new THREE.Box3().setFromObject(source.scene);
  const sourceHeight = sourceBounds.max.y - sourceBounds.min.y;
  const rigScene = new THREE.Group();
  const slotMeshes: THREE.SkinnedMesh[] = [];
  const mixers: THREE.AnimationMixer[] = [];
  for (let slot = 0; slot < 2; slot++) {
    const model = cloneSkinned(source.scene) as THREE.Group;
    const scale = TARGET_HEIGHTS[source.variant] / sourceHeight
      * (slot === 0 ? 0.96 : 1.04);
    model.scale.setScalar(scale);
    model.position.y = -sourceBounds.min.y * scale + 0.012;
    const root = new THREE.Group();
    root.position.set(3.5 + slot * 2.75, 0.4 * slot, -2.25 + slot);
    root.rotation.y = -0.37 + slot * 1.12;
    root.add(model);
    rigScene.add(root);
    let layer: THREE.SkinnedMesh | null = null;
    model.traverse((object) => {
      const mesh = object as THREE.SkinnedMesh;
      if (!layer && mesh.isSkinnedMesh && mesh.name === source.meshes[0]!.name) {
        layer = mesh;
      }
    });
    assert.ok(layer);
    slotMeshes.push(layer);
    const mixer = new THREE.AnimationMixer(model);
    const clip = slot === 0 ? source.idle : source.walk;
    const action = mixer.clipAction(clip, model).play();
    action.time = clip.duration * (slot === 0 ? 0.23 : 0.71);
    mixer.update(0.37);
    mixers.push(mixer);
  }
  rigScene.updateMatrixWorld(true);

  const boneCount = slotMeshes[0]!.skeleton.bones.length;
  const geometries = slotMeshes.map((mesh, slot) => {
    const geometry = mesh.geometry.clone();
    const sourceSkinIndex = geometry.getAttribute('skinIndex');
    const shifted = new Uint16Array(sourceSkinIndex.array.length);
    for (let index = 0; index < shifted.length; index++) {
      shifted[index] = sourceSkinIndex.array[index]! + slot * boneCount;
    }
    geometry.setAttribute(
      'skinIndex',
      new THREE.Uint16BufferAttribute(shifted, sourceSkinIndex.itemSize),
    );
    return geometry;
  });
  const mergedGeometry = mergeGeometries(geometries, false);
  assert.ok(mergedGeometry);
  const aggregateSkeleton = new THREE.Skeleton(
    slotMeshes.flatMap((mesh) => mesh.skeleton.bones),
    slotMeshes.flatMap((mesh) => mesh.skeleton.boneInverses),
  );
  const aggregateMesh = new THREE.SkinnedMesh(
    mergedGeometry,
    slotMeshes[0]!.material,
  );
  aggregateMesh.bind(aggregateSkeleton, slotMeshes[0]!.bindMatrix);
  aggregateMesh.updateMatrixWorld(true);
  aggregateSkeleton.update();

  const vertexCount = slotMeshes[0]!.geometry.getAttribute('position').count;
  const expected = new THREE.Vector3();
  const actual = new THREE.Vector3();
  for (let slot = 0; slot < slotMeshes.length; slot++) {
    const sourceMesh = slotMeshes[slot]!;
    sourceMesh.skeleton.update();
    for (let vertex = 0; vertex < vertexCount; vertex += 17) {
      expected.fromBufferAttribute(
        sourceMesh.geometry.getAttribute('position'),
        vertex,
      );
      sourceMesh.applyBoneTransform(vertex, expected);
      sourceMesh.localToWorld(expected);
      const aggregateVertex = slot * vertexCount + vertex;
      actual.fromBufferAttribute(
        aggregateMesh.geometry.getAttribute('position'),
        aggregateVertex,
      );
      aggregateMesh.applyBoneTransform(aggregateVertex, actual);
      aggregateMesh.localToWorld(actual);
      assert.ok(
        expected.distanceTo(actual) < 1e-5,
        `${source.variant} aggregate skinning changed slot ${slot} vertex ${vertex}: `
          + `${expected.toArray()} vs ${actual.toArray()}`,
      );
    }
  }

  for (const mixer of mixers) {
    mixer.stopAllAction();
    mixer.uncacheRoot(mixer.getRoot());
  }
  aggregateSkeleton.dispose();
  mergedGeometry.dispose();
  for (const geometry of geometries) geometry.dispose();
}
