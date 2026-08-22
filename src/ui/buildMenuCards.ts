import type { BuildingKind } from '../generated/gameBalance.ts';
import { formatBuildingCost, getBuildingCost, residenceZoneCost } from '../resources/buildingEconomy.ts';
import { MENU_ACTION_TO_BUILDING_KIND } from './buildMenuMapping.ts';
import { renderBuildingResourceCost, type ResourceCostKind } from './resourceCost.ts';

export type PlacementBuildMenuAction =
  | 'lumber-mill' | 'stone-quarry' | 'large-quarry' | 'mine' | 'reforester' | 'woodcutters-lodge'
  | 'well' | 'hunters-hall' | 'foragers-shed' | 'fishing-camp' | 'chapel' | 'wayside-shrine' | 'marketplace' | 'trading-post'
  | 'threshing-barn' | 'monastery' | 'brewery' | 'tavern' | 'smokehouse'
  | 'granary' | 'bakery' | 'apiary' | 'watermill' | 'windmill' | 'carpenter'
  | 'weaver'
  | 'tannery' | 'cobbler'
  | 'pastoral-farmstead' | 'swineherd'
  | 'town-hall' | 'village-storehouse'
  | 'watchtower'
  | 'guardhouse'
  | 'palisaded-refuge'
  | 'clay-pit' | 'charcoal-burner' | 'smithy' | 'potter-kiln'
  | 'residences'
  | 'dry-stone-wall';

export type BuildMenuAction = PlacementBuildMenuAction;
type PlayerPlaceableBuildingKind = Exclude<BuildingKind, 'founders_camp' | 'salvage_pile' | 'remote_work_camp'>;
type DecorationArtKey = 'dry_stone_wall';
type PlacementArtKey = PlayerPlaceableBuildingKind | 'residences' | DecorationArtKey;
export type BuildMenuEntry = { kind: 'placement'; action: PlacementBuildMenuAction; artKey: PlacementArtKey };

