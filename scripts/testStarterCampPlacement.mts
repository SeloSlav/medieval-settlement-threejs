import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { BuildingMarkers } from '../src/buildings/BuildingMarkers.ts';
import { FOUNDERS_CAMPFIRE_NAME } from '../src/buildings/meshes/foundersCampMesh.ts';
import { fireEffectFromRoot } from '../src/fires/FireEffect.ts';
import { validateBuildingPlacement } from '../src/buildings/BuildingPlacementValidation.ts';
import { RoadNetwork } from '../src/roads/RoadNetwork.ts';
import {
  isWorldInspectionBlocked,
  isWorldResourceIconVisibilityBlocked,
  type PlacementInteractionGate,
} from '../src/input/PlacementInteractionGate.ts';
import {
  STARTING_GOLD,
  STARTING_IRONWORK,
  STARTING_STONE,
  STARTING_TIMBER,
} from '../src/generated/gameBalance.ts';
import type {
  BuildingState,
  ForagingNodeState,
  ResourceNodeState,
} from '../src/resources/types.ts';
import {
  assessFoundingSite,
  describeFoundingSiteAssessment,
} from '../src/settlement/foundingSiteSuitability.ts';
import { describeToolbarStatus } from '../src/ui/buildToolbarStatus.ts';

const read = (path: string): string => readFileSync(path, 'utf8');

assert.deepEqual(
  validateBuildingPlacement('founders_camp', 40, -24, {
    buildings: [],
    residences: [],
    burgageZones: [],
    farmFields: [],
    pastures: [],
    quarries: [],
    foragingNodes: [],
    stockpile: { timber: 0, stone: 0 },
    isWaterAt: () => false,
    isResourceDepositAt: () => false,
    getNaturalHeightAt: () => 0,
  }),
  { ok: true },
  'the founders camp must use the normal building placement validator',
);

const quarry = {
  nodeId: 'quarry-nearby',
  kind: 'quarry',
  resource: 'stone',
  remaining: 1_000,
  maxYield: 1_000,
  x: 80,
  z: 0,
} satisfies ResourceNodeState;
const wildFood = {
  nodeId: 'berries-nearby',
  kind: 'berries',
  resource: 'berries',
  remaining: 500,
  maxYield: 500,
  x: 60,
  z: 0,
} satisfies ForagingNodeState;
let groundwaterSamples = 0;
let terrainSamples = 0;
let treeQueries = 0;
const promisingSite = assessFoundingSite({
  x: 0,
  z: 0,
  sampleGroundwater: () => {
    groundwaterSamples += 1;
    return 0.85;
  },
  countMatureTrees: () => {
    treeQueries += 1;
    return 48;
  },
  quarries: [quarry],
  foragingNodes: [wildFood],
  getHeightAt: () => {
    terrainSamples += 1;
    return 0;
  },
});
assert.equal(promisingSite.rating, 'promising');
assert.equal(treeQueries, 1, 'the advisory model should make one spatial tree query');
assert.equal(groundwaterSamples, 9, 'the advisory model should use one camp and eight bounded field samples');
assert.equal(terrainSamples, 32, 'the advisory model should use four height probes at eight field samples');
assert.match(
  describeFoundingSiteAssessment(promisingSite),
  /Founding outlook: promising[\s\S]*water 85%[\s\S]*timber 48 nearby[\s\S]*stone 80 m[\s\S]*wild food 60 m/,
  'the underlying advisory model should retain the tradeoffs behind its rating',
);
const promisingStatus = describeFoundingSiteAssessment(promisingSite);
assert.equal(
  describeToolbarStatus({
    canBuild: false,
    hasDraft: false,
    mode: 'founders_camp',
    statusDetail: promisingStatus,
  }),
  promisingStatus,
  'the status formatter should accept a post-placement founding outlook',
);

