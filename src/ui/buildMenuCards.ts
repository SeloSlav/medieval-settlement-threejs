import type { BuildingKind } from '../generated/gameBalance.ts';
import { formatBuildingCost, getBuildingCost, residenceZoneCost } from '../resources/buildingEconomy.ts';
import { MENU_ACTION_TO_BUILDING_KIND } from './buildMenuMapping.ts';

export type PlacementBuildMenuAction =
  | 'lumber-mill' | 'stone-quarry' | 'reforester' | 'woodcutters-lodge'
  | 'well' | 'hunters-hall' | 'foragers-shed' | 'chapel' | 'marketplace'
  | 'grain-field' | 'threshing-barn' | 'monastery' | 'brewery' | 'smokehouse'
  | 'granary' | 'apiary' | 'watermill' | 'carpenter' | 'ferry-landing' | 'vineyard'
  | 'residences';

export type BuildMenuAction = PlacementBuildMenuAction;
type PlacementArtKey = BuildingKind | 'residences' | 'farm_field';
export type BuildMenuEntry = { kind: 'placement'; action: PlacementBuildMenuAction; artKey: PlacementArtKey };

const BUILD_CARD_ART: Record<PlacementArtKey, string> = {
  lumber_mill: '/assets/ui/build-menu/lumber-mill.png', reforester: '/assets/ui/build-menu/reforester.png',
  woodcutters_lodge: '/assets/ui/build-menu/woodcutters-lodge.png', stone_quarry: '/assets/ui/build-menu/stonecutters-camp.png',
  well: '/assets/ui/build-menu/water-well.png', hunters_hall: '/assets/ui/build-menu/hunter-hall.png',
  foragers_shed: '/assets/ui/build-menu/foragers-hut.png', chapel: '/assets/ui/build-menu/chapel.png',
  marketplace: '/assets/ui/build-menu/market.png', residences: '/assets/ui/build-menu/residence.png',
  farm_field: '/assets/ui/build-menu/grain-field.png', threshing_barn: '/assets/ui/build-menu/threshing-barn.png',
  monastery: '/assets/ui/build-menu/monastery.png', brewery: '/assets/ui/build-menu/brewery.png',
  smokehouse: '/assets/ui/build-menu/smokehouse.png', granary: '/assets/ui/build-menu/granary.png',
  apiary: '/assets/ui/build-menu/apiary.png', watermill: '/assets/ui/build-menu/watermill.png',
  carpenter: '/assets/ui/build-menu/carpenter.png', ferry_landing: '/assets/ui/build-menu/ferry-landing.png',
  vineyard: '/assets/ui/build-menu/vineyard.png',
};

const DETAILS: Record<PlacementArtKey, [title: string, hotkey: string, description: string]> = {
  residences: ['Residence', 'H', 'Lay out Croatian Gorski Kotar homesteads along a road; homes can grow through three distinct tiers.'],
  well: ['Well', 'E', 'Draws groundwater and dispatches it to road-linked homes.'],
  chapel: ['Chapel', 'C', 'A staffed parish chapel collects tithes and supports nearby households.'],
  monastery: ['Pauline monastery', 'O', 'An autonomous hillside monastery offering charity, pilgrimages, feasts, and wider faith coverage.'],
  marketplace: ['Marketplace', 'P', 'Trade hub for household produce and specialty exports.'],
  ferry_landing: ['Ferry landing', 'J', 'A staffed river crossing and modest source of trade income. Must touch open water.'],
  lumber_mill: ['Lumber mill', 'L', 'Fells mature trees and stockpiles construction timber.'],
  stone_quarry: ["Stonecutter's camp", 'S', 'Cuts stone from rock outcrops inside its working range.'],
  reforester: ['Reforester', 'F', 'Restores harvested woodland with native saplings.'],
  woodcutters_lodge: ["Woodcutter's lodge", 'W', 'Splits timber into firewood and supplies connected homes.'],
  hunters_hall: ["Hunter's hall", 'K', 'Hunts game and delivers fresh food along the road network.'],
  foragers_shed: ["Forager's shed", 'Y', 'Gathers berries and provisions homes from forest edges.'],
  farm_field: ['Draw farm field', 'G', "Draw rye, oat, or fallow land inside a farmstead's work extent. Area, terrain, water, crop rotation, and labor determine yield."],
  threshing_barn: ['Farmstead', 'T', 'Road-linked labor hub that ploughs, sows, tends, harvests, and stores grain from surrounding fields.'],
  watermill: ['Grain watermill', 'M', 'Uses a river wheel to grind grain into flour. Must touch open water.'],
  granary: ['Village granary', 'N', 'Stores grain and flour, bakes staple food, and buffers shortages.'],
  brewery: ['Brewhouse', 'B', 'Brews grain and water into ale for prosperous households and export.'],
  smokehouse: ['Smokehouse', 'Q', 'Preserves fresh food with firewood for tier-two households.'],
  apiary: ['Forest apiary', 'A', 'Produces honey and a little food at a quiet woodland edge.'],
  carpenter: ['Carpenter & wheelwright', 'R', 'A specialist workshop that strengthens local construction and cart logistics.'],
  vineyard: ['Vineyard terrace', 'V', 'Stone-banked vines yield food and high-value wine for trade.'],
};

