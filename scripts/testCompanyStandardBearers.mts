import assert from 'node:assert/strict';
import type { CombatAgentState } from '../src/security/combatAgents.ts';
import {
  CompanyStandardBearerRegistry,
  companyStandardIdentity,
  isEligibleCompanyStandardBearer,
} from '../src/security/companyStandardBearers.ts';

type Candidate = Pick<
  CombatAgentState,
  'id' | 'raidId' | 'faction' | 'companyId' | 'sourceSlot' | 'health' | 'status'
>;

const candidate = (input: Partial<Candidate> & Pick<Candidate, 'id'>): Candidate => ({
  id: input.id,
  raidId: input.raidId ?? 'raid-1',
  faction: input.faction ?? 'spearman',
  companyId: input.companyId === undefined ? 'company-1' : input.companyId,
  sourceSlot: input.sourceSlot ?? 0,
  health: input.health ?? 70,
  status: input.status ?? 'holding',
});

assert.deepEqual(
  companyStandardIdentity(candidate({ id: 'p1' })),
  { companyKey: 'player:company-1', companyId: 'company-1', side: 'player' },
);
assert.deepEqual(
  companyStandardIdentity(candidate({
    id: 'm1',
    faction: 'mercenary-spear',
    companyId: 'company-3',
  })),
  { companyKey: 'mercenary:company-3', companyId: 'company-3', side: 'mercenary' },
);
assert.deepEqual(
  companyStandardIdentity(candidate({
    id: 'o1',
    faction: 'raider',
    companyId: null,
    raidId: 'warband-7',
  })),
  { companyKey: 'ottoman:warband-7', companyId: 'warband-7', side: 'ottoman' },
);
assert.equal(companyStandardIdentity(candidate({ id: 'guard', faction: 'guard' })), null);
assert.equal(isEligibleCompanyStandardBearer(candidate({ id: 'down', status: 'downed' })), false);
assert.equal(isEligibleCompanyStandardBearer(candidate({ id: 'dead', health: 0 })), false);
assert.equal(isEligibleCompanyStandardBearer(candidate({ id: 'muster', status: 'mustering' })), false);

const registry = new CompanyStandardBearerRegistry();
const opening: Candidate[] = [
  candidate({ id: 'player-b', sourceSlot: 1 }),
  candidate({ id: 'ottoman-9', faction: 'raider', companyId: null, raidId: 'warband-a', sourceSlot: 9 }),
  candidate({ id: 'player-a', sourceSlot: 0 }),
  candidate({ id: 'ottoman-2', faction: 'raider', companyId: null, raidId: 'warband-a', sourceSlot: 2 }),
  candidate({ id: 'bows-4', faction: 'bowman', companyId: 'company-2', sourceSlot: 4 }),
  candidate({ id: 'bows-1', faction: 'bowman', companyId: 'company-2', sourceSlot: 1 }),
  candidate({ id: 'merc-3', faction: 'mercenary-spear', companyId: 'company-3', sourceSlot: 3 }),
  candidate({ id: 'merc-0', faction: 'mercenary-spear', companyId: 'company-3', sourceSlot: 0 }),
  candidate({ id: 'bandit-1', faction: 'bandit', companyId: null, raidId: 'camp-1' }),
];
const first = registry.sync(opening);
assert.equal(first.size, 4, 'two resident companies, one mercenary company, and one Ottoman warband need four standards');
assert.equal(first.get('player:company-1')?.bearerId, 'player-a');
assert.equal(first.get('player:company-2')?.bearerId, 'bows-1');
assert.equal(first.get('mercenary:company-3')?.bearerId, 'merc-0');
assert.equal(first.get('ottoman:warband-a')?.bearerId, 'ottoman-2');
assert.equal(registry.isBearer('player-a'), true);
assert.equal(registry.isBearer('player-b'), false);

// Preserve the incumbent even if a lower-ranked roster member later appears.
const reinforced = registry.sync([
  ...opening.filter((member) => member.id !== 'player-a'),
]);
assert.equal(reinforced.get('player:company-1')?.bearerId, 'player-b');
const recovered = registry.sync([
  ...opening,
  candidate({ id: 'player-c', sourceSlot: 0 }),
]);
assert.equal(
  recovered.get('player:company-1')?.bearerId,
  'player-b',
  'an eligible incumbent should keep the standard when a lower slot returns',
);

// A fallen incumbent causes one deterministic re-election, not zero or two.
const afterCasualty = registry.sync([
  ...opening.map((member) => member.id === 'player-b'
    ? { ...member, status: 'downed' as const, health: 0 }
    : member),
  candidate({ id: 'player-c', sourceSlot: 0 }),
]);
assert.equal(afterCasualty.get('player:company-1')?.bearerId, 'player-a');
assert.equal(
  [...afterCasualty.values()].filter((assignment) => assignment.companyKey === 'player:company-1').length,
  1,
);

// Empty companies are pruned; a later re-formed company elects afresh.
registry.sync(opening.filter((member) => member.companyId !== 'company-2'));
assert.equal(registry.assignmentForCompany('player:company-2'), null);
registry.clear();
assert.equal(registry.isBearer('player-a'), false);

console.log('Deterministic one-standard-bearer-per-company election and stable casualty re-election contract passed.');
