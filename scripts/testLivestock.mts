import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import {
  HAYLOFT_VISUAL_SEGMENTS,
  syncStockpileSegments,
} from '../src/buildings/buildingStockpileVisuals.ts';
import {
  MANURE_STOCKPILE_VISUAL_SEGMENTS,
  MANURE_STOCK_SEGMENT_NAME,
} from '../src/buildings/meshes/manureStockpileMesh.ts';
import { getBuildingExtent } from '../src/buildings/buildingExtents.ts';
import { createCattleVisualDistribution } from '../src/farming/LivestockVisuals.ts';
import {
  cattleManureCollectionMultiplier,
  cattleManurePerCycle,
} from '../src/farming/manurePlanning.ts';
import {
  BACKYARD_GARDEN_DEFINITIONS,
  BUILDING_STORAGE_CAPS,
  BUILDING_DEFINITIONS,
  BUILDING_KINDS,
  CATTLE_MAX_PLOUGH_SUPPORTED_FIELDS,
  CATTLE_PLOUGH_WORK_MULTIPLIER,
  FARM_MANURE_FERTILITY_BONUS,
  LIVESTOCK_MANURE_TRANSFER_PER_TRIP,
  LIVESTOCK_MIN_PASTURE_AREA,
  LIVESTOCK_HAY_STORAGE_CAPACITY,
  SHEEP_GRAIN_PER_UNSUPPORTED_HEAD,
  SWINE_GRAIN_PER_UNSUPPORTED_HEAD,
  SWINE_MATURE_TREES_PER_HEAD,
} from '../src/generated/gameBalance.ts';

(globalThis as typeof globalThis & { self: typeof globalThis }).self = globalThis;

assert.ok(BUILDING_KINDS.includes('pastoral_farmstead'));
assert.ok(BUILDING_KINDS.includes('swineherd'));
assert.equal(BUILDING_DEFINITIONS.pastoral_farmstead.workRadius, 110);
assert.equal(BUILDING_DEFINITIONS.swineherd.workRadius, 120);
assert.equal(BUILDING_DEFINITIONS.swineherd.requiresMatureTrees, true);
assert.ok(LIVESTOCK_MIN_PASTURE_AREA >= 48, 'pastures must remain meaningful drawn parcels');
assert.ok(FARM_MANURE_FERTILITY_BONUS > 0, 'spread manure must materially improve soil');
assert.equal(CATTLE_MAX_PLOUGH_SUPPORTED_FIELDS, 2, 'ox field support must remain capped');
assert.ok(CATTLE_PLOUGH_WORK_MULTIPLIER < 1, 'ox power must reduce plough work');
assert.equal(LIVESTOCK_MANURE_TRANSFER_PER_TRIP, 24, 'manure carts need bounded physical loads');
assert.ok(
  cattleManureCollectionMultiplier('winter') > cattleManureCollectionMultiplier('spring')
    && cattleManureCollectionMultiplier('spring') > cattleManureCollectionMultiplier('summer'),
  'housing and bedding should make manure easiest to collect in winter and scarcest on summer pasture',
);
assert.ok(cattleManurePerCycle(4, 'winter') > cattleManurePerCycle(4, 'summer'));
assert.ok(
  SWINE_GRAIN_PER_UNSUPPORTED_HEAD > SHEEP_GRAIN_PER_UNSUPPORTED_HEAD,
  'grain-only pig keeping must remain deliberately inefficient',
);
assert.ok(SWINE_MATURE_TREES_PER_HEAD > 0, 'swine capacity must depend on live mature trees');
assert.ok(BACKYARD_GARDEN_DEFINITIONS.hen_yard, 'hen yard must remain a backyard choice');

assert.deepEqual(createCattleVisualDistribution(3), ['cow', 'cow', 'cow']);
assert.deepEqual(createCattleVisualDistribution(6), ['bull', 'cow', 'cow', 'cow', 'cow', 'cow']);
assert.equal(
  createCattleVisualDistribution(18).filter((kind) => kind === 'bull').length,
  1,
  'large displayed herds should still contain one bull rather than an unnatural 50/50 split',
);

