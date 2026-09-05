import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  EXACT_GPU_ANIMATION_NO_CLIP,
  ExactGpuAnimationLibrary,
  clampExactAnimationTime,
  wrapExactAnimationTime,
} from '../src/scene/ExactGpuAnimationLibrary.ts';

const browserGlobal = globalThis as typeof globalThis & {
  self?: typeof globalThis;
  createImageBitmap?: (source: unknown, options?: unknown) => Promise<unknown>;
};
browserGlobal.self = globalThis;
browserGlobal.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
if (typeof globalThis.ProgressEvent === 'undefined') {
  Object.defineProperty(globalThis, 'ProgressEvent', {
    configurable: true,
    value: class ProgressEvent {
      readonly type: string;
      constructor(type: string, init: Record<string, unknown> = {}) {
        this.type = type;
        Object.assign(this, init);
      }
    },
  });
}

async function loadGlb(path: string): Promise<GLTF> {
  const bytes = readFileSync(path);
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new GLTFLoader().parseAsync(buffer, '');
}

function firstSkeleton(root: THREE.Object3D): THREE.Skeleton {
  let skeleton: THREE.Skeleton | null = null;
  root.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!skeleton && mesh.isSkinnedMesh) skeleton = mesh.skeleton;
  });
  if (!skeleton) throw new Error(`${root.name || root.type} contains no skeleton`);
  return skeleton;
}

function assertFloatArraysClose(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  label: string,
  tolerance = 2e-4,
): void {
  assert.equal(actual.length, expected.length, `${label} component count`);
  let maximumError = 0;
  let maximumErrorIndex = 0;
  for (let index = 0; index < actual.length; index++) {
    const error = Math.abs(actual[index]! - expected[index]!);
    if (error > maximumError) {
      maximumError = error;
      maximumErrorIndex = index;
    }
  }
  assert.ok(
    maximumError <= tolerance,
    `${label}: max error ${maximumError} at component ${maximumErrorIndex}`,
  );
}

function evaluateMixerClip(
  sourceRoot: THREE.Group,
  clip: THREE.AnimationClip,
  time: number,
): { palette: Float32Array; modelBones: Float32Array } {
  const clone = cloneSkinned(sourceRoot) as THREE.Group;
  const skeleton = firstSkeleton(clone);
  const mixer = new THREE.AnimationMixer(clone);
  const action = mixer.clipAction(clip, clone);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  mixer.setTime(time);
  clone.updateMatrixWorld(true);
  skeleton.update();
  const palette = new Float32Array(skeleton.boneMatrices);
  const rootInverse = clone.matrixWorld.clone().invert();
  const modelBones = new Float32Array(skeleton.bones.length * 16);
  skeleton.bones.forEach((bone, index) => {
    new THREE.Matrix4().multiplyMatrices(rootInverse, bone.matrixWorld)
      .toArray(modelBones, index * 16);
  });
  mixer.stopAllAction();
  mixer.uncacheRoot(clone);
  return { palette, modelBones };
}

function evaluateMixerCrossfade(
  sourceRoot: THREE.Group,
  primary: THREE.AnimationClip,
  primaryTime: number,
  secondary: THREE.AnimationClip,
  secondaryTime: number,
  blend: number,
): Float32Array {
  const clone = cloneSkinned(sourceRoot) as THREE.Group;
  const skeleton = firstSkeleton(clone);
  const mixer = new THREE.AnimationMixer(clone);
  const first = mixer.clipAction(primary, clone);
  const second = mixer.clipAction(secondary, clone);
  first.setLoop(THREE.LoopOnce, 1).play();
  second.setLoop(THREE.LoopOnce, 1).play();
  first.time = primaryTime;
  second.time = secondaryTime;
  first.setEffectiveWeight(1 - blend);
  second.setEffectiveWeight(blend);
  mixer.update(0);
  clone.updateMatrixWorld(true);
  skeleton.update();
  const palette = new Float32Array(skeleton.boneMatrices);
  mixer.stopAllAction();
  mixer.uncacheRoot(clone);
  return palette;
}

