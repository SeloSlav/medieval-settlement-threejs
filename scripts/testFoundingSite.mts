import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import {
  animateFoundersCampfire,
  FOUNDERS_CAMPFIRE_NAME,
  setFoundersCampfireNightLighting,
} from '../src/buildings/meshes/foundersCampMesh.ts';
import {
  FIRE_EFFECT_FLAMES_NAME,
  FIRE_EFFECT_LIGHT_NAME,
  FIRE_EFFECT_SMOKE_NAME,
} from '../src/fires/FireEffect.ts';
import { isBuildingDetailShadowCaster } from '../src/buildings/buildingShadowProxy.ts';
import { buildingMarkerSignatures } from '../src/buildings/buildingMarkerSignature.ts';
import {
  FOUNDING_STONE_VISUAL_SEGMENTS,
  FOUNDING_TIMBER_VISUAL_SEGMENTS,
  stockpileVisualLevel,
} from '../src/buildings/buildingStockpileVisuals.ts';
import { constructionSourcePriority } from '../src/logistics/constructionLogistics.ts';
import { planFoundingStockyardRelocation } from '../src/logistics/foundingStockyardLogistics.ts';
import { createWorldLayout } from '../src/resources/WorldLayout.ts';
import {
  createEmptyStockpile,
  type BuildingState,
  type GameState,
  type ResidenceState,
} from '../src/resources/types.ts';
import {
  computePopulationStats,
  computeResourceTotals,
} from '../src/resources/resourceTotals.ts';
import { RiverField } from '../src/rivers/RiverField.ts';
import { Terrain } from '../src/terrain/Terrain.ts';
import { selectFoundingSite } from '../src/world/worldBootstrapData.ts';
import {
  createVisualQaFoundersCampFixture,
  VISUAL_QA_FOUNDERS_CAMP_ID,
  withVisualQaFoundersCamp,
  withVisualQaFoundersCampState,
} from '../src/app/visualQaFoundersCampFixture.ts';
import {
  BUILDING_DEFINITIONS,
  BUILDING_COSTS,
  BUILDING_STORAGE_CAPS,
  STARTING_POPULATION,
} from '../src/generated/gameBalance.ts';
import { resolveWorldDimensions } from '../src/world/worldGenerationSettings.ts';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

assert.equal(BUILDING_DEFINITIONS.founders_camp.acceptsLabor, false);
assert.equal(BUILDING_DEFINITIONS.founders_camp.requiresRoad, false);
assert.equal(BUILDING_COSTS.founders_camp.timber, 0);
assert.ok(BUILDING_STORAGE_CAPS.founders_camp.timber >= 100);
assert.ok(BUILDING_STORAGE_CAPS.founders_camp.stone >= 50);
assert.equal(
  constructionSourcePriority({ id: 'camp', kind: 'founders_camp', assignedLabor: 0 }),
  4,
  'an unstaffed founding yard shares the storehouse source class and uses free haulers',
);

