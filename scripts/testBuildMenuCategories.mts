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
  'residences', 'well', 'chapel', 'wayside_shrine', 'dry_stone_wall', 'monastery', 'marketplace', 'tavern', 'trading_post', 'town_hall',
  'village_storehouse', 'granary',
]);
assert.deepEqual(keys(GATHERING_BUILD_MENU_ENTRIES), [
  'lumber_mill', 'reforester', 'stone_quarry', 'large_quarry',
  'hunters_hall', 'foragers_shed', 'fishing_camp',
]);
assert.equal(
  GATHERING_BUILD_MENU_ENTRIES.some((entry) => entry.artKey === 'mine' || entry.artKey === 'clay_pit'),
  false,
  'Mining Pit and Quarry must replace the individual Mineral mine and Clay pit cards',
);
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

const renderedCards = renderBuildMenuCards();
assert.match(renderedCards, />Mining Pit</);
assert.match(renderedCards, />Quarry</);
assert.match(
  renderedCards,
  /data-action="tavern"[\s\S]*?data-src="\/assets\/ui\/build-menu\/cards\/tavern\.webp"/,
  'the Tavern must use its dedicated build-card illustration',
);
assert.ok(fs.existsSync('public/assets/ui/build-menu/cards/tavern.webp'));
assert.ok(fs.existsSync('public/assets/ui/build-menu/cards/wayside-shrine.webp'));
assert.ok(fs.existsSync('public/assets/ui/build-menu/cards/dry-stone-wall.webp'));
assert.match(renderedCards, /data-action="dry-stone-wall"[\s\S]*?>Dry-stone wall</);
assert.ok(fs.existsSync('public/assets/ui/icons/resource-cider.png'));
assert.ok(fs.existsSync('public/assets/ui/icons/resource-mead.png'));
const iconography = fs.readFileSync('src/ui/iconography.css', 'utf8');
assert.match(iconography, /data-resource='cider'[\s\S]*?resource-cider\.png/);
assert.match(iconography, /data-resource='mead'[\s\S]*?resource-mead\.png/);
assert.match(iconography, /data-resource-cost='cider'[\s\S]*?resource-cider\.png/);
assert.match(iconography, /data-resource-cost='mead'[\s\S]*?resource-mead\.png/);
const descriptions = [...renderedCards.matchAll(/data-tooltip="([^"]+)"/g)]
  .map((match) => match[1]);
assert.equal(descriptions.length, BUILD_MENU_ENTRIES.length, 'every build card needs one short description');
for (const description of descriptions) {
  const sentenceCount = description.split(/[.!?]+(?:\s|$)/).filter(Boolean).length;
  const wordCount = description.trim().split(/\s+/).length;
  assert.ok(sentenceCount <= 2, `build-card copy must stay within two sentences: ${description}`);
  assert.ok(wordCount <= 18, `build-card copy must stay quickly scannable: ${description}`);
  assert.doesNotMatch(description, /\bcost:/i, 'construction cost must not be repeated in tooltip prose');
}
assert.ok(
  [...renderedCards.matchAll(/data-tooltip-flow="([^"]+)"/g)].length >= 20,
  'resource-producing build cards should expose compact icon flows',
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
