import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import {
  BRANCH_CARD_BAKE_REVISION,
  BRANCH_CARD_COVERAGE_CONTENT_REVISION,
  branchCardCoverageRngSeed,
  forestCardMaterial,
  planBranchCardCoverage,
  planBranchCardCrownUnderlay,
  setForestCardDormancy,
  setForestCardSeason,
} from '../vendor/seedthree/src/core/branch-cards.js';
import { GORSKI_KOTAR_SPECIES } from '../src/vegetation/seedthree/gorskiKotarPresets.ts';
import {
  SEEDTHREE_CROWN_UNDERLAY_MODE,
  SEEDTHREE_CROWN_UNDERLAY_HIDE_DISTANCE,
  SEEDTHREE_CROWN_UNDERLAY_SHOW_DISTANCE,
  SEEDTHREE_FOREST_WIND_SPEED,
  shouldShowSeedThreeCrownUnderlay,
} from '../src/vegetation/seedthree/seedThreeCanopyPresentation.ts';
import {
  SEEDTHREE_FOREST_CARD_SPECULAR_INTENSITY,
  SEEDTHREE_OVERVIEW_CARD_MOTION,
  applySeedThreeForestCardMotion,
  resolveSeedThreeForestCardMotion,
  stabilizeSeedThreeForestCardMaterial,
} from '../src/vegetation/seedthree/seedThreeForestMaterial.ts';
import { seedThreeBranchCardCacheKey } from '../src/vegetation/seedthree/seedThreeBranchCards.ts';
import {
  SEEDTHREE_BRANCH_CARD_BAKE_REVISION,
  SEEDTHREE_BRANCH_CARD_CACHE_VERSION,
  seedThreePersistentBranchCardCacheKey,
} from '../src/vegetation/seedthree/seedThreeBranchCardPolicy.ts';
import {
  autumnFoliageColorForPreset,
  GORSKI_KOTAR_PRESETS,
  gorskiKotarSpeciesIsDeciduous,
  seedThreePresetIsDeciduous,
} from '../src/vegetation/seedthree/gorskiKotarSpecies.ts';
import { writeSeedThreeLodMatrices } from '../src/vegetation/seedthree/seedThreeForestCompaction.ts';
import { deciduousFoliageForClock } from '../src/world/deciduousFoliagePolicy.ts';

