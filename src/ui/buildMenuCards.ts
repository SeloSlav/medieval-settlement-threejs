import type { BuildingKind } from '../generated/gameBalance.ts';
import { formatBuildingCost, getBuildingCost, residenceZoneCost } from '../resources/buildingEconomy.ts';
import { MENU_ACTION_TO_BUILDING_KIND } from './buildMenuMapping.ts';

export type PlacementBuildMenuAction =
  | 'lumber-mill' | 'stone-quarry' | 'large-quarry' | 'reforester' | 'woodcutters-lodge'
  | 'well' | 'hunters-hall' | 'foragers-shed' | 'fishing-camp' | 'chapel' | 'marketplace'
  | 'threshing-barn' | 'monastery' | 'brewery' | 'smokehouse'
  | 'granary' | 'apiary' | 'watermill' | 'carpenter' | 'ferry-landing' | 'vineyard'
  | 'weaver'
  | 'pastoral-farmstead' | 'swineherd'
  | 'town-hall' | 'village-storehouse'
  | 'watchtower'
  | 'guardhouse'
  | 'residences';

export type BuildMenuAction = PlacementBuildMenuAction;
type PlacementArtKey = BuildingKind | 'residences';
export type BuildMenuEntry = { kind: 'placement'; action: PlacementBuildMenuAction; artKey: PlacementArtKey };

const BUILD_CARD_ART: Record<PlacementArtKey, string> = {
  lumber_mill: '/assets/ui/build-menu/cards/lumber-mill.webp', reforester: '/assets/ui/build-menu/cards/reforester.webp',
  woodcutters_lodge: '/assets/ui/build-menu/cards/woodcutters-lodge.webp', stone_quarry: '/assets/ui/build-menu/cards/stonecutters-camp.webp',
  large_quarry: '/assets/ui/build-menu/cards/large-quarry.webp',
  well: '/assets/ui/build-menu/cards/water-well.webp', hunters_hall: '/assets/ui/build-menu/cards/hunter-hall.webp',
  foragers_shed: '/assets/ui/build-menu/cards/foragers-hut.webp', chapel: '/assets/ui/build-menu/cards/chapel.webp',
  fishing_camp: '/assets/ui/build-menu/cards/fishing-camp.webp',
  marketplace: '/assets/ui/build-menu/cards/market.webp', residences: '/assets/ui/build-menu/cards/residence.webp',
  town_hall: '/assets/ui/build-menu/cards/town-hall.webp', village_storehouse: '/assets/ui/build-menu/cards/village-storehouse.webp',
  watchtower: '/assets/ui/build-menu/cards/watchtower.webp',
  guardhouse: '/assets/ui/build-menu/cards/guardhouse.webp',
  threshing_barn: '/assets/ui/build-menu/cards/threshing-barn.webp',
  monastery: '/assets/ui/build-menu/cards/monastery.webp', brewery: '/assets/ui/build-menu/cards/brewery.webp',
  smokehouse: '/assets/ui/build-menu/cards/smokehouse.webp', granary: '/assets/ui/build-menu/cards/granary.webp',
  apiary: '/assets/ui/build-menu/cards/apiary.webp', watermill: '/assets/ui/build-menu/cards/watermill.webp',
  carpenter: '/assets/ui/build-menu/cards/carpenter.webp', ferry_landing: '/assets/ui/build-menu/cards/ferry-landing.webp',
  weaver: '/assets/ui/build-menu/cards/weaver.webp',
  vineyard: '/assets/ui/build-menu/cards/vineyard.webp',
  pastoral_farmstead: '/assets/ui/build-menu/cards/pastoral-farmstead.webp',
  swineherd: '/assets/ui/build-menu/cards/swineherd.webp',
};

