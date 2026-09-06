import type { BuildingState } from '../resources/types.ts';

export const STORAGE_COMMODITY_CODES = {
  firewood: 0,
  timber: 3,
  ale: 6,
  honey: 8,
  wine: 9,
  stone: 10,
  dressedStone: 76,
  polearms: 11,
  ironwork: 12,
  wool: 13,
  cloth: 14,
  barley: 16,
  flax: 18,
  iron: 19,
  clay: 20,
  salt: 21,
  charcoal: 22,
  pottery: 23,
  remedies: 25,
  meat: 28,
  fish: 29,
  berries: 30,
  mushrooms: 31,
  milk: 32,
  apples: 33,
  pears: 4,
  cherries: 34,
  aronia: 5,
  rosehips: 27,
  cabbage: 38,
  carrots: 50,
  beetroot: 53,
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
  cider: 55,
  mead: 56,
  hides: 58,
  leather: 59,
  shoes: 60,
  jam: 61,
  wax: 64,
  candles: 65,
  pelts: 66,
  yarn: 67,
  linen: 68,
  sidearms: 69,
  shields: 70,
  bows: 71,
  crossbows: 72,
  paddedArmor: 73,
  mailArmor: 74,
  ammunition: 75,
} as const;

export type StorageCommodity = keyof typeof STORAGE_COMMODITY_CODES;

export const STORAGE_COMMODITY_LABELS: Record<StorageCommodity, string> = {
  firewood: 'Firewood',
  timber: 'Timber',
  ale: 'Ale',
  honey: 'Honey',
  wine: 'Wine',
  stone: 'Stone',
  dressedStone: 'Dressed stone',
  wool: 'Wool',
  cloth: 'Clothing',
  barley: 'Threshed barley',
  flax: 'Flax',
  iron: 'Iron ore',
  clay: 'Clay',
  salt: 'Salt',
  charcoal: 'Charcoal',
  pottery: 'Pottery',
  remedies: 'Remedies',
  meat: 'Fresh meat',
  fish: 'Fresh fish',
  berries: 'Raspberries',
  mushrooms: 'Mushrooms',
  milk: 'Milk',
  apples: 'Apples',
  pears: 'Pears',
  cherries: 'Cherries',
  aronia: 'Aronia berries',
  rosehips: 'Rosehips',
  cabbage: 'Cabbage',
  carrots: 'Carrots',
  beetroot: 'Beetroot',
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
  cider: 'Cider',
  mead: 'Mead',
  hides: 'Untanned hides',
  leather: 'Leather',
  shoes: 'Shoes',
  jam: 'Jam',
  wax: 'Beeswax',
  candles: 'Candles',
  pelts: 'Wild-game pelts',
  yarn: 'Yarn',
  linen: 'Linen',
  polearms: 'Polearms',
  ironwork: 'Ironwork',
  sidearms: 'Sidearms',
  shields: 'Shields',
  bows: 'Bows',
  crossbows: 'Crossbows',
  paddedArmor: 'Padded armor',
  mailArmor: 'Mail armor',
  ammunition: 'Ammunition',
};

export const STOREHOUSE_STORAGE_GROUPS = [
  { label: 'Building materials', commodities: ['timber', 'stone', 'dressedStone'] },
  { label: 'Fuel and minerals', commodities: ['firewood', 'charcoal', 'iron', 'clay', 'salt'] },
  { label: 'Textile materials', commodities: ['wool', 'yarn', 'linen'] },
  { label: 'Market wares', commodities: ['cloth', 'pelts', 'hides', 'leather', 'shoes', 'pottery', 'remedies', 'wax', 'candles'] },
  { label: 'Military stores', commodities: ['ironwork', 'polearms', 'sidearms', 'shields', 'bows', 'crossbows', 'paddedArmor', 'mailArmor', 'ammunition'] },
] as const satisfies ReadonlyArray<{
  label: string;
  commodities: readonly StorageCommodity[];
}>;

export const GRANARY_STORAGE_GROUPS = [
  {
    label: 'Fresh provisions',
    commodities: [
      'meat', 'fish', 'berries', 'mushrooms', 'milk', 'apples', 'pears',
      'cherries', 'aronia', 'rosehips', 'cabbage', 'carrots',
      'beetroot', 'eggs', 'grapes',
    ],
  },
  { label: 'Savory preserves', commodities: ['curedMeat', 'smokedFish', 'cheese'] },
  { label: 'Sweet preserves', commodities: ['honey', 'jam'] },
  { label: 'Drinks', commodities: ['ale', 'cider', 'mead', 'wine'] },
  {
    label: 'Harvest and grain',
    commodities: [
      'ryeSheaves', 'oatSheaves', 'barleySheaves', 'maslinSheaves',
      'ryeGrain', 'oatGrain', 'barley', 'maslinGrain', 'flax',
    ],
  },
  {
    label: 'Milled and baked',
    commodities: ['ryeFlour', 'maslinFlour', 'ryeBread', 'maslinBread'],
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
  'oatGrain', 'ryeBread', 'maslinBread', 'meat', 'fish', 'berries',
  'mushrooms', 'milk', 'apples', 'pears', 'cherries', 'aronia', 'rosehips',
  'cabbage', 'carrots', 'beetroot', 'eggs', 'grapes',
  'curedMeat', 'smokedFish', 'cheese', 'jam',
]);

function masksAccept(
  lowMask: string | undefined,
  highMask: string | undefined,
  commodity: StorageCommodity,
): boolean {
  const code = STORAGE_COMMODITY_CODES[commodity];
  const high = code >= 64;
  const mask = high ? highMask : lowMask;
  if (mask == null) return true;
  try {
    const bit = BigInt(high ? code - 64 : code);
    return (BigInt(mask) & (1n << bit)) !== 0n;
  } catch {
    return true;
  }
}

export function storageAcceptsCommodity(
  building: Pick<
    BuildingState,
    | 'kind'
    | 'storageAcceptanceMask'
    | 'storageAcceptanceMaskHigh'
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
  if (!masksAccept(
    building.storageAcceptanceMask,
    building.storageAcceptanceMaskHigh,
    commodity,
  )) return false;
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
          <button type="button" class="resource-action-button storage-acceptance__bulk-action" data-storage-accept-all="true" ${active === total ? 'disabled' : ''}>Accept all</button>
          <button type="button" class="resource-action-button storage-acceptance__bulk-action" data-storage-accept-all="false" ${active === 0 ? 'disabled' : ''}>Accept none</button>
        </div>
      </div>
      ${groups.map((group) => `
        <section class="storage-acceptance__group" aria-label="${group.label}">
          <span class="storage-acceptance__group-label">${group.label}</span>
          <div class="storage-acceptance__grid">
            ${group.commodities.map((commodity) => {
              const label = storageCommodityLabel(commodity);
              const accepts = storageAcceptsCommodity(building, commodity);
              const state = accepts
                ? `${label}: accepting new deliveries.`
                : `${label}: new deliveries blocked.`;
              return `<button type="button" class="resource-action-button resource-action-button--toggle storage-acceptance__commodity resource-cost__item${accepts ? '' : ' is-blocked'}" data-resource-cost="${commodity}" data-storage-commodity="${commodity}" data-storage-accepts="${accepts}" aria-pressed="${accepts}" aria-label="${state}" title="${state}"><span class="resource-cost__icon" aria-hidden="true"></span><span class="storage-acceptance__commodity-label">${label}</span></button>`;
            }).join('')}
          </div>
        </section>
      `).join('')}
    </div>
  `;
}
