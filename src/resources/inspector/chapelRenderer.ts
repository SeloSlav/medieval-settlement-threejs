import { getBuildingCost } from '../buildingEconomy.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildChapelInspectorEconomyView,
  formatChapelCommunityBoosts,
  formatChapelExpenseLabel,
} from '../../economy/economyInspectorViews.ts';
import { isChapelStaffed } from '../../logistics/landmarkAccess.ts';
import {
  CHAPEL_COFFER_CAPACITY,
  CHAPEL_COFFER_RESERVE_MAX,
  CHAPEL_COFFER_RESERVE_MIN,
  CHAPEL_CHARITY_MIN_COFFER_GOLD,
  CHAPEL_POOR_RELIEF_GOLD_PER_DISPATCH,
  CHAPEL_SABBATH_OBSERVANCE_ATTENDANCE_BONUS,
  CHAPEL_SABBATH_OBSERVANCE_SETTLEMENT_BONUS,
} from '../../generated/gameBalance.ts';
import { fireForTarget } from '../../fires/fireIncident.ts';
import { DEFAULT_PARISH_POLICY } from '../../economy/chapelParish.ts';
import { DEFAULT_REGIONAL_MARKET_STATE } from '../../economy/regionalMarket.ts';
import {
  computeSettlementParishReliefPlan,
  formatChapelDailyAlms,
  formatChapelParishTerritory,
  formatChapelPoorRelief,
} from '../../economy/settlementParishRelief.ts';
import { gameClock } from '../../world/gameCalendar.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingRoadAccessRow,
} from './buildingCommon.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';

export const CHAPEL_COFFER_COLLECT_ACTION = 'collect-chapel-coffer';

function formatLinkedHomeStatus(
  connectedHomes: number,
  linkedPopulation: number,
  staffed: boolean,
  suspendedByFire: boolean,
): string {
  if (suspendedByFire) {
    return 'Fire damage suspends parish services and seals the coffer';
  }
  if (!staffed) {
    return 'Assign a priest to open parish services';
  }
  if (connectedHomes <= 0) {
    return 'Priest ready — awaiting road-linked homes';
  }
  return `Serving ${connectedHomes} nearest-road home${connectedHomes === 1 ? '' : 's'} (${linkedPopulation} villagers)`;
}

export function isChapelCofferCollectAction(button: HTMLElement): boolean {
  return button.closest(`[data-action="${CHAPEL_COFFER_COLLECT_ACTION}"]`) != null;
}

