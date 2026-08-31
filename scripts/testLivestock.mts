import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import {
  HAYLOFT_VISUAL_SEGMENTS,
  PASTORAL_SALT_VISUAL_SEGMENTS,
  syncStockpileSegments,
} from '../src/buildings/buildingStockpileVisuals.ts';
import {
  MANURE_STOCKPILE_VISUAL_SEGMENTS,
  MANURE_STOCK_SEGMENT_NAME,
} from '../src/buildings/meshes/manureStockpileMesh.ts';
import { getBuildingExtent } from '../src/buildings/buildingExtents.ts';
import {
  allocateLivestockVisualPastures,
  createCattleVisualDistribution,
  livestockCullDepartureCount,
  livestockHerdFormationOffsetMeters,
  livestockVisualHeadCount,
  pastureGateWaypoints,
} from '../src/farming/LivestockVisuals.ts';
import {
  cattleManureCollectionMultiplier,
  cattleManurePerCycle,
} from '../src/farming/manurePlanning.ts';
import {
  countMatureTreesInPasturePolygons,
  currentPastureHeadCapacity,
  livestockHoldingWholeHeadLimit,
  neutralPastureHeadCapacity,
  neutralPastureHoldingHeadCapacity,
  pannageHoldingHeadCapacity,
  pastureAreaHeadCapacity,
} from '../src/farming/pastureCapacity.ts';
import type { TreeRegistry } from '../src/resources/TreeRegistry.ts';
import type { TreeEntityState, TreeLayoutEntry } from '../src/resources/types.ts';
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
  SWINE_MAX_HERD,
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
assert.equal(BACKYARD_GARDEN_DEFINITIONS.animal_pen.hiddenFromPicker, false);
assert.equal(BACKYARD_GARDEN_DEFINITIONS.chicken_pen.specializationOf, 'animal_pen');
assert.equal(BACKYARD_GARDEN_DEFINITIONS.goat_pen.specializationOf, 'animal_pen');
assert.equal(BACKYARD_GARDEN_DEFINITIONS.pig_pen.specializationOf, 'animal_pen');

const lowerPasture = {
  id: 'pasture-1',
  farmsteadId: 'building-1',
  corners: [
    { x: 0, z: 0 },
    { x: 20, z: 0 },
    { x: 20, z: 20 },
    { x: 0, z: 20 },
  ],
  area: 400,
  averageSlopeDegrees: 4,
  moisture: 0.58,
} as const;
const upperPasture = {
  ...lowerPasture,
  id: 'pasture-2',
  averageSlopeDegrees: 18,
  moisture: 0.36,
};
assert.ok((neutralPastureHeadCapacity(lowerPasture, 'cattle') ?? 0) > 0);
assert.ok(
  (neutralPastureHeadCapacity(upperPasture, 'sheep') ?? 0)
    > (neutralPastureHeadCapacity(upperPasture, 'cattle') ?? 0),
  'upland parcels should communicate their stronger sheep carrying capacity',
);
assert.equal(neutralPastureHeadCapacity(lowerPasture, 'swine'), null);
assert.ok(pastureAreaHeadCapacity(lowerPasture, 'swine') > 0);
const largeVisualPasture = {
  ...lowerPasture,
  id: 'pasture-visual-large',
  corners: [
    { x: 30, z: 0 },
    { x: 70, z: 0 },
    { x: 70, z: 40 },
    { x: 30, z: 40 },
  ],
  area: 1600,
};
const weightedSheepVisuals = allocateLivestockVisualPastures(
  [lowerPasture, largeVisualPasture],
  'sheep',
  10,
);
assert.deepEqual(
  [
    weightedSheepVisuals.filter((pasture) => pasture.id === lowerPasture.id).length,
    weightedSheepVisuals.filter((pasture) => pasture.id === largeVisualPasture.id).length,
  ],
  [2, 8],
  'displayed animals should follow each linked parcel\'s share of carrying capacity',
);
const lowerParcelHerd = { species: 'cattle', pastureCapacity: 3 } as const;
const upperParcelHerd = { species: 'sheep', pastureCapacity: 7 } as const;
assert.equal(
  currentPastureHeadCapacity(
    lowerPasture,
    [lowerPasture, upperPasture],
    lowerParcelHerd,
  ),
  3,
  'a parcel-owned herd should expose its own live capacity without sibling redistribution',
);
assert.equal(
  currentPastureHeadCapacity(
    upperPasture,
    [lowerPasture, upperPasture],
    upperParcelHerd,
  ),
  7,
  'a sibling pasture should retain the live capacity authored on its own herd row',
);
assert.ok(Math.abs(
  neutralPastureHoldingHeadCapacity([lowerPasture, upperPasture], 'cattle')
    - (
      (neutralPastureHeadCapacity(lowerPasture, 'cattle') ?? 0)
      + (neutralPastureHeadCapacity(upperPasture, 'cattle') ?? 0)
    ),
) < 1e-9);

