import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const authoringManifestPath = path.join(
  repositoryRoot,
  'art-source',
  'gorski-architecture-kit',
  'out',
  'gorski_architecture_kit_manifest.json',
);
const runtimeRoot = path.join(
  repositoryRoot,
  'public',
  'assets',
  'models',
  'buildings',
  'gorski',
  'architecture-kit-v1',
);
const runtimeManifestPath = path.join(runtimeRoot, 'manifest.json');

const authoringManifest = readJson(authoringManifestPath);
const runtimeManifest = readJson(runtimeManifestPath);
assert.deepEqual(runtimeManifest, authoringManifest, 'Runtime and authoring manifests drifted');
assert.equal(runtimeManifest.schemaVersion, 2);
assert.equal(runtimeManifest.kit.version, '1.1.0');
assert.equal(runtimeManifest.kit.unit, 'metre');
assert.equal(runtimeManifest.kit.gridM, 2);
assert.match(runtimeManifest.kit.vegetationOwner, /SeedThree/);
assert.equal(runtimeManifest.summary.partCount, 638);
assert.equal(runtimeManifest.summary.familyCount, 12);
assert.equal(runtimeManifest.summary.totalTriangles, 409_862);
assert.equal(runtimeManifest.summary.buildingCategories, 44);
assert.equal(runtimeManifest.summary.supplementalCategories, 34);

const catalogKinds = readCatalogKinds();
for (const kind of catalogKinds) {
  assert.ok(runtimeManifest.coverage[kind], `Runtime coverage is missing ${kind}`);
}
assert.equal(
  Object.keys(runtimeManifest.coverage).length,
  runtimeManifest.summary.buildingCategories + runtimeManifest.summary.supplementalCategories,
  'Combined runtime coverage count drifted',
);

const partIds = new Set();
let bundledParts = 0;
let bundledTriangles = 0;
let bundledBytes = 0;
for (const [family, expectedCount] of Object.entries(runtimeManifest.families)) {
  const runtime = runtimeManifest.runtime.families[family];
  assert.ok(runtime, `Missing runtime bundle metadata for ${family}`);
  assert.equal(runtime.partCount, expectedCount, `${family} runtime count drifted`);
  assert.equal(
    runtime.url,
    `/assets/models/buildings/gorski/architecture-kit-v1/${family}.glb`,
  );
  const bundle = readGlb(path.join(runtimeRoot, `${family}.glb`));
  assert.equal(bundle.bytes.length, runtime.bytes, `${family} byte count drifted`);
  assert.ok(bundle.bytes.length < 16 * 1024 * 1024, `${family} bundle should stay below 16 MiB`);
  assert.deepEqual(bundle.json.images ?? [], [], `${family} must use the shared runtime atlas`);
  assert.equal(bundle.json.nodes?.length, expectedCount, `${family} node count drifted`);
  assert.equal(bundle.json.meshes?.length, expectedCount, `${family} mesh count drifted`);
  assert.equal(bundle.json.scenes?.[0]?.extras?.gk_kit_version, '1.1.0');
  assert.equal(
    bundle.json.scenes?.[0]?.extras?.gk_contract,
    'component library only; no finished building assemblies',
  );

  const familyTriangles = countTriangles(bundle.json);
  assert.equal(familyTriangles, runtime.triangles, `${family} triangle count drifted`);
  for (const node of bundle.json.nodes ?? []) {
    const partId = node.extras?.gk_id;
    assert.equal(typeof partId, 'string', `${family} contains a node without gk_id`);
    assert.equal(node.extras?.gk_family, family, `${partId} is in the wrong bundle`);
    assert.ok(!partIds.has(partId), `Duplicate runtime part ${partId}`);
    partIds.add(partId);
  }
  for (const material of bundle.json.materials ?? []) {
    assert.equal(typeof material.extras?.gk_material_key, 'string');
    assert.equal(material.extras?.gk_uv_set, 'GK_UV0');
  }
  bundledParts += expectedCount;
  bundledTriangles += familyTriangles;
  bundledBytes += bundle.bytes.length;
}