const DETAILS: Record<PlacementArtKey, [title: string, hotkey: string, description: string]> = {
  residences: ['Residence', 'H', 'Lay out homesteads along a road; homes can grow through three distinct tiers.'],
  well: ['Well', 'E', 'Draws groundwater and dispatches it to road-linked homes.'],
  chapel: ['Chapel', 'C', 'A staffed parish chapel collects tithes and supports nearby households.'],
  monastery: ['Pauline monastery', 'O', 'A hillside parish institution turning grain, optional honey-and-wine hospitality, and tithes into charity and pilgrim income.'],
  marketplace: ['Marketplace', 'P', 'Trade hub for household produce, emergency seed grain, and specialty exports.'],
  town_hall: ['Town Hall', 'T', 'Physical seat of settlement government, taxation, and the economic ledger. Requires a chapel, marketplace, and 24 people.'],
  village_storehouse: ['Village storehouse', 'S', 'Hauls surplus timber, stone, and firewood from producers into shared construction stock. Never stores food.'],
  watchtower: ['Frontier watchtower', 'W', 'Staffed hill tower warns nearby homes and stores, reducing losses when raiders cross the frontier.'],
  guardhouse: ['Frontier guardhouse', 'G', 'Paid guards consume labor, provisions, wages, and carpenter-made polearms. Polearms need market-imported ironwork. Requires a completed watchtower.'],
  ferry_landing: ['Ferry landing', 'J', 'A staffed river crossing and modest source of trade income. Must touch open water.'],
  lumber_mill: ['Lumber mill', 'L', 'Fells mature trees and stockpiles construction timber.'],
  stone_quarry: ["Stonecutter's camp", 'S', 'Cuts stone from rock outcrops inside its working range.'],
  large_quarry: ['Large Quarry', 'G', 'Builds directly over a rich deposit and raises underground stone indefinitely.'],
  reforester: ['Reforester', 'F', 'Restores harvested woodland with native saplings.'],
  woodcutters_lodge: ["Woodcutter's lodge", 'W', 'Splits timber into firewood and supplies connected homes.'],
  hunters_hall: ["Hunter's hall", 'K', 'Hunts game and delivers fresh food along the road network.'],
  foragers_shed: ["Forager's shed", 'Y', 'Gathers seasonal berries or deep-forest mushrooms and provisions homes.'],
  fishing_camp: ['Fishing camp', 'Z', 'Catches from a finite river population that reproduces in spring; overfishing can cause extinction.'],
  threshing_barn: ['Farmstead', 'T', 'Road-linked labor hub that ploughs, sows, tends, harvests, and stores grain from surrounding fields.'],
  watermill: ['Grain watermill', 'M', 'Uses a river wheel to grind grain into flour. Must touch open water.'],
  granary: ['Village granary', 'N', 'Stores grain and flour, bakes staple food, and collects wild-food surplus.'],
  brewery: ['Brewhouse', 'B', 'Brews grain and water into ale for prosperous households and export.'],
  smokehouse: ['Smokehouse', 'Q', 'Preserves fresh food with firewood for tier-three households.'],
  apiary: ['Forest apiary', 'A', 'Produces seasonal honey and food. Hospitality-enabled monasteries take honey before market export.'],
  carpenter: ['Carpenter & wheelwright', 'R', 'Staff its road-linked workshop to cut site timber needs by 10% and move connected carts 18% faster.'],
  weaver: ["Weaver's workshop", 'I', 'Turns the annual wool clip into household textiles, then exports the surplus.'],
  vineyard: ['Vineyard terrace', 'V', 'An autumn hillside harvest yields food and wine for monastery hospitality or high-value export.'],
  pastoral_farmstead: ['Pastoral farmstead', 'D', 'Keeps cattle for dairy, manure, and ox power, or sheep for upland cheese and an annual wool clip for local weaving. Draw fenced pastures within its work extent.'],
  swineherd: ['Woodland swineherd', 'X', 'Raises pigs on mature woodland mast. Felling its pannage trees forces inefficient grain feeding and reduces output.'],
};

const action = (kind: BuildingKind): PlacementBuildMenuAction => kind.replaceAll('_', '-') as PlacementBuildMenuAction;
const entry = (artKey: PlacementArtKey): BuildMenuEntry => ({
  kind: 'placement',
  action: artKey === 'residences'
    ? 'residences'
    : action(artKey),
  artKey,
});

/** Housing, water, faith, trade, and transport. */
export const BASIC_BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  entry('residences'), entry('well'), entry('chapel'), entry('monastery'), entry('marketplace'), entry('town_hall'), entry('village_storehouse'), entry('ferry_landing'),
];

/** Farms, grain processing, and village food production. */
export const AGRICULTURE_BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  entry('threshing_barn'), entry('watermill'), entry('granary'), entry('brewery'), entry('smokehouse'),
  entry('apiary'), entry('vineyard'),
  entry('pastoral_farmstead'), entry('swineherd'),
];

/** Forestry, hunting, foraging, extraction, and rural craft. */
export const RURAL_INDUSTRY_BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  entry('hunters_hall'), entry('foragers_shed'), entry('fishing_camp'), entry('woodcutters_lodge'), entry('lumber_mill'), entry('reforester'),
  entry('stone_quarry'), entry('large_quarry'), entry('carpenter'), entry('weaver'),
];

/** Conflict-enabled early warning and settlement defenses. */
export const MILITARY_BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  entry('watchtower'), entry('guardhouse'),
];

export const BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  ...BASIC_BUILD_MENU_ENTRIES,
  ...AGRICULTURE_BUILD_MENU_ENTRIES,
  ...RURAL_INDUSTRY_BUILD_MENU_ENTRIES,
  ...MILITARY_BUILD_MENU_ENTRIES,
];

export type BuildMenuHandlers = {
  onSelectBuilding: (kind: BuildingKind) => void;
  onSelectResidences: () => void;
};

export function renderBuildMenuCards(entries: readonly BuildMenuEntry[] = BUILD_MENU_ENTRIES): string {
  return entries.map((entry) => {
    const [title, hotkey, description] = DETAILS[entry.artKey];
    const cost = entry.artKey === 'residences'
      ? `${formatBuildingCost(residenceZoneCost(1))} per home`
      : formatBuildingCost(getBuildingCost(entry.artKey as BuildingKind));
    return `<button type="button" class="construction-card" data-action="${entry.action}" data-hotkey="${hotkey}" aria-label="${title} (${hotkey})">
      <img class="construction-card__art" data-src="${BUILD_CARD_ART[entry.artKey]}" alt="" width="320" height="480" loading="lazy" decoding="async" draggable="false" />
      <span class="construction-card__hotkey" aria-hidden="true">${hotkey}</span>
      <span class="construction-card__tooltip" role="tooltip"><span class="construction-card__tooltip-title">${title} (${hotkey})</span><span class="construction-card__tooltip-desc">${description}</span><span class="construction-card__tooltip-cost">Cost: ${cost}</span></span>
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
