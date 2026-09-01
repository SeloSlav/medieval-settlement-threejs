import type { BuildingKind } from '../generated/gameBalance.ts';
import { formatBuildingCost, getBuildingCost, residenceZoneCost } from '../resources/buildingEconomy.ts';
import type { WorldMapSize } from '../world/worldGenerationSettings.ts';
import { BUILDING_CARD_ART } from '../resources/buildingCardArt.ts';
import { MENU_ACTION_TO_BUILDING_KIND } from './buildMenuMapping.ts';
import {
  buildingResourceCostAmounts,
  encodeResourceCostTooltip,
  renderBuildingResourceCost,
  resourceCostShortfallKinds,
  type ResourceCostAmounts,
  type ResourceCostKind,
} from './resourceCost.ts';

export type PlacementBuildMenuAction =
  | 'founders-camp'
  | 'lumber-mill' | 'stone-quarry' | 'large-quarry' | 'mine' | 'reforester' | 'woodcutters-lodge'
  | 'well' | 'stable' | 'cavalry-yard' | 'kennel' | 'hunters-hall' | 'foragers-shed' | 'fishing-camp' | 'chapel' | 'wayside-shrine' | 'marketplace' | 'trading-post'
  | 'threshing-barn' | 'monastery' | 'brewery' | 'tavern' | 'smokehouse'
  | 'granary' | 'bakery' | 'apiary' | 'watermill' | 'windmill' | 'carpenter'
  | 'spinning-retting-house' | 'weaver'
  | 'tannery' | 'cobbler'
  | 'chandlery'
  | 'pastoral-farmstead' | 'swineherd'
  | 'town-hall' | 'village-storehouse'
  | 'watchtower'
  | 'guardhouse'
  | 'palisaded-refuge'
  | 'charcoal-burner' | 'smithy' | 'potter-kiln'
  | 'weaponsmith-armorer' | 'bowyer-fletcher'
  | 'residences'
  | 'dry-stone-wall';

export type BuildMenuAction = PlacementBuildMenuAction;
type PlayerPlaceableBuildingKind = Exclude<
  BuildingKind,
  'salvage_pile'
>;
type DecorationArtKey = 'dry_stone_wall';
type PlacementArtKey = PlayerPlaceableBuildingKind | 'residences' | DecorationArtKey;
export type BuildMenuEntry = { kind: 'placement'; action: PlacementBuildMenuAction; artKey: PlacementArtKey };

const DECORATION_CARD_ART = '/assets/ui/build-menu/cards/dry-stone-wall.webp';
const RESIDENCE_CARD_ART = '/assets/ui/build-menu/cards/residence.webp';

function buildCardArtUrl(artKey: PlacementArtKey): string {
  if (artKey === 'dry_stone_wall') return DECORATION_CARD_ART;
  if (artKey === 'residences') return RESIDENCE_CARD_ART;
  return BUILDING_CARD_ART[artKey];
}

/** Card-language artwork reserved for the residence inspector, not the build palette. */
export const BACKYARD_EXTENSION_CARD_ART = '/assets/ui/build-menu/cards/backyard-extension.webp';

type BuildCardResourceFlow = readonly [
  inputs: readonly ResourceCostKind[],
  outputs: readonly ResourceCostKind[],
];

type BuildCardDetail = readonly [
  title: string,
  description: string,
  resourceFlow?: BuildCardResourceFlow,
];

const flow = (
  inputs: readonly ResourceCostKind[],
  outputs: readonly ResourceCostKind[],
): BuildCardResourceFlow => [inputs, outputs];

