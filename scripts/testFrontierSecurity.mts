import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import {
  countSitesProtectedByWatchtower,
  estimatedRaidDays,
  frontierThreatLabel,
  watchtowerEffectiveRadius,
  type SettlementSecurityState,
} from '../src/security/frontierSecurity.ts';
import type { BuildingState, GameState, ResidenceState } from '../src/resources/types.ts';
import {
  DEFAULT_WORLD_GENERATION_SETTINGS,
  normalizeWorldGenerationSettings,
} from '../src/world/worldGenerationSettings.ts';
import { BUILDING_DEFINITIONS } from '../src/generated/gameBalance.ts';

const legacySettings = normalizeWorldGenerationSettings({
  seed: 7,
  mapSize: 'medium',
  topography: 50,
  hydrology: 50,
  forestDensity: 50,
});
assert.equal(legacySettings.conflictMode, 'peaceful');
assert.equal(legacySettings.enemyPressure, 0);

const frontierSettings = normalizeWorldGenerationSettings({
  ...DEFAULT_WORLD_GENERATION_SETTINGS,
  conflictMode: 'frontier',
  enemyPressure: 65,
});
assert.equal(frontierSettings.conflictMode, 'frontier');
assert.equal(frontierSettings.enemyPressure, 65);
assert.equal(normalizeWorldGenerationSettings({
  ...frontierSettings,
  conflictMode: 'peaceful',
}).enemyPressure, 0);

assert.equal(BUILDING_DEFINITIONS.watchtower.requiresHillside, true);
assert.equal(BUILDING_DEFINITIONS.watchtower.requiresRoad, true);
assert.equal(BUILDING_DEFINITIONS.watchtower.maxLabor, 2);
assert.equal(BUILDING_DEFINITIONS.watchtower.workRadius, 190);
assert.equal(BUILDING_DEFINITIONS.guardhouse.requiresRoad, true);
assert.equal(BUILDING_DEFINITIONS.guardhouse.maxLabor, 6);

const tower = building('tower', 'watchtower', 0, 0, 1);
assert.equal(Math.round(watchtowerEffectiveRadius(tower)), 148);
assert.equal(watchtowerEffectiveRadius({ ...tower, assignedLabor: 2 }), 190);
assert.equal(watchtowerEffectiveRadius({ ...tower, assignedLabor: 0 }), 0);

const state = emptyGameState();
state.buildings.set(tower.id, tower);
state.buildings.set('inside-store', building('inside-store', 'village_storehouse', 120, 0, 1));
state.buildings.set('outside-store', building('outside-store', 'village_storehouse', 170, 0, 1));
state.residences.set('inside-home', residence('inside-home', 80, 0, 3));
state.residences.set('outside-home', residence('outside-home', 180, 0, 4));
assert.deepEqual(countSitesProtectedByWatchtower(tower, state), {
  buildings: 1,
  homes: 1,
  residents: 3,
});

const security: SettlementSecurityState = {
  threat: 0.76,
  coverage: 0.5,
  protectedValue: 10,
  totalValue: 20,
  staffedWatchtowers: 1,
  readyGuards: 4.5,
  defenseReadiness: 0.75,
  nextRaidTick: 18_000,
  lastRaidTick: 0,
  lastOutcome: 'none',
  lastGoodsLost: 0,
  lastWealthLost: 0,
};
assert.equal(frontierThreatLabel(security, frontierSettings), 'Raiders reported');
assert.equal(frontierThreatLabel(security, legacySettings), 'Peaceful settlement');
assert.equal(estimatedRaidDays(security, 0), 30);

const mesh = createBuildingMesh('watchtower');
let meshCount = 0;
let maxY = 0;
mesh.traverse((object) => {
  if (!('isMesh' in object) || !(object as { isMesh?: boolean }).isMesh) return;
  meshCount += 1;
  maxY = Math.max(maxY, object.position.y);
});
assert.ok(meshCount >= 30, 'watchtower should have a legible braced structure, gallery, roof, ladder, and bell');
assert.ok(maxY >= 10, 'watchtower silhouette should read above village roofs');

const guardhouseMesh = createBuildingMesh('guardhouse');
let guardhouseMeshCount = 0;
let guardhouseMaxY = 0;
guardhouseMesh.traverse((object) => {
  if (!('isMesh' in object) || !(object as { isMesh?: boolean }).isMesh) return;
  guardhouseMeshCount += 1;
  guardhouseMaxY = Math.max(guardhouseMaxY, object.position.y);
});
assert.ok(guardhouseMeshCount >= 35, 'guardhouse should show lodging, drill shelter, polearm rack, stores, and a modest palisade');
assert.ok(guardhouseMaxY >= 5, 'guardhouse needs a readable steep-roof silhouette');