const deciduous = GORSKI_KOTAR_PRESETS.filter(seedThreePresetIsDeciduous);
const deciduousUnderlayScale = {
  americanBeech: 1.35,
  whiteOak: 1.35,
  redMaple: 1.3,
  sweetgum: 1.28,
} as const;
assert.deepEqual(
  deciduous,
  ['americanBeech', 'whiteOak', 'redMaple', 'sweetgum'],
  'only broadleaf forest presets should enter winter dormancy',
);
assert.equal(seedThreePresetIsDeciduous('douglasFir'), false, 'fir must remain evergreen');
assert.equal(seedThreePresetIsDeciduous('loblolly'), false, 'spruce proxy must remain evergreen');
assert.equal(seedThreePresetIsDeciduous('pine'), false, 'pine must remain evergreen');
assert.equal(gorskiKotarSpeciesIsDeciduous('larch'), true, 'European larch must change and shed');
assert.equal(gorskiKotarSpeciesIsDeciduous('silverFir'), false, 'silver fir sharing the proxy must stay evergreen');
assert.equal(gorskiKotarSpeciesIsDeciduous('norwaySpruce'), false, 'spruce must stay evergreen');
assert.deepEqual(autumnFoliageColorForPreset('redMaple'), [0.95, 0.18, 0.04]);
assert.equal(BRANCH_CARD_BAKE_REVISION, 5);
assert.equal(
  BRANCH_CARD_COVERAGE_CONTENT_REVISION,
  4,
  'rev5 placement/cache changes must not reshuffle the accepted rev4 fill cohort',
);
assert.equal(
  branchCardCoverageRngSeed('White Oak', 2),
  'White Oak:cards:2:coverage-v4',
  'coverage RNG identity must remain pinned to content revision 4',
);
assert.equal(SEEDTHREE_CROWN_UNDERLAY_HIDE_DISTANCE, 112);
assert.equal(SEEDTHREE_CROWN_UNDERLAY_SHOW_DISTANCE, 128);
assert.equal(SEEDTHREE_CROWN_UNDERLAY_MODE, 'always');
assert.equal(SEEDTHREE_FOREST_WIND_SPEED, 0.84);
assert.equal(SEEDTHREE_OVERVIEW_CARD_MOTION, 'static');
assert.equal(resolveSeedThreeForestCardMotion(true, false), 'static');
assert.equal(resolveSeedThreeForestCardMotion(true, true), 'static');
assert.equal(resolveSeedThreeForestCardMotion(false, true), 'sway');
assert.equal(resolveSeedThreeForestCardMotion(false, false), 'full');
const rigidSwayNode = { kind: 'rigid-sway' };
const sourceCrownMaterial = new THREE.MeshBasicMaterial() as THREE.MeshBasicMaterial & {
  positionNode: unknown;
};
sourceCrownMaterial.positionNode = rigidSwayNode;
const forestCrownMaterial = new THREE.MeshBasicMaterial() as THREE.MeshBasicMaterial & {
  positionNode: unknown;
};
forestCrownMaterial.positionNode = { kind: 'incorrect-flutter' };
applySeedThreeForestCardMotion(forestCrownMaterial, 'sway', sourceCrownMaterial);
assert.equal(forestCrownMaterial.positionNode, rigidSwayNode);
applySeedThreeForestCardMotion(forestCrownMaterial, 'static', sourceCrownMaterial);
assert.equal(forestCrownMaterial.positionNode, null);
sourceCrownMaterial.dispose();
forestCrownMaterial.dispose();
assert.equal(
  shouldShowSeedThreeCrownUnderlay(false, 0, true),
  true,
  'the default global mode must keep the extra canopy visible at every zoom level',
);
assert.equal(
  shouldShowSeedThreeCrownUnderlay(true, 999, false, 'off'),
  false,
  'off mode must suppress the extra canopy at every zoom level',
);
assert.equal(
  shouldShowSeedThreeCrownUnderlay(true, 111.99, false, 'distance'),
  false,
  'zooming in must remove strategic crown fill below the inner threshold',
);
assert.equal(
  shouldShowSeedThreeCrownUnderlay(true, 112, false, 'distance'),
  true,
  'visible crown fill must remain stable at the inner hysteresis boundary',
);
assert.equal(
  shouldShowSeedThreeCrownUnderlay(false, 127.99, false, 'distance'),
  false,
  'zooming out must not reveal crown fill before the outer threshold',
);
assert.equal(
  shouldShowSeedThreeCrownUnderlay(false, 128, false, 'distance'),
  true,
  'strategic crown fill must return at the outer threshold',
);
assert.equal(
  shouldShowSeedThreeCrownUnderlay(true, 999, true, 'distance'),
  false,
  'distance mode must hide the crown underlay in first person',
);

const physicalFoliage = new THREE.MeshPhysicalMaterial({ specularIntensity: 1 });
stabilizeSeedThreeForestCardMaterial(physicalFoliage);
assert.equal(physicalFoliage.alphaToCoverage, true);
assert.equal(physicalFoliage.specularIntensity, SEEDTHREE_FOREST_CARD_SPECULAR_INTENSITY);
physicalFoliage.dispose();