const DETAILS: Record<PlacementArtKey, BuildCardDetail> = {
  founders_camp: ["Founders' camp", 'Establishes a civic foothold from which a settlement can grow.'],
  residences: ['Residence', 'Provides homes for settlement families.'],
  well: ['Well', 'Draws and supplies water to nearby homes.', flow([], ['water'])],
  stable: ['Stable', 'Houses oxen used for construction, farm work, and hauling.'],
  cavalry_yard: ['Cavalry Yard', 'Musters pasture-owned horses and residents into equipped mounted companies.', flow(['animalFeed', 'oatGrain', 'water'], [])],
  kennel: ['Kennel', 'Trains guard dogs that patrol the settlement and confront thieves.'],
  chapel: ['Church', 'Serves parish life through worship, tithes, and household support.'],
  wayside_shrine: ['Wayside shrine', 'Marks the roadside with a small place of prayer and devotion.'],
  dry_stone_wall: ['Dry-stone wall', 'Lines roads with walls of fitted stone.'],
  monastery: ['Pauline monastery', 'Hosts pilgrims and supports villagers through worship, feasts, seedkeeping, and charity.'],
  marketplace: ['Marketplace', 'Distributes food, trades goods, and collects local taxes.'],
  trading_post: ['Trading Post', 'Imports and exports goods for the settlement.'],
  town_hall: ['Town Hall', "Governs local taxes and keeps the settlement's accounts."],
  village_storehouse: ['Storehouse', 'Stores construction materials, fuel, minerals, clay, salt, and all other non-food goods.'],
  watchtower: ['Frontier watchtower', 'Spots approaching raiders and warns nearby homes and stores.'],
  guardhouse: ['Frontier guardhouse', 'Musters armed guards to defend the settlement.'],
  palisaded_refuge: ['Palisaded refuge', 'Shelters families and their coin from approaching raiders.'],
  lumber_mill: ['Lumber mill', 'Fells mature trees and saws them into building timber.', flow([], ['timber'])],
  stone_quarry: ['Mining Camp', 'Extracts stone, iron, salt, and clay from nearby surface deposits.', flow([], ['stone', 'iron', 'salt', 'clay'])],
  large_quarry: ['Quarry', 'Excavates stone from rich deposits.', flow(['timber'], ['stone'])],
  mine: ['Mineworks', 'Extracts iron, salt, and clay from rich underground deposits.', flow(['timber'], ['iron', 'salt', 'clay'])],
  charcoal_burner: ["Charcoal burner's yard", 'Slow-burns firewood into charcoal for the smithy.', flow(['firewood'], ['charcoal'])],
  smithy: ['Smithy', 'Forges ironwork, tools, fittings, and weapons from iron and charcoal.', flow(['iron', 'charcoal', 'water'], ['ironwork'])],
  weaponsmith_armorer: ['Weaponsmith & Armorer', 'Turns finished settlement materials into sidearms, shields, polearms, padded armor, and mail armor.', flow(['timber', 'ironwork', 'leather', 'linen'], ['polearms', 'sidearms', 'shields', 'paddedArmor', 'mailArmor'])],
  bowyer_fletcher: ['Bowyer & Fletcher', 'Crafts bows, crossbows, and bundled ammunition for ranged companies.', flow(['timber', 'ironwork', 'linen', 'leather'], ['bows', 'crossbows', 'ammunition'])],
  potter_kiln: ["Potter's kiln", 'Fires clay into household pottery or sturdy roof tiles.', flow(['clay', 'water', 'firewood'], ['pottery', 'roofTiles'])],
  reforester: ['Reforester', 'Restores felled woodland with young native trees.'],
  woodcutters_lodge: ["Woodcutter's lodge", 'Fells nearby trees and splits them into firewood for settlement hearths.', flow([], ['firewood'])],
  hunters_hall: ["Hunter's hall", 'Hunts nearby game and dresses the catch for meat and trade-ready pelts.', flow([], ['meat', 'pelts'])],
  foragers_shed: ["Forager's shed", 'Gathers wild raspberries, mushrooms, and healing remedies.', flow([], ['berries', 'mushrooms', 'remedies'])],
  fishing_camp: ['Fishing camp', 'Catches fish from nearby waters.', flow([], ['fish'])],
  threshing_barn: ['Farmstead and threshing barn', 'Cultivates grain and flax fields and threshes harvested sheaves.', flow(['ryeSheaves', 'oatSheaves', 'barleySheaves', 'maslinSheaves'], ['ryeGrain', 'oatGrain', 'barley', 'maslinGrain', 'flax'])],
  watermill: ['Grain watermill', 'Uses river power to grind rye and maslin grain into flour.', flow(['ryeGrain', 'maslinGrain'], ['ryeFlour', 'maslinFlour'])],
  windmill: ['Grain windmill', 'Uses wind power to grind rye and maslin grain into flour.', flow(['ryeGrain', 'maslinGrain'], ['ryeFlour', 'maslinFlour'])],
  granary: ['Granary', 'Stores grain, fresh food, and preserved provisions for the settlement.'],
  bakery: ['Bakery', 'Bakes rye or maslin flour into bread for the settlement.', flow(['ryeFlour', 'maslinFlour', 'water', 'firewood'], ['ryeBread', 'maslinBread'])],
  brewery: ['Brewhouse', 'Brews ale, presses distinct apple or pear cider, or ferments mead.', flow(['barley', 'apples', 'pears', 'honey', 'water', 'firewood'], ['ale', 'cider', 'pearCider', 'mead'])],
  tavern: ['Tavern', 'Serves ale, cider, and mead to settlement households; up to three innkeepers increase refill speed.', flow(['ale', 'cider', 'pearCider', 'mead'], [])],
  smokehouse: ['Smokehouse', 'Preserves fresh food with firewood and salt.', flow(['food', 'firewood', 'salt'], ['preservedFood'])],
  apiary: ['Forest apiary', 'Accumulates honey through spring and summer for one staffed autumn harvest.', flow([], ['honey'])],
  carpenter: ['Carpenter & wheelwright', 'Crafts frames, carts, and wheels for settlement building and transport.'],
  spinning_retting_house: ['Spinning & Retting House', 'Spins sheep fleece into yarn and rets flax into linen.', flow(['wool', 'flax', 'water'], ['yarn', 'linen'])],
  weaver: ["Weaver's workshop", 'Weaves yarn or linen into finished clothing.', flow(['yarn', 'linen'], ['cloth'])],
  tannery: ['Tannery', 'Tans livestock hides into workable leather.', flow(['hides', 'water', 'firewood'], ['leather'])],
  cobbler: ["Cobbler's workshop", 'Cuts leather into finished shoes for prosperous households.', flow(['leather'], ['shoes'])],
  chandlery: ['Chandlery', 'Makes beeswax candles for households and regional trade.', flow(['wax', 'firewood'], ['candles'])],
  pastoral_farmstead: ['Pastoral farmstead', 'Raises cattle, sheep, and horses for livestock products and mounted companies.', flow(['water', 'oatGrain'], ['animalFeed', 'milk', 'wool', 'hides', 'manure', 'meat'])],
  swineherd: ['Woodland swineherd', 'Raises woodland pigs for meat and hides.', flow(['water', 'animalFeed'], ['meat', 'hides'])],
};

