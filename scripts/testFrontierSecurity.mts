import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { BuildingMarkers } from '../src/buildings/BuildingMarkers.ts';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import { validateBuildingPlacement } from '../src/buildings/BuildingPlacementValidation.ts';
import { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import { FrontierRiskMarkers } from '../src/security/FrontierRiskMarkers.ts';
import {
  handleDockHotkey,
  type DockToggle,
} from '../src/ui/constructionDockToggle.ts';
import {
  armedGuardCount,
  computeGuardhouseMusterPlan,
  computeRefugeShelterPlan,
  countHouseholdsShelteredByPalisadedRefuge,
  countSitesProtectedByWatchtower,
  estimatedRaidDays,
  formatFrontierForecast,
  formatFrontierRaidTiming,
  formatProjectedRaidTargets,
  formatRaidReport,
  FRONTIER_SECURITY_UPDATE_INTERVAL_TICKS,
  frontierDefenseFireSignature,
  frontierThreatLabel,
  getGuardhouseMusterState,
  guardhouseFoodReserveLabel,
  guardhouseFoodRunwayDays,
  guardhouseFoodTarget,
  guardhouseMusterEfficiency,
  guardhouseMusterResponseDistance,
  guardhouseMusterResponseBand,
  isFrontierAlertActive,
  isFrontierRaidSeason,
  isPalisadedRefugeRallyActive,
  normalizeGuardhouseMusterWatchtowerId,
  palisadedRefugeEffectiveRadius,
  projectRaidTargets,
  projectedRaidArsonChance,
  raidTargetCanShelter,
  normalizeGuardhouseFoodReserve,
  selectCriticalGuardhouseFoodTarget,
  selectGuardhouseMusterWatchIndex,
  watchtowerEffectiveRadius,
  GUARDHOUSE_CRITICAL_FOOD_RUNWAY_DAYS,
  GUARDHOUSE_FOOD_RESERVE_DEEP,
  GUARDHOUSE_FOOD_RESERVE_LEAN,
  GUARDHOUSE_FOOD_RESERVE_STANDARD,
  WATCH_COVERAGE_CELL_SIZE,
  type SettlementSecurityState,
} from '../src/security/frontierSecurity.ts';
import type { BuildingState, GameState, ResidenceState } from '../src/resources/types.ts';
import type { FireIncidentState } from '../src/fires/fireIncident.ts';
import type { DeliveryTripState } from '../src/logistics/deliveryTrips.ts';
import {
  DEFAULT_WORLD_GENERATION_SETTINGS,
  normalizeWorldGenerationSettings,
} from '../src/world/worldGenerationSettings.ts';
import {
  formatLiveCombatSummary,
  guardCompanyIssuedPolearms,
  guardCompanyRosterSummary,
  guardRecoveryRemainingDays,
  guardRecoveryTicks,
  hasActiveRaiderThreat,
  isActiveRaiderThreat,
  type CombatAgentState,
} from '../src/security/combatAgents.ts';
import { syncActiveRaid } from '../src/security/activeRaid.ts';
import {
  BUILDING_DEFINITIONS,
  BUILDING_COSTS,
  BUILDING_STORAGE_CAPS,
  PALISADED_REFUGE_BREACH_SECONDS,
  PALISADED_REFUGE_RALLY_THREAT_THRESHOLD,
  PALISADED_REFUGE_RESIDENT_CAPACITY,
  SPRING_RAIN_ROAD_SPEED_MULTIPLIER,
} from '../src/generated/gameBalance.ts';

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
assert.equal(PALISADED_REFUGE_RESIDENT_CAPACITY, 32);
assert.equal(PALISADED_REFUGE_RALLY_THREAT_THRESHOLD, 0.7);
assert.equal(
  isFrontierAlertActive(
    { nextRaidTick: 10_000, threat: 0.7 },
    true,
    5,
  ),
  true,
);
assert.equal(
  isPalisadedRefugeRallyActive(
    { nextRaidTick: 10_000, threat: 0.7 },
    true,
    5,
  ),
  true,
  'the refuge compatibility helper must share the settlement alert rule',
);
assert.equal(
  isPalisadedRefugeRallyActive(
    { nextRaidTick: 10_000, threat: 0.699 },
    true,
    5,
  ),
  false,
);
assert.equal(
  isPalisadedRefugeRallyActive(
    { nextRaidTick: 10_000, threat: 0.95 },
    true,
    1,
  ),
  false,
  'winter campaign pauses must not keep families crowded into refuges',
);
assert.equal(
  isPalisadedRefugeRallyActive(
    { nextRaidTick: 10_000, threat: 0.95 },
    false,
    5,
  ),
  false,
  'peaceful worlds must never start a civilian rally',
);
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
assert.equal(BUILDING_DEFINITIONS.palisaded_refuge.requiresRoad, true);
assert.equal(BUILDING_DEFINITIONS.palisaded_refuge.acceptsLabor, false);
assert.equal(BUILDING_DEFINITIONS.palisaded_refuge.workRadius, 68);
assert.deepEqual(BUILDING_COSTS.palisaded_refuge, {
  timber: 72,
  stone: 30,
});

const activeRaid = syncActiveRaid(
  [{
    owner: { toHexString: () => 'settlement-owner' },
    raidId: 42n,
    startedTick: 8_000n,
    enemyPressure: 65,
    initialRaiders: 7,
    initialGuards: 5,
    goodsLost: 1.25,
    wealthLost: 0.5,
    arsonStarted: false,
  } as never],
  'settlement-owner',
);
assert.deepEqual(activeRaid, {
  raidId: '42',
  startedTick: 8_000,
  enemyPressure: 65,
  initialRaiders: 7,
  initialGuards: 5,
  goodsLost: 1.25,
  wealthLost: 0.5,
  arsonStarted: false,
});
assert.equal(
  syncActiveRaid([], 'settlement-owner'),
  null,
  'the raid-result lifecycle clears when its server row is removed',
);
assert.equal(PALISADED_REFUGE_BREACH_SECONDS, 12);
assert.equal(raidTargetCanShelter('residence', true, true), true);
assert.equal(raidTargetCanShelter('residence', false, true), false);
for (const kind of ['building', 'cart', 'treasury'] as const) {
  assert.equal(
    raidTargetCanShelter(kind, true, true),
    false,
    `${kind} stock cannot carry itself into a civilian refuge`,
  );
}
const refugePlacementContext = {
  buildings: [] as BuildingState[],
  residences: [],
  burgageZones: [],
  farmFields: [],
  pastures: [],
  quarries: [],
  foragingNodes: [],
  stockpile: { timber: 500, stone: 500 },
  isWaterAt: () => false,
  getNaturalHeightAt: () => 0,
};
const noGuardRefugePlacement = validateBuildingPlacement(
  'palisaded_refuge',
  0,
  0,
  refugePlacementContext,
);
assert.equal(noGuardRefugePlacement.ok, false);
if (!noGuardRefugePlacement.ok) {
  assert.equal(noGuardRefugePlacement.reason, 'requires_completed_guardhouse');
}
const unfinishedGuardRefugePlacement = validateBuildingPlacement(
  'palisaded_refuge',
  0,
  0,
  {
    ...refugePlacementContext,
    buildings: [{
      ...building('unfinished-guard', 'guardhouse', 200, 0, 0),
      constructionComplete: false,
    }],
  },
);
assert.equal(unfinishedGuardRefugePlacement.ok, false);
if (!unfinishedGuardRefugePlacement.ok) {
  assert.equal(
    unfinishedGuardRefugePlacement.reason,
    'requires_completed_guardhouse',
  );
}
assert.deepEqual(
  validateBuildingPlacement('palisaded_refuge', 0, 0, {
    ...refugePlacementContext,
    buildings: new Map([
      [
        'completed-guard',
        building('completed-guard', 'guardhouse', 200, 0, 0),
      ],
    ]).values(),
  }),
  { ok: true },
);
assert.equal(GUARDHOUSE_CRITICAL_FOOD_RUNWAY_DAYS, 3);
assert.equal(WATCH_COVERAGE_CELL_SIZE, 128);
assert.equal(FRONTIER_SECURITY_UPDATE_INTERVAL_TICKS, 300);
assert.equal(isFrontierRaidSeason(3), false);
assert.equal(isFrontierRaidSeason(4), true);
assert.equal(isFrontierRaidSeason(10), true);
assert.equal(isFrontierRaidSeason(11), false);

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
state.fireIncidents.set('tower-fire', fire('tower-fire', tower.id));
assert.equal(watchtowerEffectiveRadius(tower, true), 0);
assert.deepEqual(
  countSitesProtectedByWatchtower(tower, state),
  { buildings: 0, homes: 0, residents: 0 },
  'a fire-disabled watchtower must lose its warning coverage until repaired',
);
assert.equal(frontierDefenseFireSignature(state), `watchtower:${tower.id}`);
state.fireIncidents.delete('tower-fire');

assert.equal(guardhouseMusterEfficiency(120), 1);
assert.equal(guardhouseMusterEfficiency(480), 0.825);
assert.equal(guardhouseMusterEfficiency(720), 0.65);
assert.equal(guardhouseMusterEfficiency(null), 0.4);
assert.equal(
  guardhouseMusterResponseDistance(190, SPRING_RAIN_ROAD_SPEED_MULTIPLIER),
  190 / SPRING_RAIN_ROAD_SPEED_MULTIPLIER,
);
assert.equal(guardhouseMusterEfficiency(190, SPRING_RAIN_ROAD_SPEED_MULTIPLIER), 1);
assert.ok(guardhouseMusterEfficiency(240, SPRING_RAIN_ROAD_SPEED_MULTIPLIER) < 1);
assert.equal(guardhouseMusterEfficiency(null, SPRING_RAIN_ROAD_SPEED_MULTIPLIER), 0.4);
assert.equal(guardhouseMusterResponseBand(1), 'full');
assert.equal(guardhouseMusterResponseBand(0.825), 'delayed');
assert.equal(guardhouseMusterResponseBand(0.65), 'weak');
assert.equal(normalizeGuardhouseMusterWatchtowerId(undefined), null);
assert.equal(normalizeGuardhouseMusterWatchtowerId('0'), null);
assert.equal(normalizeGuardhouseMusterWatchtowerId(' 42 '), '42');
assert.equal(
  selectGuardhouseMusterWatchIndex(
    null,
    [{ id: '20' }, { id: '10' }],
    [100, 100],
  ),
  1,
  'automatic equal-distance posts should use stable watch identity',
);
assert.equal(
  selectGuardhouseMusterWatchIndex(
    '20',
    [{ id: '20' }, { id: '10' }],
    [140, 90],
  ),
  0,
  'an explicit post should override a nearer watch',
);
assert.equal(
  selectGuardhouseMusterWatchIndex(
    '20',
    [{ id: '20' }, { id: '10' }],
    [null, 90],
  ),
  -1,
  'a severed explicit post must not silently fall back to another district',
);

const musterState = emptyGameState();
const musterTower = { ...tower, assignedLabor: 2 };
const guardhouse = {
  ...building('guardhouse', 'guardhouse', 400, 0, 4),
  actionCooldown: 1,
  polearms: 4,
};
assert.equal(armedGuardCount(6, 2.9), 2);
assert.equal(guardhouseFoodTarget(6, 0), 0);
assert.equal(guardhouseFoodTarget(6, 2.9), 12);
assert.equal(guardhouseFoodTarget(6, 6), 36);
assert.equal(
  guardhouseFoodTarget(6, 6, GUARDHOUSE_FOOD_RESERVE_LEAN),
  18,
);
assert.equal(
  guardhouseFoodTarget(6, 6, GUARDHOUSE_FOOD_RESERVE_DEEP),
  BUILDING_STORAGE_CAPS.guardhouse.food,
);
assert.equal(normalizeGuardhouseFoodReserve(undefined), GUARDHOUSE_FOOD_RESERVE_STANDARD);
assert.equal(normalizeGuardhouseFoodReserve(5), GUARDHOUSE_FOOD_RESERVE_STANDARD);
assert.equal(guardhouseFoodReserveLabel(GUARDHOUSE_FOOD_RESERVE_LEAN), 'Lean');
assert.equal(guardhouseFoodReserveLabel(GUARDHOUSE_FOOD_RESERVE_DEEP), 'Deep');
assert.ok(Math.abs(guardhouseFoodRunwayDays(6, 6, 8.1) - 3) < 1e-9);
assert.equal(guardhouseFoodRunwayDays(6, 0, 0), Infinity);
const emptyFarCompany = {
  ...building('empty-far-company', 'guardhouse', 80, 0, 6),
  polearms: 6,
  food: 0,
};
const lowNearCompany = {
  ...building('low-near-company', 'guardhouse', 10, 0, 6),
  polearms: 6,
  food: 1.35,
};
assert.equal(
  selectCriticalGuardhouseFoodTarget(
    [lowNearCompany, emptyFarCompany],
    'central-granary',
    (target) => target.x,
  )?.target.id,
  emptyFarCompany.id,
  'the lowest guard-food runway should beat the shorter route',
);
const equalNearCompany = { ...lowNearCompany, id: 'equal-near', x: 8 };
const equalFarCompany = { ...lowNearCompany, id: 'equal-far', x: 40 };
assert.equal(
  selectCriticalGuardhouseFoodTarget(
    [equalFarCompany, equalNearCompany],
    'central-granary',
    (target) => target.x,
  )?.target.id,
  equalNearCompany.id,
  'equal guard-food runway should prefer the shorter road route',
);
assert.equal(
  selectCriticalGuardhouseFoodTarget(
    [emptyFarCompany, lowNearCompany],
    'central-granary',
    (target) => target.x,
    (target) => target.id === emptyFarCompany.id,
  )?.target.id,
  lowNearCompany.id,
  'multiple granaries must skip a company with food already inbound',
);
assert.equal(
  selectCriticalGuardhouseFoodTarget(
    [{ ...emptyFarCompany, polearms: 0 }],
    'central-granary',
    (target) => target.x,
  ),
  null,
  'unarmed companies must not warehouse food they cannot consume',
);
const deepCriticalCompany = {
  ...emptyFarCompany,
  id: 'deep-critical-company',
  food: 1.35,
  guardhouseFoodReserve: GUARDHOUSE_FOOD_RESERVE_DEEP,
};
assert.equal(
  selectCriticalGuardhouseFoodTarget(
    [deepCriticalCompany],
    'central-granary',
    (target) => target.x,
  )?.desiredStock,
  72,
  'the selected reserve depth must change the authoritative destination fill ceiling',
);
musterState.buildings.set(musterTower.id, musterTower);
musterState.buildings.set(guardhouse.id, guardhouse);
const linkedMuster = getGuardhouseMusterState(
  guardhouse,
  musterState,
  (_ax, _az, bx) => bx === musterTower.x ? 480 : null,
);
assert.equal(linkedMuster.staffedTowers, 1);
assert.equal(linkedMuster.routeDistance, 480);
assert.equal(linkedMuster.linkedTowerId, musterTower.id);
assert.equal(linkedMuster.efficiency, 0.825);
assert.equal(linkedMuster.rawReady, 4);
assert.equal(linkedMuster.effectiveReady, 3.3);
assert.equal(
  getGuardhouseMusterState(
    guardhouse,
    musterState,
    () => {
      throw new Error('precomputed watch routes should avoid another path solve');
    },
    1,
    new Map([[musterTower.id, 480]]),
  ).linkedTowerId,
  musterTower.id,
);
const wetLinkedMuster = getGuardhouseMusterState(
  guardhouse,
  musterState,
  (_ax, _az, bx) => bx === musterTower.x ? 480 : null,
  SPRING_RAIN_ROAD_SPEED_MULTIPLIER,
);
assert.equal(wetLinkedMuster.roadSpeedMultiplier, SPRING_RAIN_ROAD_SPEED_MULTIPLIER);
assert.ok(
  Math.abs(
    (wetLinkedMuster.responseDistance ?? 0)
      - 480 / SPRING_RAIN_ROAD_SPEED_MULTIPLIER,
  ) < 1e-9,
);
assert.ok(wetLinkedMuster.effectiveReady < linkedMuster.effectiveReady);
const unlinkedMuster = getGuardhouseMusterState(guardhouse, musterState, () => null);
assert.equal(unlinkedMuster.linkedTowerId, null);
assert.equal(
  unlinkedMuster.effectiveReady,
  0,
  'an unlinked company must not reinforce a watch district on another road branch',
);
assert.equal(
  unlinkedMuster.emergencyEfficiency,
  0.4,
  'an unlinked company should retain the established local contact-response efficiency',
);
assert.equal(
  unlinkedMuster.emergencyReady,
  1.6,
  'armed guards must remain a visible physical reserve even without early warning',
);
musterState.fireIncidents.set('muster-watch-fire', fire('muster-watch-fire', musterTower.id));
const watchFireMuster = getGuardhouseMusterState(
  guardhouse,
  musterState,
  () => 480,
);
assert.equal(watchFireMuster.staffedTowers, 0);
assert.equal(watchFireMuster.linkedTowerId, null);
assert.equal(watchFireMuster.effectiveReady, 0);
musterState.fireIncidents.set('company-fire', fire('company-fire', guardhouse.id));
const companyFireMuster = getGuardhouseMusterState(
  guardhouse,
  musterState,
  () => 480,
);
assert.equal(companyFireMuster.fireDisabled, true);
assert.equal(companyFireMuster.rawReady, 0);
assert.equal(companyFireMuster.effectiveReady, 0);
assert.equal(companyFireMuster.emergencyReady, 0);
assert.equal(
  frontierDefenseFireSignature(musterState),
  `guardhouse:${guardhouse.id}|watchtower:${musterTower.id}`,
);
musterState.fireIncidents.clear();

const projectionState = emptyGameState();
projectionState.buildings.set(tower.id, tower);
projectionState.buildings.set(
  '10',
  { ...building('10', 'village_storehouse', 120, 0, 1), timber: 100 },
);
projectionState.buildings.set(
  '20',
  { ...building('20', 'village_storehouse', 170, 0, 1), timber: 30 },
);
projectionState.residences.set(
  '15',
  { ...residence('15', 180, 0, 4), householdWealth: 50 },
);
const projectedTargets = projectRaidTargets(projectionState, 2);
assert.deepEqual(
  projectedTargets.map((target) => [target.kind, target.id, target.protected]),
  [
    ['residence', '15', false],
    ['building', '20', false],
  ],
  'exposed targets should be preferred by value before richer watched stores',
);
assert.deepEqual(
  projectRaidTargets(projectionState, 3).map((target) => target.id),
  ['15', '20', '10'],
);
projectionState.fireIncidents.set('projection-watch-fire', fire(
  'projection-watch-fire',
  tower.id,
));
assert.deepEqual(
  projectRaidTargets(projectionState, 3).map(
    (target) => [target.id, target.protected],
  ),
  [['10', false], ['15', false], ['20', false]],
  'a burned watch must immediately expose holdings inside its former radius',
);
projectionState.fireIncidents.clear();
assert.match(formatProjectedRaidTargets(projectedTargets), /Current likely targets/);
assert.match(formatProjectedRaidTargets(projectedTargets), /exposed/);
assert.match(formatProjectedRaidTargets(projectedTargets), /raid value/);

const districtRoads = new RoadNetwork();
districtRoads.addRoadPath([
  new THREE.Vector3(-20, 0, 0),
  new THREE.Vector3(220, 0, 0),
]);
districtRoads.addRoadPath([
  new THREE.Vector3(-20, 0, 300),
  new THREE.Vector3(220, 0, 300),
]);
const districtState = emptyGameState();
const westWatch = building('west-watch', 'watchtower', 40, 0, 2);
const eastWatch = building('east-watch', 'watchtower', 40, 300, 2);
const westCompany = {
  ...building('west-company', 'guardhouse', 0, 0, 4),
  polearms: 4,
  actionCooldown: 1,
};
const richWestStore = {
  ...building('rich-west-store', 'village_storehouse', 100, 0, 1),
  timber: 200,
};
const leanEastStore = {
  ...building('lean-east-store', 'village_storehouse', 100, 300, 1),
  timber: 20,
};
for (const site of [
  westWatch,
  eastWatch,
  westCompany,
  richWestStore,
  leanEastStore,
]) {
  districtState.buildings.set(site.id, site);
}
const districtProjection = projectRaidTargets(districtState, 1, {
  enemyPressure: 50,
  roadNetwork: districtRoads,
});
assert.equal(
  districtProjection[0]?.id,
  leanEastStore.id,
  'a rich guarded branch must not hide a leaner watch district with no road-linked company',
);
assert.equal(districtProjection[0]?.protected, true);
assert.equal(districtProjection[0]?.localReadyGuards, 0);
assert.ok((districtProjection[0]?.estimatedLossFraction ?? 0) > 0);
assert.match(
  formatProjectedRaidTargets(districtProjection),
  /0 \/ 5\.8 district guards/,
);

const eastCompany = {
  ...building('east-company', 'guardhouse', 0, 300, 4),
  polearms: 4,
  actionCooldown: 1,
};
const unarmedCompany = {
  ...building('unarmed-company', 'guardhouse', 20, 0, 4),
  polearms: 0,
  actionCooldown: 1,
};
districtState.buildings.set(eastCompany.id, eastCompany);
districtState.buildings.set(unarmedCompany.id, unarmedCompany);
const balancedMusterPlan = computeGuardhouseMusterPlan(
  districtState,
  districtRoads,
);
assert.equal(balancedMusterPlan.staffedTowers, 2);
assert.equal(balancedMusterPlan.linkedGuardhouses, 2);
assert.equal(
  balancedMusterPlan.assignmentsByGuardhouse.has(unarmedCompany.id),
  false,
  'an unarmed company must not spend a road solve or enter the visible muster',
);
assert.equal(
  balancedMusterPlan.assignmentsByGuardhouse.get(westCompany.id)?.towerId,
  westWatch.id,
);
assert.equal(
  balancedMusterPlan.assignmentsByGuardhouse.get(eastCompany.id)?.towerId,
  eastWatch.id,
);
assert.equal(balancedMusterPlan.readinessByWatch.get(westWatch.id), 4);
assert.equal(balancedMusterPlan.readinessByWatch.get(eastWatch.id), 4);
const balancedDistrictProjection = projectRaidTargets(districtState, 1, {
  enemyPressure: 50,
  roadNetwork: districtRoads,
  guardhouseMusterPlan: balancedMusterPlan,
});
assert.equal(
  balancedDistrictProjection[0]?.id,
  richWestStore.id,
  'once both branches muster equally, the richer holding should again determine raid priority',
);
assert.ok((balancedDistrictProjection[0]?.localReadyGuards ?? 0) > 3.9);
districtState.fireIncidents.set(
  'east-watch-outage',
  fire('east-watch-outage', eastWatch.id),
);
const fireDisabledMusterPlan = computeGuardhouseMusterPlan(
  districtState,
  districtRoads,
);
assert.equal(
  fireDisabledMusterPlan.assignmentsByGuardhouse.has(eastCompany.id),
  false,
  'a company on a severed branch must not visibly answer a burning watch',
);
const fireDisabledDistrictProjection = projectRaidTargets(districtState, 1, {
  enemyPressure: 50,
  roadNetwork: districtRoads,
  guardhouseMusterPlan: fireDisabledMusterPlan,
});
assert.equal(
  fireDisabledDistrictProjection[0]?.id,
  leanEastStore.id,
  'a burning district watch must immediately expose its local branch',
);
assert.equal(fireDisabledDistrictProjection[0]?.protected, false);
assert.equal(fireDisabledDistrictProjection[0]?.localReadyGuards, 0);
assert.match(
  formatProjectedRaidTargets(fireDisabledDistrictProjection),
  /no warned guard district/,
);
districtState.fireIncidents.clear();

const tiedMusterRoads = new RoadNetwork();
tiedMusterRoads.addRoadPath([
  new THREE.Vector3(-100, 0, 0),
  new THREE.Vector3(100, 0, 0),
]);
const tiedMusterState = emptyGameState();
const laterTieWatch = building('watch-b', 'watchtower', -50, 0, 1);
const earlierTieWatch = building('watch-a', 'watchtower', 50, 0, 1);
const tiedCompany = {
  ...building('tie-company', 'guardhouse', 0, 0, 1),
  polearms: 1,
  actionCooldown: 1,
};
for (const site of [laterTieWatch, earlierTieWatch, tiedCompany]) {
  tiedMusterState.buildings.set(site.id, site);
}
assert.equal(
  computeGuardhouseMusterPlan(
    tiedMusterState,
    tiedMusterRoads,
  ).assignmentsByGuardhouse.get(tiedCompany.id)?.towerId,
  earlierTieWatch.id,
  'equal road-distance watch claims must use stable tower identity',
);
assert.equal(
  getGuardhouseMusterState(
    tiedCompany,
    tiedMusterState,
    () => 50,
  ).linkedTowerId,
  earlierTieWatch.id,
  'the selected-company inspector must show the same stable tied watch',
);
const orderedTieCompany = {
  ...tiedCompany,
  guardhouseMusterWatchtowerId: laterTieWatch.id,
};
tiedMusterState.buildings.set(orderedTieCompany.id, orderedTieCompany);
assert.equal(
  computeGuardhouseMusterPlan(
    tiedMusterState,
    tiedMusterRoads,
  ).assignmentsByGuardhouse.get(orderedTieCompany.id)?.towerId,
  laterTieWatch.id,
  'a persisted muster order must override automatic nearest/stable selection',
);
assert.equal(
  getGuardhouseMusterState(
    orderedTieCompany,
    tiedMusterState,
    () => 50,
  ).linkedTowerId,
  laterTieWatch.id,
  'the guardhouse inspector must honor the same persisted post order',
);
tiedMusterState.buildings.set(laterTieWatch.id, {
  ...laterTieWatch,
  assignedLabor: 0,
});
assert.equal(
  computeGuardhouseMusterPlan(
    tiedMusterState,
    tiedMusterRoads,
  ).assignmentsByGuardhouse.has(orderedTieCompany.id),
  false,
  'an unstaffed ordered post must leave the company waiting rather than moving to the active watch',
);
assert.equal(
  getGuardhouseMusterState(
    orderedTieCompany,
    tiedMusterState,
    () => 50,
  ).linkedTowerId,
  null,
);

const refugeProjectionState = emptyGameState();
const refuge = building('refuge', 'palisaded_refuge', 100, 0, 0);
refugeProjectionState.buildings.set(refuge.id, refuge);
refugeProjectionState.buildings.set(
  'inside-refuge-store',
  {
    ...building('inside-refuge-store', 'village_storehouse', 145, 0, 1),
    timber: 40,
  },
);
refugeProjectionState.buildings.set(
  'outside-refuge-store',
  {
    ...building('outside-refuge-store', 'village_storehouse', 180, 0, 1),
    timber: 60,
  },
);
refugeProjectionState.residences.set(
  'inside-refuge-home',
  { ...residence('inside-refuge-home', 130, 0, 4), householdWealth: 20 },
);
refugeProjectionState.deliveryTrips.set(
  'inside-refuge-cart',
  deliveryTrip('inside-refuge-cart', 'food', 15, 125, 0),
);
assert.equal(palisadedRefugeEffectiveRadius(refuge), 68);
assert.deepEqual(
  countHouseholdsShelteredByPalisadedRefuge(refuge, refugeProjectionState),
  {
    homesInReach: 1,
    residentsInReach: 4,
    warnedHomesInReach: 0,
    warnedResidentsInReach: 0,
    shelteredHomes: 0,
    shelteredResidents: 0,
    shelteredWealth: 0,
    unassignedWarnedHomes: 0,
    unassignedWarnedResidents: 0,
    residentCapacity: 32,
    remainingResidentCapacity: 32,
  },
  'proximity without a staffed-watch warning must not teleport a household into shelter',
);
const refugeWatch = building('refuge-watch', 'watchtower', 0, 0, 2);
refugeProjectionState.buildings.set(refugeWatch.id, refugeWatch);
assert.deepEqual(
  countHouseholdsShelteredByPalisadedRefuge(refuge, refugeProjectionState),
  {
    homesInReach: 1,
    residentsInReach: 4,
    warnedHomesInReach: 1,
    warnedResidentsInReach: 4,
    shelteredHomes: 1,
    shelteredResidents: 4,
    shelteredWealth: 20,
    unassignedWarnedHomes: 0,
    unassignedWarnedResidents: 0,
    residentCapacity: 32,
    remainingResidentCapacity: 28,
  },
);
const refugeTargets = projectRaidTargets(refugeProjectionState, 4);
assert.deepEqual(
  refugeTargets.map((target) => [target.id, target.sheltered]),
  [
    ['outside-refuge-store', false],
    ['inside-refuge-store', false],
    ['inside-refuge-home', true],
    ['inside-refuge-cart', false],
  ],
  'only warned households may carry wealth into shelter; physical stores and carts remain in place',
);
assert.match(
  formatProjectedRaidTargets(refugeTargets),
  /household rallied here · 12s live breach/,
);
refugeProjectionState.buildings.set(
  'refuge-town-hall',
  building('refuge-town-hall', 'town_hall', 115, 0, 0),
);
refugeProjectionState.stockpile.gold = 50;
assert.equal(
  projectRaidTargets(refugeProjectionState, 5).find(
    (target) => target.kind === 'treasury',
  )?.sheltered,
  false,
  'Town Hall treasury must remain at its physical seat rather than teleport into a nearby refuge',
);
refugeProjectionState.stockpile.gold = 0;
refugeProjectionState.buildings.delete('refuge-town-hall');
refugeProjectionState.buildings.delete(refugeWatch.id);
assert.ok(
  projectRaidTargets(refugeProjectionState, 4).every(
    (target) => !target.sheltered,
  ),
  'an unstaffed warning network must leave even nearby households unable to rally',
);
refugeProjectionState.buildings.set(refugeWatch.id, refugeWatch);
refugeProjectionState.fireIncidents.set(
  'refuge-watch-fire',
  fire('refuge-watch-fire', refugeWatch.id),
);
assert.ok(
  projectRaidTargets(refugeProjectionState, 4).every(
    (target) => !target.sheltered,
  ),
  'a fire-disabled watch must not warn households to rally',
);
refugeProjectionState.fireIncidents.delete('refuge-watch-fire');
refugeProjectionState.fireIncidents.set(
  'refuge-fire',
  fire('refuge-fire', refuge.id),
);
assert.equal(palisadedRefugeEffectiveRadius(refuge, true), 0);
assert.ok(
  projectRaidTargets(refugeProjectionState, 4).every(
    (target) => !target.sheltered,
  ),
  'a fire-disabled timber refuge must stop sheltering warned households',
);
assert.equal(
  frontierDefenseFireSignature(refugeProjectionState),
  `palisaded_refuge:${refuge.id}`,
);

const refugeCapacityState = emptyGameState();
const capacityWatch = building('capacity-watch', 'watchtower', 40, 0, 2);
const capacityRefugeA = building('capacity-refuge-a', 'palisaded_refuge', 0, 0, 0);
const capacityRefugeB = building('capacity-refuge-b', 'palisaded_refuge', 80, 0, 0);
for (const site of [capacityWatch, capacityRefugeA, capacityRefugeB]) {
  refugeCapacityState.buildings.set(site.id, site);
}
const capacityHomes = [
  { id: 'capacity-a-20', x: -5, population: 20 },
  { id: 'capacity-a-12', x: -10, population: 12 },
  { id: 'capacity-b-12', x: 80, population: 12 },
  { id: 'capacity-overflow-20', x: 40, population: 20 },
  { id: 'capacity-no-room-8', x: 15, population: 8 },
] as const;
for (const [index, home] of capacityHomes.entries()) {
  refugeCapacityState.residences.set(home.id, {
    ...residence(home.id, home.x, 0, home.population),
    householdWealth: 10 + index,
  });
}
const capacityPlan = computeRefugeShelterPlan(refugeCapacityState);
assert.equal(capacityPlan.activeRefuges, 2);
assert.equal(capacityPlan.residentCapacityPerRefuge, 32);
assert.equal(capacityPlan.totalResidentCapacity, 64);
assert.equal(capacityPlan.warnedHomesInReach, 5);
assert.equal(capacityPlan.warnedResidentsInReach, 72);
assert.equal(capacityPlan.assignedHomes, 4);
assert.equal(capacityPlan.assignedResidents, 64);
assert.equal(capacityPlan.unassignedWarnedHomes, 1);
assert.equal(capacityPlan.unassignedWarnedResidents, 8);
assert.equal(capacityPlan.residentsByRefuge.get(capacityRefugeA.id), 32);
assert.equal(capacityPlan.residentsByRefuge.get(capacityRefugeB.id), 32);
assert.equal(
  capacityPlan.refugeByResidence.get('capacity-overflow-20'),
  capacityRefugeB.id,
  'a whole household must try an overlapping second refuge when its nearest enclosure is full',
);
assert.equal(
  capacityPlan.refugeByResidence.has('capacity-no-room-8'),
  false,
  'a household must remain exposed when no overlapping enclosure has room for everyone',
);
const capacityTargets = projectRaidTargets(refugeCapacityState, 10);
const ralliedOverflowTarget = capacityTargets.find(
  (target) => target.kind === 'residence' && target.id === 'capacity-overflow-20',
);
assert.equal(ralliedOverflowTarget?.x, capacityRefugeB.x);
assert.equal(ralliedOverflowTarget?.z, capacityRefugeB.z);
assert.match(
  formatProjectedRaidTargets(ralliedOverflowTarget ? [ralliedOverflowTarget] : []),
  /rallied here · 12s live breach/,
  'the likely-target marker must move household risk to the assigned physical refuge',
);
const shelterByCapacityHome = new Map(
  capacityTargets
    .filter((target) => target.kind === 'residence')
    .map((target) => [target.id, target.sheltered]),
);
assert.equal(shelterByCapacityHome.get('capacity-overflow-20'), true);
assert.equal(shelterByCapacityHome.get('capacity-no-room-8'), false);
const cachedCapacityTargets = projectRaidTargets(
  refugeCapacityState,
  10,
  {
    enemyPressure: 55,
    roadNetwork: new RoadNetwork(),
    refugeShelterPlan: capacityPlan,
  },
);
assert.deepEqual(
  cachedCapacityTargets
    .filter((target) => target.kind === 'residence')
    .map((target) => [target.id, target.sheltered]),
  capacityTargets
    .filter((target) => target.kind === 'residence')
    .map((target) => [target.id, target.sheltered]),
  'raid markers must reuse the same household assignments that drive visible refuge rallies',
);
assert.deepEqual(
  countHouseholdsShelteredByPalisadedRefuge(
    capacityRefugeA,
    refugeCapacityState,
  ),
  {
    homesInReach: 4,
    residentsInReach: 60,
    warnedHomesInReach: 4,
    warnedResidentsInReach: 60,
    shelteredHomes: 2,
    shelteredResidents: 32,
    shelteredWealth: 21,
    unassignedWarnedHomes: 1,
    unassignedWarnedResidents: 8,
    residentCapacity: 32,
    remainingResidentCapacity: 0,
  },
);
refugeCapacityState.fireIncidents.set(
  'capacity-refuge-a-fire',
  fire('capacity-refuge-a-fire', capacityRefugeA.id),
);
const fireReducedCapacityPlan = computeRefugeShelterPlan(refugeCapacityState);
assert.equal(fireReducedCapacityPlan.activeRefuges, 1);
assert.equal(fireReducedCapacityPlan.totalResidentCapacity, 32);
assert.equal(fireReducedCapacityPlan.assignedResidents, 32);
assert.equal(
  fireReducedCapacityPlan.refugeByResidence.has('capacity-a-20'),
  false,
  'fire must remove the enclosure and recalculate household claims immediately',
);

const refugeTieState = emptyGameState();
const tieWatch = building('tie-watch', 'watchtower', 40, 0, 2);
const tieRefuge20 = building('20', 'palisaded_refuge', 80, 0, 0);
const tieRefuge10 = building('10', 'palisaded_refuge', 0, 0, 0);
for (const site of [tieWatch, tieRefuge20, tieRefuge10]) {
  refugeTieState.buildings.set(site.id, site);
}
refugeTieState.residences.set(
  'tie-home',
  residence('tie-home', 40, 0, 4),
);
assert.equal(
  computeRefugeShelterPlan(refugeTieState).refugeByResidence.get('tie-home'),
  tieRefuge10.id,
  'equidistant refuge claims must use stable IDs rather than map insertion order',
);

const cartRiskState = emptyGameState();
cartRiskState.buildings.set(tower.id, tower);
cartRiskState.deliveryTrips.set(
  '30',
  deliveryTrip('30', 'food', 60, 170, 0),
);
cartRiskState.deliveryTrips.set(
  '31',
  deliveryTrip('31', 'polearms', 10, 100, 0),
);
cartRiskState.deliveryTrips.set(
  '32',
  deliveryTrip('32', 'water', 500, 175, 0),
);
cartRiskState.deliveryTrips.set(
  '33',
  deliveryTrip('33', 'stone', 500, 180, 0),
);
const cartTargets = projectRaidTargets(cartRiskState, 4);
assert.deepEqual(
  cartTargets.map((target) => [
    target.kind,
    target.id,
    target.protected,
    target.portableValue,
  ]),
  [
    ['cart', '30', false, 60],
    ['cart', '31', true, 40],
  ],
  'loaded portable goods must remain raid targets, while bulk stone and water stay unattractive',
);
assert.equal(cartTargets[0]?.label, 'Loaded food handcart');
assert.equal(cartTargets[0]?.portableSummary, '60 food on the road');
assert.match(formatProjectedRaidTargets(cartTargets), /Loaded food handcart/);
const textileTargetState = emptyGameState();
textileTargetState.buildings.set(
  'textile-store',
  {
    ...building('textile-store', 'weaver', 20, 0, 1),
    wool: 4,
    cloth: 12,
  },
);
textileTargetState.buildings.set(
  'timber-store',
  {
    ...building('timber-store', 'village_storehouse', 40, 0, 1),
    timber: 21,
  },
);
const textileTarget = projectRaidTargets(textileTargetState, 1)[0];
assert.equal(
  textileTarget?.id,
  'textile-store',
  'finished cloth must carry its authoritative 1.5x target value in client projections',
);
assert.equal(textileTarget?.portableValue, 22);
assert.equal(textileTarget?.portableSummary, '12 cloth + 4 wool');
assert.match(
  formatProjectedRaidTargets([textileTarget!]),
  /12 cloth \+ 4 wool/,
  'likely-target feedback should explain the textile stock attracting the raid',
);
const reconstructionTargetState = emptyGameState();
reconstructionTargetState.buildings.set(
  'rebuilding-weaver',
  {
    ...building('rebuilding-weaver', 'weaver', 20, 0, 0),
    constructionComplete: false,
    constructionProgress: 0,
    wool: 4,
    cloth: 12,
  },
);
reconstructionTargetState.buildings.set(
  'finished-store',
  {
    ...building('finished-store', 'village_storehouse', 40, 0, 1),
    timber: 21,
  },
);
reconstructionTargetState.buildings.set(
  'empty-building-site',
  {
    ...building('empty-building-site', 'village_storehouse', 60, 0, 0),
    constructionComplete: false,
    constructionProgress: 0.5,
  },
);
const reconstructionTargets = projectRaidTargets(reconstructionTargetState, 3);
assert.deepEqual(
  reconstructionTargets.map((target) => target.id),
  ['rebuilding-weaver', 'finished-store'],
  'reconstruction must not hide retained stores, while empty construction sites stay irrelevant',
);
assert.equal(reconstructionTargets[0]?.label, "Weaver's workshop worksite");
assert.equal(reconstructionTargets[0]?.portableSummary, '12 cloth + 4 wool');
const reconstructionCoverageState = emptyGameState();
reconstructionCoverageState.buildings.set(tower.id, tower);
reconstructionCoverageState.buildings.set(
  'covered-reconstruction',
  {
    ...building('covered-reconstruction', 'weaver', 100, 0, 0),
    constructionComplete: false,
    cloth: 5,
  },
);
reconstructionCoverageState.buildings.set(
  'covered-empty-site',
  {
    ...building('covered-empty-site', 'weaver', 110, 0, 0),
    constructionComplete: false,
  },
);
assert.deepEqual(
  countSitesProtectedByWatchtower(tower, reconstructionCoverageState),
  { buildings: 1, homes: 0, residents: 0 },
  'watch coverage should include vulnerable reconstruction stores but not empty worksites',
);
const treasuryTargetState = emptyGameState();
treasuryTargetState.stockpile.timber = 50;
treasuryTargetState.stockpile.stone = 500;
treasuryTargetState.stockpile.water = 500;
treasuryTargetState.stockpile.cloth = 20;
treasuryTargetState.stockpile.gold = 10;
treasuryTargetState.buildings.set(
  '40',
  building('40', 'town_hall', 20, 0, 1),
);
treasuryTargetState.buildings.set(
  '50',
  {
    ...building('50', 'village_storehouse', 40, 0, 0),
    constructionComplete: false,
    constructionProgress: 0.5,
    constructionTreasuryTimber: 30,
  },
);
treasuryTargetState.buildings.set(
  '60',
  {
    ...building('60', 'village_storehouse', 170, 0, 1),
    timber: 55,
  },
);
const treasuryTargets = projectRaidTargets(treasuryTargetState, 3);
assert.deepEqual(
  treasuryTargets.map((target) => [target.kind, target.id]),
  [
    ['treasury', '40'],
    ['building', '60'],
  ],
  'unreserved treasury goods must compete in the same bounded raid budget as physical stores',
);
assert.equal(treasuryTargets[0]?.portableValue, 60);
assert.equal(treasuryTargets[0]?.portableSummary, '20 cloth + 20 timber');
assert.equal(treasuryTargets[0]?.label, 'Settlement treasury at Town Hall');
treasuryTargetState.buildings.set(tower.id, tower);
assert.deepEqual(
  projectRaidTargets(treasuryTargetState, 2).map(
    (target) => [target.kind, target.protected],
  ),
  [
    ['building', false],
    ['treasury', true],
  ],
  'an exposed store must remain preferable to a richer treasury seat inside watch coverage',
);
const householdTreasuryState = emptyGameState();
householdTreasuryState.stockpile.gold = 25;
householdTreasuryState.residences.set(
  '7',
  residence('7', 80, 0, 3),
);
assert.deepEqual(
  projectRaidTargets(householdTreasuryState, 1).map(
    (target) => [target.kind, target.id, target.portableValue],
  ),
  [['treasury', '7', 25]],
  'before a civic holding exists, the oldest occupied home must keep the treasury physical',
);
const rebuildingTreasuryState = emptyGameState();
rebuildingTreasuryState.stockpile.gold = 15;
rebuildingTreasuryState.buildings.set(
  '1',
  building('1', 'village_storehouse', 20, 0, 1),
);
rebuildingTreasuryState.buildings.set(
  '9',
  {
    ...building('9', 'town_hall', 80, 0, 0),
    constructionComplete: false,
    constructionProgress: 0,
  },
);
assert.equal(
  projectRaidTargets(rebuildingTreasuryState, 1)[0]?.label,
  'Settlement treasury at Town Hall worksite',
  'a Town Hall reconstruction must not teleport the treasury to a safer holding',
);
const negativeCoverageState = emptyGameState();
negativeCoverageState.buildings.set(
  'negative-tower',
  building('negative-tower', 'watchtower', -130, -20, 1),
);
negativeCoverageState.buildings.set(
  'negative-store',
  { ...building('negative-store', 'village_storehouse', -270, -20, 1), timber: 10 },
);
assert.equal(
  projectRaidTargets(negativeCoverageState, 1)[0]?.protected,
  true,
  'client watch buckets must preserve exact radius checks across negative cells',
);

const markerParent = new THREE.Group();
const riskMarkers = new FrontierRiskMarkers({
  terrain: { getHeightAt: () => 12 } as never,
  parent: markerParent,
});
const ringInstances = markerParent.getObjectByName(
  'Projected raid target rings',
) as THREE.InstancedMesh;
const beaconInstances = markerParent.getObjectByName(
  'Projected raid target beacons',
) as THREE.InstancedMesh;
riskMarkers.sync(projectedTargets, 0.39, true);
assert.equal(ringInstances.count, 0, 'quiet-frontier projections should not clutter the world');
riskMarkers.sync(projectedTargets, 0.7, true);
assert.equal(ringInstances.count, 2);
assert.equal(beaconInstances.count, 2);
riskMarkers.tick(0.016);
const markerMatrix = new THREE.Matrix4();
ringInstances.getMatrixAt(0, markerMatrix);
assert.ok(
  markerMatrix.elements.every(Number.isFinite),
  'pooled risk marker transforms should remain finite',
);
riskMarkers.sync(cartTargets.slice(0, 1), 0.7, true);
riskMarkers.trackDeliveryTrips(new Map([
  ['30', { x: 44, z: -12 }],
]));
riskMarkers.tick(0.016);
ringInstances.getMatrixAt(0, markerMatrix);
assert.equal(markerMatrix.elements[12], 44);
assert.equal(markerMatrix.elements[14], -12);
riskMarkers.trackDeliveryTrips(new Map());
assert.equal(
  ringInstances.count,
  0,
  'a cart warning must clear as soon as that authoritative trip finishes',
);
riskMarkers.dispose();
assert.equal(markerParent.children.length, 0);

const deploymentParent = new THREE.Group();
const deploymentRoads = new RoadNetwork();
const initialRoadRevision = deploymentRoads.getTopologyRevision();
deploymentRoads.addRoadPath([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(240, 0, 0),
]);
assert.ok(
  deploymentRoads.getTopologyRevision() > initialRoadRevision,
  'frontier route overlays need an inexpensive topology revision for cache invalidation',
);
let deploymentRoadSpeedMultiplier = 1;
const deploymentMarkers = new BuildingMarkers({
  terrain: { getHeightAt: () => 4 } as never,
  parent: deploymentParent,
  getRoadNetwork: () => deploymentRoads,
  getRoadConditionSpeedMultiplier: () => deploymentRoadSpeedMultiplier,
});
const deploymentState = emptyGameState();
const deploymentTower = { ...tower, x: 0, z: 0 };
const deploymentGuardhouse = {
  ...guardhouse,
  x: 240,
  z: 0,
};
deploymentState.buildings.set(deploymentTower.id, deploymentTower);
deploymentState.buildings.set(deploymentGuardhouse.id, deploymentGuardhouse);

deploymentMarkers.setBuildingExtentOverlay(deploymentTower, deploymentState);
const selectedExtent = deploymentParent.getObjectByName('Selected building extent') as THREE.Mesh;
assert.ok(selectedExtent.visible);

const renderedExtentRadius = (): number => {
  const positions = selectedExtent.geometry.getAttribute('position');
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = 0;
  for (let index = 0; index < positions.count; index += 1) {
    const dx = positions.getX(index) - deploymentTower.x;
    const dz = positions.getZ(index) - deploymentTower.z;
    const distance = Math.hypot(dx, dz);
    minimum = Math.min(minimum, distance);
    maximum = Math.max(maximum, distance);
  }
  return (minimum + maximum) * 0.5;
};

assert.ok(
  Math.abs(renderedExtentRadius() - watchtowerEffectiveRadius(deploymentTower)) < 0.05,
  'a one-watchman selection ring must show the reduced operational radius',
);
deploymentState.buildings.set(deploymentTower.id, { ...deploymentTower, assignedLabor: 2 });
deploymentMarkers.setBuildingExtentOverlay(
  deploymentState.buildings.get(deploymentTower.id)!,
  deploymentState,
);
assert.ok(Math.abs(renderedExtentRadius() - 190) < 0.05);

deploymentMarkers.setBuildingExtentOverlay(deploymentGuardhouse, deploymentState);
const musterRoute = deploymentParent.getObjectByName(
  'Selected guardhouse muster route',
) as THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
assert.ok(musterRoute.visible, 'a linked guardhouse selection should trace its actual road muster');
assert.ok(
  musterRoute.count > 2 && musterRoute.count <= 512,
  'the muster overlay needs a bounded set of world-space road dashes',
);
assert.equal(
  musterRoute.material.color.getHex(),
  0x9aca6f,
  'a route at the dry full-muster limit should use the green response color',
);
deploymentRoadSpeedMultiplier = SPRING_RAIN_ROAD_SPEED_MULTIPLIER;
deploymentMarkers.setBuildingExtentOverlay(deploymentGuardhouse, deploymentState);
assert.equal(
  musterRoute.material.color.getHex(),
  0xf0a63f,
  'soft spring roads should turn the same limit route into an amber delay',
);
const overlayCacheStarted = performance.now();
for (let index = 0; index < 10_000; index += 1) {
  deploymentMarkers.setBuildingExtentOverlay(deploymentGuardhouse, deploymentState);
}
const overlayCacheElapsedMs = performance.now() - overlayCacheStarted;
assert.ok(
  overlayCacheElapsedMs < 250,
  `10,000 cached frontier overlay refreshes took ${overlayCacheElapsedMs.toFixed(1)} ms`,
);
deploymentState.fireIncidents.set(
  'deployment-watch-fire',
  fire('deployment-watch-fire', deploymentTower.id),
);
deploymentMarkers.setBuildingExtentOverlay(
  deploymentState.buildings.get(deploymentTower.id)!,
  deploymentState,
);
assert.equal(
  selectedExtent.visible,
  false,
  'a fire-disabled watch must hide its obsolete coverage ring',
);
deploymentMarkers.setBuildingExtentOverlay(deploymentGuardhouse, deploymentState);
assert.equal(
  musterRoute.visible,
  false,
  'a fire-disabled watch must invalidate a cached guardhouse muster route',
);
deploymentState.fireIncidents.clear();
deploymentMarkers.setBuildingExtentOverlay(deploymentGuardhouse, deploymentState);
assert.equal(musterRoute.visible, true);
deploymentState.fireIncidents.set(
  'deployment-company-fire',
  fire('deployment-company-fire', deploymentGuardhouse.id),
);
deploymentMarkers.setBuildingExtentOverlay(deploymentGuardhouse, deploymentState);
assert.equal(
  musterRoute.visible,
  false,
  'a fire-disabled guardhouse must not display an operational muster route',
);
deploymentState.fireIncidents.clear();
deploymentState.buildings.set(deploymentTower.id, { ...deploymentTower, assignedLabor: 0 });
deploymentMarkers.setBuildingExtentOverlay(deploymentGuardhouse, deploymentState);
assert.equal(musterRoute.visible, false, 'an unstaffed watch must remove the muster route');
deploymentMarkers.dispose();
assert.equal(deploymentParent.children.length, 0);

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
  guardsRequired: 6.5,
  targetsAtRisk: 2,
  estimatedLossFraction: 0.08,
};
assert.equal(frontierThreatLabel(security, frontierSettings), 'Raiders reported');
assert.equal(frontierThreatLabel(security, legacySettings), 'Peaceful settlement');
assert.equal(estimatedRaidDays(security, 0), 30);
const overdueRaid = {
  ...security,
  threat: 1,
  nextRaidTick: 100,
};
assert.equal(
  frontierThreatLabel(overdueRaid, frontierSettings, 1),
  'Winter campaign pause',
);
assert.equal(
  frontierThreatLabel(overdueRaid, frontierSettings, 5),
  'Incursion imminent',
);
assert.match(
  formatFrontierRaidTiming(overdueRaid, 101, 1),
  /waits for the April campaign season/,
);
assert.match(
  formatFrontierRaidTiming(overdueRaid, 101, 5),
  /Scouts may arrive now.*campaign season active/,
);
assert.equal(
  formatFrontierForecast(security),
  '4.5 / 6.5 guards in the weakest likely watch district · 2 holdings at risk · up to 8% portable stores per target',
);

