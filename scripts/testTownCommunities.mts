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
const residenceReducer = source('server/src/reducers/residences.rs');
const settlementAuthority = source('server/src/settlements.rs');
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
  foundingSite,
  /fn founding_camp_has_active_trip[\s\S]{0,1000}\.building_id\(\)[\s\S]{0,1000}\.target_building_id\(\)[\s\S]{0,1000}\.labor_building_id\(\)/,
  'camp retirement must wait for origin, destination, and labor-linked carts so deleting the yard cannot orphan a trip',
);
assert.match(
  foundingSite,
  /ALL_COMMODITIES[\s\S]*fn has_portable_stock[\s\S]{0,500}ALL_COMMODITIES/,
  'both relocation and final emptiness must share the canonical all-commodity catalog',
);
assert.match(
  population,
  /owner_unhoused_founders\(ctx, owner\)[\s\S]{0,260}saturating_add\(founding_cohorts\)/,
  'realm population must sum each still-homeless founding cohort',
);
assert.match(
  residenceSettlement,
  /take_unhoused_founder\(ctx, residence\.settlement_id\)/,
  'a home must consume founders only from its own community before attracting a new migrant',
);
assert.match(
  residenceSettlement,
  /settlement\.active[\s\S]{0,220}return;/,
  'cottages laid out for a planned town must stay empty until that expedition actually arrives',
);
assert.match(
  residenceReducer,
  /residential_settlement_for_position[\s\S]{0,260}Place a Founders' Camp before laying out homes here/,
  'distant housing must not silently claim founders from another town',
);
assert.match(
  settlementAuthority,
  /fn take_unhoused_founder[\s\S]{0,900}settlement\.unhoused_founders -= 1/,
  'the same-community founder claim must atomically reduce that cohort',
);
assert.match(
  settlementAuthority,
  /fn residential_settlement_for_position[\s\S]{0,500}RESIDENTIAL_SETTLEMENT_REACH/,
  'residential community claims need a bounded travel-reach test rather than nearest-town ownership across the whole map',
);

const buildingReducer = source('server/src/reducers/buildings.rs');
assert.match(
  buildingReducer,
  /kind == "town_hall"[\s\S]*settlement_id/,
  'Town Hall placement must resolve the candidate community',
);
assert.match(
  buildingReducer,
  /if kind == "town_hall"[\s\S]{0,1600}building\.settlement_id == settlement_id/,
  'Town Hall uniqueness must be scoped to one community rather than the whole owner',
);

const villageAdmin = source('server/src/reducers/village_admin.rs');
const clientReducers = source('src/data/spacetimeReducers.ts');
for (const [reducer, clientReducer] of [
  ['set_night_policies', 'setNightPolicies'],
  ['set_economic_activity_tax_rate', 'setEconomicActivityTaxRate'],
  ['set_pantry_safeguard_policy', 'setPantrySafeguardPolicy'],
  ['set_fiscal_policy', 'setFiscalPolicy'],
  ['set_seasonal_labor_steward', 'setSeasonalLaborSteward'],
  ['set_construction_labor_steward', 'setConstructionLaborSteward'],
  ['set_production_labor_steward', 'setProductionLaborSteward'],
  ['set_labor_steward_reserve', 'setLaborStewardReserve'],
] as const) {
  assert.match(
    villageAdmin,
    new RegExp(`pub fn ${reducer}\\([\\s\\S]{0,260}(town_hall_id|settlement_id)`),
    `${reducer} must identify the selected local administration`,
  );
  assert.match(
    source(`src/generated/${reducer}_reducer.ts`),
    /townHallId:\s*__t\.u64\(\)/,
    `${reducer} generated binding must carry the exact Hall id`,
  );
  assert.match(
    clientReducers,
    new RegExp(`function ${clientReducer}\\([\\s\\S]{0,140}townHallId: string[\\s\\S]{0,900}townHallId: serverId`),
    `${clientReducer} must parse and transmit the exact Hall id`,
  );
}
assert.match(
  villageAdmin,
  /ctx\.db\.settlement\(\)/,
  'Town Hall policy changes must update community policy rather than only PlayerResources',
);

