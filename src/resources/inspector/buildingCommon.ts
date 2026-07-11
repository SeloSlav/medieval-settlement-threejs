import type { BuildingResourceCost } from '../buildingEconomy.ts';
import {
  buildingSalvageRefund,
  formatBuildingCost,
  getBuildingCost,
  STONE_SALVAGE_FRACTION,
  TIMBER_SALVAGE_FRACTION,
} from '../buildingEconomy.ts';
import { getBuildingDefinition } from '../buildings.ts';
import type { BuildingKind, BuildingState } from '../types.ts';
import {
  buildingAcceptsLabor,
  buildingMaxLabor,
  buildingStorageCaps,
  maxAssignableLabor,
  type PopulationStats,
} from '../resourceTotals.ts';
import type { WorldQueries } from '../WorldQueries.ts';
import type { InspectorLaborView } from './renderInspectableTarget.ts';

export function buildingStorageRows(building: BuildingState, kind: BuildingKind): string {
  const caps = buildingStorageCaps(kind);
  return [
    caps.timber > 0 ? `<li><span>Timber stored</span><span>${Math.round(building.timber)} / ${caps.timber}</span></li>` : '',
    caps.firewood > 0 ? `<li><span>Firewood stored</span><span>${Math.round(building.firewood)} / ${caps.firewood}</span></li>` : '',
    caps.stone > 0 ? `<li><span>Stone stored</span><span>${Math.round(building.stone)} / ${caps.stone}</span></li>` : '',
    caps.water != null && caps.water > 0 ? `<li><span>Water stored</span><span>${Math.round(building.water)} / ${caps.water}</span></li>` : '',
    caps.food != null && caps.food > 0 ? `<li><span>Food stored</span><span>${Math.round(building.food)} / ${caps.food}</span></li>` : '',
  ].filter(Boolean).join('');
}

export function buildingRoadAccessRow(worldQueries: WorldQueries, building: BuildingState): string {
  const roadAccess = worldQueries.getRoadAccessLabel(building.x, building.z);
  return `<li><span>Road access</span><span>${roadAccess}</span></li>`;
}

export function buildingDemolishHint(kind: BuildingKind): string {
  const cost = getBuildingCost(kind);
  const refund = buildingSalvageRefund(kind);
  return `Salvages about ${refund.timber} timber and ${refund.stone} stone (${Math.round(STONE_SALVAGE_FRACTION * 100)}% stone, ${Math.round(TIMBER_SALVAGE_FRACTION * 100)}% timber of ${formatBuildingCost(cost)}).`;
}

export function buildingLaborView(
  building: BuildingState,
  populationStats: PopulationStats,
): InspectorLaborView {
  if (!buildingAcceptsLabor(building.kind)) {
    return {
      visible: false,
      count: 0,
      hint: '',
      decreaseDisabled: true,
      increaseDisabled: true,
    };
  }

  const maxLabor = maxAssignableLabor(building, populationStats);
  const buildingCap = buildingMaxLabor(building.kind);
  return {
    visible: true,
    count: building.assignedLabor,
    hint: `${building.assignedLabor}/${buildingCap} workers here · ${populationStats.available} available (${populationStats.total} population, ${populationStats.assigned} assigned).`,
    decreaseDisabled: building.assignedLabor <= 0,
    increaseDisabled: building.assignedLabor >= maxLabor,
  };
}

export function buildingCostRows(kind: BuildingKind, cost: BuildingResourceCost): string {
  return `
    <li><span>Kind</span><span>${kind}</span></li>
    <li><span>Build cost</span><span>${formatBuildingCost(cost)}</span></li>
  `;
}

export function buildingWorkRadiusRow(kind: BuildingKind): string {
  const definition = getBuildingDefinition(kind);
  return `<li><span>Work radius</span><span>${definition.workRadius} m</span></li>`;
}

export function treeCountRows(matureTrees: number, stumpTrees: number, growingTrees: number): string {
  return `
    <li><span>Mature trees</span><span>${matureTrees}</span></li>
    <li><span>Stumps</span><span>${stumpTrees}</span></li>
    <li><span>Growing saplings</span><span>${growingTrees}</span></li>
  `;
}