const mesh = createBuildingMesh('founders_camp');
assert.equal(mesh.name, "Founders' camp and open stockyard");
const shelters = mesh.getObjectByName('FoundingShelters');
const timber = mesh.getObjectByName('FoundingTimberStockpile');
const stone = mesh.getObjectByName('FoundingStoneStockpile');
const chest = mesh.getObjectByName('FoundingTreasuryChest');
const campfire = mesh.getObjectByName(FOUNDERS_CAMPFIRE_NAME);
assert.ok(shelters instanceof THREE.Group);
assert.ok(timber instanceof THREE.Group);
assert.ok(stone instanceof THREE.Group);
assert.ok(chest instanceof THREE.Group);
assert.ok(campfire instanceof THREE.Group);
assert.equal(mesh.userData.fpCollisionChildrenOnly, true);
const tents = shelters.children.filter((child) => child.name === 'Founding canvas tent');
assert.equal(tents.length, 3, 'the occupied camp should have three modeled canvas tents');
assert.ok(
  tents.every((tent) => tent.userData.fpCollisionAggregate === true),
  'first-person collision should be attached to each tent rather than the whole campsite',
);
const shadowCasters: THREE.Object3D[] = [];
mesh.traverse((object) => {
  if (isBuildingDetailShadowCaster(object)) shadowCasters.push(object);
});
assert.ok(
  shadowCasters.length >= 30,
  'visible camp objects should cast their own silhouettes instead of using one blockout box',
);
const campfireLight = campfire.getObjectByName(FIRE_EFFECT_LIGHT_NAME);
assert.ok(campfireLight instanceof THREE.PointLight);
assert.equal(
  campfireLight.distance,
  23,
  'the founding fire should cast a readable practical-light pool across the occupied camp',
);
assert.ok(
  campfire.children.some((child) => child.name === FIRE_EFFECT_FLAMES_NAME),
  'the founders need the reusable procedural flame effect',
);
assert.ok(
  campfire.children.some((child) => child.name === FIRE_EFFECT_SMOKE_NAME),
  'the reusable campfire effect should emit animated smoke',
);
const flame = campfire.getObjectByName('Animated fire flame');
assert.ok(flame instanceof THREE.Sprite);
assert.ok(
  (flame.material as THREE.Material).name.includes('Procedural reusable fire shader'),
  'camp flames should use the shared GPU fire shader',
);
let hasConeFlame = false;
campfire.traverse((object) => {
  const candidate = object as THREE.Mesh;
  hasConeFlame ||= candidate.name.startsWith('Animated fire')
    && candidate.geometry instanceof THREE.ConeGeometry;
});
assert.equal(hasConeFlame, false, 'the campfire should not regress to cone-shaped flames');
setFoundersCampfireNightLighting(campfire, 0);
animateFoundersCampfire(campfire, 0.1);
const daylightIntensity = campfireLight.intensity;
const daylightFlameScale = flame.scale.y;
setFoundersCampfireNightLighting(campfire, 1);
animateFoundersCampfire(campfire, 0.13);
assert.ok(
  campfireLight.intensity > daylightIntensity + 12,
  'the campfire must keep a strong warm light throughout the night',
);
assert.notEqual(
  flame.scale.y,
  daylightFlameScale,
  'the campfire flame should visibly flicker',
);
const townHallMesh = createBuildingMesh('town_hall');
assert.ok(
  townHallMesh.getObjectByName('TownHallTreasuryChest') instanceof THREE.Group,
  'the civic treasury must have a visible lockbox at the Town Hall',
);
assert.equal(
  timber.children.filter((child) => child.name === 'FoundingTimberSegment').length,
  FOUNDING_TIMBER_VISUAL_SEGMENTS,
);
assert.equal(
  stone.children.filter((child) => child.name === 'FoundingStoneSegment').length,
  FOUNDING_STONE_VISUAL_SEGMENTS,
);
assert.equal(
  stockpileVisualLevel(1, BUILDING_STORAGE_CAPS.founders_camp.timber, FOUNDING_TIMBER_VISUAL_SEGMENTS),
  1,
);
assert.equal(
  stockpileVisualLevel(0, BUILDING_STORAGE_CAPS.founders_camp.stone, FOUNDING_STONE_VISUAL_SEGMENTS),
  0,
);

