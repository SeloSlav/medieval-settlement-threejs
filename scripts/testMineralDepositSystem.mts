import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { createBuildingMesh } from '../src/buildings/BuildingMeshes.ts';
import {
  createMineralDepositRoster,
  mineralDepositLabel,
  mineralDepositMaxYield,
  mineralDepositNodeId,
} from '../src/minerals/MineralDepositLayout.ts';
import {
  BUILDING_STORAGE_CAPS,
  MINE_IRON_PER_CYCLE,
  MINE_SALT_PER_CYCLE,
  RICH_MINE_THROUGHPUT_MULTIPLIER,
} from '../src/generated/gameBalance.ts';
import {
  IRON_ICON_HTML,
  SALT_ICON_HTML,
} from '../src/map/resourceMapIconArt.ts';
import { buildLayoutWorldMapMarkers } from '../src/map/worldMapMarkers.ts';
import { renderMineralMineInspector } from '../src/resources/inspector/mineralMineRenderer.ts';
import { renderLargeQuarryInspector } from '../src/resources/inspector/largeQuarryRenderer.ts';
import type { InspectorRenderContext } from '../src/resources/inspector/renderInspectableTarget.ts';
import {
  computePopulationStats,
  computeResourceTotals,
} from '../src/resources/resourceTotals.ts';
import { findNearestResourceNodeWithRemaining } from '../src/resources/depletableNodes.ts';
import { createWorldLayout } from '../src/resources/WorldLayout.ts';
import { WorldLayoutRegistry } from '../src/resources/WorldLayoutRegistry.ts';
import { getBuildingDefinition } from '../src/resources/buildings.ts';
import {
  createEmptyStockpile,
  type BuildingState,
  type GameState,
  type ResourceNodeState,
} from '../src/resources/types.ts';
import type { WorldQueries } from '../src/resources/WorldQueries.ts';
import { createRegionalResourcePlan } from '../src/world/regionalResourceDistribution.ts';
import {
  DEFAULT_WORLD_GENERATION_SETTINGS,
  deriveSubSeed,
  resolveWorldDimensions,
  type WorldGenerationSettings,
  type WorldMapSize,
} from '../src/world/worldGenerationSettings.ts';

const mapSizes: WorldMapSize[] = ['small', 'medium', 'large'];
for (const mapSize of mapSizes) {
  for (const seed of [1, 7, 31]) {
    const settings = worldSettings({ mapSize, seed });
    const layout = createWorldLayout(settings);
    const expectedRich = layout.resourcePlan.richMineralDepositCount;
    const expectedTotal = expectedRich + layout.resourcePlan.ordinaryMineralDepositCount;
    const dims = resolveWorldDimensions(mapSize);

    assert.equal(
      layout.mineralDepositLayout.sites.length,
      expectedTotal,
      `${mapSize}/seed-${seed} must place its full underground-resource budget`,
    );
    assert.equal(
      layout.mineralDepositLayout.sites.filter((site) => site.grade === 'rich').length,
      expectedRich,
      `${mapSize}/seed-${seed} must preserve its seeded rich-deposit count`,
    );
    assert.deepEqual(
      new Set(layout.mineralDepositLayout.sites.map((site) => site.resource)),
      new Set(['iron', 'salt']),
      `${mapSize}/seed-${seed} must expose physical deposits of both materials`,
    );
    for (const site of layout.mineralDepositLayout.sites) {
      assert.ok(site.resource === 'iron' || site.resource === 'salt');
      assert.equal(
        layout.riverLayout.isWaterAt(site.x, site.z),
        false,
        `${mineralDepositLabel(site)} cannot spawn in open water`,
      );
      assert.ok(Math.abs(site.x) < dims.playableHalf);
      assert.ok(Math.abs(site.z) < dims.playableHalf);
    }
  }
}

let sawIron = false;
let sawSalt = false;
let sawLargeWithBoth = false;
let sawRichMineral = false;
const largeRichCounts = new Set<number>();
for (let seed = 1; seed <= 256; seed++) {
  const settings = worldSettings({
    seed,
    mapSize: 'large',
    resourceAbundance: 50,
    resourceVariety: 50,
  });
  const plan = createRegionalResourcePlan(settings);
  const roster = createMineralDepositRoster({
    seed: deriveSubSeed(seed, 'iron-salt-deposits'),
    mapSize: settings.mapSize,
    richSiteCount: plan.richMineralDepositCount,
    ordinarySiteCount: plan.ordinaryMineralDepositCount,
    resourceVariety: settings.resourceVariety,
  });
  const resources = new Set(roster.map((site) => site.resource));
  sawIron ||= resources.has('iron');
  sawSalt ||= resources.has('salt');
  sawLargeWithBoth ||= resources.size === 2;
  sawRichMineral ||= roster.some((site) => site.grade === 'rich');
  largeRichCounts.add(roster.filter((site) => site.grade === 'rich').length);
}
assert.ok(sawIron && sawSalt, 'different seeds must support either raw resource');
assert.ok(sawLargeWithBoth, 'every region should physically support both iron and salt');
assert.ok(sawRichMineral && largeRichCounts.size > 1, 'large-map rich mineral counts must vary by seed');

