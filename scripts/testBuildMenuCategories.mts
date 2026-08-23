import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  AGRICULTURE_BUILD_MENU_ENTRIES,
  BUILD_MENU_CATEGORIES,
  BUILD_MENU_ENTRIES,
  CIVIC_BUILD_MENU_ENTRIES,
  GATHERING_BUILD_MENU_ENTRIES,
  INDUSTRY_BUILD_MENU_ENTRIES,
  MILITARY_BUILD_MENU_ENTRIES,
  renderBuildMenuCards,
  syncBuildMenuCardAffordability,
  type BuildMenuEntry,
} from '../src/ui/buildMenuCards.ts';
import { residenceZoneCost } from '../src/resources/buildingEconomy.ts';
import { buildingCostWithCarpenterSupport } from '../src/economy/carpenterSupport.ts';
import { BuildingTool } from '../src/buildings/BuildingTool.ts';
import { BurgageTool } from '../src/residences/BurgageTool.ts';
import {
  describeBuildingPlacementBlocker,
  renderToolbarStatus,
} from '../src/ui/buildToolbarStatus.ts';
import {
  buildingResourceCostAmounts,
  decodeResourceCostTooltip,
  FREE_CONSTRUCTION_COST_TOOLTIP,
  isResourceCostAffordable,
  renderResourceCost,
  resourceCostEntries,
} from '../src/ui/resourceCost.ts';
import { isConstructionResourceShortfallMessage } from '../src/ui/toastMessages.ts';
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
  'threshing_barn', 'apiary', 'pastoral_farmstead', 'swineherd',
]);
assert.deepEqual(keys(INDUSTRY_BUILD_MENU_ENTRIES), [
  'woodcutters_lodge', 'watermill', 'windmill', 'bakery', 'brewery', 'smokehouse',
  'carpenter', 'weaver', 'tannery', 'cobbler', 'charcoal_burner', 'smithy', 'potter_kiln',
]);

assert.deepEqual(BUILD_MENU_CATEGORIES.map((category) => category.id), [
  'civic', 'trade', 'gathering', 'agriculture',
  'food', 'industry', 'faith', 'decorations', 'military',
]);
assert.deepEqual(categoryKeys('civic'), ['residences', 'well', 'town_hall']);
assert.deepEqual(categoryKeys('trade'), ['marketplace', 'trading_post', 'village_storehouse', 'granary']);
assert.deepEqual(categoryKeys('gathering'), [
  'lumber_mill', 'reforester', 'stone_quarry', 'large_quarry', 'hunters_hall', 'foragers_shed', 'fishing_camp',
]);
assert.deepEqual(categoryKeys('agriculture'), ['threshing_barn', 'apiary', 'pastoral_farmstead', 'swineherd']);
assert.deepEqual(categoryKeys('food'), ['watermill', 'windmill', 'bakery', 'brewery', 'tavern', 'smokehouse']);
assert.deepEqual(categoryKeys('industry'), ['woodcutters_lodge', 'carpenter', 'weaver', 'tannery', 'cobbler', 'charcoal_burner', 'smithy', 'potter_kiln']);
assert.deepEqual(categoryKeys('faith'), ['chapel', 'monastery']);
assert.deepEqual(categoryKeys('decorations'), ['wayside_shrine', 'dry_stone_wall']);
assert.deepEqual(categoryKeys('military'), ['watchtower', 'guardhouse', 'palisaded_refuge']);
assert.equal(BUILD_MENU_CATEGORIES.at(-1)?.conflictOnly, true);

const allActions = BUILD_MENU_ENTRIES.map((entry) => entry.action);
assert.equal(new Set(allActions).size, allActions.length, 'each build action must belong to exactly one menu');
assert.equal(
  BUILD_MENU_ENTRIES.some((entry) => entry.artKey.includes('ferry')),
  false,
  'the removed ferry must not remain in any build category',
);

const renderedCards = renderBuildMenuCards();
const renderedCardTags = [...renderedCards.matchAll(/<button[^>]*class="construction-card"[^>]*>/g)]
  .map((match) => match[0]);
