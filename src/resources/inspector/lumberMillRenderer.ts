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
  treeCountRows,
} from './buildingCommon.ts';
import { getBuildingProcessorStatus } from './buildingProcessorStatus.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import { onsiteBuildingLabor } from '../../logistics/deliveryTrips.ts';
import { civilianToolThroughputMultiplier } from '../../economy/civilianToolPolicy.ts';
import {
  forestryWorkAreaDetailRow,
  renderForestryWorkAreaPanel,
} from './treeWorkAreaRenderer.ts';

export function renderLumberMillInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building, matureTrees, stumpTrees, growingTrees } = target;
  const label = context.worldQueries.getBuildingLabel(building.kind);
  const cost = getBuildingCost(building.kind);
  const definition = getBuildingDefinition(building.kind);
  const processorStatus = getBuildingProcessorStatus(building, context.worldQueries, { matureTrees });
  const wood = context.worldQueries.getForestryStock?.(building);
  const trip = context.worldQueries.getActiveDeliveryTrip(building);
  const forestryStatus = trip?.destinationKind === 'forestry'
    ? (trip.phase === 'inbound' ? 'Ox returning timber to camp storage' : 'Ox collecting a forest log')
    : wood?.falling ? 'Tree falling — workers stand clear'
    : wood?.fallen ? 'Workers cutting the fallen tree into logs'
    : wood?.timber ? (wood.availableOxen ? 'Logs ready — waiting for an ox crew' : 'Logs ready — purchase or assign an ox to haul timber') : null;
  const onsiteLabor = onsiteBuildingLabor(
    building,
    context.worldQueries.getActiveDeliveryTrip(building),
  );
  const cycleSeconds = laborScaledInterval(definition.harvestInterval, onsiteLabor)
    / civilianToolThroughputMultiplier(building.ironwork ?? 0);

  return {
    eyebrow: 'Building',
    title: label,
    statusText: forestryStatus ?? processorStatus?.statusText ?? 'Idle',
    statusState: forestryStatus ? (wood?.availableOxen === 0 && wood.timber > 0 ? 'warning' : 'active') : processorStatus?.statusState ?? 'idle',
    detailsHtml: `
      ${buildingCostRows(cost)}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      ${processorStatus?.waterDetailHtml ?? ''}
      ${civilianToolRows(building, context.worldQueries)}
      ${forestryWorkAreaDetailRow(building)}
      <li><span>Timber route</span><span>Tree → fallen trunk → logs → ox → camp storage → ox → Storehouse</span></li>
      ${wood ? `<li><span>Logs on the ground</span><span>${wood.logs} · ${wood.health}/${wood.maxHealth} wood health</span></li>
      <li><span>Remaining wood</span><span>${wood.timber} timber or ${wood.firewood} firewood · shared with nearby woodcutters</span></li>` : ''}
      <li><span>Harvest interval</span><span>${onsiteLabor > 0 ? `${cycleSeconds.toFixed(1)}s` : 'paused'} (${onsiteLabor} on site / ${building.assignedLabor} assigned)</span></li>
      ${treeCountRows(matureTrees, stumpTrees, growingTrees)}
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor: buildingLaborView(building, context.populationStats, context.worldQueries),
    supplementalPanelHtml: renderForestryWorkAreaPanel(building, {
      pending: context.pendingTreeWorkAreaBuildingId === building.id,
    }),
  };
}