assert.deepEqual(
  getBuildingExtent('pastoral_farmstead', BUILDING_DEFINITIONS.pastoral_farmstead.workRadius),
  { type: 'work', label: 'Pasture work extent', radius: 110 },
);
assert.deepEqual(
  getBuildingExtent('swineherd', BUILDING_DEFINITIONS.swineherd.workRadius),
  { type: 'work', label: 'Pannage work extent', radius: 120 },
);

for (const kind of ['pastoral_farmstead', 'swineherd'] as const) {
  const model = createBuildingMesh(kind);
  let meshCount = 0;
  model.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshCount += 1;
  });
  assert.ok(meshCount >= 20, `${kind} should have a distinctive composed production mesh`);
  const bounds = new THREE.Box3().setFromObject(model);
  const size = bounds.getSize(new THREE.Vector3());
  assert.ok(size.x > 6 && size.y > 2 && size.z > 4, `${kind} should have a readable building footprint`);
}

const pastoralModel = createBuildingMesh('pastoral_farmstead');
const hayloft = pastoralModel.getObjectByName('HayloftStockpile');
assert.ok(hayloft instanceof THREE.Group, 'the pastoral farmstead should expose a live hayloft');
const haySegments = hayloft.children.filter((child) => child.name === 'HayStockSegment');
assert.equal(haySegments.length, HAYLOFT_VISUAL_SEGMENTS);
assert.equal(hayloft.visible, false, 'an empty local hay reserve must not show decorative hay');
assert.equal(
  syncStockpileSegments(
    hayloft,
    'HayStockSegment',
    LIVESTOCK_HAY_STORAGE_CAPACITY / 2,
    LIVESTOCK_HAY_STORAGE_CAPACITY,
  ),
  HAYLOFT_VISUAL_SEGMENTS / 2,
);
assert.equal(haySegments.filter((segment) => segment.visible).length, 4);
assert.equal(
  syncStockpileSegments(
    hayloft,
    'HayStockSegment',
    LIVESTOCK_HAY_STORAGE_CAPACITY,
    LIVESTOCK_HAY_STORAGE_CAPACITY,
  ),
  HAYLOFT_VISUAL_SEGMENTS,
);
assert.equal(haySegments.filter((segment) => segment.visible).length, 8);
assert.equal(syncStockpileSegments(
  hayloft,
  'HayStockSegment',
  0,
  LIVESTOCK_HAY_STORAGE_CAPACITY,
), 0);
assert.equal(hayloft.visible, false);

const manureYard = pastoralModel.getObjectByName('PastoralManureStockpile');
assert.ok(manureYard instanceof THREE.Group, 'the pastoral farmstead should expose a live manure yard');
const manureSegments = manureYard.children.filter(
  (child) => child.name === MANURE_STOCK_SEGMENT_NAME,
);
assert.equal(manureSegments.length, MANURE_STOCKPILE_VISUAL_SEGMENTS);
assert.equal(manureYard.visible, false, 'an empty manure yard must not show a decorative pile');
assert.equal(
  syncStockpileSegments(
    manureYard,
    MANURE_STOCK_SEGMENT_NAME,
    BUILDING_STORAGE_CAPS.pastoral_farmstead.manure / 2,
    BUILDING_STORAGE_CAPS.pastoral_farmstead.manure,
  ),
  MANURE_STOCKPILE_VISUAL_SEGMENTS / 2,
);
assert.equal(manureSegments.filter((segment) => segment.visible).length, 2);