const defaultLayout = createWorldLayout(DEFAULT_WORLD_GENERATION_SETTINGS);
const registry = WorldLayoutRegistry.fromWorldLayout(defaultLayout);
const mineralDefinitions = registry.definitionList.filter(
  (definition) =>
    definition.kind === 'quarry'
    && (definition.resource === 'iron' || definition.resource === 'salt'),
);
assert.equal(
  mineralDefinitions.length,
  defaultLayout.mineralDepositLayout.sites.length,
);
for (let index = 0; index < defaultLayout.mineralDepositLayout.sites.length; index++) {
  const site = defaultLayout.mineralDepositLayout.sites[index];
  const definition = mineralDefinitions.find(
    (candidate) => candidate.id === mineralDepositNodeId(site, index),
  );
  assert.ok(definition, `missing registry row for ${mineralDepositLabel(site)}`);
  assert.equal(definition.label, mineralDepositLabel(site));
  assert.equal(definition.maxYield, mineralDepositMaxYield(site));
  assert.equal(definition.isRich, site.grade === 'rich');
}

const markers = buildLayoutWorldMapMarkers(
  registry,
  defaultLayout.clayDepositLayout.sites,
);
assert.equal(
  markers.filter((marker) => marker.resource === 'iron' || marker.resource === 'salt').length,
  mineralDefinitions.length,
  'iron and salt deposits must reach the far-zoom resource map',
);
assert.ok(IRON_ICON_HTML.includes('map-resource-icon-glyph--iron'));
assert.ok(SALT_ICON_HTML.includes('map-resource-icon-glyph--salt'));

const generated = JSON.parse(
  readFileSync('server/generated/world_quarries.json', 'utf8'),
) as {
  quarries: Array<{
    quarryId: string;
    maxYield: number;
    isRich: boolean;
  }>;
};
const generatedMinerals = generated.quarries.filter(
  (quarry) => quarry.quarryId.startsWith('deposit-'),
);
assert.deepEqual(
  generatedMinerals.map((quarry) => quarry.quarryId),
  mineralDefinitions.map((definition) => definition.id),
  'generated authority rows must use the same deterministic deposit IDs as the client',
);
assert.ok(
  generatedMinerals.every((quarry) =>
    quarry.quarryId.startsWith('deposit-iron-')
    || quarry.quarryId.startsWith('deposit-salt-')
  ),
);

const mine = getBuildingDefinition('mine');
assert.equal(mine.acceptsLabor, true);
assert.equal(mine.requiresRoad, true);
assert.equal(mine.maxLabor, 4);
assert.equal(BUILDING_STORAGE_CAPS.mine.iron, 240);
assert.equal(BUILDING_STORAGE_CAPS.mine.salt, 240);
assert.equal(BUILDING_STORAGE_CAPS.mine.ironwork, 3);
assert.ok(MINE_IRON_PER_CYCLE > 0);
assert.ok(MINE_SALT_PER_CYCLE > MINE_IRON_PER_CYCLE);
assert.ok(RICH_MINE_THROUGHPUT_MULTIPLIER > 1);

const mineMesh = createBuildingMesh('mine');
assert.equal(mineMesh.name, 'Mineral Mine');
assert.ok(mineMesh.getObjectByName('Mineral mine sorting floor'));
const ironStockpile = mineMesh.getObjectByName('IronMineStockpile');
const saltStockpile = mineMesh.getObjectByName('SaltMineStockpile');
const toolStockpile = mineMesh.getObjectByName('CivilianToolStockpile');
assert.ok(ironStockpile, 'the mine needs a physical iron stockpile');
assert.ok(saltStockpile, 'the mine needs a physical salt stockpile');
assert.ok(toolStockpile, 'the mine needs a physical replacement-tool rack');
assert.equal(
  ironStockpile.children.filter((child) => child.name === 'IronMineOreSegment').length,
  6,
  'iron inventory must visibly rise and fall in discrete ore piles',
);
assert.equal(
  saltStockpile.children.filter((child) => child.name === 'SaltMineSaltSegment').length,
  6,
  'salt inventory must visibly rise and fall in discrete rock-salt piles',
);
mineMesh.traverse((object) => {
  if (object instanceof THREE.Mesh) object.geometry.dispose();
});

