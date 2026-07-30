import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  resolveBuildingPlacementPoint,
  validateBuildingPlacement,
} from '../src/buildings/BuildingPlacementValidation.ts';
import {
  clayDepositAtCenter,
} from '../src/clay/ClayDepositLayout.ts';
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
import {
  createPhysicalDepositFootprints,
  isPhysicalDepositAt,
  polygonOverlapsPhysicalDeposit,
} from '../src/resources/physicalDepositProtection.ts';
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
const ordinaryClay = layout.clayDepositLayout.sites.find((site) => site.kind === 'ordinary');
assert.ok(ordinaryClay, 'every region must retain an ordinary physical clay deposit');
const physicalDeposits = createPhysicalDepositFootprints(layout);
const resources = new Set(physicalDeposits.map((deposit) => deposit.resource));
assert.deepEqual(
  resources,
  new Set(['stone', 'clay', 'iron', 'salt']),
  'one placement model must protect every generated physical deposit family',
);
assert.equal(
  isPhysicalDepositAt(physicalDeposits, ordinaryClay.x, ordinaryClay.z),
  true,
  'ordinary clay must participate in physical-deposit placement protection',
);
assert.equal(
  polygonOverlapsPhysicalDeposit([
    { x: ordinaryClay.x - 40, z: ordinaryClay.z - 40 },
    { x: ordinaryClay.x + 40, z: ordinaryClay.z - 40 },
    { x: ordinaryClay.x + 40, z: ordinaryClay.z + 40 },
    { x: ordinaryClay.x - 40, z: ordinaryClay.z + 40 },
  ], physicalDeposits),
  true,
  'a parcel must detect a clay bank enclosed between all four corners',
);
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

assert.equal(
  clayDepositAtCenter(layout.clayDepositLayout.sites, ordinaryClay.x, ordinaryClay.z),
  ordinaryClay,
);
assert.deepEqual(
  resolveBuildingPlacementPoint(
    'clay_pit',
    richClay.x + 24,
    richClay.z - 12,
    [],
    layout.clayDepositLayout.sites,
  ),
  { x: richClay.x, z: richClay.z },
  'clicking near a marked bank must snap the Clay Pit to its authoritative center',
);

const placementContext = {
  buildings: [],
  residences: [],
  burgageZones: [],
  quarries: [],
  foragingNodes: [],
  clayDepositSites: layout.clayDepositLayout.sites,
  stockpile: { timber: 10_000, stone: 10_000, ironwork: 10_000 },
  isWaterAt: () => true,
  isResourceDepositAt: (x: number, z: number) =>
    isPhysicalDepositAt(physicalDeposits, x, z),
  getNaturalHeightAt: () => 0,
};
assert.equal(
  validateBuildingPlacement(
    'clay_pit',
    ordinaryClay.x,
    ordinaryClay.z,
    placementContext,
  ).ok,
  true,
  'an ordinary generated clay bank must be a valid authoritative extraction site',
);
assert.equal(
  validateBuildingPlacement(
    'clay_pit',
    richClay.x,
    richClay.z,
    placementContext,
  ).ok,
  true,
  'a rich generated clay bank must be a valid authoritative extraction site',
);
assert.deepEqual(
  validateBuildingPlacement('smithy', richClay.x, richClay.z, {
    ...placementContext,
    isWaterAt: () => false,
  }),
  { ok: false, reason: 'on_resource_deposit' },
  'an unrelated building must not erase a generated clay landmark',
);
assert.deepEqual(
  validateBuildingPlacement('clay_pit', 0, 0, {
    ...placementContext,
    clayDepositSites: [],
    isWaterAt: (x, z) => Math.hypot(x, z - 8) < 1.5,
  }),
  { ok: false, reason: 'requires_clay_deposit' },
  'an arbitrary usable shoreline must not create clay without a generated deposit',
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
assert.match(clayPitSimulation, /deposit\.node_kind == "clay"/);
assert.match(clayPitSimulation, /clay_deposit_beneath/);
assert.match(clayPitSimulation, /clay_bank_yield_multiplier_at_deposit/);
assert.match(authority, /clay_bank_yield_multiplier_with_richness/);
assert.match(
  buildingReducer,
  /has_clay_deposit_at_center[\s\S]*on_generated_clay_bank[\s\S]*is_on_resource_deposit[\s\S]*kind == "clay_pit" && !on_generated_clay_bank/,
  'authority must require the Clay Pit to sit on an ordinary or rich generated deposit',
);
assert.match(
  buildingReducer,
  /fn clay_source_usable[\s\S]*"clay_pit" =>[\s\S]*clay_source_usable/,
  'the production steward must treat an off-deposit legacy Clay Pit as source-stalled',
);
assert.match(
  clayPitSimulation,
  /deposit\.node_id\.starts_with\("clay-rich-"\)/,
  'ordinary physical clay banks must not receive the rich-deposit multiplier',
);
assert.match(
  clayPitSimulation,
  /let Some\(deposit\) = clay_deposit_beneath[\s\S]*else \{\s*return;/,
  'legacy off-bank Clay Pits must stall rather than creating clay from a background shoreline score',
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
