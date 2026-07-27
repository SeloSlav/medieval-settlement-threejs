import type { BuildingState } from '../resources/types.ts';

export const MARKETPLACE_GOLD_RESERVE_DEFAULT = 32;
export const MARKETPLACE_GOLD_RESERVE_TARGETS = [0, 16, 32, 64] as const;

export function normalizeMarketplaceGoldReserveTarget(
  value: number | null | undefined,
): number {
  const finite = Number.isFinite(value) ? Math.max(0, Number(value)) : MARKETPLACE_GOLD_RESERVE_DEFAULT;
  return [...MARKETPLACE_GOLD_RESERVE_TARGETS]
    .reverse()
    .find((target) => target <= finite) ?? 0;
}

export function marketplaceGoldReserveShortfall(
  onsiteGold: number,
  inboundGold: number,
  target: number,
): number {
  return Math.max(
    0,
    normalizeMarketplaceGoldReserveTarget(target)
      - Math.max(0, Number.isFinite(onsiteGold) ? onsiteGold : 0)
      - Math.max(0, Number.isFinite(inboundGold) ? inboundGold : 0),
  );
}

export function marketplaceGoldSweepSurplus(
  onsiteGold: number,
  target: number,
): number {
  return Math.max(
    0,
    Math.max(0, Number.isFinite(onsiteGold) ? onsiteGold : 0)
      - normalizeMarketplaceGoldReserveTarget(target),
  );
}

export function marketplaceGoldReserveTarget(
  building: Pick<BuildingState, 'marketplaceGoldReserveTarget'>,
): number {
  return normalizeMarketplaceGoldReserveTarget(building.marketplaceGoldReserveTarget);
}