const demandingSite = assessFoundingSite({
  x: 0,
  z: 0,
  sampleGroundwater: () => 0.05,
  countMatureTrees: () => 0,
  quarries: [],
  foragingNodes: [],
  getHeightAt: (x, z) => x * 0.6 + z * 0.6,
});
assert.equal(demandingSite.rating, 'demanding');
assert.equal(
  validateBuildingPlacement('founders_camp', 0, 0, {
    buildings: [],
    residences: [],
    burgageZones: [],
    farmFields: [],
    pastures: [],
    quarries: [],
    foragingNodes: [],
    stockpile: { timber: 0, stone: 0 },
    isWaterAt: () => false,
    isResourceDepositAt: () => false,
    getNaturalHeightAt: () => 0,
  }).ok,
  true,
  'a demanding founding outlook must remain advisory rather than blocking placement',
);
assert.match(
  describeFoundingSiteAssessment({
    ...promisingSite,
    matureTrees: null,
  }),
  /timber survey pending/,
  'the advisory model must not misreport an unloaded forest as zero timber',
);

const profileStart = performance.now();
for (let index = 0; index < 10_000; index += 1) {
  assessFoundingSite({
    x: index % 10,
    z: index % 7,
    sampleGroundwater: () => 0.6,
    countMatureTrees: () => 30,
    quarries: [quarry],
    foragingNodes: [wildFood],
    getHeightAt: () => 0,
  });
}
const profileElapsed = performance.now() - profileStart;
assert.ok(
  profileElapsed < 2_000,
  `10,000 bounded founding-site assessments took ${profileElapsed.toFixed(1)} ms`,
);