const assets = [
  {
    label: 'male villager',
    path: 'public/assets/models/villagers/worker-male-common-01-v002.glb',
    expectedClips: 15,
    expectedBones: 41,
  },
  {
    label: 'Ottoman raider',
    path: 'public/assets/models/villagers/ottoman-raider-common-01-v001.glb',
    expectedClips: 14,
    expectedBones: 41,
  },
  {
    label: 'female villager',
    path: 'public/assets/models/villagers/worker-female-common-01-v001.glb',
    expectedClips: 14,
    expectedBones: 41,
  },
  {
    label: 'cleric and monk',
    path: 'public/assets/models/villagers/cleric-monk-common-01-v001.glb',
    expectedClips: 20,
    expectedBones: 41,
  },
] as const;

for (const asset of assets) {
  const gltf = await loadGlb(asset.path);
  if (asset.label === 'female villager') {
    // Test civilian source motions only; the game never installs her slash take.
    gltf.animations = gltf.animations.filter(clip => clip.name.toLowerCase() !== 'slash');
  }
  const compileStartedAt = performance.now();
  const library = new ExactGpuAnimationLibrary({
    sourceRoot: gltf.scene,
    clips: gltf.animations,
    name: `${asset.label} exact GPU library`,
  });
  const compileMs = performance.now() - compileStartedAt;
  const diagnostic = library.diagnostics();
  assert.equal(diagnostic.clipCount, asset.expectedClips);
  assert.equal(diagnostic.boneCount, asset.expectedBones);
  assert.equal(diagnostic.trackCount, asset.expectedClips * asset.expectedBones * 3);
  assert.ok(diagnostic.gpuStaticBytes < 2 * 1024 * 1024);
  assert.equal(diagnostic.stateBytesPerInstance, 32);
  assert.equal(diagnostic.poseQuantization, false);
  assert.equal(diagnostic.boneReduction, false);
  assert.equal(diagnostic.animationLod, false);
  assert.equal(diagnostic.exactSourceKeysPreserved, true);
  assert.ok(diagnostic.interpolationModes.includes('discrete'));
  assert.ok(diagnostic.interpolationModes.includes('linear'));
  assert.deepEqual(library.gpuStaticBindings().map((binding) => binding.binding), [0, 1, 2, 3, 4]);
  assert.equal(
    library.gpuStaticBindings().reduce((sum, binding) => sum + binding.data.byteLength, 0),
    diagnostic.gpuStaticBytes,
  );
  assert.deepEqual([...library.createRuntimeUniforms(512)], [512, 0, 0, 0]);
  assert.equal(library.outputPaletteFloatCount(512), 512 * asset.expectedBones * 16);
  assert.equal(library.dispatchWorkgroupCount(512), 8);

  const palette = new Float32Array(asset.expectedBones * 16);
  const modelBones = new Float32Array(asset.expectedBones * 16);
  const workspace = library.createReferenceWorkspace();
  const samples = [
    { clip: gltf.animations[0]!, fraction: 0 },
    { clip: gltf.animations[1]!, fraction: 0.37 },
    { clip: gltf.animations.at(-1)!, fraction: 0.81 },
  ];
  for (const sample of samples) {
    const time = sample.clip.duration * sample.fraction;
    library.evaluateReferenceInto(
      { primaryClip: sample.clip.name, primaryTime: time },
      palette,
      modelBones,
      workspace,
    );
    const mixer = evaluateMixerClip(gltf.scene, sample.clip, time);
    assertFloatArraysClose(palette, mixer.palette, `${asset.label} ${sample.clip.name} skin`);
    assertFloatArraysClose(
      modelBones,
      mixer.modelBones,
      `${asset.label} ${sample.clip.name} attachment bones`,
    );
  }

  const primary = gltf.animations[0]!;
  const secondary = gltf.animations[1]!;
  const blend = 0.37;
  const primaryTime = primary.duration * 0.41;
  const secondaryTime = secondary.duration * 0.63;
  library.evaluateReferenceInto({
    primaryClip: primary.name,
    primaryTime,
    secondaryClip: secondary.name,
    secondaryTime,
    blend,
  }, palette, modelBones, workspace);
  const mixerCrossfade = evaluateMixerCrossfade(
    gltf.scene,
    primary,
    primaryTime,
    secondary,
    secondaryTime,
    blend,
  );
  assertFloatArraysClose(
    palette,
    mixerCrossfade,
    `${asset.label} exact two-clip crossfade`,
    5e-4,
  );

  const stateBuffer = library.createStateBuffer(512);
  stateBuffer.setCount(512);
  for (let index = 0; index < 512; index++) {
    stateBuffer.setAt(index, {
      primaryClip: index % asset.expectedClips,
      primaryTime: (index * 0.017) % primary.duration,
      secondaryClip: index % 11 === 0 ? secondary.name : null,
      secondaryTime: index * 0.013,
      blend: index % 11 === 0 ? 0.42 : 0,
    });
  }
  const dirty = stateBuffer.consumeDirtyRange();
  assert.deepEqual(dirty, {
    firstInstance: 0,
    instanceCount: 512,
    bytes: 512 * 32,
  });
  assert.equal(stateBuffer.words[1], 1);
  assert.equal(stateBuffer.words[9], EXACT_GPU_ANIMATION_NO_CLIP);
  assert.equal(stateBuffer.consumeDirtyRange().bytes, 0);

  const shader = library.buildComputeWgsl();
  assert.match(shader, /fn left_key/);
  assert.match(shader, /slerp_quaternion/);
  assert.match(shader, /skeletonMeta\[topologyIndex \* 4u \+ 1u\]/);
  assert.match(shader, /modelBones\[paletteBase \+ bone\]/);
  assert.match(shader, /skinPalettes\[paletteBase \+ bone\]/);
  assert.match(shader, /@workgroup_size\(64\)/);
  assert.doesNotMatch(shader, /textureSample|f16|poseTexture|lod/i);
  const storageBindings = shader.match(/var<storage/g) ?? [];
  assert.equal(storageBindings.length, 8, 'must fit guaranteed WebGPU storage-buffer limit');

  const observerCount = 32;
  const observerStartedAt = performance.now();
  for (let index = 0; index < observerCount; index++) {
    library.evaluateReferenceInto({
      primaryClip: index % asset.expectedClips,
      primaryTime: index * 0.019,
    }, palette, modelBones, workspace);
  }
  const observerMs = performance.now() - observerStartedAt;

  console.log(
    `${asset.label}: ${diagnostic.clipCount} clips/${diagnostic.boneCount} bones, `
      + `${(diagnostic.gpuStaticBytes / 1024 / 1024).toFixed(2)} MiB immutable exact keys, `
      + `${compileMs.toFixed(2)}ms compile, ${observerMs.toFixed(2)}ms for `
      + `${observerCount} CPU flag observers, 16.0 KiB/frame state upload for 512 actors.`,
  );
}

