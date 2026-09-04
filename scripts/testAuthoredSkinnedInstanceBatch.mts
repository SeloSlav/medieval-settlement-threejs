import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { materialColor as authoredMaterialColor } from 'three/tsl';
import {
  AuthoredSkinnedInstanceBatch,
} from '../src/scene/AuthoredSkinnedInstanceBatch.ts';

function firstSkinnedMesh(root: THREE.Object3D): THREE.SkinnedMesh {
  let match: THREE.SkinnedMesh | null = null;
  root.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!match && mesh.isSkinnedMesh) match = mesh;
  });
  if (!match) throw new Error(`${root.name || root.type} contains no SkinnedMesh`);
  return match;
}

function assertMatrixClose(
  actual: ArrayLike<number>,
  expected: ArrayLike<number>,
  label: string,
): void {
  assert.equal(actual.length, expected.length, `${label} matrix component count`);
  for (let index = 0; index < actual.length; index++) {
    assert.ok(
      Math.abs(actual[index]! - expected[index]!) <= 1e-4,
      `${label} component ${index}: ${actual[index]} != ${expected[index]}`,
    );
  }
}

function assertVectorClose(
  actual: THREE.Vector3,
  expected: THREE.Vector3,
  label: string,
  epsilon = 1e-4,
): void {
  assert.ok(
    actual.distanceTo(expected) <= epsilon,
    `${label}: (${actual.toArray().join(', ')}) != (${expected.toArray().join(', ')})`,
  );
}

function findNonRootVertexInfluence(
  mesh: THREE.SkinnedMesh,
): { vertexIndex: number; boneIndex: number } {
  const skinIndex = mesh.geometry.getAttribute('skinIndex');
  const skinWeight = mesh.geometry.getAttribute('skinWeight');
  for (let vertex = 0; vertex < skinIndex.count; vertex++) {
    const indices = [
      skinIndex.getX(vertex),
      skinIndex.getY(vertex),
      skinIndex.getZ(vertex),
      skinIndex.getW(vertex),
    ];
    const weights = [
      skinWeight.getX(vertex),
      skinWeight.getY(vertex),
      skinWeight.getZ(vertex),
      skinWeight.getW(vertex),
    ];
    for (let component = 0; component < 4; component++) {
      if (indices[component]! > 0 && weights[component]! > 1e-3) {
        return { vertexIndex: vertex, boneIndex: indices[component]! };
      }
    }
  }
  throw new Error(`${mesh.name || mesh.type} has no vertex influenced by a non-root bone`);
}

function applyUploadedPaletteToVertex(
  mesh: THREE.SkinnedMesh,
  vertexIndex: number,
  palette: Float32Array,
): THREE.Vector3 {
  const position = new THREE.Vector3().fromBufferAttribute(
    mesh.geometry.getAttribute('position'),
    vertexIndex,
  ).applyMatrix4(mesh.bindMatrix);
  const skinIndex = mesh.geometry.getAttribute('skinIndex');
  const skinWeight = mesh.geometry.getAttribute('skinWeight');
  const indices = [
    skinIndex.getX(vertexIndex),
    skinIndex.getY(vertexIndex),
    skinIndex.getZ(vertexIndex),
    skinIndex.getW(vertexIndex),
  ];
  const weights = [
    skinWeight.getX(vertexIndex),
    skinWeight.getY(vertexIndex),
    skinWeight.getZ(vertexIndex),
    skinWeight.getW(vertexIndex),
  ];
  const result = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const transformed = new THREE.Vector3();
  for (let component = 0; component < 4; component++) {
    const weight = weights[component]!;
    if (weight === 0) continue;
    matrix.fromArray(palette, indices[component]! * 16);
    transformed.copy(position).applyMatrix4(matrix);
    result.addScaledVector(transformed, weight);
  }
  return result;
}

