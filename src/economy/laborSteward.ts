import { gameClock } from '../world/gameCalendar.ts';

export const DEFAULT_SEASONAL_LABOR_STEWARD_ENABLED = false;
export const DEFAULT_CONSTRUCTION_LABOR_STEWARD_ENABLED = false;

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
