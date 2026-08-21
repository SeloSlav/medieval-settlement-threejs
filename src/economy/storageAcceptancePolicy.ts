import type { BuildingState } from '../resources/types.ts';

export const STORAGE_COMMODITY_CODES = {
  firewood: 0,
  food: 2,
  timber: 3,
  ale: 6,
  preservedFood: 7,
  honey: 8,
  stone: 10,
  cloth: 14,
  barley: 16,
  flax: 18,
  iron: 19,
  clay: 20,
  salt: 21,
  charcoal: 22,
  pottery: 23,
  meat: 28,
  fish: 29,
  berries: 30,
  mushrooms: 31,
  milk: 32,
  apples: 33,
  cherries: 34,
  vegetables: 35,
  eggs: 36,
  grapes: 37,
  curedMeat: 39,
  smokedFish: 40,
  cheese: 41,
  ryeSheaves: 42,
  oatSheaves: 43,
  barleySheaves: 44,
  maslinSheaves: 45,
  ryeGrain: 46,
  oatGrain: 47,
  maslinGrain: 48,
  ryeFlour: 49,
  maslinFlour: 51,
  ryeBread: 52,
  maslinBread: 54,
  hides: 58,
  leather: 59,
  shoes: 60,
} as const;

export type StorageCommodity = keyof typeof STORAGE_COMMODITY_CODES;

export const STORAGE_COMMODITY_LABELS: Record<StorageCommodity, string> = {
  firewood: 'Firewood',
  food: 'Mixed provisions',
  timber: 'Timber',
  ale: 'Ale',
  preservedFood: 'Preserved provisions',
  honey: 'Honey',
  stone: 'Stone',
  cloth: 'Cloth',
  barley: 'Threshed barley',
  flax: 'Flax',
  iron: 'Iron ore',
  clay: 'Clay',
  salt: 'Salt',
  charcoal: 'Charcoal',
  pottery: 'Pottery',
  meat: 'Fresh meat',
  fish: 'Fresh fish',
  berries: 'Berries',
  mushrooms: 'Mushrooms',
  milk: 'Milk',
  apples: 'Apples',
  cherries: 'Cherries',
  vegetables: 'Vegetables',
  eggs: 'Eggs',
  grapes: 'Grapes',
  curedMeat: 'Cured meat',
  smokedFish: 'Smoked fish',
  cheese: 'Cheese',
  ryeSheaves: 'Rye sheaves',
  oatSheaves: 'Oat sheaves',
  barleySheaves: 'Barley sheaves',
  maslinSheaves: 'Maslin sheaves',
  ryeGrain: 'Rye grain',
  oatGrain: 'Oat grain',
  maslinGrain: 'Maslin grain',
  ryeFlour: 'Rye flour',
  maslinFlour: 'Maslin flour',
  ryeBread: 'Rye bread',
  maslinBread: 'Maslin bread',
  hides: 'Untanned hides',
  leather: 'Leather',
  shoes: 'Shoes',
};

export const STOREHOUSE_STORAGE_GROUPS = [
  { label: 'Building materials', commodities: ['timber', 'stone'] },
  { label: 'Fuel and minerals', commodities: ['firewood', 'charcoal', 'iron', 'clay', 'salt'] },
  { label: 'Market wares', commodities: ['cloth', 'hides', 'leather', 'shoes', 'pottery'] },
] as const satisfies ReadonlyArray<{
  label: string;
  commodities: readonly StorageCommodity[];
}>;

export const GRANARY_STORAGE_GROUPS = [
  {
    label: 'Fresh provisions',
    commodities: [
      'food', 'meat', 'fish', 'berries', 'mushrooms', 'milk', 'apples', 'cherries',
      'vegetables', 'eggs', 'grapes',
    ],
  },
  {
    label: 'Preserved provisions',
    commodities: ['preservedFood', 'curedMeat', 'smokedFish', 'cheese', 'honey'],
  },
  {
    label: 'Harvest and grain',
    commodities: [
      'ryeSheaves', 'oatSheaves', 'barleySheaves', 'maslinSheaves',
      'ryeGrain', 'oatGrain', 'barley', 'maslinGrain', 'flax',
    ],
  },
  {
    label: 'Milled and baked',
    commodities: ['ryeFlour', 'maslinFlour', 'ryeBread', 'maslinBread', 'ale'],
  },
] as const satisfies ReadonlyArray<{
  label: string;
  commodities: readonly StorageCommodity[];
}>;

