import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path: string): string => readFileSync(path, 'utf8');

const types = read('src/resources/types.ts');
assert.match(types, /export type StableOxState = \{[\s\S]{0,220}id: string;[\s\S]{0,120}stableId: string;[\s\S]{0,160}slot: number;/);
assert.match(types, /stableOxen: Map<string, StableOxState>;/);

const subscriptions = read('src/data/gameTableSubscriptions.ts');
assert.match(subscriptions, /'stable_ox'/);

const sync = read('src/data/spacetimeTableSync/gameTableSync.ts');
assert.match(sync, /syncStableOxen/);
assert.match(sync, /stableOxTableFromDb/);
assert.match(sync, /this\.state\.stableOxen = syncStableOxen/g);

const store = read('src/data/spacetimeGameStore.ts');
assert.match(store, /stableOxen: this\.snapshotMap\(state\.stableOxen\)/);
assert.match(store, /stableOxen: snapshot\.stableOxen/);
assert.match(store, /purchaseStableOx\(stableId: string\)/);

const reducers = read('src/data/spacetimeReducers.ts');
assert.match(reducers, /purchaseStableOx[\s\S]{0,260}purchase_stable_ox[\s\S]{0,100}stableId: serverId/);

const actions = read('src/app/inspectorSpacetimeActions.ts');
assert.match(actions, /onPurchaseStableOx: async \(stableId\)[\s\S]{0,260}store\.purchaseStableOx\(stableId\)/);

const inspector = read('src/resources/ResourceInspector.ts');
assert.match(inspector, /data-purchase-ox[\s\S]{0,160}onPurchaseStableOx/);
assert.match(inspector, /stable: '\/assets\/ui\/build-menu\/cards\/stable\.webp'/);
assert.match(inspector, /target\.building\.kind === 'stable'/);
assert.ok(
  existsSync('public/assets/ui/build-menu/cards/stable.webp'),
  'the stable inspector art must resolve to a real build-card asset',
);

const buildingRenderer = read('src/resources/inspector/buildingRenderer.ts');
assert.match(buildingRenderer, /case 'stable':[\s\S]{0,80}renderStableInspector/);

const stableRenderer = read('src/resources/inspector/stableRenderer.ts');
assert.match(stableRenderer, /Array\.from\(\{ length: STABLE_OX_SLOTS \}/);
assert.match(stableRenderer, /data-stable-ox-slot/);
assert.match(stableRenderer, /data-purchase-ox/);
assert.match(stableRenderer, /const purchaseDisabled = atCapacity \|\| treasuryShort \|\| fire !== null/);
assert.match(stableRenderer, /Automatic · oxen cannot be assigned individually/);
assert.match(stableRenderer, /production yield or hauling inventory is doubled/);

console.log('stable ox client persistence and inspector tests passed');
