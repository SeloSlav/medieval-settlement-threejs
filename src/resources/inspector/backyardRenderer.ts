import {
  BACKYARD_GARDEN_DEFINITIONS,
  BACKYARD_GARDEN_KINDS,
  BACKYARD_GARDEN_PICKER_KINDS,
  backyardGardenLabel,
  backyardGardenProductSummary,
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
  backyardFoodReserveDays,
  backyardFoodReserveTarget,
  backyardGardenSeasonStatus,
} from '../../economy/backyardGardenTick.ts';
import { edibleFoodStock } from '../../economy/foodInventory.ts';
import {
  residenceBackyardProject,
  type ResidenceBackyardProject,
} from '../../economy/residenceUpgrade.ts';
import {
  CONSTRUCTION_PRIORITIES,
  type ConstructionPriority,
} from '../../logistics/constructionPriority.ts';
import { settlementHasStaffedChapel } from '../../logistics/landmarkAccess.ts';
import { backyardGardenPlacement } from '../../residences/backyardPosition.ts';
import {
  formatResidenceServiceConsequence,
  residenceServiceState,
} from '../../economy/residenceSatisfaction.ts';
import { gameClock } from '../../world/gameCalendar.ts';
import { environmentFor } from '../../world/seasonPolicy.ts';
import type { BurgageZoneState, InspectableTarget } from '../types.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import { hiddenLabor } from './renderInspectableTarget.ts';
import { renderBuildingResourceCost } from '../../ui/resourceCost.ts';