const world = createWorldLayout();
const siteA = selectFoundingSite(world, (x, z) => x * 0.002 + z * -0.001);
const siteB = selectFoundingSite(world, (x, z) => x * 0.002 + z * -0.001);
const visualQaFixture = createVisualQaFoundersCampFixture(
  world,
  (x, z) => x * 0.002 + z * -0.001,
);
assert.equal(visualQaFixture.id, VISUAL_QA_FOUNDERS_CAMP_ID);
assert.deepEqual(
  { x: visualQaFixture.x, z: visualQaFixture.z },
  siteA,
  'visual-QA fixture must reuse deterministic founding-site selection',
);
assert.equal(
  withVisualQaFoundersCamp([], visualQaFixture)[0],
  visualQaFixture,
  'empty visual-QA snapshots must receive the presentation-only camp',
);
const repeatedVisualQaBuildings = withVisualQaFoundersCamp(
  withVisualQaFoundersCamp([], visualQaFixture),
  visualQaFixture,
);
assert.equal(
  repeatedVisualQaBuildings.filter(
    (building) => building.kind === 'founders_camp',
  ).length,
  1,
  'repeated disconnected visual-QA syncs must keep one stable camp',
);
const authoritativeCamp = {
  ...visualQaFixture,
  id: 'authoritative-founders-camp',
};
assert.deepEqual(
  withVisualQaFoundersCamp([authoritativeCamp], visualQaFixture),
  [authoritativeCamp],
  'an authoritative founders camp must replace the visual-QA fixture',
);
const emptyVisualQaState = gameState(true, 0);
const visualQaPresentationState = withVisualQaFoundersCampState(
  emptyVisualQaState,
  visualQaFixture,
);
assert.equal(emptyVisualQaState.buildings.size, 0,
  'the visual-QA fixture must not mutate authoritative GameState');
assert.deepEqual(
  {
    timber: computeResourceTotals(visualQaPresentationState).timber,
    stone: computeResourceTotals(visualQaPresentationState).stone,
  },
  { timber: 160, stone: 140 },
  'visual-QA HUD totals must include the presentation-only camp supplies',
);
const authoritativeState = gameState(true, 0);
authoritativeState.buildings.set(authoritativeCamp.id, authoritativeCamp);
assert.equal(
  withVisualQaFoundersCampState(authoritativeState, visualQaFixture),
  authoritativeState,
  'an authoritative camp must keep its original presentation state',
);
assert.deepEqual(siteA, siteB, 'the village origin must be deterministic for a world seed');
const dims = resolveWorldDimensions(world.settings.mapSize);
assert.ok(Math.abs(siteA.x) < dims.playableHalf - 18);
assert.ok(Math.abs(siteA.z) < dims.playableHalf - 18);
const river = RiverField.fromLayout({
  bounds: Terrain.fullBounds(dims.terrainSize),
  layout: world.riverLayout,
});
assert.equal(river.isBlockedForProps(siteA.x, siteA.z), false);
assert.equal(world.quarryLayout.isBlockedForProps(siteA.x, siteA.z), false);

const physicalThree = gameState(true, 3);
assert.equal(computePopulationStats(physicalThree).total, STARTING_POPULATION);
assert.equal(computePopulationStats(gameState(true, 7)).total, 7);
assert.equal(
  computePopulationStats(gameState(false, 3)).total,
  STARTING_POPULATION + 3,
  'legacy saves retain additive population accounting',
);

const physicalStock = gameState(true, 0);
physicalStock.stockpile.gold = 2;
physicalStock.buildings.set('camp', {
  id: 'camp',
  kind: 'founders_camp',
  x: 0,
  z: 0,
  workRadius: 0,
  actionCooldown: 0,
  constructionComplete: true,
  foundingShelterActive: true,
  timber: 70,
  firewood: 0,
  stone: 30,
  water: 0,
  food: 0,
  grain: 0,
  flour: 0,
  ale: 0,
  preservedFood: 0,
  honey: 0,
  wine: 0,
  wool: 0,
  cloth: 0,
  ironwork: 0,
  polearms: 0,
  gold: 18,
  waterCapacity: 0,
  assignedLabor: 0,
  constructionProgress: 1,
  constructionRequiredTimber: 0,
  constructionRequiredStone: 0,
  constructionDeliveredTimber: 0,
  constructionDeliveredStone: 0,
  constructionReservedTimber: 0,
  constructionReservedStone: 0,
  constructionTreasuryTimber: 0,
  constructionTreasuryStone: 0,
  storehouseAcceptsTimber: true,
  storehouseAcceptsStone: true,
  storehouseAcceptsFirewood: true,
} satisfies BuildingState);
const totals = computeResourceTotals(physicalStock);
assert.equal(totals.timber, 70);
assert.equal(totals.stone, 30);
assert.equal(totals.gold, 20, 'physical lockbox gold remains part of settlement totals');
const camp = physicalStock.buildings.get('camp')!;
const emptyTownHall = {
  ...camp,
  id: 'hall',
  kind: 'town_hall',
  gold: 0,
} satisfies BuildingState;
const fundedTownHall = { ...emptyTownHall, gold: 1 } satisfies BuildingState;
assert.notEqual(
  buildingMarkerSignatures(new Map([['hall', emptyTownHall]])).visual,
  buildingMarkerSignatures(new Map([['hall', fundedTownHall]])).visual,
  'crossing zero gold must refresh the Town Hall chest visual',
);

