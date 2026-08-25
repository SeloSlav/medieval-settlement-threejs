import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  COMMON_DOGWOOD_BRANCH_TEXTURE_FILES,
  COMMON_DOGWOOD_LEAF_TEXTURE_FILES,
  COMMON_DOGWOOD_SEED_PREFIX,
  COMMON_DOGWOOD_VARIANTS,
  commonDogwood,
  createCommonDogwoodVariantPreset,
} from '../src/vegetation/seedthree/commonDogwoodPreset.ts';
import {
  GORSKI_SHRUB_VARIANT_COUNT,
  createGorskiShrubPrototype,
} from '../src/vegetation/seedthree/gorskiShrubPrototypes.ts';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const dogwoodAssetRoot = join(projectRoot, 'src/assets/vegetation/common-dogwood');
const PORTABLE_WEBGPU_VERTEX_BUFFER_LIMIT = 8;
const DOGWOOD_TRIANGLE_BUDGET: readonly [number, number] = [4_500, 12_500];

assert.equal(GORSKI_SHRUB_VARIANT_COUNT, 3);
assert.equal(COMMON_DOGWOOD_VARIANTS.length, GORSKI_SHRUB_VARIANT_COUNT);
assert.deepEqual(
  COMMON_DOGWOOD_VARIANTS.map((variant) => variant.stemCount),
  [12, 19, 27],
  'the three dogwood variants must remain distinct basal-stem architectures',
);
assert.equal(commonDogwood.category, 'shrub');
assert.equal(commonDogwood.foliageType, 'singleLeaves');
assert.equal(commonDogwood.foliage.mode, 'leaves');
assert.equal(commonDogwood.foliage.whorlSize, 2, 'dogwood leaves must remain opposite pairs');
assert.ok(
  commonDogwood.foliage.rotate >= 85 && commonDogwood.foliage.rotate <= 95,
  'successive dogwood leaf pairs must remain approximately decussate',
);
assert.equal(commonDogwood.bark, COMMON_DOGWOOD_BRANCH_TEXTURE_FILES.albedo);
assert.equal(commonDogwood.leaf, COMMON_DOGWOOD_LEAF_TEXTURE_FILES.albedo);

