import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateBuildingPlacement } from '../src/buildings/BuildingPlacementValidation.ts';
import {
  isWorldInspectionBlocked,
  isWorldResourceIconVisibilityBlocked,
  type PlacementInteractionGate,
} from '../src/input/PlacementInteractionGate.ts';

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

const simulation = read('server/src/reducers/simulation.rs');
assert.match(
  simulation,
  /building\(\)\.iter\(\)\.next\(\)\.is_none\(\)[\s\S]*residence\(\)\.iter\(\)\.next\(\)\.is_none\(\)[\s\S]*return;/,
  'calendar and economy progression should wait for the first settlement site',
);

console.log('Starter-camp placement flow checks passed.');