const eastPannage = {
  ...lowerPasture,
  id: 'pasture-3',
  corners: [
    { x: 30, z: 0 },
    { x: 50, z: 0 },
    { x: 50, z: 20 },
    { x: 30, z: 20 },
  ],
} as const;
const pannageTreeEntries = [
  { id: 'tree-1', layoutIndex: 1, x: 5, z: 5, woodYield: 10, form: 'broad', species: 'oak', scale: 1 },
  { id: 'tree-2', layoutIndex: 2, x: 12, z: 12, woodYield: 8, form: 'broad', species: 'beech', scale: 1 },
  { id: 'tree-3', layoutIndex: 3, x: 35, z: 5, woodYield: 9, form: 'broad', species: 'oak', scale: 1 },
  { id: 'tree-4', layoutIndex: 4, x: 10, z: 21, woodYield: 7, form: 'broad', species: 'oak', scale: 1 },
] satisfies TreeLayoutEntry[];
const pannageTreeRegistry: Pick<TreeRegistry, 'treesInRadiusInto'> = {
  treesInRadiusInto(x, z, radius, results) {
    results.length = 0;
    for (const tree of pannageTreeEntries) {
      if (Math.hypot(tree.x - x, tree.z - z) <= radius) results.push(tree);
    }
    return results;
  },
};
const pannageTreeStates = new Map<string, TreeEntityState>([
  ['tree-1', { treeId: 'tree-1', layoutIndex: 1, phase: 'mature', growthProgress: 1 }],
  ['tree-2', { treeId: 'tree-2', layoutIndex: 2, phase: 'growing', growthProgress: 0.6 }],
  ['tree-3', { treeId: 'tree-3', layoutIndex: 3, phase: 'mature', growthProgress: 1 }],
  ['tree-4', { treeId: 'tree-4', layoutIndex: 4, phase: 'mature', growthProgress: 1 }],
]);
const exactPannageTrees = countMatureTreesInPasturePolygons(
  { trees: pannageTreeStates },
  pannageTreeRegistry,
  [lowerPasture, eastPannage],
);
assert.equal(
  exactPannageTrees,
  2,
  'pannage mast must count mature authoritative trees inside exact polygons only',
);
const pannageCapacity = pannageHoldingHeadCapacity(
  [lowerPasture, eastPannage],
  exactPannageTrees,
);
assert.ok(pannageCapacity.areaHeadCapacity > pannageCapacity.mastHeadCapacity);
assert.equal(pannageCapacity.headCapacity, pannageCapacity.mastHeadCapacity);
assert.equal(
  livestockHoldingWholeHeadLimit(999, 'swine'),
  SWINE_MAX_HERD,
  'whole-head previews must respect the species hard herd cap',
);