const authority = readFileSync(
  'server/src/simulation/expanded_economy.rs',
  'utf8',
);
const mineStart = authority.indexOf('pub fn step_mine');
const mineEnd = authority.indexOf('pub fn step_granary', mineStart);
assert.ok(mineStart >= 0 && mineEnd > mineStart);
const mineStep = authority.slice(mineStart, mineEnd);
assert.match(mineStep, /deposit-iron-/);
assert.match(mineStep, /deposit-salt-/);
assert.match(mineStep, /RICH_MINE_THROUGHPUT_MULTIPLIER/);
assert.match(mineStep, /civilian_tool_throughput_multiplier\(building\.ironwork\)/);
assert.match(
  mineStep,
  /tools_maintained && produced > 1e-6[\s\S]*CommodityKind::Ironwork[\s\S]*CIVILIAN_TOOL_IRONWORK_PER_CYCLE/,
  'mine tools must wear only after a completed physical extraction batch',
);
assert.match(
  mineStep,
  /if produced > 1e-6 && !deposit\.is_rich[\s\S]*remaining:/,
  'ordinary deposits must deplete while rich deposits remain a deep source',
);
assert.match(
  authority,
  /"mine" if source\.iron[\s\S]*CommodityKind::Iron[\s\S]*"mine" if source\.salt[\s\S]*CommodityKind::Salt/,
  'mines must physically dispatch their extracted commodity to matching processors',
);

const ordinaryIronDeposit = mineralNode(
  'deposit-iron-ordinary-inspector',
  'iron',
  0,
  0,
  75,
  300,
  false,
);
const inspectorMine = mineBuilding({ assignedLabor: 2, iron: 12 });
let inspectorState = inspectorGameState(inspectorMine, [ordinaryIronDeposit]);
let mineInspector = renderMineralMineInspector(
  buildingTarget(inspectorMine),
  inspectorContext(inspectorState),
);
assert.equal(mineInspector.eyebrow, 'Ordinary iron mine');
assert.match(mineInspector.statusText, /Extracting finite iron seam - 75 reserve remains/);
assert.match(mineInspector.detailsHtml, /Ordinary iron-bearing ore seam - finite/);
assert.match(mineInspector.detailsHtml, /75 \/ 300 iron-bearing ore/);
assert.match(mineInspector.detailsHtml, /Mine carts serve road-linked smithies/);
assert.match(mineInspector.detailsHtml, /Baseline hand tools/);
assert.match(mineInspector.detailsHtml, /smithy handcart restores a 3-cycle buffer/);

const richSaltDeposit = mineralNode(
  'deposit-salt-rich-inspector',
  'salt',
  0,
  0,
  0,
  1_080,
  true,
);
inspectorState = inspectorGameState(inspectorMine, [richSaltDeposit]);
mineInspector = renderMineralMineInspector(
  buildingTarget(inspectorMine),
  inspectorContext(inspectorState),
);
assert.equal(mineInspector.eyebrow, 'Rich salt mine');
assert.match(mineInspector.statusText, /Extracting rich deep salt - source does not deplete/);
assert.match(mineInspector.detailsHtml, /50% faster deep working/);

const exhaustedIron = { ...ordinaryIronDeposit, remaining: 0 };
inspectorState = inspectorGameState(inspectorMine, [exhaustedIron]);
mineInspector = renderMineralMineInspector(
  buildingTarget(inspectorMine),
  inspectorContext(inspectorState),
);
assert.equal(mineInspector.statusState, 'warning');
assert.match(mineInspector.statusText, /Exhausted - finite iron seam is spent/);
assert.match(mineInspector.detailsHtml, /Production interval<\/span><span>paused/);

const richSaltNearQuarry = {
  ...richSaltDeposit,
  x: 100,
  nodeId: 'deposit-salt-rich-near-large-quarry',
};
const largeQuarryBuilding = mineBuilding({
  id: 'large-quarry-inspector',
  kind: 'large_quarry',
  x: 100,
  assignedLabor: 2,
});
const largeQuarryState = inspectorGameState(
  largeQuarryBuilding,
  [richSaltNearQuarry],
);
const largeQuarryInspector = renderLargeQuarryInspector(
  buildingTarget(largeQuarryBuilding),
  inspectorContext(largeQuarryState),
);
assert.match(
  largeQuarryInspector.statusText,
  /no rich underground source beneath the shaft/,
  'a rich mineral deposit must not masquerade as a rich stone source in the inspector',
);