const animalAssets = [
  'public/assets/models/fish/quaternius-fish.glb',
  'public/assets/models/deer/quaternius-deer.glb',
  'public/assets/models/deer/quaternius-stag.glb',
  'public/assets/models/livestock/quaternius-bull.glb',
  'public/assets/models/livestock/quaternius-chicken.glb',
  'public/assets/models/livestock/quaternius-cow.glb',
  'public/assets/models/livestock/quaternius-goat.glb',
  'public/assets/models/livestock/quaternius-pig.glb',
  'public/assets/models/livestock/quaternius-sheep.glb',
] as const;

function assertHeadWeightedQuaterniusEyes(gltf: GLTF, path: string): void {
  const eyeMeshes: THREE.SkinnedMesh[] = [];
  const eyeMaterials = new Set<string>();
  gltf.scene.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!materials.some((material) => /^Eye_(?:Black|White)$/.test(material.name))) return;
    eyeMeshes.push(mesh);
    for (const material of materials) eyeMaterials.add(material.name);
  });

  assert.deepEqual(
    [...eyeMaterials].sort(),
    ['Eye_Black', 'Eye_White'],
    `${path} should preserve the Quaternius black-eye and white-catchlight materials`,
  );
  assert.equal(eyeMeshes.length, 2, `${path} should export one skinned primitive per eye material`);
  for (const mesh of eyeMeshes) {
    const headIndex = mesh.skeleton.bones.findIndex((bone) => bone.name === 'Head');
    assert.ok(headIndex >= 0, `${path} eye skeleton should contain the Head bone`);
    const joints = mesh.geometry.getAttribute('skinIndex');
    const weights = mesh.geometry.getAttribute('skinWeight');
    assert.ok(joints && weights, `${path} eye geometry should be skinned`);
    for (let vertex = 0; vertex < joints.count; vertex += 1) {
      let headWeight = 0;
      for (let lane = 0; lane < 4; lane += 1) {
        if (joints.array[vertex * 4 + lane] === headIndex) {
          headWeight += weights.array[vertex * 4 + lane]!;
        }
      }
      assert.ok(headWeight > 0.999, `${path} eye vertex ${vertex} should follow Head exactly`);
    }
  }
}