function submittedBatchMaterials(
  batch: AuthoredSkinnedInstanceBatch,
): Array<THREE.MeshStandardMaterial & {
  colorNode?: unknown;
  emissiveNode?: unknown;
  metalnessNode?: unknown;
  normalNode?: unknown;
  opacityNode?: unknown;
  roughnessNode?: unknown;
}> {
  const materials: Array<THREE.MeshStandardMaterial & {
    colorNode?: unknown;
    emissiveNode?: unknown;
    metalnessNode?: unknown;
    normalNode?: unknown;
    opacityNode?: unknown;
    roughnessNode?: unknown;
  }> = [];
  batch.group.traverse((object) => {
    const mesh = object as THREE.InstancedMesh;
    if (!mesh.isInstancedMesh) return;
    const submitted = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of submitted) {
      materials.push(material as typeof materials[number]);
    }
  });
  return materials;
}

function assertStockAuthoredSurfaceContract(
  actual: THREE.MeshStandardMaterial & {
    colorNode?: unknown;
    emissiveNode?: unknown;
    metalnessNode?: unknown;
    normalNode?: unknown;
    opacityNode?: unknown;
    roughnessNode?: unknown;
  },
  authored: THREE.MeshStandardMaterial,
): void {
  assert.equal(
    actual.colorNode,
    authoredMaterialColor,
    'a baked Tripo body must explicitly bind the complete authored material-color node',
  );
  assert.equal(actual.normalNode, null, 'authored normal/map setup remains material-owned');
  assert.equal(actual.emissiveNode, null, 'authored emissive/map setup remains material-owned');
  assert.equal(actual.metalnessNode, null, 'authored metalness/map setup remains material-owned');
  assert.equal(actual.roughnessNode, null, 'authored roughness/map setup remains material-owned');
  assert.equal(actual.opacityNode, null, 'authored opacity/alpha setup remains material-owned');
  assert.equal(actual.map, authored.map, 'authored baked albedo texture identity');
  assert.equal(actual.normalMap, authored.normalMap, 'authored normal texture identity');
  assert.equal(actual.roughnessMap, authored.roughnessMap, 'authored roughness texture identity');
  assert.equal(actual.metalnessMap, authored.metalnessMap, 'authored metalness texture identity');
  assert.ok(actual.color.equals(authored.color), 'authored base color');
  assert.ok(actual.emissive.equals(authored.emissive), 'authored emissive color');
  assert.equal(actual.emissiveIntensity, authored.emissiveIntensity, 'authored emissive intensity');
  assert.equal(actual.roughness, authored.roughness, 'authored roughness');
  assert.equal(actual.metalness, authored.metalness, 'authored metalness');
  assert.equal(actual.normalMapType, authored.normalMapType, 'authored normal-map convention');
  assert.ok(actual.normalScale.equals(authored.normalScale), 'authored normal-map scale');
  assert.equal(actual.alphaTest, authored.alphaTest, 'authored alpha cutoff');
  assert.equal(actual.transparent, authored.transparent, 'authored transparency');
  assert.equal(actual.opacity, authored.opacity, 'authored opacity');
  assert.equal(actual.side, authored.side, 'authored face side');
  assert.equal(actual.shadowSide, authored.shadowSide, 'authored shadow side');
  assert.equal(actual.vertexColors, authored.vertexColors, 'authored vertex-color policy');
}

async function loadRealGlb(path: string): Promise<THREE.Group> {
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
  const bytes = readFileSync(path);
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const gltf = await new GLTFLoader().parseAsync(arrayBuffer, '');
  gltf.scene.updateMatrixWorld(true);
  return gltf.scene;
}

