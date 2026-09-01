import {
  CAVALRY_HORSE_DAILY_ANIMAL_FEED,
  CAVALRY_HORSE_DAILY_OATS,
  CAVALRY_HORSE_DAILY_WATER,
  CAVALRY_HORSE_PURCHASE_GOLD,
  CAVALRY_HORSE_SLOTS,
  CAVALRY_HORSE_TRAINING_DAYS,
} from '../../generated/gameBalance.ts';
import { fireForTarget } from '../../fires/fireIncident.ts';
import { encodeResourceCostTooltip, renderResourceAmount } from '../../ui/resourceCost.ts';
import { getBuildingCost } from '../buildingEconomy.ts';
import type { CavalryHorseState, InspectableTarget } from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingExtentRow,
  buildingLaborView,
  buildingRoadAccessRow,
} from './buildingCommon.ts';
import {
  militaryCompaniesAt,
  renderMilitaryCompanyRoster,
  renderMilitaryRecruitmentPanels,
} from './militaryCompanyRenderer.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';

export function renderCavalryYardInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const horses = [...context.gameState.cavalryHorses.values()]
    .filter((horse) => horse.cavalryYardId === building.id)
    .sort((left, right) => left.slot - right.slot || left.id.localeCompare(right.id));
  const companyById = new Map(
    [...(context.militaryCompanies ?? [])].map((company) => [company.id, company]),
  );
  const horseOccupiesPlace = (horse: CavalryHorseState): boolean => {
    if (horse.assignedCompanyId == null) return true;
    return companyById.get(horse.assignedCompanyId)?.status !== 'active';
  };
  const occupyingHorses = horses.filter(horseOccupiesPlace);
  const horseBySlot = new Map(occupyingHorses.map((horse) => [horse.slot, horse]));
  const companies = militaryCompaniesAt(context.militaryCompanies, building.id);
  const fire = fireForTarget(context.gameState.fireIncidents.values(), 'building', building.id);
  const housed = occupyingHorses.length;
  const trained = occupyingHorses.filter((horse) => horse.trainingDays >= CAVALRY_HORSE_TRAINING_DAYS).length;
  const assigned = horses.filter((horse) => horse.assignedCompanyId != null && companyById.get(horse.assignedCompanyId)?.status === 'active').length;
  const returning = horses.filter((horse) => horse.assignedCompanyId != null && companyById.get(horse.assignedCompanyId)?.status === 'disbanding').length;
  const onSite = occupyingHorses.length - returning;
  const ready = horses.filter((horse) => horse.trainingDays >= CAVALRY_HORSE_TRAINING_DAYS && horse.assignedCompanyId == null).length;
  const inTraining = horses.filter((horse) => horse.trainingDays < CAVALRY_HORSE_TRAINING_DAYS).length;
  const openSlots = Math.max(0, CAVALRY_HORSE_SLOTS - housed);
  const staffed = building.assignedLabor > 0;
  const treasuryGold = Math.max(0, context.resourceTotals.gold);
  const atCapacity = openSlots === 0;
  const treasuryShort = treasuryGold + 1e-6 < CAVALRY_HORSE_PURCHASE_GOLD;
  const purchaseDisabled = fire != null || !staffed || atCapacity || treasuryShort;
  const dailyTrainingCapacity = Math.min(inTraining, Math.max(0, building.assignedLabor));
  const dailyFeed = onSite * CAVALRY_HORSE_DAILY_ANIMAL_FEED;
  const dailyOats = onSite * CAVALRY_HORSE_DAILY_OATS;
  const dailyWater = onSite * CAVALRY_HORSE_DAILY_WATER;

  const slotRows = Array.from({ length: CAVALRY_HORSE_SLOTS }, (_, slot) => {
    const horse = horseBySlot.get(slot);
    if (!horse) return `<li><span>Place ${slot + 1}</span><span>Open</span></li>`;
    return horseStatusRow(horse, slot);
  }).join('');
  const status = fire
    ? ['Fire outage — remount work and recruitment suspended', 'warning'] as const
    : !staffed
      ? ['Unstaffed — assign cavalry-yard hands', 'warning'] as const
      : ready >= 6
        ? [`${ready} trained remounts ready · ${assigned} deployed`, 'ok'] as const
        : inTraining > 0
          ? [`${inTraining} remounts in training · ${ready} ready`, 'active'] as const
          : [`${housed} / ${CAVALRY_HORSE_SLOTS} remounts · ${ready} ready`, 'idle'] as const;
  const purchaseTooltip = fire
    ? 'Purchases resume after fire recovery.'
    : !staffed
      ? 'Assign at least one cavalry-yard hand first.'
      : atCapacity
        ? 'All authored horse places are occupied.'
        : treasuryShort
          ? 'The treasury cannot fund this remount.'
          : `Imports one untrained remount. It needs ${CAVALRY_HORSE_TRAINING_DAYS} supplied training days before assignment.`;

  return {
    eyebrow: 'Mounted military establishment',
    title: context.worldQueries.getBuildingLabel(building.kind),
    statusText: status[0],
    statusState: status[1],
    detailsHtml: `
      ${buildingCostRows(getBuildingCost(building.kind))}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      ${buildingExtentRow(building.kind)}
      <li data-inspector-primary><span>Horse places</span><span>${housed} / ${CAVALRY_HORSE_SLOTS} occupied or reserved · ${assigned} deployed</span></li>
      <li><span>On site</span><span>${onSite} horses · ${trained} trained · ${returning} return places reserved</span></li>
      <li><span>Training throughput</span><span>${dailyTrainingCapacity} now · ${CAVALRY_HORSE_TRAINING_DAYS} supplied days per remount · one horse per assigned hand each day</span></li>
      <li><span>Daily on-site ration</span><span>${dailyOats} oats Mar–Nov <em>or</em> ${dailyFeed} Animal Feed Dec–Feb · ${dailyWater} water</span></li>
      <li><span>One rider, one horse</span><span>Every six-rider company requires six individually trained, physically represented remounts.</span></li>
      <li><span>Field throughput</span><span>Active companies vacate their six places. This yard can school the next real horses while deployed riders carry cart-delivered supplies.</span></li>
      <li><span>Losses and return</span><span>A fallen rider loses his mount. Survivors reserve places across connected Cavalry Yards, or may return and be sold.</span></li>
    `,
    supplementalPanelHtml: `
      <div class="inspector-action-panel" data-inspector-panel-title="Remount yard">
        <ul class="resource-inspector-details">${slotRows}</ul>
        <button type="button" class="resource-action-button resource-action-button--icon" data-purchase-cavalry-horse
          data-tooltip-title="Purchase remount" data-tooltip="${purchaseTooltip}"
          data-tooltip-cost="${encodeResourceCostTooltip({ gold: CAVALRY_HORSE_PURCHASE_GOLD })}"
          aria-label="Purchase an untrained remount for ${CAVALRY_HORSE_PURCHASE_GOLD} gold." ${purchaseDisabled ? 'aria-disabled="true"' : ''}>
          <span class="inspector-action-icon" data-action-icon="hussars" aria-hidden="true"></span>
          <span>Purchase remount<br><small>${CAVALRY_HORSE_PURCHASE_GOLD} gold</small></span>
        </button>
        <p class="inspector-action-panel__hint">Treasury: ${renderResourceAmount('gold', treasuryGold, { compact: true })}. Yard stocks: ${Math.floor(building.animalFeed ?? 0)} winter feed · ${Math.floor(building.oatGrain ?? 0)} oats · ${Math.floor(building.water)} water. Seasonal fodder is an alternative, never a duplicate charge.</p>
      </div>
      ${renderMilitaryRecruitmentPanels(
        ['hussars', 'armored-lancers', 'mounted-archers'],
        fire != null || building.constructionComplete === false || ready < 6,
      )}
      ${renderMilitaryCompanyRoster(companies)}
    `,
    demolish: companies.some((company) => company.status !== 'destroyed')
      ? { visible: false, hint: 'Disband every attached company before removing its stable and return point.' }
      : {
          visible: true,
          hint: `${buildingDemolishHint(building.kind)} All ${housed} housed remount${housed === 1 ? '' : 's'} will be forfeited.`,
        },
    labor: buildingLaborView(building, context.populationStats, context.worldQueries),
  };
}

function horseStatusRow(horse: CavalryHorseState, slot: number): string {
  const status = horse.assignedCompanyId != null
    ? `On site or reserved · company #${horse.assignedCompanyId}`
    : horse.trainingDays >= CAVALRY_HORSE_TRAINING_DAYS
      ? 'Trained and ready'
      : `Training ${horse.trainingDays} / ${CAVALRY_HORSE_TRAINING_DAYS} days`;
  return `<li><span>Place ${slot + 1}</span><span>${status}</span></li>`;
}