const gameStore = source('src/data/spacetimeGameStore.ts');
const resourceInspector = source('src/resources/ResourceInspector.ts');
const inspectorActions = source('src/app/inspectorSpacetimeActions.ts');
const exactHallLaborReducers = [
  ['rotate_construction_labor', 'rotateConstructionLabor', 'rotateConstructionLabor'],
  ['recall_idle_seasonal_labor', 'recallIdleSeasonalLabor', 'recallIdleSeasonalLabor'],
  ['call_up_active_seasonal_labor', 'callUpActiveSeasonalLabor', 'callUpActiveSeasonalLabor'],
  ['recall_target_idle_processor_labor', 'recallTargetIdleProcessorLabor', 'recallTargetIdleProcessorLabor'],
  ['call_up_target_ready_processor_labor', 'callUpTargetReadyProcessorLabor', 'callUpTargetReadyProcessorLabor'],
  ['call_up_year_round_labor', 'callUpYearRoundLabor', 'balanceYearRoundLabor'],
] as const;
for (const [serverName, reducerName, actionName] of exactHallLaborReducers) {
  assert.match(
    buildingReducer,
    new RegExp(`pub fn ${serverName}\\([\\s\\S]{0,180}town_hall_id: u64`),
    `${serverName} must administer the exact selected Town Hall jurisdiction`,
  );
  const generatedReducer = source(`src/generated/${serverName}_reducer.ts`);
  assert.match(
    generatedReducer,
    /townHallId:\s*__t\.u64\(\)/,
    `${serverName} generated binding must carry townHallId`,
  );
  assert.match(
    clientReducers,
    new RegExp(`function ${reducerName}\\([\\s\\S]{0,120}townHallId: string[\\s\\S]{0,520}townHallId: serverId`),
    `${reducerName} must parse and transmit the exact Hall id`,
  );
  assert.match(
    gameStore,
    new RegExp(`async ${actionName}\\([\\s\\S]{0,120}townHallId: string[\\s\\S]{0,4000}spacetimeReducers\\.${reducerName}\\(townHallId\\)`),
    `${actionName} optimistic planning must target the same Hall sent to authority`,
  );
  assert.match(
    resourceInspector,
    new RegExp(`on${actionName[0]!.toUpperCase()}${actionName.slice(1)}[\\s\\S]{0,120}townHallId: string`),
    `${actionName} inspector callback must expose the selected Hall id`,
  );
  assert.match(
    inspectorActions,
    new RegExp(`on${actionName[0]!.toUpperCase()}${actionName.slice(1)}[\\s\\S]{0,180}townHallId[\\s\\S]{0,1400}store\\.${actionName}\\(townHallId\\)`),
    `${actionName} action must not fall back to an arbitrary owner-wide Hall`,
  );
}

