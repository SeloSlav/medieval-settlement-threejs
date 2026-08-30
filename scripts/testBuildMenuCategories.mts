import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  AGRICULTURE_BUILD_MENU_ENTRIES,
  BUILD_MENU_CATEGORIES,
  BUILD_MENU_ENTRIES,
  CIVIC_BUILD_MENU_ENTRIES,
  GATHERING_BUILD_MENU_ENTRIES,
  hydrateBuildMenuImages,
  INDUSTRY_BUILD_MENU_ENTRIES,
  MILITARY_BUILD_MENU_ENTRIES,
  renderBuildMenuCards,
  syncBuildMenuCardAffordability,
  type BuildMenuEntry,
} from '../src/ui/buildMenuCards.ts';
import {
  BUILDING_KIND_TO_MENU_ACTION,
  MENU_ACTION_TO_BUILDING_KIND,
} from '../src/ui/buildMenuMapping.ts';
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
  resourceCostShortfallKinds,
} from '../src/ui/resourceCost.ts';
import { isConstructionResourceShortfallMessage } from '../src/ui/toastMessages.ts';
import { resolveTooltipPosition } from '../src/ui/tooltips.ts';
import { BUILDING_COSTS, BUILDING_DEFINITIONS } from '../src/generated/gameBalance.ts';

const STONE_BUILDING_COSTS: Readonly<Record<string, number>> = {
  potter_kiln: 16,
  well: 30,
  chapel: 24,
  wayside_shrine: 8,
  town_hall: 30,
  village_storehouse: 16,
  watchtower: 10,
  guardhouse: 20,
  monastery: 150,
  brewery: 24,
  tavern: 20,
  granary: 30,
  bakery: 20,
  weaponsmith_armorer: 18,
};

assert.deepEqual(BUILDING_COSTS.founders_camp, {
  timber: 0,
  stone: 0,
  gold: 1_000,
});
for (const [kind, cost] of Object.entries(BUILDING_COSTS)) {
  assert.equal(
    cost.stone,
    STONE_BUILDING_COSTS[kind] ?? 0,
    `${kind} must retain its authored stone construction cost`,
  );
}

assert.deepEqual(keys(CIVIC_BUILD_MENU_ENTRIES), [
  'residences', 'well', 'stable', 'founders_camp', 'chapel', 'wayside_shrine', 'dry_stone_wall', 'monastery', 'marketplace', 'tavern', 'trading_post', 'town_hall',
  'village_storehouse', 'granary',
]);
assert.deepEqual(keys(GATHERING_BUILD_MENU_ENTRIES), [
  'lumber_mill', 'woodcutters_lodge', 'reforester', 'stone_quarry', 'large_quarry', 'mine',
  'hunters_hall', 'foragers_shed', 'fishing_camp',
]);
assert.equal(
  GATHERING_BUILD_MENU_ENTRIES.some((entry) => entry.artKey === 'mine'),
  true,
  'Mineworks must remain buildable',
);
assert.deepEqual(keys(AGRICULTURE_BUILD_MENU_ENTRIES), [
  'threshing_barn', 'apiary', 'pastoral_farmstead', 'swineherd',
]);
assert.deepEqual(keys(INDUSTRY_BUILD_MENU_ENTRIES), [
  'watermill', 'windmill', 'bakery', 'brewery', 'smokehouse',
  'carpenter', 'spinning_retting_house', 'weaver', 'tannery', 'cobbler', 'chandlery', 'charcoal_burner', 'smithy', 'potter_kiln',
  'weaponsmith_armorer', 'bowyer_fletcher',
]);

