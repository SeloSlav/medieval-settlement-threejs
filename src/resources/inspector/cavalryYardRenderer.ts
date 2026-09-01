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
  const horseBySlot = new Map(horses.map((horse) => [horse.slot, horse]));
  const companies = militaryCompaniesAt(context.militaryCompanies, building.id);
  const fire = fireForTarget(context.gameState.fireIncidents.values(), 'building', building.id);
  const housed = horses.length;
  const trained = horses.filter((horse) => horse.trainingDays >= CAVALRY_HORSE_TRAINING_DAYS).length;
  const assigned = horses.filter((horse) => horse.assignedCompanyId != null).length;
  const ready = horses.filter((horse) => horse.trainingDays >= CAVALRY_HORSE_TRAINING_DAYS && horse.assignedCompanyId == null).length;
  const inTraining = horses.filter((horse) => horse.trainingDays < CAVALRY_HORSE_TRAINING_DAYS).length;
  const openSlots = Math.max(0, CAVALRY_HORSE_SLOTS - housed);
  const staffed = building.assignedLabor > 0;
  const treasuryGold = Math.max(0, context.resourceTotals.gold);
  const atCapacity = openSlots === 0;
  const treasuryShort = treasuryGold + 1e-6 < CAVALRY_HORSE_PURCHASE_GOLD;
  const purchaseDisabled = fire != null || !staffed || atCapacity || treasuryShort;
  const dailyTrainingCapacity = Math.min(inTraining, Math.max(0, building.assignedLabor));
  const suppliedHorseDays = dailyTrainingCapacity + assigned;
  const dailyFeed = suppliedHorseDays * CAVALRY_HORSE_DAILY_ANIMAL_FEED;
  const dailyOats = suppliedHorseDays * CAVALRY_HORSE_DAILY_OATS;
  const dailyWater = suppliedHorseDays * CAVALRY_HORSE_DAILY_WATER;

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
        ? [`${ready} trained remounts ready · ${assigned} in service`, 'ok'] as const
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
      <li data-inspector-primary><span>Horse places</span><span>${housed} / ${CAVALRY_HORSE_SLOTS} · ${trained} trained · ${assigned} deployed</span></li>
      <li><span>Training</span><span>${CAVALRY_HORSE_TRAINING_DAYS} supplied days per remount · one horse trained per assigned hand each day</span></li>
      <li><span>Daily draw now</span><span>${dailyFeed} Animal Feed · ${dailyOats} oats · ${dailyWater} water</span></li>
      <li><span>One rider, one horse</span><span>Each six-man cavalry company reserves six trained remounts while serving</span></li>
      <li><span>Losses and return</span><span>A fallen rider also loses his mount; surviving horses return here when the company disbands</span></li>
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
        <p class="inspector-action-panel__hint">Treasury: ${renderResourceAmount('gold', treasuryGold, { compact: true })}. Yard stocks: ${Math.floor(building.animalFeed ?? 0)} feed · ${Math.floor(building.oatGrain ?? 0)} oats · ${Math.floor(building.water)} water.</p>
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
    ? `Company #${horse.assignedCompanyId}`
    : horse.trainingDays >= CAVALRY_HORSE_TRAINING_DAYS
      ? 'Trained and ready'
      : `Training ${horse.trainingDays} / ${CAVALRY_HORSE_TRAINING_DAYS} days`;
  return `<li><span>Place ${slot + 1}</span><span>${status}</span></li>`;
}
