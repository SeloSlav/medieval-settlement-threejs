import { getBuildingCost } from '../buildingEconomy.ts';
import type { InspectableTarget } from '../types.ts';
import { freshFoodStock, preservedFoodStock } from '../../economy/foodInventory.ts';
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
import { fireDisabledBuildingIds } from '../../fires/fireIncident.ts';
import { LOCAL_MARKET_TAX_CART_THRESHOLD } from '../../generated/gameBalance.ts';

export function renderMarketStallsInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const fireDisabled = fireDisabledBuildingIds(context.gameState.fireIncidents.values());
  const connected = [...context.gameState.buildings.values()].filter((candidate) =>
    candidate.constructionComplete !== false
    && candidate.assignedLabor > 0
    && !fireDisabled.has(candidate.id)
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
    freshFoodStock(building) + Math.max(0, building.honey),
    preservedFoodStock(building),
    building.ale,
    building.firewood,
    building.cloth,
    building.pottery,
    building.remedies,
  ].filter((stock) => (stock ?? 0) > 1e-6).length;
  const taxCartActive = activeTrip?.cargoKind === 'gold'
    && activeTrip.destinationKind === 'building';
  const heldTax = Math.max(0, building.gold ?? 0);

  return {
    eyebrow: 'Building',
    title: context.worldQueries.getBuildingLabel(building.kind),
    statusText: totalStalls <= 0
      ? 'Empty square — staff a road-linked granary or storehouse to open stalls'
      : taxCartActive
        ? `${heldTax.toFixed(1)} tax gold remains — a free hauler is carrying the current lockbox load`
      : activeTrip
        ? `${totalStalls} active stalls — a remedy or lockbox cart is on the road`
        : `${totalStalls} active stalls stocking ${stockedNeeds} household need ${stockedNeeds === 1 ? 'category' : 'categories'}`,
    statusState: totalStalls > 0 ? 'active' : 'idle',
    detailsHtml: `
      ${buildingCostRows(building.kind, getBuildingCost(building.kind))}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      ${buildingStorageRows(building, building.kind, context.conflictEnabled ?? false)}
      <li><span>Purpose</span><span>Shared local household exchange — it has no employees of its own</span></li>
      <li><span>Food stalls</span><span>${foodStalls} from staffed Granaries · pooled backyard and stored food, cured provisions, and ale</span></li>
      <li><span>Goods stalls</span><span>${goodsStalls} from staffed Village Storehouses · firewood, cloth, pottery, and shared herb remedies</span></li>
      <li><span>Distribution</span><span>Stock is allocated instantly to connected homes · nearest plots receive scarce goods first · no routine household cart</span></li>
      <li><span>Capacity rule</span><span>Assigned granary and storehouse workers replenish and operate stalls without leaving on last-mile household trips</span></li>
      <li><span>Backyard exchange</span><span>Edible surplus becomes physical stall stock for abstract household allocation; herb remedies retain targeted care carts</span></li>
      <li><span>Local tax lockbox</span><span>${heldTax.toFixed(1)} gold held${taxCartActive ? ' · collection cart active' : heldTax + 1e-6 >= LOCAL_MARKET_TAX_CART_THRESHOLD ? ' · waiting for a free hauler to the civic treasury' : heldTax > 1e-6 ? ` · batching toward ${LOCAL_MARKET_TAX_CART_THRESHOLD.toFixed(0)} gold or the evening sweep` : ''}</span></li>
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