assert.equal(renderedCardTags.length, BUILD_MENU_ENTRIES.length);
for (const card of renderedCardTags) {
  assert.match(card, /data-tooltip-cost="[^"]+"/, 'every build-card hover tooltip must list its construction cost');
  assert.match(card, /data-tooltip-cost-affordable="true"/, 'every build card must expose a live affordability state');
}
const residenceCardTag = renderedCardTags.find((card) => card.includes('data-action="residences"')) ?? '';
const residenceTooltipCost = decodeResourceCostTooltip(
  residenceCardTag.match(/data-tooltip-cost="([^"]+)"/)?.[1] ?? '',
);
assert.deepEqual(residenceTooltipCost, {
  items: resourceCostEntries(buildingResourceCostAmounts(residenceZoneCost(1))),
  suffix: 'per home',
});
assert.deepEqual(
  decodeResourceCostTooltip(FREE_CONSTRUCTION_COST_TOOLTIP),
  { items: [], suffix: '' },
  'a no-charge land parcel must render a truthful Free construction cost',
);
assert.equal(
  isResourceCostAffordable({ timber: 4, stone: 6 }, buildingResourceCostAmounts(residenceZoneCost(1))),
  false,
  'a one-home burgage cost must become unaffordable when any required material is short',
);
assert.equal(
  isResourceCostAffordable(
    { timber: residenceZoneCost(1).timber - 5e-7, stone: residenceZoneCost(1).stone },
    buildingResourceCostAmounts(residenceZoneCost(1)),
  ),
  true,
  'client affordability must share the authority’s floating-point tolerance',
);
assert.equal(
  buildingCostWithCarpenterSupport('monastery', false).roofTiles,
  72,
  'the active Monastery placement cost must retain its fired roof tiles',
);
assert.match(
  renderResourceCost({ timber: 5 }, { unaffordable: true }),
  /aria-label="Not enough resources\. 5 timber"/,
  'the red affordability state must also be announced without relying on color',
);
assert.match(
  renderToolbarStatus({
    canBuild: false,
    hasDraft: true,
    mode: 'residences',
    statusDetail: '1 cottage worksite planned',
    placementCost: residenceZoneCost(1),
    placementCostAffordable: false,
    placementResourceShortfall: true,
  }),
  /Construction cost <span class="resource-cost resource-cost--compact resource-cost--unaffordable"/,
  'an unaffordable burgage should keep its ordinary status copy and make only the cost red',
);
assert.equal(isConstructionResourceShortfallMessage('Not enough timber (need 5 timber).'), true);
assert.equal(isConstructionResourceShortfallMessage('Not enough stone (need 6 stone).'), true);
assert.equal(isConstructionResourceShortfallMessage('Not enough ironwork fittings (need 4 ironwork).'), true);
assert.equal(isConstructionResourceShortfallMessage('Not enough fired roof tiles (need 72 roof tiles).'), true);
assert.equal(isConstructionResourceShortfallMessage('Not enough resources for this building.'), true);
assert.equal(isConstructionResourceShortfallMessage('Not enough workers are available.'), false);
assert.equal(isConstructionResourceShortfallMessage('Placement overlaps a road.'), false);
assert.equal(describeBuildingPlacementBlocker('insufficient_resources'), 'Site clear');

const unaffordableCard = fakeBuildMenuCard('residences');
syncBuildMenuCardAffordability(
  fakeBuildMenu(unaffordableCard),
  { timber: 0, stone: 0 },
);
assert.equal(unaffordableCard.dataset.tooltipCostAffordable, 'false');
assert.equal(unaffordableCard.classList.contains('is-unaffordable'), true);
assert.match(unaffordableCard.getAttribute('aria-label') ?? '', /Not enough resources/);
syncBuildMenuCardAffordability(
  fakeBuildMenu(unaffordableCard),
  buildingResourceCostAmounts(residenceZoneCost(1)),
);
assert.equal(unaffordableCard.dataset.tooltipCostAffordable, 'true');
assert.equal(unaffordableCard.classList.contains('is-unaffordable'), false);
assert.doesNotMatch(unaffordableCard.getAttribute('aria-label') ?? '', /Not enough resources/);
const freeCard = fakeBuildMenuCard('dry-stone-wall');
syncBuildMenuCardAffordability(fakeBuildMenu(freeCard), {});
assert.equal(freeCard.dataset.tooltipCostAffordable, 'true');
assert.equal(freeCard.classList.contains('is-unaffordable'), false);