let campTerrainHeight = 0;
const markerParent = new THREE.Group();
const campMarkers = new BuildingMarkers({
  terrain: { getHeightAt: () => campTerrainHeight } as never,
  parent: markerParent,
});
campMarkers.prewarmFoundersCampPlacement();
const restoreCampGpuPrewarm = campMarkers.beginFoundersCampGpuPrewarm();
const gpuPrewarmedCamp = markerParent.getObjectByName("Founders' camp and open stockyard");
assert.ok(
  gpuPrewarmedCamp,
  'the prebuilt camp should be attached while startup compiles live-scene shaders',
);
restoreCampGpuPrewarm();
assert.equal(
  markerParent.getObjectByName("Founders' camp and open stockyard"),
  undefined,
  'the covered startup prewarm should detach the camp before play',
);
const campRevealStarted = performance.now();
campMarkers.showPendingPlacement('founders_camp', 12, -8);
const campRevealElapsed = performance.now() - campRevealStarted;
const markerGroup = markerParent.getObjectByName('Building markers');
const optimisticCamp = markerGroup?.getObjectByName('Pending building placement');
assert.ok(optimisticCamp, 'the detailed camp should appear optimistically');
const confirmedCampState = {
  id: 'starter-camp-performance-fixture',
  kind: 'founders_camp',
  x: 12,
  z: -8,
  workRadius: 0,
  actionCooldown: 0,
  timber: STARTING_TIMBER,
  firewood: 24,
  stone: STARTING_STONE,
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
  ironwork: STARTING_IRONWORK,
  polearms: 0,
  gold: STARTING_GOLD,
  waterCapacity: 0,
  assignedLabor: 0,
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
  foundingShelterActive: true,
} satisfies BuildingState;
const campConfirmationArrayBuffersBefore = process.memoryUsage().arrayBuffers;
const campConfirmationStarted = performance.now();
campMarkers.syncBuildings([confirmedCampState]);
const campConfirmationElapsed = performance.now() - campConfirmationStarted;
const campConfirmationArrayBufferGrowth = Math.max(
  0,
  process.memoryUsage().arrayBuffers - campConfirmationArrayBuffersBefore,
);
const confirmedCamp = markerGroup?.getObjectByName("Founders' camp and open stockyard");
assert.ok(
  confirmedCamp === optimisticCamp,
  'authoritative confirmation should adopt the visible camp object',
);
assert.equal(
  markerGroup?.getObjectByName('Pending building placement'),
  undefined,
  'authoritative confirmation should clear the optimistic marker identity',
);
assert.equal(
  confirmedCamp?.userData.visualSignature,
  'complete:founders_camp',
  'the adopted camp should receive the same visual signature as a directly synchronized camp',
);
campTerrainHeight = 4.25;
campMarkers.refreshTerrainHeights();
assert.equal(
  confirmedCamp?.position.y,
  campTerrainHeight,
  'terrain-pad elevation changes should lift the confirmed founding camp onto the platform',
);
const confirmedCampfire = confirmedCamp?.getObjectByName(FOUNDERS_CAMPFIRE_NAME);
assert.ok(
  confirmedCampfire instanceof THREE.Group,
  'authoritative adoption should retain the prewarmed campfire object',
);
const confirmedCampfireEffect = fireEffectFromRoot(confirmedCampfire);
assert.ok(confirmedCampfireEffect, 'the adopted campfire should retain its procedural effect');
const campfireElapsedBeforeTick = confirmedCampfireEffect.elapsedSeconds;
campMarkers.tick(0.125);
assert.equal(
  confirmedCampfireEffect.elapsedSeconds,
  campfireElapsedBeforeTick + 0.125,
  'the adopted campfire should be registered for the same animation tick as a direct sync',
);
const campResyncArrayBuffersBefore = process.memoryUsage().arrayBuffers;
const campResyncStarted = performance.now();
campMarkers.syncBuildings([confirmedCampState]);
const campResyncElapsed = performance.now() - campResyncStarted;
const campResyncArrayBufferGrowth = Math.max(
  0,
  process.memoryUsage().arrayBuffers - campResyncArrayBuffersBefore,
);
const confirmedCampRoots = markerGroup?.children.filter(
  (child) => child.name === "Founders' camp and open stockyard",
) ?? [];
assert.equal(
  confirmedCampRoots.length,
  1,
  'repeated authoritative sync should not leave an orphan or construct a duplicate camp',
);
assert.ok(
  confirmedCampRoots[0] === optimisticCamp,
  'repeated authoritative sync should retain the originally revealed camp',
);
assert.ok(
  campRevealElapsed < 10,
  `prewarmed camp reveal took ${campRevealElapsed.toFixed(2)} ms`,
);
assert.ok(
  campConfirmationElapsed < 10,
  `camp confirmation took ${campConfirmationElapsed.toFixed(2)} ms`,
);
assert.ok(
  campConfirmationArrayBufferGrowth < 128 * 1024,
  `camp confirmation allocated ${(campConfirmationArrayBufferGrowth / 1024).toFixed(1)} KiB of ArrayBuffers`,
);
assert.ok(
  campResyncElapsed < 10,
  `unchanged camp resync took ${campResyncElapsed.toFixed(2)} ms`,
);
assert.ok(
  campResyncArrayBufferGrowth < 128 * 1024,
  `unchanged camp resync allocated ${(campResyncArrayBufferGrowth / 1024).toFixed(1)} KiB of ArrayBuffers`,
);

const hydratingRoads = new RoadNetwork();
let roadsideTerrainHeight = 0;
const roadFacingParent = new THREE.Group();
const roadFacingMarkers = new BuildingMarkers({
  terrain: { getHeightAt: () => roadsideTerrainHeight } as never,
  parent: roadFacingParent,
  getRoadNetwork: () => hydratingRoads,
});
const roadsideSmithy = {
  ...confirmedCampState,
  id: 'road-facing-hydration-fixture',
  kind: 'smithy',
  x: 4,
  z: 8,
  constructionComplete: false,
  constructionProgress: 0.35,
  constructionRequiredTimber: 18,
  constructionRequiredStone: 12,
  constructionDeliveredTimber: 6,
  constructionDeliveredStone: 4,
} satisfies BuildingState;
roadFacingMarkers.syncBuildings([roadsideSmithy]);
const roadsideMarker = roadFacingParent.getObjectByName('Construction site');
assert.ok(roadsideMarker, 'the roadside construction marker should be rendered');
roadsideTerrainHeight = 3.5;
roadFacingMarkers.refreshTerrainHeights();
assert.equal(
  roadsideMarker.position.y,
  roadsideTerrainHeight,
  'terrain-pad elevation changes should also rebase non-camp building markers',
);
hydratingRoads.addRoadPath([
  new THREE.Vector3(-40, 0, 0),
  new THREE.Vector3(40, 0, 0),
]);
roadFacingMarkers.refreshRoadFacingOrientations();
const hydratedYaw = roadFacingMarkers.getRoadConnectionSources()[0]?.yaw;
assert.ok(
  hydratedYaw !== undefined && Math.abs(Math.abs(hydratedYaw) - Math.PI) < 0.01,
  'a building created before road hydration should turn its local +Z entrance toward the road',
);
roadFacingMarkers.dispose();
campMarkers.dispose();

