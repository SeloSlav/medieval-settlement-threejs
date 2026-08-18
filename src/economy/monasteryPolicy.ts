import {
  MONASTERY_COVERAGE_RADIUS,
  MONASTERY_TITHE_SHARE_DEFAULT,
} from '../generated/gameBalance.ts';

export type MonasteryPolicyState = {
  titheShare: number;
  feastsEnabled: boolean;
  tithePaidTotal: number;
  pilgrimageGoldTotal: number;
  foodCharityTotal: number;
};

export const DEFAULT_MONASTERY_POLICY: MonasteryPolicyState = {
  titheShare: MONASTERY_TITHE_SHARE_DEFAULT,
  feastsEnabled: true,
  tithePaidTotal: 0,
  pilgrimageGoldTotal: 0,
  foodCharityTotal: 0,
};

export function clampMonasteryTitheShare(value: number): number {
  return Math.min(0.8, Math.max(0, value));
}

export function formatMonasteryTitheSharePercent(titheShare: number): string {
  return `${Math.round(clampMonasteryTitheShare(titheShare) * 100)}%`;
}

export function formatMonasteryFoodCharityTotal(total: number): string {
  return `${total.toFixed(0)} food units served`;
}

export function formatMonasteryPilgrimageTotal(total: number): string {
  return `${Math.round(total)} gold from pilgrimages`;
}

export function formatMonasteryTithePaidTotal(total: number): string {
  return `${Math.round(total)} gold tithe routed`;
}

export { MONASTERY_COVERAGE_RADIUS };