assert.equal(bundledParts, runtimeManifest.summary.partCount);
assert.equal(bundledTriangles, runtimeManifest.summary.totalTriangles);
assert.equal(partIds.size, runtimeManifest.parts.length);
for (const part of runtimeManifest.parts) {
  assert.ok(partIds.has(part.id), `Manifest part ${part.id} is absent from runtime GLBs`);
  assert.equal(part.originContract, 'canonical local origin; X run, Y depth, Z up');
  assert.deepEqual(part.uvLayers, ['GK_UV0']);
}

for (const part of runtimeManifest.parts) {
  assert.doesNotMatch(part.id, /agri_crop_strip/i, `${part.id} violates the SeedThree boundary`);
  assert.ok(!part.tags.includes('vegetation'), `${part.id} has living-vegetation tags`);
  assert.ok(!part.materials.includes('foliage'), `${part.id} uses a living foliage material`);
  assert.ok(!part.materials.includes('crop'), `${part.id} uses a living crop material`);
}

const loaderSource = fs.readFileSync(
  path.join(repositoryRoot, 'src', 'buildings', 'gorskiArchitectureKit.ts'),
  'utf8',
);
assert.match(loaderSource, /preloadGorskiArchitectureFamily/);
assert.match(loaderSource, /createGorskiArchitecturePart/);
assert.match(loaderSource, /loadGorskiArchitecturePart/);
assert.match(loaderSource, /prepareGorskiArchitectureSourceScene/);
assert.match(loaderSource, /child\.position\.set\(0, 0, 0\)/);
assert.match(loaderSource, /mesh\.geometry = mesh\.geometry\.clone\(\)/);
assert.match(loaderSource, /familyLoadPromises/);

const materialSource = fs.readFileSync(
  path.join(repositoryRoot, 'src', 'buildings', 'authoredArchitectureModels.ts'),
  'utf8',
);
for (const materialKey of [
  'limestone_warm',
  'fieldstone',
  'oak_dark',
  'timber_weathered',
  'shingles',
  'terracotta',
  'thatch',
  'iron',
  'canvas',
]) {
  assert.match(materialSource, new RegExp(`${materialKey}:`), `${materialKey} atlas mapping is absent`);
}
assert.match(
  materialSource,
  /else if \(kitMaterialKey\)[\s\S]+material\.roughness = source\.roughness;[\s\S]+material\.metalness = source\.metalness;/,
  'Unmapped glass, water, leather, and wax must retain their authored scalar material values',
);

console.log('Gorski architecture-kit runtime integration passed.');
console.log(`  ${bundledParts} parts across 12 lazy family GLBs`);
console.log(`  ${bundledTriangles.toLocaleString('en-US')} triangles, ${formatMiB(bundledBytes)} total`);
console.log('  44 authoritative + 34 supplemental coverage categories');

function readCatalogKinds() {
  const source = fs.readFileSync(
    path.join(repositoryRoot, 'src', 'generated', 'gameBalance.ts'),
    'utf8',
  );
  const match = source.match(/export const BUILDING_KINDS = (\[[^;]+\]) as const;/);
  assert.ok(match, 'Unable to read BUILDING_KINDS');
  return JSON.parse(match[1]);
}

function readJson(filename) {
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

function readGlb(filename) {
  const bytes = fs.readFileSync(filename);
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, `${filename} is not a GLB`);
  assert.equal(bytes.readUInt32LE(4), 2, `${filename} is not glTF 2.0`);
  const jsonLength = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, `${filename} has no JSON chunk`);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
  return { bytes, json };
}

function countTriangles(json) {
  let triangles = 0;
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const accessorIndex = primitive.indices ?? primitive.attributes?.POSITION;
      const count = json.accessors?.[accessorIndex]?.count ?? 0;
      const mode = primitive.mode ?? 4;
      if (mode === 4) triangles += count / 3;
      else if (mode === 5 || mode === 6) triangles += Math.max(0, count - 2);
      else assert.fail(`Unsupported primitive mode ${mode}`);
    }
  }
  return triangles;
}

function formatMiB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