assert.ok(Math.abs(projectedRaidArsonChance(security, 65) - 0.0789692307) < 1e-8);
assert.match(formatFrontierForecast(security, 65), /8% chance of one raid fire/);
assert.equal(
  projectedRaidArsonChance({
    ...security,
    readyGuards: security.guardsRequired,
    targetsAtRisk: 0,
  }, 65),
  0,
);
assert.match(
  formatRaidReport({
    ...security,
    lastOutcome: 'arson',
    lastGoodsLost: 14,
    lastWealthLost: 3,
  }),
  /set one reached holding alight/,
);
assert.match(
  formatRaidReport({
    ...security,
    lastOutcome: 'plundered',
    lastGoodsLost: 0,
    lastWealthLost: 9,
  }),
  /household, parish, and treasury wealth/,
);

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
assert.ok(
  mesh.getObjectByName('Open timber watch gallery'),
  'the raised gallery must expose staffed watchmen instead of enclosing them in a solid block',
);

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

const refugeMesh = createBuildingMesh('palisaded_refuge');
assert.ok(
  refugeMesh.getObjectByName('Refuge palisade stakes') instanceof THREE.InstancedMesh,
  'the many refuge stakes should render in one bounded instanced draw',
);
assert.ok(
  refugeMesh.getObjectByName('Refuge shelter roof'),
  'the enclosure needs a visible civilian shelter, not only a decorative fence',
);