const clearedCamp = {
  ...camp,
  foundingShelterActive: false,
  timber: 48,
  stone: 12,
  firewood: 8,
} satisfies BuildingState;
const farStorehouse = {
  ...camp,
  id: '20',
  kind: 'village_storehouse',
  x: 80,
  z: 0,
  foundingShelterActive: false,
  timber: 0,
  stone: 0,
  firewood: 0,
  storehouseTimberTargetPercent: 100,
  storehouseStoneTargetPercent: 100,
  storehouseFirewoodTargetPercent: 100,
} satisfies BuildingState;
const nearStorehouse = {
  ...farStorehouse,
  id: '9',
  x: 24,
} satisfies BuildingState;
const relocationState = {
  ...physicalStock,
  buildings: new Map([
    [clearedCamp.id, clearedCamp],
    [farStorehouse.id, farStorehouse],
    [nearStorehouse.id, nearStorehouse],
  ]),
  residences: new Map<string, ResidenceState>(),
  deliveryTrips: new Map(),
} satisfies GameState;
const relocation = planFoundingStockyardRelocation({
  state: relocationState,
  camp: clearedCamp,
  availableLabor: 1,
  roadPathDistance: (ax, _az, bx) => Math.abs(bx - ax),
});
assert.equal(relocation.blocker, 'ready');
assert.equal(relocation.commodity, 'timber');
assert.equal(relocation.targetBuildingId, nearStorehouse.id);
assert.equal(relocation.targetRoom, 48);
assert.equal(relocation.routeDistance, 24);

const occupiedCampPlan = planFoundingStockyardRelocation({
  state: relocationState,
  camp: { ...clearedCamp, foundingShelterActive: true },
  availableLabor: 1,
  roadPathDistance: () => 1,
});
assert.equal(
  occupiedCampPlan.blocker,
  'shelters',
  'founding goods should remain at the occupied camp until its people are rehoused',
);

const targetFullStorehouse = {
  ...nearStorehouse,
  timber: BUILDING_STORAGE_CAPS.village_storehouse.timber * 0.25,
  storehouseTimberTargetPercent: 25,
  storehouseAcceptsStone: false,
  storehouseAcceptsFirewood: false,
} satisfies BuildingState;
const targetFullState = {
  ...relocationState,
  buildings: new Map([
    [clearedCamp.id, { ...clearedCamp, stone: 0, firewood: 0 }],
    [targetFullStorehouse.id, targetFullStorehouse],
  ]),
} satisfies GameState;
assert.equal(
  planFoundingStockyardRelocation({
    state: targetFullState,
    camp: targetFullState.buildings.get(clearedCamp.id)!,
    availableLabor: 1,
    roadPathDistance: () => 20,
  }).blocker,
  'target-full',
  'a low collection ceiling must remain a meaningful stockyard-clearance decision',
);