for (const preset of deciduous) {
  const species = GORSKI_KOTAR_SPECIES[preset];
  assert.equal(
    species.foliage?.cardCoverage,
    1.5,
    `${preset} must opt into SeedThree's dense bake-only broadleaf coverage`,
  );
  assert.equal(
    species.foliage?.cardRadialPlanes,
    2,
    `${preset} must keep branch foliage readable from overhead and every azimuth`,
  );
  assert.equal(
    species.foliage?.mobileNearTwigCollapse,
    true,
    `${preset} must replace pale terminal twigs with their full-content foliage cards`,
  );
  assert.equal(
    species.foliage?.cardCrownUnderlay,
    true,
    `${preset} must add a foliage-only crown layer behind detailed branch cards`,
  );
  assert.equal(
    species.foliage?.cardCrownUnderlayLateralScale,
    deciduousUnderlayScale[preset],
    `${preset} must widen its crown underlay without increasing tree density`,
  );
  const authoredRootCards = 1 + Number(species.params?.baseSplits ?? 0);
  const crownUnderlay = planBranchCardCrownUnderlay(species.foliage, authoredRootCards);
  assert.equal(crownUnderlay.enabled, true);
  assert.equal(crownUnderlay.rootCardInstances, authoredRootCards);
  assert.equal(crownUnderlay.runtimeTrianglesAdded, authoredRootCards * 4);
  assert.equal(crownUnderlay.runtimeDrawsAdded, 1);
  const coverage = planBranchCardCoverage(species.foliage, 12);
  assert.equal(coverage.coverageRequested, 1.5);
  assert.ok(coverage.bakeLeafInstances > coverage.sourceLeafInstances);
  assert.equal(
    coverage.runtimeCardInstancesAdded,
    0,
    `${preset} coverage must not add runtime card instances`,
  );
  const cacheKey = seedThreeBranchCardCacheKey(species, true);
  assert.ok(
    cacheKey.includes(`|r2|u1x${deciduousUnderlayScale[preset]}|`)
      && cacheKey.endsWith(`|512|3|m|b${BRANCH_CARD_BAKE_REVISION}`),
    `${preset} cache identity must retain radial coverage, crown underlay, and bake revision`,
  );
}
for (const preset of ['douglasFir', 'loblolly', 'pine'] as const) {
  const species = GORSKI_KOTAR_SPECIES[preset];
  assert.equal(
    species.foliage?.cardCoverage,
    undefined,
    `${preset} must preserve its existing conifer coverage`,
  );
  assert.equal(
    species.foliage?.cardRadialPlanes,
    undefined,
    `${preset} must not inherit the broadleaf radial-card treatment`,
  );
  assert.equal(
    species.foliage?.mobileNearTwigCollapse,
    undefined,
    `${preset} must retain its authored conifer twig skeleton`,
  );
  assert.equal(
    species.foliage?.cardCrownUnderlay,
    true,
    `${preset} must add an evergreen crown layer behind exposed branches`,
  );
  assert.equal(species.foliage?.cardCrownUnderlayLateralScale, 1.35);
  const crownUnderlay = planBranchCardCrownUnderlay(species.foliage, 1);
  assert.equal(crownUnderlay.enabled, true);
  assert.equal(crownUnderlay.rootCardInstances, 1);
  assert.equal(crownUnderlay.runtimeTrianglesAdded, 4);
  assert.equal(crownUnderlay.runtimeDrawsAdded, 1);
  assert.ok(
    seedThreeBranchCardCacheKey(species, true).includes('|r1|u1x1.35|'),
    `${preset} cache identity must retain its crossed evergreen crown underlay`,
  );
}
assert.equal(SEEDTHREE_BRANCH_CARD_BAKE_REVISION, BRANCH_CARD_BAKE_REVISION);
assert.equal(
  SEEDTHREE_BRANCH_CARD_CACHE_VERSION,
  `seedthree-cards-v2-b${BRANCH_CARD_BAKE_REVISION}`,
  'persistent branch-card cache identity must inherit the upstream bake revision',
);
assert.equal(
  seedThreePersistentBranchCardCacheKey(
    seedThreeBranchCardCacheKey(GORSKI_KOTAR_SPECIES.americanBeech, true),
  ),
  `${SEEDTHREE_BRANCH_CARD_CACHE_VERSION}:${seedThreeBranchCardCacheKey(
    GORSKI_KOTAR_SPECIES.americanBeech,
    true,
  )}`,
  'persisted atlas keys must retain coverage plus the upstream bake revision',
);

const uniform = { value: 0 };
const material = { userData: { forestSeasonalDormancy: uniform } };
assert.equal(setForestCardDormancy(material, 1), true);
assert.equal(uniform.value, 1);
assert.equal(setForestCardDormancy(material, 2), false, 'clamped unchanged values should not rewrite');
assert.equal(setForestCardDormancy(material, -1), true);
assert.equal(uniform.value, 0);
assert.equal(setForestCardDormancy({ userData: {} }, 1), false, 'evergreen cards should ignore dormancy');