const starterCampGate = {
  isSessionReady: () => true,
  isSettlementFounded: () => false,
  isRoadToolEnabled: () => false,
  isBuildingToolEnabled: () => true,
  isStarterCampPlacementActive: () => true,
  isBurgageToolEnabled: () => false,
  isFarmFieldToolEnabled: () => false,
  isFirstPersonActive: () => false,
  isMenuOpen: () => false,
} satisfies PlacementInteractionGate;
assert.equal(
  isWorldInspectionBlocked(starterCampGate),
  true,
  'resource markers should remain non-interactive during starter-camp placement',
);
assert.equal(
  isWorldResourceIconVisibilityBlocked(starterCampGate),
  false,
  'distant resource markers should remain visible while choosing the starter camp',
);
assert.equal(
  isWorldResourceIconVisibilityBlocked({
    ...starterCampGate,
    isStarterCampPlacementActive: () => false,
  }),
  false,
  'resource markers should remain visible during ordinary building placement',
);
assert.equal(
  isWorldResourceIconVisibilityBlocked({
    ...starterCampGate,
    isBuildingToolEnabled: () => false,
    isStarterCampPlacementActive: () => false,
    isBurgageToolEnabled: () => true,
  }),
  false,
  'resource markers should remain visible during burgage placement',
);
assert.equal(
  isWorldResourceIconVisibilityBlocked({
    ...starterCampGate,
    isBuildingToolEnabled: () => false,
    isStarterCampPlacementActive: () => false,
    isFarmFieldToolEnabled: () => true,
  }),
  false,
  'resource markers should remain visible during farm-field placement',
);

const bootstrapReducer = read('server/src/reducers/bootstrap.rs');
assert.match(
  bootstrapReducer,
  /pub fn bootstrap_founding_site[\s\S]*?if has_existing_settlement[\s\S]*?materialize_physical_resource_ledger_at[\s\S]*?\n\s*Ok\(\(\)\)\n}/,
  'world bootstrap should only migrate an existing legacy settlement',
);
assert.match(
  bootstrapReducer,
  /pub\(crate\) fn place_founding_camp[\s\S]*?kind: "founders_camp"[\s\S]*?physical_founding_site_enabled = true/,
  'player placement should create and activate the physical founding site',
);

