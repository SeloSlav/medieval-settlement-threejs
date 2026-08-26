import type { HudResourceKind } from '../resources/resourceTotals.ts';

export const HUD_RESOURCE_CARD_KINDS = [
  'timber',
  'stone',
  'water',
  'gold',
] as const satisfies readonly HudResourceKind[];

export type HudResourceCardKind = (typeof HUD_RESOURCE_CARD_KINDS)[number];

type HudResourceCardPresentation = Readonly<{
  label: string;
  surplusDetail: string;
  totalDetail: string;
}>;

export const HUD_RESOURCE_CARD_PRESENTATION: Record<
  HudResourceCardKind,
  HudResourceCardPresentation
> = {
  timber: {
    label: 'Timber',
    surplusDetail: 'Unreserved timber in yards, mills, and depots.',
    totalDetail: 'All timber stored at physical yards, mills, and depots, including stock committed to active construction and home projects. Loaded carts remain listed separately until unloading.',
  },
  stone: {
    label: 'Stone',
    surplusDetail: 'Unreserved stone in quarry yards and depots.',
    totalDetail: 'All stone stored at physical quarry yards and depots, including stock committed to active construction and home projects. Loaded carts remain listed separately until unloading.',
  },
  water: {
    label: 'Water',
    surplusDetail: 'Water in wells, workplaces, and homes.',
    totalDetail: 'All physically stored water across wells, workplaces, and homes. Loaded carts remain listed separately until unloading.',
  },
  gold: {
    label: 'Treasury',
    surplusDetail: 'Spendable gold across community lockboxes and the Town Hall treasury.',
    totalDetail: 'All civic gold secured in founders’ lockboxes, reclamation chests, or Town Hall treasuries, including coin committed to active home projects. Market working cash, company pay chests, and moving lockboxes remain separate.',
  },
};

export function isHudResourceCardKind(
  resource: HudResourceKind,
): resource is HudResourceCardKind {
  return (HUD_RESOURCE_CARD_KINDS as readonly HudResourceKind[]).includes(resource);
}