const action = (kind: PlayerPlaceableBuildingKind): PlacementBuildMenuAction =>
  kind.replaceAll('_', '-') as PlacementBuildMenuAction;
const entry = (artKey: PlacementArtKey): BuildMenuEntry => ({
  kind: 'placement',
  action: artKey === 'residences'
    ? 'residences'
    : artKey === 'dry_stone_wall'
      ? 'dry-stone-wall'
      : action(artKey),
  artKey,
});

/** Compatibility collection for systems that need the complete non-production civic set. */
export const CIVIC_BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  entry('residences'), entry('well'), entry('stable'), entry('kennel'), entry('founders_camp'), entry('chapel'), entry('wayside_shrine'), entry('dry_stone_wall'), entry('monastery'), entry('marketplace'), entry('tavern'), entry('trading_post'), entry('town_hall'), entry('village_storehouse'), entry('granary'),
];

/** Sites whose crews gather raw resources from the landscape. */
export const GATHERING_BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  entry('lumber_mill'), entry('woodcutters_lodge'), entry('reforester'), entry('stone_quarry'), entry('large_quarry'), entry('mine'),
  entry('hunters_hall'), entry('foragers_shed'), entry('fishing_camp'),
];

/** Farming, husbandry, and other primary agricultural production. */
export const AGRICULTURE_BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  entry('threshing_barn'), entry('apiary'),
  entry('pastoral_farmstead'), entry('swineherd'),
];

