import type { HudResourceKind } from '../resources/resourceTotals.ts';
import { resourceCostLabel } from './resourceCost.ts';

type HudProvisionGroup = Readonly<{
  id: string;
  label: string;
  kinds: readonly HudResourceKind[];
}>;

/** Non-food civilian stores, grouped by how players use the goods. */
export const HUD_PROVISION_GROUPS = [
  {
    id: 'farmSupplies',
    label: 'Farm supplies',
    kinds: ['animalFeed', 'manure'],
  },
  {
    id: 'rawMaterials',
    label: 'Raw materials',
    kinds: ['iron', 'clay', 'salt', 'wool', 'flax', 'pelts', 'hides', 'wax'],
  },
  {
    id: 'processedMaterials',
    label: 'Processed materials',
    kinds: ['yarn', 'linen', 'leather'],
  },
  {
    id: 'householdGoods',
    label: 'Household goods',
    kinds: ['pottery', 'candles', 'remedies'],
  },
  {
    id: 'apparel',
    label: 'Clothing & footwear',
    kinds: ['cloth', 'shoes'],
  },
  {
    id: 'beverages',
    label: 'Beverages',
    kinds: ['ale', 'cider', 'mead', 'wine'],
  },
] as const satisfies readonly HudProvisionGroup[];

export type HudProvisionResourceKind =
  (typeof HUD_PROVISION_GROUPS)[number]['kinds'][number];

export const HUD_PROVISION_RESOURCE_KINDS: readonly HudProvisionResourceKind[] =
  HUD_PROVISION_GROUPS.flatMap(group => group.kinds);

export function hudProvisionResourceLabel(kind: HudProvisionResourceKind): string {
  const label = resourceCostLabel(kind);
  return label.charAt(0).toUpperCase() + label.slice(1);
}
