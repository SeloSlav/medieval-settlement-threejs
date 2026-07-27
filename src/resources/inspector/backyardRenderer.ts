import {
  BACKYARD_GARDEN_DEFINITIONS,
  BACKYARD_GARDEN_KINDS,
  backyardGardenLabel,
  formatBackyardGardenCost,
  formatBackyardGardenSalvage,
  getBackyardGardenCost,
  type BackyardGardenKind,
} from '../../residences/backyardGarden.ts';
import { canAffordBackyardGarden } from '../buildingEconomy.ts';
import { ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT } from '../../economy/villageEconomy.ts';
import { buildBackyardEconomyView, formatBackyardSavingsLabel } from '../../economy/economyInspectorViews.ts';
import {
  STONE_SALVAGE_FRACTION,
  TIMBER_SALVAGE_FRACTION,
  TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER,
} from '../../generated/gameBalance.ts';
import {
  backyardGardenSeasonStatus,
} from '../../economy/backyardGardenTick.ts';
import { settlementHasStaffedChapel } from '../../logistics/landmarkAccess.ts';
import { backyardGardenPlacement } from '../../residences/backyardPosition.ts';
import { getNeedStock } from '../../residences/residenceNeeds.ts';
import { gameClock } from '../../world/gameCalendar.ts';
import { environmentFor } from '../../world/seasonPolicy.ts';
import type { BurgageZoneState, InspectableTarget } from '../types.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import { hiddenLabor } from './renderInspectableTarget.ts';