const reservedSite = {
  ...farStorehouse,
  id: 'worksite',
  kind: 'well',
  constructionComplete: false,
  constructionReservedTimber: clearedCamp.timber,
  constructionTreasuryTimber: 0,
} satisfies BuildingState;
const reservedState = {
  ...relocationState,
  buildings: new Map([
    [clearedCamp.id, { ...clearedCamp, stone: 0, firewood: 0 }],
    [nearStorehouse.id, nearStorehouse],
    [reservedSite.id, reservedSite],
  ]),
} satisfies GameState;
assert.equal(
  planFoundingStockyardRelocation({
    state: reservedState,
    camp: reservedState.buildings.get(clearedCamp.id)!,
    availableLabor: 1,
    roadPathDistance: () => 20,
  }).blocker,
  'reserved',
  'off-road construction reservations must remain at the camp instead of being silently relocated',
);

const bootstrapServer = read('server/src/reducers/bootstrap.rs');
assert.match(bootstrapServer, /physical_founding_site_enabled/);
assert.match(bootstrapServer, /kind: "founders_camp"/);
assert.match(bootstrapServer, /resources\.timber = 0\.0/);
assert.match(bootstrapServer, /tree_entity\(\)\.tree_id\(\)\.delete/);
assert.match(bootstrapServer, /next_available_building_id\(ctx, config\.next_building_id\)/);
assert.match(
  bootstrapServer,
  /insert\(Building \{[\s\S]*?id: building_id,/,
  'a founding camp must use the world building ID counter instead of an auto-increment sentinel',
);
const buildingReducer = read('server/src/reducers/buildings.rs');
assert.match(buildingReducer, /fn next_available_building_id/);
assert.match(buildingReducer, /while ctx\.db\.building\(\)\.id\(\)\.find\(&candidate\)\.is_some\(\)/);
assert.match(
  buildingReducer,
  /let building_id = next_available_building_id\(ctx, config\.next_building_id\)\?;/,
  'ordinary building placement must share the collision-safe allocator',
);

const constructionServer = read('server/src/simulation/construction.rs');
assert.match(
  constructionServer,
  /source\.kind == "founders_camp"/,
  'founding handcarts must be allowed to leave the road network',
);
const foundingLifecycle = read('server/src/simulation/founding_site.rs');
assert.match(foundingLifecycle, /housed >= STARTING_POPULATION/);
assert.match(foundingLifecycle, /"town_hall"/);
assert.match(foundingLifecycle, /"village_storehouse"/);
assert.match(foundingLifecycle, /building_has_active_trip/);
assert.match(foundingLifecycle, /available_free_haulers/);
assert.match(foundingLifecycle, /try_start_building_supply_trip/);
assert.match(foundingLifecycle, /CommodityKind::Gold/);
assert.match(foundingLifecycle, /try_start_stockyard_relocation/);
assert.match(foundingLifecycle, /storehouse_filtered_collection_headroom/);
assert.match(foundingLifecycle, /building_has_inbound_supply_trip/);
assert.match(foundingLifecycle, /relocatable_stock/);
assert.doesNotMatch(
  foundingLifecycle,
  /town_hall\.gold \+= site\.gold|site\.gold = 0\.0/,
  'the founders’ lockbox must not teleport into the civic treasury',
);
const simulationReducer = read('server/src/reducers/simulation.rs');
assert.match(simulationReducer, /step_founding_sites\(ctx, &tick, &clock\)/);
const foundersInspector = read('src/resources/inspector/foundersCampRenderer.ts');
assert.match(foundersInspector, /connect the camp and Town Hall by road/);
assert.match(foundersInspector, /awaiting the next free hauler/);
assert.match(foundersInspector, /Permanent storage/);
assert.match(foundersInspector, /planFoundingStockyardRelocation/);
const buildingMarkersSource = read('src/buildings/BuildingMarkers.ts');
assert.match(
  buildingMarkersSource,
  /building\.kind === 'founders_camp'\s*&& building\.foundingShelterActive !== false[\s\S]*?this\.foundersCampfires\.add/,
  'a struck camp must not keep an invisible fire effect in the per-frame animation set',
);
const appSource = read('src/app/App.ts');
assert.match(
  appSource,
  /const presentationState = this\.getVisualQaPresentationState\(this\.gameState\);[\s\S]*?syncPlacedBuildingTerrain\(\{[\s\S]*?gameState: presentationState,[\s\S]*?forceMeshUpdate: true,[\s\S]*?\}\);\s*\/\/ Terrain sync[\s\S]*?this\.syncVisualQaFoundersCampFixture\(\);/,
  'visual-QA terrain replay must flatten the fixture site and preserve its marker',
);
assert.match(
  appSource,
  /if \(this\.visualQaConditions\) \{[\s\S]*?this\.sessionLifecycle\.onReady\(\);[\s\S]*?\} else \{\s*this\.gameRuntime\.start\(\);\s*\}/,
  'visual-QA capture mode must become presentation-ready without starting GameRuntime',
);
assert.match(
  appSource,
  /if \(!this\.visualQaConditions\) \{\s*session\.spacetimeStore\.setConnectErrorListener/,
  'visual-QA capture mode must not install the SpacetimeDB reconnect/error path',
);
assert.match(
  appSource,
  /const offlineSnapshot = \{[\s\S]*?\.\.\.session\.spacetimeStore\.snapshot,[\s\S]*?connected: true,[\s\S]*?this\.settlementPresentation\.sync\([\s\S]*?offlineSnapshot,[\s\S]*?this\.getVisualQaPresentationState\(this\.gameState\),[\s\S]*?true,/,
  'offline visual-QA must anchor the preset clock and lighting without connecting',
);
assert.match(
  appSource,
  /if \(!this\.visualQaConditions \|\| this\.gameState\.trees\.size > 0\) \{\s*this\.forestVisualSync\.syncAll\(this\.gameState\.trees\);\s*\}/,
  'offline visual-QA must not hide generated trees with an empty replicated tree map',
);
const townHallInspector = read('src/resources/inspector/townHallRenderer.ts');
assert.match(townHallInspector, /Treasury chest/);
assert.match(townHallInspector, /incoming by handcart/);

const perfBuildings = new Map<string, BuildingState>([
  [clearedCamp.id, clearedCamp],
]);
for (let index = 100_000; index > 0; index -= 1) {
  const id = String(index);
  perfBuildings.set(id, {
    ...nearStorehouse,
    id,
    x: index,
  });
}
const perfState = {
  ...relocationState,
  buildings: perfBuildings,
} satisfies GameState;
const relocationStarted = performance.now();
const perfRelocation = planFoundingStockyardRelocation({
  state: perfState,
  camp: clearedCamp,
  availableLabor: 1,
  roadPathDistance: (ax, _az, bx) => Math.abs(bx - ax),
});
const relocationElapsedMs = performance.now() - relocationStarted;
assert.equal(perfRelocation.targetBuildingId, '1');
assert.ok(
  relocationElapsedMs < 1_000,
  `100k-storehouse founding relocation plan took ${relocationElapsedMs.toFixed(1)}ms`,
);

function gameState(physical: boolean, housed: number): GameState {
  const residences = new Map<string, ResidenceState>();
  if (housed > 0) {
    residences.set('home', {
      id: 'home',
      abandoned: false,
      population: housed,
      populationCapacity: housed,
    } as ResidenceState);
  }
  return {
    seed: 1,
    tick: 0,
    physicalFoundingSiteEnabled: physical,
    stockpile: createEmptyStockpile(),
    quarries: new Map(),
    foragingNodes: new Map(),
    trees: new Map(),
    buildings: new Map(),
    farmFields: new Map(),
    pastures: new Map(),
    livestockHerds: new Map(),
    burgageZones: new Map(),
    residences,
    backyardGardens: new Map(),
    deliveryTrips: new Map(),
    fireIncidents: new Map(),
    nextBuildingId: 1,
  };
}

console.log(
  `Founding-site logistics, population migration, placement, and visual checks passed `
  + `(${relocationElapsedMs.toFixed(1)}ms for 100k relocation candidates).`,
);
