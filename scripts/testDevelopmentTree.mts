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
const menuStyles = readFileSync('src/ui/developmentMenu.css', 'utf8');
const gameplayStyles = readFileSync('src/ui/gameplayCraft.css', 'utf8');
const document = readFileSync('docs/DEVELOPMENT_POINTS.md', 'utf8');
assert.doesNotMatch(menu, /<strong>Your estate<\/strong>/, 'the central heraldry must not be obscured by redundant copy');
assert.doesNotMatch(model, /build-menu\/cards\//, 'development seals must use isolated icons, never parchment-backed building cards');
for (const id of ['carters-guild', 'chartered-markets', 'watch-fires', 'coppice-craft', 'river-wardens']) {
  const skill = DEVELOPMENT_SKILL_BY_ID.get(id)!;
  const url = developmentIconUrl(skill.icon);
  assert.match(url, /^\/assets\/ui\/icons\/developments\//, `${id} must use a dedicated development icon`);
  const png = readFileSync(`public${url}`);
  assert.equal(png.readUInt32BE(16), 512, `${id} icon width changed`);
  assert.equal(png.readUInt32BE(20), 512, `${id} icon height changed`);
  assert.ok(png[25] === 4 || png[25] === 6, `${id} icon must retain an alpha channel`);
  assert.ok(png.length < 600_000, `${id} icon is too large for runtime UI`);
}
for (const [branch, asset] of [
  ['land', 'land-harvest-woodcut.png'],
  ['craft', 'craft-trade-woodcut.png'],
  ['hearth', 'hearth-watch-woodcut.png'],
  ['woodland', 'woodland-waters-woodcut.png'],
] as const) {
  assert.match(menu, new RegExp(`development-branch-art--${branch}[^>]*aria-hidden="true"`), `${branch} art must stay decorative`);
  assert.match(menuStyles, new RegExp(`development-branch-art--${branch}[\\s\\S]*?${asset.replace('.', '\\.')}`), `${branch} must use its dedicated woodcut`);
  const png = readFileSync(`public/assets/ui/development-backgrounds/${asset}`);
  assert.equal(png.readUInt32BE(16), 512, `${branch} woodcut width changed`);
  assert.equal(png.readUInt32BE(20), 341, `${branch} woodcut height changed`);
  assert.ok(png[25] === 4 || png[25] === 6, `${branch} woodcut must retain an alpha channel`);
  assert.ok(png.length < 500_000, `${branch} woodcut is too large for runtime UI`);
}
assert.match(menuStyles, /\.development-branch-art \{[\s\S]*?position: absolute;[\s\S]*?pointer-events: none;/, 'branch art must remain a non-layout decorative layer');
for (const color of ['#7563408c', '#3b58668c', '#75443f8c', '#48633c8c']) {
  assert.ok(gameplayStyles.includes(color), `development quadrant color ${color} must be preserved`);
}
for (const skill of DEVELOPMENT_SKILLS) {
  assert.ok(document.includes(skill.name), `Missing skill in design document: ${skill.name}`);
  assert.ok(document.includes(skill.description), `Description differs in design document: ${skill.name}`);
}
assert.doesNotMatch(menu + model, /\.reducers\b|localStorage|sessionStorage|fetch\(/, 'prototype must not mutate or persist simulation data');
for (const cardinalRule of [
  /development-branch-label--land \{ left: 50%; top: 0;/,
  /development-branch-label--craft \{ left: 100%; top: 50%;/,
  /development-branch-label--hearth \{ left: 50%; top: 100%;/,
  /development-branch-label--woodland \{ right: 100%; top: 50%;/,
]) assert.match(menuStyles, cardinalRule, 'branch labels must follow their cardinal branch axes');
const toolbar = readFileSync('src/ui/BuildToolbar.ts', 'utf8');
assert.match(toolbar, /this\.settlementHud\.root\.append\(developmentButton\)/);
assert.match(toolbar, /return this\.developmentMenu\.isOpen\(\) \|\|/);
console.log('Development tree passed: 24 skills, all four complete branches, both-parent locks, nine-point cap, double-spend safety, refunds, assets, and client-only boundary.');
