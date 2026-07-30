import {
  CARPENTER_IRONWORK_PER_POLEARM,
  CARPENTER_TIMBER_PER_POLEARM,
} from '../generated/gameBalance.ts';
import type { BuildingState } from '../resources/types.ts';
import {
  CARPENTER_CART_SERVICE_IRONWORK_TARGET,
  CARPENTER_CART_SERVICE_TIMBER_TARGET,
} from './carpenterSupport.ts';

export const CARPENTER_POLEARM_RESERVE_DEFAULT = 6;
export const CARPENTER_POLEARM_RESERVE_LEGACY = 24;
export const CARPENTER_POLEARM_RESERVE_MAX = 24;

export const CARPENTER_POLEARM_RESERVE_PRESETS = [
  { reserve: 0, label: 'Cartwright only' },
  { reserve: 2, label: 'Pair of spares' },
  { reserve: 6, label: 'One company' },
  { reserve: 12, label: 'Two companies' },
  { reserve: 24, label: 'Full armory' },
] as const;

export type CarpenterArmoryPlan = {
  reserve: number;
  stock: number;
  shortfall: number;
  timberToTarget: number;
  ironworkToTarget: number;
};

export function normalizeCarpenterPolearmReserve(reserve: number): number {
  if (!Number.isFinite(reserve)) return CARPENTER_POLEARM_RESERVE_LEGACY;
  return Math.max(0, Math.min(CARPENTER_POLEARM_RESERVE_MAX, Math.floor(reserve)));
}

export function carpenterPolearmShortfall(stock: number, reserve: number): number {
  return Math.max(
    0,
    normalizeCarpenterPolearmReserve(reserve) - Math.max(0, stock),
  );
}

export function guardhousePolearmTarget(assignedLabor: number): number {
  return Math.max(0, Math.floor(assignedLabor));
}

export function carpenterArmoryPlan(
  building: Pick<
    BuildingState,
    'polearms' | 'carpenterPolearmReserve' | 'timber' | 'ironwork'
  >,
): CarpenterArmoryPlan {
  const reserve = normalizeCarpenterPolearmReserve(
    building.carpenterPolearmReserve ?? CARPENTER_POLEARM_RESERVE_LEGACY,
  );
  const stock = Math.max(0, building.polearms ?? 0);
  const shortfall = carpenterPolearmShortfall(stock, reserve);
  return {
    reserve,
    stock,
    shortfall,
    timberToTarget: shortfall <= 0
      ? 0
      : Math.max(
          0,
          CARPENTER_CART_SERVICE_TIMBER_TARGET
            + shortfall * CARPENTER_TIMBER_PER_POLEARM
            - Math.max(0, building.timber),
        ),
    ironworkToTarget: shortfall <= 0
      ? 0
      : Math.max(
          0,
          CARPENTER_CART_SERVICE_IRONWORK_TARGET
            + shortfall * CARPENTER_IRONWORK_PER_POLEARM
            - Math.max(0, building.ironwork ?? 0),
        ),
  };
}
