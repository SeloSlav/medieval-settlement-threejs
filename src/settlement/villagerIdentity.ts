import type { BuildingKind } from '../generated/gameBalance.ts';
import { hashStringSeed, mulberry32, pick } from '../utils/random.ts';
import type { VillagerModelVariant } from './SettlementCrowdRenderer.ts';

const MASCULINE_NAMES = [
  'Andrija',
  'Bartol',
  'Grgur',
  'Ivan',
  'Jakov',
  'Juraj',
  'Lovro',
  'Marko',
  'Martin',
  'Matija',
  'Mihovil',
  'Nikola',
  'Petar',
  'Stjepan',
] as const;

const FEMININE_NAMES = [
  'Ana',
  'Barbara',
  'Cvita',
  'Doroteja',
  'Jelena',
  'Katarina',
  'Lucija',
  'Mara',
  'Margareta',
  'Petra',
  'Uršula',
  'Vida',
] as const;

const FAMILY_NAMES = [
  'Barišić',
  'Božić',
  'Grubić',
  'Horvat',
  'Jurić',
  'Kolar',
  'Kovač',
  'Lončar',
  'Marić',
  'Novak',
  'Radić',
  'Vuković',
] as const;

const OCCUPATIONS: Record<BuildingKind, string> = {
  founders_camp: 'Founder',
  salvage_pile: 'Hauler',
  lumber_mill: 'Lumberjack',
  reforester: 'Forester',
  woodcutters_lodge: 'Woodcutter',
  stone_quarry: 'Miner',
  large_quarry: 'Quarryman',
  mine: 'Mineworker',
  charcoal_burner: 'Charcoal burner',
  smithy: 'Blacksmith',
  weaponsmith_armorer: 'Weaponsmith / armorer',
  bowyer_fletcher: 'Bowyer / fletcher',
  stone_mason: 'Stonemason',
  potter_kiln: 'Potter',
  well: 'Well keeper',
  stable: 'Ox keeper',
  cavalry_yard: 'Cavalry groom',
  kennel: 'Kennel keeper',
  hunters_hall: 'Hunter',
  foragers_shed: 'Forager',
  fishing_camp: 'Fisher',
  chapel: 'Priest',
  wayside_shrine: 'Villager',
  marketplace: 'Market stallholder',
    trading_post: 'Trading Post hauler',
  town_hall: 'Civic clerk',
  village_storehouse: 'Storehouse hauler',
  watchtower: 'Watchman',
  guardhouse: 'Frontier guard',
  palisaded_refuge: 'Refuge keeper',
  threshing_barn: 'Farmhand',
  pastoral_farmstead: 'Herder',
  swineherd: 'Swineherd',
  monastery: 'Monk',
  brewery: 'Brewer',
  tavern: 'Innkeeper',
  smokehouse: 'Smokehouse worker',
  granary: 'Granary keeper',
  bakery: 'Baker',
  apiary: 'Beekeeper',
  watermill: 'Miller',
  windmill: 'Miller',
  carpenter: 'Carpenter',
  spinning_retting_house: 'Spinner / retter',
  weaver: 'Weaver',
  tannery: 'Tanner',
  cobbler: 'Cobbler',
  chandlery: 'Chandler',
};

/**
 * Person identities come from authoritative household/worker allocation. A
 * deterministic name keeps the same villager recognizable across syncs and
 * job changes without needing a separate replicated table.
 */
export function villagerDisplayName(
  personIdentity: string,
  variant: VillagerModelVariant,
): string {
  const rng = mulberry32(hashStringSeed(`villager-name:${personIdentity}`));
  const firstNames = variant === 'woman' ? FEMININE_NAMES : MASCULINE_NAMES;
  return `${pick(firstNames, rng)} ${pick(FAMILY_NAMES, rng)}`;
}

export function villagerOccupation(
  buildingKind: BuildingKind | null,
  isUnderConstruction = false,
): string {
  if (isUnderConstruction) return 'Builder';
  return buildingKind ? OCCUPATIONS[buildingKind] : 'Available labor';
}
