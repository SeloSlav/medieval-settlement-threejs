import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  DEVELOPMENT_BRANCHES, DEVELOPMENT_POINT_CAP, DEVELOPMENT_SKILLS,
  DEVELOPMENT_SKILL_BY_ID, DevelopmentState, developmentIconUrl, developmentSkillPosition,
} from '../src/ui/developmentTree.ts';

assert.equal(DEVELOPMENT_BRANCHES.length, 4);
assert.equal(DEVELOPMENT_SKILLS.length, 24);
assert.equal(DEVELOPMENT_SKILL_BY_ID.size, 24, 'IDs must be unique');
assert.equal(DEVELOPMENT_POINT_CAP, 9);
const fresh = new DevelopmentState();
assert.equal(fresh.points, 9);
assert.equal(fresh.spent, 0);
assert.equal(fresh.unlock('not-a-skill'), false);
assert.equal(fresh.points, 9);

for (const branch of DEVELOPMENT_BRANCHES) {
  assert.equal(branch.skills.length, 6);
  const state = new DevelopmentState();
  assert.equal(branch.skills.filter(skill => state.status(skill.id) === 'available').length, 1);
  for (const [index, skill] of branch.skills.entries()) {
    assert.ok(skill.name.length && skill.description.endsWith('.'));
    assert.ok(existsSync(`public${developmentIconUrl(skill.icon)}`), `Missing icon for ${skill.id}`);
    assert.ok(skill.requires.every(id => branch.skills.slice(0, index).some(parent => parent.id === id)), 'prerequisites must precede their children in the same branch');
    assert.equal(state.unlock(skill.id), true, `Cannot unlock ${skill.id}`);
    assert.equal(state.status(skill.id), 'learned');
    assert.equal(state.unlock(skill.id), false, 'double-click must not spend twice');
    const position = developmentSkillPosition(branch, index);
    assert.ok(position.x > 0 && position.x < 900 && position.y > 0 && position.y < 900);
  }
  assert.equal(state.points, 3, 'one whole branch must leave half another');
  const other = DEVELOPMENT_BRANCHES.find(candidate => candidate !== branch)!;
  for (const skill of other.skills.slice(0, 3)) assert.equal(state.unlock(skill.id), true);
  assert.equal(state.points, 0);
  assert.equal(state.spent, 9);
  assert.equal(state.status(other.skills[3].id), 'unaffordable');
  assert.equal(state.unlock(other.skills[3].id), false);
  assert.equal(state.status(other.skills[5].id), 'locked');
  state.reset();
  assert.equal(state.points, 9);
  assert.equal(state.spent, 0);
  assert.equal(state.status(branch.skills[0].id), 'available');
  assert.equal(state.status(branch.skills[5].id), 'locked');

  const merge = new DevelopmentState();
  assert.equal(merge.unlock(branch.skills[5].id), false);
  for (const index of [0, 1, 3]) assert.equal(merge.unlock(branch.skills[index].id), true);
  assert.equal(merge.status(branch.skills[5].id), 'locked', 'one specialist cannot bypass the second mastery requirement');
  for (const index of [2, 4]) assert.equal(merge.unlock(branch.skills[index].id), true);
  assert.equal(merge.unlock(branch.skills[5].id), true);
}
const independent = new DevelopmentState();
assert.equal(independent.points, 9, 'new map sessions start fresh');
const menu = readFileSync('src/ui/DevelopmentMenu.ts', 'utf8');
const model = readFileSync('src/ui/developmentTree.ts', 'utf8');
assert.doesNotMatch(menu + model, /\.reducers\b|localStorage|sessionStorage|fetch\(/, 'prototype must not mutate or persist simulation data');
const toolbar = readFileSync('src/ui/BuildToolbar.ts', 'utf8');
assert.match(toolbar, /this\.settlementHud\.root\.append\(developmentButton\)/);
assert.match(toolbar, /return this\.developmentMenu\.isOpen\(\) \|\|/);
console.log('Development tree passed: 24 skills, all four complete branches, both-parent locks, nine-point cap, double-spend safety, refunds, assets, and client-only boundary.');
