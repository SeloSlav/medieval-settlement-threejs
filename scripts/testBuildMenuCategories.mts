import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  AGRICULTURE_BUILD_MENU_ENTRIES,
  BUILD_MENU_ENTRIES,
  CIVIC_BUILD_MENU_ENTRIES,
  GATHERING_BUILD_MENU_ENTRIES,
  INDUSTRY_BUILD_MENU_ENTRIES,
  MILITARY_BUILD_MENU_ENTRIES,
  renderBuildMenuCards,
  type BuildMenuEntry,
} from '../src/ui/buildMenuCards.ts';

assert.deepEqual(keys(CIVIC_BUILD_MENU_ENTRIES), [
  'residences', 'well', 'chapel', 'monastery', 'marketplace', 'trading_post', 'town_hall',
  'village_storehouse', 'granary',
]);
assert.deepEqual(keys(GATHERING_BUILD_MENU_ENTRIES), [
  'lumber_mill', 'reforester', 'stone_quarry', 'large_quarry', 'mine', 'clay_pit',
  'hunters_hall', 'foragers_shed', 'fishing_camp',
]);
assert.deepEqual(keys(AGRICULTURE_BUILD_MENU_ENTRIES), [
  'threshing_barn', 'apiary', 'vineyard', 'pastoral_farmstead', 'swineherd',
]);
assert.deepEqual(keys(INDUSTRY_BUILD_MENU_ENTRIES), [
  'woodcutters_lodge', 'watermill', 'windmill', 'bakery', 'brewery', 'smokehouse',
  'carpenter', 'weaver', 'charcoal_burner', 'smithy', 'potter_kiln',
]);

for (const [name, entries] of [
  ['Civic', CIVIC_BUILD_MENU_ENTRIES],
  ['Gathering', GATHERING_BUILD_MENU_ENTRIES],
  ['Agriculture', AGRICULTURE_BUILD_MENU_ENTRIES],
  ['Industry', INDUSTRY_BUILD_MENU_ENTRIES],
  ['Defense', MILITARY_BUILD_MENU_ENTRIES],
] as const) {
  const hotkeys = [...renderBuildMenuCards(entries).matchAll(/data-hotkey="([^"]+)"/g)]
    .map((match) => match[1].toLowerCase());
  assert.equal(hotkeys.length, entries.length, `${name} must render one hotkey per entry`);
  assert.equal(new Set(hotkeys).size, hotkeys.length, `${name} submenu hotkeys must be unique`);
}

const allActions = BUILD_MENU_ENTRIES.map((entry) => entry.action);
assert.equal(new Set(allActions).size, allActions.length, 'each build action must belong to exactly one menu');
assert.equal(
  BUILD_MENU_ENTRIES.some((entry) => entry.artKey.includes('ferry')),
  false,
  'the removed ferry must not remain in any build category',
);

const toolbarSource = fs.readFileSync('src/ui/BuildToolbar.ts', 'utf8');
for (const [action, hotkey] of [
  ['civic-build-menu', 'B'],
  ['gathering-build-menu', 'G'],
  ['agriculture-build-menu', 'U'],
  ['industry-build-menu', 'V'],
  ['military-build-menu', 'X'],
] as const) {
  assert.match(
    toolbarSource,
    new RegExp(`data-action="${action}"[^>]*>[\\s\\S]*?construction-dock-button__hotkey"[^>]*>${hotkey}<`),
  );
}

console.log('Build menu category tests passed.');

function keys(entries: readonly BuildMenuEntry[]): string[] {
  return entries.map((entry) => entry.artKey);
}
