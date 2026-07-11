import { getBuildingCost } from '../buildingEconomy.ts';
import { getBuildingDefinition } from '../buildings.ts';
import { laborScaledInterval } from '../resourceTotals.ts';
import type { BuildingKind, InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingRoadAccessRow,
  buildingStorageRows,
  buildingWorkRadiusRow,
} from './buildingCommon.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';

type HarvestBuildingKind = Extract<BuildingKind, 'foragers_shed' | 'hunters_hall'>;

const HARVEST_BUILDING_COPY: Record<
  HarvestBuildingKind,
  { foragingKind: 'berries' | 'game'; idleLabel: string; activeUnit: string; patchLabel: string }
> = {
  foragers_shed: {
    foragingKind: 'berries',
    idleLabel: 'Idle — assign labor to gather berries',
    activeUnit: 'berries',
    patchLabel: 'patch',
  },
  hunters_hall: {
    foragingKind: 'game',
    idleLabel: 'Idle — assign labor to hunt game',
    activeUnit: 'game',
    patchLabel: 'trail',
  },
};

export function renderHarvestBuildingInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const copy = HARVEST_BUILDING_COPY[building.kind as HarvestBuildingKind];
  const label = context.worldQueries.getBuildingLabel(building.kind);
  const cost = getBuildingCost(building.kind);
  const definition = getBuildingDefinition(building.kind);
  const nearestNode = context.worldQueries.findNearestForagingWithRemaining(
    building.x,
    building.z,
    building.workRadius,
    copy.foragingKind,
  );
  const active = building.assignedLabor > 0 && nearestNode != null;
  const cycleSeconds = laborScaledInterval(definition.harvestInterval, building.assignedLabor);

  return {
    eyebrow: 'Building',
    title: label,
    statusText: building.assignedLabor === 0
      ? copy.idleLabel
      : nearestNode
        ? `Working — ${Math.round(nearestNode.remaining)} ${copy.activeUnit} left at ${copy.patchLabel}`
        : `Idle — no ${copy.activeUnit} in range`,
    statusState: active ? 'active' : 'idle',
    detailsHtml: `
      ${buildingCostRows(building.kind, cost)}
      ${buildingWorkRadiusRow(building.kind)}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      <li><span>Harvest interval</span><span>${building.assignedLabor > 0 ? `${cycleSeconds.toFixed(1)}s` : `${definition.harvestInterval}s`} (${building.assignedLabor} workers)</span></li>
      ${buildingStorageRows(building, building.kind)}
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor: buildingLaborView(building, context.populationStats),
  };
}
