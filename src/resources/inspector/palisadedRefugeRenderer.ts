import { fireDisabledBuildingIds } from '../../fires/fireIncident.ts';
import {
  countHouseholdsShelteredByPalisadedRefuge,
  DEFAULT_SETTLEMENT_SECURITY,
  palisadedRefugeEffectiveRadius,
  palisadedRefugeHouseholdLossFraction,
} from '../../security/frontierSecurity.ts';
import { getBuildingCost } from '../buildingEconomy.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingRoadAccessRow,
} from './buildingCommon.ts';
import {
  hiddenLabor,
  type InspectorRenderContext,
  type InspectorView,
} from './renderInspectableTarget.ts';

export function renderPalisadedRefugeInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const security =
    context.getSettlementSecurity?.() ?? DEFAULT_SETTLEMENT_SECURITY;
  const fireDisabled = fireDisabledBuildingIds(
    context.gameState.fireIncidents.values(),
  ).has(building.id);
  const radius = palisadedRefugeEffectiveRadius(building, fireDisabled);
  const sheltered = countHouseholdsShelteredByPalisadedRefuge(
    building,
    context.gameState,
  );
  const unshelteredLoss = Math.round(security.estimatedLossFraction * 100);
  const shelteredLoss = Math.round(
    palisadedRefugeHouseholdLossFraction(
      security.estimatedLossFraction,
    ) * 100,
  );
  const status = fireDisabled
    ? ['Fire outage — household shelter suspended', 'warning'] as const
    : sheltered.homesInReach <= 0
      ? ['No occupied homes within rally reach', 'warning'] as const
      : sheltered.shelteredHomes <= 0
        ? ['No watch warning reaches nearby homes', 'warning'] as const
        : [
            `${sheltered.shelteredHomes} warned ${
              sheltered.shelteredHomes === 1 ? 'household can' : 'households can'
            } rally`,
            'ok',
          ] as const;

  return {
    eyebrow: 'Frontier fortification',
    title: context.worldQueries.getBuildingLabel(building.kind),
    statusText: status[0],
    statusState: status[1],
    detailsHtml: `
      ${buildingCostRows(building.kind, getBuildingCost(building.kind))}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      <li><span>Role</span><span>Warned families carry people and household coin into a compact civilian enclosure</span></li>
      <li><span>Rally reach</span><span>${radius > 0 ? `${Math.round(radius)} m` : 'None until fire recovery'}</span></li>
      <li><span>Homes within reach</span><span>${sheltered.homesInReach} homes · ${sheltered.residentsInReach} residents</span></li>
      <li><span>Watch-linked shelter</span><span>${sheltered.shelteredHomes} homes · ${sheltered.shelteredResidents} residents warned</span></li>
      <li><span>Household coin sheltered</span><span>${Math.round(sheltered.shelteredWealth)} wealth can be carried inside</span></li>
      <li><span>Projected household loss</span><span>${security.targetsAtRisk <= 0 ? 'No wealthy household currently forecast as a target' : `${shelteredLoss}% when warned and sheltered versus up to ${unshelteredLoss}% otherwise`}</span></li>
      <li><span>Physical limits</span><span>Does not protect building inventories, loaded carts, or Town Hall treasury; those goods remain where stored</span></li>
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor: hiddenLabor(),
  };
}
