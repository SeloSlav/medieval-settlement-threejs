import { getBuildingCost } from '../buildingEconomy.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingRoadAccessRow,
  buildingStorageRows,
} from './buildingCommon.ts';
import {
  hiddenLabor,
  type InspectorRenderContext,
  type InspectorView,
} from './renderInspectableTarget.ts';

export function renderMarketStallsInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const connected = [...context.gameState.buildings.values()].filter((candidate) =>
    candidate.constructionComplete !== false
    && candidate.assignedLabor > 0
    && (candidate.kind === 'granary' || candidate.kind === 'village_storehouse')
    && context.worldQueries.getRoadPathDistance(
      candidate.x,
      candidate.z,
      building.x,
      building.z,
    ) != null
  );
  const foodStalls = connected
    .filter((candidate) => candidate.kind === 'granary')
    .reduce((sum, candidate) => sum + candidate.assignedLabor, 0);
  const goodsStalls = connected
    .filter((candidate) => candidate.kind === 'village_storehouse')
    .reduce((sum, candidate) => sum + candidate.assignedLabor, 0);
  const totalStalls = foodStalls + goodsStalls;
  const activeTrip = context.worldQueries.getActiveDeliveryTrip(building);
  const stockedNeeds = [
    building.food,
    building.preservedFood,
    building.ale,
    building.firewood,
    building.cloth,
    building.pottery,
  ].filter((stock) => (stock ?? 0) > 1e-6).length;

  return {
    eyebrow: 'Building',
    title: context.worldQueries.getBuildingLabel(building.kind),
    statusText: totalStalls <= 0
      ? 'Empty square — staff a road-linked granary or storehouse to open stalls'
      : activeTrip
        ? `${totalStalls} active stalls — a stallholder is serving a household`
        : `${totalStalls} active stalls stocking ${stockedNeeds} household need ${stockedNeeds === 1 ? 'category' : 'categories'}`,
    statusState: totalStalls > 0 ? 'active' : 'idle',
    detailsHtml: `
      ${buildingCostRows(building.kind, getBuildingCost(building.kind))}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      ${buildingStorageRows(building, building.kind, context.conflictEnabled ?? false)}
      <li><span>Purpose</span><span>Shared household market — it has no employees of its own</span></li>
      <li><span>Food stalls</span><span>${foodStalls} from staffed granaries · food, cured provisions, and ale</span></li>
      <li><span>Goods stalls</span><span>${goodsStalls} from staffed storehouses · firewood, cloth, and pottery</span></li>
      <li><span>Capacity rule</span><span>Each assigned granary or storehouse worker supports one active stall and its household cart capacity</span></li>
      <li><span>Water</span><span>Supplied independently from unstaffed wells</span></li>
      <li><span>Regional trade</span><span>Handled only by a staffed Trading Post</span></li>
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor: hiddenLabor(),
  };
}
