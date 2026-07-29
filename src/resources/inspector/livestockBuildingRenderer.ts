import {
  canStoreFullSheepClip,
  effectiveLivestockBreedingReserve,
  isLivestockHaymakingMonth,
  isLivestockCullMonth,
  isSheepShearingMonth,
  livestockHaymakingPresets,
  livestockPolicyDefinition,
  livestockReservePresets,
  projectedSheepFleece,
  projectedLivestockCullYield,
} from '../../economy/livestockPolicy.ts';
import { projectLivestockFodderHolding } from '../../economy/livestockFodder.ts';
import { formatProvisionRunway } from '../../economy/settlementProvisioning.ts';
import { staffingPriorityLabel } from '../../economy/staffingPriority.ts';
import { weaverFibreDeliveryPreferenceLabel } from '../../economy/weaverInputPolicy.ts';
import { gameClock } from '../../world/gameCalendar.ts';
import {
  CATTLE_MAX_PLOUGH_SUPPORTED_FIELDS,
  CATTLE_PLOUGH_WORK_MULTIPLIER,
  LIVESTOCK_HAYMAKING_START_MONTH,
  LIVESTOCK_HAY_STORAGE_CAPACITY,
  LIVESTOCK_WINTER_FODDER_RESERVE_DAYS,
} from '../../generated/gameBalance.ts';
import { cattleManurePerCycle } from '../../farming/manurePlanning.ts';
import { settlementHasStaffedChapel } from '../../logistics/landmarkAccess.ts';
import { environmentFor } from '../../world/seasonPolicy.ts';
import { getBuildingDefinition } from '../buildings.ts';
import { buildingStorageCaps } from '../resourceTotals.ts';
import {
  cargoKindLabel,
  formatTripPhaseLabel,
  onsiteBuildingLabor,
} from '../../logistics/deliveryTrips.ts';
import {
  householdFoodReserve,
  institutionalFoodDutyLabel,
  institutionalFoodSurplus,
} from '../../logistics/foodLogistics.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildingDemolishHint,
  buildingExtentRow,
  buildingLaborView,
  buildingRoadAccessRow,
} from './buildingCommon.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';

const SPECIES_LABEL = {
  cattle: 'Cattle',
  sheep: 'Sheep',
  swine: 'Swine',
} as const;

