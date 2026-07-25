import {
  countSitesProtectedByWatchtower,
  frontierThreatLabel,
  watchtowerEffectiveRadius,
} from '../../security/frontierSecurity.ts';
import { getBuildingCost } from '../buildingEconomy.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingRoadAccessRow,
} from './buildingCommon.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';

export function renderWatchtowerInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const security = context.getSettlementSecurity?.();
  const protectedSites = countSitesProtectedByWatchtower(building, context.gameState);
  const effectiveRadius = watchtowerEffectiveRadius(building);
  const settlementCoverage = Math.round((security?.coverage ?? 0) * 100);
  const threatLabel = frontierThreatLabel(security ?? {
    threat: 0,
    coverage: 0,
    protectedValue: 0,
    totalValue: 0,
    staffedWatchtowers: 0,
    readyGuards: 0,
    defenseReadiness: 0,
    nextRaidTick: 0,
    lastRaidTick: 0,
    lastOutcome: 'none',
    lastGoodsLost: 0,
    lastWealthLost: 0,
  }, { conflictMode: 'frontier' });

  const status = building.assignedLabor <= 0
    ? ['Unstaffed — no warning coverage', 'warning'] as const
    : building.assignedLabor === 1
      ? ['One watchman — reduced sight radius', 'active'] as const
      : ['Full watch posted', 'ok'] as const;

  return {
    eyebrow: 'Frontier defense',
    title: context.worldQueries.getBuildingLabel(building.kind),
    statusText: status[0],
    statusState: status[1],
    detailsHtml: `
      ${buildingCostRows(building.kind, getBuildingCost(building.kind))}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      <li><span>Role</span><span>Early warning for nearby households and stores</span></li>
      <li><span>Effective radius</span><span>${effectiveRadius > 0 ? `${Math.round(effectiveRadius)} m` : 'None until staffed'}</span></li>
      <li><span>Protected holdings</span><span>${protectedSites.buildings} buildings · ${protectedSites.homes} homes</span></li>
      <li><span>Residents warned</span><span>${protectedSites.residents}</span></li>
      <li><span>Settlement coverage</span><span>${settlementCoverage}% weighted value</span></li>
      <li><span>Frontier report</span><span>${threatLabel}</span></li>
      <li><span>Campaign season</span><span>Incursions pause from November through March</span></li>
    `,
    demolish: { visible: true, hint: buildingDemolishHint(building.kind) },
    labor: buildingLaborView(building, context.populationStats),
  };
}
