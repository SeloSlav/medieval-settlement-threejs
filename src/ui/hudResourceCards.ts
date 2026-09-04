import type { HudResourceKind } from '../resources/resourceTotals.ts';

export const HUD_CONSTRUCTION_RESOURCE_KINDS = [
  'timber',
  'stone',
  'ironwork',
  'roofTiles',
] as const satisfies readonly HudResourceKind[];

export type HudConstructionResourceKind =
  (typeof HUD_CONSTRUCTION_RESOURCE_KINDS)[number];

export const HUD_RESOURCE_CARD_KINDS = [
  'timber',
  'stone',
  'ironwork',
  'roofTiles',
  'gold',
] as const satisfies readonly HudResourceKind[];

export type HudResourceCardKind = (typeof HUD_RESOURCE_CARD_KINDS)[number];

type HudResourceCardPresentation = Readonly<{
  label: string;
  surplusDetail?: string;
  totalDetail?: string;
}>;

export const HUD_RESOURCE_CARD_PRESENTATION: Record<
  HudResourceCardKind,
  HudResourceCardPresentation
> = {
  timber: {
    label: 'Timber',
  },
  stone: {
    label: 'Stone',
  },
  ironwork: {
    label: 'Ironwork',
  },
  roofTiles: {
    label: 'Roof tiles',
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
