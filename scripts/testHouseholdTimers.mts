import assert from 'node:assert/strict';
import { householdCounterAt } from '../src/residences/householdTimers.ts';
import { syncResidences } from '../src/data/spacetimeTableSync/syncResidences.ts';
import { GameTableSync } from '../src/data/spacetimeTableSync/gameTableSync.ts';

let base = 0, anchor = 0n, rate = 0, expected = 0;
let writes = 0;
for (let tick = 1n; tick <= 10_000n; tick++) {
  const nextRate = tick < 4_000n || tick >= 8_000n ? 1 : -2;
  expected = nextRate > 0 ? expected + 1 : Math.max(0, expected - 2);
  if (rate !== nextRate || householdCounterAt(base, anchor, rate, tick) !== expected) {
    base = expected; anchor = tick; rate = nextRate; writes++;
  }
  assert.equal(householdCounterAt(base, anchor, rate, tick), expected);
}
assert.equal(writes, 3);
assert.equal(householdCounterAt(32, 100n, -2, 120n), 0);
assert.equal(householdCounterAt(32, 100n, 1, 50n), 32);
assert.equal(householdCounterAt(32, 100n, 0, 2n ** 64n - 1n), 32);
assert.equal(householdCounterAt(1, 0n, 1, 2n ** 64n - 1n), 0xffff_ffff);

const owner = { toHexString: () => 'owner' };
const home = { id: 1n, owner, zoneId: 1n, comfortDeficitTicks: 12,
  comfortDeficitTick: 100n, comfortDeficitRate: -2 };
const need = { residenceId: 1n, needKind: 2, stock: 7, sourceKind: 65535,
  deficitTicks: 5, deficitTick: 100n, deficitRunning: true };
const first = syncResidences([home] as never, [need] as never, 'owner', 103n).get('residence-1')!;
assert.equal(first.comfortDeficitTicks, 6);
assert.equal(first.needs.food.deficitTicks, 8);
assert.equal(first.needs.food.stock, 7);
assert.equal(syncResidences([home] as never, [need] as never, 'foreign', 103n).size, 0);

// A world-clock update refreshes unchanged rows and coalesces with row events.
let clock = 103n;
const worldCallbacks: Array<() => void> = [];
const residenceCallbacks: Array<() => void> = [];
const needsCallbacks: Array<() => void> = [];
const table = (row: unknown, callbacks: Array<() => void>) => ({ iter: () => [row],
  onInsert: (cb: () => void) => callbacks.push(cb),
  onUpdate: (cb: () => void) => callbacks.push(cb),
  onDelete: (cb: () => void) => callbacks.push(cb) });
const worldRow = () => ({ id: 0, simTick: 200n, householdTick: clock, gameSpeed: 1, configured: false });
const worldTable = { ...table(worldRow(), worldCallbacks), iter: () => [worldRow()], id: { find: worldRow } };
const state = { identityHex: 'owner', residences: new Map(), worldGeneration: null,
  fireIncidents: new Map(), simTick: 0 };
let notifications = 0;
new GameTableSync(state as never, () => notifications++).attachHandlers({ db: {
  world_config: worldTable, visible_residence: table(home, residenceCallbacks),
  visible_residence_need: table(need, needsCallbacks),
} } as never);
clock = 104n;
worldCallbacks[1](); residenceCallbacks[1](); needsCallbacks[1]();
await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
assert.equal(state.residences.get('residence-1').needs.food.deficitTicks, 9);
assert.equal(state.residences.get('residence-1').comfortDeficitTicks, 4);
assert.equal(notifications, 1);
console.log('Household clock parity, saturation, owner filtering, and clock-only refresh passed');