export const STOREHOUSE_STORAGE_COMMODITIES = STOREHOUSE_STORAGE_GROUPS
  .flatMap((group) => [...group.commodities]);
export const GRANARY_STORAGE_COMMODITIES = GRANARY_STORAGE_GROUPS
  .flatMap((group) => [...group.commodities]);

const GRANARY_LEGACY_FRESH = new Set<StorageCommodity>([
  'food', 'oatGrain', 'ryeBread', 'maslinBread', 'meat', 'fish', 'berries',
  'mushrooms', 'milk', 'apples', 'cherries', 'vegetables', 'eggs', 'grapes',
  'preservedFood', 'curedMeat', 'smokedFish', 'cheese',
]);

function maskAccepts(mask: string | undefined, commodity: StorageCommodity): boolean {
  if (mask == null) return true;
  try {
    return (BigInt(mask) & (1n << BigInt(STORAGE_COMMODITY_CODES[commodity]))) !== 0n;
  } catch {
    return true;
  }
}

export function storageAcceptsCommodity(
  building: Pick<
    BuildingState,
    | 'kind'
    | 'storageAcceptanceMask'
    | 'storehouseAcceptsTimber'
    | 'storehouseAcceptsStone'
    | 'storehouseAcceptsFirewood'
    | 'storehouseAcceptsCharcoal'
    | 'storehouseAcceptsIron'
    | 'storehouseAcceptsClay'
    | 'storehouseAcceptsSalt'
    | 'granaryAcceptsFreshFood'
  >,
  commodity: StorageCommodity,
): boolean {
  if (!maskAccepts(building.storageAcceptanceMask, commodity)) return false;
  if (building.kind === 'granary') {
    return !GRANARY_LEGACY_FRESH.has(commodity) || building.granaryAcceptsFreshFood !== false;
  }
  if (building.kind !== 'village_storehouse') return true;
  switch (commodity) {
    case 'timber': return building.storehouseAcceptsTimber !== false;
    case 'stone': return building.storehouseAcceptsStone !== false;
    case 'firewood': return building.storehouseAcceptsFirewood !== false;
    case 'charcoal': return building.storehouseAcceptsCharcoal !== false;
    case 'iron': return building.storehouseAcceptsIron !== false;
    case 'clay': return building.storehouseAcceptsClay !== false;
    case 'salt': return building.storehouseAcceptsSalt !== false;
    default: return true;
  }
}

export function storageCommodityLabel(commodity: StorageCommodity): string {
  return STORAGE_COMMODITY_LABELS[commodity];
}

export function isStorageCommodity(value: string | undefined): value is StorageCommodity {
  return value != null && value in STORAGE_COMMODITY_CODES;
}

export function renderStorageAcceptanceControls(
  building: BuildingState,
  groups: ReadonlyArray<{ label: string; commodities: readonly StorageCommodity[] }>,
): string {
  const total = groups.reduce((sum, group) => sum + group.commodities.length, 0);
  const active = groups.reduce(
    (sum, group) => sum + group.commodities.filter(
      (commodity) => storageAcceptsCommodity(building, commodity),
    ).length,
    0,
  );
  return `
    <div class="storage-acceptance" aria-label="Accepted goods">
      <div class="storage-acceptance__heading">
        <div>
          <strong>Accepted goods</strong>
          <span>${active} of ${total} enabled</span>
        </div>
        <div class="storage-acceptance__bulk">
          <button type="button" data-storage-accept-all="true" ${active === total ? 'disabled' : ''}>Activate all</button>
          <button type="button" data-storage-accept-all="false" ${active === 0 ? 'disabled' : ''}>Cancel all</button>
        </div>
      </div>
      ${groups.map((group) => `
        <section class="storage-acceptance__group" aria-label="${group.label}">
          <span class="storage-acceptance__group-label">${group.label}</span>
          <div class="storage-acceptance__grid">
            ${group.commodities.map((commodity) => {
              const label = storageCommodityLabel(commodity);
              const accepts = storageAcceptsCommodity(building, commodity);
              return `<button type="button" class="storage-acceptance__commodity resource-cost__item${accepts ? '' : ' is-blocked'}" data-resource-cost="${commodity}" data-storage-commodity="${commodity}" data-storage-accepts="${accepts}" aria-pressed="${accepts}" title="${label} · ${accepts ? 'accepted' : 'barred'}"><span class="resource-cost__icon" aria-hidden="true"></span><span class="storage-acceptance__commodity-label">${label}</span></button>`;
            }).join('')}
          </div>
        </section>
      `).join('')}
    </div>
  `;
}
