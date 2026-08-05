import type { BuildingKind } from '../generated/gameBalance.ts';
import { formatBuildingCost, getBuildingCost, residenceZoneCost } from '../resources/buildingEconomy.ts';
import { MENU_ACTION_TO_BUILDING_KIND } from './buildMenuMapping.ts';

export type PlacementBuildMenuAction =
  | 'lumber-mill' | 'stone-quarry' | 'large-quarry' | 'mine' | 'reforester' | 'woodcutters-lodge'
  | 'well' | 'hunters-hall' | 'foragers-shed' | 'fishing-camp' | 'chapel' | 'marketplace' | 'trading-post'
  | 'threshing-barn' | 'monastery' | 'brewery' | 'smokehouse'
  | 'granary' | 'bakery' | 'apiary' | 'watermill' | 'windmill' | 'carpenter' | 'ferry-landing' | 'vineyard'
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
  carpenter: '/assets/ui/build-menu/cards/carpenter.webp', ferry_landing: '/assets/ui/build-menu/cards/ferry-landing.webp',
  weaver: '/assets/ui/build-menu/cards/weaver.webp',
  vineyard: '/assets/ui/build-menu/cards/vineyard.webp',
  pastoral_farmstead: '/assets/ui/build-menu/cards/pastoral-farmstead.webp',
  swineherd: '/assets/ui/build-menu/cards/swineherd.webp',
};

const DETAILS: Record<PlacementArtKey, [title: string, hotkey: string, description: string]> = {
  residences: ['Residence', 'H', 'Lay out homesteads along a road; homes can grow through three distinct tiers.'],
  well: ['Well', 'E', 'Draws groundwater and dispatches it to road-linked homes.'],
  chapel: ['Church', 'C', 'A staffed parish church collects tithes and supports nearby households.'],
  monastery: ['Pauline monastery', 'O', 'A hillside parish institution turning grain, optional honey-and-wine hospitality, and tithes into charity and pilgrim income.'],
  marketplace: ['Marketplace', 'P', 'Local household exchange: granary workers run food stalls, storehouse workers run goods stalls, and free haulers collect the tax lockbox. Regional trade belongs at the Trading Post.'],
  trading_post: ['Trading Post', 'X', 'Employs up to five regional traders. Each worker opens capacity for one concurrent import or export route.'],
  town_hall: ['Town Hall', 'T', 'Physical seat of settlement government, taxation, and the economic ledger. Requires a church, marketplace, and 24 people.'],
  village_storehouse: ['Village storehouse', 'S', 'Hauls surplus timber, stone, and firewood from producers into shared construction stock. Never stores food.'],
  watchtower: ['Frontier watchtower', 'W', 'Staffed hill tower warns nearby homes and stores, reducing losses when raiders cross the frontier.'],
  guardhouse: ['Frontier guardhouse', 'G', 'Paid guards consume labor, provisions, wages, and carpenter-made polearms. Polearms need smith-forged ironwork, with costly imports as a fallback. Requires a completed watchtower.'],
  palisaded_refuge: ['Palisaded refuge', 'R', 'Warned households within rally reach carry people and family coin into a timber-and-earth enclosure. Requires a completed guardhouse and watch coverage.'],
  ferry_landing: ['Ferry landing', 'J', 'A staffed river crossing and modest source of trade income. Must touch open water.'],
  lumber_mill: ['Lumber mill', 'L', 'Fells mature trees and stockpiles construction timber.'],
  stone_quarry: ["Stonecutter's camp", 'S', 'Cuts stone from rock outcrops inside its working range.'],
  large_quarry: ['Large Quarry', 'G', 'Build directly over rich stone. The non-depleting shaft needs a road and consumes prepared timber chamber supports delivered from a lumber mill or village storehouse.'],
  mine: ['Mineral mine', 'N', 'Build directly over an iron or salt deposit. Ordinary surface seams are finite and need no upkeep timber. Rich deep workings are faster and inexhaustible, but consume road-hauled shaft supports; smith-forged picks and hammer heads raise output but wear each cycle.'],
  clay_pit: ['Riverbank clay pit', 'C', 'Cuts a finite ordinary alluvial bank beside shallow water. Rich seed rolls expose faster deep clay that does not exhaust.'],
  charcoal_burner: ["Charcoal burner's yard", 'U', 'Burns household firewood in covered clamps, trading winter security for forge fuel. Severe fire risk: isolate it or keep a ready well in range.'],
  smithy: ['Forest bloomery & smithy', 'M', 'Reduces locally mined ore or reheats imported blooms and bars with charcoal, then forges them with carted quench water into tools, construction fittings, and frontier weapon heads. The compact hot-work yard carries elevated fire risk.'],
  potter_kiln: ["Potter's kiln", 'P', 'Puddles river clay with carted well water, then spends firewood and labor firing either household/preserving vessels or costly roof tiles for prosperous homes. Choosing tiles interrupts new vessel output; elevated fire risk rewards well coverage and spacing.'],
  reforester: ['Reforester', 'F', 'Restores harvested woodland with native saplings.'],
  woodcutters_lodge: ["Woodcutter's lodge", 'W', 'Splits timber into firewood and supplies connected homes. Smith-forged replacement axes raise output but wear each cycle.'],
  hunters_hall: ["Hunter's hall", 'K', 'Hunts game for meat and delivers it along the road network.'],
  foragers_shed: ["Forager's shed", 'Y', 'Gathers berries and mushrooms, dries medicinal herbs, and carts urgent treatment to sick homes.'],
  fishing_camp: ['Fishing camp', 'Z', 'Lands fish from a finite river population that reproduces in spring; overfishing can cause extinction.'],
  threshing_barn: ['Farmstead', 'T', 'Road-linked labor hub that ploughs, sows, tends, harvests, and stores crops. Smith-maintained ploughshares, hoes, sickles, and scythes shorten seasonal labor peaks.'],
  watermill: ['Grain watermill', 'M', 'Uses seasonal river power to grind grain into flour. Smith-dressed millstones and maintained iron fittings raise output; spring rain speeds it, while drought and frost slow it. Must touch open water.'],
  windmill: ['Grain windmill', 'I', 'Uses upland wind to grind grain into flour without needing a river. Smith-dressed millstones and maintained iron fittings raise output. Requires a road but no water frontage.'],
  granary: ['Village granary', 'N', 'Food-only logistics hub for wild foods, farm crops, flour, and cured provisions. Assigned keepers collect and distribute goods by handcart; it never bakes.'],
  bakery: ['Village bakery', 'B', 'Assigned bakers turn flour, carted well-water, and firewood into bread. Delivery carts always use unassigned haulers.'],
  brewery: ['Brewhouse', 'B', 'Boils grain and water over firewood into ale for prosperous households and export.'],
  smokehouse: ['Smokehouse', 'Q', 'Uses firewood, salt, and pottery to cure meat, smoke fish, or turn milk into cheese without losing the original food identity. Severe fire risk makes isolation and well coverage important.'],
  apiary: ['Forest apiary', 'A', 'Produces seasonal honey. Hospitality-enabled monasteries take honey before market export.'],
  carpenter: ['Carpenter & wheelwright', 'R', 'Staff its road-linked workshop to cut site timber needs by 10%. Prepared timber and smith-forged ironwork service connected carts for 18% faster departures; each accelerated trip consumes a small repair kit.'],
  weaver: ["Weaver's workshop", 'I', 'Turns sheep wool and field-grown flax fibre into household textiles, then exports the surplus.'],
  vineyard: ['Vineyard terrace', 'V', 'An autumn hillside harvest yields grapes and wine for monastery hospitality or high-value export.'],
  pastoral_farmstead: ['Pastoral farmstead', 'D', 'Keeps cattle for fresh dairy, manure carts, and nearby ox power, or sheep for upland dairy and an annual wool clip. Local or imported salt turns dairy and part of autumn slaughter into durable provisions; draw fenced pasture and keep a road to its suppliers.'],
  swineherd: ['Woodland swineherd', 'X', 'Raises pigs on mature woodland mast for meat and cured meat. Felling its pannage trees forces inefficient grain feeding and reduces output.'],
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

/** Housing, water, faith, trade, and transport. */
export const BASIC_BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  entry('residences'), entry('well'), entry('chapel'), entry('monastery'), entry('marketplace'), entry('trading_post'), entry('town_hall'), entry('village_storehouse'), entry('ferry_landing'),
];