const resourceTotals = source('src/resources/resourceTotals.ts');
const storehouse = source('server/src/simulation/village_storehouse.rs');
assert.doesNotMatch(
  resourceTotals,
  /activeSettlementId|selectedSettlementId|settlementFilter/,
  'the lord-facing Total/Surplus ledger must never switch to a selected-town wallet',
);
assert.doesNotMatch(
  storehouse,
  /\.filter\([^\n]*settlement_id|\.settlement_id\s*==/,
  'ordinary realm logistics must remain able to redistribute goods between on-map towns',
);

const localReport = source('src/resources/settlementResourceReport.ts');
const townReportPanel = source('src/ui/TownReportPanel.ts');
const townReportStyles = source('src/ui/townReportPanel.css');
const worldMapIcons = source('src/app/worldMapIcons.ts');
const appBootstrap = source('src/app/appBootstrap.ts');
assert.match(localReport, /export function computeSettlementResourceReport/);
assert.doesNotMatch(
  localReport,
  /state\.(?:buildings|residences|deliveryTrips)\.(?:set|delete|clear)\(/,
  'town resource views are read-only reports over one integrated physical economy',
);
assert.match(townReportPanel, /computeSettlementResourceReport/);
assert.match(townReportPanel, /one realm economy/);
assert.doesNotMatch(townReportPanel, /Not a separate town wallet/);
assert.match(
  townReportPanel,
  /data-resource-cost="\$\{escapeHtml\(row\.resource\)\}"[\s\S]{0,180}resource-cost__icon/,
  'each local resource row must pair its name with the canonical resource icon',
);
assert.match(
  townReportStyles,
  /town-report-panel__good\[data-resource-cost='game'\][\s\S]{0,180}game-normal\.png/,
  'the canonical game resource must retain a real icon in the local report',
);
assert.match(townReportPanel, /bound for off-map trade/);
assert.match(
  townReportPanel,
  /open\(settlementId:[\s\S]*?classList\.add\('is-town-report-open'\)[\s\S]*?close\(\):[\s\S]*?classList\.remove\('is-town-report-open'\)/,
  'the town report must publish its open state for responsive HUD collision handling',
);
assert.match(
  townReportStyles,
  /\.town-report-panel\s*\{[\s\S]*?right:\s*auto;[\s\S]*?left:\s*14px;[\s\S]*?width:\s*min\(520px, calc\(100vw - 340px\)\)/,
  'the town report must use the left inspection rail and reserve the lord report rail',
);
assert.match(
  townReportStyles,
  /@media \(max-width: 620px\)[\s\S]*?top:\s*180px;[\s\S]*?bottom:\s*150px;[\s\S]*?is-town-report-open \.noble-hud__reports\s*\{\s*display:\s*none;/,
  'compact screens must stack the town report between the top and bottom HUD without a second report column',
);
assert.match(
  worldMapIcons,
  /TownReportPanel[\s\S]*settlementId[\s\S]*townReport\.open/,
  'map community markers must open the local whereabouts report rather than switch the global HUD wallet',
);
assert.match(appBootstrap, /const REPORT_FOCUS_ZOOM_PERCENT = 50;/);
assert.match(
  appBootstrap,
  /onSettlementSelect:[\s\S]*?focusWorldPositionAtZoom\([\s\S]*?REPORT_FOCUS_ZOOM_PERCENT[\s\S]*?onSettlementFocus:/,
  'selecting a town marker must center its community at the shared report zoom',
);
assert.match(
  appBootstrap,
  /onSettlementFocus:[\s\S]*?focusWorldPositionAtZoom\(x, z, REPORT_FOCUS_ZOOM_PERCENT\)/,
  'the town report focus action must center its community at the shared report zoom',
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
const snapshotApplier = source('src/app/spacetimeSnapshotApplier.ts');
const communityOverlay = source('src/settlement/CommunityReachOverlay.ts');
const communityRaster = source('src/settlement/CommunityReachRaster.ts');
assert.match(overlayPreference, /'communities'/);
assert.match(toolbar, /data-overlay-mode="communities"/);
assert.match(sceneManager, /CommunityReachOverlay/);
assert.match(sceneManager, /mode === 'communities'/);
assert.match(
  snapshotApplier,
  /settlementsChanged \|\| buildingsChanged \|\| residencesChanged[\s\S]{0,300}syncCommunityReach\([\s\S]{0,180}state\.settlements[\s\S]{0,180}state\.buildings[\s\S]{0,180}state\.residences/,
  'community reach must refresh when any authoritative influence layer changes',
);
assert.match(communityOverlay, /rasterizeCommunityReach/);
assert.match(communityRaster, /SettlementState/);
assert.match(communityRaster, /ResidenceState/);
assert.match(
  communityRaster,
  /founders_camp|foundingCampId/,
  'a live founding camp should seed reach without becoming permanent government',
);

const {
  communityReachSettlementAt,
  rasterizeCommunityReach,
} = await import('../src/settlement/CommunityReachRaster.ts');
const communityBounds = { minX: -200, maxX: 200, minZ: -200, maxZ: 200 };
const communitySettlement = (
  id: string,
  anchorX: number,
  anchorZ: number,
  active = true,
) => ({ id, anchorX, anchorZ, active });
const townA = communitySettlement('settlement-a', -100, 0);
const townB = communitySettlement('settlement-b', 100, 0);
const dormantTown = communitySettlement('settlement-dormant', 0, -120, false);
const reachResidence = (id: string, settlementId: string, x: number, z: number) => ({
  id,
  settlementId,
  x,
  z,
  tier: 2,
  abandoned: false,
  population: 4,
});
const reachBuilding = (
  id: string,
  settlementId: string,
  kind: string,
  x: number,
  z: number,
) => ({ id, settlementId, kind, x, z, constructionComplete: true });
const baseReach = rasterizeCommunityReach({
  resolution: 41,
  bounds: communityBounds,
  // Reversed input proves array order cannot decide an equal-influence boundary.
  settlements: [townB, dormantTown, townA] as never,
  buildings: [],
  residences: [],
});
assert.deepEqual(baseReach.settlementIds, ['settlement-a', 'settlement-b']);
assert.equal(communityReachSettlementAt(baseReach, communityBounds, -100, 0), townA.id);
assert.equal(communityReachSettlementAt(baseReach, communityBounds, 100, 0), townB.id);
assert.equal(communityReachSettlementAt(baseReach, communityBounds, -30, 0), null);
assert.equal(communityReachSettlementAt(baseReach, communityBounds, 0, -120), null);
assert.equal(communityReachSettlementAt(baseReach, communityBounds, -200, -200), null);

const grownReach = rasterizeCommunityReach({
  resolution: 41,
  bounds: communityBounds,
  settlements: [townA, townB] as never,
  buildings: [],
  residences: [reachResidence('a-home', townA.id, -30, 0)] as never,
});
assert.equal(
  communityReachSettlementAt(grownReach, communityBounds, -30, 0),
  townA.id,
  'a completed local home must grow visible community reach after the temporary camp is gone',
);

const tieReach = rasterizeCommunityReach({
  resolution: 41,
  bounds: communityBounds,
  settlements: [townB, townA] as never,
  buildings: [],
  residences: [
    reachResidence('a-home', townA.id, -30, 0),
    reachResidence('b-home', townB.id, 30, 0),
  ] as never,
});
assert.equal(
  communityReachSettlementAt(tieReach, communityBounds, 0, 0),
  townA.id,
  'an equal-influence seam must resolve by stable community id, not replication order',
);

const industrialWorksiteReach = rasterizeCommunityReach({
  resolution: 41,
  bounds: communityBounds,
  settlements: [townA, townB] as never,
  buildings: [reachBuilding('remote', townA.id, 'stone_quarry', 0, 160)] as never,
  residences: [],
});
assert.equal(
  communityReachSettlementAt(industrialWorksiteReach, communityBounds, 0, 160),
  null,
  'an industrial worksite must not become a residential community seed',
);
const localStoreReach = rasterizeCommunityReach({
  resolution: 41,
  bounds: communityBounds,
  settlements: [townA, townB] as never,
  buildings: [reachBuilding('local-store', townA.id, 'village_storehouse', 0, 160)] as never,
  residences: [],
});
assert.equal(
  communityReachSettlementAt(localStoreReach, communityBounds, 0, 160),
  townA.id,
  'a permanent local Storehouse should help make the serviced town footprint legible',
);
const liveFoundingCampReach = rasterizeCommunityReach({
  resolution: 41,
  bounds: communityBounds,
  settlements: [townA, townB] as never,
  buildings: [reachBuilding('founders', townA.id, 'founders_camp', 0, 160)] as never,
  residences: [],
});
assert.equal(
  communityReachSettlementAt(liveFoundingCampReach, communityBounds, 0, 160),
  townA.id,
  'a live founding expedition should make its emerging town legible before permanent homes exist',
);
const alphaValues = Array.from(
  { length: tieReach.rgba.length / 4 },
  (_, index) => tieReach.rgba[index * 4 + 3],
);
assert.ok(alphaValues.includes(0), 'neutral wilderness must remain visually transparent');
assert.ok(alphaValues.includes(98), 'community interiors must remain softly translucent');
assert.ok(alphaValues.includes(205), 'organic seams must remain legible without becoming hard borders');

console.log('Durable, porous town-community contracts passed.');