const seasonalUniforms = {
  springFlush: { value: 0 },
  autumnColor: { value: 0 },
  dormancy: { value: 0 },
};
const seasonalMaterialStub = {
  userData: {
    forestSeasonalSpringFlush: seasonalUniforms.springFlush,
    forestSeasonalAutumnColor: seasonalUniforms.autumnColor,
    forestSeasonalDormancy: seasonalUniforms.dormancy,
  },
};
assert.equal(setForestCardSeason(seasonalMaterialStub, {
  springFlush: 0.6,
  autumnColor: 0.8,
  dormancy: 0.2,
}), true);
assert.deepEqual(
  {
    springFlush: seasonalUniforms.springFlush.value,
    autumnColor: seasonalUniforms.autumnColor.value,
    dormancy: seasonalUniforms.dormancy.value,
  },
  { springFlush: 0.6, autumnColor: 0.8, dormancy: 0.2 },
);
assert.equal(setForestCardSeason(seasonalMaterialStub, {
  springFlush: 0.6,
  autumnColor: 0.8,
  dormancy: 0.2,
}), false, 'unchanged seasonal foliage values must not rewrite uniforms');

function foliageClock(month: number, monthDay: number) {
  return { month, monthDay, hour: 12, preciseHour: 12 } as any;
}

const openingMarchFoliage = deciduousFoliageForClock(foliageClock(3, 1));
assert.deepEqual(
  openingMarchFoliage,
  { springFlush: 1, autumnColor: 0, dormancy: 0 },
  'the opening March view must present a full fresh canopy',
);
const lateMarchFoliage = deciduousFoliageForClock(foliageClock(3, 8));
assert.deepEqual(
  lateMarchFoliage,
  { springFlush: 1, autumnColor: 0, dormancy: 0 },
  'March must not reintroduce sparse deciduous foliage after the opening',
);
const aprilMaturation = deciduousFoliageForClock(foliageClock(4, 16));
assert.ok(aprilMaturation.springFlush > 0.4 && aprilMaturation.springFlush < 0.6);
assert.equal(aprilMaturation.dormancy, 0);
assert.deepEqual(
  deciduousFoliageForClock(foliageClock(7, 16)),
  { springFlush: 0, autumnColor: 0, dormancy: 0 },
);
const octoberColor = deciduousFoliageForClock(foliageClock(10, 16));
assert.ok(octoberColor.autumnColor > 0.6 && octoberColor.autumnColor < 0.8);
const novemberDrop = deciduousFoliageForClock(foliageClock(11, 16));
assert.equal(novemberDrop.autumnColor, 1);
assert.ok(novemberDrop.dormancy > 0.4 && novemberDrop.dormancy < 0.7);
assert.equal(deciduousFoliageForClock(foliageClock(12, 1)).dormancy, 1);

const sourceTexture = new THREE.DataTexture(
  new Uint8Array([32, 180, 48, 255]),
  1,
  1,
  THREE.RGBAFormat,
  THREE.UnsignedByteType,
);
sourceTexture.needsUpdate = true;
const sourceMaterial = new THREE.MeshStandardMaterial({ map: sourceTexture, alphaTest: 0.35 });
const standardForestMaterial = forestCardMaterial(sourceMaterial);
const seasonalForestMaterial = forestCardMaterial(sourceMaterial, {
  seasonalDeciduous: true,
  canopyTint: [0.75, 0.84, 0.68],
  autumnColor: [0.95, 0.18, 0.04],
  toneVariation: 0.08,
});
assert.notEqual(
  standardForestMaterial,
  seasonalForestMaterial,
  'seasonal and standard forest twins must not alias when they share a source card material',
);
assert.equal(setForestCardDormancy(standardForestMaterial, 1), false);
assert.equal(setForestCardDormancy(seasonalForestMaterial, 1), true);
standardForestMaterial.dispose();
seasonalForestMaterial.dispose();
sourceMaterial.dispose();
sourceTexture.dispose();

