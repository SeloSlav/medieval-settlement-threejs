import {
  residenceHasActiveProject,
  type BuildingState,
  type ResidenceState,
} from '../resources/types.ts';

export const RESIDENCE_UPGRADE_WORKPLACE_PREFIX = 'residence-upgrade:';

export function isResidenceUpgradeWorkplaceId(id: string): boolean {
  return id.startsWith(RESIDENCE_UPGRADE_WORKPLACE_PREFIX);
}

export function residenceIdForUpgradeWorkplace(id: string): string | null {
  return isResidenceUpgradeWorkplaceId(id)
    ? id.slice(RESIDENCE_UPGRADE_WORKPLACE_PREFIX.length)
    : null;
}

/**
 * Client-only workplaces let the ordinary villager roster render the one
 * authoritative builder assigned to each household project. They never enter
 * game state, placement, resource totals, or server synchronization.
 */
export function residenceUpgradeWorkplaces(
  residences: readonly ResidenceState[],
): BuildingState[] {
  const workplaces: BuildingState[] = [];
  for (const residence of residences) {
    const assignedLabor = Math.max(0, Math.min(1, Math.floor(
      residence.upgradeAssignedLabor ?? 0,
    )));
    if (!residenceHasActiveProject(residence) || assignedLabor === 0) {
      continue;
    }
    workplaces.push({
      id: `${RESIDENCE_UPGRADE_WORKPLACE_PREFIX}${residence.id}`,
      kind: 'carpenter',
      x: residence.x,
      z: residence.z,
      workRadius: 6.5,
      actionCooldown: 0,
      timber: 0,
      firewood: 0,
      stone: 0,
      water: 0,
      food: 0,
      ale: 0,
      preservedFood: 0,
      honey: 0,
      wine: 0,
      wool: 0,
      cloth: 0,
      ironwork: 0,
      polearms: 0,
      gold: 0,
      waterCapacity: 0,
      assignedLabor,
      constructionComplete: false,
      constructionProgress: residence.upgradeProgress ?? 0,
      constructionRequiredTimber: residence.upgradeRequiredTimber ?? 0,
      constructionRequiredStone: residence.upgradeRequiredStone ?? 0,
      constructionDeliveredTimber: residence.upgradeDeliveredTimber ?? 0,
      constructionDeliveredStone: residence.upgradeDeliveredStone ?? 0,
      constructionReservedTimber: residence.upgradeReservedTimber ?? 0,
      constructionReservedStone: residence.upgradeReservedStone ?? 0,
      constructionTreasuryTimber: 0,
      constructionTreasuryStone: 0,
      storehouseAcceptsTimber: false,
      storehouseAcceptsStone: false,
      storehouseAcceptsFirewood: false,
      constructionPriority: residence.upgradePriority ?? 2,
    });
  }
  return workplaces;
}
