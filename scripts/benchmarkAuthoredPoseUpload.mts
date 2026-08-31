import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AuthoredSkinnedInstanceBatch } from '../src/scene/AuthoredSkinnedInstanceBatch.ts';

const ACTOR_COUNT = Number(process.env.AUTHORED_POSE_ACTORS ?? 512);
const MEASURED_FRAMES = Number(process.env.AUTHORED_POSE_FRAMES ?? 12);

function installNodeGlbGlobals(): void {
  const browserGlobal = globalThis as typeof globalThis & {
    self?: typeof globalThis;
    createImageBitmap?: (source: unknown, options?: unknown) => Promise<unknown>;
  };
  browserGlobal.self = globalThis;
  browserGlobal.createImageBitmap = async () => ({
    width: 1,
    height: 1,
    close() {},
  });
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
}

async function loadRealGlb(path: string): Promise<THREE.Group> {
  installNodeGlbGlobals();
  const bytes = readFileSync(path);
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const gltf = await new GLTFLoader().parseAsync(arrayBuffer, '');
  gltf.scene.updateMatrixWorld(true);
  return gltf.scene;
}

function firstSkeleton(root: THREE.Object3D): THREE.Skeleton {
  let skeleton: THREE.Skeleton | null = null;
  root.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!skeleton && mesh.isSkinnedMesh) skeleton = mesh.skeleton;
  });
  if (!skeleton) throw new Error('Benchmark clone contains no skeleton');
  return skeleton;
}

const source = await loadRealGlb(
  'public/assets/models/villagers/worker-male-common-01-v002.glb',
);
const stage = new THREE.Group();
stage.position.set(3, 0.25, -2);
const crowd = new THREE.Group();
stage.add(crowd);
const batch = new AuthoredSkinnedInstanceBatch({
  parent: crowd,
  sourceRoot: source,
  capacity: ACTOR_COUNT,
  name: 'Authored pose upload benchmark',
});
batch.setCount(ACTOR_COUNT);

const actors: Array<{
  actor: THREE.Group;
  model: THREE.Group;
  skeleton: THREE.Skeleton;
}> = [];
for (let index = 0; index < ACTOR_COUNT; index++) {
  const actor = new THREE.Group();
  actor.position.set((index % 32) * 1.1, 0, Math.floor(index / 32) * 1.1);
  actor.rotation.y = index * 0.031;
  const model = cloneSkinned(source) as THREE.Group;
  actor.add(model);
  crowd.add(actor);
  actors.push({ actor, model, skeleton: firstSkeleton(model) });
}

function uploadFrame(frame: number): number {
  const startedAt = performance.now();
  for (let slot = 0; slot < actors.length; slot++) {
    const entry = actors[slot]!;
    entry.actor.position.x += 0.00001;
    const animatedBone = entry.skeleton.bones[1];
    if (animatedBone) animatedBone.rotation.z = Math.sin(frame * 0.11 + slot * 0.017) * 0.08;
  }
  for (let slot = 0; slot < actors.length; slot++) {
    const entry = actors[slot]!;
    batch.setFromCloneAt(slot, entry.model);
  }
  batch.commit();
  return performance.now() - startedAt;
}

const coldMs = uploadFrame(0);
const frameTimes: number[] = [];
for (let frame = 1; frame <= MEASURED_FRAMES; frame++) frameTimes.push(uploadFrame(frame));
const meanMs = frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length;
const sorted = [...frameTimes].sort((left, right) => left - right);
const p95Ms = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
const minimumMs = sorted[0]!;

console.log(JSON.stringify({
  actorCount: ACTOR_COUNT,
  boneCount: batch.boneCount,
  coldMs: Number(coldMs.toFixed(3)),
  meanMs: Number(meanMs.toFixed(3)),
  minimumMs: Number(minimumMs.toFixed(3)),
  p95Ms: Number(p95Ms.toFixed(3)),
  frameTimesMs: frameTimes.map((value) => Number(value.toFixed(3))),
}, null, 2));

batch.dispose();
