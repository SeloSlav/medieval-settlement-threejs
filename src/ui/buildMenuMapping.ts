import type { BuildingKind } from '../generated/gameBalance.ts';
import type { PlacementBuildMenuAction } from './buildMenuCards.ts';

export const BUILDING_KIND_TO_MENU_ACTION: Partial<Record<BuildingKind, PlacementBuildMenuAction>> = {
  founders_camp: 'village-storehouse',
  salvage_pile: 'village-storehouse',
  lumber_mill: 'lumber-mill',
  reforester: 'reforester',
  stone_quarry: 'stone-quarry',
  large_quarry: 'large-quarry',
  mine: 'mine',
  clay_pit: 'clay-pit',
  charcoal_burner: 'charcoal-burner',
  smithy: 'smithy',
  potter_kiln: 'potter-kiln',
  woodcutters_lodge: 'woodcutters-lodge',
  well: 'well',
  hunters_hall: 'hunters-hall',
  foragers_shed: 'foragers-shed',
  fishing_camp: 'fishing-camp',
  chapel: 'chapel',
  marketplace: 'marketplace',
  trading_post: 'trading-post',
  town_hall: 'town-hall',
  village_storehouse: 'village-storehouse',
  watchtower: 'watchtower',
  guardhouse: 'guardhouse',
  palisaded_refuge: 'palisaded-refuge',
  threshing_barn: 'threshing-barn',
  monastery: 'monastery',
  brewery: 'brewery',
  smokehouse: 'smokehouse',
  granary: 'granary',
  bakery: 'bakery',
  apiary: 'apiary',
  watermill: 'watermill',
  carpenter: 'carpenter',
  weaver: 'weaver',
  ferry_landing: 'ferry-landing',
  vineyard: 'vineyard',
  pastoral_farmstead: 'pastoral-farmstead',
  swineherd: 'swineherd',
};

export type BuildingMenuAction = Exclude<PlacementBuildMenuAction, 'residences'>;

export const MENU_ACTION_TO_BUILDING_KIND: Record<BuildingMenuAction, BuildingKind> = {
  'lumber-mill': 'lumber_mill',
  'reforester': 'reforester',
  'stone-quarry': 'stone_quarry',
  'large-quarry': 'large_quarry',
  mine: 'mine',
  'clay-pit': 'clay_pit',
  'charcoal-burner': 'charcoal_burner',
  smithy: 'smithy',
  'potter-kiln': 'potter_kiln',
  'woodcutters-lodge': 'woodcutters_lodge',
  well: 'well',
  'hunters-hall': 'hunters_hall',
  'foragers-shed': 'foragers_shed',
  'fishing-camp': 'fishing_camp',
  chapel: 'chapel',
  marketplace: 'marketplace',
  'trading-post': 'trading_post',
  'town-hall': 'town_hall',
  'village-storehouse': 'village_storehouse',
  watchtower: 'watchtower',
  guardhouse: 'guardhouse',
  'palisaded-refuge': 'palisaded_refuge',
  'threshing-barn': 'threshing_barn',
  monastery: 'monastery',
  brewery: 'brewery',
  smokehouse: 'smokehouse',
  granary: 'granary',
  bakery: 'bakery',
  apiary: 'apiary',
  watermill: 'watermill',
  carpenter: 'carpenter',
  weaver: 'weaver',
  'ferry-landing': 'ferry_landing',
  vineyard: 'vineyard',
  'pastoral-farmstead': 'pastoral_farmstead',
  swineherd: 'swineherd',
};

export function toolbarModeToMenuAction(
  mode: BuildingKind | 'road' | 'residences' | 'farm-fields' | 'pastures' | 'burial-grounds' | 'idle',
): PlacementBuildMenuAction | null {
  if (mode === 'idle' || mode === 'road') return null;
  if (mode === 'residences') return 'residences';
  if (mode === 'farm-fields' || mode === 'pastures' || mode === 'burial-grounds') return null;
  return BUILDING_KIND_TO_MENU_ACTION[mode] ?? null;
}
