import { getBuildingCost } from '../buildingEconomy.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildChapelInspectorEconomyView,
  formatChapelCommunityBoosts,
  formatChapelExpenseLabel,
} from '../../economy/economyInspectorViews.ts';
import { isChapelStaffed } from '../../logistics/landmarkAccess.ts';
import {
  CHAPEL_CHARITY_MIN_COFFER_GOLD,
  CHAPEL_POOR_RELIEF_GOLD_PER_DISPATCH,
  CHAPEL_SABBATH_OBSERVANCE_ATTENDANCE_BONUS,
  CHAPEL_SABBATH_OBSERVANCE_SETTLEMENT_BONUS,
} from '../../generated/gameBalance.ts';
import {
  chapelCofferCapacityForTier,
  chapelTierDefinition,
  chapelUpgradeCost,
} from '../../economy/chapelUpgrade.ts';
import { computeResourceTotals } from '../resourceTotals.ts';
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

export function renderChapelInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const cost = getBuildingCost(building.kind);
  const suspendedByFire = fireForTarget(
    context.gameState.fireIncidents.values(),
    'building',
    building.id,
  ) !== null;
  const staffed = isChapelStaffed(building) && !suspendedByFire;
  const graveyards = Array.from((context.gameState.graveyards ?? new Map()).values())
    .filter((graveyard) => graveyard.chapelId === building.id);
  const graveCapacity = graveyards.reduce((sum, graveyard) => sum + graveyard.capacity, 0);
  const burials = graveyards.reduce((sum, graveyard) => sum + graveyard.burials, 0);
  const corpses = Array.from((context.gameState.corpses ?? new Map()).values());
  const outboundBurialCarts = corpses
    .filter((corpse) => corpse.chapelId === building.id && corpse.state === 1).length;
  const inboundBurialCarts = corpses
    .filter((corpse) => corpse.chapelId === building.id && corpse.state === 2).length;
  const uncollectedCorpses = corpses
    .filter((corpse) => corpse.state <= 1).length;
  const incomingByGraveyard = new Map<string, number>();
  for (const corpse of corpses) {
    if (corpse.graveyardId === null || corpse.state === 0) continue;
    incomingByGraveyard.set(
      corpse.graveyardId,
      (incomingByGraveyard.get(corpse.graveyardId) ?? 0) + 1,
    );
  }
  const graveyardRows = graveyards.map((graveyard, index) => {
    const incoming = incomingByGraveyard.get(graveyard.id) ?? 0;
    const removable = graveyard.burials === 0 && incoming === 0;
    return `<li><span>Burial ground ${index + 1}</span><span>${graveyard.burials} buried · ${incoming} reserved · ${graveyard.capacity} capacity${
      removable
        ? ` · <button type="button" class="inspector-jump-button" data-demolish-graveyard="${graveyard.id}">Remove empty ground</button>`
        : ''
    }</span></li>`;
  }).join('');
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
  const tier = chapelTierDefinition(building.chapelTier);
  const cofferCapacity = chapelCofferCapacityForTier(building.chapelTier);
  const upgrade = chapelUpgradeCost(building.chapelTier);
  const resources = computeResourceTotals(context.gameState);
  const upgradeBlocker = suspendedByFire
    ? 'Repair the church before upgrading it.'
    : upgrade == null
      ? null
      : resources.timber + 1e-6 < upgrade.timber
        ? `Need ${Math.ceil(upgrade.timber - resources.timber)} more timber.`
        : resources.stone + 1e-6 < upgrade.stone
          ? `Need ${Math.ceil(upgrade.stone - resources.stone)} more stone.`
          : resources.ironwork + 1e-6 < upgrade.ironwork
            ? `Need ${Math.ceil(upgrade.ironwork - resources.ironwork)} more ironwork.`
            : resources.roofTiles + 1e-6 < upgrade.roofTiles
              ? `Need ${Math.ceil(upgrade.roofTiles - resources.roofTiles)} more fired roof tiles.`
              : null;
  const upgradeCostLabel = upgrade == null
    ? ''
    : `${upgrade.timber} timber + ${upgrade.stone} stone + ${upgrade.ironwork} ironwork + ${upgrade.roofTiles} fired roof tiles`;
  const { settlementBoost } = formatChapelCommunityBoosts();
  const economy = buildChapelInspectorEconomyView(
    building,
    linkedPopulation,
    cofferCapacity,
    parishPolicy.sabbathObservanceEnabled,
  );
  const monasteryPurse = Math.min(
    Math.max(0, building.chapelMonasteryTitheDue ?? 0),
    Math.max(0, building.gold),
  );
  const activeTrip = context.worldQueries.getActiveDeliveryTrip(building);
  const activeGoldTrip = activeTrip?.cargoKind === 'gold' ? activeTrip : null;
  const activeGoldTarget = activeGoldTrip?.targetBuildingId == null
    ? null
    : context.gameState.buildings.get(activeGoldTrip.targetBuildingId) ?? null;
  const cofferLabel = `${economy.cofferGold.toFixed(1)} / ${economy.cofferCapacity} gold${economy.cofferFull ? ' · full — new parish tithes wait for cart capacity' : ''}${suspendedByFire ? ' · sealed until structural recovery' : ''}`;
  const monasteryPurseLabel = monasteryPurse <= 0.05
    ? 'No pledged gold waiting'
    : `${monasteryPurse.toFixed(1)} gold sealed for a linked monastery${
        activeGoldTarget?.kind === 'monastery' && activeGoldTrip
          ? ` · ${activeGoldTrip.amount.toFixed(1)} travelling`
          : ''
      }`;
  const reliefInspectButton = parishRelief?.targetResidenceId == null
    ? ''
    : ` <button type="button" class="inspector-jump-button" data-inspect-residence="${parishRelief.targetResidenceId}" aria-label="Inspect parish relief household">Inspect</button>`;
  const collectPanelHtml = `
    <div class="inspector-action-panel">
      ${upgrade == null
        ? '<p class="inspector-action-panel__hint">The large stone church is fully upgraded.</p>'
        : `<button type="button" class="inspector-action-panel__button" data-action="upgrade-chapel"${upgradeBlocker ? ' disabled' : ''}>
            Upgrade to tier ${upgrade.targetTier} (${upgradeCostLabel})
          </button>
          <p class="inspector-action-panel__hint">${upgradeBlocker ?? 'Rebuild the church in place; the final footprint was reserved when the wooden church was laid out.'}</p>`}
      <p class="inspector-action-panel__hint">${suspendedByFire
        ? 'Structural recovery is required before tithes, parish expenses, or relief resume.'
        : 'Parish tithes belong to the church. They fund clergy, upkeep, alms, poor relief, and pledged monastery support; they cannot be transferred to the civic treasury.'}</p>
      <label class="city-admin-panel__toggle"><input type="checkbox" data-policy-chapel-sabbath ${parishPolicy.sabbathObservanceEnabled ? 'checked' : ''} /><span>Observe Sunday Sabbath</span></label>
      <p class="inspector-action-panel__hint">Sabbath pauses work and carts for +${Math.round(CHAPEL_SABBATH_OBSERVANCE_ATTENDANCE_BONUS * 100)}% attendance and +${Math.round(CHAPEL_SABBATH_OBSERVANCE_SETTLEMENT_BONUS * 100)}% settlement speed. Households still consume delivered provisions, so stock them before Saturday night.</p>
      <p class="inspector-action-panel__hint">Keep at least ${CHAPEL_CHARITY_MIN_COFFER_GOLD} gold after wages and upkeep. In physical-economy settlements, one day of alms leaves as a visible purse carried by a free villager; long or blocked roads and church-cart contention delay it. Monday poor relief may spend up to ${CHAPEL_POOR_RELIEF_GOLD_PER_DISPATCH} gold per dispatch.</p>
      <button type="button" class="inspector-action-panel__button" data-land-parcel="graveyard"${building.constructionComplete === false || suspendedByFire ? ' disabled' : ''}>
        Lay adjacent burial ground
      </button>
      <p class="inspector-action-panel__hint">Trace four corners beside the church. Each assigned priest/gravedigger can move one body at a time by handcart over connected roads.</p>
    </div>
  `;

  return {
    eyebrow: 'Building',
    title: tier.label,
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
      ${buildingCostRows(cost)}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      <li><span>Church tier</span><span>${tier.tier} / 3 · ${tier.material}</span></li>
      <li><span>Tier benefits</span><span>${tier.titheMultiplier <= 1 ? 'Base' : `+${Math.round((tier.titheMultiplier - 1) * 100)}%`} tithe yield · ${cofferCapacity} gold coffer</span></li>
      <li><span>Purpose</span><span>Parish hub — tithes, settlement, resilience, and easier recovery</span></li>
      <li><span>Priest</span><span>${suspendedByFire ? 'Displaced · parish work suspended' : staffed ? 'Serving the parish' : 'Unstaffed — benefits inactive'}</span></li>
      <li><span>Coffer</span><span>${cofferLabel}</span></li>
      <li><span>Monastery purse</span><span>${monasteryPurseLabel}</span></li>
      <li><span>Parish handcart</span><span>${activeGoldTrip ? `${activeGoldTrip.amount.toFixed(1)} gold · ${activeGoldTrip.phase}` : 'None'}</span></li>
      <li><span>Parish territory</span><span>${parishRelief == null ? `${connectedHomes} road-linked homes` : formatChapelParishTerritory(parishRelief)}</span></li>
      <li><span>Tithe yield</span><span>${staffed ? economy.titheLabel : '—'}</span></li>
      <li><span>Parish expenses</span><span>${suspendedByFire ? 'Paused · no wages, upkeep, charity, or monastery remittance leaves the sealed coffer' : formatChapelExpenseLabel(economy.expense, staffed)}</span></li>
      ${parishRelief == null ? '' : `<li><span>Daily alms purse</span><span>${formatChapelDailyAlms(parishRelief)}</span></li>`}
      ${parishRelief == null ? '' : `<li><span>Monday poor relief</span><span>${formatChapelPoorRelief(parishRelief)}${reliefInspectButton}</span></li>`}
      <li><span>Attendance</span><span>${staffed ? economy.attendanceLabel : '—'}</span></li>
      <li><span>Settlement</span><span>${settlementBoost} faster when staffed & linked</span></li>
      <li><span>Parish resilience</span><span>Lower survival-stock thresholds for vacant-home recovery</span></li>
      <li><span>Recovery</span><span>${economy.recoveryLabel}</span></li>
      <li><span>Burial grounds</span><span>${graveyards.length} · ${burials} / ${graveCapacity} graves occupied</span></li>
      <li><span>Gravedigger carts</span><span>${outboundBurialCarts} outbound empty · ${inboundBurialCarts} carrying bodies · ${uncollectedCorpses} bodies still at homes settlement-wide</span></li>
      ${graveyardRows}
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor: buildingLaborView(building, context.populationStats, context.worldQueries),
    supplementalPanelHtml: collectPanelHtml,
  };
}
