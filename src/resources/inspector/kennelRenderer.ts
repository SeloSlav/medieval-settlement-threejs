import {
  KENNEL_DOG_PURCHASE_GOLD,
  KENNEL_DOG_SLOTS,
} from '../../generated/gameBalance.ts';
import { fireForTarget } from '../../fires/fireIncident.ts';
import { encodeResourceCostTooltip, renderResourceAmount } from '../../ui/resourceCost.ts';
import { getBuildingCost } from '../buildingEconomy.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingExtentRow,
  buildingLaborView,
  buildingRoadAccessRow,
} from './buildingCommon.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';

const DOG_FACTION = 'dog';

export function renderKennelInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const dogs = [...(context.combatAgents ?? [])]
    .filter((agent) => agent.faction === DOG_FACTION && agent.sourceBuildingId === building.id)
    .sort((left, right) => left.sourceSlot - right.sourceSlot);
  const occupied = new Map(dogs.map((dog) => [dog.sourceSlot, dog]));
  const housed = occupied.size;
  const assigned = dogs.filter((dog) => dog.assignedBuildingId != null).length;
  const free = housed - assigned;
  const openSlots = Math.max(0, KENNEL_DOG_SLOTS - housed);
  const staffed = building.assignedLabor > 0;
  const fire = fireForTarget(context.gameState.fireIncidents.values(), 'building', building.id);
  const treasuryGold = Math.max(0, context.resourceTotals.gold);
  const treasuryShort = treasuryGold + 1e-6 < KENNEL_DOG_PURCHASE_GOLD;
  const atCapacity = openSlots === 0;
  const disabled = !staffed || fire !== null || treasuryShort || atCapacity;
  const nextOpenSlot = Array.from({ length: KENNEL_DOG_SLOTS }, (_, slot) => slot)
    .find((slot) => !occupied.has(slot)) ?? -1;
  const unavailable = fire
    ? 'Repair the kennel before purchasing dogs.'
    : !staffed
      ? 'Assign one kennel keeper before purchasing dogs.'
      : atCapacity
        ? 'All four dog bays are occupied.'
        : treasuryShort
          ? `${Math.ceil(KENNEL_DOG_PURCHASE_GOLD - treasuryGold)} more gold is required.`
          : 'The new dog will begin an autonomous settlement patrol.';
  const costTooltip = encodeResourceCostTooltip({ gold: KENNEL_DOG_PURCHASE_GOLD });
  const slots = Array.from({ length: KENNEL_DOG_SLOTS }, (_, slot) => {
    const dog = occupied.get(slot);
    const assignedBuilding = dog?.assignedBuildingId
      ? context.gameState.buildings.get(dog.assignedBuildingId) ?? null
      : null;
    const duty = assignedBuilding
      ? `Hunting at ${context.worldQueries.getBuildingLabel(assignedBuilding.kind)}`
      : 'Free settlement patrol';
    if (slot === nextOpenSlot) {
      return `<li class="stable-ox-slot" data-kennel-dog-slot="${slot}" data-state="purchase">
        <button type="button" class="resource-action-button stable-ox-slot__purchase" data-purchase-dog
          data-tooltip-title="Purchase guard dog" data-tooltip="${unavailable}"
          data-tooltip-cost="${costTooltip}" data-tooltip-cost-label="Gold cost"
          data-tooltip-cost-affordable="${!treasuryShort}"
          aria-label="Purchase a guard dog for ${KENNEL_DOG_PURCHASE_GOLD} gold. ${unavailable}" ${disabled ? 'aria-disabled="true"' : ''}>
          <span class="stable-ox-slot__frame" aria-hidden="true"><span class="stable-ox-slot__plus"></span><span class="stable-ox-slot__portrait"></span></span>
        </button>
      </li>`;
    }
    return `<li class="stable-ox-slot" data-kennel-dog-slot="${slot}" data-state="${dog ? 'occupied' : 'waiting'}" aria-label="${dog ? `Guard dog ${slot + 1}: ${duty}; ${dog.status}.` : 'Open dog bay.'}">
      <span class="stable-ox-slot__frame" aria-hidden="true"><span class="stable-ox-slot__plus"></span><span class="stable-ox-slot__portrait"></span></span>
    </li>`;
  }).join('');

  const status = fire
    ? ['Patrols continue; kennel purchases paused during repairs', 'warning'] as const
    : !staffed
      ? ['Kennel unstaffed · assign one keeper', 'warning'] as const
      : housed > 0
        ? [`${housed} guard ${housed === 1 ? 'dog' : 'dogs'} patrolling`, 'active'] as const
        : ['Kennel ready · four dog bays open', 'idle'] as const;
  return {
    eyebrow: 'Settlement security',
    title: context.worldQueries.getBuildingLabel(building.kind),
    statusText: status[0],
    statusState: status[1],
    detailsHtml: `
      ${buildingCostRows(getBuildingCost(building.kind))}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      ${buildingExtentRow(building.kind)}
      <li data-inspector-primary><span>Guard dogs</span><span>${housed} / ${KENNEL_DOG_SLOTS} · ${openSlots} open</span></li>
      <li><span>Assignments</span><span>${assigned} hunting · ${free} free patrol</span></li>
      <li><span>Patrol</span><span>Free dogs cover roads, homes, and civic stores · autonomous</span></li>
      <li><span>Response</span><span>Singles out raiders, bandits, foxes, and wolves</span></li>
      <li><span>Keeper</span><span>At least one assigned worker is required for purchases</span></li>
    `,
    supplementalPanelHtml: `<div class="inspector-action-panel stable-ox-panel" data-inspector-panel-title="Dog team">
      <p class="resource-inspector-note">Dogs persist as individually selectable guard agents with health, patrol routes, and combat behavior.</p>
      <ol class="stable-ox-slots" aria-label="Kennel dog bays">${slots}</ol>
      <p class="inspector-action-panel__hint">${unavailable} Civic treasury: ${renderResourceAmount('gold', treasuryGold, { compact: true })}.</p>
    </div>`,
    demolish: { visible: true, hint: buildingDemolishHint(building.kind) },
    labor: buildingLaborView(building, context.populationStats, context.worldQueries),
  };
}
