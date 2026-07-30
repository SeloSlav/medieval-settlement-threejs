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
import { createWorldLayout } from '../src/resources/WorldLayout.ts';
import { WorldLayoutRegistry } from '../src/resources/WorldLayoutRegistry.ts';
import { getBuildingDefinition } from '../src/resources/buildings.ts';
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
assert.ok(MINE_IRON_PER_CYCLE > 0);
assert.ok(MINE_SALT_PER_CYCLE > MINE_IRON_PER_CYCLE);
assert.ok(RICH_MINE_THROUGHPUT_MULTIPLIER > 1);

const mineMesh = createBuildingMesh('mine');
assert.equal(mineMesh.name, 'Mineral Mine');
assert.ok(mineMesh.getObjectByName('Mineral mine sorting floor'));
const ironStockpile = mineMesh.getObjectByName('IronMineStockpile');
const saltStockpile = mineMesh.getObjectByName('SaltMineStockpile');
assert.ok(ironStockpile, 'the mine needs a physical iron stockpile');
assert.ok(saltStockpile, 'the mine needs a physical salt stockpile');
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
].map((path) => readFileSync(path, 'utf8')).join('\n');
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
