import { getBuildingCost } from '../buildingEconomy.ts';
import {
  GUARDHOUSE_FOOD_PER_GUARD_PER_DAY,
  GUARDHOUSE_WAGE_PER_GUARD_PER_DAY,
} from '../../generated/gameBalance.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingRoadAccessRow,
  buildingStorageRows,
} from './buildingCommon.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';

export function renderGuardhouseInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const armed = Math.min(building.assignedLabor, Math.floor(building.polearms ?? 0));
  const readiness = Math.max(0, Math.min(1, building.actionCooldown));
  const ready = armed * readiness;
  const settlement = context.getSettlementSecurity?.();

  const status = building.assignedLabor <= 0
    ? ['Unstaffed — no guards can muster', 'warning'] as const
    : armed <= 0
      ? ['Unarmed — awaiting carpenter-made polearms', 'warning'] as const
      : building.food < armed * GUARDHOUSE_FOOD_PER_GUARD_PER_DAY
        ? ['Short on provisions — readiness is falling', 'warning'] as const
        : context.resourceTotals.gold < armed * GUARDHOUSE_WAGE_PER_GUARD_PER_DAY
          ? ['Wages at risk — readiness is falling', 'warning'] as const
          : readiness < 0.99
            ? ['Drilling and mustering', 'active'] as const
            : ['Guard company ready', 'ok'] as const;

  return {
    eyebrow: 'Frontier defense',
    title: context.worldQueries.getBuildingLabel(building.kind),
    statusText: status[0],
    statusState: status[1],
    detailsHtml: `
      ${buildingCostRows(building.kind, getBuildingCost(building.kind))}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      <li><span>Role</span><span>Paid local guard company mustered by the watch</span></li>
      <li><span>Armed guards</span><span>${armed} / ${building.assignedLabor} assigned</span></li>
      <li><span>Local readiness</span><span>${Math.round(readiness * 100)}% · ${ready.toFixed(1)} ready</span></li>
      <li><span>Settlement defense</span><span>${(settlement?.readyGuards ?? ready).toFixed(1)} guards ready</span></li>
      <li><span>Daily upkeep</span><span>${(armed * GUARDHOUSE_FOOD_PER_GUARD_PER_DAY).toFixed(1)} food · ${(armed * GUARDHOUSE_WAGE_PER_GUARD_PER_DAY).toFixed(1)} gold</span></li>
      <li><span>Supply chain</span><span>Food by road · polearms from a staffed carpenter</span></li>
      ${buildingStorageRows(building, building.kind)}
    `,
    demolish: { visible: true, hint: buildingDemolishHint(building.kind) },
    labor: buildingLaborView(building, context.populationStats),
  };
}