function makeAuthoredRig(options: {
  materialCount?: number;
  morph?: boolean;
} = {}): {
  root: THREE.Group;
  skeleton: THREE.Skeleton;
  geometry: THREE.BufferGeometry;
  materials: THREE.MeshStandardMaterial[];
  textures: THREE.DataTexture[];
} {
  const root = new THREE.Group();
  root.name = 'Authored quadruped-shaped test rig';
  const hip = new THREE.Bone();
  hip.name = 'hip';
  const spine = new THREE.Bone();
  spine.name = 'spine';
  spine.position.y = 0.5;
  const neck = new THREE.Bone();
  neck.name = 'neck';
  neck.position.y = 0.45;
  const head = new THREE.Bone();
  head.name = 'head';
  head.position.z = 0.35;
  hip.add(spine);
  spine.add(neck);
  neck.add(head);
  root.add(hip);

  const skeleton = new THREE.Skeleton([hip, spine, neck, head]);
  skeleton.calculateInverses();
  skeleton.update();

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.5, 0, 0,
    0.5, 0, 0,
    0, 1, 0,
    -0.4, 0, 0.2,
    0.4, 0, 0.2,
    0, 0.8, 0.2,
  ], 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 0.5, 1,
    0, 0, 1, 0, 0.5, 1,
  ], 2));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([
    0, 0, 0, 0,
    0, 0, 0, 0,
    1, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    2, 1, 0, 0,
  ], 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([
    1, 0, 0, 0,
    1, 0, 0, 0,
    1, 0, 0, 0,
    1, 0, 0, 0,
    1, 0, 0, 0,
    0.7, 0.3, 0, 0,
  ], 4));
  geometry.setIndex([0, 1, 2, 3, 4, 5]);

  const materialCount = options.materialCount ?? 2;
  const textures = Array.from({ length: materialCount }, (_, index) => {
    const texture = new THREE.DataTexture(
      new Uint8Array([100 + index * 20, 80, 60, 255]),
      1,
      1,
    );
    texture.name = `authored texture ${index}`;
    return texture;
  });
  const materials = textures.map((map, index) => {
    const material = new THREE.MeshStandardMaterial({
      map,
      roughness: 0.47 + index * 0.1,
      metalness: 0.08,
      side: index === 0 ? THREE.FrontSide : THREE.DoubleSide,
      transparent: index === 1,
      alphaTest: index === 1 ? 0.35 : 0,
    });
    material.name = index === 0 ? 'hide' : 'mane';
    return material;
  });
  geometry.clearGroups();
  geometry.addGroup(0, 3, 0);
  if (materialCount > 1) geometry.addGroup(3, 3, 1);
  if (options.morph) {
    geometry.morphAttributes.position = [
      new THREE.Float32BufferAttribute(new Float32Array(18), 3),
    ];
  }

  const mesh = new THREE.SkinnedMesh(
    geometry,
    materialCount === 1 ? materials[0]! : materials,
  );
  mesh.name = 'authored animal body';
  mesh.bind(skeleton);
  root.add(mesh);
  return { root, skeleton, geometry, materials, textures };
}

const fixture = makeAuthoredRig();
const parent = new THREE.Group();
const batch = new AuthoredSkinnedInstanceBatch({
  parent,
  sourceRoot: fixture.root,
  capacity: 3,
  name: 'Exact animal crowd',
});

assert.equal(parent.children.includes(batch.group), true);
assert.deepEqual(
  batch.materialSlots().map((slot) => slot.name),
  ['hide', 'mane'],
  'authored material identities must remain addressable for per-agent variation',
);
batch.setCount(3);
const matrix = new THREE.Matrix4();
for (let slot = 0; slot < 3; slot++) {
  matrix.makeTranslation(slot * 1.5, 0.2, slot * -0.75);
  batch.setMatrixAt(slot, matrix);
  fixture.skeleton.bones[1]!.rotation.z = slot * 0.15;
  fixture.root.updateMatrixWorld(true);
  fixture.skeleton.update();
  batch.setPoseAt(slot, fixture.skeleton.boneMatrices);
  batch.setMaterialColorAt(slot, 0, new THREE.Color().setHSL(slot / 3, 0.3, 0.6));
  batch.setMaterialColorAt(slot, 1, 0x332211 + slot);
}
batch.commit();

let diagnostic = batch.diagnostics();
assert.equal(diagnostic.capacity, 3);
assert.equal(diagnostic.count, 3);
assert.equal(diagnostic.boneCount, 4);
assert.equal(diagnostic.sourceLayerCount, 1);
assert.equal(diagnostic.sourceMaterialCount, 2);
assert.equal(diagnostic.drawCalls, 2);
assert.equal(diagnostic.sourceVerticesPerInstance, 6);
assert.equal(diagnostic.sourceTrianglesPerInstance, 2);
assert.equal(diagnostic.submittedVertices, 18);
assert.equal(diagnostic.submittedTriangles, 6);
assert.equal(diagnostic.posePaletteBytes, 3 * 4 * 16 * 4);
assert.equal(diagnostic.lastPoseUploadBytes, 3 * 4 * 16 * 4);
assert.equal(diagnostic.sourceGeometryIdentityPreserved, true);
assert.equal(diagnostic.sourceTextureIdentityPreserved, true);
assert.equal(diagnostic.sourcePbrMapIdentityPreserved, true);
assert.equal(diagnostic.sourceAlphaStatePreserved, true);
assert.equal(diagnostic.sourceSideStatePreserved, true);
assert.equal(diagnostic.sourceVertexColorStatePreserved, true);
assert.equal(diagnostic.sourceTransformLayoutValidated, true);
assert.equal(diagnostic.sourceBoneLayoutValidated, true);
assert.deepEqual(batch.boneNames(), ['hip', 'spine', 'neck', 'head']);

