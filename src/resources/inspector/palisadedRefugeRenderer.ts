import { fireDisabledBuildingIds } from '../../fires/fireIncident.ts';
import {
  countSitesProtectedByPalisadedRefuge,
  DEFAULT_SETTLEMENT_SECURITY,
  palisadedRefugeEffectiveRadius,
  palisadedRefugeLossFraction,
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
  const sheltered = countSitesProtectedByPalisadedRefuge(
    building,
    context.gameState,
  );
  const unfortifiedLoss = Math.round(security.estimatedLossFraction * 100);
  const fortifiedLoss = Math.round(
    palisadedRefugeLossFraction(security.estimatedLossFraction) * 100,
  );

  return {
    eyebrow: 'Frontier fortification',
    title: context.worldQueries.getBuildingLabel(building.kind),
    statusText: fireDisabled
      ? 'Fire outage — refuge protection suspended'
      : 'Palisade ready',
    statusState: fireDisabled ? 'warning' : 'ok',
    detailsHtml: `
      ${buildingCostRows(building.kind, getBuildingCost(building.kind))}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      <li><span>Role</span><span>Local civilian refuge for nearby homes, stores, and loaded carts</span></li>
      <li><span>Protection radius</span><span>${radius > 0 ? `${Math.round(radius)} m` : 'None until fire recovery'}</span></li>
      <li><span>Inside palisade</span><span>${sheltered.buildings} buildings · ${sheltered.homes} homes · ${sheltered.carts} loaded carts</span></li>
      <li><span>Residents sheltered</span><span>${sheltered.residents}</span></li>
      <li><span>Treasury inside</span><span>${Math.round(sheltered.treasuryValue)} portable value at its physical seat</span></li>
      <li><span>Portable raid value</span><span>${Math.round(sheltered.portableValue)} currently inside</span></li>
      <li><span>Projected plunder</span><span>${security.targetsAtRisk <= 0 ? 'No stocked target currently forecast' : `${fortifiedLoss}% inside versus up to ${unfortifiedLoss}% outside`}</span></li>
      <li><span>Limits</span><span>Reduces carried-off stores by 40%; watch warning, paid guards, and fire recovery remain necessary</span></li>
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor: hiddenLabor(),
  };
}
