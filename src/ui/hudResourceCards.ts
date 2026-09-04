import type { HudResourceKind } from '../resources/resourceTotals.ts';

export const HUD_CONSTRUCTION_RESOURCE_KINDS = [
  'timber',
  'stone',
] as const satisfies readonly HudResourceKind[];

export type HudConstructionResourceKind =
  (typeof HUD_CONSTRUCTION_RESOURCE_KINDS)[number];

export const HUD_RESOURCE_CARD_KINDS = [
  'timber',
  'stone',
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
    totalDetail: 'All stored timber, including supplies reserved for construction and home improvements. Timber in transit is counted separately until unloaded.',
  },
  stone: {
    label: 'Stone',
    surplusDetail: 'Unreserved stone in quarry yards and depots.',
    totalDetail: 'All stored stone, including supplies reserved for construction and home improvements. Stone in transit is counted separately until unloaded.',
  },
  gold: {
    label: 'Civic treasury',
    surplusDetail: 'Spendable public gold across founding lockboxes, reclamation chests, and Town Hall treasuries.',
    totalDetail: 'All civic gold secured in founding lockboxes, reclamation chests, or Town Hall treasuries, including coin committed to active home projects. Market receipts, company pay chests, private household savings, and moving lockboxes remain separate.',
  },
};

export function isHudResourceCardKind(
  resource: HudResourceKind,
): resource is HudResourceCardKind {
  return (HUD_RESOURCE_CARD_KINDS as readonly HudResourceKind[]).includes(resource);
}