const setupPanel = readFileSync('src/ui/WorldSetupPanel.ts', 'utf8');
const toolbar = readFileSync('src/ui/BuildToolbar.ts', 'utf8');
const serverSimulation = readFileSync('server/src/simulation/settlement_security.rs', 'utf8');
const frontierEconomy = readFileSync('server/src/frontier_economy_policy.rs', 'utf8');
const serverPolicy = readFileSync('server/src/security_policy.rs', 'utf8');
assert.match(setupPanel, /Peaceful settlement/);
assert.match(setupPanel, /Contested frontier/);
assert.match(setupPanel, /enemy pressure/i);
assert.match(toolbar, /MILITARY_BUILD_MENU_ENTRIES/);
assert.match(toolbar, /setConflictEnabled/);
assert.match(serverSimulation, /SECURITY_UPDATE_INTERVAL_TICKS/);
assert.match(serverSimulation, /position_is_watched/);
assert.match(serverSimulation, /settlement_guard_strength/);
assert.match(serverSimulation, /guarded_raid_target_count/);
assert.match(serverSimulation, /plunder!\(polearms\)/);
assert.match(frontierEconomy, /CARPENTER_TIMBER_PER_POLEARM/);
assert.match(frontierEconomy, /GUARDHOUSE_WAGE_PER_GUARD_PER_DAY/);
assert.match(readFileSync('server/src/simulation/expanded_economy.rs', 'utf8'), /guard_upkeep/);
assert.match(serverPolicy, /RAID_SEASON_START_MONTH:\s*u32\s*=\s*4/);
assert.match(serverPolicy, /RAID_SEASON_END_MONTH:\s*u32\s*=\s*10/);
assert.ok(
  statSync('public/assets/ui/build-menu/cards/watchtower.webp').size > 20_000,
  'watchtower needs a finished construction-menu card',
);
assert.ok(
  statSync('public/assets/ui/build-menu/cards/guardhouse.webp').size > 20_000,
  'guardhouse needs a finished construction-menu card',
);
assert.ok(
  statSync('public/assets/models/worker-tools/quaternius-spear.glb').size > 100_000,
  'guard drills need the audited CC0 spear model',
);

const perfState = emptyGameState();
const staffedTower = { ...tower, assignedLabor: 2 };
for (let index = 0; index < 10_000; index += 1) {
  perfState.buildings.set(
    `perf-${index}`,
    building(`perf-${index}`, 'village_storehouse', index % 500, Math.floor(index / 500) * 8, 1),
  );
}
const started = performance.now();
const perfCoverage = countSitesProtectedByWatchtower(staffedTower, perfState);
const elapsedMs = performance.now() - started;
assert.ok(perfCoverage.buildings > 0);
assert.ok(elapsedMs < 250, `10,000-site client coverage readout took ${elapsedMs.toFixed(1)} ms`);

console.log(`frontier security tests passed (${elapsedMs.toFixed(1)} ms for 10,000-site inspector scan)`);

function building(
  id: string,
  kind: BuildingState['kind'],
  x: number,
  z: number,
  assignedLabor: number,
): BuildingState {
  return {
    id,
    kind,
    x,
    z,
    workRadius: kind === 'watchtower' ? 190 : 0,
    actionCooldown: 0,
    timber: 0,
    firewood: 0,
    stone: 0,
    water: 0,
    food: 0,
    grain: 0,
    flour: 0,
    ale: 0,
    preservedFood: 0,
    honey: 0,
    wine: 0,
    polearms: 0,
    gold: 0,
    waterCapacity: 0,
    assignedLabor,
    constructionComplete: true,
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
  };
}

function residence(id: string, x: number, z: number, population: number): ResidenceState {
  return {
    id,
    zoneId: 'zone',
    parcelIndex: 0,
    x,
    z,
    yaw: 0,
    population,
    populationCapacity: population,
    tier: 1,
    settlementTicks: 0,
    needs: {
      firewood: { stock: 0, deficitSeconds: 0 },
      water: { stock: 0, deficitSeconds: 0 },
      food: { stock: 0, deficitSeconds: 0 },
      preservedFood: { stock: 0, deficitSeconds: 0 },
      ale: { stock: 0, deficitSeconds: 0 },
    },
    abandoned: false,
    householdWealth: 0,
  };
}

function emptyGameState(): GameState {
  return {
    seed: 1,
    tick: 0,
    stockpile: {
      timber: 0,
      stone: 0,
      firewood: 0,
      water: 0,
      game: 0,
      berries: 0,
      mushrooms: 0,
      fish: 0,
      food: 0,
      grain: 0,
      flour: 0,
      ale: 0,
      preservedFood: 0,
      honey: 0,
      wine: 0,
      polearms: 0,
      gold: 0,
    },
    quarries: new Map(),
    foragingNodes: new Map(),
    trees: new Map(),
    buildings: new Map(),
    farmFields: new Map(),
    pastures: new Map(),
    livestockHerds: new Map(),
    burgageZones: new Map(),
    residences: new Map(),
    backyardGardens: new Map(),
    deliveryTrips: new Map(),
    fireIncidents: new Map(),
    nextBuildingId: 1,
  };
}