/** Workshops that process gathered or agricultural inputs into finished goods. */
export const INDUSTRY_BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  entry('watermill'), entry('windmill'), entry('bakery'), entry('brewery'), entry('smokehouse'),
  entry('carpenter'), entry('spinning_retting_house'), entry('weaver'), entry('tannery'), entry('cobbler'), entry('chandlery'), entry('charcoal_burner'), entry('smithy'), entry('potter_kiln'),
  entry('weaponsmith_armorer'), entry('bowyer_fletcher'),
];

/** Conflict-enabled early warning and settlement defenses. */
export const MILITARY_BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  entry('watchtower'), entry('guardhouse'), entry('cavalry_yard'), entry('palisaded_refuge'),
];

export type BuildMenuCategoryId =
  | 'civic'
  | 'trade'
  | 'gathering'
  | 'agriculture'
  | 'food'
  | 'industry'
  | 'faith'
  | 'decorations'
  | 'military';

export type BuildMenuCategory = {
  id: BuildMenuCategoryId;
  label: string;
  hint: string;
  icon: BuildMenuCategoryId;
  entries: readonly BuildMenuEntry[];
  conflictOnly?: boolean;
};

const CIVIC_SERVICES_BUILD_MENU_ENTRIES = [
  entry('residences'), entry('well'), entry('stable'), entry('kennel'), entry('founders_camp'), entry('town_hall'),
] as const;
const TRADE_BUILD_MENU_ENTRIES = [
  entry('marketplace'), entry('trading_post'), entry('village_storehouse'), entry('granary'),
] as const;
const FOOD_BUILD_MENU_ENTRIES = [
  entry('watermill'), entry('windmill'), entry('bakery'), entry('brewery'), entry('tavern'), entry('smokehouse'),
] as const;
const WORKSHOP_BUILD_MENU_ENTRIES = [
  entry('carpenter'), entry('spinning_retting_house'), entry('weaver'), entry('tannery'), entry('cobbler'), entry('chandlery'), entry('charcoal_burner'), entry('smithy'), entry('weaponsmith_armorer'), entry('bowyer_fletcher'), entry('potter_kiln'),
] as const;
const FAITH_BUILD_MENU_ENTRIES = [entry('chapel'), entry('monastery')] as const;
const DECORATION_BUILD_MENU_ENTRIES = [entry('wayside_shrine'), entry('dry_stone_wall')] as const;

/** The single build palette's icon-driven, deliberately granular category model. */
export const BUILD_MENU_CATEGORIES: readonly BuildMenuCategory[] = [
  { id: 'civic', label: 'Civic', hint: 'Homes, water, draft power, and settlement government', icon: 'civic', entries: CIVIC_SERVICES_BUILD_MENU_ENTRIES },
  { id: 'trade', label: 'Trade & storage', hint: 'Markets, exchange, and shared stores', icon: 'trade', entries: TRADE_BUILD_MENU_ENTRIES },
  { id: 'gathering', label: 'Gathering', hint: 'Wood, stone, game, forage, and fish', icon: 'gathering', entries: GATHERING_BUILD_MENU_ENTRIES },
  { id: 'agriculture', label: 'Agriculture', hint: 'Fields, orchards, and livestock', icon: 'agriculture', entries: AGRICULTURE_BUILD_MENU_ENTRIES },
  { id: 'food', label: 'Food & drink', hint: 'Milling, baking, brewing, and preservation', icon: 'food', entries: FOOD_BUILD_MENU_ENTRIES },
  { id: 'industry', label: 'Industry', hint: 'Fuel, crafts, textiles, leather, candles, metal, and pottery', icon: 'industry', entries: WORKSHOP_BUILD_MENU_ENTRIES },
  { id: 'faith', label: 'Faith', hint: 'Parish and monastic institutions', icon: 'faith', entries: FAITH_BUILD_MENU_ENTRIES },
  { id: 'decorations', label: 'Decorations', hint: 'Roadside details and stone walls', icon: 'decorations', entries: DECORATION_BUILD_MENU_ENTRIES },
  { id: 'military', label: 'Military', hint: 'Warning, infantry, cavalry, defense, and refuge', icon: 'military', entries: MILITARY_BUILD_MENU_ENTRIES, conflictOnly: true },
];