const submittedMeshes: THREE.InstancedMesh[] = [];
batch.group.traverse((object) => {
  const mesh = object as THREE.InstancedMesh;
  if (mesh.isInstancedMesh) submittedMeshes.push(mesh);
});
assert.equal(submittedMeshes.length, 1, 'one source mesh must remain one instanced mesh');
assert.equal(submittedMeshes[0]!.geometry, fixture.geometry, 'source geometry must not be substituted');
const submittedMaterials = submittedMeshes[0]!.material as THREE.MeshStandardMaterial[];
assert.equal(submittedMaterials[0]!.map, fixture.textures[0]);
assert.equal(submittedMaterials[1]!.map, fixture.textures[1]);
assert.equal(submittedMaterials[1]!.side, THREE.DoubleSide);
assert.equal(submittedMaterials[1]!.transparent, true);
assert.equal(submittedMaterials[1]!.alphaTest, 0.35);
for (const material of submittedMaterials) {
  assert.equal(
    Boolean((material as THREE.MeshStandardMaterial & {
      castShadowPositionNode?: { isNode?: boolean };
    }).castShadowPositionNode?.isNode),
    true,
    'the shadow override must deform each instance through the live pose palette',
  );
}

// Regression: production Tripo humans are a single baked material. Their color
// pass must explicitly bind Three's complete materialColor node, never an
// instance-storage tint and never an adapter-dependent null fallback. Affected
// cold WebGPU compiles otherwise rendered correct shadows while omitting or
// blackening the body color pass. Use non-default authored values so
// Material.copy() defaults cannot make this contract pass accidentally.
const bakedTripoFixture = makeAuthoredRig({ materialCount: 1 });
const bakedTripoSource = bakedTripoFixture.materials[0]!;
bakedTripoSource.name = 'tripo_mat_material-contract-regression';
bakedTripoSource.color.setHex(0xc29a73);
bakedTripoSource.emissive.setHex(0x160a03);
bakedTripoSource.emissiveIntensity = 0.37;
bakedTripoSource.roughness = 0.63;
bakedTripoSource.metalness = 0.14;
bakedTripoSource.normalMap = bakedTripoFixture.textures[0]!;
bakedTripoSource.normalScale.set(0.72, 0.81);
bakedTripoSource.alphaTest = 0.19;
bakedTripoSource.transparent = true;
bakedTripoSource.opacity = 0.91;
bakedTripoSource.side = THREE.DoubleSide;
bakedTripoSource.shadowSide = THREE.BackSide;

const bakedTripoBatch = new AuthoredSkinnedInstanceBatch({
  parent: new THREE.Group(),
  sourceRoot: bakedTripoFixture.root,
  capacity: 1,
  name: 'Baked Tripo material regression batch',
});
bakedTripoBatch.setCount(1);
bakedTripoBatch.setMaterialColorAt(0, 0, 0x000000);
bakedTripoBatch.commit();
const bakedTripoSubmitted = submittedBatchMaterials(bakedTripoBatch);
assert.equal(bakedTripoSubmitted.length, 1);
assertStockAuthoredSurfaceContract(bakedTripoSubmitted[0]!, bakedTripoSource);
bakedTripoBatch.dispose();
for (const material of bakedTripoFixture.materials) material.dispose();
for (const texture of bakedTripoFixture.textures) texture.dispose();
bakedTripoFixture.geometry.dispose();

