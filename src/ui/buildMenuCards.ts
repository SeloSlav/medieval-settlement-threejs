import type { BuildingKind } from '../generated/gameBalance.ts';
import { formatBuildingCost, getBuildingCost, residenceZoneCost } from '../resources/buildingEconomy.ts';
import { MENU_ACTION_TO_BUILDING_KIND } from './buildMenuMapping.ts';
import { renderBuildingResourceCost, type ResourceCostKind } from './resourceCost.ts';

export type PlacementBuildMenuAction =
  | 'lumber-mill' | 'stone-quarry' | 'large-quarry' | 'mine' | 'reforester' | 'woodcutters-lodge'
  | 'well' | 'hunters-hall' | 'foragers-shed' | 'fishing-camp' | 'chapel' | 'marketplace' | 'trading-post'
  | 'threshing-barn' | 'monastery' | 'brewery' | 'smokehouse'
  | 'granary' | 'bakery' | 'apiary' | 'watermill' | 'windmill' | 'carpenter' | 'vineyard'
  | 'weaver'
  | 'pastoral-farmstead' | 'swineherd'
  | 'town-hall' | 'village-storehouse'
  | 'watchtower'
  | 'guardhouse'
  | 'palisaded-refuge'
  | 'clay-pit' | 'charcoal-burner' | 'smithy' | 'potter-kiln'
  | 'residences';

export type BuildMenuAction = PlacementBuildMenuAction;
type PlayerPlaceableBuildingKind = Exclude<BuildingKind, 'founders_camp' | 'salvage_pile' | 'remote_work_camp'>;
type PlacementArtKey = PlayerPlaceableBuildingKind | 'residences';
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
  fishing_camp: '/assets/ui/build-menu/cards/fishing-camp.webp',
  marketplace: '/assets/ui/build-menu/cards/market.webp', residences: '/assets/ui/build-menu/cards/residence.webp',
  trading_post: '/assets/ui/build-menu/cards/trading-post.webp',
  town_hall: '/assets/ui/build-menu/cards/town-hall.webp', village_storehouse: '/assets/ui/build-menu/cards/village-storehouse.webp',
  watchtower: '/assets/ui/build-menu/cards/watchtower.webp',
  guardhouse: '/assets/ui/build-menu/cards/guardhouse.webp',
  palisaded_refuge: '/assets/ui/build-menu/cards/palisaded-refuge.webp',
  threshing_barn: '/assets/ui/build-menu/cards/threshing-barn.webp',
  monastery: '/assets/ui/build-menu/cards/monastery.webp', brewery: '/assets/ui/build-menu/cards/brewery.webp',
  smokehouse: '/assets/ui/build-menu/cards/smokehouse.webp', granary: '/assets/ui/build-menu/cards/granary.webp',
  bakery: '/assets/ui/build-menu/cards/bakery.webp',
  apiary: '/assets/ui/build-menu/cards/apiary.webp', watermill: '/assets/ui/build-menu/cards/watermill.webp',
  windmill: '/assets/ui/build-menu/cards/windmill.webp',
  carpenter: '/assets/ui/build-menu/cards/carpenter.webp',
  weaver: '/assets/ui/build-menu/cards/weaver.webp',
  vineyard: '/assets/ui/build-menu/cards/vineyard.webp',
  pastoral_farmstead: '/assets/ui/build-menu/cards/pastoral-farmstead.webp',
  swineherd: '/assets/ui/build-menu/cards/swineherd.webp',
};

type BuildCardResourceFlow = readonly [
  inputs: readonly ResourceCostKind[],
  outputs: readonly ResourceCostKind[],
];

type BuildCardDetail = readonly [
  title: string,
  hotkey: string,
  description: string,
  resourceFlow?: BuildCardResourceFlow,
];

const flow = (
  inputs: readonly ResourceCostKind[],
  outputs: readonly ResourceCostKind[],
): BuildCardResourceFlow => [inputs, outputs];