const nearbySalt = mineralNode('deposit-salt-nearby', 'salt', 0, 0, 90, 90, false);
const fartherStone: ResourceNodeState = {
  ...nearbySalt,
  nodeId: 'quarry-stone-farther',
  resource: 'stone',
  x: 12,
};
assert.equal(
  findNearestResourceNodeWithRemaining(
    [nearbySalt, fartherStone],
    0,
    0,
    20,
    'quarry',
    'stone',
  )?.nodeId,
  fartherStone.nodeId,
  'stone queries must ignore a closer mineral landmark',
);

const sync = readFileSync(
  'src/data/spacetimeTableSync/syncQuarries.ts',
  'utf8',
);
assert.match(sync, /deposit-iron-/);
assert.match(sync, /deposit-salt-/);

const uiSurfaces = [
  'index.html',
  'src/ui/WorldSetupPanel.ts',
  'src/ui/SettlementHud.ts',
  'src/ui/buildMenuCards.ts',
  'src/resources/inspector/quarryRenderer.ts',
  'src/resources/inspector/mineralMineRenderer.ts',
].map((path) => readFileSync(path, 'utf8')).join('\n');
const buildingInspectorSource = readFileSync(
  'src/resources/inspector/buildingRenderer.ts',
  'utf8',
);
assert.match(
  buildingInspectorSource,
  /case 'mine':[\s\S]*renderMineralMineInspector/,
  'mine selection must route through the deposit-aware inspector',
);
assert.doesNotMatch(
  uiSurfaces,
  /Gorski[\s-]?Kotar/i,
  'the background reference region must not be surfaced in player-facing UI',
);
assert.match(
  uiSurfaces,
  /iron or salt deposit/i,
  'player-facing UI must explain that both mineral resources have real deposits',
);
assert.match(
  uiSurfaces,
  /Every region has finite physical iron seams/,
  'the HUD must teach the guaranteed physical iron source',
);
assert.match(
  uiSurfaces,
  /Every region has finite physical salt deposits/,
  'the HUD must teach the guaranteed physical salt source',
);
assert.doesNotMatch(
  uiSurfaces,
  /Some regions have local deposits; others must import/,
  'legacy import-only mineral guidance must not return',
);
assert.match(
  uiSurfaces,
  /\/assets\/ui\/build-menu\/cards\/iron-mine\.webp/,
  'the mine card must use its distinct generated artwork',
);

console.log('iron and salt deposit system tests passed');

function worldSettings(
  overrides: Partial<WorldGenerationSettings>,
): WorldGenerationSettings {
  return {
    ...DEFAULT_WORLD_GENERATION_SETTINGS,
    ...overrides,
  };
}

function mineBuilding(
  overrides: Partial<BuildingState> = {},
): BuildingState {
  return {
    id: 'mine-inspector',
    kind: 'mine',
    x: 0,
    z: 0,
    workRadius: 0,
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
    wool: 0,
    flax: 0,
    cloth: 0,
    ironwork: 0,
    polearms: 0,
    iron: 0,
    clay: 0,
    salt: 0,
    charcoal: 0,
    pottery: 0,
    gold: 0,
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
    storehouseAcceptsTimber: false,
    storehouseAcceptsStone: false,
    storehouseAcceptsFirewood: false,
    constructionPriority: 2,
    ...overrides,
  };
}

function mineralNode(
  nodeId: string,
  resource: 'iron' | 'salt',
  x: number,
  z: number,
  remaining: number,
  maxYield: number,
  isRich: boolean,
): ResourceNodeState {
  return {
    nodeId,
    kind: 'quarry',
    resource,
    x,
    z,
    remaining,
    maxYield,
    isRich,
  };
}

function inspectorGameState(
  building: BuildingState,
  deposits: ResourceNodeState[],
): GameState {
  return {
    seed: 1,
    tick: 0,
    stockpile: createEmptyStockpile(),
    quarries: new Map(deposits.map((deposit) => [deposit.nodeId, deposit])),
    foragingNodes: new Map(),
    trees: new Map(),
    buildings: new Map([[building.id, building]]),
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

function buildingTarget(building: BuildingState) {
  return {
    kind: 'building' as const,
    building,
    matureTrees: 0,
    stumpTrees: 0,
    growingTrees: 0,
  };
}

function inspectorContext(state: GameState): InspectorRenderContext {
  const worldQueries = {
    getActiveDeliveryTrip: () => null,
    getBuildingLabel: (kind: BuildingState['kind']) =>
      getBuildingDefinition(kind).label,
    getRoadAccessLabel: () => 'Road connected',
  } as unknown as WorldQueries;
  return {
    gameState: state,
    worldQueries,
    populationStats: computePopulationStats(state),
    resourceTotals: computeResourceTotals(state),
    worldHydrology: 0.5,
  };
}