// Multi-material legacy assets still deliberately use semantic palette slots.
// This counterpart makes the test reject a broad "disable all tint" workaround.
const semanticTintFixture = makeAuthoredRig({ materialCount: 1 });
semanticTintFixture.materials[0]!.name = 'skin';
const semanticTintBatch = new AuthoredSkinnedInstanceBatch({
  parent: new THREE.Group(),
  sourceRoot: semanticTintFixture.root,
  capacity: 1,
  name: 'Semantic tint control batch',
});
assert.notEqual(
  submittedBatchMaterials(semanticTintBatch)[0]!.colorNode,
  null,
  'semantic legacy slots retain intentional per-instance color variation',
);
assert.notEqual(
  submittedBatchMaterials(semanticTintBatch)[0]!.colorNode,
  authoredMaterialColor,
  'semantic legacy slots multiply the authored color by their storage tint',
);
semanticTintBatch.dispose();
for (const material of semanticTintFixture.materials) material.dispose();
for (const texture of semanticTintFixture.textures) texture.dispose();
semanticTintFixture.geometry.dispose();

// Exercise the actual r185 WGSL node builder. The ordinary batch assertions
// above can pass even when a custom setupPosition() creates a recursive node
// graph that stalls the browser's first render.
const webgpuRuntime = await import('three/webgpu') as unknown as {
  ShadowNodeMaterial: new () => THREE.Material & { positionNode: unknown };
  WGSLNodeBuilder: new (object: THREE.Object3D, renderer: unknown) => {
    camera: THREE.Camera;
    context: Record<string, unknown>;
    fragmentShader: string;
    lightsNode: unknown;
    material: THREE.Material;
    scene: THREE.Scene;
    vertexShader: string;
    build(): void;
  };
  StandardNodeLibrary: new () => unknown;
};
const tslRuntime = await import('three/tsl') as unknown as {
  context(): unknown;
  lights(lights?: readonly THREE.Light[]): unknown;
};
const builderRenderer = {
  backend: {
    capabilities: { getUniformBufferLimit: () => 64 * 1024 },
    isWebGPUBackend: true,
    utils: { getTextureSampleData: () => ({ primarySamples: 1 }) },
  },
  contextNode: tslRuntime.context(),
  coordinateSystem: THREE.WebGPUCoordinateSystem,
  currentSamples: 1,
  depth: true,
  getMRT: () => null,
  getRenderTarget: () => null,
  hasCompatibility: () => false,
  hasFeature: () => false,
  library: new webgpuRuntime.StandardNodeLibrary(),
  lighting: true,
  logarithmicDepthBuffer: false,
  outputColorSpace: THREE.SRGBColorSpace,
  shadowMap: { enabled: false, type: THREE.PCFShadowMap },
};
const wgslBuilder = new webgpuRuntime.WGSLNodeBuilder(
  submittedMeshes[0]!,
  builderRenderer,
);
wgslBuilder.material = submittedMaterials[0]!;
wgslBuilder.camera = new THREE.PerspectiveCamera();
wgslBuilder.scene = new THREE.Scene();
wgslBuilder.context.material = submittedMaterials[0]!;
wgslBuilder.lightsNode = tslRuntime.lights();
const wgslBuildStartedAt = performance.now();
wgslBuilder.build();
const wgslBuildDurationMs = performance.now() - wgslBuildStartedAt;
if (process.env.PRINT_AUTHORED_SKIN_WGSL === '1') console.log(wgslBuilder.vertexShader);
assert.ok(wgslBuilder.vertexShader.includes('@vertex'));
assert.ok(wgslBuilder.fragmentShader.includes('@fragment'));
assert.ok(
  wgslBuildDurationMs < 1_000,
  `exact authored skinning WGSL build took ${wgslBuildDurationMs.toFixed(1)}ms`,
);