const DETAILS: Record<PlacementArtKey, BuildCardDetail> = {
  residences: ['Residence', 'H', 'Builds road-fronted homes that can grow through three tiers.'],
  well: ['Well', 'E', 'Supplies road-linked homes with water.', flow([], ['water'])],
  chapel: ['Church', 'C', 'Collects tithes and supports nearby households.'],
  monastery: ['Pauline monastery', 'O', 'Turns oats, honey, and wine into charity and pilgrim income.', flow(['oatGrain', 'honey', 'wine'], ['gold'])],
  marketplace: ['Marketplace', 'P', 'Lets households exchange food and goods while collecting local taxes.'],
  trading_post: ['Trading Post', 'X', 'Sets monthly import and export rules while local haulers stage surplus goods.'],
  town_hall: ['Town Hall', 'T', 'Governs taxation and unlocks the settlement economic ledger.'],
  village_storehouse: ['Village storehouse', 'S', 'Collects and distributes shared timber, stone, and firewood.'],
  watchtower: ['Frontier watchtower', 'W', 'Warns nearby homes and stores before raids.'],
  guardhouse: ['Frontier guardhouse', 'G', 'Employs armed guards to defend the frontier; requires a completed watchtower.'],
  palisaded_refuge: ['Palisaded refuge', 'R', 'Shelters warned households and their gold during raids; requires a completed guardhouse.'],
  lumber_mill: ['Lumber mill', 'L', 'Fells mature trees to produce construction timber.', flow([], ['timber'])],
  stone_quarry: ['Mining Pit', 'M', 'Place near any stone, iron, salt, or clay deposit to gather its finite surface reserve.', flow([], ['stone', 'iron', 'salt', 'clay'])],
  large_quarry: ['Quarry', 'Q', 'Place centrally on a rich deposit to extract its non-depleting underground source using timber supports.', flow(['timber'], ['stone', 'iron', 'salt', 'clay'])],
  mine: ['Mineral mine', 'N', 'Extracts iron or salt from marked mineral deposits.', flow([], ['iron', 'salt'])],
  clay_pit: ['Clay pit', 'C', 'Extracts clay from marked deposits.', flow([], ['clay'])],
  charcoal_burner: ["Charcoal burner's yard", 'U', 'Turns firewood into charcoal for smithies.', flow(['firewood'], ['charcoal'])],
  smithy: ['Forest bloomery & smithy', 'Y', 'Turns iron, charcoal, and water into ironwork for tools, fittings, and weapons.', flow(['iron', 'charcoal', 'water'], ['ironwork'])],
  potter_kiln: ["Potter's kiln", 'P', 'Turns clay, water, and firewood into pottery or roof tiles.', flow(['clay', 'water', 'firewood'], ['pottery', 'roofTiles'])],
  reforester: ['Reforester', 'F', 'Replants harvested woodland with native trees.'],
  woodcutters_lodge: ["Woodcutter's lodge", 'W', 'Splits timber into firewood for nearby homes; replacement axes raise output but wear each cycle.', flow(['timber'], ['firewood'])],
  hunters_hall: ["Hunter's hall", 'K', 'Hunts nearby game to produce meat.', flow([], ['meat'])],
  foragers_shed: ["Forager's shed", 'Y', 'Gathers berries, mushrooms, and medicinal remedies.', flow([], ['berries', 'mushrooms', 'remedies'])],
  fishing_camp: ['Fishing camp', 'Z', 'Catches fish from nearby waters; stocks recover in spring.', flow([], ['fish'])],
  threshing_barn: ['Farmstead', 'T', 'Harvests and threshes distinct rye, oat, barley, maslin, and flax crops; ploughshares, hoes, sickles, and scythes speed completed field work.', flow([], ['ryeSheaves', 'oatSheaves', 'barleySheaves', 'maslinSheaves', 'flax'])],
  watermill: ['Grain watermill', 'M', 'Grinds rye, oats, or maslin into matching flour with seasonal river power. Smith-dressed millstones and maintained iron fittings raise output.', flow(['ryeGrain', 'oatGrain', 'maslinGrain'], ['ryeFlour', 'oatFlour', 'maslinFlour'])],
  windmill: ['Grain windmill', 'I', 'Grinds rye, oats, or maslin into matching flour wherever wind is strong. Smith-dressed millstones and maintained iron fittings raise output.', flow(['ryeGrain', 'oatGrain', 'maslinGrain'], ['ryeFlour', 'oatFlour', 'maslinFlour'])],
  granary: ['Village granary', 'N', 'Collects and distributes food; it does not process it.'],
  bakery: ['Village bakery', 'B', 'Bakes rye, oat, or maslin flour into matching bread.', flow(['ryeFlour', 'oatFlour', 'maslinFlour', 'water', 'firewood'], ['ryeBread', 'oatBread', 'maslinBread'])],
  brewery: ['Brewhouse', 'A', 'Turns barley, water, and firewood into ale.', flow(['barley', 'water', 'firewood'], ['ale'])],
  smokehouse: ['Smokehouse', 'Q', 'Uses firewood, salt, and pottery to preserve fresh food.', flow(['food', 'firewood', 'salt', 'pottery'], ['preservedFood'])],
  apiary: ['Forest apiary', 'A', 'Produces honey during the warm season.', flow([], ['honey'])],
  carpenter: ['Carpenter & wheelwright', 'R', 'Uses timber and ironwork to reduce building costs and speed delivery carts.'],
  weaver: ["Weaver's workshop", 'V', 'Turns wool or flax into cloth; flax also needs water.', flow(['wool', 'flax', 'water'], ['cloth'])],
  vineyard: ['Vineyard terrace', 'V', 'Produces grapes and wine on suitable hillsides.', flow([], ['grapes', 'wine'])],
  pastoral_farmstead: ['Pastoral farmstead', 'D', 'Raises cattle or sheep for milk, wool, manure, and meat.', flow([], ['milk', 'wool', 'manure', 'meat'])],
  swineherd: ['Woodland swineherd', 'X', 'Raises pigs on woodland mast or oat-grain fallback to produce meat.', flow(['oatGrain'], ['meat'])],
};