const livestockAssets = [
  { label: 'cow', path: 'public/assets/models/livestock/quaternius-cow.glb', idle: 'idle', graze: 'eating', walk: 'walk' },
  { label: 'bull', path: 'public/assets/models/livestock/quaternius-bull.glb', idle: 'idle', graze: 'eating', walk: 'walk' },
  { label: 'sheep', path: 'public/assets/models/livestock/quaternius-sheep.glb', idle: 'idle', graze: 'idle_eating', walk: 'walk' },
  { label: 'pig', path: 'public/assets/models/livestock/quaternius-pig.glb', idle: 'idle', graze: 'idle_eating', walk: 'walk' },
  { label: 'chicken', path: 'public/assets/models/livestock/quaternius-chicken.glb', idle: 'idle', graze: null, walk: 'walk' },
] as const;

for (const asset of livestockAssets) {
  const bytes = fs.readFileSync(asset.path);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const gltf = await new Promise<Awaited<ReturnType<GLTFLoader['loadAsync']>>>((resolve, reject) => {
    new GLTFLoader().parse(buffer, '', resolve, reject);
  });
  const clipNames = gltf.animations.map((clip) => clip.name.toLowerCase());
  const hasClip = (name: string) => clipNames.some((clip) => clip === name || clip.endsWith(`|${name}`));
  assert.ok(hasClip(asset.idle), `${asset.label} should retain a rigged idle animation`);
  assert.ok(hasClip(asset.walk), `${asset.label} should retain a rigged walk animation`);
  if (asset.graze) assert.ok(hasClip(asset.graze), `${asset.label} should retain a grazing/eating animation`);

  let sourceMesh: THREE.SkinnedMesh | null = null;
  gltf.scene.traverse((object) => {
    if (!sourceMesh && (object as THREE.SkinnedMesh).isSkinnedMesh) sourceMesh = object as THREE.SkinnedMesh;
  });
  assert.ok(sourceMesh, `${asset.label} should contain an articulated skinned mesh`);
  const clone = cloneSkinned(gltf.scene);
  let cloneMesh: THREE.SkinnedMesh | null = null;
  clone.traverse((object) => {
    if (!cloneMesh && (object as THREE.SkinnedMesh).isSkinnedMesh) cloneMesh = object as THREE.SkinnedMesh;
  });
  assert.ok(cloneMesh, `${asset.label} runtime clones should remain skinned`);
  assert.notEqual(cloneMesh.skeleton, sourceMesh.skeleton, `${asset.label} clones need independent rigs`);
}

const license = fs.readFileSync('public/assets/models/livestock/LICENSE.txt', 'utf8');
for (const label of ['cow', 'bull', 'sheep', 'pig', 'chicken']) {
  assert.match(license.toLowerCase(), new RegExp(label), `${label} provenance should be documented`);
}
assert.match(license, /CC0 1\.0/, 'livestock assets should retain their CC0 license record');

