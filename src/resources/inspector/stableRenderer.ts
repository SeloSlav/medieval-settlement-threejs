import {
  STABLE_OX_PURCHASE_GOLD,
  STABLE_OX_SLOTS,
} from '../../generated/gameBalance.ts';
import { fireDisabledBuildingIds, fireForTarget } from '../../fires/fireIncident.ts';
import { assignStableOxen } from '../../settlement/stableOxen.ts';
import { renderResourceAmount } from '../../ui/resourceCost.ts';
import { getBuildingCost } from '../buildingEconomy.ts';
import type { InspectableTarget, StableOxState } from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingExtentRow,
  buildingRoadAccessRow,
} from './buildingCommon.ts';
import {
  hiddenLabor,
  type InspectorRenderContext,
  type InspectorView,
} from './renderInspectableTarget.ts';

const BAY_LABELS = ['I', 'II', 'III'] as const;

export function renderStableInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const oxen = [...context.gameState.stableOxen.values()]
    .filter((ox) => ox.stableId === building.id)
    .sort((left, right) => left.slot - right.slot || left.id.localeCompare(right.id));
  const occupiedSlots = new Map<number, StableOxState>();
  for (const ox of oxen) {
    if (ox.slot >= 0 && ox.slot < STABLE_OX_SLOTS && !occupiedSlots.has(ox.slot)) {
      occupiedSlots.set(ox.slot, ox);
    }
  }

  const housed = occupiedSlots.size;
  const posted = [...occupiedSlots.values()]
    .filter((ox) => ox.assignedBuildingId != null)
    .length;
  const automaticPool = housed - posted;
  const openSlots = Math.max(0, STABLE_OX_SLOTS - housed);
  const treasuryGold = Math.max(0, context.resourceTotals.gold);
  const fire = fireForTarget(
    context.gameState.fireIncidents.values(),
    'building',
    building.id,
  );
  const atCapacity = openSlots === 0;
  const treasuryShort = treasuryGold + 1e-6 < STABLE_OX_PURCHASE_GOLD;
  const purchaseDisabled = atCapacity || treasuryShort || fire !== null;

  const status = fire
    ? ['Dispatch suspended during fire recovery', 'warning'] as const
    : atCapacity
      ? [`Three oxen housed · ${posted} posted, ${automaticPool} automatic`, 'ok'] as const
      : housed > 0
        ? [`${housed} ${housed === 1 ? 'ox' : 'oxen'} housed · ${posted} posted, ${automaticPool} automatic`, 'active'] as const
        : treasuryShort
          ? ['Stable empty · treasury cannot fund an ox', 'warning'] as const
          : ['Stable ready · three ox bays open', 'idle'] as const;

  const purchaseHint = fire
    ? 'Purchases resume after the stable is repaired.'
    : atCapacity
      ? 'All three authored bays are occupied.'
      : treasuryShort
        ? `${renderResourceAmount('gold', STABLE_OX_PURCHASE_GOLD - treasuryGold, { compact: true })} more civic gold is required.`
        : `${openSlots} ${openSlots === 1 ? 'bay remains' : 'bays remain'} after this order.`;

  const haulingOxIds = new Set(
    [...context.gameState.deliveryTrips.values()]
      .map((trip) => trip.oxId)
      .filter((oxId): oxId is string => oxId != null),
  );
  const activeAssignments = assignStableOxen(
    context.gameState.stableOxen.values(),
    context.gameState.buildings,
    context.gameState.deliveryTrips.values(),
    fireDisabledBuildingIds(context.gameState.fireIncidents.values()),
  );
  const slotIndicators = Array.from({ length: STABLE_OX_SLOTS }, (_, slot) => {
    const ox = occupiedSlots.get(slot);
    const hauling = ox ? haulingOxIds.has(ox.id) : false;
    const assignedBuilding = ox?.assignedBuildingId == null
      ? null
      : context.gameState.buildings.get(ox.assignedBuildingId) ?? null;
    const assignmentActive = ox != null
      && activeAssignments.get(ox.id)?.buildingId === ox.assignedBuildingId;
    const assignedLabel = assignedBuilding == null
      ? 'workplace'
      : context.worldQueries.getBuildingLabel(assignedBuilding.kind);
    const assignmentLabel = !ox
      ? 'Open stall'
      : ox.assignedBuildingId == null
        ? hauling ? 'Automatic pool · hauling now' : 'Automatic assistance pool'
        : hauling
          ? `Posted to ${assignedLabel} · hauling now`
          : assignmentActive
            ? `Posted to ${assignedLabel} · active with a worker`
            : `Posted to ${assignedLabel} · waiting for labor`;
    return `<li class="stable-ox-slot" data-stable-ox-slot="${slot}" data-state="${ox ? 'occupied' : 'open'}">
      <span class="stable-ox-slot__badge" aria-hidden="true">${ox ? 'OX' : '+'}</span>
      <span class="stable-ox-slot__copy"><strong>Bay ${BAY_LABELS[slot] ?? slot + 1}</strong><small>${assignmentLabel}</small></span>
    </li>`;
  }).join('');

  return {
    eyebrow: 'Civic draft power',
    title: context.worldQueries.getBuildingLabel(building.kind),
    statusText: status[0],
    statusState: status[1],
    detailsHtml: `
      ${buildingCostRows(getBuildingCost(building.kind))}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      ${buildingExtentRow(building.kind)}
      <li data-inspector-primary><span>Draft team</span><span>${housed} / ${STABLE_OX_SLOTS} oxen · ${openSlots} open ${openSlots === 1 ? 'bay' : 'bays'}</span></li>
      <li><span>Posting</span><span>${posted} posted until changed · ${automaticPool} in the automatic assistance pool</span></li>
      <li><span>Controls</span><span>Set posted counts from any eligible workplace card</span></li>
      <li><span>Work effect</span><span>Ox postings are separate from human labor slots · one ox pairs with one present worker; exact stage effects appear on the workplace card</span></li>
      <li><span>Upkeep</span><span>Feed and water are abstracted · stable oxen never draw herd hay or Animal Feed</span></li>
      <li><span>Resting</span><span>Idle oxen return to their authored stable bays</span></li>
    `,
    supplementalPanelHtml: `
      <div class="inspector-action-panel stable-ox-panel" data-inspector-panel-title="Ox team">
        <p class="resource-inspector-note">Post oxen persistently from an eligible workplace card. Posted oxen wait here whenever no laborer is available; every unposted ox remains in the automatic assistance pool.</p>
        <ol class="stable-ox-slots" aria-label="Stable ox bays">${slotIndicators}</ol>
        <div class="resource-action-row">
          <button type="button" class="resource-action-button" data-purchase-ox aria-label="Purchase one stable ox for ${STABLE_OX_PURCHASE_GOLD} gold" ${purchaseDisabled ? 'disabled' : ''}>Buy ox · ${renderResourceAmount('gold', STABLE_OX_PURCHASE_GOLD, { compact: true })}</button>
        </div>
        <p class="inspector-action-panel__hint">${purchaseHint} Treasury: ${renderResourceAmount('gold', treasuryGold, { compact: true })}. Each purchase permanently occupies the first open bay.</p>
      </div>
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor: hiddenLabor(),
  };
}