const BUILD_CARD_ART: Record<PlacementArtKey, string> = {
  lumber_mill: '/assets/ui/build-menu/cards/lumber-mill.webp', reforester: '/assets/ui/build-menu/cards/reforester.webp',
  woodcutters_lodge: '/assets/ui/build-menu/cards/woodcutters-lodge.webp', stone_quarry: '/assets/ui/build-menu/cards/stonecutters-camp.webp',
  large_quarry: '/assets/ui/build-menu/cards/large-quarry.webp',
  mine: '/assets/ui/build-menu/cards/iron-mine.webp',
  clay_pit: '/assets/ui/build-menu/cards/clay-pit.webp',
  charcoal_burner: '/assets/ui/build-menu/cards/charcoal-burner.webp',
  smithy: '/assets/ui/build-menu/cards/smithy-bloomery.webp',
  potter_kiln: '/assets/ui/build-menu/cards/potter-kiln.webp',
  well: '/assets/ui/build-menu/cards/water-well.webp', hunters_hall: '/assets/ui/build-menu/cards/hunter-hall.webp',
  foragers_shed: '/assets/ui/build-menu/cards/foragers-hut.webp', chapel: '/assets/ui/build-menu/cards/chapel.webp',
  wayside_shrine: '/assets/ui/build-menu/cards/wayside-shrine.webp',
  dry_stone_wall: '/assets/ui/build-menu/cards/dry-stone-wall.webp',
  fishing_camp: '/assets/ui/build-menu/cards/fishing-camp.webp',
  marketplace: '/assets/ui/build-menu/cards/market.webp', residences: '/assets/ui/build-menu/cards/residence.webp',
  trading_post: '/assets/ui/build-menu/cards/trading-post.webp',
  town_hall: '/assets/ui/build-menu/cards/town-hall.webp', village_storehouse: '/assets/ui/build-menu/cards/village-storehouse.webp',
  watchtower: '/assets/ui/build-menu/cards/watchtower.webp',
  guardhouse: '/assets/ui/build-menu/cards/guardhouse.webp',
  palisaded_refuge: '/assets/ui/build-menu/cards/palisaded-refuge.webp',
  threshing_barn: '/assets/ui/build-menu/cards/threshing-barn.webp',
  monastery: '/assets/ui/build-menu/cards/monastery.webp', brewery: '/assets/ui/build-menu/cards/brewery.webp',
  tavern: '/assets/ui/build-menu/cards/tavern.webp',
  smokehouse: '/assets/ui/build-menu/cards/smokehouse.webp', granary: '/assets/ui/build-menu/cards/granary.webp',
  bakery: '/assets/ui/build-menu/cards/bakery.webp',
  apiary: '/assets/ui/build-menu/cards/apiary.webp', watermill: '/assets/ui/build-menu/cards/watermill.webp',
  windmill: '/assets/ui/build-menu/cards/windmill.webp',
  carpenter: '/assets/ui/build-menu/cards/carpenter.webp',
  weaver: '/assets/ui/build-menu/cards/weaver.webp',
  tannery: '/assets/ui/build-menu/cards/tannery.webp',
  cobbler: '/assets/ui/build-menu/cards/cobbler.webp',
  pastoral_farmstead: '/assets/ui/build-menu/cards/pastoral-farmstead.webp',
  swineherd: '/assets/ui/build-menu/cards/swineherd.webp',
};

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
  residences: ['Residence', 'Raises road-fronted homes that grow as their families prosper.'],
  well: ['Well', 'Draws water for nearby homes along the roads.', flow([], ['water'])],
  chapel: ['Church', 'Tends parish life, gathers tithes, and strengthens nearby households.'],
  wayside_shrine: ['Wayside shrine', 'Marks the roadside with a small place of prayer and devotion.'],
  dry_stone_wall: ['Dry-stone wall', 'Lines dirt roads with a free, instantly raised wall of fitted stone.'],
  monastery: ['Pauline monastery', 'A monastic estate that hosts pilgrims, keeps feasts, aids villagers, safeguards seed, and expands its charitable works.'],
  marketplace: ['Marketplace', 'Required to distribute food to residences; its stalls also trade goods and collect local taxes.'],
  trading_post: ['Trading Post', 'Orders imports and exports while haulers gather wares for trade.'],
  town_hall: ['Town Hall', "Governs local taxes and keeps the settlement's accounts."],
  village_storehouse: ['Storehouse', 'Stores construction materials, fuel, minerals, clay, salt, and all other non-food goods.'],
  watchtower: ['Frontier watchtower', 'Spots approaching raiders and warns nearby homes and stores.'],
  guardhouse: ['Frontier guardhouse', 'Musters armed guards to defend the settlement once a watchtower stands.'],
  palisaded_refuge: ['Palisaded refuge', 'Shelters warned families and their coin once a guardhouse stands.'],
  lumber_mill: ['Lumber mill', 'Fells mature trees and saws them into building timber.', flow([], ['timber'])],
  stone_quarry: ['Mining Pit', 'Gathers stone, iron, salt, or clay from shallow surface deposits.', flow([], ['stone', 'iron', 'salt', 'clay'])],
  large_quarry: ['Quarry', 'Works rich deposits with timber supports for a lasting supply of stone or minerals.', flow(['timber'], ['stone', 'iron', 'salt', 'clay'])],
  mine: ['Mine', 'Delves mineral seams for iron or salt.', flow([], ['iron', 'salt'])],
  clay_pit: ['Clay pit', 'Digs workable clay for pottery and roof tiles.', flow([], ['clay'])],
  charcoal_burner: ["Charcoal burner's yard", 'Slow-burns firewood into charcoal for the smithy.', flow(['firewood'], ['charcoal'])],
  smithy: ['Forest bloomery & smithy', 'Forges ironwork, tools, fittings, and weapons from iron and charcoal.', flow(['iron', 'charcoal', 'water'], ['ironwork'])],
  potter_kiln: ["Potter's kiln", 'Fires clay into household pottery or sturdy roof tiles.', flow(['clay', 'water', 'firewood'], ['pottery', 'roofTiles'])],
  reforester: ['Reforester', 'Restores felled woodland with young native trees.'],
  woodcutters_lodge: ["Woodcutter's lodge", 'Splits timber into firewood for settlement hearths.', flow(['timber'], ['firewood'])],
  hunters_hall: ["Hunter's hall", 'Hunts nearby game and dresses the catch for meat and hides.', flow([], ['meat', 'hides'])],
  foragers_shed: ["Forager's shed", 'Gathers woodland berries, mushrooms, and healing remedies.', flow([], ['berries', 'mushrooms', 'remedies'])],
  fishing_camp: ['Fishing camp', 'Catches fish from nearby waters through the warmer seasons.', flow([], ['fish'])],
  threshing_barn: ['Farmstead', 'Harvests and threshes rye, oats, barley, maslin, and flax.', flow(['ryeSheaves', 'oatSheaves', 'barleySheaves', 'maslinSheaves'], ['ryeGrain', 'oatGrain', 'barley', 'maslinGrain', 'flax'])],
  watermill: ['Grain watermill', 'Uses seasonal river power to grind rye and maslin into flour.', flow(['ryeGrain', 'maslinGrain'], ['ryeFlour', 'maslinFlour'])],
  windmill: ['Grain windmill', 'Uses strong winds to grind rye and maslin into flour.', flow(['ryeGrain', 'maslinGrain'], ['ryeFlour', 'maslinFlour'])],
  granary: ['Granary', 'Stores grain, fresh food, and preserved provisions for the settlement.'],
  bakery: ['Bakery', 'Bakes rye or maslin flour into bread for the settlement.', flow(['ryeFlour', 'maslinFlour', 'water', 'firewood'], ['ryeBread', 'maslinBread'])],
  brewery: ['Brewhouse', 'Brews ale, presses distinct apple or pear cider, or ferments mead.', flow(['barley', 'apples', 'pears', 'honey', 'water', 'firewood'], ['ale', 'cider', 'pearCider', 'mead'])],
  tavern: ['Tavern', 'Serves ale, apple cider, pear cider, and mead to satisfy household thirst.', flow(['ale', 'cider', 'pearCider', 'mead'], [])],
  smokehouse: ['Smokehouse', 'Preserves fresh food with firewood, salt, and pottery.', flow(['food', 'firewood', 'salt', 'pottery'], ['preservedFood'])],
  apiary: ['Forest apiary', 'Keeps bees for food, luxury honey, and mead throughout the warm season.', flow([], ['honey'])],
  carpenter: ['Carpenter & wheelwright', 'Crafts frames and carts that lower building costs and hasten deliveries.'],
  weaver: ["Weaver's workshop", 'Weaves wool into cloth and prepares flax with water for linen.', flow(['wool', 'flax', 'water'], ['cloth'])],
  tannery: ['Tannery', 'Tans goat and game hides with water and bark-fired heat into workable leather.', flow(['hides', 'water', 'firewood'], ['leather'])],
  cobbler: ["Cobbler's workshop", 'Cuts leather into finished shoes for prosperous Tier 3 households.', flow(['leather'], ['shoes'])],
  pastoral_farmstead: ['Pastoral farmstead', 'Raises cattle or sheep for milk, wool, manure, and meat.', flow([], ['milk', 'wool', 'manure', 'meat'])],
  swineherd: ['Woodland swineherd', 'Fattens pigs on woodland mast or oats for meat.', flow(['oatGrain'], ['meat'])],
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
  entry('residences'), entry('well'), entry('chapel'), entry('wayside_shrine'), entry('dry_stone_wall'), entry('monastery'), entry('marketplace'), entry('tavern'), entry('trading_post'), entry('town_hall'), entry('village_storehouse'), entry('granary'),
];