assert.deepEqual(BUILD_MENU_CATEGORIES.map((category) => category.id), [
  'civic', 'trade', 'gathering', 'agriculture',
  'food', 'industry', 'faith', 'decorations', 'military',
]);
assert.deepEqual(categoryKeys('civic'), ['residences', 'well', 'stable', 'founders_camp', 'town_hall']);
assert.deepEqual(categoryKeys('trade'), ['marketplace', 'trading_post', 'village_storehouse', 'granary']);
assert.deepEqual(categoryKeys('gathering'), [
  'lumber_mill', 'woodcutters_lodge', 'reforester', 'stone_quarry', 'large_quarry', 'mine', 'hunters_hall', 'foragers_shed', 'fishing_camp',
]);
assert.deepEqual(categoryKeys('agriculture'), ['threshing_barn', 'apiary', 'pastoral_farmstead', 'swineherd']);
assert.deepEqual(categoryKeys('food'), ['watermill', 'windmill', 'bakery', 'brewery', 'tavern', 'smokehouse']);
assert.deepEqual(categoryKeys('industry'), ['carpenter', 'spinning_retting_house', 'weaver', 'tannery', 'cobbler', 'chandlery', 'charcoal_burner', 'smithy', 'weaponsmith_armorer', 'bowyer_fletcher', 'potter_kiln']);
assert.deepEqual(categoryKeys('faith'), ['chapel', 'monastery']);
assert.deepEqual(categoryKeys('decorations'), ['wayside_shrine', 'dry_stone_wall']);
assert.deepEqual(categoryKeys('military'), ['watchtower', 'guardhouse', 'palisaded_refuge']);
assert.equal(BUILD_MENU_CATEGORIES.at(-1)?.conflictOnly, true);
assert.equal(BUILDING_KIND_TO_MENU_ACTION.founders_camp, 'founders-camp');
assert.equal(MENU_ACTION_TO_BUILDING_KIND['founders-camp'], 'founders_camp');
assert.equal(BUILDING_KIND_TO_MENU_ACTION.stable, 'stable');
assert.equal(MENU_ACTION_TO_BUILDING_KIND.stable, 'stable');
assert.equal(BUILDING_KIND_TO_MENU_ACTION.chandlery, 'chandlery');
assert.equal(MENU_ACTION_TO_BUILDING_KIND.chandlery, 'chandlery');

const allActions = BUILD_MENU_ENTRIES.map((entry) => entry.action);
assert.equal(new Set(allActions).size, allActions.length, 'each build action must belong to exactly one menu');
assert.equal(
  BUILD_MENU_ENTRIES.some((entry) => entry.artKey.includes('ferry')),
  false,
  'the removed ferry must not remain in any build category',
);

const renderedCards = renderBuildMenuCards();
assert.match(
  renderedCards,
  /data-action="founders-camp"[\s\S]*?data-src="\/assets\/ui\/build-menu\/cards\/founders-camp\.webp"/,
  'the founders camp must have a dedicated civic build card and art asset',
);
assert.match(
  renderedCards,
  /data-action="stable"[\s\S]*?data-src="\/assets\/ui\/build-menu\/cards\/stable\.webp"/,
  'the stable must have a dedicated civic build card and art asset',
);
assert.match(
  renderedCards,
  /data-action="pastoral-farmstead"[\s\S]*?data-tooltip="Raises cattle and sheep for milk, wool, hides, manure, meat, and prepared Animal Feed\."/,
  'the pastoral card must summarize what the holding produces',
);
assert.match(
  renderedCards,
  /data-action="swineherd"[\s\S]*?data-tooltip="Raises woodland pigs for meat and hides using prepared Animal Feed\."/,
  'the swineherd card must summarize what the holding produces',
);
assert.match(
  renderedCards,
  /data-action="stable"[\s\S]*?data-tooltip="Houses oxen for building, farm work, and hauling\."/,
  'the stable card must summarize what its oxen do',
);
const cardResourceFlow = (action: string): { inputs: string[]; outputs: string[] } => {
  const encoded = renderedCards.match(
    new RegExp(`data-action="${action}"[^>]*data-tooltip-flow="([^"]+)"`),
  )?.[1];
  assert.ok(encoded, `${action} must expose its physical resource flow`);
  return JSON.parse(decodeURIComponent(encoded));
};
const pastoralFlow = cardResourceFlow('pastoral-farmstead');
assert.ok(pastoralFlow.inputs.includes('oatGrain'));
assert.ok(pastoralFlow.outputs.includes('animalFeed'));
const swineFlow = cardResourceFlow('swineherd');
assert.ok(swineFlow.inputs.includes('animalFeed'));
assert.ok(!swineFlow.inputs.includes('oatGrain'), 'swineherds must receive prepared feed rather than raw oats');
assert.match(
  renderedCards,
  /<img class="construction-card__art"[^>]*alt=""[^>]*>[\s\S]*?<span class="construction-card__art-fallback" aria-hidden="true" hidden>/,
  'build-card art must be decorative while a deliberate visual fallback remains available',
);

