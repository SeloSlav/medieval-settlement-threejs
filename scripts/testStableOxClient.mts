import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path: string): string => readFileSync(path, 'utf8');

const types = read('src/resources/types.ts');
assert.match(types, /export type StableOxState = \{[\s\S]{0,220}id: string;[\s\S]{0,120}stableId: string;[\s\S]{0,160}slot: number;[\s\S]{0,180}assignedBuildingId: string \| null;/);
assert.match(types, /stableOxen: Map<string, StableOxState>;/);

const subscriptions = read('src/data/gameTableSubscriptions.ts');
assert.match(subscriptions, /'stable_ox'/);

const sync = read('src/data/spacetimeTableSync/gameTableSync.ts');
assert.match(sync, /syncStableOxen/);
assert.match(sync, /stableOxTableFromDb/);
assert.match(sync, /this\.state\.stableOxen = syncStableOxen/g);
const stableOxSync = read('src/data/spacetimeTableSync/syncStableOxen.ts');
assert.match(stableOxSync, /assignedBuildingId === 0n[\s\S]{0,100}\? null[\s\S]{0,100}buildingClientId\(assignedBuildingId\)/);

const store = read('src/data/spacetimeGameStore.ts');
assert.match(store, /stableOxen: this\.snapshotMap\(state\.stableOxen\)/);
assert.match(store, /stableOxen: snapshot\.stableOxen/);
assert.match(store, /purchaseStableOx\(stableId: string\)/);
assert.match(store, /setBuildingOxen\(buildingId: string, assignedOxen: number\)[\s\S]{0,140}spacetimeReducers\.setBuildingOxen/);

const reducers = read('src/data/spacetimeReducers.ts');
assert.match(reducers, /purchaseStableOx[\s\S]{0,260}purchase_stable_ox[\s\S]{0,100}stableId: serverId/);
assert.match(reducers, /setBuildingOxen[\s\S]{0,280}set_building_oxen[\s\S]{0,140}assignedOxen/);

const actions = read('src/app/inspectorSpacetimeActions.ts');
assert.match(actions, /onPurchaseStableOx: async \(stableId\)[\s\S]{0,260}store\.purchaseStableOx\(stableId\)/);
assert.match(actions, /onSetBuildingOxen: async \(buildingId, assignedOxen\)[\s\S]{0,220}store\.setBuildingOxen\(buildingId, assignedOxen\)/);

const inspector = read('src/resources/ResourceInspector.ts');
assert.match(inspector, /data-purchase-ox[\s\S]{0,160}onPurchaseStableOx/);
assert.match(inspector, /data-inspector-ox-team/);
assert.match(inspector, /data-ox-posting-delta="-1"[\s\S]{0,320}data-ox-posting-delta="1"/);
assert.match(inspector, /onSetBuildingOxen\?\.[\s\S]{0,140}targetCount/);
assert.match(inspector, /Automatic pool · \$\{oxTeam\.automaticPoolCount\}/);
assert.match(inspector, /stable: '\/assets\/ui\/build-menu\/cards\/stable\.webp'/);
assert.match(inspector, /target\.building\.kind === 'stable'/);
assert.ok(
  existsSync('public/assets/ui/build-menu/cards/stable.webp'),
  'the stable inspector art must resolve to a real build-card asset',
);

const buildingRenderer = read('src/resources/inspector/buildingRenderer.ts');
assert.match(buildingRenderer, /case 'stable':[\s\S]{0,80}renderStableInspector/);
assert.match(buildingRenderer, /withBuildingOxTeam\(safeView, building, context\)/);

const oxTeamRenderer = read('src/resources/inspector/buildingOxTeamRenderer.ts');
assert.match(oxTeamRenderer, /if \(!isOxSupportedWorkplace\(building\.kind\)\) return view/);
assert.match(oxTeamRenderer, /ox\.assignedBuildingId === building\.id[\s\S]{0,120}ox\.assignedBuildingId == null/);
assert.match(oxTeamRenderer, /getBuildingDefinition\(building\.kind\)\.maxLabor/);
assert.match(oxTeamRenderer, /doubles one active worker’s yield/);
assert.match(oxTeamRenderer, /doubles one active hauler’s carrying capacity/);
assert.match(oxTeamRenderer, /postingLocked[\s\S]{0,260}postedCount >= maxCount[\s\S]{0,80}automaticPoolCount <= 0/);

const stableRenderer = read('src/resources/inspector/stableRenderer.ts');
assert.match(stableRenderer, /Array\.from\(\{ length: STABLE_OX_SLOTS \}/);
assert.match(stableRenderer, /data-stable-ox-slot/);
assert.match(stableRenderer, /data-purchase-ox/);
assert.match(stableRenderer, /const purchaseDisabled = atCapacity \|\| treasuryShort \|\| fire !== null/);
assert.doesNotMatch(stableRenderer, /Automatic · oxen cannot be assigned individually/);
assert.match(stableRenderer, /posted until changed/);
assert.match(stableRenderer, /unposted ox remains in the automatic assistance pool/);
assert.match(stableRenderer, /production yield or hauling inventory is doubled/);

const livestockLaborForecast = read(
  'src/resources/inspector/livestockLaborForecast.ts',
);
assert.match(livestockLaborForecast, /assignStableOxen\(/);
assert.match(livestockLaborForecast, /rosteredCartWorkersByBuilding\(/);
assert.match(livestockLaborForecast, /pairedOxenByBuilding/);
assert.match(
  livestockLaborForecast,
  /effectiveWorkers: onsiteHumanWorkers \+ pairedOxen/,
);
const townHallRenderer = read('src/resources/inspector/townHallRenderer.ts');
assert.match(
  townHallRenderer,
  /computeSettlementLivestockFodderPlan\([\s\S]{0,260}livestockLaborForecastByBuilding\(context\.gameState\)/,
);

const inspectorCss = read('src/ui/resourceInspector.css');
assert.match(inspectorCss, /grid-template-columns: minmax\(0, 1fr\) auto/);
assert.match(inspectorCss, /resource-inspector-labor-controls[\s\S]{0,180}max-width: 100%/);

console.log('stable ox client persistence and inspector tests passed');