/** Sites whose crews gather raw resources from the landscape. */
export const GATHERING_BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  entry('lumber_mill'), entry('reforester'), entry('stone_quarry'), entry('large_quarry'),
  entry('hunters_hall'), entry('foragers_shed'), entry('fishing_camp'),
];

/** Farming, husbandry, and other primary agricultural production. */
export const AGRICULTURE_BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  entry('threshing_barn'), entry('apiary'),
  entry('pastoral_farmstead'), entry('swineherd'),
];

/** Workshops that process gathered or agricultural inputs into finished goods. */
export const INDUSTRY_BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  entry('woodcutters_lodge'), entry('watermill'), entry('windmill'), entry('bakery'), entry('brewery'), entry('smokehouse'),
  entry('carpenter'), entry('weaver'), entry('tannery'), entry('cobbler'), entry('charcoal_burner'), entry('smithy'), entry('potter_kiln'),
];

/** Conflict-enabled early warning and settlement defenses. */
export const MILITARY_BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  entry('watchtower'), entry('guardhouse'), entry('palisaded_refuge'),
];

export type BuildMenuCategoryId =
  | 'civic'
  | 'housing'
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

const HOUSING_BUILD_MENU_ENTRIES = [entry('residences')] as const;
const CIVIC_SERVICES_BUILD_MENU_ENTRIES = [entry('well'), entry('town_hall')] as const;
const TRADE_BUILD_MENU_ENTRIES = [
  entry('marketplace'), entry('trading_post'), entry('village_storehouse'), entry('granary'),
] as const;
const FOOD_BUILD_MENU_ENTRIES = [
  entry('watermill'), entry('windmill'), entry('bakery'), entry('brewery'), entry('tavern'), entry('smokehouse'),
] as const;
const WORKSHOP_BUILD_MENU_ENTRIES = [
  entry('woodcutters_lodge'), entry('carpenter'), entry('weaver'), entry('tannery'), entry('cobbler'), entry('charcoal_burner'), entry('smithy'), entry('potter_kiln'),
] as const;
const FAITH_BUILD_MENU_ENTRIES = [entry('chapel'), entry('monastery')] as const;
const DECORATION_BUILD_MENU_ENTRIES = [entry('wayside_shrine'), entry('dry_stone_wall')] as const;