export const BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  ...BUILD_MENU_CATEGORIES.flatMap((category) => category.entries),
];

const BUILD_MENU_CARD_ARIA_LABELS = new WeakMap<HTMLButtonElement, string>();

export type BuildMenuHandlers = {
  onSelectBuilding: (kind: BuildingKind) => void;
  onSelectResidences: () => void;
  onSelectDryStoneWall: () => void;
};

export type BuildMenuRenderOptions = {
  mapSize?: WorldMapSize;
};

export const FOUNDERS_CAMP_SMALL_MAP_DISABLED_REASON =
  "Additional Founders' Camps require a medium or large map.";

export function renderBuildMenuCards(
  entries: readonly BuildMenuEntry[] = BUILD_MENU_ENTRIES,
  options: BuildMenuRenderOptions = {},
): string {
  const mapSize = options.mapSize ?? 'medium';
  return entries.map((entry) => {
    const [title, description, resourceFlow] = DETAILS[entry.artKey];
    const disabledReason = entry.artKey === 'founders_camp' && mapSize === 'small'
      ? FOUNDERS_CAMP_SMALL_MAP_DISABLED_REASON
      : null;
    const tooltipDescription = disabledReason
      ? `${description} ${disabledReason}`
      : description;
    const resourceCost = buildMenuEntryCost(entry);
    const costSuffix = entry.artKey === 'residences' ? 'per home' : '';
    const costText = `${formatBuildingCost(resourceCost)}${costSuffix ? ` ${costSuffix}` : ''}`;
    const costMarkup = renderBuildingResourceCost(resourceCost, {
      compact: true,
      suffix: costSuffix,
    });
    const tooltipCost = encodeResourceCostTooltip(
      buildingResourceCostAmounts(resourceCost),
      { suffix: costSuffix },
    );
    const flowAttribute = resourceFlow
      ? ` data-tooltip-flow="${encodeURIComponent(JSON.stringify({ inputs: resourceFlow[0], outputs: resourceFlow[1] }))}"`
      : '';
    const disabledAttributes = disabledReason
      ? ` disabled aria-disabled="true" title="${disabledReason}" data-build-disabled-reason="${disabledReason}"`
      : '';
    const ariaDisabledReason = disabledReason ? ` ${disabledReason}` : '';
    return `<button type="button" class="construction-card" data-action="${entry.action}" data-tooltip-placement="above" data-tooltip-title="${title}" data-tooltip="${tooltipDescription}" data-tooltip-cost="${tooltipCost}" data-tooltip-cost-affordable="true" data-tooltip-cost-shortages=""${flowAttribute}${disabledAttributes} aria-label="${title}. ${description} Cost: ${costText}.${ariaDisabledReason}">
      <img class="construction-card__art" data-src="${buildCardArtUrl(entry.artKey)}" alt="" width="320" height="480" loading="lazy" decoding="async" draggable="false" />
      <span class="construction-card__art-fallback" aria-hidden="true" hidden></span>
      <span class="construction-card__caption" aria-hidden="true"><strong>${title}</strong><span class="construction-card__cost">${costMarkup}</span></span>
      <span class="construction-card__tooltip" role="tooltip"><span class="construction-card__tooltip-title">${title}</span><span class="construction-card__tooltip-desc">${description}</span><span class="construction-card__tooltip-cost">Cost: ${costMarkup}</span></span>
    </button>`;
  }).join('');
}