const serverLivestock = fs.readFileSync('server/src/simulation/livestock.rs', 'utf8');
const tickContext = fs.readFileSync('server/src/simulation/tick_context.rs', 'utf8');
assert.match(serverLivestock, /tree\.phase == "mature"/, 'pannage should count only mature trees');
assert.match(serverLivestock, /mature_trees\s*\/\s*SWINE_MATURE_TREES_PER_HEAD/, 'pannage capacity should use mature trees');
assert.match(serverLivestock, /CATTLE_MAX_PLOUGH_SUPPORTED_FIELDS/, 'ox support should cap ploughed fields');
assert.match(
  serverLivestock,
  /pub fn cattle_field_support_sources[\s\S]*owner_fields[\s\S]*retain_priority_candidate/,
  'field geometry and priorities should be scanned once into bounded cattle-source candidates',
);
assert.doesNotMatch(
  serverLivestock,
  /pub fn cattle_support_for_fields/,
  'each farmstead must not repeat the owner-wide cattle and field scan',
);
assert.match(
  tickContext,
  /cattle_field_sources_by_owner:\s*RefCell<HashMap<Identity,\s*HashMap<u64,\s*Vec<u64>>>>/,
  'cattle-source candidates should be cached once per owner and simulation substep',
);
assert.match(
  tickContext,
  /cattle_field_support_for[\s\S]*livestock_herd\(\)[\s\S]*building_id\(\)[\s\S]*find\(&building_id\)[\s\S]*cattle_field_support_is_active/,
  'field work should re-read live herd readiness after using the cached candidate map',
);
assert.match(
  serverLivestock,
  /deposit_building_commodity\([\s\S]*CommodityKind::Manure[\s\S]*cattle_manure_output/,
  'supplied cattle must produce manure into the holding rather than the treasury',
);
assert.match(
  serverLivestock,
  /dispatch_manure_to_crop_farmstead[\s\S]*road_path_distance[\s\S]*LIVESTOCK_MANURE_TRANSFER_PER_TRIP/,
  'manure must travel in bounded carts to road-reachable crop holdings',
);
assert.match(
  tickContext,
  /farmstead_manure_requirements:\s*RefCell<HashMap<Identity,\s*HashMap<u64,\s*\(f64,\s*u8\)>>>/,
  'manure demand should be indexed once per owner and simulation substep',
);
assert.match(
  tickContext,
  /ensure_farmstead_manure_requirements[\s\S]*for field in ctx\.db\.farm_field\(\)\.owner\(\)\.filter\(&owner\)[\s\S]*field_manure_required/,
  'one owner-wide field scan should build all crop-holding manure requirements',
);
const farmSimulation = fs.readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
assert.match(
  farmSimulation,
  /tick\.cattle_field_support_for\(ctx,\s*farmstead\.owner,\s*field\.id\)/,
  'farmstead work should consume the owner-scoped tick cache',
);
assert.match(
  farmSimulation,
  /field\.stage == STAGE_PLOUGHING[\s\S]{0,100}plough_multiplier[\s\S]{0,100}else[\s\S]{0,100}1\.0/,
  'ox power should apply only to ploughing',
);
assert.match(
  farmSimulation,
  /withdraw_building_commodity\(farmstead, CommodityKind::Manure, manure_needed\)/,
  'field work must consume physical manure from its owning crop farmstead',
);
assert.match(
  farmSimulation,
  /field_manure_fertility_bonus\(field\.area, field\.manure_applied\)/,
  'soil improvement must follow actual manure coverage',
);
assert.doesNotMatch(
  farmSimulation,
  /cattle_field_support_for[\s\S]{0,300}fertility/,
  'nearby cattle must not grant a free proximity fertility bonus',
);
const commodities = fs.readFileSync('server/src/economy/commodities.rs', 'utf8');
assert.match(commodities, /Self::Manure => 24/, 'manure needs a stable physical cargo id');
assert.match(commodities, /CommodityKind::Manure => building\.manure/, 'manure stock must live on buildings');
assert.match(
  commodities,
  /CommodityKind::Manure => return/,
  'manure must never be credited to the disembodied legacy treasury ledger',
);

const scaleFarmsteads = 2_000;
const scaleFields = 2_000;
const scaleCattleHoldings = 20;
const repeatedFieldVisits = scaleFarmsteads * scaleFields * scaleCattleHoldings;
const cachedFieldVisits = scaleFields * scaleCattleHoldings + scaleFields;
const repeatedManureRequirementVisits = scaleCattleHoldings * scaleFarmsteads * scaleFields;
const cachedManureRequirementVisits = scaleFields + scaleCattleHoldings * scaleFarmsteads;
assert.ok(
  repeatedManureRequirementVisits / cachedManureRequirementVisits > 9,
  'manure target selection should reuse one field-demand scan across cattle holdings',
);
assert.ok(
  repeatedFieldVisits / cachedFieldVisits > 1_000,
  'the owner cache should remove farmstead × field × cattle scan multiplication',
);

console.log(
  `livestock gameplay and asset tests passed (modeled cattle candidate visits ${repeatedFieldVisits.toLocaleString()}→${cachedFieldVisits.toLocaleString()})`,
);