let artErrorListener: (() => void) | null = null;
const fallbackClasses = new Set<string>();
const fakeFallback = { hidden: true };
const fakeCard = {
  ariaLabel: 'Mine. Delves mineral seams for iron or salt.',
  classList: {
    add: (name: string) => fallbackClasses.add(name),
    remove: (name: string) => fallbackClasses.delete(name),
  },
  querySelector: () => fakeFallback,
};
const fakeImage = {
  dataset: { src: '/assets/ui/build-menu/cards/iron-mine.webp' } as Record<string, string>,
  hidden: false,
  assignedSrc: '',
  closest: () => fakeCard,
  addEventListener: (event: string, listener: () => void) => {
    if (event === 'error') artErrorListener = listener;
  },
  removeAttribute: function (name: string) {
    if (name === 'src') this.assignedSrc = '';
  },
  set src(value: string) {
    this.assignedSrc = value;
  },
  get src() {
    return this.assignedSrc;
  },
};
hydrateBuildMenuImages({
  querySelectorAll: () => [fakeImage],
} as unknown as ParentNode);
assert.equal(fakeImage.assignedSrc, '/assets/ui/build-menu/cards/iron-mine.webp');
assert.equal(fakeImage.dataset.src, undefined);
assert.ok(artErrorListener, 'hydration must register a load-failure fallback before assigning src');
artErrorListener();
assert.equal(fakeImage.hidden, true, 'a failed bitmap must be removed instead of showing broken-image chrome');
assert.equal(fakeImage.assignedSrc, '');
assert.equal(fakeImage.dataset.artState, 'fallback');
assert.equal(fakeFallback.hidden, false, 'the intentional hammer fallback must replace failed art');
assert.ok(fallbackClasses.has('is-art-unavailable'));
assert.equal(
  fakeCard.ariaLabel,
  'Mine. Delves mineral seams for iron or salt.',
  'image failure must preserve the card action accessible name',
);

const renderedCardTags = [...renderedCards.matchAll(/<button[^>]*class="construction-card"[^>]*>/g)]
  .map((match) => match[0]);
assert.equal(renderedCardTags.length, BUILD_MENU_ENTRIES.length);
for (const card of renderedCardTags) {
  assert.match(card, /data-tooltip-cost="[^"]+"/, 'every build-card hover tooltip must list its construction cost');
  assert.match(card, /data-tooltip-cost-affordable="true"/, 'every build card must expose a live affordability state');
}
const smallMapCards = renderBuildMenuCards(BUILD_MENU_ENTRIES, { mapSize: 'small' });
const smallMapFoundersCard = [...smallMapCards.matchAll(/<button[^>]*class="construction-card"[^>]*>/g)]
  .map((match) => match[0])
  .find((card) => card.includes('data-action="founders-camp"')) ?? '';
assert.match(smallMapFoundersCard, /\sdisabled(?:\s|>)/, 'small maps must natively disable the founders camp card');
assert.match(smallMapFoundersCard, /aria-disabled="true"/);
assert.match(
  smallMapFoundersCard,
  /title="Additional Founders' Camps require a medium or large map\."/,
  'the disabled founders camp card must explain its map-size requirement',
);
assert.match(
  smallMapFoundersCard,
  /aria-label="[^"]*Additional Founders' Camps require a medium or large map\."/,
  'the small-map reason must be available to assistive technology',
);
const mediumMapCards = renderBuildMenuCards(BUILD_MENU_ENTRIES, { mapSize: 'medium' });
const mediumMapFoundersCard = [...mediumMapCards.matchAll(/<button[^>]*class="construction-card"[^>]*>/g)]
  .map((match) => match[0])
  .find((card) => card.includes('data-action="founders-camp"')) ?? '';