export function renderLivestockBuildingInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const definition = getBuildingDefinition(building.kind);
  const storageCaps = buildingStorageCaps(building.kind);
  const herd = context.worldQueries.getLivestockHerd(building.id);
  const pastures = context.worldQueries.getPasturesForBuilding(building.id);
  const pastureArea = pastures.reduce((sum, pasture) => sum + pasture.area, 0);
  const healthPercent = Math.round((herd?.health ?? 0) * 100);
  const breedingPercent = Math.round((herd?.breedingProgress ?? 0) * 100);
  const overCapacity = herd ? herd.headCount > herd.suppliedCapacity : false;
  const clock = gameClock(context.gameState.tick);
  const month = clock.month;
  const environment = environmentFor(context.gameState.seed, context.worldHydrology, clock);
  const cullSeason = isLivestockCullMonth(month);
  const shearingWindow = isSheepShearingMonth(month);
  const shornThisYear = herd?.species === 'sheep'
    && (herd.lastShearingYear ?? 0) === clock.year;
  const projectedFleece = herd?.species === 'sheep'
    ? projectedSheepFleece(herd)
    : 0;
  const woolRoom = Math.max(
    0,
    (storageCaps.wool ?? 0) - (building.wool ?? 0),
  );
  const shearingStorageBlocked = Boolean(
    herd?.species === 'sheep'
      && shearingWindow
      && !shornThisYear
      && projectedFleece > 0.05
      && !canStoreFullSheepClip(projectedFleece, woolRoom),
  );
  const shearingFlockBlocked = Boolean(
    herd?.species === 'sheep'
      && shearingWindow
      && !shornThisYear
      && projectedFleece <= 0.05,
  );
  const breedingReserve = herd
    ? effectiveLivestockBreedingReserve(herd.species, herd.breedingReserve)
    : 0;
  const projectedCull = herd
    ? projectedLivestockCullYield(herd.species, herd.headCount, herd.breedingReserve)
    : { heads: 0, food: 0, preservedFood: 0 };
  const livestockPolicy = herd ? livestockPolicyDefinition(herd.species) : null;
  const sabbathObserved = Boolean(
    context.getParishPolicy?.().sabbathObservanceEnabled
      && settlementHasStaffedChapel(context.gameState),
  );
  const fodderPlan = herd
    ? projectLivestockFodderHolding(
      building,
      herd,
      environment.pastureCapacityMultiplier,
      sabbathObserved,
      month,
      clock.monthDay,
    )
    : null;
  const winterReserveRelevant = month >= 9 || month <= 2;
  const winterReserveAtRisk = Boolean(
    winterReserveRelevant
      && fodderPlan
      && fodderPlan.winterReserveShortfall > 0.05,
  );
  const cullHasStorage = Boolean(
    herd
    && livestockPolicy
    && (storageCaps.food ?? 0) - building.food + 1e-6 >= livestockPolicy.slaughterFoodPerHead
    && (storageCaps.preservedFood ?? 0) - building.preservedFood + 1e-6
      >= livestockPolicy.slaughterPreservedFoodPerHead,
  );
  const activeTrip = context.worldQueries.getActiveDeliveryTrip(building);
  const onsiteLabor = onsiteBuildingLabor(building, activeTrip);
  const active = Boolean(herd && pastures.length > 0 && onsiteLabor > 0 && herd.health >= 0.45);
  const foodTerritory = context.worldQueries.getClaimedResidencesForFoodSupplier(building);
  const foodCapacity = storageCaps.food ?? 0;
  const householdFoodFloor = householdFoodReserve(foodTerritory.length, foodCapacity);
  const institutionalSurplus = institutionalFoodSurplus(
    building.food,
    foodTerritory.length,
    foodCapacity,
  );
  const nextInstitutionalDispatch =
    context.worldQueries.getNextInstitutionalFoodDispatch(
      building,
      context.conflictEnabled === true,
    );
  const nextInstitutionalCart = nextInstitutionalDispatch
    ? `${institutionalFoodDutyLabel(nextInstitutionalDispatch.duty)} → ${context.worldQueries.getBuildingLabel(nextInstitutionalDispatch.target.kind)} · ${nextInstitutionalDispatch.target.food.toFixed(1)} / ${nextInstitutionalDispatch.desiredStock.toFixed(1)} food`
    : institutionalSurplus <= 1e-6
      ? 'None · local household reserve is protected'
      : 'No eligible road-linked institution';
  const nextFoodTarget = context.worldQueries.getNextFoodDeliveryTargetForSupplier(building);
  const nextPreservedTarget = building.kind === 'pastoral_farmstead'
    ? context.worldQueries.getNextSpecialtyDeliveryTargetForSupplier(building, 'preservedFood')
    : null;
  const nextPreservedStorage = building.kind === 'pastoral_farmstead'
    ? context.worldQueries.getNextDirectProcessorInputDispatch(
        building,
        'preservedFood',
      )
    : null;
  const nextPreservedCart = nextPreservedTarget
    ? `Parcel #${nextPreservedTarget.parcelIndex + 1} · lowest household runway`
    : nextPreservedStorage
      ? `${context.worldQueries.getBuildingLabel(nextPreservedStorage.target.kind)} · ${nextPreservedStorage.routeDistance.toFixed(0)} m road · after household${herd?.species === 'cattle' ? ' and manure' : ''} duties`
      : 'Household cupboards covered · no granary with room';
  const nextWoolDispatch = herd?.species === 'sheep'
    ? context.worldQueries.getNextDirectProcessorInputDispatch(building, 'wool')
    : null;
  const nextWoolCart = (building.wool ?? 0) <= 0.05
    ? 'No wool stored'
    : nextWoolDispatch
      ? nextWoolDispatch.duty === 'working-buffer'
        ? `${context.worldQueries.getBuildingLabel(nextWoolDispatch.target.kind)} · ${staffingPriorityLabel(nextWoolDispatch.workPriority)} priority · ${weaverFibreDeliveryPreferenceLabel(nextWoolDispatch.target.weaverInputPolicy, 'wool')} · ${(nextWoolDispatch.target.wool ?? 0).toFixed(1)} / ${nextWoolDispatch.desiredStock.toFixed(1)} wool`
        : `${context.worldQueries.getBuildingLabel(nextWoolDispatch.target.kind)} · active buffers covered · nearest overflow route`
      : 'No road-linked weaver can receive wool';
  const statusText = !herd
    ? 'Awaiting herd records'
    : pastures.length === 0
      ? 'Draw a fenced pasture'
      : onsiteLabor === 0
        ? building.assignedLabor > 0
          ? 'Herd work paused - the full crew is away with its cart'
          : 'Awaiting herders'
        : winterReserveAtRisk
          ? `Winter grain reserve short ${fodderPlan!.winterReserveShortfall.toFixed(1)}`
        : herd.species === 'sheep' && shearingWindow && !shornThisYear
          ? shearingStorageBlocked
            ? `Shearing needs ${projectedFleece.toFixed(1)} free wool storage`
            : shearingFlockBlocked
              ? 'Shearing waiting for a healthy supplied flock'
              : 'Annual shearing underway'
        : isLivestockHaymakingMonth(month)
          && fodderPlan
          && fodderPlan.haymakingPercent > 0
          && overCapacity
          ? `Haymaking reserves ${fodderPlan.haymakingPercent}% of summer pasture — grain fallback active`
        : overCapacity
          ? 'Over capacity — grain fallback active'
          : herd.health < 0.45
            ? 'Herd health is poor'
            : herd.lastCulled > 0
              ? `Autumn slaughter — ${herd.lastCulled} surplus head culled`
              : cullSeason && projectedCull.heads > 0 && !cullHasStorage
                ? 'Autumn slaughter waiting for empty food storage'
                : cullSeason && projectedCull.heads > 0
                  ? `Culling ${projectedCull.heads} surplus head before winter`
                  : projectedCull.heads > 0
                    ? `Holding ${projectedCull.heads} surplus head for October`
                    : 'Herd tended';

  const role = building.kind === 'swineherd'
    ? 'Forest pannage → seasonal pork for smokehouses'
    : herd?.species === 'sheep'
      ? 'Upland grazing → food, cheese, and annual fleece for local weaving'
      : 'Pasture → dairy, collectable farmyard manure, and ox ploughing power';

  const speciesControls = building.kind === 'pastoral_farmstead'
    ? `<div class="inspector-action-panel">
        <p class="resource-inspector-note">Herd specialization — switching keeps the building and pasture, but replaces the herd with starter stock.</p>
        <div class="resource-action-row">
          <button type="button" class="resource-action-button" data-livestock-species="cattle" ${herd?.species === 'cattle' ? 'disabled' : ''}>Cattle</button>
          <button type="button" class="resource-action-button" data-livestock-species="sheep" ${herd?.species === 'sheep' ? 'disabled' : ''}>Sheep</button>
        </div>
      </div>`
    : undefined;
  const pastureLabel = building.kind === 'swineherd' ? 'Fence woodland pannage' : 'Fence pasture';
  const pastureHint = building.kind === 'swineherd'
    ? 'Fence woodland for this holding. Parcel area and live mature trees determine the pigs’ capacity.'
    : 'Fence grazing land for this holding. Parcel area and terrain determine this herd’s capacity.';
  const pastureControls = `<div class="inspector-action-panel">
      <p class="resource-inspector-note">${pastureHint}</p>
      <div class="resource-action-row">
        <button type="button" class="resource-action-button" data-land-parcel="pasture">${pastureLabel}</button>
      </div>
    </div>`;
  const reserveControls = herd
    ? `<div class="inspector-action-panel">
        <p class="resource-inspector-note">Winter breeding reserve — surplus above this herd size is culled during October and November. A larger reserve accelerates future breeding but consumes more pasture and emergency grain.</p>
        <div class="resource-action-row">
          ${livestockReservePresets(herd.species)
            .map((preset) => `<button type="button" class="resource-action-button" data-livestock-breeding-reserve="${preset.reserve}" ${breedingReserve === preset.reserve ? 'disabled' : ''}>${preset.label} · ${preset.reserve}</button>`)
            .join('')}
        </div>
        <p class="inspector-action-panel__hint">${projectedCull.heads > 0
          ? `${projectedCull.heads} surplus head currently project ${projectedCull.food.toFixed(0)} fresh food${projectedCull.preservedFood > 0 ? ` + ${projectedCull.preservedFood.toFixed(0)} preserved` : ''}. Slaughter pauses unless the holding can store a whole animal’s yield.`
          : `No current surplus. The holding will keep up to ${breedingReserve} head through winter.`}</p>
      </div>`
    : '';
  const haymakingForecastHint = !fodderPlan
    ? ''
    : building.assignedLabor <= 0
      ? 'The meadow allocation is configured, but no hay is cut while the holding is unstaffed.'
      : isLivestockHaymakingMonth(month)
        ? `${fodderPlan.haymakingDaysRemaining} cutting days remain at current staffing, projecting ${fodderPlan.projectedHayStock.toFixed(1)} / ${LIVESTOCK_HAY_STORAGE_CAPACITY} in the loft; drought can reduce the cut.`
        : month < LIVESTOCK_HAYMAKING_START_MONTH
          ? `At current staffing, the coming hay season projects ${fodderPlan.projectedHayStock.toFixed(1)} / ${LIVESTOCK_HAY_STORAGE_CAPACITY} in the loft; drought can reduce the cut.`
          : `This year's cutting season has ended with ${fodderPlan.hayStock.toFixed(1)} / ${LIVESTOCK_HAY_STORAGE_CAPACITY} in the loft.`;
  const haymakingControls = herd && building.kind === 'pastoral_farmstead' && fodderPlan
    ? `<div class="inspector-action-panel">
        <p class="resource-inspector-note">Summer hay meadow — reserving more pasture from grazing during June–August builds a local winter feed reserve, but can force emergency grain use while grass is being cut.</p>
        <div class="resource-action-row">
          ${livestockHaymakingPresets()
            .map((preset) => `<button type="button" class="resource-action-button" data-livestock-haymaking-percent="${preset.percent}" ${fodderPlan.haymakingPercent === preset.percent ? 'disabled' : ''}>${preset.label} · ${preset.percent}%</button>`)
            .join('')}
        </div>
        <p class="inspector-action-panel__hint">${fodderPlan.haymakingPercent <= 0
          ? 'No meadow is reserved for hay. Winter pasture shortages will fall directly on emergency grain.'
          : `${fodderPlan.summerReservedCapacity.toFixed(1)} head-capacity is reserved in hay season. ${haymakingForecastHint}`}</p>
      </div>`
    : '';

  const recentOutput = herd
    ? `${herd.lastFoodOutput.toFixed(2)} food · ${herd.lastPreservedOutput.toFixed(2)} preserved${herd.lastHayOutput > 0 ? ` · ${herd.lastHayOutput.toFixed(2)} hay` : ''}${herd.lastCulled > 0 ? ` · ${herd.lastCulled} culled` : ''}`
    : 'None';
  const manurePerCycle = herd?.species === 'cattle'
    ? cattleManurePerCycle(
      Math.min(herd.headCount, herd.suppliedCapacity) * herd.health,
      environment.season,
    )
    : 0;
  const capacity = herd
    ? `${herd.headCount} head · ${herd.suppliedCapacity}/${herd.pastureCapacity} supplied/pasture capacity`
    : 'No herd';
  const woodlandRows = building.kind === 'swineherd'
    ? `<li><span>Mature pannage trees</span><span>${target.matureTrees}</span></li>
       <li><span>Forest condition</span><span>${target.matureTrees > 0 ? 'Live canopy supplies mast' : 'Clear-cut — grain-only fallback'}</span></li>`
    : '';
  const benefitRow = herd?.species === 'cattle'
    ? `<li><span>Ox team</span><span>Highest-priority ${CATTLE_MAX_PLOUGH_SUPPORTED_FIELDS} fields inside work extent · ${Math.round((1 - CATTLE_PLOUGH_WORK_MULTIPLIER) * 100)}% less ploughing</span></li>
       <li><span>Manure output</span><span>${manurePerCycle.toFixed(2)} per work cycle now · supplied heads, health, and seasonal housing govern collection</span></li>
       <li><span>Manure yard</span><span>${Math.max(0, building.manure ?? 0).toFixed(1)} / ${storageCaps.manure ?? 0} · carts serve lowest-covered road-linked crop farmsteads after food duties</span></li>`
    : herd?.species === 'sheep'
      ? '<li><span>Terrain fit</span><span>Lower input · tolerates steeper upland pasture</span></li>'
      : '<li><span>Seasonality</span><span>No passive pork · actual surplus culls in October–November</span></li>';
  const currentGrainBurden = !fodderPlan
    ? 'No herd'
    : building.assignedLabor <= 0
      ? 'No work cycles while unstaffed'
      : fodderPlan.currentGrainPerDay <= 0.01
        ? 'Pasture covers the current herd'
        : `${fodderPlan.currentUnsupportedHeads.toFixed(1)} unsupported head · ${environment.season === 'winter' && fodderPlan.hayStock > 0 ? `hay feeds first, then ` : ''}${fodderPlan.currentGrainPerDay.toFixed(1)} grain / day · ${formatProvisionRunway(fodderPlan.currentGrainRunwayDays)} stored`;
  const winterHerdPlan = !fodderPlan
    ? 'No herd'
    : `${fodderPlan.projectedHeadCount} head after planned culls · ${fodderPlan.winterPastureCapacity.toFixed(1)} pasture-supported · ${fodderPlan.winterUnsupportedHeads.toFixed(1)} need stored fodder`;
  const haymakingPlan = !fodderPlan || herd?.species === 'swine'
    ? 'Pigs depend on woodland mast and emergency grain'
    : `${fodderPlan.haymakingPercent}% of summer pasture · ${fodderPlan.summerReservedCapacity.toFixed(1)} head-capacity · ${fodderPlan.hayOutputPerDay.toFixed(1)} hay / day ${isLivestockHaymakingMonth(month) ? 'now' : 'in season'}`;
  const winterHayReserve = !fodderPlan || herd?.species === 'swine'
    ? 'Not used by woodland pigs'
    : `${fodderPlan.hayStock.toFixed(1)} stored · ${fodderPlan.projectedHayStock.toFixed(1)} projected at winter / ${fodderPlan.winterHayNeed.toFixed(1)} needed · ${formatProvisionRunway(fodderPlan.winterHayRunwayDays)}`;
  const winterGrainReserve = !fodderPlan
    ? 'No herd'
    : building.assignedLabor <= 0
      ? 'Assign herders to establish a working reserve'
      : fodderPlan.winterReserveTarget <= 0.01
        ? fodderPlan.winterUnsupportedHeads <= 0.01
          ? 'Winter pasture covers the projected herd'
          : 'Projected hay covers the remaining winter fodder demand'
        : `${fodderPlan.winterReserveStock.toFixed(1)} / ${fodderPlan.winterReserveTarget.toFixed(1)} onsite after hay · ${formatProvisionRunway(fodderPlan.winterCombinedRunwayDays)} combined coverage`;
  const winterResupplyRow = fodderPlan
    && fodderPlan.winterGrainNeed > fodderPlan.winterReserveTarget + 0.05
    ? `<li><span>Winter resupply</span><span>Full store covers ${formatProvisionRunway(fodderPlan.storageRunwayDays)} · ${fodderPlan.winterGrainNeed.toFixed(1)} grain needed for ${LIVESTOCK_WINTER_FODDER_RESERVE_DAYS} days</span></li>`
    : '';

  return {
    eyebrow: 'Livestock holding',
    title: definition.label,
    statusText,
    statusState: winterReserveAtRisk || shearingStorageBlocked || shearingFlockBlocked || overCapacity || (herd?.health ?? 1) < 0.45
      ? 'warning'
      : active
        ? 'active'
        : 'idle',
    detailsHtml: `
      <li><span>Role</span><span>${role}</span></li>
      <li><span>Herd</span><span>${herd ? SPECIES_LABEL[herd.species] : 'None'}</span></li>
      <li><span>Stocking</span><span>${capacity}</span></li>
      <li><span>Pastures</span><span>${pastures.length} · ${Math.round(pastureArea)} m² fenced</span></li>
      <li><span>Health</span><span>${healthPercent}%</span></li>
      <li><span>Breeding cycle</span><span>${breedingPercent}%</span></li>
      <li><span>Winter reserve</span><span>${herd ? `${breedingReserve} head · ${projectedCull.heads} current surplus` : 'None'}</span></li>
      <li><span>Last work cycle</span><span>${recentOutput}</span></li>
      <li><span>Fallback grain</span><span>${building.grain.toFixed(1)} stored</span></li>
      <li><span>Current grain burden</span><span>${currentGrainBurden}</span></li>
      <li><span>Summer hay meadow</span><span>${haymakingPlan}</span></li>
      <li><span>Hayloft</span><span>${fodderPlan ? `${fodderPlan.hayStock.toFixed(1)} / ${LIVESTOCK_HAY_STORAGE_CAPACITY}` : 'No herd'}</span></li>
      <li><span>Winter hay reserve</span><span>${winterHayReserve}</span></li>
      <li><span>Winter herd plan</span><span>${winterHerdPlan}</span></li>
      <li><span>Winter grain reserve</span><span>${winterGrainReserve}</span></li>
      ${winterResupplyRow}
      <li><span>Fresh-food stock</span><span>${building.food.toFixed(1)} / ${storageCaps.food ?? 0}</span></li>
      ${building.kind === 'pastoral_farmstead' ? `<li><span>Preserved stock</span><span>${building.preservedFood.toFixed(1)} / ${storageCaps.preservedFood ?? 0}</span></li>` : ''}
      ${herd?.species === 'sheep' ? `<li><span>Wool store</span><span>${(building.wool ?? 0).toFixed(1)} / ${storageCaps.wool ?? 0}</span></li>
      <li><span>Annual shearing</span><span>${shornThisYear
        ? `${(herd.lastWoolOutput ?? 0).toFixed(1)} wool stored in Year ${clock.year}`
        : shearingWindow
          ? shearingStorageBlocked
            ? `Waiting for ${projectedFleece.toFixed(1)} free storage · ${woolRoom.toFixed(1)} available`
            : shearingFlockBlocked
              ? 'Waiting for healthy, supplied sheep'
              : `Open now · ${projectedFleece.toFixed(1)} wool expected with full-clip room secured`
          : `Next window: June–July · ${projectedFleece.toFixed(1)} wool at current flock condition · ${(herd.lastWoolOutput ?? 0).toFixed(1)} stored in last shearing`}</span></li>
      <li><span>Textile route</span><span>Holding cart → road-linked weaver → cloth cart → marketplace</span></li>
      <li><span>Next wool cart</span><span>${nextWoolCart}</span></li>` : ''}
      <li><span>Food territory</span><span>${building.food <= 1e-6 ? 'Yielding while empty' : foodTerritory.length === 0 ? 'None on branch' : `${foodTerritory.length} households claimed`}</span></li>
      <li><span>Local food reserve</span><span>${householdFoodFloor.toFixed(1)} protected · ${institutionalSurplus.toFixed(1)} central surplus</span></li>
      <li><span>Next food cart</span><span>${nextFoodTarget ? `Parcel #${nextFoodTarget.parcelIndex + 1}` : 'None needing food'}</span></li>
      <li><span>Next surplus cart</span><span>${nextInstitutionalCart}</span></li>
      ${building.kind === 'pastoral_farmstead' ? `<li><span>Next preserved cart</span><span>${nextPreservedCart}</span></li>` : ''}
      <li><span>Cart duty</span><span>${activeTrip ? `${cargoKindLabel(activeTrip.cargoKind)} · ${formatTripPhaseLabel(activeTrip.phase)}` : 'Ready'}</span></li>
      ${benefitRow}
      ${woodlandRows}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      ${buildingExtentRow(building.kind)}
    `,
    demolish: {
      visible: true,
      hint: pastures.length > 0
        ? `Remove its ${pastures.length === 1 ? 'pasture' : 'pastures'} first. ${buildingDemolishHint(building.kind)}`
        : buildingDemolishHint(building.kind),
    },
    labor: buildingLaborView(building, context.populationStats, context.worldQueries),
    supplementalPanelHtml: `${reserveControls}${haymakingControls}${pastureControls}${speciesControls ?? ''}`,
  };
}
