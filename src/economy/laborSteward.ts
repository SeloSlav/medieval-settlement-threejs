import { gameClock } from '../world/gameCalendar.ts';

export const DEFAULT_SEASONAL_LABOR_STEWARD_ENABLED = false;
export const DEFAULT_CONSTRUCTION_LABOR_STEWARD_ENABLED = false;
export const DEFAULT_PRODUCTION_LABOR_STEWARD_ENABLED = false;
export const DEFAULT_LABOR_STEWARD_RESERVE = 0;
export const LABOR_STEWARD_RESERVE_OPTIONS = [0, 1, 2, 4, 6] as const;

export function normalizeLaborStewardReserve(reserve: number | undefined): number {
  if (!Number.isFinite(reserve)) return DEFAULT_LABOR_STEWARD_RESERVE;
  const rounded = Math.max(0, Math.floor(reserve ?? 0));
  return LABOR_STEWARD_RESERVE_OPTIONS.includes(
    rounded as (typeof LABOR_STEWARD_RESERVE_OPTIONS)[number],
  )
    ? rounded
    : DEFAULT_LABOR_STEWARD_RESERVE;
}

export function laborStewardReserveLabel(reserve: number): string {
  const normalized = normalizeLaborStewardReserve(reserve);
  return normalized === 0
    ? 'No reserve · maximize automatic throughput'
    : `${normalized} ${normalized === 1 ? 'villager' : 'villagers'} held for explicit orders`;
}

export function seasonalLaborStewardReviewDue(simTick: number): boolean {
  const tick = Math.max(0, Math.floor(simTick));
  return tick > 0 && gameClock(tick).totalDays > gameClock(tick - 1).totalDays;
}

export function seasonalLaborStewardStatus(
  enabled: boolean,
  staffedTownHall: boolean,
): string {
  if (!enabled) {
    return 'Manual · issue recall and call-up orders when needed';
  }
  if (!staffedTownHall) {
    return 'Enabled but paused · assign a Town Hall clerk';
  }
  return 'Daily · dormant crews release first, then active sites fill by priority';
}

export function constructionLaborStewardStatus(
  enabled: boolean,
  staffedTownHall: boolean,
): string {
  if (!enabled) {
    return 'Manual · rotate blocked and ready building crews when needed';
  }
  if (!staffedTownHall) {
    return 'Enabled but paused · assign a Town Hall clerk';
  }
  return 'Daily · blocked crews release, then ready sites fill by priority';
}

export function productionLaborStewardStatus(
  enabled: boolean,
  staffedTownHall: boolean,
): string {
  if (!enabled) {
    return 'Manual · rotate stalled and ready production crews when needed';
  }
  if (!staffedTownHall) {
    return 'Enabled but paused · assign a Town Hall clerk';
  }
  return 'Daily · stalled surplus releases, then supplied sites fill by priority';
}