export function syncBuildMenuCardAffordability(
  menu: ParentNode,
  available: ResourceCostAmounts | null,
): void {
  for (const button of menu.querySelectorAll<HTMLButtonElement>('.construction-card[data-action]')) {
    const entry = BUILD_MENU_ENTRIES.find((candidate) => candidate.action === button.dataset.action);
    const baseAriaLabel = BUILD_MENU_CARD_ARIA_LABELS.get(button)
      ?? button.getAttribute('aria-label')
      ?? '';
    BUILD_MENU_CARD_ARIA_LABELS.set(button, baseAriaLabel);
    if (!entry || !available) {
      button.classList.remove('is-unaffordable');
      delete button.dataset.tooltipCostAffordable;
      delete button.dataset.tooltipCostShortages;
      syncBuildMenuCostShortages(button, []);
      button.setAttribute('aria-label', baseAriaLabel);
      continue;
    }
    const required = buildingResourceCostAmounts(buildMenuEntryCost(entry));
    const shortageKinds = resourceCostShortfallKinds(available, required);
    const affordable = shortageKinds.length === 0;
    button.classList.toggle('is-unaffordable', !affordable);
    button.dataset.tooltipCostAffordable = String(affordable);
    button.dataset.tooltipCostShortages = shortageKinds.join(',');
    syncBuildMenuCostShortages(button, shortageKinds);
    button.setAttribute(
      'aria-label',
      affordable ? baseAriaLabel : `${baseAriaLabel}. Not enough resources.`,
    );
  }
}

function syncBuildMenuCostShortages(
  button: HTMLButtonElement,
  shortageKinds: readonly ResourceCostKind[],
): void {
  const shortageSet = new Set<string>(shortageKinds);
  for (const item of button.querySelectorAll<HTMLElement>('.resource-cost__item[data-resource-cost]')) {
    item.classList.toggle('is-unaffordable', shortageSet.has(item.dataset.resourceCost ?? ''));
  }
}

function buildMenuEntryCost(entry: BuildMenuEntry) {
  return entry.artKey === 'residences'
    ? residenceZoneCost(1)
    : entry.artKey === 'dry_stone_wall'
      ? { timber: 0, stone: 0, ironwork: 0 }
      : getBuildingCost(entry.artKey as BuildingKind);
}

export function hydrateBuildMenuImages(menu: ParentNode): void {
  for (const image of menu.querySelectorAll<HTMLImageElement>('img[data-src]')) {
    const source = image.dataset.src;
    if (!source) continue;
    const card = image.closest<HTMLButtonElement>('.construction-card');
    const fallback = card?.querySelector<HTMLElement>('.construction-card__art-fallback');
    const markArtAvailable = () => {
      if (image.dataset.artSource !== source) return;
      image.hidden = false;
      image.dataset.artState = 'ready';
      card?.classList.remove('is-art-unavailable');
      if (fallback) fallback.hidden = true;
    };
    const markArtUnavailable = () => {
      if (image.dataset.artSource !== source) return;
      image.hidden = true;
      image.removeAttribute('src');
      image.dataset.artState = 'fallback';
      card?.classList.add('is-art-unavailable');
      if (fallback) fallback.hidden = false;
    };
    image.addEventListener('load', markArtAvailable, { once: true });
    image.addEventListener('error', markArtUnavailable, { once: true });
    image.dataset.artSource = source;
    image.dataset.artState = 'loading';
    image.src = source;
    delete image.dataset.src;
    if (typeof image.decode === 'function') {
      void image.decode().then(markArtAvailable).catch(markArtUnavailable);
    }
  }
}

export function runBuildMenuAction(action: BuildMenuAction, handlers: BuildMenuHandlers, closeMenu: () => void): void {
  closeMenu();
  if (action === 'residences') handlers.onSelectResidences();
  else if (action === 'dry-stone-wall') handlers.onSelectDryStoneWall();
  else handlers.onSelectBuilding(MENU_ACTION_TO_BUILDING_KIND[action]);
}