const root = process.cwd();
const forkSource = readFileSync(
  join(root, 'vendor/seedthree/src/core/branch-cards.js'),
  'utf8',
);
const treeSource = readFileSync(
  join(root, 'vendor/seedthree/src/core/tree.js'),
  'utf8',
);
const cardAdapterSource = readFileSync(
  join(root, 'src/vegetation/seedthree/seedThreeBranchCards.ts'),
  'utf8',
);
const cardCacheSource = readFileSync(
  join(root, 'src/vegetation/seedthree/seedThreeBranchCardCache.ts'),
  'utf8',
);
const builderSource = readFileSync(
  join(root, 'src/vegetation/seedthree/seedThreeForestBuilder.ts'),
  'utf8',
);
const compactionSource = readFileSync(
  join(root, 'src/vegetation/seedthree/seedThreeForestCompaction.ts'),
  'utf8',
);
const matrixChunkSource = readFileSync(
  join(root, 'vendor/seedthree/src/core/instance-matrix-chunks.js'),
  'utf8',
);
const forestPropsSource = readFileSync(join(root, 'src/props/ForestProps.ts'), 'utf8');
const forestManagerSource = readFileSync(join(root, 'src/props/ForestManager.ts'), 'utf8');
const sceneSource = readFileSync(join(root, 'src/scene/SceneManager.ts'), 'utf8');