export function renderBackyardInspector(
  target: Extract<InspectableTarget, { kind: 'backyard' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { residence, zone, garden } = target;

  if (!garden) {
    return renderEmptyBackyardPicker(residence, zone, context);
  }

  const def = BACKYARD_GARDEN_DEFINITIONS[garden.kind];
  const producesFood = def.foodPerPersonPerSec > 0;
  const foodStock = edibleFoodStock(residence);
  const taxRate = context.getEconomicActivityTaxRate?.() ?? ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT;
  const hasMarketAccess = context.worldQueries.isResidenceConnectedToMarketplace(
    residence,
    producesFood ? 'food' : 'goods',
  );
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
  const service = residenceServiceState(residence);
  const seasonalMultiplier = sabbathPaused ? 0 : season.multiplier;
  const economy = buildBackyardEconomyView(
    garden.kind,
    residence.population,
    taxRate,
    hasMarketAccess,
    {
      seasonalMultiplier,
      taxCollectionMultiplier,
      serviceMultiplier: service.economicMultiplier,
      tier: residence.tier,
      currentFoodStock: foodStock,
    },
  );
  const stallLabel = producesFood
    ? 'Granary-run food stall'
    : 'Storehouse-run goods stall';
  const statusText = sabbathPaused
      ? 'Paused — Sunday Sabbath'
      : !season.active
        ? 'Dormant — out of season'
        : hasMarketAccess
          ? garden.kind === 'apple_orchard' || garden.kind === 'cherry_orchard'
            ? 'Harvesting'
            : 'Growing and trading'
          : `Growing — no staffed ${producesFood ? 'food' : 'goods'} stall`;
  const statusState = !season.active
    ? 'warning'
    : sabbathPaused
      ? 'idle'
      : hasMarketAccess
        ? 'ok'
        : 'warning';
  const taxLabel = economy.assessedTaxPerDay > economy.taxPerDay + 0.05
    ? `~${economy.taxPerDay.toFixed(1)} levied at market of ${economy.assessedTaxPerDay.toFixed(1)} assessed`
    : `~${economy.taxPerDay.toFixed(1)} gold`;
  const reserveDays = backyardFoodReserveDays(residence.tier);
  const reserveTarget = backyardFoodReserveTarget(residence.tier, residence.population);

  return {
    eyebrow: 'Backyard',
    title: backyardGardenLabel(garden.kind),
    statusText,
    statusState,
    detailsHtml: `
      <li><span>Parcel</span><span>#${residence.parcelIndex + 1}</span></li>
      <li><span>Population</span><span>${residence.population}</span></li>
      <li><span>Seasonal output</span><span>${season.label}${sabbathPaused ? ' · paused today by parish policy' : ''}</span></li>
      <li><span>Product</span><span>${backyardGardenProductSummary(garden.kind)}</span></li>
      ${producesFood
        ? `<li><span>Home food today</span><span>${economy.selfFoodPerDay.toFixed(1)} (${hasMarketAccess ? `fills the tier ${residence.tier} ${reserveDays}-day reserve first` : '100% kept without a staffed stall'})</span></li>
           <li><span>Shared market food today</span><span>${economy.marketFoodPerDay.toFixed(1)}${hasMarketAccess ? ' pooled for other households' : ' — household keeps the full crop without a stall'}</span></li>
           <li><span>Household food reserve</span><span>${Math.round(foodStock)} / ${Math.ceil(reserveTarget)}</span></li>`
        : ''}
      ${garden.kind === 'herb_garden'
        ? '<li><span>Herb sharing</span><span>Household remedies fill first; surplus remedies enter the goods stall for sick homes</span></li>'
        : garden.kind === 'flower_garden'
          ? '<li><span>Flower effect</span><span>Pollinator forage and settlement attraction; flowers create no saleable commodity or passive gold</span></li>'
          : garden.kind === 'goat_pen'
            ? '<li><span>Trade-off</span><span>Uses no pasture, but alternates one low milk/meat stream; produces no wool, plough power, or collectable field manure</span></li>'
            : garden.kind === 'backyard_apiary'
              ? '<li><span>Trade-off</span><span>Seasonal honey and a minor local pollination contribution; much less output and reach than a staffed forest apiary</span></li>'
              : ''}
      <li><span>Marketplace link</span><span>${hasMarketAccess ? `${stallLabel} connected` : `None — needs a Marketplace and staffed ${producesFood ? 'Granary' : 'Storehouse'}`}</span></li>
      <li><span>Local trade value today</span><span>${economy.activityPerDay.toFixed(1)} gold${!hasMarketAccess ? ' · selling paused' : seasonalMultiplier <= 1e-9 ? ' · no output today' : ''}</span></li>
      <li><span>Household services</span><span>${formatResidenceServiceConsequence(service)}</span></li>
      <li><span>Local market levy (${economy.taxPercent})</span><span>${taxLabel}${staffedTownHall ? '' : ` · ${Math.round(taxCollectionMultiplier * 100)}% collection without a staffed clerk`} · held in the market lockbox until a free hauler carts it to the civic treasury</span></li>
      <li><span>Household savings</span><span>${formatBackyardSavingsLabel(economy.netWealthPerDay, hasMarketAccess)}</span></li>
      <li><span>Build cost</span><span>${renderBuildingResourceCost(getBackyardGardenCost(garden.kind))}</span></li>
    `,
    supplementalPanelHtml: `<p class="resource-inspector-note">${producesFood
      ? `The household keeps edible output until its ${reserveDays}-day reserve is filled. Only physical overflow becomes Marketplace inventory for other connected homes.`
      : 'Routine local purchases are aggregated: the seller gains household wealth and one local market levy is assessed. Parish tithes remain a separate later household payment.'}</p>`,
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
  const project = residenceBackyardProject(
    residence,
    context.gameState.deliveryTrips.values(),
  );
  if (project) {
    return renderBackyardProject(residence.parcelIndex, project);
  }
  const totals = context.resourceTotals;
  const underConstruction = residence.tier === 0;
  const placement = backyardGardenPlacement(residence, zone);
  const blockingPile = placement
    ? Array.from(context.gameState.buildings.values()).find(
        (building) =>
          building.kind === 'salvage_pile'
          && Math.hypot(building.x - placement.x, building.z - placement.z) <= 3,
      ) ?? null
    : null;
  const options = BACKYARD_GARDEN_PICKER_KINDS.map((kind) => {
    const def = BACKYARD_GARDEN_DEFINITIONS[kind];
    const tag = def.foodPerPersonPerSec > 0 ? 'Food' : 'Market';
    const cost = getBackyardGardenCost(kind);
    const affordable = !underConstruction
      && blockingPile === null
      && canAffordBackyardGarden(totals, kind);
    const disabledReason = underConstruction
        ? 'Finish the cottage before improving its backyard.'
      : blockingPile
        ? 'Haul away the reclaimed timber and stone from this backyard first.'
      : affordable
        ? ''
        : `Need ${renderBuildingResourceCost(cost, { compact: true })} (available ${Math.floor(totals.timber)} timber, ${Math.floor(totals.stone)} stone).`;
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
            <span class="backyard-picker-option__tag">${tag} · ${backyardGardenProductSummary(kind)}</span>
            <span class="backyard-picker-option__cost">${renderBuildingResourceCost(cost, { compact: true })}</span>
          </span>
        </button>
      </li>
    `;
  }).join('');

  return {
    eyebrow: 'Backyard',
    title: 'Empty backyard',
    statusText: underConstruction
        ? 'Cottage construction must finish'
      : blockingPile
        ? 'Reclamation pile blocks rebuilding'
        : 'Pick a garden type',
    statusState: underConstruction || blockingPile ? 'warning' : 'neutral',
    detailsHtml: `
      <li><span>Parcel</span><span>#${residence.parcelIndex + 1} of ${zone.plotCount}</span></li>
      <li><span>Population</span><span>${residence.population}</span></li>
      <li><span>Available timber</span><span>${Math.floor(totals.timber)}</span></li>
      <li><span>Available stone</span><span>${Math.floor(totals.stone)}</span></li>
    `,
    demolish: { visible: false, hint: '' },
    labor: hiddenLabor(),
    supplementalPanelHtml: `
      <p class="resource-inspector-note">${blockingPile
        ? 'A free hauler needs a road-connected destination with room for both materials. Select the pile to inspect its route blockers.'
        : underConstruction
          ? 'The backyard stays unworked while founders live at camp and the cottage frame is raised.'
          : 'Orchards and gardens cost timber and stone from your settlement stockpile.'}</p>
      <ul class="backyard-picker-list">${options}</ul>
    `,
  };
}

function renderBackyardProject(
  parcelIndex: number,
  project: ResidenceBackyardProject,
): InspectorView {
  const label = backyardGardenLabel(project.kind);
  const incoming = project.incomingTrips.length === 0
    ? 'None'
    : project.incomingTrips.map((trip) =>
      `${formatProjectAmount(trip.amount)} ${trip.cargoKind} <button type="button" class="inspector-jump-button" data-inspect-delivery-trip="${trip.id}" aria-label="Inspect incoming ${trip.cargoKind} cart">Inspect cart</button>`,
    ).join(' · ');
  const priorityButtons = CONSTRUCTION_PRIORITIES.map((priority) =>
    backyardPriorityButton(priority, project.priority),
  ).join('');

  return {
    eyebrow: 'Backyard worksite',
    title: `${label} works`,
    statusText: project.blockers[0]
      ?? `${Math.round(project.progress * 100)}% complete`,
    statusState: project.blockers.length === 0 ? 'ok' : 'warning',
    detailsHtml: `
      <li><span>Parcel</span><span>#${parcelIndex + 1}</span></li>
      <li><span>Improvement</span><span>${label}</span></li>
      <li><span>Builder progress</span><span>${Math.round(project.progress * 100)}%</span></li>
      <li><span>Queue priority</span><span>${project.priorityLabel}</span></li>
      <li><span>Builder</span><span>${project.assignedLabor > 0 ? '1 on backyard works' : 'Waiting for free labor'}</span></li>
      <li><span>Timber onsite</span><span>${formatProjectAmount(project.delivered.timber)} / ${formatProjectAmount(project.required.timber)} · ${formatProjectAmount(project.reserved.timber)} at source</span></li>
      <li><span>Stone onsite</span><span>${formatProjectAmount(project.delivered.stone)} / ${formatProjectAmount(project.required.stone)} · ${formatProjectAmount(project.reserved.stone)} at source</span></li>
      <li><span>Incoming haul</span><span>${incoming}</span></li>
      <li><span>Production</span><span>Begins only after the worksite is complete</span></li>
    `,
    demolish: {
      visible: true,
      label: 'Cancel backyard works',
      hint: `Returns incoming carts and leaves recoverable delivered timber and stone in a visible pile at the backyard.`,
    },
    labor: hiddenLabor(),
    supplementalPanelHtml: `
      <p class="resource-inspector-note">A shared household builder and real source carts compete with cottages, house upgrades, and other construction.</p>
      <div class="inspector-policy-control">
        <span>Construction priority</span>
        <div class="inspector-policy-buttons">${priorityButtons}</div>
      </div>
    `,
  };
}

function backyardPriorityButton(
  priority: ConstructionPriority,
  current: ConstructionPriority,
): string {
  const label = priority === 0
    ? 'Hold'
    : priority === 1
      ? 'Low'
      : priority === 2
        ? 'Normal'
        : 'Urgent';
  return `<button type="button" data-residence-upgrade-priority="${priority}" aria-pressed="${priority === current}">${label}</button>`;
}

function formatProjectAmount(value: number): string {
  const rounded = Math.round(value);
  return Math.abs(value - rounded) < 0.05 ? String(rounded) : value.toFixed(1);
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
