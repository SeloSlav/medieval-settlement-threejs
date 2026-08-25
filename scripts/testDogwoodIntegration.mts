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
import {
  DOGWOOD_LEAF_FLUTTER_AMPLITUDE,
  DOGWOOD_ROOT_SWAY_AMPLITUDE,
  sampleDogwoodFoliageWind,
} from '../src/vegetation/seedthree/seedThreeFoliageWind.ts';

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
assert.equal(commonDogwood.foliage.flutterScale, 0.42);
assert.ok(
  commonDogwood.foliage.startFrac <= 0.04,
  'dogwood foliage must begin close to the first low fork instead of leaving a bare lower crown',
);
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
const forestPlacementSource = readFileSync(
  join(projectRoot, 'src/props/forestPlacements.ts'),
  'utf8',
);
const foliageWindSource = readFileSync(
  join(projectRoot, 'src/vegetation/seedthree/seedThreeFoliageWind.ts'),
  'utf8',
);
const dogwoodWindStart = foliageWindSource.indexOf(
  'export function createRootedDogwoodFoliageWindPosition',
);
const dogwoodWindEnd = foliageWindSource.indexOf(
  'export type DogwoodFoliageWindSample',
  dogwoodWindStart,
);
assert.ok(dogwoodWindStart >= 0 && dogwoodWindEnd > dogwoodWindStart);
const dogwoodWindFunctionSource = foliageWindSource.slice(dogwoodWindStart, dogwoodWindEnd);

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
assert.doesNotMatch(
  forestPlacementSource,
  /dogwood/i,
  'dogwood shrubs must never enter the authoritative tree layout or tree count',
);
assert.doesNotMatch(
  undergrowthSource,
  /TreePhase|harvest|cuttable/i,
  'dogwood undergrowth must not participate in tree growth or felling lifecycle',
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
  /DOGWOOD_MIN_SCALE = 0\.98[\s\S]*DOGWOOD_MAX_SCALE = 1\.42[\s\S]*DOGWOOD_MAX_HEIGHT_METERS = 3\.56[\s\S]*DOGWOOD_MIN_HEIGHT_CEILING_METERS = 3\.44/,
  'dogwood placement scale and final-height budgets must remain explicit',
);
assert.match(
  undergrowthSource,
  /dogwoodHeightCeiling = placement\.kind === 'dogwood'[\s\S]*DOGWOOD_MIN_HEIGHT_CEILING_METERS,[\s\S]*DOGWOOD_MAX_HEIGHT_METERS,[\s\S]*rng\(\)[\s\S]*Math\.min\(placement\.scale, dogwoodHeightCeiling \/ prototypeHeight\)[\s\S]*placement\.finalHeight = prototypeHeight \* heightScale/,
  'dogwood matrices must vary their upper ceiling while staying below 3.56 m',
);
assert.match(
  undergrowthSource,
  /widthScale = placement\.kind === 'dogwood'[\s\S]*THREE\.MathUtils\.lerp\(1, placement\.scale, 0\.72\)[\s\S]*THREE\.MathUtils\.lerp\(0\.96, 1\.08, rng\(\)\)/,
  'dogwood height growth must only modestly widen its crown',
);
assert.match(
  undergrowthSource,
  /DOGWOOD_FOREST_EDGE_SHARE = 0\.32[\s\S]*DOGWOOD_FOREST_CORE_SHARE = 0\.24[\s\S]*dogwoodChance = THREE\.MathUtils\.lerp\([\s\S]*DOGWOOD_FOREST_EDGE_SHARE,[\s\S]*DOGWOOD_FOREST_CORE_SHARE,[\s\S]*density,[\s\S]*return 'dogwood'/,
  'dogwood must remain numerous across the deterministic forest-density envelope',
);
assert.match(
  forestManagerSource,
  /this\.undergrowth\.group\.visible = visible/,
  'dogwood must retain the close-detail visibility contract shared by forest undergrowth',
);
assert.match(
  undergrowthSource,
  /DOGWOOD_TREE_TRUNK_CLEARANCE[\s\S]*DOGWOOD_COMPANION_CLEARANCE = 1\.85[\s\S]*DOGWOOD_FOOTPRINT_CLEARANCE = 1\.85[\s\S]*isDogwoodFootprintBlocked/,
  'large dogwood instances must retain basal trunk clearance plus complete blocker and companion clearance',
);
assert.match(
  undergrowthSource,
  /material\.positionNode = options\.leafFlutterAmplitude === undefined[\s\S]*createRootedDogwoodFoliageWindPosition\([\s\S]*DOGWOOD_ROOT_SWAY_AMPLITUDE,[\s\S]*options\.leafFlutterAmplitude/,
  'dogwood foliage must use the dedicated SeedThree-rooted leaf response',
);
assert.match(
  undergrowthSource,
  /supportsNodeMaterials\(rendererBackend \?\? 'webgl'\)/,
  'the live WebGL2-node fallback must retain dogwood node materials and their wind graph',
);
assert.match(
  dogwoodWindFunctionSource,
  /windWorld = tsl\.vec3\(WIND_DIR\.x, WIND_DIR\.y, WIND_DIR\.z\)/,
  'post-instance dogwood node wind must use the direct world-facing SeedThree direction',
);
assert.doesNotMatch(
  dogwoodWindFunctionSource,
  /const flutterTime(?:(?!const tip)[\s\S])*local\.(?:x|z)/,
  'all four vertices of one baked dogwood leaf must share one flutter phase',
);
assert.match(
  undergrowthSource,
  /aLeafPhase[\s\S]*undergrowthLeafFlutterTime[\s\S]*5\.2[\s\S]*uv\.y \* uv\.y[\s\S]*1\.31[\s\S]*0\.77/,
  'the WebGL fallback must retain per-leaf phase, SeedThree frequencies, and a pinned petiole edge',
);
assert.doesNotMatch(
  undergrowthSource,
  /float undergrowthLeafFlutterTime(?:(?!float undergrowthLeafTip)[\s\S])*position\.(?:x|z)/,
  'WebGL dogwood leaves must not shear their own quad with per-vertex phase',
);
assert.match(
  undergrowthSource,
  /undergrowthLeafScale[\s\S]*aLeafPhase[\s\S]*undergrowthLeafVertical[\s\S]*instanceMatrix\[1\]\.xyz/,
  'classic WebGL must preserve SeedThree phase amplitude and compensate vertical flutter for instance height',
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

assert.equal(DOGWOOD_ROOT_SWAY_AMPLITUDE, 0.35);
assert.equal(DOGWOOD_LEAF_FLUTTER_AMPLITUDE, 0.055);
const windSampleOptions = {
  timeSeconds: 2.5,
  windSpeedValue: 0.84,
  windStrengthValue: 0.55,
  anchorX: 13.4,
  anchorZ: -8.1,
  rootWeight: 0.18,
  leafPhase: 0.73,
};
const rootSample = sampleDogwoodFoliageWind({ ...windSampleOptions, uvY: 0 });
assert.equal(rootSample.longitudinalFlutter, 0, 'dogwood petiole vertices must not flutter');
assert.equal(rootSample.verticalFlutter, 0, 'dogwood petiole vertices must not lift away from stems');
assert.equal(rootSample.lateralFlutter, 0, 'dogwood petiole vertices must not twist away from stems');
const tipSample = sampleDogwoodFoliageWind({ ...windSampleOptions, uvY: 1 });
assert.ok(
  Math.hypot(
    tipSample.longitudinalFlutter,
    tipSample.verticalFlutter,
    tipSample.lateralFlutter,
  ) > 0.001,
  'dogwood leaf tips must visibly respond at the SeedThree wind checkpoints',
);
assert.deepEqual(
  sampleDogwoodFoliageWind({ ...windSampleOptions, uvY: 1 }),
  tipSample,
  'fixed time, phase, and wind must reproduce identical dogwood motion',
);
const laterTipSample = sampleDogwoodFoliageWind({
  ...windSampleOptions,
  timeSeconds: 5,
  uvY: 1,
});
assert.notDeepEqual(laterTipSample, tipSample, 'dogwood leaf tips must change across wind time');
const stillTipSample = sampleDogwoodFoliageWind({
  ...windSampleOptions,
  timeSeconds: 12,
  windStrengthValue: 0,
  uvY: 1,
});
assert.deepEqual(
  stillTipSample,
  {
    baseSway: 0,
    longitudinalFlutter: 0,
    verticalFlutter: 0,
    lateralFlutter: 0,
  },
  'zero wind must reproduce the exact dogwood rest pose',
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
    const firstForkHeight = variantPreset.morphology.params.firstForkHeight;
    assert.equal(geometry.userData.gorskiShrubKind, 'dogwood');
    assert.equal(geometry.userData.gorskiShrubVariant, variant);
    assert.equal(geometry.userData.seedThreeGenerator, 'basal-thicket/opposite-leaf-pairs');
    assert.equal(geometry.userData.dogwoodSeed, `${COMMON_DOGWOOD_SEED_PREFIX}:${variant}`);
    assert.equal(stemCount, variantPreset.morphology.stemCount);
    assert.equal(geometry.userData.dogwoodFirstForkHeight, firstForkHeight);
    assert.equal(geometry.userData.dogwoodFoliageStartFraction, commonDogwood.foliage.startFrac);
    assert.ok(
      firstForkHeight >= 0.3 && firstForkHeight <= 0.42,
      `dogwood variant ${variant} must branch within the basal 0.42 m thicket zone`,
    );
    assert.ok(
      variantPreset.morphology.params.armLength >= 1.1,
      `dogwood variant ${variant} must recover mature height above its low first fork`,
    );
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
    const foliageRootHeights = dogwoodFoliageRootHeights(geometry, variant);
    const foliageRootP10 = foliageRootHeights[
      Math.floor((foliageRootHeights.length - 1) * 0.1)
    ]!;
    const lowerThirdCeiling = bounds.min.y + size.y / 3;
    const lowerThirdRootShare = foliageRootHeights.filter(
      (height) => height <= lowerThirdCeiling,
    ).length / foliageRootHeights.length;
    assert.ok(
      foliageRootHeights[0]! <= 0.5,
      `dogwood variant ${variant} foliage begins too high above its basal stool`,
    );
    assert.ok(
      foliageRootP10 <= 0.65,
      `dogwood variant ${variant} still leaves its lower stems visually bare`,
    );
    assert.ok(
      (foliageRootHeights[0]! - bounds.min.y) / size.y <= 0.17,
      `dogwood variant ${variant} foliage must begin inside the lowest 17% of its height`,
    );
    assert.ok(
      (foliageRootP10 - bounds.min.y) / size.y <= 0.23,
      `dogwood variant ${variant} needs meaningful foliage inside the lowest 23% of its height`,
    );
    assert.ok(
      lowerThirdRootShare >= 0.2,
      `dogwood variant ${variant} needs substantial foliage roots in its lower third`,
    );
    const positions = geometry.getAttribute('position');
    let maximumRadialExtent = 0;
    for (let index = 0; index < positions.count; index++) {
      maximumRadialExtent = Math.max(
        maximumRadialExtent,
        Math.hypot(positions.getX(index), positions.getZ(index)),
      );
    }
    const maximumWidthScale = THREE.MathUtils.lerp(1, 1.42, 0.72) * 1.08;
    assert.ok(
      maximumRadialExtent * maximumWidthScale <= 1.85,
      `dogwood variant ${variant} can exceed its 1.85 m clearance at maximum runtime width scale`,
    );
    const rootWeight = geometry.getAttribute('aRootWeight');
    assert.ok(rootWeight, `dogwood variant ${variant} needs rooted wind weights`);
    const leafPhase = geometry.getAttribute('aLeafPhase');
    assert.ok(leafPhase, `dogwood variant ${variant} needs per-leaf SeedThree phases`);
    assert.ok(
      rootWeight instanceof THREE.InterleavedBufferAttribute
        && leafPhase instanceof THREE.InterleavedBufferAttribute
        && rootWeight.data === leafPhase.data,
      `dogwood variant ${variant} must interleave weight and phase inside one portable buffer`,
    );
    let minimumRootWeight = Number.POSITIVE_INFINITY;
    let maximumRootWeight = Number.NEGATIVE_INFINITY;
    let maximumLeafPhase = Number.NEGATIVE_INFINITY;
    const nonzeroLeafPhases = new Set<string>();
    for (let index = 0; index < rootWeight.count; index++) {
      minimumRootWeight = Math.min(minimumRootWeight, rootWeight.getX(index));
      maximumRootWeight = Math.max(maximumRootWeight, rootWeight.getX(index));
      maximumLeafPhase = Math.max(maximumLeafPhase, leafPhase.getX(index));
      if (leafPhase.getX(index) > 0) nonzeroLeafPhases.add(leafPhase.getX(index).toFixed(5));
    }
    assert.ok(minimumRootWeight <= 0.001);
    assert.ok(
      maximumRootWeight >= 0.17 && maximumRootWeight <= 0.181,
      `dogwood variant ${variant} must preserve its preset 0.18 SeedThree wind ceiling`,
    );
    assert.ok(maximumLeafPhase >= 0.4 && maximumLeafPhase <= 1.001);
    assert.ok(
      nonzeroLeafPhases.size > 20,
      `dogwood variant ${variant} needs visibly detuned leaf phases`,
    );
    assertBakedDogwoodLeafCards(geometry, variant);
    assertPortableVertexBuffers(geometry, variant);
    signatures[String(variant)] = geometryHash(geometry);
    geometry.dispose();
  }
  return signatures;
}

function dogwoodFoliageRootHeights(
  geometry: THREE.BufferGeometry,
  variant: number,
): number[] {
  const index = geometry.index;
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const foliageGroup = geometry.groups.find((group) => group.materialIndex === 1);
  assert.ok(index && position && uv && foliageGroup, `dogwood variant ${variant} needs indexed foliage`);
  const rootVertices = new Set<number>();
  for (
    let offset = foliageGroup.start;
    offset < foliageGroup.start + foliageGroup.count;
    offset++
  ) {
    const vertex = index.getX(offset);
    if (uv.getY(vertex) <= 0.001) rootVertices.add(vertex);
  }
  const heights = [...rootVertices]
    .map((vertex) => position.getY(vertex))
    .sort((left, right) => left - right);
  assert.ok(heights.length > 0, `dogwood variant ${variant} needs measurable leaf roots`);
  return heights;
}

function assertBakedDogwoodLeafCards(
  geometry: THREE.BufferGeometry,
  variant: number,
): void {
  const index = geometry.index;
  assert.ok(index, `dogwood variant ${variant} must retain indexed leaf cards`);
  const branchGroup = geometry.groups.find((group) => group.materialIndex === 0);
  const foliageGroup = geometry.groups.find((group) => group.materialIndex === 1);
  assert.ok(branchGroup && foliageGroup, `dogwood variant ${variant} needs branch and foliage groups`);
  assert.equal(
    foliageGroup.count % 6,
    0,
    `dogwood variant ${variant} foliage must remain a sequence of indexed quads`,
  );
  const uv = geometry.getAttribute('uv');
  const rootWeight = geometry.getAttribute('aRootWeight');
  const leafPhase = geometry.getAttribute('aLeafPhase');

  const branchVertices = new Set<number>();
  for (let offset = branchGroup.start; offset < branchGroup.start + branchGroup.count; offset++) {
    branchVertices.add(index.getX(offset));
  }
  for (const vertex of branchVertices) {
    assert.equal(
      leafPhase.getX(vertex),
      0,
      `dogwood variant ${variant} woody vertices must not receive leaf flutter phase`,
    );
  }

  const checkpoints = [0, 1.25, 2.5, 5, 8, 12] as const;
  const activeTimelines = new Set<string>();
  let activeCardCount = 0;
  const cardCount = foliageGroup.count / 6;
  for (let card = 0; card < cardCount; card++) {
    const firstIndex = foliageGroup.start + card * 6;
    const vertices = [...new Set(
      Array.from({ length: 6 }, (_, triangleIndex) => index.getX(firstIndex + triangleIndex)),
    )];
    assert.equal(vertices.length, 4, `dogwood variant ${variant} leaf ${card} must be one quad`);
    const weights = vertices.map((vertex) => rootWeight.getX(vertex));
    const phases = vertices.map((vertex) => leafPhase.getX(vertex));
    assert.ok(
      Math.max(...weights) - Math.min(...weights) < 1e-6,
      `dogwood variant ${variant} leaf ${card} must share one twig wind weight`,
    );
    assert.ok(
      Math.max(...phases) - Math.min(...phases) < 1e-6,
      `dogwood variant ${variant} leaf ${card} must share one SeedThree phase`,
    );
    assert.equal(
      vertices.filter((vertex) => Math.abs(uv.getY(vertex)) < 1e-6).length,
      2,
      `dogwood variant ${variant} leaf ${card} needs two welded petiole vertices`,
    );
    assert.equal(
      vertices.filter((vertex) => Math.abs(uv.getY(vertex) - 1) < 1e-6).length,
      2,
      `dogwood variant ${variant} leaf ${card} needs two responsive tip vertices`,
    );

    const weight = weights[0]!;
    const phase = phases[0]!;
    const timeline: number[] = [];
    for (const timeSeconds of checkpoints) {
      const options = {
        timeSeconds,
        windSpeedValue: 0.84,
        windStrengthValue: 0.55,
        anchorX: variant * 3.1,
        anchorZ: card * 0.017,
        rootWeight: weight,
        leafPhase: phase,
      };
      const root = sampleDogwoodFoliageWind({ ...options, uvY: 0 });
      assert.equal(root.longitudinalFlutter, 0);
      assert.equal(root.verticalFlutter, 0);
      assert.equal(root.lateralFlutter, 0);
      const tip = sampleDogwoodFoliageWind({ ...options, uvY: 1 });
      timeline.push(Math.hypot(
        tip.longitudinalFlutter,
        tip.verticalFlutter,
        tip.lateralFlutter,
      ));
    }
    if (weight > 0.001) {
      activeCardCount += 1;
      assert.ok(
        Math.max(...timeline) > 0.0005,
        `dogwood variant ${variant} leaf ${card} must respond at a fixed wind checkpoint`,
      );
      activeTimelines.add(timeline.map((value) => value.toFixed(6)).join(','));
    }
  }
  assert.ok(activeCardCount > 20, `dogwood variant ${variant} needs many wind-active leaves`);
  assert.ok(
    activeTimelines.size > 20,
    `dogwood variant ${variant} needs diverse deterministic leaf motion signatures`,
  );
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
  for (const name of ['position', 'normal', 'uv', 'aRootWeight', 'aLeafPhase']) {
    const attribute = geometry.getAttribute(name);
    assert.ok(attribute, `dogwood prototype geometry is missing ${name}`);
    for (let index = 0; index < attribute.count; index++) {
      hash.update(`${attribute.getX(index).toFixed(7)},`);
      if (attribute.itemSize > 1) hash.update(`${attribute.getY(index).toFixed(7)},`);
      if (attribute.itemSize > 2) hash.update(`${attribute.getZ(index).toFixed(7)},`);
    }
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