const action = (kind: PlayerPlaceableBuildingKind): PlacementBuildMenuAction =>
  kind.replaceAll('_', '-') as PlacementBuildMenuAction;
const entry = (artKey: PlacementArtKey): BuildMenuEntry => ({
  kind: 'placement',
  action: artKey === 'residences'
    ? 'residences'
    : action(artKey),
  artKey,
});

/** Housing, services, institutions, trade, transport, and shared storage. */
export const CIVIC_BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  entry('residences'), entry('well'), entry('chapel'), entry('monastery'), entry('marketplace'), entry('trading_post'), entry('town_hall'), entry('village_storehouse'), entry('granary'),
];

/** Sites whose crews gather raw resources from the landscape. */
export const GATHERING_BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  entry('lumber_mill'), entry('reforester'), entry('stone_quarry'), entry('large_quarry'),
  entry('hunters_hall'), entry('foragers_shed'), entry('fishing_camp'),
];

/** Farming, husbandry, and other primary agricultural production. */
export const AGRICULTURE_BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  entry('threshing_barn'), entry('apiary'), entry('vineyard'),
  entry('pastoral_farmstead'), entry('swineherd'),
];

/** Workshops that process gathered or agricultural inputs into finished goods. */
export const INDUSTRY_BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  entry('woodcutters_lodge'), entry('watermill'), entry('windmill'), entry('bakery'), entry('brewery'), entry('smokehouse'),
  entry('carpenter'), entry('weaver'), entry('charcoal_burner'), entry('smithy'), entry('potter_kiln'),
];

/** Conflict-enabled early warning and settlement defenses. */
export const MILITARY_BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  entry('watchtower'), entry('guardhouse'), entry('palisaded_refuge'),
];

export const BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  ...CIVIC_BUILD_MENU_ENTRIES,
  ...GATHERING_BUILD_MENU_ENTRIES,
  ...AGRICULTURE_BUILD_MENU_ENTRIES,
  ...INDUSTRY_BUILD_MENU_ENTRIES,
  ...MILITARY_BUILD_MENU_ENTRIES,
];

export type BuildMenuHandlers = {
  onSelectBuilding: (kind: BuildingKind) => void;
  onSelectResidences: () => void;
};

export function renderBuildMenuCards(entries: readonly BuildMenuEntry[] = BUILD_MENU_ENTRIES): string {
  return entries.map((entry) => {
    const [title, hotkey, description, resourceFlow] = DETAILS[entry.artKey];
    const resourceCost = entry.artKey === 'residences'
      ? residenceZoneCost(1)
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
    return `<button type="button" class="construction-card" data-action="${entry.action}" data-hotkey="${hotkey}" data-tooltip-title="${title} (${hotkey})" data-tooltip="${description}"${flowAttribute} aria-label="${title} (${hotkey}). ${description} Cost: ${costText}">
      <img class="construction-card__art" data-src="${BUILD_CARD_ART[entry.artKey]}" alt="" width="320" height="480" loading="lazy" decoding="async" draggable="false" />
      <span class="construction-card__hotkey" aria-hidden="true">${hotkey}</span>
      <span class="construction-card__caption" aria-hidden="true"><strong>${title}</strong><span class="construction-card__cost">${costMarkup}</span></span>
      <span class="construction-card__tooltip" role="tooltip"><span class="construction-card__tooltip-title">${title} (${hotkey})</span><span class="construction-card__tooltip-desc">${description}</span><span class="construction-card__tooltip-cost">Cost: ${costMarkup}</span></span>
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

export function resolveBuildMenuHotkey(key: string, entries: readonly BuildMenuEntry[] = BUILD_MENU_ENTRIES): BuildMenuAction | null {
  const normalized = key.toLowerCase();
  return entries.find((candidate) => DETAILS[candidate.artKey][1].toLowerCase() === normalized)?.action ?? null;
}

export function runBuildMenuAction(action: BuildMenuAction, handlers: BuildMenuHandlers, closeMenu: () => void): void {
  closeMenu();
  if (action === 'residences') handlers.onSelectResidences();
  else handlers.onSelectBuilding(MENU_ACTION_TO_BUILDING_KIND[action]);
}
