import {
  BACKYARD_GARDEN_DEFINITIONS,
  BACKYARD_GARDEN_KINDS,
  BACKYARD_GARDEN_PICKER_KINDS,
  ANIMAL_PEN_SPECIALIZATION_KINDS,
  ORCHARD_SPECIALIZATION_KINDS,
  VEGETABLE_GARDEN_SPECIALIZATION_KINDS,
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
} from '../../generated/gameBalance.ts';
import {
  backyardFoodReserveDays,
  backyardFoodReserveTarget,
  backyardGardenMarketChannels,
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
import { gameClock } from '../../world/gameCalendar.ts';
import { holidayObservanceForClock } from '../../world/holidayCalendar.ts';
import { environmentFor } from '../../world/seasonPolicy.ts';
import type { BurgageZoneState, InspectableTarget } from '../types.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import { hiddenLabor } from './renderInspectableTarget.ts';
import {
  buildingResourceCostAmounts,
  encodeResourceCostTooltip,
  renderBuildingResourceCost,
} from '../../ui/resourceCost.ts';

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
  if (garden.kind === 'animal_pen') {
    return renderAnimalPenSpecializationPicker(residence, garden, context);
  }
  if (garden.kind === 'vegetable_garden') {
    return renderVegetableGardenSpecializationPicker(residence, garden, context);
  }

  const def = BACKYARD_GARDEN_DEFINITIONS[garden.kind];
  const isLivestockPen = def.specializationOf === 'animal_pen';
  const isSelectedVegetable = def.specializationOf === 'vegetable_garden';
  const producesFood = def.foodPerPersonPerSec > 0;
  const marketChannels = backyardGardenMarketChannels(garden.kind);
  const marketChannel = marketChannels[0] ?? null;
  const foodStock = edibleFoodStock(residence);
  const taxRate = context.getEconomicActivityTaxRate?.() ?? ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT;
  const hasMarketAccess = marketChannel !== null
    && context.worldQueries.isResidenceConnectedToMarketplace(residence, marketChannel);
  const connectedMarketChannels = marketChannels.filter((channel) =>
    context.worldQueries.isResidenceConnectedToMarketplace(residence, channel));
  const hasAnyMarketAccess = connectedMarketChannels.length > 0;
  const hasAllMarketAccess = connectedMarketChannels.length === marketChannels.length;
  const clock = gameClock(context.gameState.tick);
  const environment = environmentFor(
    context.gameState.seed,
    context.worldHydrology,
    clock,
    context.severeWeatherEnabled ?? false,
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
  const holiday = holidayObservanceForClock(clock);
  const calendarPaused = sabbathPaused || holiday !== null;
  const staffedTownHall = Array.from(context.gameState.buildings.values()).some(
    (building) =>
      building.kind === 'town_hall'
      && building.constructionComplete !== false
      && building.assignedLabor > 0,
  );
  const taxCollectionMultiplier = staffedTownHall
    ? 1
    : TOWN_HALL_UNSTAFFED_TAX_COLLECTION_MULTIPLIER;
  const seasonalMultiplier = calendarPaused ? 0 : season.multiplier;
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
  const stallLabel = marketChannels.length > 1
    ? 'Granary-run food group + Storehouse-run hide route'
    : marketChannel === 'food'
      ? 'Granary-run food group'
    : marketChannel === 'goods'
      ? 'Storehouse-run goods group'
      : null;
  const statusText = calendarPaused
      ? `Paused — ${holiday?.label ?? 'Sunday Sabbath'}`
      : garden.kind === 'flower_garden' && season.growing
        ? 'Flowering — no market stall needed'
        : season.harvestable
          ? marketChannel === null || hasAllMarketAccess
            ? 'Harvestable — household collection active'
            : hasAnyMarketAccess
              ? 'Harvestable — some surplus routes unavailable'
              : 'Harvestable — surplus sharing unavailable'
          : season.growing
            ? 'Growing — not harvestable yet'
            : season.phase === 'post_harvest'
              ? 'Post-harvest — crop cleared'
              : 'Dormant — no harvest';
  const statusState = calendarPaused
    ? 'idle'
    : season.harvestable && marketChannel !== null && !hasAllMarketAccess
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
      <li><span>Population</span><span>${residence.population}</span></li>
      <li><span>${isLivestockPen ? 'Husbandry phase' : 'Crop phase'}</span><span>${season.label}${calendarPaused ? ` · household work paused today ${holiday ? `for ${holiday.label}` : 'by parish policy'}` : ''}</span></li>
      <li><span>${isLivestockPen ? 'Collection window' : 'Harvest window'}</span><span>${season.harvestWindow}</span></li>
      <li><span>Product</span><span>${backyardGardenProductSummary(garden.kind)}</span></li>
      ${BACKYARD_GARDEN_DEFINITIONS[garden.kind].firstHarvestDays > 0
        ? `<li><span>${isLivestockPen ? 'First output' : 'First harvest'}</span><span>${garden.firstHarvestDay > clock.totalDays
          ? `${garden.firstHarvestDay - clock.totalDays} days remaining`
          : isLivestockPen ? 'Breeding stock mature' : isSelectedVegetable ? 'Seed crop mature' : 'Planting established'}</span></li>
           <li><span>${isLivestockPen ? 'Husbandry efficiency' : 'Yield efficiency'}</span><span>${Math.round(BACKYARD_GARDEN_DEFINITIONS[garden.kind].yieldEfficiency * 100)}%</span></li>`
        : ''}
      ${isLivestockPen
        ? `<li><span>Gestation / maturity</span><span>${def.gestationDays} days</span></li>
           <li><span>Primary interval</span><span>Every ${def.productionIntervalDays} days during ${formatMonthWindow(def.harvestStartMonth, def.harvestEndMonth)}</span></li>
           ${def.secondaryProductionIntervalDays > 0
             ? `<li><span>Cull interval</span><span>Every ${def.secondaryProductionIntervalDays} days during ${formatMonthWindow(def.secondaryHarvestStartMonth, def.secondaryHarvestEndMonth)}</span></li>`
             : ''}
           ${garden.kind === 'goat_pen'
             ? `<li><span>Untanned hides</span><span>${garden.hideStock.toFixed(1)} / ${def.hideCapacity} retained at this household · produced only with an actual cull</span></li>`
             : ''}`
        : ''}
      ${BACKYARD_GARDEN_DEFINITIONS[garden.kind].jamPerPersonPerSec > 0
        ? `<li><span>${garden.kind === 'aronia_orchard' ? 'Aronia jam' : 'Rosehip jam'}</span><span>${Math.max(0, garden.kind === 'aronia_orchard' ? residence.aroniaJam ?? 0 : residence.rosehipJam ?? 0).toFixed(1)} jars in the household pantry · household labor preserves this share of the harvested fruit rather than creating extra output · transferable preserved food that supports the tier-4 preserved-food standard</span></li>`
        : ''}
      ${producesFood
        ? `<li><span>${isLivestockPen ? 'Average primary home food/day' : 'Home food today'}</span><span>${economy.selfFoodPerDay.toFixed(1)} (${hasMarketAccess ? `fills the tier ${residence.tier} ${reserveDays}-day reserve first` : '100% kept without a staffed stall'})</span></li>
           <li><span>${isLivestockPen ? 'Average primary market overflow/day' : 'Shared market food today'}</span><span>${economy.marketFoodPerDay.toFixed(1)}${hasMarketAccess ? ' pooled for other households' : ' — household keeps the full crop without a stall'}</span></li>
           ${isLivestockPen && def.secondaryProductionIntervalDays > 0
             ? '<li><span>Seasonal culls</span><span>Discrete meat collections are shown by the cull interval above and are not folded into the primary daily average.</span></li>'
             : ''}
           <li><span>Household food reserve</span><span>${Math.round(foodStock)} / ${Math.ceil(reserveTarget)}</span></li>`
        : ''}
      ${garden.kind === 'herb_garden'
        ? '<li><span>Herb mix</span><span>Rosemary and sage are perennial; parsley and tender growth are seasonal. Fresh cutting pauses in winter, while remedies already stored indoors remain available.</span></li>'
        : garden.kind === 'flower_garden'
          ? '<li><span>Flower effect</span><span>Pollinator forage and settlement attraction; flowers create no saleable commodity or passive gold</span></li>'
          : garden.kind === 'chicken_pen'
            ? '<li><span>Trade-off</span><span>Fastest maturity and frequent eggs, with small autumn meat culls; eggs spoil quickly and cannot be preserved at the smokehouse.</span></li>'
          : garden.kind === 'goat_pen'
            ? '<li><span>Trade-off</span><span>Longest maturity, but regular milk can become cheese. Meat and hides arrive only on the much slower cull interval; the pen produces no wool or plough power.</span></li>'
          : garden.kind === 'pig_pen'
            ? '<li><span>Trade-off</span><span>No eggs, milk, or secondary by-product. The household waits for a large autumn pork harvest that can enter the meat-to-cured-meat chain.</span></li>'
          : garden.kind === 'cabbage_garden'
            ? '<li><span>Trade-off</span><span>Costliest seed and slowest maturity, rewarded with the highest yield through a strong July–November harvest.</span></li>'
          : garden.kind === 'carrot_garden'
            ? '<li><span>Trade-off</span><span>Middle seed cost and maturity with a dependable June–November season and balanced yield.</span></li>'
          : garden.kind === 'beetroot_garden'
            ? '<li><span>Trade-off</span><span>Cheapest seed and fastest maturity, beginning in May, but each productive day yields less than carrots or cabbage.</span></li>'
            : garden.kind === 'backyard_apiary'
              ? '<li><span>Trade-off</span><span>Seasonal honey and a minor local pollination contribution; much less output and reach than a staffed forest apiary</span></li>'
              : ''}
      <li><span>Household labor</span><span>No assigned labor slot. Occupied households tend and harvest automatically; off-duty residents visibly act out garden work, while production remains household-tick based.</span></li>
      <li><span>Market stall use</span><span>${marketChannel === null
        ? 'None — this garden has no saleable commodity and claims no table'
        : hasAllMarketAccess
          ? `${stallLabel} connected · reuses the staffed group and claims no extra Marketplace table or depot worker`
          : hasAnyMarketAccess
            ? `Partial surplus sharing — ${connectedMarketChannels.includes('food') ? 'Granary food route connected' : 'Storehouse goods route connected'}; ${connectedMarketChannels.includes('food') ? 'the Storehouse hide/remedy route' : 'the Granary food route'} is unavailable`
          : `Surplus sharing unavailable — needs a road-connected Marketplace with a staffed ${marketChannel === 'food' ? 'Granary food group' : 'Storehouse goods group'}; household production continues`}</span></li>
      ${marketChannel === null
        ? ''
        : `<li><span>Local trade value today</span><span>${economy.activityPerDay.toFixed(1)} gold${!hasMarketAccess ? ' · surplus selling paused' : seasonalMultiplier <= 1e-9 ? ' · no harvest today' : ''}</span></li>`}
      ${marketChannel === null
        ? ''
        : `<li><span>Local market levy (${economy.taxPercent})</span><span>${taxLabel}${staffedTownHall ? '' : ` · ${Math.round(taxCollectionMultiplier * 100)}% collection without a staffed clerk`} · held in the market lockbox until a free hauler carts it to the civic treasury</span></li>
      <li><span>Household savings</span><span>${formatBackyardSavingsLabel(economy.netWealthPerDay, hasMarketAccess)}</span></li>`}
      <li><span>Build cost</span><span>${renderBuildingResourceCost(getBackyardGardenCost(garden.kind))}</span></li>
    `,
    supplementalPanelHtml: `${garden.kind === 'flower_garden' && !garden.flowerLuxuryUpgraded
      ? `<div class="inspector-action-panel" data-inspector-panel-title="Luxury flowers">
          <p class="resource-inspector-note">Tier-3 households can prepare selected bulbs, cutting beds, and bouquet tools for Tier-4 luxury comfort. The garden keeps its pollinator and attraction effects.</p>
          <button type="button" class="resource-action-button resource-action-button--icon" data-action="upgrade-flower-luxury" ${residence.tier < 3 ? 'disabled title="Requires a tier-3 residence"' : ''}><span class="inspector-action-icon" data-action-icon="luxury-flowers" aria-hidden="true"></span><span>Cultivate luxury flowers · ${BACKYARD_GARDEN_DEFINITIONS.flower_garden.luxuryUpgradeGoldCost} gold</span></button>
        </div>`
      : garden.kind === 'flower_garden' && garden.flowerLuxuryUpgraded
        ? '<p class="resource-inspector-note">Luxury cut flowers are active: this home satisfies its tier-4 luxury-comfort need without consuming a market luxury good.</p>'
        : ''}<p class="resource-inspector-note">${producesFood
      ? `The household keeps edible output until its ${reserveDays}-day reserve is filled. Only physical overflow becomes Marketplace inventory. Gardens do not compete for a fourth food slot: they share the existing Granary-staffed food group, its inventory capacity, and its throughput.${garden.kind === 'goat_pen' ? ' Cull hides independently remain at the household until a staffed Storehouse accepts them for a Tannery or Trading Post.' : ''}`
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
    return renderBackyardProject(project);
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
    const blocker = underConstruction
      ? 'cottage unfinished'
      : blockingPile
        ? 'salvage pile blocks site'
        : !materialsAffordable
          ? 'not enough timber or stone'
          : !funding.ready
            ? 'not enough gold'
            : null;
    const actionLabel = `Build ${backyardGardenLabel(kind)}`;
    const optionDetail = `${backyardGardenProductSummary(kind)}${blocker ? ` · Unavailable — ${blocker}` : ''}`;
    const accessibleDetail = `Cost ${formatBackyardGardenCost(kind)}. ${optionDetail}`;
    return `
      <li class="backyard-picker-row">
        <button
          type="button"
          class="resource-action-button backyard-picker-option${affordable ? '' : ' backyard-picker-option--disabled'}"
          data-inspector-action="place-garden"
          data-garden-kind="${kind}"
          data-tooltip-title="${actionLabel}"
          data-tooltip="${optionDetail}"
          data-tooltip-cost="${encodeResourceCostTooltip(buildingResourceCostAmounts(cost))}"
          data-tooltip-cost-label="Extension cost"
          data-tooltip-cost-affordable="${materialsAffordable && funding.ready}"
          aria-label="${actionLabel}. ${accessibleDetail}"
          ${affordable ? '' : 'disabled'}
        >
          <span class="backyard-picker-option__icon" aria-hidden="true"></span>
          <span class="backyard-picker-option__title">${backyardGardenPickerLabel(kind)}</span>
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
    detailsHtml: '',
    demolish: { visible: false, hint: '' },
    labor: hiddenLabor(),
    supplementalPanelHtml: `<ul class="backyard-picker-list">${options}</ul>`,
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
    const efficiency = Math.round(def.yieldEfficiency * 100);
    const actionLabel = `Plant ${backyardGardenLabel(kind)}`;
    const optionDetail = `First harvest ${def.firstHarvestDays}d · ${harvestMonths} · ${efficiency}% yield${def.jamPerPersonPerSec > 0 ? ' · jam' : ''} · permanent${ready ? '' : ' · Unavailable — not enough gold'}`;
    return `<li class="backyard-picker-row">
      <button type="button" class="resource-action-button backyard-picker-option${ready ? '' : ' backyard-picker-option--disabled'}"
        data-inspector-action="specialize-orchard" data-garden-kind="${kind}"
        data-tooltip-title="${actionLabel}" data-tooltip="${optionDetail}"
        data-tooltip-cost="${encodeResourceCostTooltip({ gold: plantingGold })}"
        data-tooltip-cost-label="Planting cost" data-tooltip-cost-affordable="${ready}"
        ${ready ? '' : 'disabled'} aria-label="${actionLabel}. Planting cost ${plantingGold} gold. ${optionDetail}">
        <span class="backyard-picker-option__icon" aria-hidden="true"></span>
        <span class="backyard-picker-option__title">${backyardGardenLabel(kind)}</span>
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
    supplementalPanelHtml: `<ul class="backyard-picker-list">${options}</ul>`,
    demolish: {
      visible: true,
      label: 'Demolish orchard',
      hint: 'Removes the orchard so this backyard can choose any extension again after reclaimed materials are hauled away.',
    },
    labor: hiddenLabor(),
  };
}

function renderAnimalPenSpecializationPicker(
  residence: Extract<InspectableTarget, { kind: 'backyard' }>['residence'],
  garden: NonNullable<Extract<InspectableTarget, { kind: 'backyard' }>['garden']>,
  context: InspectorRenderContext,
): InspectorView {
  const shellGold = BACKYARD_GARDEN_DEFINITIONS.animal_pen.goldCost;
  const options = ANIMAL_PEN_SPECIALIZATION_KINDS.map((kind) => {
    const def = BACKYARD_GARDEN_DEFINITIONS[kind];
    const stockingGold = Math.max(0, def.goldCost - shellGold);
    const funding = householdProjectFunding(
      residence.householdWealth,
      stockingGold,
      context.resourceTotals.gold,
      context.gameState.physicalFoundingSiteEnabled === true,
    );
    const primaryProduct = kind === 'chicken_pen'
      ? 'Eggs'
      : kind === 'goat_pen'
        ? 'Milk'
        : 'Pork';
    const secondary = def.secondaryProductionIntervalDays > 0
      ? ` · cull ${def.secondaryProductionIntervalDays}d ${formatMonthWindow(def.secondaryHarvestStartMonth, def.secondaryHarvestEndMonth)}`
      : '';
    const actionLabel = `House ${backyardGardenLabel(kind)}`;
    const optionDetail = `First output ${def.firstHarvestDays}d · ${primaryProduct} every ${def.productionIntervalDays}d ${formatMonthWindow(def.harvestStartMonth, def.harvestEndMonth)}${secondary} · permanent${funding.ready ? '' : ' · Unavailable — not enough gold'}`;
    return `<li class="backyard-picker-row">
      <button type="button" class="resource-action-button backyard-picker-option${funding.ready ? '' : ' backyard-picker-option--disabled'}"
        data-inspector-action="specialize-animal-pen" data-garden-kind="${kind}"
        data-tooltip-title="${actionLabel}" data-tooltip="${optionDetail}"
        data-tooltip-cost="${encodeResourceCostTooltip({ gold: stockingGold })}"
        data-tooltip-cost-label="Stocking cost" data-tooltip-cost-affordable="${funding.ready}"
        ${funding.ready ? '' : 'disabled'} aria-label="${actionLabel}. Stocking cost ${stockingGold} gold. ${optionDetail}">
        <span class="backyard-picker-option__icon" aria-hidden="true"></span>
        <span class="backyard-picker-option__title">${backyardGardenLabel(kind)}</span>
      </button>
    </li>`;
  }).join('');
  return {
    eyebrow: 'Completed animal pen',
    title: backyardGardenLabel(garden.kind),
    statusText: 'Choose livestock for the enclosure',
    statusState: 'neutral',
    detailsHtml: `
      <li><span>Population</span><span>${residence.population}</span></li>
      <li><span>Construction</span><span>Complete · no builder assigned</span></li>
      <li><span>Livestock</span><span>Unselected · no production yet</span></li>
    `,
    supplementalPanelHtml: `<ul class="backyard-picker-list">${options}</ul>`,
    demolish: {
      visible: true,
      label: 'Demolish animal pen',
      hint: 'Removes the enclosure so this backyard can choose any extension again after reclaimed materials are hauled away.',
    },
    labor: hiddenLabor(),
  };
}

function renderVegetableGardenSpecializationPicker(
  residence: Extract<InspectableTarget, { kind: 'backyard' }>['residence'],
  garden: NonNullable<Extract<InspectableTarget, { kind: 'backyard' }>['garden']>,
  context: InspectorRenderContext,
): InspectorView {
  const shellGold = BACKYARD_GARDEN_DEFINITIONS.vegetable_garden.goldCost;
  const options = VEGETABLE_GARDEN_SPECIALIZATION_KINDS.map((kind) => {
    const def = BACKYARD_GARDEN_DEFINITIONS[kind];
    const seedGold = Math.max(0, def.goldCost - shellGold);
    const funding = householdProjectFunding(
      residence.householdWealth,
      seedGold,
      context.resourceTotals.gold,
      context.gameState.physicalFoundingSiteEnabled === true,
    );
    const harvestMonths = formatMonthWindow(def.harvestStartMonth, def.harvestEndMonth);
    const efficiency = Math.round(def.yieldEfficiency * 100);
    const actionLabel = `Purchase ${backyardGardenLabel(kind)} seed`;
    const optionDetail = `First harvest ${def.firstHarvestDays}d · ${harvestMonths} · ${efficiency}% yield · permanent${funding.ready ? '' : ' · Unavailable — not enough gold'}`;
    return `<li class="backyard-picker-row">
      <button type="button" class="resource-action-button backyard-picker-option${funding.ready ? '' : ' backyard-picker-option--disabled'}"
        data-inspector-action="specialize-vegetable-garden" data-garden-kind="${kind}"
        data-tooltip-title="${actionLabel}" data-tooltip="${optionDetail}"
        data-tooltip-cost="${encodeResourceCostTooltip({ gold: seedGold })}"
        data-tooltip-cost-label="Seed cost" data-tooltip-cost-affordable="${funding.ready}"
        ${funding.ready ? '' : 'disabled'} aria-label="${actionLabel}. Seed cost ${seedGold} gold. ${optionDetail}">
        <span class="backyard-picker-option__icon" aria-hidden="true"></span>
        <span class="backyard-picker-option__title">${backyardGardenLabel(kind)}</span>
      </button>
    </li>`;
  }).join('');
  return {
    eyebrow: 'Completed vegetable garden',
    title: backyardGardenLabel(garden.kind),
    statusText: 'Choose seed for every bed',
    statusState: 'neutral',
    detailsHtml: `
      <li><span>Population</span><span>${residence.population}</span></li>
      <li><span>Construction</span><span>Complete · no builder assigned</span></li>
      <li><span>Seed crop</span><span>Unselected · prepared beds produce no food</span></li>
    `,
    supplementalPanelHtml: `<ul class="backyard-picker-list">${options}</ul>`,
    demolish: {
      visible: true,
      label: 'Demolish vegetable garden',
      hint: 'Removes the prepared beds so this backyard can choose any extension again after reclaimed materials are hauled away.',
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
    case 'cabbage_garden': return 'Cabbages';
    case 'carrot_garden': return 'Carrots';
    case 'beetroot_garden': return 'Beetroot';
    case 'flower_garden': return 'Flowers';
    case 'herb_garden': return 'Herbs';
    case 'animal_pen': return 'Animal pen';
    case 'chicken_pen': return 'Chickens';
    case 'goat_pen': return 'Goats';
    case 'pig_pen': return 'Pigs';
    case 'backyard_apiary': return 'Apiary';
    case 'pear_orchard': return 'Pear orchard';
    case 'aronia_orchard': return 'Aronia bushes';
    case 'rosehip_orchard': return 'Rosehip bushes';
  }
}

function renderBackyardProject(project: ResidenceBackyardProject): InspectorView {
  const label = backyardGardenLabel(project.kind);
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
      <li><span>Improvement</span><span>${label}</span></li>
      <li><span>Builder progress</span><span>${Math.round(project.progress * 100)}%</span></li>
      <li><span>Queue priority</span><span>${project.priorityLabel}</span></li>
      <li><span>Builder</span><span>${project.assignedLabor > 0 ? '1 on backyard works' : 'Waiting for free labor'}</span></li>
      <li><span>Timber onsite</span><span>${formatProjectAmount(project.delivered.timber)} / ${formatProjectAmount(project.required.timber)} · ${formatProjectAmount(project.reserved.timber)} at source</span></li>
      <li><span>Stone onsite</span><span>${formatProjectAmount(project.delivered.stone)} / ${formatProjectAmount(project.required.stone)} · ${formatProjectAmount(project.reserved.stone)} at source</span></li>
      <li><span>Coin onsite</span><span>${formatProjectAmount(project.delivered.gold)} / ${formatProjectAmount(project.required.gold)} · ${formatProjectAmount(project.reserved.gold)} at treasury source</span></li>
      <li><span>Production</span><span>Begins only after the worksite is complete</span></li>
    `,
    demolish: {
      visible: true,
      label: 'Cancel backyard works',
      hint: `Returns incoming carts and leaves recoverable delivered timber and stone in a visible pile at the backyard.`,
    },
    labor: hiddenLabor(),
    supplementalPanelHtml: `
      <div class="inspector-action-panel" data-inspector-panel-title="Construction priority">
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

export function parseAnimalPenSpecializationKind(button: HTMLElement): BackyardGardenKind | null {
  const option = button.closest<HTMLButtonElement>(
    '[data-inspector-action="specialize-animal-pen"]',
  );
  if (!option || option.disabled) return null;
  const value = option.dataset.gardenKind;
  if (!value) return null;
  return ANIMAL_PEN_SPECIALIZATION_KINDS.includes(value as BackyardGardenKind)
    ? value as BackyardGardenKind
    : null;
}

export function parseVegetableGardenSpecializationKind(
  button: HTMLElement,
): BackyardGardenKind | null {
  const option = button.closest<HTMLButtonElement>(
    '[data-inspector-action="specialize-vegetable-garden"]',
  );
  if (!option || option.disabled) return null;
  const value = option.dataset.gardenKind;
  if (!value) return null;
  return VEGETABLE_GARDEN_SPECIALIZATION_KINDS.includes(value as BackyardGardenKind)
    ? value as BackyardGardenKind
    : null;
}

function formatMonthWindow(startMonth: number, endMonth: number): string {
  return startMonth === endMonth
    ? monthName(startMonth)
    : `${monthName(startMonth)}–${monthName(endMonth)}`;
}