const buildingPreviewValidity: boolean[] = [];
const stationaryBuildingTool = Object.assign(Object.create(BuildingTool.prototype), {
  mode: 'well',
  lastPreviewX: 12,
  lastPreviewZ: 24,
  lastValidatedX: 12,
  lastValidatedZ: 24,
  lastPreviewValidation: { ok: true },
  lastValidationTime: 0,
  validationDirty: false,
  placementStatusDetail: 'Ready: site clear',
  options: {
    markers: {
      setPlacementPreview: (_kind: string, _x: number, _z: number, valid: boolean) => {
        buildingPreviewValidity.push(valid);
      },
    },
  },
  validate: () => ({ ok: true }),
}) as BuildingTool;
stationaryBuildingTool.markPlacementResourceShortfall('well');
assert.equal(stationaryBuildingTool.isPlacementResourceShortfall(), true);
assert.equal(buildingPreviewValidity.at(-1), false);
stationaryBuildingTool.revalidatePreview();
assert.equal(stationaryBuildingTool.isPlacementReady(), true);
assert.equal(buildingPreviewValidity.at(-1), true);

const burgagePreviewValidity: boolean[] = [];
const stationaryBurgageTool = Object.assign(Object.create(BurgageTool.prototype), {
  enabled: true,
  placementStage: 4,
  previewLayout: {},
  draftValidation: { ok: true, layout: {} },
  validationDirty: false,
  lastValidationTime: 0,
  preview: {
    setValidity: (valid: boolean) => burgagePreviewValidity.push(valid),
  },
  runValidation(this: { draftValidation: { ok: true; layout: object } }) {
    this.draftValidation = { ok: true, layout: {} };
  },
}) as BurgageTool;
stationaryBurgageTool.markPlacementResourceShortfall();
assert.equal(stationaryBurgageTool.isPlacementResourceShortfall(), true);
assert.equal(burgagePreviewValidity.at(-1), false);
stationaryBurgageTool.revalidatePreview();
assert.equal(stationaryBurgageTool.isDraftBuildable(), true);
assert.doesNotMatch(renderedCards, /data-hotkey=/, 'build cards must no longer expose sub-hotkeys');
assert.doesNotMatch(renderedCards, /construction-card__hotkey/, 'build cards must not render hotkey badges');
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
assert.ok(fs.statSync('public/assets/ui/build-menu/cards/tannery.webp').size > 20_000);
assert.ok(fs.statSync('public/assets/ui/build-menu/cards/cobbler.webp').size > 20_000);
assert.match(renderedCards, /data-action="tannery"[\s\S]*?data-src="\/assets\/ui\/build-menu\/cards\/tannery\.webp"/);
assert.match(renderedCards, /data-action="cobbler"[\s\S]*?data-src="\/assets\/ui\/build-menu\/cards\/cobbler\.webp"/);
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
  /data-action="monastery"[^>]*data-tooltip="[^"]*hosts pilgrims[^"]*aids villagers[^"]*safeguards seed[^"]*charitable works\./,
);
const monasteryCard = renderedCards.match(/<button[^>]*data-action="monastery"[^>]*>/)?.[0] ?? '';
assert.doesNotMatch(
  monasteryCard,
  /data-tooltip-flow=/,
  'the monastery must not present its private estate stores as player-facing production',
);
assert.doesNotMatch(renderedCards, /data-action="vineyard"/, 'vineyards must be monastery field extensions, not standalone buildings');
assert.equal(
  [...renderedCards.matchAll(/data-tooltip-placement="above"/g)].length,
  BUILD_MENU_ENTRIES.length,
  'every build-card tooltip must request the above-menu placement',
);
assert.ok(fs.existsSync('public/assets/ui/icons/resource-cider.png'));
assert.ok(fs.existsSync('public/assets/ui/icons/resource-pear-cider.png'));
assert.ok(fs.existsSync('public/assets/ui/icons/resource-mead.png'));
const iconography = fs.readFileSync('src/ui/iconography.css', 'utf8');
assert.match(iconography, /data-resource='cider'[\s\S]*?resource-cider\.png/);
assert.match(iconography, /data-resource='pearCider'[\s\S]*?resource-pear-cider\.png/);
assert.match(iconography, /data-resource='mead'[\s\S]*?resource-mead\.png/);
assert.match(iconography, /data-resource-cost='cider'[\s\S]*?resource-cider\.png/);
assert.match(iconography, /data-resource-cost='pearCider'[\s\S]*?resource-pear-cider\.png/);
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
assert.match(
  toolbarSource,
  /data-action="build-menu"[^>]*>[\s\S]*?construction-dock-button__hotkey"[^>]*>B</,
);
assert.match(toolbarSource, /data-build-menu-cards/);
assert.match(toolbarSource, /class="build-menu-categories"/);
assert.match(toolbarSource, /setBuildMenuCategory\(DEFAULT_BUILD_MENU_CATEGORY, true\)/);
assert.doesNotMatch(toolbarSource, /resolveBuildMenuHotkey/);
assert.doesNotMatch(toolbarSource, /data-action="(?:civic|gathering|agriculture|industry|military)-build-menu"/);