const buildingReducer = read('server/src/reducers/buildings.rs');
assert.match(
  buildingReducer,
  /if kind == "founders_camp" \{\s*crate::reducers::bootstrap::place_founding_camp\(ctx, x, z\)\?;\s*return Ok\(0\);/,
  'ordinary building placement must route the founders camp to its one-time setup',
);
assert.doesNotMatch(
  buildingReducer,
  /is_open_water\(x, z\)/,
  'building placement must not consult the seed-agnostic server water proxy',
);
assert.match(
  buildingReducer,
  /Place the founders' camp before building the settlement/,
  'the server must reject ordinary construction before the camp is placed',
);

const toolbar = read('src/ui/BuildToolbar.ts');
const settlementHud = read('src/ui/SettlementHud.ts');
const settlementHudCss = read('src/ui/settlementHud.css');
assert.match(toolbar, />Place starter camp</);
assert.match(toolbar, /setStarterCampRequired\(required: boolean\)/);
assert.match(
  toolbar,
  /root\.insertAdjacentHTML\('beforeend'/,
  'mounting the toolbar must preserve the tutorial overlay already attached to the shared UI root',
);
assert.doesNotMatch(
  toolbar,
  /root\.innerHTML\s*=/,
  'mounting the toolbar must not detach an open tutorial while its input gate remains active',
);
assert.match(
  toolbar,
  /this\.constructionDock\.hidden = this\.firstPersonActive \|\| this\.starterCampRequired/,
  'the normal construction dock should be replaced until the camp exists',
);
assert.match(
  settlementHud,
  /setFirstPersonActive\(active: boolean\)[\s\S]*?this\.root\.hidden = active/,
  'first-person mode must mark the entire settlement HUD as hidden',
);
assert.match(
  settlementHudCss,
  /\.settlement-hud\[hidden\]\s*\{\s*display:\s*none;/,
  'the settlement HUD display rules must not override its first-person hidden state',
);

const app = read('src/app/App.ts');
assert.match(
  app,
  /physicalFoundingSiteEnabled !== true[\s\S]*setStarterCampRequired\(starterCampRequired\)/,
  'authoritative founding-site state should control the one-time HUD action',
);

const buildingTool = read('src/buildings/BuildingTool.ts');
assert.match(
  buildingTool,
  /buildingId && kind !== 'founders_camp'/,
  'the one-time founding action must not enter ordinary building undo history',
);
assert.doesNotMatch(
  buildingTool,
  /assessFoundingSite|describeFoundingSiteAssessment|Founding outlook/,
  'founding-camp placement should not reveal its calculated site quality',
);
assert.match(
  buildingTool,
  /if \(kind === 'founders_camp'\) \{\s*this\.setPlacementStatusDetail\(null\);\s*return;/,
  'the camp preview should communicate placement validity without status-bar copy',
);
assert.doesNotMatch(buildingTool, /Ready: click to establish the camp/);
assert.match(
  buildingTool,
  /onPlacementPreviewChanged\?\.\(\)/,
  'a changed advisory should refresh the visible builder status',
);
assert.match(
  buildingTool,
  /showPendingPlacement\(kind, x, z\);[\s\S]*?requestAnimationFrame[\s\S]*?onPlaceBuilding\(kind, x, z\)/,
  'the optimistic camp marker must paint before authoritative placement work starts',
);

const buildingMarkers = read('src/buildings/BuildingMarkers.ts');
const placedTerrainSync = read('src/app/placedBuildingTerrainSync.ts');
assert.match(
  placedTerrainSync,
  /updateTerrainBuildingPads\([\s\S]*?buildingMarkers\?\.refreshTerrainHeights\(\)/,
  'placed terrain pads must rebase building markers after changing the heightfield',
);
assert.match(
  buildingMarkers,
  /prewarmFoundersCampPlacement\(\)[\s\S]*?createBuildingMesh\('founders_camp'\)/,
  'the detailed founders camp should be constructed before the placement click',
);
assert.match(
  buildingMarkers,
  /beginFoundersCampGpuPrewarm\(\)[\s\S]*?this\.group\.add\(marker\)/,
  'the prebuilt camp should join the covered startup scene for shader compilation',
);
assert.match(
  app,
  /beginFoundersCampGpuPrewarm\(\)[\s\S]*?precompileFirstPlayableScene\(\)[\s\S]*?restoreFoundersCampPrewarm\(\)/,
  'startup should compile and then detach the founding-camp mesh before play',
);
assert.match(
  buildingMarkers,
  /building\.kind === 'founders_camp'[\s\S]*?this\.pendingPlacementKind === 'founders_camp'[\s\S]*?marker = this\.pendingPlacement/,
  'the authoritative camp must adopt the optimistic mesh instead of rebuilding it',
);

const tutorialOverlay = read('src/ui/TutorialOverlay.ts');
const buildToolbar = read('src/ui/BuildToolbar.ts');
assert.match(
  buildToolbar,
  /data-action="tutorials"[\s\S]*?construction-dock-button__question" aria-hidden="true">\?<\/span>[\s\S]*?data-action="settings"[\s\S]*?handlers\.onReplayTutorials\?\.\(\)/,
  'tutorial replay must have a question-mark dock control immediately before Settings',
);
assert.match(
  tutorialOverlay,
  /welcome:\s*\{[\s\S]*?Begin Your Settlement[\s\S]*?notifyWorldReady\(hasFoundersCamp: boolean\)[\s\S]*?this\.show\('welcome'\)/,
  'a fresh world must show first-step guidance without waiting for a later tool event',
);
assert.match(
  app,
  /onPresentationReady\(\);[\s\S]*?tutorialOverlay\?\.notifyWorldReady/,
  'the first tutorial must open after the playable presentation is visible',
);
assert.match(
  tutorialOverlay,
  /founding:\s*\{[\s\S]*?blocksGameplay: false/,
  'the first founding guidance must never lock camera or gameplay input',
);
assert.match(
  tutorialOverlay,
  /this\.root\.classList\.add\('is-visible'\);[\s\S]*?this\.options\.onOpenChange\?\.\(true\)/,
  'tutorial visibility must be committed before any open-state callback can gate input',
);
assert.match(
  tutorialOverlay,
  /replayAll\(\)[\s\S]*?setTutorialsSkipped\(false\)[\s\S]*?this\.shown\.clear\(\)[\s\S]*?TUTORIAL_ORDER/,
  'players must be able to clear the skip preference and replay the full tutorial sequence',
);
assert.match(
  tutorialOverlay,
  /if \(this\.isOpen\(\)\)[\s\S]*?this\.replayQueue\.push\(id\)[\s\S]*?return true/,
  'tutorial triggers that fire while guidance is open must queue instead of disappearing',
);
assert.match(
  read('src/ui/GameMenu.ts'),
  /data-replay-tutorials[\s\S]*?options\.onReplayTutorials\?\.\(\)/,
  'the settings menu must expose tutorial replay',
);
assert.match(
  read('src/app/appBootstrap.ts'),
  /isTutorialOpen: \(\) => tutorialOverlay\?\.isGameplayBlocking\(\)[\s\S]*?onOpenChange:[\s\S]*?isGameplayBlocking\(\)/,
  'camera and interaction gates should only honor modal tutorials',
);

assert.doesNotMatch(
  buildToolbar,
  /data-road-controls-panel|Active tool controls/,
  'placement guidance should not render a large instruction panel',
);
assert.match(
  buildToolbar,
  /data-builder-status/,
  'ordinary placement guidance should remain in the compact bottom status bar',
);
assert.match(
  buildToolbar,
  /builderStatusBar\.innerHTML = placingStarterCamp \? '' : renderToolbarStatus\(stats\);[\s\S]*?builderStatusBar\.hidden = this\.firstPersonActive[\s\S]*?\|\| placingStarterCamp/,
  'starter-camp placement should clear and hide the shared builder status bar',
);
assert.doesNotMatch(
  read('src/app/appBootstrap.ts'),
  /This temporary camp will support the settlement as it takes root/,
  'starter-camp placement should not show a redundant instructional toast',
);

const simulation = read('server/src/reducers/simulation.rs');
assert.match(
  simulation,
  /building\(\)\.iter\(\)\.next\(\)\.is_none\(\)[\s\S]*residence\(\)\.iter\(\)\.next\(\)\.is_none\(\)[\s\S]*return;/,
  'calendar and economy progression should wait for the first settlement site',
);

console.log(
  `Starter-camp placement flow checks passed (${profileElapsed.toFixed(1)} ms for 10,000 advisory assessments; `
  + `${campRevealElapsed.toFixed(2)} ms reveal; ${campConfirmationElapsed.toFixed(2)} ms confirmation; `
  + `${campResyncElapsed.toFixed(2)} ms unchanged resync; `
  + `${(campConfirmationArrayBufferGrowth / 1024).toFixed(1)} / `
  + `${(campResyncArrayBufferGrowth / 1024).toFixed(1)} KiB confirmation/resync ArrayBuffer growth).`,
);