export function renderChapelInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const label = context.worldQueries.getBuildingLabel(building.kind);
  const cost = getBuildingCost(building.kind);
  const suspendedByFire = fireForTarget(
    context.gameState.fireIncidents.values(),
    'building',
    building.id,
  ) !== null;
  const staffed = isChapelStaffed(building) && !suspendedByFire;
  const parishPolicy = context.getParishPolicy?.() ?? DEFAULT_PARISH_POLICY;
  const settlementRelief = typeof context.worldQueries.getRoadNetworkSnapshot === 'function'
    ? computeSettlementParishReliefPlan({
        state: context.gameState,
        marketState: context.getMarketState?.() ?? DEFAULT_REGIONAL_MARKET_STATE,
        roadNetwork: context.worldQueries.getRoadNetworkSnapshot(),
        clock: gameClock(context.gameState.tick),
        sabbathObserved: parishPolicy.sabbathObservanceEnabled && staffed,
      })
    : null;
  const parishRelief = settlementRelief?.parishes.get(building.id) ?? null;
  const connectedHomes = parishRelief?.assignedHomes
    ?? context.worldQueries.countRoadConnectedResidences(building, false);
  const linkedPopulation = parishRelief?.assignedPopulation
    ?? context.worldQueries.countRoadConnectedPopulation(building);
  const { settlementBoost, abandonmentGrace } = formatChapelCommunityBoosts();
  const economy = buildChapelInspectorEconomyView(
    building,
    linkedPopulation,
    CHAPEL_COFFER_CAPACITY,
    CHAPEL_COFFER_COLLECT_ACTION,
    parishPolicy.sabbathObservanceEnabled,
  );
  const cofferLabel = `${economy.cofferGold.toFixed(1)} / ${economy.cofferCapacity} gold${economy.cofferFull ? ' · full — overflow to treasury' : ''}${suspendedByFire ? ' · sealed until structural recovery' : ''}`;
  const reliefInspectButton = parishRelief?.targetResidenceId == null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-residence="${parishRelief.targetResidenceId}" aria-label="Inspect parish relief household">Inspect</button>`;
  const collectButtonHtml = economy.cofferGold > 0.05 && !suspendedByFire
    ? `
      <button type="button" class="inspector-action-panel__button" data-action="${CHAPEL_COFFER_COLLECT_ACTION}">
        Collect coffer (${economy.cofferGold.toFixed(1)} gold)
      </button>
    `
    : '';
  const collectPanelHtml = `
    <div class="inspector-action-panel">
      <p class="inspector-action-panel__hint">${suspendedByFire
        ? 'Structural recovery is required before tithes, expenses, relief, or manual coffer collection resume.'
        : 'Tithes fund this parish before surplus reaches the treasury.'}</p>
      ${collectButtonHtml}
      <label class="city-admin-panel__toggle"><input type="checkbox" data-policy-chapel-auto-sweep ${parishPolicy.autoSweepEnabled ? 'checked' : ''} /><span>Auto-sweep surplus to treasury</span></label>
      <label class="city-admin-panel__toggle"><input type="checkbox" data-policy-chapel-sabbath ${parishPolicy.sabbathObservanceEnabled ? 'checked' : ''} /><span>Observe Sunday Sabbath</span></label>
      <p class="inspector-action-panel__hint">Sabbath pauses work and carts for +${Math.round(CHAPEL_SABBATH_OBSERVANCE_ATTENDANCE_BONUS * 100)}% attendance and +${Math.round(CHAPEL_SABBATH_OBSERVANCE_SETTLEMENT_BONUS * 100)}% settlement speed. Households still consume delivered provisions, so stock them before Saturday night.</p>
      <label class="city-admin-panel__slider-label"><span>Coffer reserve</span><strong data-policy-chapel-reserve-value>${Math.round(parishPolicy.cofferReserveGold)} gold</strong></label>
      <input class="city-admin-panel__slider" type="range" data-policy-chapel-reserve min="${CHAPEL_COFFER_RESERVE_MIN}" max="${CHAPEL_COFFER_RESERVE_MAX}" step="5" value="${Math.round(parishPolicy.cofferReserveGold)}" />
      <p class="inspector-action-panel__hint">Keep at least ${CHAPEL_CHARITY_MIN_COFFER_GOLD} gold after wages and upkeep to fund daily alms and the Monday poor-relief cart. Each dispatch may spend up to ${CHAPEL_POOR_RELIEF_GOLD_PER_DISPATCH} gold; a low auto-sweep reserve prioritizes the treasury instead.</p>
    </div>
  `;

  return {
    eyebrow: 'Building',
    title: label,
    statusText: formatLinkedHomeStatus(
      connectedHomes,
      linkedPopulation,
      staffed,
      suspendedByFire,
    ),
    statusState: suspendedByFire
      ? 'warning'
      : staffed && connectedHomes > 0
        ? 'ok'
        : staffed
          ? 'idle'
          : 'draft',
    detailsHtml: `
      ${buildingCostRows(building.kind, cost)}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      <li><span>Purpose</span><span>Parish hub — tithes, settlement, resilience, and easier recovery</span></li>
      <li><span>Priest</span><span>${suspendedByFire ? 'Displaced · parish work suspended' : staffed ? 'Serving the parish' : 'Unstaffed — benefits inactive'}</span></li>
      <li><span>Coffer</span><span>${cofferLabel}</span></li>
      <li><span>Parish territory</span><span>${parishRelief == null ? `${connectedHomes} road-linked homes` : formatChapelParishTerritory(parishRelief)}</span></li>
      <li><span>Tithe yield</span><span>${staffed ? economy.titheLabel : '—'}</span></li>
      <li><span>Parish expenses</span><span>${suspendedByFire ? 'Paused · no wages, upkeep, charity, or auto-sweep leaves the sealed coffer' : formatChapelExpenseLabel(economy.expense, staffed)}</span></li>
      ${parishRelief == null ? '' : `<li><span>Daily alms</span><span>${formatChapelDailyAlms(parishRelief)}</span></li>`}
      ${parishRelief == null ? '' : `<li><span>Monday poor relief</span><span>${formatChapelPoorRelief(parishRelief)}${reliefInspectButton}</span></li>`}
      <li><span>Attendance</span><span>${staffed ? economy.attendanceLabel : '—'}</span></li>
      <li><span>Settlement</span><span>${settlementBoost} faster when staffed & linked</span></li>
      <li><span>Shortages</span><span>${abandonmentGrace} longer before abandonment</span></li>
      <li><span>Recovery</span><span>${economy.recoveryLabel}</span></li>
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor: buildingLaborView(building, context.populationStats),
    supplementalPanelHtml: collectPanelHtml,
  };
}
