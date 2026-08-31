import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AuthoredSkinnedInstanceBatch } from '../src/scene/AuthoredSkinnedInstanceBatch.ts';

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

async function parseGlb(path: string) {
  const bytes = readFileSync(path);
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new GLTFLoader().parseAsync(arrayBuffer, '');
}

const assets = [
  ['man', 'public/assets/models/villagers/worker-male-common-01-v002.glb'],
  ['woman', 'public/assets/models/villagers/worker-female-common-01-v001.glb'],
  ['cleric', 'public/assets/models/villagers/cleric-monk-common-01-v001.glb'],
  ['raider', 'public/assets/models/villagers/ottoman-raider-common-01-v001.glb'],
] as const;

let totalFixedDrawCalls = 0;
let totalSubmittedTriangles = 0;
for (const [label, path] of assets) {
  const gltf = await parseGlb(path);
  const sourceMeshes: THREE.SkinnedMesh[] = [];
  gltf.scene.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) sourceMeshes.push(mesh);
  });
  assert.ok(sourceMeshes.length > 0, `${label} must retain authored skinned meshes`);

  const parent = new THREE.Group();
  parent.position.set(-4, 0.25, 3);
  const batch = new AuthoredSkinnedInstanceBatch({
    parent,
    sourceRoot: gltf.scene,
    capacity: 32,
    name: `${label} full-quality crowd`,
    castShadow: true,
    receiveShadow: true,
  });

  // Reserving a strategic-scale crowd may grow pose/transform storage, but it
  // must never replicate or simplify source geometry and must keep draw calls
  // fixed at the authored mesh/material topology.
  batch.reserve(512);
  batch.setCount(512);
  let diagnostic = batch.diagnostics();
  const expectedVertices = sourceMeshes.reduce(
    (sum, mesh) => sum + mesh.geometry.getAttribute('position').count,
    0,
  );
  const expectedTriangles = sourceMeshes.reduce(
    (sum, mesh) => sum + Math.floor((
      mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count
    ) / 3),
    0,
  );
  assert.equal(diagnostic.sourceVerticesPerInstance, expectedVertices);
  assert.equal(diagnostic.sourceTrianglesPerInstance, expectedTriangles);
  assert.equal(diagnostic.submittedVertices, expectedVertices * 512);
  assert.equal(diagnostic.submittedTriangles, expectedTriangles * 512);
  assert.equal(diagnostic.sourceGeometryIdentityPreserved, true);
  assert.equal(diagnostic.sourceTextureIdentityPreserved, true);
  assert.equal(diagnostic.sourcePbrMapIdentityPreserved, true);
  assert.equal(diagnostic.sourceAlphaStatePreserved, true);
  assert.equal(diagnostic.sourceSideStatePreserved, true);
  assert.equal(diagnostic.sourceVertexColorStatePreserved, true);
  assert.equal(diagnostic.sourceTransformLayoutValidated, true);
  assert.equal(diagnostic.sourceBoneLayoutValidated, true);

  const submitted: THREE.InstancedMesh[] = [];
  batch.group.traverse((object) => {
    const mesh = object as THREE.InstancedMesh;
    if (mesh.isInstancedMesh) submitted.push(mesh);
  });
  assert.equal(submitted.length, sourceMeshes.length);
  for (let index = 0; index < sourceMeshes.length; index++) {
    assert.equal(
      submitted[index]!.geometry,
      sourceMeshes[index]!.geometry,
      `${label} layer ${index} must submit the source GLB vertex buffer`,
    );
    assert.equal(submitted[index]!.count, 512);
  }

  const posed = cloneSkinned(gltf.scene) as THREE.Group;
  posed.position.set(8, 0.1, -6);
  posed.rotation.y = 0.72;
  posed.scale.setScalar(0.97);
  parent.add(posed);
  posed.updateMatrixWorld(true);
  const mixer = new THREE.AnimationMixer(posed);
  const idle = gltf.animations.find((clip) => clip.name.toLowerCase() === 'idle');
  assert.ok(idle, `${label} must retain the authored idle clip`);
  mixer.clipAction(idle, posed).play();
  mixer.update(1 / 30);

  batch.setCount(1);
  batch.setFromCloneAt(0, posed);
  batch.commit();
  diagnostic = batch.diagnostics();
  assert.equal(diagnostic.count, 1);
  assert.equal(diagnostic.lastPoseUploadBytes, diagnostic.boneCount * 16 * 4);
  assert.equal(diagnostic.resizeCount, 1);
  totalFixedDrawCalls += diagnostic.drawCalls;
  totalSubmittedTriangles += diagnostic.submittedTriangles;
  batch.dispose();
}

const crowdSource = readFileSync(
  new URL('../src/settlement/SettlementCrowdRenderer.ts', import.meta.url),
  'utf8',
);
for (const expected of [
  /AuthoredSkinnedInstanceBatch/,
  /ExactMountedAttachmentBatch/,
  /batch\.setFromCloneAt\(slot, visual\.model\)/,
  /batch\.reserve\(count\)/,
  /batch\.setCount\(count\)/,
  /proxyAgents:\s*0/,
]) {
  assert.match(crowdSource, expected);
}
for (const forbidden of [
  /StrategicHumanoidRenderer/,
  /FallbackMilitaryEquipmentRenderer/,
  /createReplicatedSkinnedGeometry/,
  /MAX_ANIMATED_VILLAGERS/,
  /AUTHORED_RIG_(?:DISABLE|RESTORE)_ORBIT_DISTANCE/,
]) {
  assert.doesNotMatch(crowdSource, forbidden);
}

console.log(
  `Exact crowd source batching verified across ${assets.length} authored rigs: `
    + `${totalFixedDrawCalls} fixed body draws, ${totalSubmittedTriangles} one-instance triangles.`,
);