export function renderBackyardInspector(
  target: Extract<InspectableTarget, { kind: 'backyard' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { residence, zone, garden } = target;

  if (!garden) {
    return renderEmptyBackyardPicker(residence, zone, context);
  }

  const def = BACKYARD_GARDEN_DEFINITIONS[garden.kind];
  const foodStock = Math.round(getNeedStock(residence.needs, 'food'));
  const taxRate = context.getEconomicActivityTaxRate?.() ?? ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT;
  const hasMarketAccess = context.worldQueries.isResidenceConnectedToMarketplace(residence);
  const clock = gameClock(context.gameState.tick);
  const environment = environmentFor(
    context.gameState.seed,
    context.worldHydrology,
    clock,
  );
  const season = backyardGardenSeasonStatus(
    garden.kind,
    clock.month,
    environment,
  );
  const parishPolicy = context.getParishPolicy?.();
  const sabbathPaused = clock.isSunday
    && Boolean(parishPolicy?.sabbathObservanceEnabled)
    && settlementHasStaffedChapel(context.gameState);
  const staffedTownHall = Array.from(context.gameState.buildings.values()).some(
    (building) =>
      building.kind === 'town_hall'
      && building.constructionComplete !== false
      && building.assignedLabor > 0,
  );
  const taxCollectionMultiplier = staffedTownHall
    ? 1
    : TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER;
  const seasonalMultiplier = sabbathPaused || residence.abandoned
    ? 0
    : season.multiplier;
  const economy = buildBackyardEconomyView(
    garden.kind,
    residence.abandoned ? 0 : residence.population,
    taxRate,
    hasMarketAccess,
    { seasonalMultiplier, taxCollectionMultiplier },
  );
  const producesFood = def.foodPerPersonPerSec > 0;
  const statusText = residence.abandoned
    ? 'Paused — residence abandoned'
    : sabbathPaused
      ? 'Paused — Sunday Sabbath'
      : !season.active
        ? 'Dormant — out of season'
        : hasMarketAccess
          ? garden.kind === 'apple_orchard' || garden.kind === 'cherry_orchard'
            ? 'Harvesting'
            : 'Growing and trading'
          : 'Growing — no marketplace link';
  const statusState = residence.abandoned || !season.active
    ? 'warning'
    : sabbathPaused
      ? 'idle'
      : hasMarketAccess
        ? 'ok'
        : 'warning';
  const taxLabel = economy.assessedTaxPerDay > economy.taxPerDay + 0.05
    ? `~${economy.taxPerDay.toFixed(1)} levied at market of ${economy.assessedTaxPerDay.toFixed(1)} assessed`
    : `~${economy.taxPerDay.toFixed(1)} gold`;

  return {
    eyebrow: 'Backyard',
    title: backyardGardenLabel(garden.kind),
    statusText,
    statusState,
    detailsHtml: `
      <li><span>Parcel</span><span>#${residence.parcelIndex + 1}</span></li>
      <li><span>Population</span><span>${residence.abandoned ? 0 : residence.population}</span></li>
      <li><span>Seasonal output</span><span>${season.label}${sabbathPaused ? ' · paused today by parish policy' : ''}</span></li>
      ${producesFood
        ? `<li><span>Home food today</span><span>${economy.selfFoodPerDay.toFixed(1)} (${Math.round(def.foodSelfShare * 100)}% of plot food stays home)</span></li>
           <li><span>Household food stock</span><span>${foodStock}</span></li>`
        : ''}
      <li><span>Marketplace link</span><span>${hasMarketAccess ? 'Road-connected' : 'None — sales paused'}</span></li>
      <li><span>Market activity today</span><span>${economy.activityPerDay.toFixed(1)} gold${!hasMarketAccess ? ' · needs a road path to a completed marketplace' : seasonalMultiplier <= 1e-9 ? ' · no output today' : ''}</span></li>
      <li><span>Market toll (${economy.taxPercent})</span><span>${taxLabel}${staffedTownHall ? '' : ` · ${Math.round(taxCollectionMultiplier * 100)}% collection without a staffed clerk`} · waits in the serving market lockbox</span></li>
      <li><span>Household savings</span><span>${formatBackyardSavingsLabel(economy.netWealthPerDay, hasMarketAccess)}</span></li>
      <li><span>Build cost</span><span>${formatBackyardGardenCost(garden.kind)}</span></li>
    `,
    demolish: {
      visible: true,
      label: 'Remove garden',
      hint: `Leaves about ${formatBackyardGardenSalvage(garden.kind)} in a visible pile where the improvement stood (${Math.round(TIMBER_SALVAGE_FRACTION * 100)}% timber, ${Math.round(STONE_SALVAGE_FRACTION * 100)}% stone). A free hauler must cart it to connected storage before this backyard can be rebuilt.`,
    },
    labor: hiddenLabor(),
  };
}

function renderEmptyBackyardPicker(
  residence: Extract<InspectableTarget, { kind: 'backyard' }>['residence'],
  zone: BurgageZoneState,
  context: InspectorRenderContext,
): InspectorView {
  const totals = context.resourceTotals;
  const abandoned = residence.abandoned;
  const placement = backyardGardenPlacement(residence, zone);
  const blockingPile = placement
    ? Array.from(context.gameState.buildings.values()).find(
        (building) =>
          building.kind === 'salvage_pile'
          && Math.hypot(building.x - placement.x, building.z - placement.z) <= 3,
      ) ?? null
    : null;
  const options = BACKYARD_GARDEN_KINDS.map((kind) => {
    const def = BACKYARD_GARDEN_DEFINITIONS[kind];
    const tag = def.foodPerPersonPerSec > 0 ? 'Food' : 'Market';
    const cost = getBackyardGardenCost(kind);
    const affordable = !abandoned
      && blockingPile === null
      && canAffordBackyardGarden(totals, kind);
    const disabledReason = abandoned
      ? 'Cannot plant while the residence is abandoned.'
      : blockingPile
        ? 'Haul away the reclaimed timber and stone from this backyard first.'
      : affordable
        ? ''
        : `Need ${cost.timber} timber and ${cost.stone} stone (you have ${Math.floor(totals.timber)} timber, ${Math.floor(totals.stone)} stone).`;
    return `
      <li class="backyard-picker-row">
        <button
          type="button"
          class="backyard-picker-option${affordable ? '' : ' backyard-picker-option--disabled'}"
          data-inspector-action="place-garden"
          data-garden-kind="${kind}"
          ${affordable ? '' : 'disabled'}
          ${disabledReason ? `title="${disabledReason}"` : ''}
        >
          <span class="backyard-picker-option__title">${backyardGardenLabel(kind)}</span>
          <span class="backyard-picker-option__meta">
            <span class="backyard-picker-option__tag">${tag}</span>
            <span class="backyard-picker-option__cost">${cost.timber}t · ${cost.stone}s</span>
          </span>
        </button>
      </li>
    `;
  }).join('');

  return {
    eyebrow: 'Backyard',
    title: 'Empty backyard',
    statusText: abandoned
      ? 'Abandoned — gardens unavailable'
      : blockingPile
        ? 'Reclamation pile blocks rebuilding'
        : 'Pick a garden type',
    statusState: abandoned || blockingPile ? 'warning' : 'neutral',
    detailsHtml: `
      <li><span>Parcel</span><span>#${residence.parcelIndex + 1} of ${zone.plotCount}</span></li>
      <li><span>Population</span><span>${residence.abandoned ? 0 : residence.population}</span></li>
      <li><span>Available timber</span><span>${Math.floor(totals.timber)}</span></li>
      <li><span>Available stone</span><span>${Math.floor(totals.stone)}</span></li>
    `,
    demolish: { visible: false, hint: '' },
    labor: hiddenLabor(),
    supplementalPanelHtml: `
      <p class="resource-inspector-note">${blockingPile
        ? 'A free hauler needs a road-connected destination with room for both materials. Select the pile to inspect its route blockers.'
        : 'Orchards and gardens cost timber and stone from your settlement stockpile.'}</p>
      <ul class="backyard-picker-list">${options}</ul>
    `,
  };
}

export function parseGardenPickerKind(button: HTMLElement): BackyardGardenKind | null {
  const option = button.closest<HTMLButtonElement>('[data-inspector-action="place-garden"]');
  if (!option || option.disabled) {
    return null;
  }
  const value = option.getAttribute('data-garden-kind');
  if (!value) return null;
  return (BACKYARD_GARDEN_KINDS as readonly string[]).includes(value)
    ? (value as BackyardGardenKind)
    : null;
}
