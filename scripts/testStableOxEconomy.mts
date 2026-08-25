import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  STABLE_OX_PURCHASE_GOLD,
  STABLE_OX_SLOTS,
  STARTING_GOLD,
} from '../src/generated/gameBalance.ts';

assert.equal(STARTING_GOLD, 60, 'new settlements need the authored bootstrap treasury');
assert.equal(STABLE_OX_SLOTS, 3, 'each stable must expose exactly three ox bays');
assert.equal(STABLE_OX_PURCHASE_GOLD, 24, 'trained oxen use the shared whole-gold price');
assert.ok(
  STARTING_GOLD >= STABLE_OX_PURCHASE_GOLD * 2
    && STARTING_GOLD < STABLE_OX_PURCHASE_GOLD * 3,
  'the opening purse should afford two oxen but not instantly fill a stable',
);

const tables = readFileSync('server/src/tables.rs', 'utf8');
assert.match(
  tables,
  /accessor = stable_ox,[\s\S]{0,220}index\(accessor = owner[\s\S]{0,160}index\(accessor = stable_id[\s\S]{0,260}pub struct StableOx[\s\S]{0,180}pub owner: Identity,[\s\S]{0,100}pub stable_id: u64,[\s\S]{0,100}pub slot: u8/,
  'stable oxen need durable owner, stable, and bay identity with indexed cleanup paths',
);

const reducer = readFileSync('server/src/reducers/stable_oxen.rs', 'utf8');
assert.match(reducer, /pub fn purchase_stable_ox\(/);
assert.match(
  reducer,
  /stable\.owner != owner \|\| stable\.kind != "stable"[\s\S]{0,220}!stable\.construction_complete[\s\S]{0,220}building_fire_state\(ctx, stable_id\)\.is_some\(\)/,
  'purchase authority must validate ownership, stable kind, completion, and fire safety',
);
assert.match(
  reducer,
  /oxen\.len\(\) >= usize::from\(STABLE_OX_SLOTS\)[\s\S]{0,420}find\(\|slot\|[\s\S]{0,260}spend_treasury_gold\(ctx, owner, STABLE_OX_PURCHASE_GOLD\)\?[\s\S]{0,220}stable_ox\(\)\.insert/,
  'the server must claim an open bay and debit treasury gold before inserting the ox',
);

const reset = readFileSync('server/src/reducers/world_reset.rs', 'utf8');
assert.match(
  reset,
  /stable_ox\(\)[\s\S]{0,100}\.owner\(\)[\s\S]{0,120}delete\(ox\.id\)/,
  'world reset must remove every owner-scoped ox row',
);

const buildings = readFileSync('server/src/reducers/buildings.rs', 'utf8');
const oxCleanup = buildings.indexOf('.stable_ox()');
const physicalReclamation = buildings.indexOf('let physical_reclamation', oxCleanup);
assert.ok(
  oxCleanup >= 0 && physicalReclamation > oxCleanup,
  'stable demolition must remove ox rows before a Building can become a salvage pile',
);

const lifecycle = readFileSync('server/src/lifecycle.rs', 'utf8');
assert.match(lifecycle, /gold: STARTING_GOLD/);
const bootstrap = readFileSync('server/src/reducers/bootstrap.rs', 'utf8');
assert.match(
  bootstrap,
  /gold: resources\.gold\.max\(0\.0\)[\s\S]*resources\.gold = 0\.0/,
  'founding must move the opening purse into the physical camp and clear the compatibility ledger',
);

console.log(
  `stable ox economy tests passed (${STABLE_OX_SLOTS} slots, ${STABLE_OX_PURCHASE_GOLD} gold/ox, ${STARTING_GOLD} starting gold)`,
);
