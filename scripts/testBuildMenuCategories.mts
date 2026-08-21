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
import { resolveTooltipPosition } from '../src/ui/tooltips.ts';

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
assert.match(renderedCards, /data-action="village-storehouse"[\s\S]*?>Storehouse</);
assert.match(renderedCards, /data-action="granary"[\s\S]*?>Granary</);
assert.doesNotMatch(renderedCards, />Village (?:storehouse|granary)</);
assert.match(
  renderedCards,
  /data-action="marketplace"[^>]*data-tooltip="Required to distribute food to residences;/,
);
assert.match(
  renderedCards,
  /data-action="village-storehouse"[^>]*data-tooltip="[^"]*clay, salt, and all other non-food goods\./,
);
assert.match(
  renderedCards,
  /data-action="granary"[^>]*data-tooltip="Stores grain, fresh food, and preserved provisions for the settlement\./,
);
assert.match(
  renderedCards,
  /data-action="monastery"[^>]*data-tooltip="[^"]*hosts pilgrims[^"]*aids villagers[^"]*charitable works\./,
);
assert.equal(
  [...renderedCards.matchAll(/data-tooltip-placement="above"/g)].length,
  BUILD_MENU_ENTRIES.length,
  'every build-card tooltip must request the above-menu placement',
);
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
  assert.doesNotMatch(
    description,
    /\b(?:beyond the map|off[- ]map|does not|no practical benefit|fallback|non-depleting|requirement|unlocks?)\b/i,
    `build-card copy must stay in-world and benefit-led: ${description}`,
  );
}
assert.ok(
  [...renderedCards.matchAll(/data-tooltip-flow="([^"]+)"/g)].length >= 20,
  'resource-producing build cards should expose compact icon flows',
);

const abovePosition = resolveTooltipPosition(
  { left: 200, top: 300, bottom: 500, width: 160 },
  { width: 320, height: 120 },
  1280,
  720,
  'above',
);
assert.equal(abovePosition.top, 172, 'above placement must sit over the card even when there is room below');

const automaticPosition = resolveTooltipPosition(
  { left: 200, top: 100, bottom: 300, width: 160 },
  { width: 320, height: 120 },
  1280,
  720,
);
assert.equal(automaticPosition.top, 308, 'ordinary tooltips should retain automatic placement');

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