assert.doesNotMatch(mediumMapFoundersCard, /\sdisabled(?:\s|>)/, 'medium maps must enable founders camps');
assert.doesNotMatch(mediumMapFoundersCard, /aria-disabled="true"/);
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
assert.match(
  renderToolbarStatus({
    canBuild: false,
    hasDraft: false,
    mode: 'well',
    wellAquiferNetworksEnabled: false,
  }),
  /every well site has the same reliable yield/,
);
assert.match(
  renderToolbarStatus({
    canBuild: false,
    hasDraft: false,
    mode: 'well',
    wellAquiferNetworksEnabled: true,
  }),
  /use the groundwater map for the best aquifer sites/,
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
  { timber: residenceZoneCost(1).timber - 1, stone: 0 },
);
assert.equal(unaffordableCard.dataset.tooltipCostAffordable, 'false');
assert.equal(unaffordableCard.dataset.tooltipCostShortages, 'timber');
assert.equal(unaffordableCard.classList.contains('is-unaffordable'), true);
assert.equal(fakeCostItem(unaffordableCard, 'timber').classList.contains('is-unaffordable'), true);
assert.equal(fakeCostItem(unaffordableCard, 'stone').classList.contains('is-unaffordable'), false);
assert.match(unaffordableCard.getAttribute('aria-label') ?? '', /Not enough resources/);
syncBuildMenuCardAffordability(
  fakeBuildMenu(unaffordableCard),
  buildingResourceCostAmounts(residenceZoneCost(1)),
);
assert.equal(unaffordableCard.dataset.tooltipCostAffordable, 'true');
assert.equal(unaffordableCard.dataset.tooltipCostShortages, '');
assert.equal(unaffordableCard.classList.contains('is-unaffordable'), false);
assert.equal(fakeCostItem(unaffordableCard, 'stone').classList.contains('is-unaffordable'), false);
assert.doesNotMatch(unaffordableCard.getAttribute('aria-label') ?? '', /Not enough resources/);
const freeCard = fakeBuildMenuCard('dry-stone-wall');
syncBuildMenuCardAffordability(fakeBuildMenu(freeCard), {});
assert.equal(freeCard.dataset.tooltipCostAffordable, 'true');
assert.equal(freeCard.classList.contains('is-unaffordable'), false);
assert.deepEqual(
  resourceCostShortfallKinds({ timber: 64, stone: 20, ironwork: 0 }, { timber: 64, stone: 42, ironwork: 4 }),
  ['stone', 'ironwork'],
  'shortfalls must identify only the individually missing construction resources',
);

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
    getState: () => ({ foragingNodes: new Map() }),
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
assert.match(renderedCards, />Mining Camp</);
assert.match(renderedCards, />Quarry</);
assert.match(renderedCards, />Mineworks</);
assert.doesNotMatch(renderedCards, /data-action="clay-pit"/);
assert.match(
  renderedCards,
  /data-action="tavern"[\s\S]*?data-src="\/assets\/ui\/build-menu\/cards\/tavern\.webp"/,
  'the Tavern must use its dedicated build-card illustration',
);
for (const [action, asset] of [
  ['mine', 'iron-mine.webp'],
  ['charcoal-burner', 'charcoal-burner.webp'],
  ['smithy', 'smithy-bloomery.webp'],
  ['potter-kiln', 'potter-kiln.webp'],
  ['wayside-shrine', 'wayside-shrine.webp'],
  ['trading-post', 'trading-post.webp'],
  ['palisaded-refuge', 'palisaded-refuge.webp'],
  ['tavern', 'tavern.webp'],
  ['bakery', 'bakery.webp'],
] as const) {
  assert.match(
    renderedCards,
    new RegExp(`data-action="${action}"[\\s\\S]*?data-src="/assets/ui/build-menu/cards/${asset}"`),
    `${action} must use its dedicated build-card illustration`,
  );
  assert.ok(fs.statSync(`public/assets/ui/build-menu/cards/${asset}`).size > 20_000);
}
assert.ok(fs.existsSync('public/assets/ui/build-menu/cards/tavern.webp'));
assert.ok(fs.existsSync('public/assets/ui/build-menu/cards/wayside-shrine.webp'));
assert.ok(fs.existsSync('public/assets/ui/build-menu/cards/dry-stone-wall.webp'));
assert.ok(fs.statSync('public/assets/ui/build-menu/cards/tannery.webp').size > 20_000);
assert.ok(fs.statSync('public/assets/ui/build-menu/cards/cobbler.webp').size > 20_000);
assert.ok(fs.statSync('public/assets/ui/build-menu/cards/chandlery.webp').size > 20_000);
assert.match(renderedCards, /data-action="tannery"[\s\S]*?data-src="\/assets\/ui\/build-menu\/cards\/tannery\.webp"/);
assert.match(renderedCards, /data-action="cobbler"[\s\S]*?data-src="\/assets\/ui\/build-menu\/cards\/cobbler\.webp"/);
assert.match(renderedCards, /data-action="chandlery"[\s\S]*?data-src="\/assets\/ui\/build-menu\/cards\/chandlery\.webp"/);
assert.ok(renderedCards.includes('%22wax%22'));
assert.ok(renderedCards.includes('%22candles%22'));
assert.match(renderedCards, /data-action="dry-stone-wall"[\s\S]*?>Dry-stone wall</);
assert.match(renderedCards, /data-action="village-storehouse"[\s\S]*?>Storehouse</);
assert.match(renderedCards, /data-action="granary"[\s\S]*?>Granary</);
assert.doesNotMatch(renderedCards, />Village (?:storehouse|granary)</);
assert.equal(BUILDING_DEFINITIONS.village_storehouse.label, 'Storehouse');
assert.equal(BUILDING_DEFINITIONS.granary.label, 'Granary');
assert.match(
  renderedCards,
  /data-action="marketplace"[^>]*data-tooltip="Distributes food, trades goods, and collects local taxes\."/,
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
  /data-action="monastery"[^>]*data-tooltip="Hosts pilgrims and supports villagers through worship, feasts, seedkeeping, and charity\."/,
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
  assert.equal(sentenceCount, 1, `build-card copy must be one sentence: ${description}`);
  assert.ok(wordCount <= 20, `build-card copy must stay quickly scannable: ${description}`);
  assert.doesNotMatch(description, /\bcost:/i, 'construction cost must not be repeated in tooltip prose');
  assert.doesNotMatch(
    description,
    /\b(?:abstracted|automatic assistance|beyond the map|does not|fallback|free|instantly|maintained|non-depleting|off[- ]map|replacement|requirement|required|seasonal|tier \d|unlocks?|wear)\b|without snapping|lower building costs|hasten deliveries|raise output|stays? separate|use\w* .+ before/i,
    `build-card copy must describe the building's purpose instead of detailed mechanics: ${description}`,
  );
}
assert.match(renderedCards, /data-action="threshing-barn"[\s\S]*?data-tooltip="Cultivates grain and flax fields and threshes harvested sheaves\."/);
assert.match(renderedCards, /data-action="pastoral-farmstead"[\s\S]*?data-tooltip="Raises cattle and sheep for milk, wool, hides, manure, meat, and prepared Animal Feed\."/);
assert.match(renderedCards, /data-action="swineherd"[\s\S]*?data-tooltip="Raises woodland pigs for meat and hides using prepared Animal Feed\."/);
assert.match(renderedCards, /data-action="stone-quarry"[\s\S]*?data-tooltip="Extracts stone, iron, salt, and clay from nearby surface deposits\."/);
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
assert.doesNotMatch(
  toolbarSource,
  /construction-menu__header">\s*<span>Build<\/span>/,
  'the category title must not repeat the word Build in the menu header',
);
assert.match(toolbarSource, /setBuildMenuCategory\(DEFAULT_BUILD_MENU_CATEGORY, true\)/);
const buildMenuOpenSource = toolbarSource.match(
  /private setBuildMenuOpen\(open: boolean\): void \{[\s\S]*?\n  \}\n\n  private setBuildMenuCategory/,
)?.[0] ?? '';
assert.ok(buildMenuOpenSource, 'the build-menu open-state controller must remain discoverable');
assert.doesNotMatch(
  buildMenuOpenSource,
  /this\.setBuildMenuCategory\(/,
  'reopening the build menu, including with B, must retain the last selected category',
);
assert.match(toolbarSource, /setMapSize\(mapSize: WorldMapSize\): void/);
assert.match(
  toolbarSource,
  /renderBuildMenuCards\(category\.entries, \{ mapSize: this\.mapSize \}\)/,
  'changing the authoritative map size must flow into every category render',
);
assert.match(
  toolbarSource,
  /if \(button\.disabled \|\| button\.getAttribute\('aria-disabled'\) === 'true'\) return;/,
  'disabled build cards must be guarded even when actions are invoked through delegated clicks',
);
assert.match(
  toolbarSource,
  /const placingStarterCamp = this\.starterCampRequired && stats\.mode === 'founders_camp';/,
  'expansion camps must keep their normal builder status while only the initial starter flow is suppressed',
);
assert.doesNotMatch(toolbarSource, /resolveBuildMenuHotkey/);
assert.doesNotMatch(toolbarSource, /data-action="(?:civic|gathering|agriculture|industry|military)-build-menu"/);

const tooltipSource = fs.readFileSync('src/ui/tooltips.ts', 'utf8');
assert.match(tooltipSource, /label\.textContent = costLabel/);
assert.match(tooltipSource, /tooltipCostAffordable !== 'false'/);
assert.match(tooltipSource, /shortageKinds\?\.has\(item\.kind\) === true/);
assert.match(
  tooltipSource,
  /if \(activeAnchor === anchor && !tooltip\.hidden\) \{\s*activeTrigger = trigger;\s*refresh\(anchor\);\s*return;/,
  'repeated events inside one tooltip anchor must not restart its visibility transition',
);
const polishedGameUiSource = fs.readFileSync('src/ui/polishedGameUi.css', 'utf8');
const constructionCardHoverRule = polishedGameUiSource.match(
  /\.construction-card:hover,\s*\.construction-card:focus-visible\s*\{[^}]*\}/,
)?.[0] ?? '';
assert.ok(constructionCardHoverRule, 'the polished build-card hover rule must exist');
assert.doesNotMatch(
  constructionCardHoverRule,
  /\btransform\s*:/,
  'hover must not move the build-card hitbox out from under the pointer',
);
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
  const costItems = ['timber', 'stone', 'ironwork', 'roofTiles', 'gold'].map(fakeResourceCostItem);
  return {
    dataset: { action },
    classList: fakeClassList(classes),
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => { attributes.set(name, value); },
    querySelectorAll: () => costItems,
  } as unknown as HTMLButtonElement;
}

function fakeResourceCostItem(kind: string): HTMLElement {
  const classes = new Set(['resource-cost__item']);
  return {
    dataset: { resourceCost: kind },
    classList: fakeClassList(classes),
  } as unknown as HTMLElement;
}

function fakeCostItem(card: HTMLButtonElement, kind: string): HTMLElement {
  const item = [...card.querySelectorAll<HTMLElement>('.resource-cost__item[data-resource-cost]')]
    .find((candidate) => candidate.dataset.resourceCost === kind);
  assert.ok(item, `missing fake ${kind} cost item`);
  return item;
}

function fakeClassList(classes: Set<string>) {
  return {
    contains: (token: string) => classes.has(token),
    remove: (...tokens: string[]) => tokens.forEach((token) => classes.delete(token)),
    toggle: (token: string, force?: boolean) => {
      const enabled = force ?? !classes.has(token);
      if (enabled) classes.add(token);
      else classes.delete(token);
      return enabled;
    },
  };
}

function fakeBuildMenu(...cards: HTMLButtonElement[]): ParentNode {
  return {
    querySelectorAll: () => cards,
  } as unknown as ParentNode;
}
