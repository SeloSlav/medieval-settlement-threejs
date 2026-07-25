import { CALENDAR_SECONDS_PER_DAY, SIM_TICK_SECONDS } from '../generated/gameBalance.ts';
import type { SettlementSecurity } from '../generated/types.ts';
import type { BuildingState, GameState } from '../resources/types.ts';
import type { WorldGenerationSettings } from '../world/worldGenerationSettings.ts';

export type SettlementSecurityState = {
  threat: number;
  coverage: number;
  protectedValue: number;
  totalValue: number;
  staffedWatchtowers: number;
  readyGuards: number;
  defenseReadiness: number;
  nextRaidTick: number;
  lastRaidTick: number;
  lastOutcome: 'none' | 'averted' | 'plundered';
  lastGoodsLost: number;
  lastWealthLost: number;
};

export const DEFAULT_SETTLEMENT_SECURITY: SettlementSecurityState = {
  threat: 0,
  coverage: 0,
  protectedValue: 0,
  totalValue: 0,
  staffedWatchtowers: 0,
  readyGuards: 0,
  defenseReadiness: 0,
  nextRaidTick: 0,
  lastRaidTick: 0,
  lastOutcome: 'none',
  lastGoodsLost: 0,
  lastWealthLost: 0,
};

export function settlementSecurityFromRow(row: SettlementSecurity): SettlementSecurityState {
  return {
    threat: clamp01(row.threat),
    coverage: clamp01(row.coverage),
    protectedValue: Math.max(0, row.protectedValue),
    totalValue: Math.max(0, row.totalValue),
    staffedWatchtowers: Math.max(0, row.staffedWatchtowers),
    readyGuards: Math.max(0, row.readyGuards),
    defenseReadiness: clamp01(row.defenseReadiness),
    nextRaidTick: Number(row.nextRaidTick),
    lastRaidTick: Number(row.lastRaidTick),
    lastOutcome: row.lastOutcome === 2 ? 'plundered' : row.lastOutcome === 1 ? 'averted' : 'none',
    lastGoodsLost: Math.max(0, row.lastGoodsLost),
    lastWealthLost: Math.max(0, row.lastWealthLost),
  };
}

export function frontierThreatLabel(
  security: SettlementSecurityState,
  settings: Pick<WorldGenerationSettings, 'conflictMode'> | null,
): string {
  if (settings?.conflictMode !== 'frontier') return 'Peaceful settlement';
  if (security.nextRaidTick <= 0) return 'Frontier quiet';
  if (security.threat >= 0.9) return 'Incursion imminent';
  if (security.threat >= 0.7) return 'Raiders reported';
  if (security.threat >= 0.4) return 'Frontier unrest';
  return 'Frontier watch';
}

export function estimatedRaidDays(
  security: SettlementSecurityState,
  simTick: number,
): number | null {
  if (security.nextRaidTick <= 0) return null;
  const ticksRemaining = Math.max(0, security.nextRaidTick - simTick);
  return ticksRemaining * SIM_TICK_SECONDS / CALENDAR_SECONDS_PER_DAY;
}

export function formatRaidReport(security: SettlementSecurityState): string {
  if (security.lastOutcome === 'averted') {
    return security.readyGuards > 0
      ? 'Watch bells mustered the paid guards and the incursion was turned away.'
      : 'Watch bells scattered the raiders before stores were reached.';
  }
  if (security.lastOutcome === 'plundered') {
    const goods = Math.round(security.lastGoodsLost);
    const wealth = Math.round(security.lastWealthLost);
    const losses = [
      goods > 0 ? `${goods} portable goods` : '',
      wealth > 0 ? `${wealth} gold in household and parish wealth` : '',
    ].filter(Boolean);
    return `Raiders struck exposed holdings and took ${losses.join(' and ') || 'minor stores'}.`;
  }
  return 'No incursion has reached the settlement.';
}

export function watchtowerEffectiveRadius(tower: BuildingState): number {
  if (tower.kind !== 'watchtower' || !tower.constructionComplete || tower.assignedLabor <= 0) {
    return 0;
  }
  return tower.assignedLabor === 1 ? tower.workRadius * 0.78 : tower.workRadius;
}

export function countSitesProtectedByWatchtower(
  tower: BuildingState,
  gameState: GameState,
): { buildings: number; homes: number; residents: number } {
  const radius = watchtowerEffectiveRadius(tower);
  if (radius <= 0) return { buildings: 0, homes: 0, residents: 0 };
  const radiusSquared = radius * radius;
  let buildings = 0;
  let homes = 0;
  let residents = 0;
  for (const building of gameState.buildings.values()) {
    if (building.id === tower.id || !building.constructionComplete) continue;
    if (distanceSquared(tower, building) <= radiusSquared) buildings += 1;
  }
  for (const residence of gameState.residences.values()) {
    if (residence.abandoned || residence.population <= 0) continue;
    if (distanceSquared(tower, residence) > radiusSquared) continue;
    homes += 1;
    residents += residence.population;
  }
  return { buildings, homes, residents };
}

function distanceSquared(
  a: Pick<BuildingState, 'x' | 'z'>,
  b: { x: number; z: number },
): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