function assertHeadWeightedQuaterniusHorns(gltf: GLTF, path: string): void {
  const hornMeshes: THREE.SkinnedMesh[] = [];
  gltf.scene.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.some((material) => material.name === 'Horns')) hornMeshes.push(mesh);
  });
  assert.equal(hornMeshes.length, 1, `${path} should export one Quaternius horn primitive`);
  const hornMesh = hornMeshes[0]!;
  const headIndex = hornMesh.skeleton.bones.findIndex((bone) => bone.name === 'Head');
  assert.ok(headIndex >= 0, `${path} horn skeleton should contain the Head bone`);
  const joints = hornMesh.geometry.getAttribute('skinIndex');
  const weights = hornMesh.geometry.getAttribute('skinWeight');
  assert.ok(joints && weights, `${path} horn geometry should be skinned`);
  for (let vertex = 0; vertex < joints.count; vertex += 1) {
    let headWeight = 0;
    for (let lane = 0; lane < 4; lane += 1) {
      if (joints.array[vertex * 4 + lane] === headIndex) {
        headWeight += weights.array[vertex * 4 + lane]!;
      }
    }
    assert.ok(headWeight > 0.999, `${path} horn vertex ${vertex} should follow Head exactly`);
  }
}

for (const path of animalAssets) {
  const gltf = await loadGlb(path);
  if (
    path.endsWith('quaternius-goat.glb')
    || path.endsWith('quaternius-pig.glb')
    || path.endsWith('quaternius-sheep.glb')
  ) {
    assertHeadWeightedQuaterniusEyes(gltf, path);
  }
  if (path.endsWith('quaternius-goat.glb')) assertHeadWeightedQuaterniusHorns(gltf, path);
  const library = new ExactGpuAnimationLibrary({
    sourceRoot: gltf.scene,
    clips: gltf.animations,
    name: `${path} exact GPU library`,
  });
  const clip = gltf.animations[Math.floor(gltf.animations.length / 2)]!;
  const time = clip.duration * 0.413;
  const palette = new Float32Array(library.diagnostics().boneCount * 16);
  const modelBones = new Float32Array(library.diagnostics().boneCount * 16);
  library.evaluateReferenceInto({ primaryClip: clip.name, primaryTime: time }, palette, modelBones);
  const mixer = evaluateMixerClip(gltf.scene, clip, time);
  assertFloatArraysClose(palette, mixer.palette, `${path} ${clip.name} skin`, 5e-4);
  assertFloatArraysClose(modelBones, mixer.modelBones, `${path} ${clip.name} bones`, 5e-4);
  assert.equal(library.diagnostics().poseQuantization, false);
  assert.equal(library.diagnostics().animationLod, false);
}
console.log(`${animalAssets.length} authored animal rigs match exact GPU-library semantics.`);

assert.equal(wrapExactAnimationTime(7.25, 2), 1.25);
assert.equal(wrapExactAnimationTime(-0.5, 2), 1.5);
assert.equal(clampExactAnimationTime(9, 2), 2);
assert.equal(clampExactAnimationTime(-1, 2), 0);

const unsupportedRoot = new THREE.Group();
const unsupportedBone = new THREE.Bone();
unsupportedBone.name = 'root';
unsupportedRoot.add(unsupportedBone);
const unsupportedSkeleton = new THREE.Skeleton([unsupportedBone]);
unsupportedSkeleton.calculateInverses();
const unsupportedGeometry = new THREE.BufferGeometry();
unsupportedGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
unsupportedGeometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0], 4));
unsupportedGeometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0], 4));
const unsupportedMesh = new THREE.SkinnedMesh(
  unsupportedGeometry,
  new THREE.MeshBasicMaterial(),
);
unsupportedMesh.bind(unsupportedSkeleton);
unsupportedRoot.add(unsupportedMesh);
const unsupportedTrack = new THREE.VectorKeyframeTrack(
  'root.position',
  [0, 0.5, 1],
  [0, 0, 0, 0.5, 0, 0, 1, 0, 0],
  THREE.InterpolateSmooth,
);
assert.throws(
  () => new ExactGpuAnimationLibrary({
    sourceRoot: unsupportedRoot,
    clips: [new THREE.AnimationClip('unsupported-cubic', 1, [unsupportedTrack])],
  }),
  /refusing to resample or quantize/,
);
unsupportedGeometry.dispose();
(unsupportedMesh.material as THREE.Material).dispose();

console.log('Exact authored GPU animation database and compute contract verified.');
