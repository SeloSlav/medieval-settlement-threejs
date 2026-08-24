import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

function source(path: string): string {
  assert.ok(existsSync(path), `missing multi-town implementation file: ${path}`);
  return readFileSync(path, 'utf8');
}

const tables = source('server/src/tables.rs');
const subscriptions = source('src/data/gameTableSubscriptions.ts');
const generatedSettlement = source('src/generated/settlement_table.ts');
const generatedIndex = source('src/generated/index.ts');
const gameTypes = source('src/resources/types.ts');
const syncState = source('src/data/spacetimeTableSync/gameTableSyncState.ts');
const syncSettlements = source('src/data/spacetimeTableSync/syncSettlements.ts');
const tableSync = source('src/data/spacetimeTableSync/gameTableSync.ts');

assert.match(tables, /accessor\s*=\s*settlement[\s\S]*pub struct Settlement/);
for (const field of [
  'founding_camp_id',
  'town_hall_id',
  'founder_population',
  'unhoused_founders',
] as const) {
  assert.match(tables, new RegExp(`pub ${field}:`), `Settlement is missing ${field}`);
}
for (const tableName of ['Building', 'BurgageZone', 'Residence'] as const) {
  assert.match(
    tables,
    new RegExp(`pub struct ${tableName}[\\s\\S]*?pub settlement_id: u64,`),
    `${tableName} needs sticky community identity`,
  );
}
assert.match(subscriptions, /'settlement'/);
assert.match(generatedSettlement, /foundingCampId:[\s\S]*unhousedFounders:/);
assert.match(generatedIndex, /settlement:\s*__table/);
assert.match(gameTypes, /export type SettlementState/);
assert.match(gameTypes, /settlements:\s*Map<string, SettlementState>/);
assert.match(syncState, /settlements:\s*Map<string, SettlementState>/);
assert.match(syncSettlements, /export function syncSettlements/);
assert.match(tableSync, /syncSettlements/);
assert.match(
  tableSync,
  /db\.settlement[\s\S]*onInsert[\s\S]*onUpdate[\s\S]*onDelete/,
  'settlement replication must handle the full lifecycle, including camp-independent persistence',
);

const foundingSite = source('server/src/simulation/founding_site.rs');
const population = source('server/src/economy/population.rs');
const residenceSettlement = source('server/src/simulation/residence_settlement.rs');
assert.match(
  foundingSite,
  /settlement_id|founding_camp_id/,
  'every camp lifecycle pass must resolve its own durable settlement',
);
assert.match(
  foundingSite,
  /unhoused_founders/,
  'shelter retirement must use the camp cohort rather than owner-wide housing',
);
assert.doesNotMatch(
  foundingSite,
  /filter\(is_bootstrap_founders_camp\)/,
  'paid expansion camps must enter the same temporary-camp lifecycle',
);
assert.doesNotMatch(
  foundingSite,
  /\|\|\s*!has_town_hall|\|\|\s*!has_storehouse/,
  'an empty camp must retire from physical state, not wait on blanket civic-building prerequisites',
);
assert.match(
  population,
  /unhoused_founders/,
  'realm population must sum each still-homeless founding cohort',
);
assert.match(
  residenceSettlement,
  /settlement_id[\s\S]*unhoused_founders/,
  'a home must consume founders only from its own community before attracting a new migrant',
);

const buildingReducer = source('server/src/reducers/buildings.rs');
assert.match(
  buildingReducer,
  /kind == "town_hall"[\s\S]*settlement_id/,
  'Town Hall placement must resolve the candidate community',
);
assert.match(
  buildingReducer,
  /building\.kind == "town_hall"[\s\S]{0,260}building\.settlement_id/,
  'Town Hall uniqueness must be scoped to one community rather than the whole owner',
);

