import {
  canStoreFullSheepClip,
  effectiveLivestockBreedingReserve,
  isLivestockHaymakingMonth,
  isLivestockCullMonth,
  isSheepShearingMonth,
  LIVESTOCK_MILK_USE_PRESETS,
  livestockHaymakingPresets,
  livestockMilkAllocationPerCycle,
  livestockMilkUsePolicy,
  livestockPolicyDefinition,
  livestockPreservationSaltRequired,
  livestockReservePresets,
  livestockSaltedOutputCapacity,
  projectedSheepFleece,
  projectedLivestockCullYield,
} from '../../economy/livestockPolicy.ts';
import { projectLivestockFodderHolding } from '../../economy/livestockFodder.ts';
import {
  buildingPreservedFoodStorageFactor,
  formatPreservedFoodLoss,
} from '../../economy/foodPreservation.ts';
import { formatProvisionRunway } from '../../economy/settlementProvisioning.ts';
import { weaverFibreDeliveryPreferenceLabel } from '../../economy/weaverInputPolicy.ts';
import { gameClock } from '../../world/gameCalendar.ts';
import {
  CATTLE_AREA_PER_HEAD,
  CATTLE_MAX_HERD,
  CATTLE_MAX_PLOUGH_SUPPORTED_FIELDS,
  CATTLE_PLOUGH_WORK_MULTIPLIER,
  CATTLE_STARTER_HERD,
  FARM_MANURE_FERTILITY_BONUS,
  LIVESTOCK_HAYMAKING_START_MONTH,
  LIVESTOCK_HAY_STORAGE_CAPACITY,
  LIVESTOCK_WINTER_FODDER_RESERVE_DAYS,
  SHEEP_AREA_PER_HEAD,
  SHEEP_MAX_HERD,
  SHEEP_STARTER_HERD,
  SHEEP_WOOL_PER_SHEARING_PER_HEAD,
} from '../../generated/gameBalance.ts';
import { cattleManurePerCycle } from '../../farming/manurePlanning.ts';
import { settlementHasStaffedChapel } from '../../logistics/landmarkAccess.ts';
import { environmentFor } from '../../world/seasonPolicy.ts';
import {
  edibleFoodStock,
  freshFoodStock,
  preservedFoodStock,
} from '../../economy/foodInventory.ts';
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
import { renderResourceAmount } from '../../ui/resourceCost.ts';

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
  const milkUse = livestockMilkUsePolicy(building.processorOutputTargetPercent);
  const milkAllocation = herd && herd.species !== 'swine' && fodderPlan
    ? livestockMilkAllocationPerCycle(
      herd.species,
      fodderPlan.productiveHeads,
      building.processorOutputTargetPercent,
      Math.min(
        livestockSaltedOutputCapacity(building.salt ?? 0),
        Math.max(0, (storageCaps.preservedFood ?? 0) - (building.cheese ?? 0)),
      ),
    )
    : null;
  const winterReserveRelevant = month >= 9 || month <= 2;
  const winterReserveAtRisk = Boolean(
    winterReserveRelevant
      && fodderPlan
      && fodderPlan.winterReserveShortfall > 0.05,
  );
  const cullSaltedOutput = livestockPolicy
    ? Math.min(
      livestockPolicy.slaughterPreservedFoodPerHead,
      livestockSaltedOutputCapacity(building.salt ?? 0),
      Math.max(
        0,
        (storageCaps.preservedFood ?? 0) - preservedFoodStock(building),
      ),
    )
    : 0;
  const cullFreshOutput = livestockPolicy
    ? livestockPolicy.slaughterFoodPerHead
      + Math.max(
        0,
        livestockPolicy.slaughterPreservedFoodPerHead - cullSaltedOutput,
      )
    : 0;
  const cullHasStorage = Boolean(
    herd
    && livestockPolicy
    && (storageCaps.food ?? 0) - freshFoodStock(building) + 1e-6 >= cullFreshOutput
    && (storageCaps.preservedFood ?? 0) - preservedFoodStock(building) + 1e-6
      >= cullSaltedOutput,
  );
  const inboundTrip = context.worldQueries.getInboundSupplyTrip(building);
  const inboundSalt = inboundTrip?.cargoKind === 'salt'
    ? Math.max(0, inboundTrip.amount)
    : 0;
  const activeTrip = context.worldQueries.getActiveDeliveryTrip(building);
  const onsiteLabor = onsiteBuildingLabor(building, activeTrip);
  const active = Boolean(herd && pastures.length > 0 && onsiteLabor > 0 && herd.health >= 0.45);
  const foodTerritory = context.worldQueries.getClaimedResidencesForFoodSupplier(building);
  const foodCapacity = storageCaps.food ?? 0;
  const householdFoodFloor = householdFoodReserve(foodTerritory.length, foodCapacity);
  const institutionalSurplus = institutionalFoodSurplus(
    edibleFoodStock(building),
    foodTerritory.length,
    foodCapacity,
  );
  const nextInstitutionalDispatch =
    context.worldQueries.getNextInstitutionalFoodDispatch(
      building,
      context.conflictEnabled === true,
    );
  const nextInstitutionalCart = nextInstitutionalDispatch
    ? `${institutionalFoodDutyLabel(nextInstitutionalDispatch.duty)} → ${context.worldQueries.getBuildingLabel(nextInstitutionalDispatch.target.kind)} · ${Math.round(edibleFoodStock(nextInstitutionalDispatch.target))} / ${Math.ceil(nextInstitutionalDispatch.desiredStock)} meals`
    : institutionalSurplus <= 1e-6
      ? 'None · local household reserve is protected'
      : 'No eligible institution requesting food';
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
        ? `${context.worldQueries.getBuildingLabel(nextWoolDispatch.target.kind)} · ${weaverFibreDeliveryPreferenceLabel(nextWoolDispatch.target.weaverInputPolicy, 'wool')} · ${Math.round(nextWoolDispatch.target.wool ?? 0)} / ${Math.ceil(nextWoolDispatch.desiredStock)} wool`
        : `${context.worldQueries.getBuildingLabel(nextWoolDispatch.target.kind)} · active buffers covered · nearest overflow route`
      : 'No weaver can currently receive wool';
  const dairySaltEmpty = Boolean(
    herd?.species !== 'swine'
      && fodderPlan
      && fodderPlan.dairySaltPerDay > 0.001
      && fodderPlan.dairySaltStock + inboundSalt <= 0.001,
  );
  const statusText = !herd
    ? building.kind === 'pastoral_farmstead'
      ? 'Choose cattle or sheep'
      : 'Awaiting pig herd'
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
            : dairySaltEmpty
              ? 'Cheese salt empty — fresh milk continues'
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
    : !herd
      ? 'Unstocked holding → choose cattle or sheep before laying out pasture'
    : herd?.species === 'sheep'
      ? 'Upland grazing → milk, salt-cured cheese, and annual wool'
      : 'Pasture → milk, salt-cured cheese, manure, and ox power';

  const speciesControls = building.kind === 'pastoral_farmstead'
    ? `<div class="inspector-action-panel">
        <p class="resource-inspector-note">${herd
          ? 'Herd specialization — switching keeps the building and pasture, but replaces the herd with starter stock.'
          : 'Choose this holding’s herd before fencing pasture. The first choice establishes its starter animals.'}</p>
        <div class="resource-action-row">
          <button type="button" class="resource-action-button" data-livestock-species="cattle" ${herd?.species === 'cattle' ? 'disabled' : ''}>Cattle · ${CATTLE_STARTER_HERD}</button>
          <button type="button" class="resource-action-button" data-livestock-species="sheep" ${herd?.species === 'sheep' ? 'disabled' : ''}>Sheep · ${SHEEP_STARTER_HERD}</button>
        </div>
        <p class="inspector-action-panel__hint"><strong>Cattle:</strong> ${CATTLE_AREA_PER_HEAD} m²/head, up to ${CATTLE_MAX_HERD}; stronger milk per head, physical manure, and ox support for ${CATTLE_MAX_PLOUGH_SUPPORTED_FIELDS} priority fields. <strong>Sheep:</strong> ${SHEEP_AREA_PER_HEAD} m²/head, up to ${SHEEP_MAX_HERD}; faster-growing upland flocks and an annual ${SHEEP_WOOL_PER_SHEARING_PER_HEAD} wool/head clip for cloth and export. A full holding has broadly comparable food potential, so the land, fertility, and textile benefits decide the trade.</p>
      </div>`
    : undefined;
  const milkUseControls = herd && herd.species !== 'swine' && building.kind === 'pastoral_farmstead'
    ? `<div class="inspector-action-panel">
        <p class="resource-inspector-note">Milk use — choose after stocking. Cheese consumes the same gross milk yield one-for-one; it is durable and exportable, but needs salt and cured-store room.</p>
        <div class="resource-action-row">
          ${LIVESTOCK_MILK_USE_PRESETS
            .map((preset) => `<button type="button" class="resource-action-button" data-processor-output-target="${preset.value}" ${milkUse.value === preset.value ? 'disabled' : ''}>${preset.label}</button>`)
            .join('')}
        </div>
        <p class="inspector-action-panel__hint">${milkUse.hint} Current cycle potential: ${milkAllocation?.freshMilk.toFixed(2) ?? '0.00'} milk + ${milkAllocation?.cheese.toFixed(2) ?? '0.00'} cheese. Missing salt or cheese room leaves that share as milk. Fresh surplus sold through a staffed granary and Marketplace builds household wealth; cheese can go to local stores first, then a Trading Post export queue.</p>
      </div>`
    : '';
  const pastureLabel = building.kind === 'swineherd' ? 'Fence woodland pannage' : 'Fence pasture';
  const pastureHint = building.kind === 'swineherd'
    ? 'Fence woodland for this holding. Parcel area and live mature trees determine the pigs’ capacity.'
    : !herd
      ? 'Choose cattle or sheep before fencing grazing land.'
    : 'Fence grazing land for this holding. Parcel area and terrain determine this herd’s capacity.';
  const pastureControls = `<div class="inspector-action-panel">
      <p class="resource-inspector-note">${pastureHint}</p>
      <div class="resource-action-row">
        <button type="button" class="resource-action-button" data-land-parcel="pasture" ${building.kind === 'pastoral_farmstead' && !herd ? 'disabled' : ''}>${pastureLabel}</button>
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
          ? `${projectedCull.heads} surplus head currently project ${projectedCull.food.toFixed(0)} fresh food${projectedCull.preservedFood > 0 ? ` + up to ${projectedCull.preservedFood.toFixed(0)} cured provisions using ${renderResourceAmount('salt', livestockPreservationSaltRequired(projectedCull.preservedFood), { compact: true })}` : ''}. Slaughter pauses unless the holding can store a whole animal’s actual yield; any unsalted cured share enters the fresh store instead.`
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
          : `This year's cutting season has ended with ${Math.round(fodderPlan.hayStock)} / ${Math.round(LIVESTOCK_HAY_STORAGE_CAPACITY)} in the loft.`;
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
    ? `${Math.round(herd.lastFoodOutput)} fresh food · ${Math.round(herd.lastPreservedOutput)} salted provisions${herd.lastHayOutput > 0 ? ` · ${Math.round(herd.lastHayOutput)} hay` : ''}${herd.lastCulled > 0 ? ` · ${herd.lastCulled} culled` : ''}`
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
       <li><span>Manure yard</span><span>${Math.round(Math.max(0, building.manure ?? 0))} / ${Math.round(storageCaps.manure ?? 0)} · carts deliver it to road-linked crop farmsteads, where it is spread during ploughing and restores up to ${Math.round(FARM_MANURE_FERTILITY_BONUS * 100)} fertility points after harvest</span></li>`
    : herd?.species === 'sheep'
      ? `<li><span>Sheep advantage</span><span>Steeper, drier upland pasture · faster breeding · annual ${SHEEP_WOOL_PER_SHEARING_PER_HEAD} wool/head clip feeds the weaver-to-cloth export chain</span></li>`
      : '<li><span>Seasonality</span><span>No passive pork · actual surplus culls in October–November</span></li>';
  const currentGrainBurden = !fodderPlan
    ? 'No herd'
    : building.assignedLabor <= 0
      ? 'No work cycles while unstaffed'
      : fodderPlan.currentGrainPerDay <= 0.01
        ? 'Pasture covers the current herd'
        : `${fodderPlan.currentUnsupportedHeads.toFixed(1)} unsupported head · ${environment.season === 'winter' && fodderPlan.hayStock > 0 ? 'hay feeds first, then ' : ''}${renderResourceAmount('oatGrain', fodderPlan.currentGrainPerDay, { compact: true, suffix: '/day' })} · ${formatProvisionRunway(fodderPlan.currentGrainRunwayDays)} stored`;
  const winterHerdPlan = !fodderPlan
    ? 'No herd'
    : `${fodderPlan.projectedHeadCount} head after planned culls · ${fodderPlan.winterPastureCapacity.toFixed(1)} pasture-supported · ${fodderPlan.winterUnsupportedHeads.toFixed(1)} need stored fodder`;
  const haymakingPlan = !fodderPlan || herd?.species === 'swine'
    ? 'Pigs depend on woodland mast and emergency grain'
    : `${fodderPlan.haymakingPercent}% of summer pasture · ${fodderPlan.summerReservedCapacity.toFixed(1)} head-capacity · ${fodderPlan.hayOutputPerDay.toFixed(1)} hay / day ${isLivestockHaymakingMonth(month) ? 'now' : 'in season'}`;
  const winterHayReserve = !fodderPlan || herd?.species === 'swine'
    ? 'Not used by woodland pigs'
    : `${Math.round(fodderPlan.hayStock)} stored · ${Math.floor(fodderPlan.projectedHayStock)} projected at winter / ${Math.ceil(fodderPlan.winterHayNeed)} needed · ${formatProvisionRunway(fodderPlan.winterHayRunwayDays)}`;
  const winterGrainReserve = !fodderPlan
    ? 'No herd'
    : building.assignedLabor <= 0
      ? 'Assign herders to establish a working reserve'
      : fodderPlan.winterReserveTarget <= 0.01
        ? fodderPlan.winterUnsupportedHeads <= 0.01
          ? 'Winter pasture covers the projected herd'
          : 'Projected hay covers the remaining winter fodder demand'
        : `${Math.round(fodderPlan.winterReserveStock)} / ${Math.ceil(fodderPlan.winterReserveTarget)} onsite after hay · ${formatProvisionRunway(fodderPlan.winterCombinedRunwayDays)} combined coverage`;
  const winterResupplyRow = fodderPlan
    && fodderPlan.winterGrainNeed > fodderPlan.winterReserveTarget + 0.05
    ? `<li><span>Winter resupply</span><span>Full store covers ${formatProvisionRunway(fodderPlan.storageRunwayDays)} · ${renderResourceAmount('oatGrain', fodderPlan.winterGrainNeed, { compact: true, suffix: `for ${LIVESTOCK_WINTER_FODDER_RESERVE_DAYS} days` })}</span></li>`
    : '';
  const dairySaltRow = building.kind !== 'pastoral_farmstead' || !fodderPlan
    ? ''
    : `<li><span>Cheese salt</span><span>${Math.round(fodderPlan.dairySaltStock)} onsite${inboundSalt > 0.001 ? ` + ${Math.round(inboundSalt)} inbound` : ''} / ${Math.ceil(fodderPlan.dairySaltTarget)} working target · ${renderResourceAmount('salt', fodderPlan.dairySaltPerDay, { compact: true, suffix: '/day' })} at current herd and staffing · ${formatProvisionRunway(fodderPlan.dairySaltRunwayDays)} onsite</span></li>
      <li><span>Salt logistics</span><span>${inboundSalt > 0.001
        ? `Salt cart ${formatTripPhaseLabel(inboundTrip!.phase).toLowerCase()} from ${context.worldQueries.getBuildingLabel(context.worldQueries.getBuilding(inboundTrip!.buildingId)?.kind ?? 'marketplace')}`
        : 'Road-linked mine or marketplace carts share salt between smokehouses and pastoral holdings by runway and road distance'} · empty salt stops farmhouse cheese, not fresh milk or herd care</span></li>`;

  return {
    eyebrow: 'Livestock holding',
    title: definition.label,
    statusText,
    statusState: winterReserveAtRisk || shearingStorageBlocked || shearingFlockBlocked || overCapacity || (herd?.health ?? 1) < 0.45 || dairySaltEmpty
      ? 'warning'
      : active
        ? 'active'
        : 'idle',
    detailsHtml: `
      <li><span>Role</span><span>${role}</span></li>
      <li><span>Herd</span><span>${herd ? SPECIES_LABEL[herd.species] : 'None'}</span></li>
      ${herd?.species !== 'swine' && herd ? `<li><span>Milk use</span><span>${milkUse.label} · ${milkAllocation?.freshMilk.toFixed(2) ?? '0.00'} milk + ${milkAllocation?.cheese.toFixed(2) ?? '0.00'} cheese per current work cycle</span></li>` : ''}
      <li><span>Stocking</span><span>${capacity}</span></li>
      <li><span>Pastures</span><span>${pastures.length} · ${Math.round(pastureArea)} m² fenced</span></li>
      <li><span>Health</span><span>${herd ? `${healthPercent}%` : 'Not stocked'}</span></li>
      <li><span>Breeding cycle</span><span>${herd ? `${breedingPercent}%` : 'Not started'}</span></li>
      <li><span>Winter reserve</span><span>${herd ? `${breedingReserve} head · ${projectedCull.heads} current surplus` : 'None'}</span></li>
      <li><span>Last work cycle</span><span>${recentOutput}</span></li>
      ${dairySaltRow}
      <li><span>Preferred fallback</span><span>${Math.round(Math.max(0, building.oatGrain ?? 0))} oats stored</span></li>
      <li><span>Current grain burden</span><span>${currentGrainBurden}</span></li>
      <li><span>Summer hay meadow</span><span>${haymakingPlan}</span></li>
      <li><span>Hayloft</span><span>${fodderPlan ? `${Math.round(fodderPlan.hayStock)} / ${Math.round(LIVESTOCK_HAY_STORAGE_CAPACITY)}` : 'No herd'}</span></li>
      <li><span>Winter hay reserve</span><span>${winterHayReserve}</span></li>
      <li><span>Winter herd plan</span><span>${winterHerdPlan}</span></li>
      <li><span>Winter grain reserve</span><span>${winterGrainReserve}</span></li>
      ${winterResupplyRow}
      <li><span>Fresh-food stock</span><span>${Math.round(freshFoodStock(building))} / ${Math.round(storageCaps.food ?? 0)} · meat ${Math.round(Math.max(0, building.meat ?? 0))} · milk ${Math.round(Math.max(0, building.milk ?? 0))}</span></li>
      ${building.kind === 'pastoral_farmstead' ? `<li><span>Preserved stock</span><span>${Math.round(preservedFoodStock(building))} / ${Math.round(storageCaps.preservedFood ?? 0)} · cured meat ${Math.round(Math.max(0, building.curedMeat ?? 0))} · cheese ${Math.round(Math.max(0, building.cheese ?? 0))}</span></li>
      <li><span>Cured-store aging</span><span>Ordinary dry storage · ${formatPreservedFoodLoss(
        preservedFoodStock(building)
        * environment.preservedFoodSpoilageFractionPerDay
        * buildingPreservedFoodStorageFactor(building.kind),
      )}</span></li>` : ''}
      ${herd?.species === 'sheep' ? `<li><span>Wool store</span><span>${Math.round(building.wool ?? 0)} / ${Math.round(storageCaps.wool ?? 0)}</span></li>
      <li><span>Annual shearing</span><span>${shornThisYear
        ? `${Math.round(herd.lastWoolOutput ?? 0)} wool stored in Year ${clock.year}`
        : shearingWindow
          ? shearingStorageBlocked
            ? `Waiting for ${projectedFleece.toFixed(1)} free storage · ${woolRoom.toFixed(1)} available`
            : shearingFlockBlocked
              ? 'Waiting for healthy, supplied sheep'
              : `Open now · ${projectedFleece.toFixed(1)} wool expected with full-clip room secured`
          : `Next window: June–July · ${projectedFleece.toFixed(1)} wool at current flock condition · ${Math.round(herd.lastWoolOutput ?? 0)} stored in last shearing`}</span></li>
      <li><span>Textile route</span><span>Holding cart → weaver → cloth cart → marketplace; roads speed every local leg</span></li>
      <li><span>Next wool cart</span><span>${nextWoolCart}</span></li>` : ''}
      <li><span>Food territory</span><span>${edibleFoodStock(building) <= 1e-6 ? 'Yielding while empty' : foodTerritory.length === 0 ? 'None on branch' : `${foodTerritory.length} households claimed`}</span></li>
      <li><span>Local food reserve</span><span>${Math.round(householdFoodFloor)} protected · ${Math.round(institutionalSurplus)} central surplus</span></li>
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
    supplementalPanelHtml: `${speciesControls ?? ''}${milkUseControls}${pastureControls}${reserveControls}${haymakingControls}`,
  };
}