/** The single build palette's icon-driven, deliberately granular category model. */
export const BUILD_MENU_CATEGORIES: readonly BuildMenuCategory[] = [
  { id: 'civic', label: 'Civic', hint: 'Water and settlement government', icon: 'civic', entries: CIVIC_SERVICES_BUILD_MENU_ENTRIES },
  { id: 'housing', label: 'Housing', hint: 'Road-fronted residence plots', icon: 'housing', entries: HOUSING_BUILD_MENU_ENTRIES },
  { id: 'trade', label: 'Trade & storage', hint: 'Markets, exchange, and shared stores', icon: 'trade', entries: TRADE_BUILD_MENU_ENTRIES },
  { id: 'gathering', label: 'Gathering', hint: 'Wood, stone, game, forage, and fish', icon: 'gathering', entries: GATHERING_BUILD_MENU_ENTRIES },
  { id: 'agriculture', label: 'Agriculture', hint: 'Fields, orchards, and livestock', icon: 'agriculture', entries: AGRICULTURE_BUILD_MENU_ENTRIES },
  { id: 'food', label: 'Food & drink', hint: 'Milling, baking, brewing, and preservation', icon: 'food', entries: FOOD_BUILD_MENU_ENTRIES },
  { id: 'industry', label: 'Industry', hint: 'Fuel, crafts, textiles, leather, metal, and pottery', icon: 'industry', entries: WORKSHOP_BUILD_MENU_ENTRIES },
  { id: 'faith', label: 'Faith', hint: 'Parish and monastic institutions', icon: 'faith', entries: FAITH_BUILD_MENU_ENTRIES },
  { id: 'decorations', label: 'Decorations', hint: 'Roadside details and stone walls', icon: 'decorations', entries: DECORATION_BUILD_MENU_ENTRIES },
  { id: 'military', label: 'Military', hint: 'Warning, defense, and refuge', icon: 'military', entries: MILITARY_BUILD_MENU_ENTRIES, conflictOnly: true },
];

export const BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  ...BUILD_MENU_CATEGORIES.flatMap((category) => category.entries),
];

export type BuildMenuHandlers = {
  onSelectBuilding: (kind: BuildingKind) => void;
  onSelectResidences: () => void;
  onSelectDryStoneWall: () => void;
};

export function renderBuildMenuCards(entries: readonly BuildMenuEntry[] = BUILD_MENU_ENTRIES): string {
  return entries.map((entry) => {
    const [title, description, resourceFlow] = DETAILS[entry.artKey];
    const resourceCost = entry.artKey === 'residences'
      ? residenceZoneCost(1)
      : entry.artKey === 'dry_stone_wall'
        ? { timber: 0, stone: 0, ironwork: 0 }
        : getBuildingCost(entry.artKey as BuildingKind);
    const costSuffix = entry.artKey === 'residences' ? 'per home' : '';
    const costText = `${formatBuildingCost(resourceCost)}${costSuffix ? ` ${costSuffix}` : ''}`;
    const costMarkup = renderBuildingResourceCost(resourceCost, {
      compact: true,
      suffix: costSuffix,
    });
    const flowAttribute = resourceFlow
      ? ` data-tooltip-flow="${encodeURIComponent(JSON.stringify({ inputs: resourceFlow[0], outputs: resourceFlow[1] }))}"`
      : '';
    return `<button type="button" class="construction-card" data-action="${entry.action}" data-tooltip-placement="above" data-tooltip-title="${title}" data-tooltip="${description}"${flowAttribute} aria-label="${title}. ${description} Cost: ${costText}">
      <img class="construction-card__art" data-src="${BUILD_CARD_ART[entry.artKey]}" alt="" width="320" height="480" loading="lazy" decoding="async" draggable="false" />
      <span class="construction-card__caption" aria-hidden="true"><strong>${title}</strong><span class="construction-card__cost">${costMarkup}</span></span>
      <span class="construction-card__tooltip" role="tooltip"><span class="construction-card__tooltip-title">${title}</span><span class="construction-card__tooltip-desc">${description}</span><span class="construction-card__tooltip-cost">Cost: ${costMarkup}</span></span>
    </button>`;
  }).join('');
}

export function hydrateBuildMenuImages(menu: ParentNode): void {
  for (const image of menu.querySelectorAll<HTMLImageElement>('img[data-src]')) {
    const source = image.dataset.src;
    if (!source) continue;
    image.src = source;
    delete image.dataset.src;
  }
}

export function runBuildMenuAction(action: BuildMenuAction, handlers: BuildMenuHandlers, closeMenu: () => void): void {
  closeMenu();
  if (action === 'residences') handlers.onSelectResidences();
  else if (action === 'dry-stone-wall') handlers.onSelectDryStoneWall();
  else handlers.onSelectBuilding(MENU_ACTION_TO_BUILDING_KIND[action]);
}
