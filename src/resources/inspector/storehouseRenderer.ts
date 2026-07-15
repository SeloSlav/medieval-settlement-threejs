import { STOREHOUSE_OVERFLOW_THRESHOLD } from '../../generated/gameBalance.ts';
import { getBuildingCost } from '../buildingEconomy.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingRoadAccessRow,
  buildingStorageRows,
} from './buildingCommon.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';

export function renderStorehouseInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const roadAccess = context.worldQueries.getRoadAccessLabel(building.x, building.z);
  const activeTrip = context.worldQueries.getActiveDeliveryTrip(building);
  const inboundTrip = context.worldQueries.getInboundSupplyTrip(building);
  const accepted = [
    building.storehouseAcceptsTimber ? 'timber' : '',
    building.storehouseAcceptsStone ? 'stone' : '',
    building.storehouseAcceptsFirewood ? 'firewood' : '',
  ].filter(Boolean);
  const status = !roadAccess.startsWith('Connected')
    ? ['Connect to a road before haulers can collect overflow', 'warning'] as const
    : building.assignedLabor <= 0
      ? ['Assign haulers to collect producer overflow', 'warning'] as const
      : activeTrip || inboundTrip
        ? ['Haulers moving construction materials', 'active'] as const
        : accepted.length === 0
          ? ['All acceptance filters disabled', 'idle'] as const
          : ['Ready to collect producer overflow', 'ok'] as const;

  return {
    eyebrow: 'Settlement logistics',
    title: context.worldQueries.getBuildingLabel(building.kind),
    statusText: status[0],
    statusState: status[1],
    detailsHtml: `
      ${buildingCostRows(building.kind, getBuildingCost(building.kind))}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      <li><span>Role</span><span>Collects surplus construction materials from road-linked producers</span></li>
      <li><span>Collection trigger</span><span>Producer stock above ${Math.round(STOREHOUSE_OVERFLOW_THRESHOLD * 100)}%</span></li>
      <li><span>Accepted cargo</span><span>${accepted.join(', ') || 'None'}</span></li>
      <li><span>Food policy</span><span>Never accepted — granaries remain specialized</span></li>
      <li><span>Market role</span><span>No retail or regional trade</span></li>
      <li><span>Hauling</span><span>${activeTrip || inboundTrip ? 'Trip in progress' : 'Awaiting overflow'}</span></li>
      ${buildingStorageRows(building, building.kind)}
    `,
    demolish: { visible: true, hint: buildingDemolishHint(building.kind) },
    labor: buildingLaborView(building, context.populationStats),
    supplementalPanelHtml: `
      <div class="inspector-action-panel">
        <p class="inspector-action-panel__hint">Choose which non-food materials haulers may collect. Construction automatically uses staged storehouse stock first.</p>
        ${acceptanceToggle('timber', 'Timber', building.storehouseAcceptsTimber)}
        ${acceptanceToggle('stone', 'Stone', building.storehouseAcceptsStone)}
        ${acceptanceToggle('firewood', 'Firewood', building.storehouseAcceptsFirewood)}
      </div>
    `,
  };
}

function acceptanceToggle(key: 'timber' | 'stone' | 'firewood', label: string, checked: boolean): string {
  return `<label class="city-admin-panel__toggle"><input type="checkbox" data-storehouse-accepts-${key} ${checked ? 'checked' : ''} /><span>Accept ${label}</span></label>`;
}