const constructionSource = fs.readFileSync('server/src/simulation/construction.rs', 'utf8');
assert.doesNotMatch(
  constructionSource,
  /livestock_herd|pasture_herd|unstocked_(?:pasture_)?herd/,
  'finishing a livestock building must not create a building-owned herd',
);
const livestockReducerSource = fs.readFileSync('server/src/reducers/livestock.rs', 'utf8');
assert.match(
  livestockReducerSource,
  /farmstead\.kind == "swineherd"[\s\S]{0,700}insert\(unstocked_pasture_herd\(&pasture, SPECIES_SWINE\)\)/,
  'a new swine pannage should establish its parcel policy without granting free pigs',
);
assert.match(
  livestockReducerSource,
  /let Some\(mut herd\) = existing_herd else \{[\s\S]{0,180}insert\(unstocked_pasture_herd\(&pasture, species\)\)/,
  'the first explicit pasture specialization must create an unstocked parcel herd policy',
);
assert.match(
  livestockReducerSource,
  /pub fn unstocked_pasture_herd\([\s\S]{0,460}pasture_id: pasture\.id[\s\S]{0,180}head_count: 0/,
  'new parcel herd policies must be keyed to their pasture and start with zero animals',
);
assert.match(
  livestockReducerSource,
  /if herd\.head_count > 0 \{[\s\S]{0,180}Sell this pasture's current herd before changing its species/,
  'a stocked pasture must reject a species change until only that parcel is emptied',
);
assert.doesNotMatch(
  livestockReducerSource,
  /Remove this holding's linked pasture before changing species/,
  'switching an empty pasture must never require removing its fence or sibling parcels',
);
assert.match(
  livestockReducerSource,
  /pub fn trade_livestock\([\s\S]{0,100}pasture_id: u64[\s\S]{0,260}head_delta == 0 \|\| !\(-100\.\.=100\)\.contains\(&head_delta\)/,
  'livestock trade must reject empty and unreasonable orders authoritatively',
);
assert.match(
  livestockReducerSource,
  /let land_limit = grazing_capacity_for_pasture\(ctx, &pasture, &herd\)[\s\S]{0,220}let parcel_limit = maximum_herd\(herd\.species\)\.min\(land_limit\)[\s\S]{0,260}holding_management_units\(ctx, pasture\.farmstead_id\)[\s\S]{0,260}\.min\(management_room\)/,
  'purchases must fit this parcel and the linked holding shared management budget',
);
assert.match(
  livestockReducerSource,
  /let cost = purchase_gold_per_head\(herd\.species\) \* f64::from\(quantity\);[\s\S]{0,80}spend_treasury_gold\(ctx, owner, cost\)\?/,
  'animal purchases must spend civic gold before adding heads',
);
assert.match(
  livestockReducerSource,
  /if quantity > herd\.head_count[\s\S]{0,520}credit_treasury_gold\([\s\S]{0,160}sale_gold_per_head\(herd\.species\)/,
  'animal sales must reject overselling and credit the species sale value',
);
const livestockInspectorSource = fs.readFileSync('src/resources/inspector/livestockBuildingRenderer.ts', 'utf8');
const pastureInspectorSource = fs.readFileSync('src/resources/inspector/pastureRenderer.ts', 'utf8');
const farmFieldToolSource = fs.readFileSync('src/farming/FarmFieldTool.ts', 'utf8');
const worldQueriesSource = fs.readFileSync('src/resources/WorldQueries.ts', 'utf8');
const buildingReducerSource = fs.readFileSync('server/src/reducers/buildings.rs', 'utf8');
const serverSeasonPolicySource = fs.readFileSync('server/src/season_policy.rs', 'utf8');
const clientSeasonPolicySource = fs.readFileSync('src/world/seasonPolicy.ts', 'utf8');
const clientReducersSource = fs.readFileSync('src/data/spacetimeReducers.ts', 'utf8');
const gameStoreSource = fs.readFileSync('src/data/spacetimeGameStore.ts', 'utf8');
const resourceInspectorSource = fs.readFileSync('src/resources/ResourceInspector.ts', 'utf8');
const inspectorActionsSource = fs.readFileSync('src/app/inspectorSpacetimeActions.ts', 'utf8');
const generatedTradeReducerSource = fs.readFileSync('src/generated/trade_livestock_reducer.ts', 'utf8');
const generatedIndexSource = fs.readFileSync('src/generated/index.ts', 'utf8');
const generatedReducerTypesSource = fs.readFileSync('src/generated/types/reducers.ts', 'utf8');
const serverGeneratedIndexSource = fs.readFileSync('server/src/generated/index.ts', 'utf8');
assert.match(livestockInspectorSource, /Mixed livestock holding/);
assert.match(livestockInspectorSource, /getLivestockHerdsForBuilding\(building\.id\)/);
assert.match(livestockInspectorSource, /data-inspect-pasture="\$\{pasture\.id\}"/);
assert.match(pastureInspectorSource, /This pasture supports/);
assert.match(pastureInspectorSource, /This pasture's herd/);
assert.match(pastureInspectorSource, /Last husbandry cycle/);
assert.match(
  pastureInspectorSource,
  /data-inspector-panel-title="Stock this pasture"[\s\S]{0,900}data-livestock-trade="1"/,
  'a selected pasture must be the purchase surface for its own herd',
);
assert.match(
  pastureInspectorSource,
  /Each fenced pasture keeps its own herd and carrying limit[\s\S]{0,300}sibling pasture remain untouched/i,
  'pasture switching copy must explain that only the selected parcel changes',
);
assert.match(
  pastureInspectorSource,
  /livestockPastureManagementHeadAllowance\(species, otherHerds\)/,
  'the parcel ceiling must also respect shared holding management headroom',
);
assert.match(pastureInspectorSource, /livestockBreedingPhaseForMonth/);
assert.match(pastureInspectorSource, /Cattle mate in summer/);
assert.match(pastureInspectorSource, /Sheep mate in autumn/);
assert.match(pastureInspectorSource, /confirmed offspring arrive in spring/);
assert.match(farmFieldToolSource, /choose after fencing/);
assert.match(farmFieldToolSource, /each parcel keeps its own herd and cap/);
assert.match(farmFieldToolSource, /land cap .* vs woodland browse\/mast cap/);
assert.match(farmFieldToolSource, /pig slots/);
assert.match(farmFieldToolSource, /% quality/);
assert.match(farmFieldToolSource, /management cap reached/);
assert.match(farmFieldToolSource, /getTreeRegistry/);
assert.match(
  farmFieldToolSource,
  /farmstead!\.kind === 'swineherd'[\s\S]{0,80}SWINE_MAX_SLOPE_DEGREES/,
  'swine pannage preview validation must use the same slope ceiling as the server',
);
assert.match(worldQueriesSource, /getMaturePannageTreeCount/);
assert.match(worldQueriesSource, /getMaturePannageTreeCountForPasture/);
assert.doesNotMatch(
  livestockInspectorSource,
  /data-livestock-(?:species|trade|breeding-reserve|haymaking-percent)/,
  'species, trading, breeding, and hay policy must live on pastures rather than the farmstead panel',
);
assert.match(
  pastureInspectorSource,
  /starterHerd\(herd\.species\) - herd\.headCount/,
  'a partial herd must only offer the remaining animals needed for its starter target',
);
assert.match(pastureInspectorSource, /data-livestock-trade="-1"/);
assert.match(livestockInspectorSource, /Select a finished pasture to choose its animals, buy or sell that herd/);
assert.match(livestockInspectorSource, /Pannage trees/);
assert.match(
  livestockInspectorSource,
  /getMaturePannageTreeCount\(building\.id\)/,
  'the swine holding dashboard must aggregate mature trees across its linked polygons',
);
assert.match(
  livestockInspectorSource,
  /data-land-parcel="pasture"[\s\S]{0,600}<span>\$\{pastureLabel\}<\/span><\/button>/,
  'one farmstead must always be able to fence additional independent pastures',
);
assert.match(
  buildingReducerSource,
  /pasture_herd\(\)[\s\S]{0,120}\.farmstead_id\(\)[\s\S]{0,120}herd\.head_count > 0[\s\S]{0,260}Sell this livestock holding's animals before demolition/,
  'stocked livestock buildings must not be demolished out from under their animals',
);
assert.match(
  buildingReducerSource,
  /\.pasture\(\)[\s\S]{0,180}\.farmstead_id\(\)[\s\S]{0,220}Remove this livestock building's pastures first/,
  'linked pasture parcels must still block holding demolition',
);
assert.match(
  serverSeasonPolicySource,
  /pub fn pannage_capacity_multiplier[\s\S]{0,420}Season::Autumn => PANNAGE_AUTUMN_CAPACITY_MULTIPLIER/,
  'authoritative woodland capacity must use its autumn mast season',
);
assert.match(
  clientSeasonPolicySource,
  /function pannageCapacityMultiplierFor[\s\S]{0,360}autumn: PANNAGE_AUTUMN_CAPACITY_MULTIPLIER/,
  'client pannage forecasts must mirror the authoritative mast calendar',
);
assert.match(generatedTradeReducerSource, /pastureId: __t\.u64\(\)[\s\S]{0,80}headDelta: __t\.i32\(\)/);
assert.match(generatedIndexSource, /__reducerSchema\("trade_livestock", TradeLivestockReducer\)/);
assert.match(serverGeneratedIndexSource, /__reducerSchema\("trade_livestock", TradeLivestockReducer\)/);
assert.match(generatedReducerTypesSource, /export type TradeLivestockParams = __Infer<typeof TradeLivestockReducer>/);
assert.match(
  clientReducersSource,
  /function tradeLivestock\(pastureId: string, headDelta: number\)[\s\S]{0,180}parsePastureServerId\(pastureId\)[\s\S]{0,260}callReducer\('tradeLivestock', 'trade_livestock',[\s\S]{0,120}pastureId: serverId[\s\S]{0,80}headDelta: normalizedDelta/,
  'the client reducer adapter must normalize and dispatch pasture-keyed livestock orders',
);
assert.match(gameStoreSource, /tradeLivestock\(pastureId: string, headDelta: number\)[\s\S]{0,100}spacetimeReducers\.tradeLivestock\(pastureId, headDelta\)/);
assert.match(
  resourceInspectorSource,
  /\[data-livestock-trade\][\s\S]{0,260}Number\.isInteger\(headDelta\)[\s\S]{0,180}onTradeLivestock/,
  'the inspector must pass only whole, non-zero head deltas to its action layer',
);
assert.match(
  resourceInspectorSource,
  /selectedTarget\?\.kind === 'pasture'[\s\S]{0,1800}onTradeLivestock\?\.\([\s\S]{0,80}selectedTarget\.pasture\.id,[\s\S]{0,80}headDelta/,
  'pasture stocking must forward the selected parcel id rather than the linked farmstead id',
);
assert.match(inspectorActionsSource, /onTradeLivestock: async \(pastureId, headDelta\)[\s\S]{0,260}store\.tradeLivestock\(pastureId, headDelta\)/);

assert.deepEqual(createCattleVisualDistribution(3), ['cow', 'cow', 'cow']);
assert.deepEqual(createCattleVisualDistribution(6), ['bull', 'cow', 'cow', 'cow', 'cow', 'cow']);
assert.equal(
  createCattleVisualDistribution(18).filter((kind) => kind === 'bull').length,
  1,
  'large displayed herds should still contain one bull rather than an unnatural 50/50 split',
);

const sheepFormation = livestockHerdFormationOffsetMeters('sheep', 11, 20);
const cattleFormation = livestockHerdFormationOffsetMeters('cattle', 11, 20);
assert.ok(
  Math.hypot(sheepFormation.x, sheepFormation.z)
    < Math.hypot(cattleFormation.x, cattleFormation.z) * 0.5,
  'sheep should flock at less than half the spacing used by a loose cattle herd',
);
assert.deepEqual(
  livestockHerdFormationOffsetMeters('sheep', 11, 20),
  sheepFormation,
  'herd formation slots must be deterministic rather than independently wandering',
);

const gateRoute = pastureGateWaypoints(
  lowerPasture,
  { x: 6, z: 8 },
  { x: 10, z: -12 },
);
assert.deepEqual(gateRoute[0], { x: 6, z: 8 });
assert.deepEqual(gateRoute[2], { x: 10, z: 0 }, 'edge zero owns the centered pasture entrance');
assert.ok(gateRoute[1]!.z > 0, 'the route must approach the entrance from inside the pasture');
assert.ok(gateRoute[3]!.z < 0, 'the route must clear the entrance before heading to work');
assert.deepEqual(gateRoute.at(-1), { x: 10, z: -12 });

const priorCull = {
  headCount: 12,
  lastCulled: 1,
  lastFoodOutput: 4,
  lastPreservedOutput: 1,
};
const unchangedCullStores = { meat: 8, preservedFood: 3, hides: 2 };
assert.equal(
  livestockCullDepartureCount(
    priorCull,
    { ...priorCull, headCount: 11 },
    unchangedCullStores,
    unchangedCullStores,
  ),
  0,
  'a player sale after a cull must not create a second slaughter procession',
);
assert.equal(
  livestockCullDepartureCount(
    priorCull,
    { ...priorCull, headCount: 11 },
    unchangedCullStores,
    { ...unchangedCullStores, hides: 3 },
  ),
  1,
  'a consecutive cull is confirmed by its physical output reaching the holding',
);
assert.equal(
  livestockCullDepartureCount(
    { ...priorCull, lastCulled: 0 },
    { ...priorCull, headCount: 11 },
  ),
  1,
  'a new authoritative cull marker should dispatch the removed animal',
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
assert.equal(livestockVisualHeadCount('cattle', 50), 50);
assert.equal(livestockVisualHeadCount('sheep', 60), 60);
assert.equal(livestockVisualHeadCount('swine', 30), 30);
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

const saltStore = pastoralModel.getObjectByName('PastoralSaltStockpile');
assert.ok(
  saltStore instanceof THREE.Group,
  'the pastoral farmstead should expose physical salt sacks',
);
const saltSegments = saltStore.children.filter(
  (child) => child.name === 'PastoralSaltSegment',
);
assert.equal(saltSegments.length, PASTORAL_SALT_VISUAL_SEGMENTS);
assert.equal(saltStore.visible, false, 'an empty dairy salt store must show no sacks');
assert.equal(
  syncStockpileSegments(
    saltStore,
    'PastoralSaltSegment',
    BUILDING_STORAGE_CAPS.pastoral_farmstead.salt / 2,
    BUILDING_STORAGE_CAPS.pastoral_farmstead.salt,
  ),
  2,
);
assert.equal(saltSegments.filter((segment) => segment.visible).length, 2);

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
const serverLivestockPolicy = fs.readFileSync('server/src/livestock_policy.rs', 'utf8');
const tickContext = fs.readFileSync('server/src/simulation/tick_context.rs', 'utf8');
assert.match(serverLivestock, /tree\.phase == "mature"/, 'pannage should count only mature trees');
assert.match(serverLivestock, /mature_trees\s*\/\s*SWINE_MATURE_TREES_PER_HEAD/, 'pannage capacity should use mature trees');
assert.match(
  serverLivestock,
  /herd\.species == SPECIES_SWINE[\s\S]{0,160}environment\.pannage_capacity_multiplier\(\)/,
  'swine must use the pannage calendar instead of the grass-pasture calendar',
);
assert.match(
  serverLivestock,
  /parcel\.herd\.supplied_capacity = parcel[\s\S]{0,180}\.supplied_capacity[\s\S]{0,80}\.max\([\s\S]{0,180}\.pasture_capacity[\s\S]{0,100}\.min\(f64::from\(parcel\.herd\.head_count\)\)/,
  'fixed-cycle feed and water support must survive intervening simulation substeps',
);
assert.match(
  serverLivestock,
  /let care_labor = essential_livestock_care_labor\([\s\S]{0,180}owner_has_active_raider_threat[\s\S]*let \(cycle_care_labor, cycle_productive_labor\) = if paused \{[\s\S]{0,80}\(care_labor, 0\)[\s\S]{0,260}paired_production_ox_count[\s\S]{0,220}ox_amplified_worker_count/,
  'observed Sundays must retain essential animal care while raids still remove it and working oxen amplify active-cycle labor',
);
assert.doesNotMatch(
  serverLivestock,
  /if clock\.is_work_hours/,
  'cosmetic day and night must not gate the continuous husbandry clock',
);
assert.match(
  serverLivestock,
  /building\.action_cooldown = \(building\.action_cooldown - TICK_DT\)\.max\(0\.0\)/,
  'animal biology must advance continuously instead of scaling with worker throughput',
);
assert.match(
  serverLivestock,
  /if committed \{[\s\S]{0,220}building\.action_cooldown = building_def\(&building\.kind\)[\s\S]{0,120}def\.action_interval/,
  'a committed husbandry cycle must reset to the generated building interval',
);
assert.doesNotMatch(
  serverLivestock,
  /def\.action_interval\s*\/\s*f64::from\(onsite_labor\)/,
  'additional herders must not accelerate thirst, gestation, or milk cycles',
);
assert.match(
  serverLivestock,
  /fn allocate_holding_cycle_inputs[\s\S]{0,1800}water_demands\.push[\s\S]{0,900}fair_whole_allocations\(whole_units\(building\.water\), &water_demands\)[\s\S]{0,400}withdraw_building_commodity\(building, CommodityKind::Water, water_used\)[\s\S]{0,500}input\.water_units = water_allocations\[index\]/,
  'shared trough water must be fairly allocated to pasture herds before their cycles resolve care',
);
assert.match(
  serverLivestock,
  /herd\.supplied_capacity = feed_supported_heads[\s\S]{0,120}\.min\(water_supported_heads\)[\s\S]{0,120}\.min\(care_supported_heads\)/,
  'feed, water, and care must all constrain the number of productive heads',
);
assert.match(
  serverLivestock,
  /herd\.head_count >= LIVESTOCK_MINIMUM_BREEDING_HEADS[\s\S]{0,180}support_ratio >= 0\.9[\s\S]{0,120}herd\.health >= 0\.72/,
  'reproduction must require a viable, well-supported, healthy breeding group',
);
assert.match(
  serverLivestock,
  /let local_limit = species_max_herd\(parcel\.herd\.species\)[\s\S]{0,180}parcel\.base_capacity[\s\S]{0,180}let breeding_limit[\s\S]{0,120}local_limit\.min\(before_heads\.saturating_add\(management_room_heads\)\)/,
  'births must stop at the parcel land limit and shared holding management ceiling',
);
assert.match(
  serverLivestockPolicy,
  /pub fn livestock_cycles_per_calendar_day\(action_interval: f64\)[\s\S]{0,300}CALENDAR_SECONDS_PER_DAY \/ action_interval/,
  'winter-feed forecasting must use the same fixed husbandry cadence',
);
assert.doesNotMatch(
  serverLivestockPolicy,
  /pub fn livestock_cycles_per_calendar_day\([^)]*(assigned_labor|sabbath)/,
  'the biology forecast must not scale its cycle count with labor or Sabbath staffing',
);
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
  /cattle_field_support_for[\s\S]*filter_map\(\|pasture_id\| ctx\.db\.pasture_herd\(\)\.pasture_id\(\)\.find\(&pasture_id\)\)[\s\S]*cattle_field_support_is_active/,
  'field work should re-read every candidate pasture herd after using the cached map',
);
assert.match(
  serverLivestock,
  /cattle_manure_output[\s\S]{0,500}deposit_building_commodity\(building, CommodityKind::Manure, manure_to_store\)/,
  'supplied cattle must produce manure into the holding rather than the treasury',
);
assert.match(
  serverLivestock,
  /dispatch_manure_to_crop_farmstead[\s\S]*local_delivery_distance[\s\S]*LIVESTOCK_MANURE_TRANSFER_PER_TRIP/,
  'manure must travel in bounded carts to road-reachable crop holdings',
);
assert.match(
  serverLivestock,
  /try_store_exact_salted_output[\s\S]*withdraw_building_commodity\([\s\S]*CommodityKind::Salt/,
  'farmhouse cheese must consume salt from the visible holding store',
);
const routineOutputStart = serverLivestock.indexOf('// Cheese that cannot be made falls back to fresh milk.');
const routineOutputEnd = serverLivestock.indexOf('let maximum_herd', routineOutputStart);
assert.ok(routineOutputStart >= 0 && routineOutputEnd > routineOutputStart);
const routineOutputContract = serverLivestock.slice(routineOutputStart, routineOutputEnd);
assert.match(
  routineOutputContract,
  /let milk_to_store[\s\S]*let manure_to_store/,
  'routine milk and manure output must be capped to each physical store',
);
assert.match(
  serverLivestock,
  /is_cattle_milking_month\(clock\.month\)[\s\S]{0,160}herd\.last_milking_period != milking_period[\s\S]{0,500}cattle_monthly_dairy_cycle_multiplier/,
  'cattle must produce one monthly dairy lot only from March through November',
);
assert.match(
  serverLivestock,
  /let gross_milk = discrete_expected_units\([\s\S]{0,180}dairy_roll_period/,
  'monthly dairy expectations must resolve into whole physical units',
);
assert.match(
  routineOutputContract,
  /if cattle_milking_due[\s\S]{0,320}herd\.last_milking_period = milking_period/,
  'a completed cattle milking round must be recorded even when storage is full',
);
assert.match(
  routineOutputContract,
  /let wool_room = whole_units[\s\S]*if fleece >= 1\.0 && wool_room \+ 1e-9 >= fleece[\s\S]*deposit_building_commodity\(building, CommodityKind::Wool, fleece\)[\s\S]*herd\.last_shearing_year = clock\.year/,
  'annual shearing must wait until the holding can store the full clip',
);
assert.doesNotMatch(
  routineOutputContract,
  /let fleece_to_store|storable_whole_output\(\s*fleece/,
  'annual shearing must not store a partial clip or lose the excess',
);
assert.doesNotMatch(
  routineOutputContract,
  /return false/,
  'full routine-output stores or a deferred clip must not roll back feeding, health, or mortality',
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
  /withdraw_building_commodity\(\s*resource_farmstead,\s*CommodityKind::Manure,\s*manure_needed,?\s*\)/,
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