const setupPanel = readFileSync('src/ui/WorldSetupPanel.ts', 'utf8');
const toolbar = readFileSync('src/ui/BuildToolbar.ts', 'utf8');
const settlementHud = readFileSync('src/ui/SettlementHud.ts', 'utf8');
const watchtowerInspector = readFileSync('src/resources/inspector/watchtowerRenderer.ts', 'utf8');
const guardhouseInspector = readFileSync('src/resources/inspector/guardhouseRenderer.ts', 'utf8');
const refugeInspector = readFileSync('src/resources/inspector/palisadedRefugeRenderer.ts', 'utf8');
const townHallInspector = readFileSync('src/resources/inspector/townHallRenderer.ts', 'utf8');
const frontierMarkers = readFileSync('src/security/FrontierRiskMarkers.ts', 'utf8');
const buildingMarkers = readFileSync('src/buildings/BuildingMarkers.ts', 'utf8');
const villagerRenderer = readFileSync('src/settlement/VillagerRenderer.ts', 'utf8');
const resourceInspector = readFileSync('src/resources/ResourceInspector.ts', 'utf8');
const app = readFileSync('src/app/App.ts', 'utf8');
const clientSecurity = readFileSync('src/security/frontierSecurity.ts', 'utf8');
const serverSimulation = readFileSync('server/src/simulation/settlement_security.rs', 'utf8');
const serverRaidAgents = readFileSync('server/src/simulation/raid_agents.rs', 'utf8');
const serverRaidAgentPolicy = readFileSync('server/src/raid_agent_policy.rs', 'utf8');
const serverRoadNetwork = readFileSync('server/src/roads/network.rs', 'utf8');
const frontierEconomy = readFileSync('server/src/frontier_economy_policy.rs', 'utf8');
const expandedEconomy = readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
const serverPolicy = readFileSync('server/src/security_policy.rs', 'utf8');
const serverFires = readFileSync('server/src/simulation/fires.rs', 'utf8');
const serverBuildingReducers = readFileSync('server/src/reducers/buildings.rs', 'utf8');
const serverPopulation = readFileSync('server/src/economy/population.rs', 'utf8');
const serverTables = readFileSync('server/src/tables.rs', 'utf8');
const serverLaborSchedule = readFileSync(
  'server/src/simulation/labor_schedule.rs',
  'utf8',
);
const serverTickContext = readFileSync(
  'server/src/simulation/tick_context.rs',
  'utf8',
);
const serverResidenceLifecycle = readFileSync(
  'server/src/simulation/residence_lifecycle.rs',
  'utf8',
);
const generatedCombatAgent = readFileSync('src/generated/combat_agent_table.ts', 'utf8');
const generatedRaidIncursionRoute = readFileSync(
  'src/generated/raid_incursion_route_table.ts',
  'utf8',
);
const clientCombatAgents = readFileSync('src/security/combatAgents.ts', 'utf8');
const gameTableSubscriptions = readFileSync(
  'src/data/gameTableSubscriptions.ts',
  'utf8',
);
const gameTableSync = readFileSync(
  'src/data/spacetimeTableSync/gameTableSync.ts',
  'utf8',
);
const inspectorActions = readFileSync('src/app/inspectorSpacetimeActions.ts', 'utf8');
const spacetimeReducers = readFileSync('src/data/spacetimeReducers.ts', 'utf8');
const buildingSync = readFileSync('src/data/spacetimeTableSync/syncBuildings.ts', 'utf8');
const generatedReducers = readFileSync('src/generated/types/reducers.ts', 'utf8');
assert.match(setupPanel, /Peaceful settlement/);
assert.match(setupPanel, /Contested frontier/);
assert.match(setupPanel, /enemy pressure/i);
assert.match(toolbar, /MILITARY_BUILD_MENU_ENTRIES/);
assert.match(toolbar, /setConflictEnabled/);
assert.match(toolbar, /data-tooltip="Defenses \(X\)"/);
assert.match(toolbar, /hotkey: 'x'/);
assert.doesNotMatch(toolbar, /hotkey: 'd'/);
{
  let active = false;
  const button = { hidden: true, disabled: false } as HTMLButtonElement;
  const toggle: DockToggle = {
    button,
    hotkey: 'x',
    getActive: () => active,
    setActive: (next) => {
      active = next;
    },
  };
  assert.equal(handleDockHotkey('x', [toggle]), false, 'hidden frontier controls must not consume hotkeys');
  assert.equal(active, false);
  button.hidden = false;
  assert.equal(handleDockHotkey('X', [toggle]), true, 'visible frontier controls should accept hotkeys');
  assert.equal(active, true);
  button.disabled = true;
  assert.equal(handleDockHotkey('x', [toggle]), false, 'disabled frontier controls must not consume hotkeys');
  assert.equal(active, true);
}
assert.match(settlementHud, /formatFrontierForecast/);
assert.match(settlementHud, /formatFrontierForecast\(security, world\.enemyPressure\)/);
assert.match(settlementHud, /formatFrontierRaidTiming/);
assert.match(
  settlementHud,
  /Live incursion: labor halted, new cart departures stopped/,
);
assert.match(serverTables, /table\(accessor = active_raid, public\)/);
assert.match(gameTableSubscriptions, /'active_raid'/);
assert.match(gameTableSync, /syncActiveRaid/);
assert.match(
  serverLaborSchedule,
  /tick\.owner_has_active_raider_threat\(ctx, owner\)/,
  'every ordinary producer and cart must share the agent-authoritative emergency stop',
);
assert.match(
  serverResidenceLifecycle,
  /if !tick\.owner_has_active_raider_threat\(ctx, residence\.owner\)[\s\S]*step_residence_settlement/,
  'new household settlement must not progress while a capable hostile is physically active',
);
assert.match(
  app,
  /setFrontierAlert\([\s\S]*enabled && raidThreatActive/,
  'civilian rally and guard muster presentation must follow replicated hostile agents',
);
assert.match(
  serverTickContext,
  /combat_agent\(\)[\s\S]*owner\(\)[\s\S]*filter\(&owner\)[\s\S]*combat_agent_is_active_raider_threat/,
  'the emergency-stop cache must use the owner-indexed live-agent table',
);
assert.match(clientSecurity, /live contact still resolves the fight/);
assert.match(watchtowerInspector, /Projected defense/);
assert.match(watchtowerInspector, /context\.enemyPressure/);
assert.match(guardhouseInspector, /Projected raid/);
assert.match(guardhouseInspector, /context\.enemyPressure/);
assert.match(guardhouseInspector, /Watch muster/);
assert.match(guardhouseInspector, /Alert posture/);
assert.match(guardhouseInspector, /breaking cross-country for nearby or active attacks/);
assert.match(guardhouseInspector, /Raiders physically enter from the frontier/);
assert.match(guardhouseInspector, /Muster underway/);
assert.match(guardhouseInspector, /Cross-country response/);
assert.match(guardhouseInspector, /Road conditions/);
assert.match(guardhouseInspector, /Soft-road delay/);
assert.match(guardhouseInspector, /Warned response/);
assert.match(guardhouseInspector, /Cross-country reserve/);
assert.match(guardhouseInspector, /heading directly across country/);
assert.match(guardhouseInspector, /Inspect linked watchtower/);
assert.match(guardhouseInspector, /Muster order/);
assert.match(guardhouseInspector, /Nearest staffed watch/);
assert.match(guardhouseInspector, /data-guardhouse-muster-watchtower/);
assert.match(guardhouseInspector, /automatic reassignment suspended/);
assert.match(
  guardhouseInspector,
  /roadPathDistancesFrom/,
  'the muster-post chooser should preview all watch routes from one road tree',
);
assert.match(refugeInspector, /Warned demand/);
assert.match(refugeInspector, /Resident capacity/);
assert.match(refugeInspector, /Nearest-household claims/);
assert.match(refugeInspector, /Alert state/);
assert.match(refugeInspector, /Rally underway/);
assert.match(refugeInspector, /Household coin rallied/);
assert.match(refugeInspector, /Palisade breach/);
assert.match(refugeInspector, /No automatic loss reduction/);
assert.match(refugeInspector, /building inventories, loaded carts, and Town Hall treasury remain where stored/);
assert.match(townHallInspector, /Civilian refuge capacity/);
assert.match(townHallInspector, /computeRefugeShelterPlan/);
assert.match(townHallInspector, /still deploy cross-country/);
assert.match(settlementHud, /Unlinked armed companies still materialize/);
assert.match(clientSecurity, /no loss was resolved off-map/);
assert.doesNotMatch(clientSecurity, /Watch bells scattered the raiders/);
assert.match(frontierMarkers, /InstancedMesh/);
assert.match(frontierMarkers, /RAID_TARGET_MARKER_THREAT_THRESHOLD/);
assert.match(frontierMarkers, /MAX_RAID_TARGET_MARKERS\s*=\s*4/);
assert.match(buildingMarkers, /Selected guardhouse muster route/);
assert.match(buildingMarkers, /watchtowerEffectiveRadius/);
assert.match(buildingMarkers, /MAX_GUARDHOUSE_MUSTER_DASHES\s*=\s*512/);
assert.match(resourceInspector, /onSelectionChange\?\.\(latest\)/);
assert.match(app, /resourceInspector\?\.refreshSelection\(\)/);
assert.match(
  app,
  /frontierDefenseFireSignature\(state\)/,
  'raid markers must invalidate immediately when a watch or guardhouse enters fire outage',
);
assert.match(
  app,
  /Math\.floor\(state\.tick\s*\/\s*FRONTIER_SECURITY_UPDATE_INTERVAL_TICKS\)/,
  'likely-target projections must refresh on every authoritative security cadence',
);
assert.match(
  app,
  /projectRaidTargets\([\s\S]*enemyPressure:[\s\S]*roadNetwork:[\s\S]*roadSpeedMultiplier/,
  'risk markers must rank targets with the same road, pressure, and weather inputs as the authority',
);
assert.match(
  app,
  /computeRefugeShelterPlan\(state\)[\s\S]*computeGuardhouseMusterPlan\([\s\S]*refugeShelterPlan: refugePlan[\s\S]*guardhouseMusterPlan:[\s\S]*setFrontierAlert/,
  'one cached frontier pass must drive raid markers, civilian rallies, and visible guard musters',
);
assert.match(
  clientSecurity,
  /options\?\.refugeShelterPlan \?\? assignRefugeHouseholds/,
  'cached alert assignments must avoid a duplicate settlement-wide household sort',
);
assert.match(
  clientSecurity,
  /computeGuardhouseMusterPlan[\s\S]*roadPathDistancesFrom[\s\S]*projectedTargetDistrictDefense/,
  'the client must batch each company route and keep readiness inside its claimed watch district',
);
assert.match(
  app,
  /frontierRiskMarkers\?\.trackDeliveryTrips\(state\.deliveryTrips\)/,
  'a selected loaded cart warning must follow its authoritative live position without a full rescan',
);
assert.match(serverSimulation, /SECURITY_UPDATE_INTERVAL_TICKS/);
assert.match(serverSimulation, /WatchCoverageIndex::new/);
assert.match(serverSimulation, /active_palisaded_refuge_coverage/);
assert.match(serverSimulation, /settlement_refuge_assignments/);
assert.match(serverSimulation, /RefugeHouseholdCandidate/);
assert.match(
  serverSimulation,
  /refuge_assignments\.get\(&target\.id\)[\s\S]*raid_anchor_building_id,[\s\S]*loot_fraction: raid_contact_loss_fraction\(enemy_pressure\)/,
  'warned household raids must move to their assigned enclosure without an abstract watch-loss modifier',
);
assert.match(serverPolicy, /assign_refuge_households/);
assert.match(serverPolicy, /PALISADED_REFUGE_RESIDENT_CAPACITY/);
assert.match(serverPolicy, /pub fn raid_contact_loss_fraction/);
assert.match(
  serverSimulation,
  /start_live_raid\([\s\S]*?&live_targets,[\s\S]*?&buildings,[\s\S]*?&towers,[\s\S]*?road_network\.as_ref\(\)/,
  'a due frontier raid must materialize replicated people rather than resolve an abstract outcome',
);
assert.doesNotMatch(
  serverSimulation,
  /fn resolve_raid/,
  'the authority must not retain a background raid-loss resolver',
);
assert.match(
  serverBuildingReducers,
  /kind == "palisaded_refuge"[\s\S]*building\.kind == "guardhouse" && building\.construction_complete/,
);
assert.match(serverSimulation, /fn settlement_exposure/);
assert.doesNotMatch(serverSimulation, /fn position_is_watched/);
assert.doesNotMatch(serverSimulation, /fn raid_target_candidates/);
assert.match(serverSimulation, /settlement_guard_districts/);
assert.match(
  serverSimulation,
  /fire_disabled_buildings[\s\S]*?staffed_watch_coverage\(&buildings, &fire_disabled_buildings\)/,
  'authoritative watch coverage must exclude fire-disabled towers from one owner-scoped set',
);
assert.match(
  serverSimulation,
  /settlement_guard_districts\([\s\S]*?&fire_disabled_buildings[\s\S]*?fire_disabled_buildings\.contains\(&building\.id\)/,
  'authoritative raid readiness must exclude fire-disabled guardhouses',
);
assert.match(serverSimulation, /road_path_distances_from/);
assert.match(
  serverSimulation,
  /select_guardhouse_muster_watch\([\s\S]*guardhouse\.guardhouse_muster_watchtower_id/,
  'the authoritative district assignment must consume the persisted company order',
);
assert.match(serverSimulation, /readiness_by_watch/);
assert.match(serverSimulation, /raid_district_forecast/);
assert.match(serverSimulation, /RaidTargetKind::Residence/);
assert.match(serverSimulation, /RaidTargetKind::DeliveryTrip/);
assert.match(serverSimulation, /pub\(super\) fn plunder_raid_target_at_contact/);
assert.match(serverSimulation, /let plunder = before\.plunder\(loss_fraction\)/);
assert.match(serverSimulation, /retain_unplundered_stores/);
assert.match(
  serverSimulation,
  /fn treasury_portable_stores[\s\S]*raidable_treasury_timber\(treasury\.timber, reserved_timber\)/,
  'authoritative treasury exposure must preserve timber already promised to construction',
);
assert.match(
  serverSimulation,
  /fn treasury_anchor[\s\S]*"town_hall"[\s\S]*TreasuryAtResidence/,
  'the treasury seat must prefer a Town Hall and retain a physical household fallback',
);
assert.match(
  serverSimulation,
  /RaidTargetKind::TreasuryAtBuilding \| RaidTargetKind::TreasuryAtResidence[\s\S]*let plunder = before\.plunder\(loss_fraction\)[\s\S]*player_resources\(\)\.owner\(\)\.update\(treasury\)/,
  'a contacted treasury seat must remove the same portable stores that attracted the raid',
);
const treasuryStoreSource = serverSimulation.slice(
  serverSimulation.indexOf('fn treasury_portable_stores'),
  serverSimulation.indexOf('fn treasury_anchor'),
);
assert.doesNotMatch(treasuryStoreSource, /stone:\s*treasury\.stone/);
assert.doesNotMatch(treasuryStoreSource, /water:\s*treasury\.water/);
assert.doesNotMatch(
  serverSimulation,
  /\.filter\(\|building\| building\.construction_complete\)\s*\.collect::<Vec<Building>>/,
  'authoritative security must load stock-bearing reconstruction sites',
);
assert.match(
  serverSimulation,
  /fn staffed_watch_coverage[\s\S]*?building\.construction_complete[\s\S]*?building\.kind == "watchtower"/,
  'unfinished watchtowers must not provide warning after the owner roster includes worksites',
);
assert.match(
  serverSimulation,
  /fn settlement_guard_districts[\s\S]*?building\.construction_complete[\s\S]*?building\.kind == "guardhouse"/,
  'unfinished guardhouses must not provide defense after the owner roster includes worksites',
);
assert.match(serverSimulation, /raid_holding_vulnerability\(building\.construction_complete, portable_value\)/);
assert.match(
  serverSimulation,
  /RaidPortableStores\s*\{[\s\S]*wool:\s*building\.wool,[\s\S]*cloth:\s*building\.cloth,/,
  'authoritative raid valuation and removal must include raw wool and finished cloth',
);
assert.match(
  serverRaidAgents,
  /fn record_contact_plunder[\s\S]*raid_arson_occurs[\s\S]*ignite_raid_target/,
  'arson must be downstream of one physical raider completing contact plunder',
);
assert.match(
  serverSimulation,
  /fn delivery_trip_portable_stores[\s\S]*CommodityKind::Gold[\s\S]*CommodityKind::Stone \| CommodityKind::Water/,
  'authoritative cart exposure must value portable cargo while excluding bulk water and stone',
);
assert.match(
  serverSimulation,
  /RaidTargetKind::DeliveryTrip[\s\S]*let before = delivery_trip_portable_stores\(&trip\)[\s\S]*let plunder = before\.plunder\(loss_fraction\)[\s\S]*delivery_trip\(\)\.id\(\)\.update\(trip\)/,
  'a contacted cart must lose cargo from the same authoritative trip row that attracted the raid',
);
assert.match(
  serverRaidAgents,
  /COMBAT_TARGET_DELIVERY_TRIP => None/,
  'cart interception must not turn a moving cart into a structural arson target',
);
assert.match(
  serverRaidAgents,
  /contact_distance > HOLDING_CONTACT_RANGE_METERS \* HOLDING_CONTACT_RANGE_METERS[\s\S]*move_toward\([\s\S]*return;[\s\S]*agent\.state = COMBAT_STATE_LOOTING[\s\S]*agent\.loot_progress \+= elapsed_seconds[\s\S]*plunder_raid_target_at_contact/,
  'stock removal must remain unreachable until the authoritative raider enters contact range and finishes looting',
);
assert.match(
  serverRaidAgents,
  /agent\.attack_cooldown = DOWNED_LINGER_SECONDS/,
  'battlefield aftermath must use wall-clock combat time rather than sparse economy ticks',
);
assert.match(
  serverRaidAgents,
  /raid_agent_target_position\(ctx, agent\)[\s\S]*raid_contact_duration\(active_raid_anchor_id\)/,
  'a sheltered household must require live contact at its physical refuge for the full breach window',
);
assert.match(
  serverRaidAgents,
  /agent\.raid_anchor_building_id[\s\S]*building\.kind == "palisaded_refuge"[\s\S]*ignite_raid_target\(ctx, agent\.owner, kind, target_id, sim_tick\)/,
  'raid arson must strike the refuge being physically assaulted rather than the evacuated home',
);
assert.match(
  serverRaidAgents,
  /distance <= MELEE_RANGE_METERS \* MELEE_RANGE_METERS[\s\S]*damage_by_agent\.entry\(enemy\.id\)[\s\S]*down_agent/,
  'guards and raiders must exchange health damage only after closing to melee range',
);
assert.match(
  serverRaidAgents,
  /source_building_id: guardhouse\.id[\s\S]*source_slot: slot/,
  'every replicated defender must be backed by an armed slot from an actual guardhouse roster',
);
assert.match(
  serverRaidAgents,
  /nearest_emergency_guard_target\([\s\S]*guardhouse\.x,[\s\S]*guardhouse\.z,[\s\S]*emergency_targets[\s\S]*targets\[target_index\], None, None/,
  'every fit armed company must materialize against its nearest attacked holding when no watch route is usable',
);
assert.match(
  serverRaidAgents,
  /fire_disabled_buildings\.contains\(&building\.id\)/,
  'a burning guardhouse must not materialize an emergency company',
);
assert.match(
  serverRaidAgents,
  /if let Some\(route\) = muster_route \{[\s\S]*move_along_route\([\s\S]*nearest_enemy_within\(agent, snapshots, COMBAT_FACTION_RAIDER, f64::INFINITY, true\)/,
  'road-linked companies should take their route while unlinked companies fall through to direct pursuit',
);
assert.doesNotMatch(
  serverRaidAgents,
  /let Some\(route\) = muster_route else/,
  'a missing route must not make a physical guard company wait while a live incursion is active',
);
assert.doesNotMatch(
  serverRaidAgents,
  /let Some\(network\) = road_network else \{\s*return 0;/,
  'missing roads must never erase otherwise fit armed defenders from the live simulation',
);
assert.match(
  serverRaidAgents,
  /road_path_route\(guardhouse\.x, guardhouse\.z, tower\.x, tower\.z\)[\s\S]*guard_muster_route\(\)\.insert/,
  'each responding company must cache the real road approach selected by its watch assignment',
);
assert.match(
  serverRaidAgents,
  /road_path_route_from_external_access/,
  'raiders should resolve their approach through the target road component',
);
assert.match(
  serverRaidAgents,
  /raid_incursion_route\(\)\.insert/,
  'each raider must retain an authoritative road approach and escape path',
);
assert.match(
  serverRoadNetwork,
  /road_path_route_from_external_access[\s\S]*shortest_node_distances_from[\s\S]*offroad_multiplier[\s\S]*append_polyline/,
  'the external approach must join only the road component that actually serves its target',
);
assert.match(
  serverRaidAgentPolicy,
  /route_shortcut_is_worthwhile[\s\S]*ROUTE_SHORTCUT_MARGIN_METERS[\s\S]*remaining_route_distance/,
  'combat routes must remain a preference when cross-country movement is materially better',
);
assert.match(
  serverRaidAgents,
  /move_along_route\([\s\S]*COMBAT_ROAD_SPEED_MULTIPLIER/,
  'taking the preferred road path must provide a real movement advantage rather than only visual routing',
);
assert.match(serverRaidAgentPolicy, /pub const COMBAT_ROAD_SPEED_MULTIPLIER:\s*f64\s*=\s*1\.35/);
assert.match(
  serverRaidAgents,
  /COMBAT_STATE_RETREATING[\s\S]*move_along_route\([\s\S]*false[\s\S]*COMBAT_STATE_ADVANCING[\s\S]*move_along_route\([\s\S]*true/,
  'raiders must advance and carry loot back out along the cached physical route',
);
assert.match(
  serverRaidAgents,
  /guard_breaks_route_for[\s\S]*engage_agent\([\s\S]*move_along_route/,
  'nearby enemies and attacks already in contact must override the preferred road march',
);
assert.match(
  serverRaidAgents,
  /combat_agent\(\)[\s\S]*\.owner\(\)[\s\S]*\.filter\(&active\.owner\)[\s\S]*agent\.raid_id == active\.raid_id/,
  'simultaneous multiplayer raids must update only their own settlement agents',
);
assert.match(
  serverRaidAgents,
  /carried_loot_json = serde_json::to_string[\s\S]*recover_stock_at\([\s\S]*agent\.x,[\s\S]*agent\.z/,
  'stolen goods must travel on the raider and drop as recoverable physical stock when intercepted',
);
assert.match(serverRaidAgentPolicy, /pub const MELEE_RANGE_METERS/);
assert.match(serverRaidAgentPolicy, /pub const HOLDING_CONTACT_RANGE_METERS/);
assert.match(serverRaidAgentPolicy, /pub const LOOT_SECONDS:\s*f64\s*=\s*4\.0/);
assert.match(serverRaidAgentPolicy, /pub fn raid_contact_duration/);
assert.match(serverRaidAgentPolicy, /\.clamp\(3\.0,\s*12\.0\)/);
assert.match(serverRaidAgentPolicy, /fn movement_never_teleports_past_contact/);
assert.match(serverRaidAgentPolicy, /fn imminent_or_active_attacks_override_route_discipline/);
assert.match(serverRaidAgentPolicy, /fn unlinked_companies_choose_the_nearest_attacked_holding_stably/);
assert.match(serverRaidAgentPolicy, /fn cached_company_routes_stay_cheap_for_a_large_guard_response/);
assert.match(serverRaidAgentPolicy, /pub fn guard_recovery_ticks/);
assert.match(serverRaidAgentPolicy, /pub fn combat_state_blocks_guard_slot/);
assert.match(serverRaidAgentPolicy, /pub fn combat_state_commits_guard_labor/);
assert.match(
  serverRaidAgents,
  /COMBAT_STATE_WOUNDED_RETURNING[\s\S]*WOUNDED_GUARD_SPEED_MPS[\s\S]*COMBAT_STATE_RECOVERING/,
  'a downed guard must physically return before recuperating at the source guardhouse',
);
assert.match(
  serverRaidAgents,
  /unavailable_guard_slots[\s\S]*filter_map\(\|\(building_id, slot\)\|[\s\S]*select_guard_muster_slots/,
  'wounded roster slots must not spawn again in a later raid',
);
assert.match(
  serverSimulation,
  /unavailable_guard_slots[\s\S]*fn settlement_guard_districts[\s\S]*filter_map\(\|\(building_id, slot\)\|[\s\S]*select_guard_muster_slots/,
  'the settlement defense forecast must subtract persistent guard casualties',
);
assert.match(
  serverPopulation,
  /guardhouse_roster_floor[\s\S]*requested_labor < roster_floor/,
  'labor reassignment must not duplicate a deployed, returning, or recovering guard in another workplace',
);
assert.match(
  serverBuildingReducers,
  /let roster_floors = guardhouse_roster_floors[\s\S]*minimum_labor:[\s\S]*roster_floors/,
  'automatic year-round labor balancing must preserve every live company roster slot',
);
assert.match(
  serverBuildingReducers,
  /guardhouse_roster_count[\s\S]*wait until every guard has returned and recovered before demolition/,
  'a guardhouse with live company agents must remain physically present',
);
assert.match(guardhouseInspector, /Roster lock/);
assert.match(guardhouseInspector, /physically return and finish recovery/);
assert.match(
  serverTables,
  /accessor = combat_agent,[\s\S]*public,[\s\S]*pub struct CombatAgent[\s\S]*pub x: f64,[\s\S]*pub health: f64,[\s\S]*pub carried_loot_json: String/,
  'combatant position, health, state, and carried loot must be authoritative replicated data',
);
assert.match(generatedCombatAgent, /x: __t\.f64\(\)/);
assert.match(generatedCombatAgent, /health: __t\.f64\(\)/);
assert.match(generatedCombatAgent, /carriedLootJson: __t\.string\(\)/);
assert.match(generatedCombatAgent, /raidAnchorBuildingId: __t\.u64\(\)/);
assert.match(generatedCombatAgent, /routeProgress: __t\.f64\(\)/);
assert.match(generatedRaidIncursionRoute, /combatAgentId: __t\.u64\(\)\.primaryKey\(\)/);
assert.match(generatedRaidIncursionRoute, /routePolylineJson: __t\.string\(\)/);
assert.match(app, /villagers\?\.setCombatAgents\(snapshot\.combatAgents\)/);
assert.match(
  app,
  /formatLiveCombatSummary\([\s\S]*snapshot\.combatAgents\.values\(\),[\s\S]*snapshot\.simTick/,
);
assert.match(
  villagerRenderer,
  /for \(const visual of this\.combatAgentVisuals\.values\(\)\)[\s\S]*id: `combat:\$\{combat\.id\}`[\s\S]*tool: 'spear'/,
  'the ordinary crowd renderer must materialize every replicated combat row with a visible weapon',
);
assert.match(villagerRenderer, /activeCombatGuardSlots/);
assert.match(villagerRenderer, /case 'fighting': return 'fight'/);
assert.match(clientCombatAgents, /status:\s*CombatAgentStatus/);
assert.match(clientCombatAgents, /breaching a refuge/);
{
  const combatant = (
    id: string,
    faction: 'guard' | 'raider',
    status: CombatAgentState['status'],
  ): CombatAgentState => ({
    id,
    raidId: '41',
    faction,
    sourceBuildingId: faction === 'guard' ? 'building:7' : null,
    sourceSlot: 0,
    targetKind: 'building',
    targetId: 'building:9',
    x: 10,
    z: 20,
    homeX: 0,
    homeZ: 0,
    health: status === 'downed' ? 0 : 80,
    maxHealth: 80,
    readiness: 0.8,
    status,
    attackCooldown: 0,
    lootProgress: 0,
    carryingLoot: false,
    issuedPolearms: faction === 'guard' ? 1 : 0,
    raidAnchorBuildingId: null,
    stateChangedTick: 400,
  });
  const liveSummary = formatLiveCombatSummary([
    combatant('r1', 'raider', 'advancing'),
    combatant('r2', 'raider', 'downed'),
    combatant('g1', 'guard', 'fighting'),
    combatant('g2', 'guard', 'downed'),
  ]);
  assert.match(liveSummary ?? '', /1 raider/);
  assert.match(liveSummary ?? '', /1 guard/);
  assert.equal(
    hasActiveRaiderThreat([
      combatant('r1', 'raider', 'advancing'),
      combatant('g1', 'guard', 'fighting'),
    ]),
    true,
  );
  assert.equal(
    hasActiveRaiderThreat([
      combatant('r2', 'raider', 'downed'),
      combatant('g4', 'guard', 'returning'),
    ]),
    false,
    'downed raiders and returning guards are visible aftermath, not a settlement-wide work stop',
  );
  assert.equal(
    isActiveRaiderThreat(combatant('r3', 'raider', 'retreating')),
    true,
    'civilians remain rallied until the last capable raider physically escapes',
  );
  assert.equal(
    isActiveRaiderThreat({
      ...combatant('r4', 'raider', 'advancing'),
      health: Number.POSITIVE_INFINITY,
    }),
    false,
    'malformed replicated health must not create a permanent client-only alarm',
  );
  assert.match(liveSummary ?? '', /1 raider down · 1 guard wounded/);
  const breaching = {
    ...combatant('r3', 'raider', 'looting'),
    raidAnchorBuildingId: 'building:12',
  };
  assert.match(
    formatLiveCombatSummary([breaching]) ?? '',
    /1 raider breaching a refuge/,
  );
  const recovering = combatant('g3', 'guard', 'recovering');
  const recoveryTicks = guardRecoveryTicks(recovering.readiness);
  assert.ok(recoveryTicks > 0);
  assert.ok(guardRecoveryRemainingDays(recovering, 400) >= 3);
  assert.ok(guardRecoveryRemainingDays(recovering, 400 + recoveryTicks) <= 1e-9);
  assert.match(
    formatLiveCombatSummary([recovering], 400) ?? '',
    /Company aftermath: 1 wounded guard unavailable · up to 4 days remaining/,
  );
  const fielded = {
    ...combatant('g4', 'guard', 'returning'),
    sourceSlot: 1,
  };
  const highSlotCasualty = {
    ...recovering,
    sourceSlot: 4,
  };
  assert.deepEqual(
    guardCompanyRosterSummary(
      [
        fielded,
        highSlotCasualty,
        {
          ...combatant('g5', 'guard', 'fighting'),
          sourceBuildingId: 'building:8',
        },
      ],
      'building:7',
    ),
    {
      rosterFloor: 5,
      fieldedGuards: 1,
      woundedGuards: 1,
    },
    'live guard rows must keep their stable source roster slots committed',
  );
  assert.equal(
    guardCompanyIssuedPolearms(
      [fielded, highSlotCasualty, combatant('r5', 'raider', 'retreating')],
      'building:7',
    ),
    2,
    'the client must distinguish company weapons carried by guards from raider loot',
  );
  assert.equal(formatLiveCombatSummary([]), undefined);
}
assert.match(serverPolicy, /pub fn raid_arson_chance/);
assert.match(serverPolicy, /defense_ratio\.clamp/);
assert.match(serverPolicy, /WATCH_COVERAGE_CELL_SIZE:\s*f64\s*=\s*128\.0/);
assert.match(serverPolicy, /pub struct RaidPortableStores/);
assert.match(
  serverRaidAgents,
  /issued_guard_polearms_by_building[\s\S]*?serde_json::from_str::<RaidPortableStores>/,
);
assert.match(
  serverRaidAgents,
  /select_guard_muster_slots\([\s\S]*?carried_loot_json: serde_json::to_string\(&RaidPortableStores \{[\s\S]*?polearms: 1\.0/,
);
assert.match(
  serverSimulation,
  /building_portable_stores_at_site[\s\S]*?company_remaining\.polearms \+= issued/,
);
assert.match(serverPolicy, /pub fn raid_holding_vulnerability/);
assert.match(serverPolicy, /pub fn raidable_treasury_timber/);
assert.match(serverPolicy, /TreasuryAtBuilding/);
assert.match(serverPolicy, /TreasuryAtResidence/);
assert.match(serverPolicy, /plunder_good!\(wool\)/);
assert.match(serverPolicy, /plunder_good!\(cloth\)/);
assert.match(serverPolicy, /CLOTH_RAID_VALUE_MULTIPLIER:\s*f64\s*=\s*1\.5/);
assert.match(serverFires, /pub fn ignite_raid_target/);
assert.match(serverFires, /FIRE_SOURCE_RAID/);
assert.match(frontierEconomy, /CARPENTER_TIMBER_PER_POLEARM/);
assert.match(frontierEconomy, /CARPENTER_IRONWORK_PER_POLEARM/);
assert.match(frontierEconomy, /GUARDHOUSE_WAGE_PER_GUARD_PER_DAY/);
assert.match(frontierEconomy, /GUARDHOUSE_CRITICAL_FOOD_RUNWAY_DAYS:\s*f64\s*=\s*3\.0/);
assert.match(frontierEconomy, /pub fn guardhouse_food_target/);
assert.match(frontierEconomy, /pub fn select_guardhouse_food_candidate/);
assert.match(expandedEconomy, /CommodityKind::Ironwork/);
assert.match(expandedEconomy, /CARPENTER_IRONWORK_PER_POLEARM/);
assert.doesNotMatch(expandedEconomy, /CARPENTER_GOLD_PER_POLEARM/);
assert.doesNotMatch(expandedEconomy, /conflict_enabled && config\.enemy_pressure/);
const granaryStepSource = expandedEconomy.slice(
  expandedEconomy.indexOf('pub fn step_granary'),
  expandedEconomy.indexOf('fn step_farmstead_fields'),
);
assert.match(granaryStepSource, /next_granary_guard_food_dispatch/);
assert.match(granaryStepSource, /guard_food_preempts_grain/);
assert.match(granaryStepSource, /GUARDHOUSE_CRITICAL_FOOD_RUNWAY_DAYS/);
const smokehouseStepSource = expandedEconomy.slice(
  expandedEconomy.indexOf('pub fn step_smokehouse'),
  expandedEconomy.indexOf('pub fn step_apiary'),
);
assert.doesNotMatch(
  smokehouseStepSource,
  /"granary"/,
  'smokehouses must receive central food through the granary policy rather than pulling ahead of it',
);
const guardhouseStepSource = expandedEconomy.slice(
  expandedEconomy.indexOf('pub fn step_guardhouse'),
  expandedEconomy.indexOf('fn step_simple_producer'),
);
assert.match(guardhouseStepSource, /guardhouse_food_target/);
assert.doesNotMatch(
  guardhouseStepSource,
  /"granary"/,
  'guardhouses must receive central emergency food through source-side granary arbitration',
);
assert.match(expandedEconomy, /fn next_granary_guard_food_dispatch/);
assert.match(expandedEconomy, /institutional_source_food_surplus/);
assert.match(guardhouseInspector, /central granary intervenes below/);
assert.match(guardhouseInspector, /data-guardhouse-food-reserve/);
assert.match(guardhouseInspector, /lock up more fresh food here/);
assert.match(townHallInspector, /Ration reserves/);
assert.match(townHallInspector, /lean.*company.*deep/);
assert.match(townHallInspector, /Frontier timetable/);
assert.match(townHallInspector, /Watch districts/);
assert.match(townHallInspector, /weakest likely district/);
assert.match(townHallInspector, /Last incursion/);
const buildingSchema = readFileSync('server/src/tables.rs', 'utf8');
assert.match(
  buildingSchema,
  /#\[default\(6u8\)\]\s+pub guardhouse_food_reserve: u8/,
  'existing guardhouses must retain the former six-food-per-guard reserve',
);
const buildingReducers = readFileSync('server/src/reducers/buildings.rs', 'utf8');
assert.match(
  buildingReducers,
  /set_guardhouse_food_reserve[\s\S]*is_valid_guardhouse_food_reserve[\s\S]*building\.guardhouse_food_reserve = reserve_per_guard/,
  'ration depth must remain owner-validated and server authoritative',
);
assert.match(
  readFileSync('src/generated/building_table.ts', 'utf8'),
  /guardhouseFoodReserve: __t\.u8\(\)/,
);
assert.match(
  readFileSync('src/generated/set_guardhouse_food_reserve_reducer.ts', 'utf8'),
  /reservePerGuard: __t\.u8\(\)/,
);
assert.match(villagerRenderer, /workplaceSlot < Math\.floor\(workplace\?\.polearms/);
assert.match(villagerRenderer, /Keeping watch from the frontier gallery/);
assert.match(villagerRenderer, /setFrontierAlert/);
assert.match(villagerRenderer, /Marching by road to the linked frontier watch/);
assert.match(villagerRenderer, /watchtowerMusterPosition/);
assert.match(serverPolicy, /RAID_SEASON_START_MONTH:\s*u32\s*=\s*4/);
assert.match(serverPolicy, /RAID_SEASON_END_MONTH:\s*u32\s*=\s*10/);
assert.match(serverPolicy, /guardhouse_muster_efficiency/);
assert.match(serverPolicy, /guardhouse_muster_response_distance/);
assert.match(serverPolicy, /select_guardhouse_muster_watch/);
assert.match(
  serverTables,
  /#\[default\(0u64\)\][\s\S]*pub guardhouse_muster_watchtower_id: u64/,
  'existing saves must retain automatic nearest-watch behavior',
);
assert.match(
  serverBuildingReducers,
  /pub fn set_guardhouse_muster_post[\s\S]*watchtower\.owner != owner[\s\S]*watchtower\.kind != "watchtower"[\s\S]*!watchtower\.construction_complete/,
  'muster orders must accept only an owned completed watch post',
);
assert.match(
  serverBuildingReducers,
  /building\.kind == "watchtower"[\s\S]*candidate\.guardhouse_muster_watchtower_id == building_id[\s\S]*guardhouse_muster_watchtower_id = 0/,
  'demolishing a watch must return its companies to automatic assignment',
);
assert.match(resourceInspector, /onSetGuardhouseMusterPost/);
assert.match(inspectorActions, /setGuardhouseMusterPost/);
assert.match(spacetimeReducers, /set_guardhouse_muster_post/);
assert.match(
  buildingSync,
  /row\.guardhouseMusterWatchtowerId == null[\s\S]*row\.guardhouseMusterWatchtowerId === 0n[\s\S]*undefined[\s\S]*toString/,
  'legacy rows and default-zero rows must both retain automatic muster assignment',
);
assert.match(generatedReducers, /SetGuardhouseMusterPostReducer/);
assert.match(serverSimulation, /environment\.road_speed_multiplier\(\)/);
assert.ok(
  statSync('public/assets/ui/build-menu/cards/watchtower.webp').size > 20_000,
  'watchtower needs a finished construction-menu card',
);
assert.ok(
  statSync('public/assets/ui/build-menu/cards/guardhouse.webp').size > 20_000,
  'guardhouse needs a finished construction-menu card',
);
assert.ok(
  statSync('public/assets/ui/build-menu/cards/palisaded-refuge.webp').size > 20_000,
  'the palisaded refuge needs a finished construction-menu card',
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

const projectionPerfState = emptyGameState();
projectionPerfState.buildings.set(staffedTower.id, staffedTower);
for (let index = 0; index < 1_000; index += 1) {
  const watch = {
    ...building(
      `perf-watch-${index}`,
      'watchtower',
      (index % 40) * 320,
      Math.floor(index / 40) * 320,
      2,
    ),
  };
  projectionPerfState.buildings.set(watch.id, watch);
  const perfRefuge = building(
    `perf-refuge-${index}`,
    'palisaded_refuge',
    (index % 40) * 320 + 90,
    Math.floor(index / 40) * 320,
    0,
  );
  projectionPerfState.buildings.set(perfRefuge.id, perfRefuge);
  if (index % 2 === 0) {
    projectionPerfState.fireIncidents.set(
      `perf-watch-fire-${index}`,
      fire(`perf-watch-fire-${index}`, watch.id),
    );
    projectionPerfState.fireIncidents.set(
      `perf-refuge-fire-${index}`,
      fire(`perf-refuge-fire-${index}`, perfRefuge.id),
    );
  }
}
for (let index = 0; index < 100_000; index += 1) {
  projectionPerfState.buildings.set(
    `${index + 1}`,
    {
      ...building(
        `${index + 1}`,
        'village_storehouse',
        index % 500,
        Math.floor(index / 500) * 8,
        1,
      ),
      timber: index + 1,
    },
  );
}
const projectionStarted = performance.now();
const perfTargets = projectRaidTargets(projectionPerfState, 3);
const projectionElapsedMs = performance.now() - projectionStarted;
assert.equal(perfTargets.length, 3);
assert.ok(
  projectionElapsedMs < 250,
  `1,000 towers plus 1,000 refuges (half fire-disabled), 100,000-site bounded target projection took ${projectionElapsedMs.toFixed(1)} ms`,
);

const districtPerfRoads = new RoadNetwork();
districtPerfRoads.addRoadPath([
  new THREE.Vector3(-20, 0, 0),
  new THREE.Vector3(4_020, 0, 0),
]);
const districtPerfState = emptyGameState();
for (let index = 0; index < 40; index += 1) {
  const watch = building(
    `district-perf-watch-${index}`,
    'watchtower',
    50 + index * 100,
    0,
    2,
  );
  districtPerfState.buildings.set(watch.id, watch);
}
for (let index = 0; index < 10; index += 1) {
  const company = {
    ...building(
      `district-perf-company-${index}`,
      'guardhouse',
      20 + index * 400,
      0,
      6,
    ),
    polearms: 6,
    actionCooldown: 1,
    guardhouseMusterWatchtowerId: index % 2 === 0
      ? `district-perf-watch-${Math.min(39, index * 4 + 1)}`
      : undefined,
  };
  districtPerfState.buildings.set(company.id, company);
}
for (let index = 0; index < 10_000; index += 1) {
  const site = {
    ...building(
      `district-perf-store-${index}`,
      'village_storehouse',
      index % 4_000,
      24,
      1,
    ),
    timber: index + 1,
  };
  districtPerfState.buildings.set(site.id, site);
}
const districtMusterStarted = performance.now();
const districtMusterPlan = computeGuardhouseMusterPlan(
  districtPerfState,
  districtPerfRoads,
  SPRING_RAIN_ROAD_SPEED_MULTIPLIER,
);
const districtMusterElapsedMs = performance.now() - districtMusterStarted;
assert.equal(districtMusterPlan.linkedGuardhouses, 10);
assert.ok(
  districtMusterElapsedMs < 250,
  `40-watch/10-company batched muster planning took ${districtMusterElapsedMs.toFixed(1)} ms`,
);
const districtProjectionStarted = performance.now();
const districtPerfTargets = projectRaidTargets(districtPerfState, 3, {
  enemyPressure: 80,
  roadNetwork: districtPerfRoads,
  roadSpeedMultiplier: SPRING_RAIN_ROAD_SPEED_MULTIPLIER,
  guardhouseMusterPlan: districtMusterPlan,
});
const districtProjectionElapsedMs = performance.now() - districtProjectionStarted;
assert.equal(districtPerfTargets.length, 3);
assert.ok(
  districtProjectionElapsedMs < 500,
  `40-watch/10-company/10,000-holding district projection took ${districtProjectionElapsedMs.toFixed(1)} ms`,
);

projectionPerfState.buildings.clear();
projectionPerfState.fireIncidents.clear();
const shelterPerfState = projectionPerfState;
const selectedPerfRefuge = building(
  'selected-perf-refuge',
  'palisaded_refuge',
  400,
  400,
  0,
);
shelterPerfState.buildings.set(selectedPerfRefuge.id, selectedPerfRefuge);
for (let index = 0; index < 1_000; index += 1) {
  const watch = building(
    `shelter-perf-watch-${index}`,
    'watchtower',
    (index % 40) * 320,
    Math.floor(index / 40) * 320,
    2,
  );
  shelterPerfState.buildings.set(watch.id, watch);
  if (index % 2 === 0) {
    shelterPerfState.fireIncidents.set(
      `shelter-perf-fire-${index}`,
      fire(`shelter-perf-fire-${index}`, watch.id),
    );
  }
}
for (let index = 0; index < 100_000; index += 1) {
  const id = `shelter-home-${index}`;
  shelterPerfState.residences.set(
    id,
    {
      ...residence(
        id,
        (index % 1_280) * 10,
        Math.floor(index / 1_280) * 10,
        4,
      ),
      householdWealth: 10,
    },
  );
}
const shelterProjectionStarted = performance.now();
const shelterCoverage = countHouseholdsShelteredByPalisadedRefuge(
  selectedPerfRefuge,
  shelterPerfState,
);
const shelterProjectionElapsedMs =
  performance.now() - shelterProjectionStarted;
assert.ok(shelterCoverage.homesInReach > 0);
assert.ok(
  shelterProjectionElapsedMs < 250,
  `1,000-watch, 100,000-home selected-refuge readout took ${shelterProjectionElapsedMs.toFixed(1)} ms`,
);
shelterPerfState.buildings.clear();
shelterPerfState.residences.clear();
shelterPerfState.fireIncidents.clear();

const refugeAssignmentPerfState = emptyGameState();
for (let refugeIndex = 0; refugeIndex < 1_000; refugeIndex += 1) {
  const centerX = (refugeIndex % 40) * 160;
  const centerZ = Math.floor(refugeIndex / 40) * 160;
  const perfWatch = building(
    `capacity-perf-watch-${refugeIndex}`,
    'watchtower',
    centerX,
    centerZ,
    2,
  );
  const perfRefuge = building(
    `capacity-perf-refuge-${refugeIndex}`,
    'palisaded_refuge',
    centerX,
    centerZ,
    0,
  );
  refugeAssignmentPerfState.buildings.set(perfWatch.id, perfWatch);
  refugeAssignmentPerfState.buildings.set(perfRefuge.id, perfRefuge);
  for (let householdIndex = 0; householdIndex < 100; householdIndex += 1) {
    const id = `capacity-perf-home-${refugeIndex}-${householdIndex}`;
    const xOffset = ((householdIndex % 10) - 4.5) * 8;
    const zOffset = (Math.floor(householdIndex / 10) - 4.5) * 8;
    refugeAssignmentPerfState.residences.set(
      id,
      residence(id, centerX + xOffset, centerZ + zOffset, 1),
    );
  }
}
const refugeAssignmentStarted = performance.now();
const refugeAssignmentPlan = computeRefugeShelterPlan(
  refugeAssignmentPerfState,
);
const refugeAssignmentElapsedMs =
  performance.now() - refugeAssignmentStarted;
assert.equal(refugeAssignmentPlan.warnedHomesInReach, 100_000);
assert.equal(refugeAssignmentPlan.assignedResidents, 32_000);
assert.equal(refugeAssignmentPlan.unassignedWarnedResidents, 68_000);
assert.ok(
  refugeAssignmentElapsedMs < 750,
  `1,000-refuge, 100,000-home capacity assignment took ${refugeAssignmentElapsedMs.toFixed(1)} ms`,
);
const cachedRefugeProjectionStarted = performance.now();
const cachedRefugePerfTargets = projectRaidTargets(
  refugeAssignmentPerfState,
  3,
  {
    enemyPressure: 80,
    roadNetwork: new RoadNetwork(),
    refugeShelterPlan: refugeAssignmentPlan,
  },
);
const cachedRefugeProjectionElapsedMs =
  performance.now() - cachedRefugeProjectionStarted;
assert.equal(cachedRefugePerfTargets.length, 0);
assert.ok(
  cachedRefugeProjectionElapsedMs < 350,
  `cached 1,000-refuge, 100,000-home target projection took ${cachedRefugeProjectionElapsedMs.toFixed(1)} ms`,
);
refugeAssignmentPerfState.buildings.clear();
refugeAssignmentPerfState.residences.clear();

const cartProjectionPerfState = emptyGameState();
for (let index = 0; index < 100_000; index += 1) {
  const id = `${index + 1}`;
  cartProjectionPerfState.deliveryTrips.set(
    id,
    deliveryTrip(id, 'food', index + 1, index % 500, Math.floor(index / 500) * 8),
  );
}
const cartProjectionStarted = performance.now();
const cartPerfTargets = projectRaidTargets(cartProjectionPerfState, 3);
const cartProjectionElapsedMs = performance.now() - cartProjectionStarted;
assert.deepEqual(
  cartPerfTargets.map((target) => target.id),
  ['100000', '99999', '99998'],
);
assert.ok(
  cartProjectionElapsedMs < 250,
  `100,000-cart bounded target projection took ${cartProjectionElapsedMs.toFixed(1)} ms`,
);

const guardFoodCandidates = Array.from({ length: 100_000 }, (_, index) => ({
  ...building(
    `guard-${index}`,
    'guardhouse',
    100_000 - index,
    0,
    6,
  ),
  polearms: 6,
  food: index === 99_999 ? 0 : 1.35,
}));
const guardFoodStarted = performance.now();
const guardFoodTarget = selectCriticalGuardhouseFoodTarget(
  guardFoodCandidates,
  'central-granary',
  (target) => target.x,
);
const guardFoodElapsedMs = performance.now() - guardFoodStarted;
assert.equal(guardFoodTarget?.target.id, 'guard-99999');
assert.ok(
  guardFoodElapsedMs < 250,
  `100,000-company food arbitration took ${guardFoodElapsedMs.toFixed(1)} ms`,
);

console.log(
  `frontier security tests passed (${elapsedMs.toFixed(1)} ms for 10,000-site coverage; ${projectionElapsedMs.toFixed(1)} ms for 1,000-watch/1,000-refuge/100,000-site target projection; ${districtMusterElapsedMs.toFixed(1)} ms for 40-watch/10-company muster planning; ${districtProjectionElapsedMs.toFixed(1)} ms for cached 40-watch/10-company/10,000-holding district projection; ${shelterProjectionElapsedMs.toFixed(1)} ms for 1,000-watch/100,000-home refuge readout; ${refugeAssignmentElapsedMs.toFixed(1)} ms for 1,000-refuge/100,000-home capacity assignment; ${cachedRefugeProjectionElapsedMs.toFixed(1)} ms for cached 1,000-refuge/100,000-home target projection; ${cartProjectionElapsedMs.toFixed(1)} ms for 100,000-cart target projection; ${guardFoodElapsedMs.toFixed(1)} ms for 100,000-company food arbitration; ${overlayCacheElapsedMs.toFixed(1)} ms for 10,000 cached overlay refreshes)`,
);

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
    workRadius: kind === 'watchtower'
      ? 190
      : kind === 'palisaded_refuge'
        ? 68
        : 0,
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
    ironwork: 0,
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

function deliveryTrip(
  id: string,
  cargoKind: DeliveryTripState['cargoKind'],
  amount: number,
  x: number,
  z: number,
): DeliveryTripState {
  return {
    id,
    buildingId: `origin-${id}`,
    residenceId: `destination-${id}`,
    destinationKind: 'residence',
    targetBuildingId: null,
    cargoKind,
    amount,
    phase: 'outbound',
    x,
    z,
    progress: 0,
    speedMps: 1.6,
    unloadSeconds: 2,
    unloadRemaining: 0,
    deliveryWorkers: 1,
    freeHaulerWorkers: 0,
    pathDistance: 100,
    travelSpeedMultiplier: 1,
    routePolylineJson: '[[0,0],[100,0]]',
  };
}

function fire(id: string, targetId: string): FireIncidentState {
  return {
    id,
    targetKind: 'building',
    targetId,
    x: 0,
    z: 0,
    ignitionSource: 'accident',
    status: 'extinguished',
    intensity: 0,
    damage: 0.4,
    waterDelivered: 6,
    requiredWater: 6,
    extinguishChance: 1,
    startedTick: 0,
    lastWaterTick: 0,
    resolvedTick: 0,
    responseWellId: null,
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
      ironwork: 0,
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