const textureContracts = [
  ['branch', COMMON_DOGWOOD_BRANCH_TEXTURE_FILES, ['albedo', 'normal', 'roughness']],
  ['leaf', COMMON_DOGWOOD_LEAF_TEXTURE_FILES, ['albedo', 'normal', 'roughness', 'translucency']],
] as const;
const dogwoodTextureHashes = new Map<string, string>();
for (const [surface, files, maps] of textureContracts) {
  for (const map of maps) {
    const fileName = files[map];
    const filePath = join(dogwoodAssetRoot, fileName);
    assert.ok(existsSync(filePath), `dogwood ${surface} must own ${fileName}`);
    const bytes = readFileSync(filePath);
    assert.deepEqual(
      [...bytes.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
      `${fileName} must remain a PNG`,
    );
    assert.ok(bytes.byteLength > 32_000, `${fileName} appears to be a placeholder or truncated`);
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert.equal(
      dogwoodTextureHashes.has(hash),
      false,
      `${fileName} must not duplicate another dogwood PBR channel byte-for-byte`,
    );
    dogwoodTextureHashes.set(hash, fileName);
  }
}
const leafAlbedo = readFileSync(
  join(dogwoodAssetRoot, COMMON_DOGWOOD_LEAF_TEXTURE_FILES.albedo),
);
assert.equal(
  leafAlbedo[25],
  6,
  'dogwood leaf albedo must retain an RGBA alpha channel for exact winter card removal',
);
assertDedicatedAlbedo(COMMON_DOGWOOD_BRANCH_TEXTURE_FILES.albedo, 'branch');
assertDedicatedAlbedo(COMMON_DOGWOOD_LEAF_TEXTURE_FILES.albedo, 'leaf');

const firstPass = dogwoodPrototypeSignatures();
const secondPass = dogwoodPrototypeSignatures();
assert.deepEqual(
  secondPass,
  firstPass,
  'the same dogwood variant seeds must reproduce byte-identical prototype geometry',
);
assert.equal(
  new Set(Object.values(firstPass)).size,
  GORSKI_SHRUB_VARIANT_COUNT,
  'all three dogwood variants must retain different seed-stable geometry',
);

const shrubPrototypeSource = readFileSync(
  join(projectRoot, 'src/vegetation/seedthree/gorskiShrubPrototypes.ts'),
  'utf8',
);
const textureGraphSource = readFileSync(
  join(projectRoot, 'src/vegetation/seedthree/seedThreeTextures.ts'),
  'utf8',
);
const undergrowthSource = readFileSync(
  join(projectRoot, 'src/props/ForestUndergrowth.ts'),
  'utf8',
);
const forestManagerSource = readFileSync(
  join(projectRoot, 'src/props/ForestManager.ts'),
  'utf8',
);

assert.match(
  shrubPrototypeSource,
  /GorskiShrubKind[^;]*'dogwood'/,
  'dogwood must be a first-class Gorski shrub kind',
);
assert.match(
  textureGraphSource,
  /assets\/vegetation\/common-dogwood\/common_dogwood_/,
  'the production texture graph must bundle project-owned dogwood PBR maps',
);
assert.doesNotMatch(
  textureGraphSource,
  /vendor\/seedthree\/assets\/(?:bark|leaves)\/[^'\n]*common_dogwood/,
  'dogwood must not depend on hidden vendor-worktree textures',
);
assert.match(
  undergrowthSource,
  /UndergrowthKind[^;]*'dogwood'/,
  'live undergrowth placement and buckets must recognize dogwood',
);
assert.match(
  undergrowthSource,
  /COMMON_DOGWOOD_BRANCH_TEXTURE_FILES[\s\S]*from '\.\.\/vegetation\/seedthree\/commonDogwoodPreset\.ts'[\s\S]*dogwood: \{ \.\.\.COMMON_DOGWOOD_BRANCH_TEXTURE_FILES \}/,
  'live dogwood stems must consume their complete preset-owned A/N/R set',
);
assert.match(
  undergrowthSource,
  /COMMON_DOGWOOD_LEAF_TEXTURE_FILES[\s\S]*from '\.\.\/vegetation\/seedthree\/commonDogwoodPreset\.ts'[\s\S]*dogwood: \{[\s\S]*\.\.\.COMMON_DOGWOOD_LEAF_TEXTURE_FILES/,
  'live dogwood leaves must consume their complete preset-owned A/N/R/T set',
);
assert.match(
  undergrowthSource,
  /setDeciduousFoliage[\s\S]*dogwood/,
  'undergrowth instances must expose dogwood seasonal updates without rebuilding geometry',
);
assert.match(
  forestManagerSource,
  /setDeciduousFoliage\(presentation:[\s\S]*undergrowth\?\.setDeciduousFoliage\(presentation\)/,
  'ForestManager must forward the authoritative foliage presentation to dogwood',
);
assert.match(
  undergrowthSource,
  /dogwood[\s\S]*(?:autumn|Autumn)[\s\S]*(?:0\.7|0\.8|red|Red)/,
  'dogwood foliage must own an explicitly red autumn treatment',
);
assert.match(
  undergrowthSource,
  /dogwood[\s\S]*dormancy[\s\S]*(?:discard|alpha|opacity)/,
  'dormancy must remove dogwood leaf-card pixels through the foliage material',
);
assert.match(
  undergrowthSource,
  /DOGWOOD_MIN_SCALE = 0\.84[\s\S]*DOGWOOD_MAX_SCALE = 1\.25[\s\S]*DOGWOOD_MAX_HEIGHT_METERS = 3\.4/,
  'dogwood placement scale and final-height budgets must remain explicit',
);
assert.match(
  undergrowthSource,
  /heightScale = placement\.kind === 'dogwood'[\s\S]*Math\.min\(placement\.scale, DOGWOOD_MAX_HEIGHT_METERS \/ prototypeHeight\)[\s\S]*placement\.finalHeight = prototypeHeight \* heightScale/,
  'dogwood matrices must clamp the generated prototype to the 3.40 m final-height ceiling',
);
assert.match(
  undergrowthSource,
  /dogwoodChance = THREE\.MathUtils\.lerp\(0\.17, 0\.11, density\)[\s\S]*return 'dogwood'/,
  'dogwood must remain numerous across the deterministic forest-density envelope',
);
assert.match(
  undergrowthSource,
  /DOGWOOD_TREE_TRUNK_CLEARANCE[\s\S]*DOGWOOD_COMPANION_CLEARANCE[\s\S]*DOGWOOD_FOOTPRINT_CLEARANCE = 1\.7[\s\S]*isDogwoodFootprintBlocked/,
  'large dogwood instances must reserve their complete footprint around trees and blockers',
);
assert.match(
  undergrowthSource,
  /DOGWOOD_GROUND_OFFSET_METERS = 0\.006[\s\S]*placement\.kind === 'dogwood' \? DOGWOOD_GROUND_OFFSET_METERS : 0\.08/,
  'dogwood basal stems must meet the terrain without the generic undergrowth hover offset',
);
assert.match(
  undergrowthSource,
  /setDeciduousFoliage\(presentation\): boolean \{[\s\S]*setDogwoodSeason\(materials\.dogwood\[1\], presentation\)[\s\S]*setDogwoodShadowDormancy\(buckets\.dogwood, dormancy\)[\s\S]*materials\.dogwood\[1\]\.visible = leafy/,
  'full winter dormancy must remove leaf cards while updating the retained shadow proxy',
);
assert.match(
  undergrowthSource,
  /setDogwoodShadowDormancy[\s\S]*THREE\.MathUtils\.lerp\(1, 0\.16, dormancy\)[\s\S]*dogwoodShadowBasePositions[\s\S]*position\.setXYZ\(index, base\[offset\] \* width, base\[offset \+ 1\], base\[offset \+ 2\] \* width\)/,
  'backend-agnostic dogwood shadow geometry must narrow continuously to a 0.16-scale winter stem proxy',
);
assert.doesNotMatch(
  undergrowthSource.match(/setDeciduousFoliage\(presentation\): boolean \{[\s\S]*?\n    \},/)?.[0] ?? '',
  /shadowMesh\.visible/,
  'winter must retain the narrowed stem shadow instead of hiding the proxy wholesale',
);
assert.doesNotMatch(
  undergrowthSource.match(/setDeciduousFoliage\(presentation\): boolean \{[\s\S]*?\n    \},/)?.[0] ?? '',
  /materials\.dogwood\[0\]/,
  'the dogwood stem material must remain untouched at full winter dormancy',
);
assert.match(
  undergrowthSource,
  /stats: UndergrowthStats[\s\S]*maximumDrawCalls[\s\S]*dogwood:[\s\S]*leafyDrawCalls[\s\S]*bareDrawCalls[\s\S]*bareDrawCalls: dogwoodBuckets\.length \* 2/,
  'runtime diagnostics must publish dogwood instance, height, and leafy/bare draw budgets',
);
assert.doesNotMatch(
  undergrowthSource,
  /setDeciduousFoliage[\s\S]{0,500}(?:geometry\.dispose|new THREE\.(?:BufferGeometry|InstancedMesh))/, 
  'season changes must update materials rather than rebuild dogwood geometry',
);
assert.match(
  forestManagerSource,
  /applyUndergrowthClearance[\s\S]*undergrowthBucketForPlacement[\s\S]*bucket\.mesh\.setMatrixAt[\s\S]*bucket\.shadowMesh\.setMatrixAt/,
  'dogwood must inherit the generic undergrowth road/building clearance lifecycle',
);

console.log('test:dogwood-integration passed');

function dogwoodPrototypeSignatures(): Record<string, string> {
  const signatures: Record<string, string> = {};
  for (let variant = 0; variant < GORSKI_SHRUB_VARIANT_COUNT; variant++) {
    const variantPreset = createCommonDogwoodVariantPreset(variant);
    const prototype = createGorskiShrubPrototype('dogwood', variant);
    const { geometry } = prototype;
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox!;
    const size = bounds.getSize(new THREE.Vector3());
    const stemCount = Number(geometry.userData.dogwoodStemCount);
    assert.equal(geometry.userData.gorskiShrubKind, 'dogwood');
    assert.equal(geometry.userData.gorskiShrubVariant, variant);
    assert.equal(geometry.userData.seedThreeGenerator, 'basal-thicket/opposite-leaf-pairs');
    assert.equal(geometry.userData.dogwoodSeed, `${COMMON_DOGWOOD_SEED_PREFIX}:${variant}`);
    assert.equal(stemCount, variantPreset.morphology.stemCount);
    assert.ok(stemCount >= 10 && stemCount <= 30, `dogwood variant ${variant} stem count is out of range`);
    assert.equal(
      geometry.userData.dogwoodGroundOriginStemCount,
      stemCount,
      `all variant ${variant} stems must originate from the basal stool`,
    );
    assert.ok(
      Number(geometry.userData.dogwoodStemBaseMaxY) <= 0.03,
      `dogwood variant ${variant} has a stem base above the forest floor`,
    );
    assert.ok(bounds.min.y >= -0.04 && bounds.min.y <= 0.04);
    assert.equal(geometry.groups.length, 2);
    assert.deepEqual(
      geometry.groups.map((group) => group.materialIndex),
      [0, 1],
      'dogwood must retain separately addressable stem and foliage groups',
    );
    assert.ok(geometry.groups.every((group) => group.count > 0));
    assert.equal(prototype.fruitAnchors.length, 0, 'forest dogwood does not allocate fruit instances');
    assert.ok(
      prototype.triangleCount >= DOGWOOD_TRIANGLE_BUDGET[0]
        && prototype.triangleCount <= DOGWOOD_TRIANGLE_BUDGET[1],
      `dogwood variant ${variant} exceeds its ${DOGWOOD_TRIANGLE_BUDGET.join('-')} triangle budget`,
    );
    assert.ok(size.x >= 1.5 && size.x <= 2.2);
    assert.ok(size.z >= 1.5 && size.z <= 2.2);
    assert.ok(size.y >= 2.3 && size.y <= 2.8);
    const positions = geometry.getAttribute('position');
    let maximumRadialExtent = 0;
    for (let index = 0; index < positions.count; index++) {
      maximumRadialExtent = Math.max(
        maximumRadialExtent,
        Math.hypot(positions.getX(index), positions.getZ(index)),
      );
    }
    assert.ok(
      maximumRadialExtent * 1.25 * 1.06 <= 1.7,
      `dogwood variant ${variant} can exceed its 1.70 m clearance at maximum runtime width scale`,
    );
    const rootWeight = geometry.getAttribute('aRootWeight');
    assert.ok(rootWeight, `dogwood variant ${variant} needs rooted wind weights`);
    let minimumRootWeight = Number.POSITIVE_INFINITY;
    let maximumRootWeight = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < rootWeight.count; index++) {
      minimumRootWeight = Math.min(minimumRootWeight, rootWeight.getX(index));
      maximumRootWeight = Math.max(maximumRootWeight, rootWeight.getX(index));
    }
    assert.ok(minimumRootWeight <= 0.001);
    assert.ok(maximumRootWeight >= 0.99 && maximumRootWeight <= 1.001);
    assertPortableVertexBuffers(geometry, variant);
    signatures[String(variant)] = geometryHash(geometry);
    geometry.dispose();
  }
  return signatures;
}

function assertPortableVertexBuffers(geometry: THREE.BufferGeometry, variant: number): void {
  const runtimeGeometry = geometry.clone();
  runtimeGeometry.setAttribute(
    'aAnchorPos',
    new THREE.InstancedBufferAttribute(new Float32Array(3), 3),
  );
  runtimeGeometry.setAttribute(
    'aWindVec',
    new THREE.InstancedBufferAttribute(new Float32Array(3), 3),
  );
  const mesh = new THREE.InstancedMesh(runtimeGeometry, new THREE.MeshBasicMaterial(), 1);
  mesh.setColorAt(0, new THREE.Color(1, 1, 1));
  const buffers = new Set<THREE.BufferAttribute | THREE.InterleavedBuffer>([
    ...Object.values(runtimeGeometry.attributes).map((attribute) => (
      attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data : attribute
    )),
    mesh.instanceMatrix,
    mesh.instanceColor!,
  ]);
  assert.ok(
    buffers.size <= PORTABLE_WEBGPU_VERTEX_BUFFER_LIMIT,
    `dogwood variant ${variant} requires ${buffers.size} vertex buffers; portable WebGPU permits ${PORTABLE_WEBGPU_VERTEX_BUFFER_LIMIT}`,
  );
  (mesh.material as THREE.Material).dispose();
  runtimeGeometry.dispose();
}

function assertDedicatedAlbedo(fileName: string, surface: 'branch' | 'leaf'): void {
  const dogwoodHash = createHash('sha256')
    .update(readFileSync(join(dogwoodAssetRoot, fileName)))
    .digest('hex');
  const comparisonFiles = surface === 'branch'
    ? [
      'bilberry_branch_albedo.png',
      'common_juniper_branch_albedo.png',
      'raspberry_cane_albedo.png',
      'hornbeam_hedge_branch_albedo.png',
      'aronia_branch_albedo.png',
      'rosehip_cane_albedo.png',
    ].map((name) => join(projectRoot, 'vendor/seedthree/assets/bark', name))
    : [
      'bilberry_albedo.png',
      'fern_albedo.png',
      'juniper_scrub_albedo.png',
      'raspberry_spray_albedo.png',
      'hornbeam_hedge_spray_albedo.png',
      'aronia_spray_albedo.png',
      'rosehip_spray_albedo.png',
    ].map((name) => join(projectRoot, 'vendor/seedthree/assets/leaves', name));
  for (const comparisonFile of comparisonFiles) {
    const comparisonHash = createHash('sha256')
      .update(readFileSync(comparisonFile))
      .digest('hex');
    assert.notEqual(
      dogwoodHash,
      comparisonHash,
      `${fileName} must not reuse ${comparisonFile.split(/[\\/]/).at(-1)} bytes`,
    );
  }
}

function geometryHash(geometry: THREE.BufferGeometry): string {
  const hash = createHash('sha256');
  for (const name of ['position', 'normal', 'uv', 'aRootWeight']) {
    const attribute = geometry.getAttribute(name);
    assert.ok(attribute, `dogwood prototype geometry is missing ${name}`);
    hash.update(Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength));
  }
  if (geometry.index) {
    hash.update(Buffer.from(
      geometry.index.array.buffer,
      geometry.index.array.byteOffset,
      geometry.index.array.byteLength,
    ));
  }
  for (const group of geometry.groups) {
    hash.update(`${group.start}:${group.count}:${group.materialIndex};`);
  }
  return hash.digest('hex');
}
