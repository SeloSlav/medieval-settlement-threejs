import { fireDisabledBuildingIds } from '../../fires/fireIncident.ts';
import {
  CALENDAR_DAYS_PER_MONTH,
  STOREHOUSE_HAUL_PER_WORKER,
} from '../../generated/gameBalance.ts';
import { cargoKindLabel, formatTripPhaseLabel } from '../../logistics/deliveryTrips.ts';
import {
  DEFAULT_PANTRY_SAFEGUARD_POLICY,
  normalizePantrySafeguardPolicy,
  pantrySafeguardPolicyOption,
} from '../../economy/pantrySafeguardPolicy.ts';
import { gameClock } from '../../world/gameCalendar.ts';
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
import { renderMarketplaceTradePanel } from './marketplaceTradeRenderer.ts';

export function renderMarketplaceInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const marketState = context.getMarketState?.();
  if (!marketState) throw new Error('Trading Post inspector requires regional market state.');

  const label = context.worldQueries.getBuildingLabel(building.kind);
  const cost = getBuildingCost(building.kind);
  const labor = buildingLaborView(building, context.populationStats, context.worldQueries);
  const hasRoadAccess = context.worldQueries.hasRoadAccess(building.x, building.z);
  const fireDisabled = fireDisabledBuildingIds(context.gameState.fireIncidents.values())
    .has(building.id);
  const clock = gameClock(context.gameState.tick);
  const daysUntilSettlement = CALENDAR_DAYS_PER_MONTH - clock.monthDay + 1;
  const pantrySafeguard = pantrySafeguardPolicyOption(
    normalizePantrySafeguardPolicy(
      context.getPantrySafeguardPolicy?.() ?? DEFAULT_PANTRY_SAFEGUARD_POLICY,
    ),
  );
  const rules = Array.from(context.gameState.tradingPostTradeRules?.values() ?? [])
    .filter((rule) => rule.buildingId === building.id && rule.mode !== 0);
  const localTrip = Array.from(context.gameState.deliveryTrips.values())
    .find((trip) => trip.buildingId === building.id || trip.targetBuildingId === building.id);
  const localTripLabel = localTrip
    ? `${cargoKindLabel(localTrip.cargoKind)} · ${formatTripPhaseLabel(localTrip.phase)}`
    : building.assignedLabor <= 0
      ? 'Paused until a hauler is assigned'
      : 'Waiting for configured surplus or local demand';

  let statusText = `${rules.length} monthly trade rule${rules.length === 1 ? '' : 's'} active`;
  if (building.constructionComplete === false) statusText = 'Trading Post under construction';
  else if (fireDisabled) statusText = 'Trade suspended by fire damage';
  else if (building.assignedLabor <= 0) statusText = 'Trade suspended — assign a local hauler';
  else if (!hasRoadAccess) statusText = 'Trade suspended — connect the local road network';
  else if (daysUntilSettlement === 1) statusText = 'Monthly settlement due today';

  return {
    eyebrow: 'Building',
    title: label,
    statusText,
    statusState: !fireDisabled
      && building.constructionComplete !== false
      && building.assignedLabor > 0
      && hasRoadAccess
      ? 'ok'
      : 'idle',
    detailsHtml: `
      ${buildingCostRows(cost)}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      ${buildingStorageRows(building, building.kind, context.conflictEnabled ?? false)}
      <li><span>Purpose</span><span>Dedicated Trading Post for monthly import and export rules</span></li>
      <li><span>Settlement</span><span>${daysUntilSettlement === 1 ? 'Today' : `In ${daysUntilSettlement} days`} · one abstract regional exchange per month</span></li>
      <li><span>Regional transit</span><span>No caravan unit — approved imports and staged exports settle directly</span></li>
      <li><span>Local hauling</span><span>${localTripLabel}</span></li>
      <li><span>Hauler slots</span><span>${building.assignedLabor}/2 dedicated · the first enables trade; the optional second raises a collection cart from ${STOREHOUSE_HAUL_PER_WORKER} to ${STOREHOUSE_HAUL_PER_WORKER * 2} units</span></li>
      <li><span>Export reserve</span><span>Only public building stock above the configured settlement floor can be staged</span></li>
      <li><span>Protected stock</span><span>Household pantries, construction commitments, and granary grain reserves are never exported</span></li>
      <li><span>Town Hall safeguard</span><span>${pantrySafeguard.label} · ${pantrySafeguard.hint} This controls local Marketplace issues only and never opens a regional order.</span></li>
      <li><span>Import ownership</span><span>Public Trading Post procurement follows player settlement rules and spends civic treasury gold; automatic private household contingency imports are separate and spend household wealth.</span></li>
      <li><span>Import funding</span><span>Civic treasury gold · partial orders are allowed when coin or Trading Post room is short</span></li>
      <li><span>Local supply</span><span>Imported household goods still move from this store to covered Marketplaces and wells by local hauler</span></li>
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor,
    supplementalPanelHtml: renderMarketplaceTradePanel(
      building,
      context.gameState,
      marketState,
    ),
  };
}
