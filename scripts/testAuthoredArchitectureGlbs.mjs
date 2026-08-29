import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoot = path.join(
  repositoryRoot,
  'public',
  'assets',
  'models',
  'buildings',
  'gorski',
);

const residence = readGlb('tier1_residence_retopo_v25.glb');
assert.equal(residence.json.nodes.length, 33, 'Tier 1 residence node count changed');
assert.equal(residence.json.meshes.length, 33, 'Tier 1 residence mesh count changed');
assert.equal(countTriangles(residence.json), 5_184, 'Tier 1 residence triangle count changed');
assert.ok(residence.bytes.length < 1_000_000, 'Tier 1 runtime GLB should stay below 1 MB');
assert.deepEqual(residence.json.images ?? [], [], 'Tier 1 must use the shared runtime atlas');
assert.equal(
  residence.json.asset.extras?.sourceGlb,
  'tier1_residence_retopo_v25.glb',
  'Tier 1 runtime source provenance is missing',
);
assertNames(residence.json, [
  'T1_Wall_Front_Door',
  'T1_Wall_Front_SquareHole_DarkInterior',
  'T1_RoofSkin_Left',
  'T1_RoofSkin_Right',
  'T1_Threshold_Steps',
]);
assert.ok(
  residence.json.materials.some(
    (material) => material.extras?.atlas_uv_mode === 'final tile coordinates baked into GK_UV0',
  ),
  'Tier 1 roof must retain its direct-atlas UV contract',
);

const camp = readGlb('hunters_camp_textured_v6.glb');
assert.equal(camp.json.nodes.length, 15, 'Hunter camp node count changed');
assert.equal(camp.json.meshes.length, 15, 'Hunter camp mesh count changed');
assert.equal(countTriangles(camp.json), 18_784, 'Hunter camp triangle count changed');
assert.ok(camp.bytes.length < 2_000_000, 'Hunter camp runtime GLB should stay below 2 MB');
assert.equal(
  camp.json.asset.extras?.sourceGlb,
  'hunters_camp_textured_v6.glb',
  'Hunter camp runtime source provenance is missing',
);
assert.deepEqual(
  (camp.json.images ?? []).map((image) => image.name).sort(),
  [
    'aged_canvas_albedo',
    'aged_canvas_normal',
    'stitched_hide_albedo',
    'stitched_hide_normal',
  ],
  'Hunter camp should keep only the authored canvas and hide maps',
);
for (const image of camp.json.images ?? []) {
  assert.ok(typeof image.uri === 'string', `${image.name} must be an external runtime texture`);
  assert.equal(image.bufferView, undefined, `${image.name} must not remain embedded`);
}
assertNames(camp.json, [
  'HC_Sleeping_Tent',
  'HC_Processing_Hide_Fly',
  'HC_Hearth',
  'HC_Cooking_Tripod',
  'HC_Hunter_Tool_Rack',
]);
const campNames = (camp.json.nodes ?? []).map((node) => node.name ?? '').join('|');
assert.doesNotMatch(
  campNames,
  /bow|axe|hook|weapon|hanging/i,
  'Removed or extraneous hunter-camp props returned',
);

const integrationSource = readText('src/buildings/authoredArchitectureModels.ts');
assert.match(integrationSource, /applyBuildingMaterialAtlasDirectUv/);
assert.match(integrationSource, /HuntersFoodStockpile/);
assert.match(integrationSource, /fpCollisionChildrenOnly/);
assert.match(readText('src/residences/ResidenceMarkers.ts'), /createAuthoredTierOneResidenceShell/);
assert.match(readText('src/buildings/BuildingMeshes.ts'), /createAuthoredHuntersCampMesh/);
assert.match(readText('src/app/appBootstrap.ts'), /preloadAuthoredArchitectureModels/);

console.log('Authored architecture GLB contract passed.');
console.log(`  Tier 1 residence: ${formatKiB(residence.bytes.length)}, 33 meshes, 5,184 tris`);
console.log(`  Hunter's camp: ${formatKiB(camp.bytes.length)}, 15 meshes, 18,784 tris`);

function readGlb(filename) {
  const bytes = fs.readFileSync(path.join(runtimeRoot, filename));
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

function assertNames(json, expectedNames) {
  const names = new Set((json.nodes ?? []).map((node) => node.name));
  for (const name of expectedNames) assert.ok(names.has(name), `Missing authored node ${name}`);
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