const villageAdmin = source('server/src/reducers/village_admin.rs');
for (const reducer of [
  'set_night_policies',
  'set_economic_activity_tax_rate',
  'set_pantry_safeguard_policy',
  'set_fiscal_policy',
  'set_seasonal_labor_steward',
  'set_construction_labor_steward',
  'set_production_labor_steward',
  'set_labor_steward_reserve',
] as const) {
  assert.match(
    villageAdmin,
    new RegExp(`pub fn ${reducer}\\([\\s\\S]{0,260}(town_hall_id|settlement_id)`),
    `${reducer} must identify the selected local administration`,
  );
}
assert.match(
  villageAdmin,
  /ctx\.db\.settlement\(\)/,
  'Town Hall policy changes must update community policy rather than only PlayerResources',
);

const resourceTotals = source('src/resources/resourceTotals.ts');
const workforceCommute = source('server/src/simulation/workforce_commute.rs');
const storehouse = source('server/src/simulation/village_storehouse.rs');
assert.doesNotMatch(
  resourceTotals,
  /activeSettlementId|selectedSettlementId|settlementFilter/,
  'the lord-facing Total/Surplus ledger must never switch to a selected-town wallet',
);
assert.doesNotMatch(
  workforceCommute,
  /\.filter\([^\n]*settlement_id|\.settlement_id\s*==/,
  'town identity is porous: commute time and work camps, not a border, constrain workers',
);
assert.doesNotMatch(
  storehouse,
  /\.filter\([^\n]*settlement_id|\.settlement_id\s*==/,
  'ordinary realm logistics must remain able to redistribute goods between on-map towns',
);

const localReport = source('src/resources/settlementResourceReport.ts');
assert.match(localReport, /export function computeSettlementResourceReport/);
assert.doesNotMatch(
  localReport,
  /state\.(?:buildings|residences|deliveryTrips)\.(?:set|delete|clear)\(/,
  'town resource views are read-only reports over one integrated physical economy',
);
const { computeSettlementResourceReport } = await import(
  '../src/resources/settlementResourceReport.ts'
);
const { RESOURCE_KINDS } = await import('../src/resources/types.ts');

const westSettlement = { id: 'settlement-west', unhousedFounders: 1 };
const eastSettlement = { id: 'settlement-east', unhousedFounders: 2 };
const reportBuilding = (
  id: string,
  settlementId: string,
  stock: Record<string, number> = {},
  construction: Record<string, unknown> = {},
) => ({
  id,
  settlementId,
  kind: 'village_storehouse',
  constructionComplete: true,
  ...stock,
  ...construction,
});
const westStore = reportBuilding('west-store', 'settlement-west', { timber: 30, stone: 4 });
const eastStore = reportBuilding('east-store', 'settlement-east', { timber: 10, stone: 11 });
const eastProject = reportBuilding(
  'east-project',
  'settlement-east',
  {},
  {
    kind: 'well',
    constructionComplete: false,
    constructionReservedTimber: 7,
    constructionReservedStone: 0,
  },
);
const reportResidence = (
  id: string,
  settlementId: string,
  population: number,
  populationCapacity: number,
  extra: Record<string, unknown> = {},
) => ({
  id,
  settlementId,
  tier: 1,
  abandoned: false,
  population,
  populationCapacity,
  needs: {},
  ...extra,
});
const westHome = reportResidence('west-home', 'settlement-west', 4, 5, {
  food: 3,
  needs: { firewood: { stock: 2 } },
});
const eastHome = reportResidence('east-home', 'settlement-east', 3, 4, {
  upgradeTargetTier: 2,
  upgradeReservedStone: 2,
  upgradeReservedGold: 3,
});
const reportTrip = (
  id: string,
  buildingId: string,
  destinationKind: 'building' | 'trade',
  targetBuildingId: string | null,
  cargoKind: string,
  amount: number,
  phase: 'outbound' | 'unloading' | 'inbound' = 'outbound',
) => ({
  id,
  buildingId,
  residenceId: null,
  destinationKind,
  targetBuildingId,
  cargoKind,
  amount,
  phase,
});
const localReportState = {
  settlements: new Map([
    [westSettlement.id, westSettlement],
    [eastSettlement.id, eastSettlement],
  ]),
  buildings: new Map([
    [westStore.id, westStore],
    [eastStore.id, eastStore],
    [eastProject.id, eastProject],
  ]),
  residences: new Map([
    [westHome.id, westHome],
    [eastHome.id, eastHome],
  ]),
  deliveryTrips: new Map([
    ['west-to-east', reportTrip('west-to-east', westStore.id, 'building', eastStore.id, 'timber', 5)],
    ['east-to-west', reportTrip('east-to-west', eastStore.id, 'building', westStore.id, 'stone', 3)],
    ['west-local', reportTrip('west-local', westStore.id, 'building', westStore.id, 'firewood', 2)],
    // Even a stale target id cannot turn Trading Post exchange into an on-map town trade.
    ['east-export', reportTrip('east-export', eastStore.id, 'trade', westStore.id, 'cloth', 4)],
    ['returned-cart', reportTrip('returned-cart', westStore.id, 'building', eastStore.id, 'gold', 9, 'inbound')],
  ]),
};
const westReport = computeSettlementResourceReport(localReportState as never, westSettlement.id);
const eastReport = computeSettlementResourceReport(localReportState as never, eastSettlement.id);
const resourceRow = (
  report: typeof westReport,
  resource: string,
) => report.resources.find((row) => row.resource === resource)!;
assert.deepEqual(
  westReport.resources.map((row) => row.resource),
  RESOURCE_KINDS,
  'local whereabouts reports must retain the same canonical commodity vocabulary as the realm ledger',
);
assert.deepEqual(
  {
    west: [westReport.homes, westReport.housed, westReport.housingCapacity, westReport.unhousedFounders, westReport.buildingCount],
    east: [eastReport.homes, eastReport.housed, eastReport.housingCapacity, eastReport.unhousedFounders, eastReport.buildingCount],
  },
  {
    west: [1, 4, 5, 1, 1],
    east: [1, 3, 4, 2, 2],
  },
  'community reports must separate local housing/cohort facts without splitting realm ownership',
);
assert.deepEqual(resourceRow(westReport, 'timber'), {
  resource: 'timber', stored: 30, committed: 0, inbound: 0, outbound: 5,
});
assert.deepEqual(resourceRow(eastReport, 'timber'), {
  resource: 'timber', stored: 10, committed: 7, inbound: 5, outbound: 0,
});
assert.deepEqual(resourceRow(westReport, 'stone'), {
  resource: 'stone', stored: 4, committed: 0, inbound: 3, outbound: 0,
});
assert.deepEqual(resourceRow(eastReport, 'stone'), {
  resource: 'stone', stored: 11, committed: 2, inbound: 0, outbound: 3,
});
assert.deepEqual(resourceRow(westReport, 'firewood'), {
  resource: 'firewood', stored: 2, committed: 0, inbound: 0, outbound: 0,
}, 'same-community carts are already local stock movement, not imports or exports');
assert.deepEqual(resourceRow(eastReport, 'gold'), {
  resource: 'gold', stored: 0, committed: 3, inbound: 0, outbound: 0,
}, 'returning empty carts must not appear as pending cross-town goods');
assert.deepEqual(resourceRow(eastReport, 'cloth'), {
  resource: 'cloth', stored: 0, committed: 0, inbound: 0, outbound: 4,
});
assert.equal(eastReport.offMapTradeTrips, 1);
assert.equal(westReport.offMapTradeTrips, 0);

const overlayPreference = source('src/scene/mapOverlayPreference.ts');
const toolbar = source('src/ui/BuildToolbar.ts');
const sceneManager = source('src/scene/SceneManager.ts');
const communityOverlay = source('src/settlement/CommunityReachOverlay.ts');
assert.match(overlayPreference, /'communities'/);
assert.match(toolbar, /data-overlay-mode="communities"/);
assert.match(sceneManager, /CommunityReachOverlay/);
assert.match(sceneManager, /mode === 'communities'/);
assert.match(communityOverlay, /SettlementState/);
assert.match(communityOverlay, /ResidenceState/);
assert.match(
  communityOverlay,
  /founders_camp|foundingCampId/,
  'a live founding camp should seed reach without becoming permanent government',
);
assert.match(
  communityOverlay,
  /remote_work_camp/,
  'remote industrial camps must be explicitly classified so they do not grow residential reach',
);

console.log('Durable, porous town-community contracts passed.');