/** Farms, grain processing, and village food production. */
export const AGRICULTURE_BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  entry('threshing_barn'), entry('watermill'), entry('windmill'), entry('granary'), entry('bakery'), entry('brewery'), entry('smokehouse'),
  entry('apiary'), entry('vineyard'),
  entry('pastoral_farmstead'), entry('swineherd'),
];

/** Forestry, hunting, foraging, extraction, and rural craft. */
export const RURAL_INDUSTRY_BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  entry('hunters_hall'), entry('foragers_shed'), entry('fishing_camp'), entry('woodcutters_lodge'), entry('lumber_mill'), entry('reforester'),
  entry('stone_quarry'), entry('large_quarry'), entry('mine'), entry('carpenter'), entry('weaver'),
  entry('clay_pit'), entry('charcoal_burner'), entry('smithy'), entry('potter_kiln'),
];

/** Conflict-enabled early warning and settlement defenses. */
export const MILITARY_BUILD_MENU_ENTRIES: readonly BuildMenuEntry[] = [
  entry('watchtower'), entry('guardhouse'), entry('palisaded_refuge'),
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
    return `<button type="button" class="construction-card" data-action="${entry.action}" data-hotkey="${hotkey}" data-tooltip="${description} · Cost: ${cost}" aria-label="${title} (${hotkey})">
      <img class="construction-card__art" data-src="${BUILD_CARD_ART[entry.artKey]}" alt="" width="320" height="480" loading="lazy" decoding="async" draggable="false" />
      <span class="construction-card__hotkey" aria-hidden="true">${hotkey}</span>
      <span class="construction-card__caption" aria-hidden="true"><strong>${title}</strong><span>${cost}</span></span>
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