// Build the same position node through Three's shadow override material. This
// is the pass that used to fall back to source geometry and cast a T-pose even
// while the visible batch was seated or walking.
const shadowMaterial = new webgpuRuntime.ShadowNodeMaterial();
shadowMaterial.positionNode = (submittedMaterials[0] as THREE.MeshStandardMaterial & {
  castShadowPositionNode: unknown;
}).castShadowPositionNode;
const shadowWgslBuilder = new webgpuRuntime.WGSLNodeBuilder(
  submittedMeshes[0]!,
  builderRenderer,
);
shadowWgslBuilder.material = shadowMaterial;
shadowWgslBuilder.camera = new THREE.OrthographicCamera();
shadowWgslBuilder.scene = new THREE.Scene();
shadowWgslBuilder.context.material = shadowMaterial;
shadowWgslBuilder.lightsNode = tslRuntime.lights();
shadowWgslBuilder.build();
assert.ok(shadowWgslBuilder.vertexShader.includes('@vertex'));
assert.match(
  shadowWgslBuilder.vertexShader,
  /skinIndex/,
  'shadow WGSL must read authored skin weights instead of submitting the source T-pose',
);

batch.reserve(7);
diagnostic = batch.diagnostics();
assert.ok(diagnostic.capacity >= 7);
assert.equal(diagnostic.count, 3);
assert.equal(diagnostic.resizeCount, 1);
assert.equal(diagnostic.sourceGeometryIdentityPreserved, true);
assert.equal(diagnostic.sourceTextureIdentityPreserved, true);

assert.throws(
  () => batch.setPoseAt(0, new Float32Array(16)),
  /requires 64 matrix components/,
);
assert.throws(() => batch.setMaterialColorAt(0, 2, 0xffffff), /outside 2 source materials/);

const morphFixture = makeAuthoredRig({ materialCount: 1, morph: true });
assert.throws(
  () => new AuthoredSkinnedInstanceBatch({
    parent: new THREE.Group(),
    sourceRoot: morphFixture.root,
  }),
  /refuses to discard them/,
  'unsupported authored deformation must fail rather than degrade appearance',
);

for (const mismatch of ['bone-name'] as const) {
  const mismatchedFixture = makeAuthoredRig({ materialCount: 1 });
  const duplicateRoot = cloneSkinned(mismatchedFixture.root) as THREE.Group;
  const duplicateMesh = firstSkinnedMesh(duplicateRoot);
  duplicateMesh.removeFromParent();
  mismatchedFixture.root.add(duplicateMesh);
  duplicateMesh.skeleton.bones[2]!.name = 'wrong-neck';
  assert.throws(
    () => new AuthoredSkinnedInstanceBatch({
      parent: new THREE.Group(),
      sourceRoot: mismatchedFixture.root,
    }),
    /bone 2 is wrong-neck/,
    `every source layer must reject a mismatched ${mismatch}`,
  );
  for (const material of mismatchedFixture.materials) material.dispose();
  for (const texture of mismatchedFixture.textures) texture.dispose();
  mismatchedFixture.geometry.dispose();
}

const mismatchedInverses = fixture.skeleton.boneInverses.map((matrix) => matrix.clone());
mismatchedInverses[2]!.elements[12] += 0.25;
const inverseMismatchSkeleton = new THREE.Skeleton(
  fixture.skeleton.bones,
  mismatchedInverses,
);
assert.throws(
  () => batch.validateSkeleton(inverseMismatchSkeleton, 'inverse mismatch fixture'),
  /inverse bind 2 differs/,
);

const source = readFileSync(
  new URL('../src/scene/AuthoredSkinnedInstanceBatch.ts', import.meta.url),
  'utf8',
);
assert.doesNotMatch(source, /CapsuleGeometry|SphereGeometry|BoxGeometry/);
assert.match(source, /mesh\.instanceMatrix = this\.instanceMatrices/);
assert.match(source, /mesh\.userData\.sourceGeometryUuid = source\.geometry\.uuid/);
assert.match(source, /sourceGeometryIdentityPreserved/);
assert.match(source, /sourceTextureIdentityPreserved/);
assert.match(source, /setFromCloneAt/);
assert.match(source, /inverseBatchWorld/);
assert.match(source, /validateSkeletonLayout/);