const tooltipSource = fs.readFileSync('src/ui/tooltips.ts', 'utf8');
assert.match(tooltipSource, /label\.textContent = 'Construction cost'/);
assert.match(tooltipSource, /tooltipCostAffordable !== 'false'/);
const burgageToolSource = fs.readFileSync('src/residences/BurgageTool.ts', 'utf8');
assert.doesNotMatch(
  burgageToolSource,
  /\b(?:Need|Not enough)\b/,
  'burgage resource shortfalls must be represented by the cost color, not long status prose',
);
const bootstrapSource = fs.readFileSync('src/app/appBootstrap.ts', 'utf8');
assert.match(bootstrapSource, /buildingTool\.markPlacementResourceShortfall\(kind\)/);
assert.match(bootstrapSource, /burgageTool\.markPlacementResourceShortfall\(\)/);
assert.match(bootstrapSource, /if \(reason === 'insufficient_resources'\) return;/);
const appSource = fs.readFileSync('src/app/App.ts', 'utf8');
assert.match(appSource, /constructionResourceSignature[\s\S]{0,800}buildingTool\.revalidatePreview\(\)[\s\S]{0,120}burgageTool\.revalidatePreview\(\)/);
const burgageValidationSource = fs.readFileSync('src/residences/burgagePlacementValidation.ts', 'utf8');
assert.match(burgageValidationSource, /stockpile\.timber \+ 1e-6 < cost\.timber/);
assert.match(burgageValidationSource, /stockpile\.stone \+ 1e-6 < cost\.stone/);

console.log('Build menu category tests passed.');

function keys(entries: readonly BuildMenuEntry[]): string[] {
  return entries.map((entry) => entry.artKey);
}

function categoryKeys(id: string): string[] {
  const category = BUILD_MENU_CATEGORIES.find((candidate) => candidate.id === id);
  assert.ok(category, `missing build category ${id}`);
  return keys(category.entries);
}

function fakeBuildMenuCard(action: string): HTMLButtonElement {
  const classes = new Set(['construction-card']);
  const attributes = new Map([['aria-label', `${action} cost`]]);
  return {
    dataset: { action },
    classList: {
      contains: (token: string) => classes.has(token),
      remove: (...tokens: string[]) => tokens.forEach((token) => classes.delete(token)),
      toggle: (token: string, force?: boolean) => {
        const enabled = force ?? !classes.has(token);
        if (enabled) classes.add(token);
        else classes.delete(token);
        return enabled;
      },
    },
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => { attributes.set(name, value); },
  } as unknown as HTMLButtonElement;
}

function fakeBuildMenu(...cards: HTMLButtonElement[]): ParentNode {
  return {
    querySelectorAll: () => cards,
  } as unknown as ParentNode;
}