assert.match(
  forkSource,
  /greenDominance[\s\S]*transmissionLeafMask[\s\S]*greenLeafMask\.max\(transmissionLeafMask\)[\s\S]*opacityNode = texel\.a\.mul\(seasonalRetain\)/,
  'the fork must use green and leaf-transmission masks so every deciduous bake drops leaves while retaining twigs',
);
assert.match(
  builderSource,
  /seasonalDeciduous: gorskiKotarSpeciesIsDeciduous\(placement\.species\)/,
  'each gameplay tree must carry its own deciduous classification',
);
assert.match(
  builderSource,
  /const seasonalDeciduous = slots\.some\(\(slot\) => slot\.seasonalDeciduous\)/,
  'mixed larch and fir proxy buckets must enable the seasonal shader when needed',
);
assert.match(
  compactionSource,
  /resolveTreeOriginY:[\s\S]*slot\.seasonalDeciduous[\s\S]*DECIDUOUS_TREE_ORIGIN_Y_OFFSET/,
  'the game adapter must pass packed deciduous identity to reusable SeedThree compaction',
);
assert.match(
  matrixChunkSource,
  /task\.treeOriginY = job\.resolveTreeOriginY\(slot\)/,
  'the reusable SeedThree primitive must retain the consumer-resolved origin in its allocation-free task state',
);
assert.match(
  matrixChunkSource,
  /writeVec3\(\s*treeOrigins,[\s\S]*treeOriginY,[\s\S]*treeZ/,
  'the reusable SeedThree primitive must write the consumer-resolved origin into the real card buffer',
);
assert.doesNotMatch(
  builderSource,
  /setAttribute\('aDeciduous'/,
  'seasonal foliage must not exceed the portable eight-vertex-buffer limit',
);
assert.match(
  forkSource,
  /deciduousInstance = step\(float\(1024\), packedTreeOrigin\.y\)[\s\S]*packedTreeOrigin\.y\.sub\(deciduousInstance\.mul\(SEASONAL_TREE_ORIGIN_Y_OFFSET\)\)/,
  'the foliage shader must decode the packed flag while restoring the true tree origin',
);
assert.match(
  sceneSource,
  /setDeciduousFoliage\(environment\.deciduousFoliage\)/,
  'the authoritative calendar presentation must drive foliage color and retention',
);
assert.match(
  sceneSource,
  /const \[forestManager\] = await Promise\.all\(\[forestPromise, worldDetailsPromise\]\);[\s\S]*?this\.forestManager = forestManager;[\s\S]*?if \(this\.environment\)[\s\S]*?this\.forestManager\.setDeciduousFoliage\(this\.environment\.deciduousFoliage\)/,
  'a deferred forest must inherit an environment that arrived before vegetation creation',
);
assert.match(
  forkSource,
  /cacheKey = `\$\{opts\.seasonalDeciduous \? 'seasonal' : 'standard'\}:\$\{tintKey\}:\$\{autumnKey\}:\$\{opts\.toneVariation \?\? 0\}`[\s\S]*?variants\.get\(cacheKey\)/,
  'the Seloslav fork must isolate seasonal and standard material cache variants',
);
assert.match(
  forkSource,
  /const radialPlanes = geometryRadialPlanes\(variant\.geometry\);[\s\S]*const copies = opts\.crossed && radialPlanes < 2 \? 2 : 1;[\s\S]*new InstancedMesh\(variant\.geometry, variant\.material, list\.length \* copies\)/,
  'two-plane cards must remain one instanced mesh entry instead of multiplying runtime instances or draws',
);
assert.match(
  cardAdapterSource,
  /planBranchCardCrownUnderlay\(species\.foliage, 1\)[\s\S]*key: '0:underlay'[\s\S]*preserveFoliageLayout: true/,
  'the game adapter must bake a foliage-only whole-crown underlay when a species opts in',
);
assert.match(
  cardAdapterSource,
  /`r\$\{foliage\.cardRadialPlanes \?\? 1\}`[\s\S]*`u\$\{crownUnderlay\.enabled \? 1 : 0\}x\$\{crownUnderlay\.lateralScale\}`/,
  'the game adapter cache must distinguish sparse cards from radial and crown-underlay variants',
);
assert.match(
  cardCacheSource,
  /record\.sets\.map\(async \(cachedSet\)[\s\S]*return \[cachedSet\.key,[\s\S]*new Map<string, BranchCardsSet>\(restoredSets\)[\s\S]*for \(const \[key, set\] of cards\.byLevel\)[\s\S]*sets\.push\(\{\s*key,/,
  'persistent card storage must round-trip ordinary branch-card set names unchanged',
);
assert.match(
  cardCacheSource,
  /geometry\.userData\.crownUnderlay = cachedSet\.key === '0:underlay'/,
  'restored crown geometry must retain its strategic-only presentation identity',
);
assert.match(
  cardAdapterSource,
  /jobKey === '0:underlay'[\s\S]*variant\.geometry\.userData\.crownUnderlay = true/,
  'freshly baked crown geometry must carry the same strategic-only identity',
);
assert.match(
  builderSource,
  /shouldShowSeedThreeCrownUnderlay\([\s\S]*forest\.crownUnderlayVisible[\s\S]*for \(const mesh of forest\.crownUnderlayMeshes\) mesh\.visible = visible/,
  'camera updates must gate only tagged crown-underlay draws without rewriting forest matrices',
);
assert.match(
  compactionSource,
  /if \(source\.userData\.crownUnderlay === true\) continue;[\s\S]*source\.material[\s\S]*configureSeedThreeForestPassMesh\(mesh, 'shadow', true\)/,
  'whole-crown filler quads must stay out of the shadow pass while ordinary foliage cards retain authored shadows',
);
assert.match(
  compactionSource,
  /aThickness[\s\S]*mutable\.has\(name\)[\s\S]*attribute\.clone\(\)[\s\S]*alignColorCardInstanceAttributes/,
  'shadow cards must clone flutter/alpha attributes and realign color by shadow-union identity',
);
assert.match(
  builderSource,
  /seasonalCardMaterials\?\.add\(fmat as THREE\.Material\)[\s\S]*createSeedThreeExactShadowLodSet\(\s*nearSet/,
  'seasonal color and shadow cards must share one registered material/uniform graph',
);
assert.match(
  builderSource,
  /windSpeed\.value = SEEDTHREE_FOREST_WIND_SPEED/,
  'the forest must apply the slower shared wind tempo before materials compile',
);
assert.match(
  cardAdapterSource,
  /yield: options\.yieldBetweenCaptures,\s*onRendererBusyChange: options\.onRendererBusyChange,/,
  'every ordinary branch-card capture must preserve the streaming yield and renderer-busy callbacks',
);
assert.match(
  treeSource,
  /const collapseNearTwigs = f\.mobileNearTwigCollapse === true;[\s\S]*rung\('LOD2', 0, maxL, !collapseNearTwigs/,
  'near-twig collapse must reuse the existing LOD2 card rung instead of adding a frame-time system',
);
assert.match(
  forkSource,
  /springLeaf[\s\S]*autumnPalette[\s\S]*surfaceColor = mix\([\s\S]*springFlush[\s\S]*surfaceColor = mix\(surfaceColor, autumnLeaf, leafMask\.mul\(autumnColor\)\)/,
  'deciduous leaf pixels must receive gradual spring and species-specific autumn color',
);
assert.match(
  builderSource,
  /findLodLevel\(prototype, 'LOD3'\)[\s\S]*?\?\? findLodLevel\(prototype, 'LOD4'\)/,
  'overview forests must prefer the branch-bearing authored LOD3 rung over flat LOD4 limbs',
);
assert.match(
  builderSource,
  /douglasFir: \{ tint: \[0\.44, 0\.59, 0\.49\][\s\S]*loblolly: \{ tint: \[0\.4, 0\.55, 0\.44\][\s\S]*pine: \{ tint: \[0\.47, 0\.61, 0\.45\]/,
  'overview conifers must retain species-specific dark evergreen tones',
);
assert.doesNotMatch(
  builderSource,
  /forest\.ecology|createForestEdgeEcology|createForestCanopyCompanions|successionSet/,
  'the live forest must not add generated shrub lobes or trunkless companion crowns around SeedThree trees',
);
assert.match(
  forestPropsSource,
  /legacy procedural trees are intentionally not used[\s\S]*?const treeInstances = createStubForestInstances\(allTreePlacements\)/,
  'non-WebGPU backends must not substitute the legacy low-poly forest',
);
assert.doesNotMatch(
  forestManagerSource,
  /TreeSaplings|saplingMesh|createTreeSaplingMesh|updateTreeSaplingInstance/,
  'tree growth phases must not render the removed cone-sapling proxy',
);
assert.match(
  forkSource,
  /sin\(treeOrigin\.x[\s\S]*treeOrigin\.z[\s\S]*mat\.colorNode = surfaceColor\.mul\(tint\)\.mul\(occl\)\.mul\(variation\)/,
  'overview tone variation must reuse tree origin without another instance attribute',
);
assert.doesNotMatch(
  forkSource.slice(forkSource.indexOf('export function setForestCardSeason')),
  /new (Mesh|InstancedMesh|BufferGeometry)/,
  'season changes must not allocate geometry or add draws',
);

const cardGeometry = new THREE.BufferGeometry();
cardGeometry.setAttribute(
  'position',
  new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
);
const treeOrigin = new THREE.InstancedBufferAttribute(new Float32Array(6), 3);
cardGeometry.setAttribute('aTreeOrigin', treeOrigin);
cardGeometry.setAttribute(
  'aWindVec',
  new THREE.InstancedBufferAttribute(new Float32Array(6), 3),
);
cardGeometry.setAttribute(
  'aAnchorPos',
  new THREE.InstancedBufferAttribute(new Float32Array(6), 3),
);
const cardMaterial = new THREE.MeshBasicMaterial();
const cardMesh = new THREE.InstancedMesh(cardGeometry, cardMaterial, 2);
cardMesh.userData.k = 1;
cardMesh.userData.srcMatrices = new THREE.Matrix4().identity().toArray();
cardMesh.userData.weights = [0.5];
writeSeedThreeLodMatrices(
  { branches: null, cards: [cardMesh] },
  [
    {
      layoutIndex: 0,
      matrix: new THREE.Matrix4().makeTranslation(4, 5, 6),
      pos: new THREE.Vector3(4, 5, 6),
      visibilityCenter: new THREE.Vector3(4, 5, 6),
      visibilityRadius: 1,
      enabled: true,
      seasonalDeciduous: true,
    },
    {
      layoutIndex: 1,
      matrix: new THREE.Matrix4().makeTranslation(8, 9, 10),
      pos: new THREE.Vector3(8, 9, 10),
      visibilityCenter: new THREE.Vector3(8, 9, 10),
      visibilityRadius: 1,
      enabled: true,
      seasonalDeciduous: false,
    },
  ],
  [0, 1],
);
assert.equal(cardMesh.count, 2);
assert.deepEqual(
  Array.from(treeOrigin.array),
  [4, 2053, 6, 8, 9, 10],
  'real card attributes must preserve evergreen height and pack the deciduous flag at +2048',
);
assert.ok(treeOrigin.version > 0, 'committed packed origins must be flagged for GPU upload');
cardGeometry.dispose();
cardMaterial.dispose();

console.log('test:seedthree-winter-foliage passed');
