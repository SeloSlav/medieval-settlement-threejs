import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { BuildingMarkers } from '../src/buildings/BuildingMarkers.ts';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import { FrontierRiskMarkers } from '../src/security/FrontierRiskMarkers.ts';
import {
  armedGuardCount,
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
  isFrontierRaidSeason,
  projectRaidTargets,
  projectedRaidArsonChance,
  normalizeGuardhouseFoodReserve,
  selectCriticalGuardhouseFoodTarget,
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
import {
  DEFAULT_WORLD_GENERATION_SETTINGS,
  normalizeWorldGenerationSettings,
} from '../src/world/worldGenerationSettings.ts';
import {
  BUILDING_DEFINITIONS,
  BUILDING_STORAGE_CAPS,
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
assert.equal(unlinkedMuster.effectiveReady, 1.6);
musterState.fireIncidents.set('muster-watch-fire', fire('muster-watch-fire', musterTower.id));
const watchFireMuster = getGuardhouseMusterState(
  guardhouse,
  musterState,
  () => 480,
);
assert.equal(watchFireMuster.staffedTowers, 0);
assert.equal(watchFireMuster.linkedTowerId, null);
assert.equal(watchFireMuster.effectiveReady, 1.6);
musterState.fireIncidents.set('company-fire', fire('company-fire', guardhouse.id));
const companyFireMuster = getGuardhouseMusterState(
  guardhouse,
  musterState,
  () => 480,
);
assert.equal(companyFireMuster.fireDisabled, true);
assert.equal(companyFireMuster.rawReady, 0);
assert.equal(companyFireMuster.effectiveReady, 0);
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
assert.ok(
  Math.abs(selectedExtent.scale.x - watchtowerEffectiveRadius(deploymentTower)) < 1e-9,
  'a one-watchman selection ring must show the reduced operational radius',
);
deploymentState.buildings.set(deploymentTower.id, { ...deploymentTower, assignedLabor: 2 });
deploymentMarkers.setBuildingExtentOverlay(
  deploymentState.buildings.get(deploymentTower.id)!,
  deploymentState,
);
assert.equal(selectedExtent.scale.x, 190);

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
  '4.5 / 6.5 guards ready · 2 holdings at risk · about 8% portable stores per target',
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

const setupPanel = readFileSync('src/ui/WorldSetupPanel.ts', 'utf8');
const toolbar = readFileSync('src/ui/BuildToolbar.ts', 'utf8');
const settlementHud = readFileSync('src/ui/SettlementHud.ts', 'utf8');
const watchtowerInspector = readFileSync('src/resources/inspector/watchtowerRenderer.ts', 'utf8');
const guardhouseInspector = readFileSync('src/resources/inspector/guardhouseRenderer.ts', 'utf8');
const townHallInspector = readFileSync('src/resources/inspector/townHallRenderer.ts', 'utf8');
const frontierMarkers = readFileSync('src/security/FrontierRiskMarkers.ts', 'utf8');
const buildingMarkers = readFileSync('src/buildings/BuildingMarkers.ts', 'utf8');
const villagerRenderer = readFileSync('src/settlement/VillagerRenderer.ts', 'utf8');
const resourceInspector = readFileSync('src/resources/ResourceInspector.ts', 'utf8');
const app = readFileSync('src/app/App.ts', 'utf8');
const serverSimulation = readFileSync('server/src/simulation/settlement_security.rs', 'utf8');
const frontierEconomy = readFileSync('server/src/frontier_economy_policy.rs', 'utf8');
const expandedEconomy = readFileSync('server/src/simulation/expanded_economy.rs', 'utf8');
const serverPolicy = readFileSync('server/src/security_policy.rs', 'utf8');
const serverFires = readFileSync('server/src/simulation/fires.rs', 'utf8');
assert.match(setupPanel, /Peaceful settlement/);
assert.match(setupPanel, /Contested frontier/);
assert.match(setupPanel, /enemy pressure/i);
assert.match(toolbar, /MILITARY_BUILD_MENU_ENTRIES/);
assert.match(toolbar, /setConflictEnabled/);
assert.match(settlementHud, /formatFrontierForecast/);
assert.match(settlementHud, /formatFrontierForecast\(security, world\.enemyPressure\)/);
assert.match(settlementHud, /formatFrontierRaidTiming/);
assert.match(watchtowerInspector, /Projected defense/);
assert.match(watchtowerInspector, /context\.enemyPressure/);
assert.match(guardhouseInspector, /Projected raid/);
assert.match(guardhouseInspector, /context\.enemyPressure/);
assert.match(guardhouseInspector, /Watch muster/);
assert.match(guardhouseInspector, /Road conditions/);
assert.match(guardhouseInspector, /Soft-road delay/);
assert.match(guardhouseInspector, /Effective company/);
assert.match(guardhouseInspector, /Inspect linked watchtower/);
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
assert.match(serverSimulation, /SECURITY_UPDATE_INTERVAL_TICKS/);
assert.match(serverSimulation, /WatchCoverageIndex::new/);
assert.match(serverSimulation, /fn settlement_exposure/);
assert.doesNotMatch(serverSimulation, /fn position_is_watched/);
assert.doesNotMatch(serverSimulation, /fn raid_target_candidates/);
assert.match(serverSimulation, /settlement_guard_strength/);
assert.match(
  serverSimulation,
  /fire_disabled_buildings[\s\S]*?staffed_watch_coverage\(&buildings, &fire_disabled_buildings\)/,
  'authoritative watch coverage must exclude fire-disabled towers from one owner-scoped set',
);
assert.match(
  serverSimulation,
  /settlement_guard_strength\([\s\S]*?&fire_disabled_buildings[\s\S]*?fire_disabled_buildings\.contains\(&building\.id\)/,
  'authoritative raid readiness must exclude fire-disabled guardhouses',
);
assert.match(serverSimulation, /nearest_road_path_distance/);
assert.match(serverSimulation, /select_raid_targets/);
assert.match(serverSimulation, /RaidTargetKind::Residence/);
assert.match(serverSimulation, /building_portable_stores\(&updated\)\.plunder/);
assert.match(serverSimulation, /retain_unplundered_stores/);
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
  /fn settlement_guard_strength[\s\S]*?building\.construction_complete[\s\S]*?building\.kind == "guardhouse"/,
  'unfinished guardhouses must not provide defense after the owner roster includes worksites',
);
assert.match(serverSimulation, /raid_holding_vulnerability\(building\.construction_complete, portable_value\)/);
assert.match(
  serverSimulation,
  /RaidPortableStores\s*\{[\s\S]*wool:\s*building\.wool,[\s\S]*cloth:\s*building\.cloth,/,
  'authoritative raid valuation and removal must include raw wool and finished cloth',
);
assert.match(
  serverSimulation,
  /raid_arson_occurs[\s\S]*selected\.iter\(\)\.any[\s\S]*ignite_raid_target/,
  'one bounded arson attempt should reuse only holdings already reached by the raid',
);
assert.match(serverPolicy, /pub fn raid_arson_chance/);
assert.match(serverPolicy, /defense_ratio\.clamp/);
assert.match(serverPolicy, /WATCH_COVERAGE_CELL_SIZE:\s*f64\s*=\s*128\.0/);
assert.match(serverPolicy, /pub struct RaidPortableStores/);
assert.match(serverPolicy, /pub fn raid_holding_vulnerability/);
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
assert.match(townHallInspector, /Watch and muster/);
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
assert.match(serverPolicy, /RAID_SEASON_START_MONTH:\s*u32\s*=\s*4/);
assert.match(serverPolicy, /RAID_SEASON_END_MONTH:\s*u32\s*=\s*10/);
assert.match(serverPolicy, /guardhouse_muster_efficiency/);
assert.match(serverPolicy, /guardhouse_muster_response_distance/);
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
  if (index % 2 === 0) {
    projectionPerfState.fireIncidents.set(
      `perf-watch-fire-${index}`,
      fire(`perf-watch-fire-${index}`, watch.id),
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
  `1,000-tower (500 fire-disabled), 100,000-site bounded target projection took ${projectionElapsedMs.toFixed(1)} ms`,
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
  `frontier security tests passed (${elapsedMs.toFixed(1)} ms for 10,000-site coverage; ${projectionElapsedMs.toFixed(1)} ms for 1,000-tower/500-outage/100,000-site target projection; ${guardFoodElapsedMs.toFixed(1)} ms for 100,000-company food arbitration; ${overlayCacheElapsedMs.toFixed(1)} ms for 10,000 cached overlay refreshes)`,
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
