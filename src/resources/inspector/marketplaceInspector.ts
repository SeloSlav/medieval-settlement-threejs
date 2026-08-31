import { fireDisabledBuildingIds } from '../../fires/fireIncident.ts';
import {
  REGIONAL_EXCHANGE_INTERVAL_SECONDS,
  SIM_REALTIME_RATE,
  STOREHOUSE_HAUL_PER_WORKER,
} from '../../generated/gameBalance.ts';
import {
  formatRegionalExchangeCountdown,
  tradingPostExchangeDue,
} from '../../economy/tradingPostTrade.ts';
import { cargoKindLabel, formatTripPhaseLabel } from '../../logistics/deliveryTrips.ts';
import {
  DEFAULT_PANTRY_SAFEGUARD_POLICY,
  normalizePantrySafeguardPolicy,
  pantrySafeguardPolicyOption,
} from '../../economy/pantrySafeguardPolicy.ts';
import { getBuildingCost } from '../buildingEconomy.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingRoadAccessRow,
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
  const pantrySafeguard = pantrySafeguardPolicyOption(
    normalizePantrySafeguardPolicy(
      context.getPantrySafeguardPolicy?.() ?? DEFAULT_PANTRY_SAFEGUARD_POLICY,
    ),
  );
  const rules = Array.from(context.gameState.tradingPostTradeRules?.values() ?? [])
    .filter((rule) => rule.buildingId === building.id && rule.mode !== 0);
  const contractEfficiency = 1 + context.landUseProfile.bonuses.urban;
  const exchangeDue = tradingPostExchangeDue(rules, context.gameState.tick);
  const exchangeCountdown = formatRegionalExchangeCountdown(
    context.gameState.tick,
    exchangeDue,
  );
  const intervalAt4x = Math.ceil(REGIONAL_EXCHANGE_INTERVAL_SECONDS / (SIM_REALTIME_RATE * 4));
  const localTrip = Array.from(context.gameState.deliveryTrips.values())
    .find((trip) => trip.buildingId === building.id || trip.targetBuildingId === building.id);
  const localTripLabel = localTrip
    ? `${cargoKindLabel(localTrip.cargoKind)} · ${formatTripPhaseLabel(localTrip.phase)}`
    : building.assignedLabor <= 0
      ? 'Paused until a hauler is assigned'
      : 'Waiting for configured surplus or local demand';

  let statusText = `${rules.length} regional trade rule${rules.length === 1 ? '' : 's'} active`;
  if (building.constructionComplete === false) statusText = 'Trading Post under construction';
  else if (fireDisabled) statusText = 'Trade suspended by fire damage';
  else if (building.assignedLabor <= 0) statusText = 'Trade suspended — assign a local hauler';
  else if (!hasRoadAccess) statusText = 'Trade suspended — connect the local road network';
  else if (exchangeDue) statusText = 'Regional exchange ready';

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
      <li><span>Purpose</span><span>Dedicated Trading Post for recurring import and export rules</span></li>
      <li><span>Next exchange</span><span>${exchangeCountdown} · repeats every ${REGIONAL_EXCHANGE_INTERVAL_SECONDS} simulation seconds (~${intervalAt4x} real seconds at 4×) while operational</span></li>
      <li><span>Regional transit</span><span>No caravan unit — approved imports and staged exports settle directly</span></li>
      <li><span>Local hauling</span><span>${localTripLabel}</span></li>
      <li><span>Hauler slots</span><span>${building.assignedLabor}/2 dedicated · the first enables trade; the optional second raises a collection cart from ${STOREHOUSE_HAUL_PER_WORKER} to ${STOREHOUSE_HAUL_PER_WORKER * 2} units</span></li>
      <li><span>Export reserve</span><span>Only public building stock above the configured settlement floor can be staged</span></li>
      <li><span>Protected stock</span><span>Household pantries, construction commitments, and granary grain reserves are never exported</span></li>
      <li><span>Town Hall safeguard</span><span>${pantrySafeguard.label} · ${pantrySafeguard.hint} This controls local Marketplace issues only and never opens a regional order.</span></li>
      <li><span>Import ownership</span><span>Public Trading Post procurement follows player settlement rules and spends civic treasury gold; automatic private household contingency imports are separate and spend household wealth.</span></li>
      <li><span>Import funding</span><span>Civic treasury gold · partial orders are allowed when coin or Trading Post room is short</span></li>
      <li><span>Local supply</span><span>Imported goods still move by physical hauler: provisions and wares to Marketplaces, water to wells, and ale or cider to a staffed Tavern</span></li>
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
      contractEfficiency,
    ),
  };
}
