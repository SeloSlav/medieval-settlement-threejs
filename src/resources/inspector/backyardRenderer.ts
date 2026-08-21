import {
  BACKYARD_GARDEN_DEFINITIONS,
  BACKYARD_GARDEN_KINDS,
  BACKYARD_GARDEN_PICKER_KINDS,
  ORCHARD_SPECIALIZATION_KINDS,
  backyardGardenLabel,
  backyardGardenProductSummary,
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
  RESIDENCE_LUXURY_JAM_CAPACITY,
} from '../../generated/gameBalance.ts';
import {
  backyardFoodReserveDays,
  backyardFoodReserveTarget,
  backyardGardenMarketChannel,
  backyardGardenSeasonStatus,
} from '../../economy/backyardGardenTick.ts';
import { edibleFoodStock } from '../../economy/foodInventory.ts';
import {
  householdProjectFunding,
  residenceBackyardProject,
  type ResidenceBackyardProject,
} from '../../economy/residenceUpgrade.ts';
import {
  CONSTRUCTION_PRIORITIES,
  constructionPriorityLabel,
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
  if (garden.kind === 'orchard') {
    return renderOrchardSpecializationPicker(residence, garden, context);
  }

  const def = BACKYARD_GARDEN_DEFINITIONS[garden.kind];
  const producesFood = def.foodPerPersonPerSec > 0;
  const marketChannel = backyardGardenMarketChannel(garden.kind);
  const foodStock = edibleFoodStock(residence);
  const taxRate = context.getEconomicActivityTaxRate?.() ?? ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT;
  const hasMarketAccess = marketChannel !== null
    && context.worldQueries.isResidenceConnectedToMarketplace(residence, marketChannel);
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
    Math.max(0, garden.firstHarvestDay - clock.totalDays),
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
      tier: residence.tier,
      currentFoodStock: foodStock,
    },
  );
  const stallLabel = marketChannel === 'food'
    ? 'Granary-run food group'
    : marketChannel === 'goods'
      ? 'Storehouse-run goods group'
      : null;
  const statusText = sabbathPaused
      ? 'Paused — Sunday Sabbath'
      : garden.kind === 'flower_garden' && season.growing
        ? 'Flowering — no market stall needed'
        : season.harvestable
          ? marketChannel === null || hasMarketAccess
            ? 'Harvestable — household collection active'
            : 'Harvestable — surplus sharing unavailable'
          : season.growing
            ? 'Growing — not harvestable yet'
            : season.phase === 'post_harvest'
              ? 'Post-harvest — crop cleared'
              : 'Dormant — no harvest';
  const statusState = sabbathPaused
    ? 'idle'
    : season.harvestable && marketChannel !== null && !hasMarketAccess
      ? 'warning'
      : season.growing || season.harvestable
        ? 'ok'
        : 'idle';
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
      <li><span>Crop phase</span><span>${season.label}${sabbathPaused ? ' · household work paused today by parish policy' : ''}</span></li>
      <li><span>Harvest window</span><span>${season.harvestWindow}</span></li>
      <li><span>Product</span><span>${backyardGardenProductSummary(garden.kind)}</span></li>
      ${BACKYARD_GARDEN_DEFINITIONS[garden.kind].firstHarvestDays > 0
        ? `<li><span>First harvest</span><span>${garden.firstHarvestDay > clock.totalDays
          ? `${garden.firstHarvestDay - clock.totalDays} days remaining`
          : 'Planting established'}</span></li>
           <li><span>Yield efficiency</span><span>${Math.round(BACKYARD_GARDEN_DEFINITIONS[garden.kind].yieldEfficiency * 100)}%</span></li>`
        : ''}
      ${BACKYARD_GARDEN_DEFINITIONS[garden.kind].jamPerPersonPerSec > 0
        ? `<li><span>Household jam</span><span>${garden.jamStock.toFixed(1)} / ${RESIDENCE_LUXURY_JAM_CAPACITY} jars · reserved for tier-4 luxury comfort</span></li>`
        : ''}
      ${producesFood
        ? `<li><span>Home food today</span><span>${economy.selfFoodPerDay.toFixed(1)} (${hasMarketAccess ? `fills the tier ${residence.tier} ${reserveDays}-day reserve first` : '100% kept without a staffed stall'})</span></li>
           <li><span>Shared market food today</span><span>${economy.marketFoodPerDay.toFixed(1)}${hasMarketAccess ? ' pooled for other households' : ' — household keeps the full crop without a stall'}</span></li>
           <li><span>Household food reserve</span><span>${Math.round(foodStock)} / ${Math.ceil(reserveTarget)}</span></li>`
        : ''}
      ${garden.kind === 'herb_garden'
        ? '<li><span>Herb mix</span><span>Rosemary and sage are perennial; parsley and tender growth are seasonal. Fresh cutting pauses in winter, while remedies already stored indoors remain available.</span></li>'
        : garden.kind === 'flower_garden'
          ? '<li><span>Flower effect</span><span>Pollinator forage and settlement attraction; flowers create no saleable commodity or passive gold</span></li>'
          : garden.kind === 'goat_pen'
            ? '<li><span>Trade-off</span><span>Uses no pasture, but alternates one low milk/meat stream; produces no wool, plough power, or collectable field manure</span></li>'
            : garden.kind === 'backyard_apiary'
              ? '<li><span>Trade-off</span><span>Seasonal honey and a minor local pollination contribution; much less output and reach than a staffed forest apiary</span></li>'
              : ''}
      <li><span>Household labor</span><span>No assigned labor slot. Occupied households tend and harvest automatically; off-duty residents visibly act out garden work, while production remains household-tick based.</span></li>
      <li><span>Market stall use</span><span>${marketChannel === null
        ? 'None — this garden has no saleable commodity and claims no table'
        : hasMarketAccess
          ? `${stallLabel} connected · reuses the staffed group and claims no extra Marketplace table or depot worker`
          : `Surplus sharing unavailable — needs a road-connected Marketplace with a staffed ${marketChannel === 'food' ? 'Granary food group' : 'Storehouse goods group'}; household production continues`}</span></li>
      ${marketChannel === null
        ? ''
        : `<li><span>Local trade value today</span><span>${economy.activityPerDay.toFixed(1)} gold${!hasMarketAccess ? ' · surplus selling paused' : seasonalMultiplier <= 1e-9 ? ' · no harvest today' : ''}</span></li>`}
      <li><span>Household services</span><span>${formatResidenceServiceConsequence(service)}</span></li>
      ${marketChannel === null
        ? ''
        : `<li><span>Local market levy (${economy.taxPercent})</span><span>${taxLabel}${staffedTownHall ? '' : ` · ${Math.round(taxCollectionMultiplier * 100)}% collection without a staffed clerk`} · held in the market lockbox until a free hauler carts it to the civic treasury</span></li>
      <li><span>Household savings</span><span>${formatBackyardSavingsLabel(economy.netWealthPerDay, hasMarketAccess)}</span></li>`}
      <li><span>Build cost</span><span>${renderBuildingResourceCost(getBackyardGardenCost(garden.kind))}</span></li>
    `,
    supplementalPanelHtml: `${garden.kind === 'flower_garden' && !garden.flowerLuxuryUpgraded
      ? `<div class="inspector-action-panel">
          <p class="resource-inspector-note">Tier-4 households can add selected bulbs, cutting beds, and bouquet tools. The garden keeps its pollinator and attraction effects while satisfying the luxury-comfort need.</p>
          <button type="button" class="resource-action-button" data-action="upgrade-flower-luxury" ${residence.tier < 4 ? 'disabled title="Requires a tier-4 residence"' : ''}>Cultivate luxury flowers · ${BACKYARD_GARDEN_DEFINITIONS.flower_garden.luxuryUpgradeGoldCost} gold</button>
        </div>`
      : garden.kind === 'flower_garden' && garden.flowerLuxuryUpgraded
        ? '<p class="resource-inspector-note">Luxury cut flowers are active: this home satisfies its tier-4 luxury-comfort need without consuming jam.</p>'
        : ''}<p class="resource-inspector-note">${producesFood
      ? `The household keeps edible output until its ${reserveDays}-day reserve is filled. Only physical overflow becomes Marketplace inventory. Gardens do not compete for a fourth food slot: they share the existing Granary-staffed food group, its inventory capacity, and its throughput.`
      : marketChannel === 'goods'
        ? 'The household fills its remedy store first. Surplus uses the existing Storehouse-staffed goods group without reserving another table; it still shares Marketplace inventory capacity and throughput.'
        : 'This is a household amenity and pollinator forage. It needs no Marketplace staffing and creates no passive sale or levy.'}</p>`,
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
    const cost = getBackyardGardenCost(kind);
    const materialsAffordable = canAffordBackyardGarden(totals, kind);
    const funding = householdProjectFunding(
      residence.householdWealth,
      BACKYARD_GARDEN_DEFINITIONS[kind].goldCost,
      totals.gold,
      context.gameState.physicalFoundingSiteEnabled === true,
    );
    const affordable = !underConstruction
      && blockingPile === null
      && materialsAffordable
      && funding.ready;
    const disabledReason = underConstruction
        ? 'Finish the cottage before improving its backyard.'
      : blockingPile
        ? 'Haul away the reclaimed timber and stone from this backyard first.'
      : !materialsAffordable
        ? `Needs ${cost.timber} timber and ${cost.stone} stone (available ${Math.floor(totals.timber)} timber and ${Math.floor(totals.stone)} stone).`
      : !funding.ready
        ? `Needs ${formatProjectAmount(funding.treasuryShortfall)} more treasury gold.`
        : '';
    const fundingLabel = `Household ${formatProjectAmount(funding.householdContribution)} · Treasury ${formatProjectAmount(funding.civicGoldRequired)}`;
    return `
      <li class="backyard-picker-row">
        <button
          type="button"
          class="backyard-picker-option${affordable ? '' : ' backyard-picker-option--disabled'}"
          data-inspector-action="place-garden"
          data-garden-kind="${kind}"
          aria-label="Build ${backyardGardenLabel(kind)} — ${formatBackyardGardenCost(kind)}"
          ${affordable ? '' : 'disabled'}
          ${disabledReason ? `title="${disabledReason}"` : ''}
        >
          <span class="backyard-picker-option__icon" aria-hidden="true"></span>
          <span class="backyard-picker-option__title">${backyardGardenPickerLabel(kind)}</span>
          <span class="backyard-picker-option__cost">${renderBuildingResourceCost(cost, { compact: true })}</span>
          <span class="backyard-picker-option__funding">${fundingLabel}</span>
        </button>
      </li>
    `;
  }).join('');

  return {
    eyebrow: 'Backyard',
    title: 'Backyard extension',
    statusText: underConstruction
        ? 'Cottage construction must finish'
      : blockingPile
        ? 'Reclamation pile blocks rebuilding'
        : 'Choose an extension',
    statusState: underConstruction || blockingPile ? 'warning' : 'neutral',
    detailsHtml: `
      <li><span>Parcel</span><span>#${residence.parcelIndex + 1} of ${zone.plotCount}</span></li>
      <li><span>Population</span><span>${residence.population}</span></li>
      <li><span>Available timber</span><span>${Math.floor(totals.timber)}</span></li>
      <li><span>Available stone</span><span>${Math.floor(totals.stone)}</span></li>
      <li><span>Available treasury</span><span>${Math.floor(totals.gold)} gold</span></li>
    `,
    demolish: { visible: false, hint: '' },
    labor: hiddenLabor(),
    supplementalPanelHtml: `
      <p class="resource-inspector-note">${blockingPile
        ? 'A free hauler needs a road-connected destination with room for both materials. Select the pile to inspect its route blockers.'
        : underConstruction
          ? 'The backyard stays unworked while founders live at camp and the cottage frame is raised.'
          : 'Choose one extension. The household contributes only savings above its protected reserve; the treasury automatically grants the rest. The quote is committed when works begin, while timber and stone remain physical carted goods.'}</p>
      <ul class="backyard-picker-list">${options}</ul>
    `,
  };
}

function renderOrchardSpecializationPicker(
  residence: Extract<InspectableTarget, { kind: 'backyard' }>['residence'],
  garden: NonNullable<Extract<InspectableTarget, { kind: 'backyard' }>['garden']>,
  context: InspectorRenderContext,
): InspectorView {
  const orchardGold = BACKYARD_GARDEN_DEFINITIONS.orchard.goldCost;
  const options = ORCHARD_SPECIALIZATION_KINDS.map((kind) => {
    const def = BACKYARD_GARDEN_DEFINITIONS[kind];
    const plantingGold = Math.max(0, def.goldCost - orchardGold);
    const funding = householdProjectFunding(
      residence.householdWealth,
      plantingGold,
      context.resourceTotals.gold,
      context.gameState.physicalFoundingSiteEnabled === true,
    );
    const ready = funding.ready;
    const harvestMonths = def.harvestStartMonth === def.harvestEndMonth
      ? monthName(def.harvestStartMonth)
      : `${monthName(def.harvestStartMonth)}–${monthName(def.harvestEndMonth)}`;
    return `<li class="backyard-picker-row">
      <button type="button" class="backyard-picker-option${ready ? '' : ' backyard-picker-option--disabled'}"
        data-inspector-action="specialize-orchard" data-garden-kind="${kind}"
        ${ready ? '' : 'disabled'} aria-label="Plant ${backyardGardenLabel(kind)}">
        <span class="backyard-picker-option__icon" aria-hidden="true"></span>
        <span class="backyard-picker-option__title">${backyardGardenLabel(kind)}</span>
        <span class="backyard-picker-option__cost">${plantingGold} gold · first harvest ${def.firstHarvestDays} days</span>
        <span class="backyard-picker-option__funding">${harvestMonths} · ${Math.round(def.yieldEfficiency * 100)}% efficiency${def.jamPerPersonPerSec > 0 ? ' · makes jam' : ''}</span>
      </button>
    </li>`;
  }).join('');
  return {
    eyebrow: 'Completed orchard',
    title: backyardGardenLabel(garden.kind),
    statusText: 'Choose trees or fruiting bushes',
    statusState: 'neutral',
    detailsHtml: `
      <li><span>Population</span><span>${residence.population}</span></li>
      <li><span>Construction</span><span>Complete · no builder assigned</span></li>
      <li><span>Planting</span><span>Unselected · no production yet</span></li>
    `,
    supplementalPanelHtml: `<p class="resource-inspector-note">Planting is a permanent orchard choice until demolition. Species differ in establishment time, harvest window, output efficiency, and preserve yield.</p><ul class="backyard-picker-list">${options}</ul>`,
    demolish: {
      visible: true,
      label: 'Demolish orchard',
      hint: 'Removes the orchard so this backyard can choose any extension again after reclaimed materials are hauled away.',
    },
    labor: hiddenLabor(),
  };
}

function monthName(month: number): string {
  return ['?', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month] ?? '?';
}

function backyardGardenPickerLabel(kind: BackyardGardenKind): string {
  switch (kind) {
    case 'orchard': return 'Orchard';
    case 'apple_orchard': return 'Apple orchard';
    case 'cherry_orchard': return 'Cherry orchard';
    case 'vegetable_garden': return 'Vegetables';
    case 'flower_garden': return 'Flowers';
    case 'herb_garden': return 'Herbs';
    case 'hen_yard': return 'Hens';
    case 'goat_pen': return 'Goats';
    case 'backyard_apiary': return 'Apiary';
    case 'pear_orchard': return 'Pear orchard';
    case 'aronia_orchard': return 'Aronia bushes';
    case 'rosehip_orchard': return 'Rosehip bushes';
  }
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
      <li><span>Coin onsite</span><span>${formatProjectAmount(project.delivered.gold)} / ${formatProjectAmount(project.required.gold)} · ${formatProjectAmount(project.reserved.gold)} at treasury source</span></li>
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
      <div class="inspector-action-panel">
        <p class="resource-inspector-note">Construction priority — a shared household builder and real source carts compete with cottages, house upgrades, and other construction.</p>
        <div class="resource-action-row">${priorityButtons}</div>
      </div>
    `,
  };
}

function backyardPriorityButton(
  priority: ConstructionPriority,
  current: ConstructionPriority,
): string {
  return `<button type="button" class="resource-action-button" data-residence-upgrade-priority="${priority}" ${
    priority === current ? 'disabled' : ''
  }>${constructionPriorityLabel(priority)}</button>`;
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

export function parseOrchardSpecializationKind(button: HTMLElement): BackyardGardenKind | null {
  const option = button.closest<HTMLButtonElement>(
    '[data-inspector-action="specialize-orchard"]',
  );
  if (!option || option.disabled) return null;
  const value = option.dataset.gardenKind;
  if (!value) return null;
  return ORCHARD_SPECIALIZATION_KINDS.includes(value as BackyardGardenKind)
    ? value as BackyardGardenKind
    : null;
}
