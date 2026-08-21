import {
  MONASTERY_COVERAGE_RADIUS,
  MONASTERY_TITHE_SHARE_DEFAULT,
} from '../generated/gameBalance.ts';

export type MonasteryPolicyState = {
  titheShare: number;
  feastsEnabled: boolean;
  levyRate: number;
  levyCollectedTotal: number;
  tithePaidTotal: number;
  pilgrimageGoldTotal: number;
  foodCharityTotal: number;
  feastsHeldTotal: number;
  seedRescueTotal: number;
  scriptoriumTimberSavedTotal: number;
  scriptoriumStoneSavedTotal: number;
  scriptoriumIronworkSavedTotal: number;
  scriptoriumRoofTilesSavedTotal: number;
};

export const DEFAULT_MONASTERY_POLICY: MonasteryPolicyState = {
  titheShare: MONASTERY_TITHE_SHARE_DEFAULT,
  feastsEnabled: true,
  levyRate: 0.10,
  levyCollectedTotal: 0,
  tithePaidTotal: 0,
  pilgrimageGoldTotal: 0,
  foodCharityTotal: 0,
  feastsHeldTotal: 0,
  seedRescueTotal: 0,
  scriptoriumTimberSavedTotal: 0,
  scriptoriumStoneSavedTotal: 0,
  scriptoriumIronworkSavedTotal: 0,
  scriptoriumRoofTilesSavedTotal: 0,
};

export const MONASTERY_CHARTER_RATES = [0, 0.10, 0.25] as const;

export function normalizeMonasteryCharterRate(rate: number): number {
  if (!Number.isFinite(rate)) return 0.10;
  return MONASTERY_CHARTER_RATES.reduce((nearest, candidate) =>
    Math.abs(rate - candidate) < Math.abs(rate - nearest) ? candidate : nearest
  );
}

export function monasteryCharterLabel(rate: number): string {
  const normalized = normalizeMonasteryCharterRate(rate);
  if (normalized === 0) return 'Chartered immunity';
  if (normalized === 0.10) return 'Customary aid';
  return 'Extraordinary subsidy';
}

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