for (const realAsset of [
  {
    label: 'male villager',
    path: 'public/assets/models/villagers/worker-male-common-01-v002.glb',
    expectedBones: 41,
    expectsInternalBasis: false,
  },
  {
    label: 'cow',
    path: 'public/assets/models/livestock/quaternius-cow.glb',
    expectedBones: 42,
    expectsInternalBasis: true,
  },
] as const) {
  const sourceRoot = await loadRealGlb(realAsset.path);
  const sourceMesh = firstSkinnedMesh(sourceRoot);
  const sourceMeshes: THREE.SkinnedMesh[] = [];
  sourceRoot.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) sourceMeshes.push(mesh);
  });
  const stage = new THREE.Group();
  stage.position.set(4.5, -0.25, 8.25);
  stage.rotation.y = 0.17;
  stage.updateMatrixWorld(true);
  const batchParent = new THREE.Group();
  batchParent.position.set(-2.5, 0.4, 1.25);
  stage.add(batchParent);
  const realBatch = new AuthoredSkinnedInstanceBatch({
    parent: batchParent,
    sourceRoot,
    capacity: 2,
    name: `${realAsset.label} exact batch`,
  });
  assert.equal(realBatch.boneNames().length, realAsset.expectedBones);
  assert.deepEqual(
    realBatch.boneNames(),
    sourceMesh.skeleton.bones.map((bone) => bone.name),
    `${realAsset.label} bone order`,
  );

  const posedRoot = cloneSkinned(sourceRoot) as THREE.Group;
  posedRoot.position.set(12.5, 1.2, -7.75);
  posedRoot.rotation.y = -0.63;
  posedRoot.scale.setScalar(realAsset.label === 'cow' ? 0.009 : 1.035);
  stage.add(posedRoot);
  stage.updateMatrixWorld(true);
  const posedMesh = firstSkinnedMesh(posedRoot);
  const animatedInfluence = findNonRootVertexInfluence(posedMesh);
  posedMesh.skeleton.bones[animatedInfluence.boneIndex]!.rotation.z += 0.08;
  posedRoot.updateMatrixWorld(true);
  posedMesh.skeleton.update();

  realBatch.setCount(1);
  realBatch.setFromCloneAt(0, posedRoot);
  realBatch.commit();

  // Exercise the cached-clone fast path with a new exact pose and actor
  // transform, then compare every uploaded component against Three's
  // AttachedBindMode mesh-local palette. Raw Skeleton.boneMatrices are in
  // world space and would apply the actor transform twice once the instance
  // matrix also submits posedMesh.matrixWorld.
  posedMesh.skeleton.bones[animatedInfluence.boneIndex]!.rotation.x += 0.047;
  posedRoot.position.x += 0.31;
  realBatch.setFromCloneAt(0, posedRoot);
  realBatch.commit();
  posedRoot.updateMatrixWorld(true);
  posedMesh.skeleton.update();
  const internalPosePalette = (realBatch as unknown as {
    posePalette: { array: Float32Array };
  }).posePalette.array;
  const expectedMeshLocalPalette = new Float32Array(posedMesh.skeleton.boneMatrices.length);
  const posedMeshWorldInverse = posedMesh.matrixWorld.clone().invert();
  const expectedBoneOffset = new THREE.Matrix4();
  for (let boneIndex = 0; boneIndex < posedMesh.skeleton.bones.length; boneIndex++) {
    expectedBoneOffset
      .multiplyMatrices(
        posedMeshWorldInverse,
        posedMesh.skeleton.bones[boneIndex]!.matrixWorld,
      )
      .multiply(posedMesh.skeleton.boneInverses[boneIndex]!);
    expectedBoneOffset.toArray(expectedMeshLocalPalette, boneIndex * 16);
  }
  assertMatrixClose(
    internalPosePalette.subarray(0, expectedMeshLocalPalette.length),
    expectedMeshLocalPalette,
    `${realAsset.label} exact cached mesh-local pose palette`,
  );

  const realDiagnostic = realBatch.diagnostics();
  assert.equal(realDiagnostic.sourceGeometryIdentityPreserved, true);
  assert.equal(realDiagnostic.sourcePbrMapIdentityPreserved, true);
  assert.equal(realDiagnostic.sourceAlphaStatePreserved, true);
  assert.equal(realDiagnostic.sourceSideStatePreserved, true);
  assert.equal(realDiagnostic.sourceVertexColorStatePreserved, true);
  assert.equal(realDiagnostic.sourceTransformLayoutValidated, true);
  assert.equal(realDiagnostic.sourceBoneLayoutValidated, true);
  assert.equal(
    realDiagnostic.sourceVerticesPerInstance,
    sourceMeshes.reduce(
      (sum, mesh) => sum + mesh.geometry.getAttribute('position').count,
      0,
    ),
  );
  assert.equal(
    realDiagnostic.sourceTrianglesPerInstance,
    sourceMeshes.reduce(
      (sum, mesh) => sum + Math.floor((mesh.geometry.index?.count
        ?? mesh.geometry.getAttribute('position').count) / 3),
      0,
    ),
  );

  const authoredRootRelative = realDiagnostic.sourceMeshRootRelativeMatrices[0]!;
  const hasScaledRotatedInternalBasis = Math.abs(authoredRootRelative[0]!) > 50
    && Math.abs(authoredRootRelative[6]!) > 50
    && Math.abs(authoredRootRelative[9]!) > 50;
  assert.equal(
    hasScaledRotatedInternalBasis,
    realAsset.expectsInternalBasis,
    `${realAsset.label} authored parent basis contract`,
  );

  realBatch.group.updateWorldMatrix(true, false);
  posedMesh.updateWorldMatrix(true, false);
  const expectedInstanceMatrix = realBatch.group.matrixWorld.clone()
    .invert()
    .multiply(posedMesh.matrixWorld);
  let submitted: THREE.InstancedMesh | null = null;
  realBatch.group.traverse((object) => {
    const mesh = object as THREE.InstancedMesh;
    if (!submitted && mesh.isInstancedMesh) submitted = mesh;
  });
  assert.ok(submitted, `${realAsset.label} submitted layer`);
  assertMatrixClose(
    (submitted as THREE.InstancedMesh).instanceMatrix.array.subarray(0, 16),
    expectedInstanceMatrix.elements,
    `${realAsset.label} posed mesh relative transform`,
  );

  // Compare a real weighted vertex through both complete transforms. This
  // catches a palette/instance space mismatch even when each matrix looks
  // individually plausible: the authored body must land on the same world
  // point as Three's native SkinnedMesh (and therefore its mounted bones).
  const vertexIndex = animatedInfluence.vertexIndex;
  const authoredPosition = new THREE.Vector3().fromBufferAttribute(
    posedMesh.geometry.getAttribute('position'),
    vertexIndex,
  );
  const nativeWorldVertex = posedMesh.applyBoneTransform(
    vertexIndex,
    authoredPosition.clone(),
  ).applyMatrix4(posedMesh.matrixWorld);
  const batchLocalVertex = applyUploadedPaletteToVertex(
    posedMesh,
    vertexIndex,
    internalPosePalette,
  );
  const submittedMesh = submitted as THREE.InstancedMesh;
  submittedMesh.updateMatrixWorld(true);
  const submittedInstanceMatrix = new THREE.Matrix4().fromArray(
    submittedMesh.instanceMatrix.array,
    0,
  );
  const batchWorldVertex = batchLocalVertex.applyMatrix4(
    submittedMesh.matrixWorld.clone().multiply(submittedInstanceMatrix),
  );
  assertVectorClose(
    batchWorldVertex,
    nativeWorldVertex,
    `${realAsset.label} native/batched skinned world vertex`,
  );
  realBatch.validateSkeleton(posedMesh.skeleton, `${realAsset.label} clone`);
  realBatch.dispose();
}

batch.dispose();
assert.equal(batch.group.parent, null);
assert.equal(fixture.geometry.getAttribute('position').count, 6);
assert.equal(fixture.textures[0]!.image.width, 1, 'batch disposal must not dispose borrowed textures');

for (const material of fixture.materials) material.dispose();
for (const texture of fixture.textures) texture.dispose();
fixture.geometry.dispose();
for (const material of morphFixture.materials) material.dispose();
for (const texture of morphFixture.textures) texture.dispose();
morphFixture.geometry.dispose();

console.log(
  `Authored GPU-instanced skinning batch contract verified; WGSL built in `
    + `${wgslBuildDurationMs.toFixed(1)}ms (${wgslBuilder.vertexShader.length} vertex chars).`,
);
