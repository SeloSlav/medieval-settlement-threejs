import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateBuildingPlacement } from '../src/buildings/BuildingPlacementValidation.ts';
import {
  isWorldInspectionBlocked,
  isWorldResourceIconVisibilityBlocked,
  type PlacementInteractionGate,
} from '../src/input/PlacementInteractionGate.ts';
import type { ForagingNodeState, ResourceNodeState } from '../src/resources/types.ts';
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
    isQuarryPitAt: () => false,
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
assert.equal(treeQueries, 1, 'the preview should make one spatial tree query');
assert.equal(groundwaterSamples, 9, 'the preview should use one camp and eight bounded field samples');
assert.equal(terrainSamples, 32, 'the preview should use four height probes at eight field samples');
assert.match(
  describeFoundingSiteAssessment(promisingSite),
  /Founding outlook: promising[\s\S]*water 85%[\s\S]*timber 48 nearby[\s\S]*stone 80 m[\s\S]*wild food 60 m/,
  'the preview should expose the tradeoffs behind its rating',
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
  'the live founding outlook should replace the generic building-placement text',
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
    isQuarryPitAt: () => false,
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
  'the preview must not misreport an unloaded forest as zero timber',
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
  true,
  'ordinary building placement should retain the existing marker decluttering behavior',
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
  /if kind == "founders_camp" \{\s*return crate::reducers::bootstrap::place_founding_camp\(ctx, x, z\);/,
  'ordinary building placement must route the founders camp to its one-time setup',
);
assert.match(
  buildingReducer,
  /Place the founders' camp before building the settlement/,
  'the server must reject ordinary construction before the camp is placed',
);

const toolbar = read('src/ui/BuildToolbar.ts');
assert.match(toolbar, />Place starter camp</);
assert.match(toolbar, /setStarterCampRequired\(required: boolean\)/);
assert.match(
  toolbar,
  /this\.constructionDock\.hidden = this\.firstPersonActive \|\| this\.starterCampRequired/,
  'the normal construction dock should be replaced until the camp exists',
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
assert.match(
  buildingTool,
  /if \(!validation\.ok\)[\s\S]*?return;[\s\S]*?if \(kind !== 'founders_camp'\)[\s\S]*?return;[\s\S]*?assessFoundingSite\(/,
  'only valid founding-camp previews should calculate advisory site quality',
);
assert.match(
  buildingTool,
  /onPlacementPreviewChanged\?\.\(\)/,
  'a changed advisory should refresh the visible builder status',
);

const toolbarStatus = read('src/ui/buildToolbarStatus.ts');
assert.match(
  toolbarStatus,
  /Compare water, timber, stone, food, and field ground[\s\S]*advice only; no site is blocked/,
  'founding help must explicitly explain that the logistics outlook is non-binding',
);

const simulation = read('server/src/reducers/simulation.rs');
assert.match(
  simulation,
  /building\(\)\.iter\(\)\.next\(\)\.is_none\(\)[\s\S]*residence\(\)\.iter\(\)\.next\(\)\.is_none\(\)[\s\S]*return;/,
  'calendar and economy progression should wait for the first settlement site',
);

console.log(
  `Starter-camp placement flow checks passed (${profileElapsed.toFixed(1)} ms for 10,000 advisory assessments).`,
);
