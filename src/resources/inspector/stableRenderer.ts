import {
  STABLE_OX_PURCHASE_GOLD,
  STABLE_OX_SLOTS,
} from '../../generated/gameBalance.ts';
import { fireForTarget } from '../../fires/fireIncident.ts';
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
      ? ['Three oxen housed · automatic dispatch active', 'ok'] as const
      : housed > 0
        ? [`${housed} ${housed === 1 ? 'ox' : 'oxen'} housed · ${openSlots} ${openSlots === 1 ? 'bay' : 'bays'} open`, 'active'] as const
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

  const slotIndicators = Array.from({ length: STABLE_OX_SLOTS }, (_, slot) => {
    const ox = occupiedSlots.get(slot);
    return `<li class="stable-ox-slot" data-stable-ox-slot="${slot}" data-state="${ox ? 'occupied' : 'open'}">
      <span class="stable-ox-slot__badge" aria-hidden="true">${ox ? 'OX' : '+'}</span>
      <span class="stable-ox-slot__copy"><strong>Bay ${BAY_LABELS[slot] ?? slot + 1}</strong><small>${ox ? 'Ox housed · dispatch ready' : 'Open stall'}</small></span>
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
      <li><span>Assignment</span><span>Automatic · oxen cannot be assigned individually</span></li>
      <li><span>Work effect</span><span>One eligible worker receives one ox; production yield or hauling inventory is doubled</span></li>
      <li><span>Upkeep</span><span>Feed and water are abstracted · stable oxen never draw herd hay or grain</span></li>
      <li><span>Resting</span><span>Idle oxen return to their authored stable bays</span></li>
    `,
    supplementalPanelHtml: `
      <div class="inspector-action-panel stable-ox-panel" data-inspector-panel-title="Ox team">
        <p class="resource-inspector-note">The dispatcher pairs housed oxen with useful active work. Productive crews and haulers are considered automatically; unneeded oxen rest here.</p>
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
