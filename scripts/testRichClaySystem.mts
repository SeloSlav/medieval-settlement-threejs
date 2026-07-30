import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CLAY_BANK_ORDINARY_YIELD_MAX,
  CLAY_BANK_RICH_YIELD_THRESHOLD,
  clayBankYieldAt,
  clayBankYieldMultiplier,
  setActiveClayDepositLayout,
} from '../src/economy/clayBankPolicy.ts';
import {
  buildLayoutWorldMapMarkers,
  filterWorldMapForagingMarkers,
} from '../src/map/worldMapMarkers.ts';
import { CLAY_ICON_HTML } from '../src/map/resourceMapIconArt.ts';
import { createWorldLayout } from '../src/resources/WorldLayout.ts';
import { WorldLayoutRegistry } from '../src/resources/WorldLayoutRegistry.ts';
import { createRegionalResourcePlan } from '../src/world/regionalResourceDistribution.ts';
import {
  DEFAULT_WORLD_GENERATION_SETTINGS,
  type WorldGenerationSettings,
} from '../src/world/worldGenerationSettings.ts';

const richSettings = findSettings((settings) =>
  createRegionalResourcePlan(settings).richClayDepositCount > 0
);
const layout = createWorldLayout(richSettings);
const richClay = layout.clayDepositLayout.sites.find((site) => site.kind === 'rich');
assert.ok(richClay, 'at least one deterministic seed must roll a rich clay deposit');
assert.equal(
  layout.clayDepositLayout.sites.filter((site) => site.kind === 'ordinary').length,
  layout.resourcePlan.ordinaryClayDepositCount,
);

setActiveClayDepositLayout(layout.clayDepositLayout);
assert.ok(
  clayBankYieldAt(richClay.x, richClay.z, 50) >= CLAY_BANK_RICH_YIELD_THRESHOLD,
  'a generated rich clay landmark must grade as rich',
);
setActiveClayDepositLayout(null);

assert.ok(
  clayBankYieldMultiplier(1, 100) <= CLAY_BANK_ORDINARY_YIELD_MAX,
  'ordinary shoreline must remain below the explicit rich-deposit tier',
);

const registry = WorldLayoutRegistry.fromWorldLayout(layout);
const markers = buildLayoutWorldMapMarkers(registry, layout.clayDepositLayout.sites);
assert.deepEqual(
  new Set(markers.filter((marker) => marker.kind === 'clay').map((marker) => marker.label)),
  new Set(['Clay deposit', 'Rich clay deposit']),
  'the world map must distinguish ordinary and rich physical clay banks',
);
assert.equal(
  filterWorldMapForagingMarkers(markers).filter((marker) => marker.kind === 'clay').length,
  layout.clayDepositLayout.sites.length,
  'all physical clay deposits must reach the projected far-zoom resource layer',
);
assert.ok(CLAY_ICON_HTML.includes('map-resource-icon-glyph--clay'));
const atlas = readFileSync('public/assets/ui/icons/map-resources.png');
assert.ok(
  atlas.byteLength > 350_000,
  'the clay sprite cell must be populated rather than pointing at the old blank atlas slot',
);

const generatedForaging = JSON.parse(
  readFileSync('server/generated/world_foraging.json', 'utf8'),
) as {
  foragingNodes: Array<{
    nodeId: string;
    nodeKind: string;
    x: number;
    z: number;
  }>;
};
const generatedClay = generatedForaging.foragingNodes.filter(
  (node) => node.nodeKind === 'clay',
);
const defaultLayout = createWorldLayout(DEFAULT_WORLD_GENERATION_SETTINGS);
assert.equal(generatedClay.length, defaultLayout.clayDepositLayout.sites.length);
for (let index = 0; index < defaultLayout.clayDepositLayout.sites.length; index++) {
  const site = defaultLayout.clayDepositLayout.sites[index];
  const expectedId = `clay-${site.kind}-${index}`;
  const row = generatedClay.find((node) => node.nodeId === expectedId);
  assert.ok(row, `missing generated clay row ${expectedId}`);
  assert.ok(Math.hypot(row.x - site.x, row.z - site.z) < 1e-6);
}

const authority = readFileSync('server/src/hydrology/mod.rs', 'utf8');
const clayPitSimulation = readFileSync(
  'server/src/simulation/expanded_economy.rs',
  'utf8',
);
const buildingReducer = readFileSync('server/src/reducers/buildings.rs', 'utf8');
assert.match(clayPitSimulation, /node\.node_kind == "clay"/);
assert.match(clayPitSimulation, /RICH_CLAY_DEPOSIT_RADIUS/);
assert.match(clayPitSimulation, /clay_bank_yield_multiplier_at_with_deposits/);
assert.match(authority, /clay_bank_yield_multiplier_with_richness/);
assert.match(
  buildingReducer,
  /on_generated_clay_bank[\s\S]*RICH_CLAY_DEPOSIT_RADIUS[\s\S]*"clay"/,
  'the generated bank must remain buildable when a non-default river seed diverges from the static authority grid',
);
assert.match(
  clayPitSimulation,
  /node\.node_id\.starts_with\("clay-rich-"\)/,
  'ordinary physical clay banks must not receive the rich-deposit multiplier',
);

const tableSync = readFileSync(
  'src/data/spacetimeTableSync/syncForagingNodes.ts',
  'utf8',
);
assert.match(
  tableSync,
  /row\.nodeKind === 'clay'\) continue/,
  'the geological authority row must not masquerade as a harvestable forage node',
);

console.log('rich clay system tests passed');

function findSettings(
  predicate: (settings: WorldGenerationSettings) => boolean,
): WorldGenerationSettings {
  for (let seed = 1; seed <= 512; seed++) {
    const settings = { ...DEFAULT_WORLD_GENERATION_SETTINGS, seed };
    if (predicate(settings)) return settings;
  }
  throw new Error('unable to find a representative world seed');
}
