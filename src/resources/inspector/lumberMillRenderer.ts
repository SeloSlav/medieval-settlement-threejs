import { getBuildingCost } from '../buildingEconomy.ts';
import { getBuildingDefinition } from '../buildings.ts';
import { laborScaledInterval } from '../resourceTotals.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  civilianToolRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingRoadAccessRow,
  buildingStorageRows,
  buildingExtentRow,
  treeCountRows,
} from './buildingCommon.ts';
import { getBuildingProcessorStatus } from './buildingProcessorStatus.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import { onsiteBuildingLabor } from '../../logistics/deliveryTrips.ts';
import { civilianToolThroughputMultiplier } from '../../economy/civilianToolPolicy.ts';

export function renderLumberMillInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building, matureTrees, stumpTrees, growingTrees } = target;
  const label = context.worldQueries.getBuildingLabel(building.kind);
  const cost = getBuildingCost(building.kind);
  const definition = getBuildingDefinition(building.kind);
  const processorStatus = getBuildingProcessorStatus(building, context.worldQueries, { matureTrees });
  const onsiteLabor = onsiteBuildingLabor(
    building,
    context.worldQueries.getActiveDeliveryTrip(building),
  );
  const cycleSeconds = laborScaledInterval(definition.harvestInterval, onsiteLabor)
    / civilianToolThroughputMultiplier(building.ironwork ?? 0);

  return {
    eyebrow: 'Building',
    title: label,
    statusText: processorStatus?.statusText ?? 'Idle',
    statusState: processorStatus?.statusState ?? 'idle',
    detailsHtml: `
      ${buildingCostRows(cost)}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      ${processorStatus?.waterDetailHtml ?? ''}
      ${civilianToolRows(building, context.worldQueries)}
      ${buildingExtentRow(building.kind)}
      <li><span>Harvest interval</span><span>${onsiteLabor > 0 ? `${cycleSeconds.toFixed(1)}s` : 'paused'} (${onsiteLabor} on site / ${building.assignedLabor} assigned)</span></li>
      ${treeCountRows(matureTrees, stumpTrees, growingTrees)}
      ${buildingStorageRows(building, building.kind)}
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor: buildingLaborView(building, context.populationStats, context.worldQueries),
  };
}