const action = (kind: BuildingKind): PlacementBuildMenuAction => kind.replaceAll('_', '-') as PlacementBuildMenuAction;
const entry = (artKey: PlacementArtKey): BuildMenuEntry => ({
  kind: 'placement',
  action: artKey === 'residences' ? 'residences' : artKey === 'farm_field' ? 'grain-field' : action(artKey),
  artKey,
});

/** Housing, water, faith, trade, and transport. */
export const BASIC_BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  entry('residences'), entry('well'), entry('chapel'), entry('monastery'), entry('marketplace'), entry('ferry_landing'),
];

/** Farms, grain processing, and village food production. */
export const AGRICULTURE_BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  entry('farm_field'), entry('threshing_barn'), entry('watermill'), entry('granary'), entry('brewery'), entry('smokehouse'),
  entry('apiary'), entry('vineyard'),
];

/** Forestry, hunting, foraging, extraction, and rural craft. */
export const RURAL_INDUSTRY_BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  entry('hunters_hall'), entry('foragers_shed'), entry('woodcutters_lodge'), entry('lumber_mill'), entry('reforester'),
  entry('stone_quarry'), entry('carpenter'),
];

export const BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  ...BASIC_BUILD_MENU_ENTRIES,
  ...AGRICULTURE_BUILD_MENU_ENTRIES,
  ...RURAL_INDUSTRY_BUILD_MENU_ENTRIES,
];

export type BuildMenuHandlers = {
  onSelectBuilding: (kind: BuildingKind) => void;
  onSelectResidences: () => void;
  onSelectFarmFields: () => void;
};

export function renderBuildMenuCards(entries: readonly BuildMenuEntry[] = BUILD_MENU_ENTRIES): string {
  return entries.map((entry) => {
    const [title, hotkey, description] = DETAILS[entry.artKey];
    const cost = entry.artKey === 'residences'
      ? `${formatBuildingCost(residenceZoneCost(1))} per home`
      : entry.action === 'grain-field'
        ? 'Farmstead labor'
        : formatBuildingCost(getBuildingCost(entry.artKey as BuildingKind));
    return `<button type="button" class="construction-card" data-action="${entry.action}" data-hotkey="${hotkey}" aria-label="${title} (${hotkey})">
      <img class="construction-card__art" src="${BUILD_CARD_ART[entry.artKey]}" alt="" draggable="false" />
      <span class="construction-card__hotkey" aria-hidden="true">${hotkey}</span>
      <span class="construction-card__tooltip" role="tooltip"><span class="construction-card__tooltip-title">${title} (${hotkey})</span><span class="construction-card__tooltip-desc">${description}</span><span class="construction-card__tooltip-cost">Cost: ${cost}</span></span>
    </button>`;
  }).join('');
}

export function resolveBuildMenuHotkey(key: string, entries: readonly BuildMenuEntry[] = BUILD_MENU_ENTRIES): BuildMenuAction | null {
  const normalized = key.toLowerCase();
  return entries.find((candidate) => DETAILS[candidate.artKey][1].toLowerCase() === normalized)?.action ?? null;
}

export function runBuildMenuAction(action: BuildMenuAction, handlers: BuildMenuHandlers, closeMenu: () => void): void {
  closeMenu();
  if (action === 'residences') handlers.onSelectResidences();
  else if (action === 'grain-field') handlers.onSelectFarmFields();
  else handlers.onSelectBuilding(MENU_ACTION_TO_BUILDING_KIND[action]);
}
