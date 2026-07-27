import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import { buildingMarkerSignatures } from '../src/buildings/buildingMarkerSignature.ts';
import {
  FOUNDING_STONE_VISUAL_SEGMENTS,
  FOUNDING_TIMBER_VISUAL_SEGMENTS,
  stockpileVisualLevel,
} from '../src/buildings/buildingStockpileVisuals.ts';
import { constructionSourcePriority } from '../src/logistics/constructionLogistics.ts';
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
assert.ok(shelters instanceof THREE.Group);
assert.ok(timber instanceof THREE.Group);
assert.ok(stone instanceof THREE.Group);
assert.ok(chest instanceof THREE.Group);
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
const townHallInspector = read('src/resources/inspector/townHallRenderer.ts');
assert.match(townHallInspector, /Treasury chest/);
assert.match(townHallInspector, /incoming by handcart/);

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

console.log('Founding-site logistics, population migration, placement, and visual checks passed.');
