import {
  canStoreFullSheepClip,
  effectiveLivestockBreedingReserve,
  isLivestockHaymakingMonth,
  isLivestockCullMonth,
  isSheepShearingMonth,
  LIVESTOCK_MILK_USE_PRESETS,
  livestockHaymakingPresets,
  livestockCareCapacity,
  livestockHeadsPerWorker,
  livestockDairyProductiveHeads,
  livestockMilkAllocationPerCycle,
  livestockMilkUsePolicy,
  livestockPolicyDefinition,
  livestockPreservationSaltRequired,
  livestockPurchaseGoldPerHead,
  livestockReservePresets,
  livestockSaleGoldPerHead,
  livestockSaleProceeds,
  livestockSaltedOutputCapacity,
  livestockWaterRequiredPerCycle,
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
  LIVESTOCK_ANIMAL_FEED_PER_CYCLE,
  LIVESTOCK_FEED_OAT_GRAIN_PER_CYCLE,
  LIVESTOCK_HAYMAKING_START_MONTH,
  LIVESTOCK_HAY_STORAGE_CAPACITY,
  LIVESTOCK_MINIMUM_BREEDING_HEADS,
  LIVESTOCK_WINTER_FODDER_RESERVE_DAYS,
  SHEEP_AREA_PER_HEAD,
  SHEEP_MAX_HERD,
  SHEEP_STARTER_HERD,
  SHEEP_WOOL_PER_SHEARING_PER_HEAD,
  SWINE_AREA_PER_HEAD,
  SWINE_MATURE_TREES_PER_HEAD,
  SWINE_STARTER_HERD,
} from '../../generated/gameBalance.ts';
import { cattleManurePerCycle } from '../../farming/manurePlanning.ts';
import {
  livestockHoldingWholeHeadLimit,
  neutralPastureHoldingHeadCapacity,
  pannageHoldingHeadCapacity,
} from '../../farming/pastureCapacity.ts';
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
  institutionalDispatchableFoodStock,
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
import {
  FREE_CONSTRUCTION_COST_TOOLTIP,
  renderResourceAmount,
} from '../../ui/resourceCost.ts';
import { livestockLaborForecastByBuilding } from './livestockLaborForecast.ts';

const SPECIES_LABEL = {
  cattle: 'Cattle',
  sheep: 'Sheep',
  swine: 'Swine',
} as const;

const SPECIES_MEAT_LABEL = {
  cattle: 'beef',
  sheep: 'mutton',
  swine: 'pork',
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
  const maturePannageTrees = building.kind === 'swineherd'
    ? context.worldQueries.getMaturePannageTreeCount(building.id)
    : 0;
  const pannageCapacity = building.kind === 'swineherd'
    ? pannageHoldingHeadCapacity(pastures, maturePannageTrees)
    : null;
  const neutralCapacity = !herd
    ? 0
    : herd.species === 'swine'
      ? pannageCapacity?.headCapacity ?? 0
      : neutralPastureHoldingHeadCapacity(pastures, herd.species);
  const neutralWholeHeadLimit = herd
    ? livestockHoldingWholeHeadLimit(neutralCapacity, herd.species)
    : 0;
  const healthPercent = Math.round((herd?.health ?? 0) * 100);
  const breedingPercent = Math.round((herd?.breedingProgress ?? 0) * 100);
  const overCapacity = herd ? herd.headCount > herd.suppliedCapacity : false;
  const clock = gameClock(context.gameState.tick);
  const month = clock.month;
  const environment = environmentFor(
    context.gameState.seed,
    context.worldHydrology,
    clock,
    context.severeWeatherEnabled ?? false,
  );
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
  const activeTrip = context.worldQueries.getActiveDeliveryTrip(building);
  const laborForecast = livestockLaborForecastByBuilding(context.gameState).get(
    building.id,
  );
  const onsiteLabor = laborForecast?.onsiteHumanWorkers
    ?? onsiteBuildingLabor(building, activeTrip);
  const pairedOxen = laborForecast?.pairedOxen ?? 0;
  const effectiveLabor = laborForecast?.effectiveWorkers ?? onsiteLabor;
  const fodderPlan = herd
    ? projectLivestockFodderHolding(
      building,
      herd,
      environment.pastureCapacityMultiplier,
      sabbathObserved,
      month,
      clock.monthDay,
      laborForecast,
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
  const dairyProductiveHeads = herd && herd.species !== 'swine' && fodderPlan
    ? livestockDairyProductiveHeads(herd.species, fodderPlan.productiveHeads)
    : 0;
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
  const inboundOats = inboundTrip?.cargoKind === 'oatGrain'
    ? Math.max(0, inboundTrip.amount)
    : 0;
  const inboundAnimalFeed = inboundTrip?.cargoKind === 'animalFeed'
    ? Math.max(0, inboundTrip.amount)
    : 0;
  const headsPerWorker = herd ? livestockHeadsPerWorker(herd.species) : 0;
  const careCapacity = herd
    ? livestockCareCapacity(herd.species, effectiveLabor)
    : 0;
  const troughWaterPerCycle = herd
    ? livestockWaterRequiredPerCycle(herd.species, herd.headCount)
    : 0;
  const troughWater = Math.max(0, building.water ?? 0);
  const troughCycles = troughWaterPerCycle > 1e-9
    ? troughWater / troughWaterPerCycle
    : Number.POSITIVE_INFINITY;
  const active = Boolean(
    herd
      && herd.headCount > 0
      && pastures.length > 0
      && onsiteLabor > 0
      && troughWaterPerCycle <= troughWater + 1e-6
      && herd.health >= 0.45,
  );
  const foodTerritory = context.worldQueries.getClaimedResidencesForFoodSupplier(building);
  const foodCapacity = storageCaps.food ?? 0;
  const householdFoodFloor = householdFoodReserve(foodTerritory.length, foodCapacity);
  const dispatchableFoodStock = institutionalDispatchableFoodStock(
    building.kind,
    edibleFoodStock(building),
    building.oatGrain ?? 0,
    (herd?.headCount ?? 0) > 0,
  );
  const institutionalSurplus = institutionalFoodSurplus(
    dispatchableFoodStock,
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
      ? 'None · household food and feed-workshop oats are protected'
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
  const statusText = (() => {
    if (!herd) return 'Choose cattle or sheep';
    if (pastures.length === 0) {
      return herd.species === 'swine' ? 'Fence woodland pannage' : 'Fence a pasture';
    }
    if (herd.headCount === 0) {
      return neutralWholeHeadLimit > 0
        ? `Unstocked — select a pasture to buy up to ${neutralWholeHeadLimit} head`
        : 'Expand the parcel before stocking';
    }
    if (troughWater + 1e-6 < troughWaterPerCycle) return 'Trough water is short';
    if (careCapacity < herd.headCount) {
      return pairedOxen > 0
        ? `Ox-assisted crew can care for ${careCapacity} of ${herd.headCount} head`
        : `Herders can care for ${careCapacity} of ${herd.headCount} head`;
    }
    if (winterReserveAtRisk) {
      return `Winter Animal Feed short ${fodderPlan!.winterReserveShortfall.toFixed(1)}`;
    }
    if (herd.species === 'sheep' && shearingWindow && !shornThisYear) {
      if (shearingStorageBlocked) {
        return `Shearing waits for full-clip room · ${projectedFleece.toFixed(1)} needed / ${woolRoom.toFixed(1)} free`;
      }
      if (shearingFlockBlocked) return 'Shearing waiting for a healthy supplied flock';
      return 'Annual shearing underway';
    }
    if (
      isLivestockHaymakingMonth(month)
      && fodderPlan
      && fodderPlan.haymakingPercent > 0
      && overCapacity
    ) {
      return `Haymaking reserves ${fodderPlan.haymakingPercent}% of summer pasture — warm-season forage is short`;
    }
    if (overCapacity) return 'Grazing or mast, trough water, or care support is short';
    if (herd.health < 0.45) return 'Herd health is poor';
    if (dairySaltEmpty) return 'Cheese salt empty — fresh milk continues';
    if (herd.lastCulled > 0) {
      return `Autumn slaughter — ${herd.lastCulled} surplus head culled`;
    }
    if (cullSeason && projectedCull.heads > 0 && !cullHasStorage) {
      return 'Autumn slaughter waiting for empty food storage';
    }
    if (cullSeason && projectedCull.heads > 0) {
      return `Culling ${projectedCull.heads} surplus head before winter`;
    }
    if (projectedCull.heads > 0) {
      return `Holding ${projectedCull.heads} surplus head for October`;
    }
    return 'Herd tended';
  })();

  const role = building.kind === 'swineherd'
    ? 'Woodland pannage → winter mast, then delivered Animal Feed · autumn pork culls and a separate water trough'
    : !herd
      ? 'Unstocked holding → choose cattle or sheep before laying out pasture'
    : herd?.species === 'sheep'
      ? 'Warm-season upland grazing; winter shortfalls use local hay, then Animal Feed · sheep milk, salt-cured cheese, annual wool, and mutton culls'
      : 'Warm-season pasture; winter shortfalls use local hay, then Animal Feed · cow milk, salt-cured cheese, beef culls, manure, and ox power';
  const feedingRule = building.kind === 'swineherd'
    ? 'Warm-season woodland forage; in winter, reduced mast → Animal Feed delivered from a pastoral farmstead. Water is a separate trough need.'
    : 'Warm-season grazing; in winter, reduced pasture → local hay → Animal Feed prepared from oats. Water is a separate trough need.';

  const purchasePrice = herd ? livestockPurchaseGoldPerHead(herd.species) : 0;
  const salePrice = herd ? livestockSaleGoldPerHead(herd.species) : 0;
  const canChangeSpecies = !herd || (herd.headCount === 0 && pastures.length === 0);

  const speciesControls = building.kind === 'pastoral_farmstead'
    ? `<div class="inspector-action-panel" data-inspector-panel-title="Herd">
        <p class="resource-inspector-note">${herd
          ? 'Species policy only. Sell every animal and remove linked pasture before changing species.'
          : 'Choose which species this empty holding will manage. Animals are purchased separately after pasture is fenced.'}</p>
        <div class="resource-action-row">
          <button type="button" class="resource-action-button resource-action-button--icon" data-livestock-species="cattle" ${herd?.species === 'cattle' || !canChangeSpecies ? 'disabled' : ''}><span class="inspector-action-icon" data-action-icon="cattle-herd" aria-hidden="true"></span><span>Cattle</span></button>
          <button type="button" class="resource-action-button resource-action-button--icon" data-livestock-species="sheep" ${herd?.species === 'sheep' || !canChangeSpecies ? 'disabled' : ''}><span class="inspector-action-icon" data-action-icon="sheep-flock" aria-hidden="true"></span><span>Sheep</span></button>
        </div>
        <p class="inspector-action-panel__hint"><strong>Cattle:</strong> ${CATTLE_AREA_PER_HEAD} m²/head, up to ${CATTLE_MAX_HERD}; stronger milk per lactating animal, beef culls, physical manure, and ox support for ${CATTLE_MAX_PLOUGH_SUPPORTED_FIELDS} priority fields. <strong>Sheep:</strong> ${SHEEP_AREA_PER_HEAD} m²/head, up to ${SHEEP_MAX_HERD}; faster-growing upland flocks, mutton culls, and an annual ${SHEEP_WOOL_PER_SHEARING_PER_HEAD} wool/head clip for cloth and export. Calves, lambs, males, and dry females still need grazing, winter hay or Animal Feed, trough water, and care, so only the species-specific lactating share makes milk.</p>
      </div>`
    : undefined;
  const herdManagementControls = herd
    ? `<div class="inspector-action-panel" data-inspector-panel-title="Herd management">
        <p class="resource-inspector-note">Purchase new breeding stock from a selected linked pasture, where the usable land limit is visible. Sales and holding policy remain here because every linked parcel belongs to one shared herd.</p>
        ${herd.headCount > 0 ? `<div class="resource-action-row">
          <button type="button" class="resource-action-button" data-livestock-trade="-1">Sell 1 · ${renderResourceAmount('gold', salePrice, { compact: true })}</button>
          ${herd.headCount > 1 ? `<button type="button" class="resource-action-button" data-livestock-trade="-${herd.headCount}">Sell all · ${renderResourceAmount('gold', livestockSaleProceeds(herd.species, herd.headCount), { compact: true })}</button>` : ''}
        </div>` : ''}
        <p class="inspector-action-panel__hint">${neutralWholeHeadLimit} whole-head slots from ${neutralCapacity.toFixed(1)} neutral combined capacity. Regional stock costs ${renderResourceAmount('gold', purchasePrice, { compact: true })}/head but sells for only ${renderResourceAmount('gold', salePrice, { compact: true })}/head.${herd.species === 'swine' ? '' : ' Changing cattle ↔ sheep requires selling the entire herd and removing every linked pasture before choosing again.'}</p>
      </div>`
    : '';
  const milkUseControls = herd && herd.species !== 'swine' && building.kind === 'pastoral_farmstead'
    ? `<div class="inspector-action-panel" data-inspector-panel-title="Milk use">
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
    ? `Fence any number of woodland parcels inside this holding’s work extent, then select a parcel to buy the initial herd. Mature trees act as an abstract mast proxy. Pigs forage through the warm seasons; in winter they use remaining mast before delivered Animal Feed. Trough water is supplied separately at the sty. A typical first order of ${SWINE_STARTER_HERD} pigs needs at least ${SWINE_STARTER_HERD * SWINE_AREA_PER_HEAD} m² and ${SWINE_STARTER_HERD * SWINE_MATURE_TREES_PER_HEAD} mature trees before seasonal losses.`
    : !herd
      ? 'Choose cattle or sheep before fencing grazing land.'
      : `Fence any number of warm-season grazing parcels inside this holding’s work extent, then select a parcel to buy the initial herd. During June–August, the chosen meadow share is cut into local winter hay. A typical first order needs about ${herd.species === 'cattle' ? CATTLE_STARTER_HERD * CATTLE_AREA_PER_HEAD : SHEEP_STARTER_HERD * SHEEP_AREA_PER_HEAD} m² on ideal ground; slope and moisture can increase that requirement.`;
  const pastureControls = `<div class="inspector-action-panel" data-inspector-panel-title="Pasture">
      <p class="resource-inspector-note">${pastureHint}</p>
      <div class="resource-action-row">
        <button type="button" class="resource-action-button resource-action-button--icon" data-land-parcel="pasture" data-tooltip-title="${pastureLabel}" data-tooltip="Lay out a fenced parcel inside this holding’s work extent." data-tooltip-cost="${FREE_CONSTRUCTION_COST_TOOLTIP}" data-tooltip-cost-affordable="true" ${building.kind === 'pastoral_farmstead' && !herd ? 'disabled' : ''}><span class="inspector-action-icon" data-action-icon="pasture-parcel" aria-hidden="true"></span><span>${pastureLabel}</span></button>
      </div>
    </div>`;
  const reserveControls = herd
    ? `<div class="inspector-action-panel" data-inspector-panel-title="Breeding reserve">
        <p class="resource-inspector-note">Spring births grow a healthy, well-supplied herd toward its linked-land ceiling. By default every supported animal is retained; lowering the winter breeding reserve marks surplus above that size for October–November culling.</p>
        <div class="resource-action-row">
          ${livestockReservePresets(herd.species)
            .map((preset) => `<button type="button" class="resource-action-button" data-livestock-breeding-reserve="${preset.reserve}" ${breedingReserve === preset.reserve ? 'disabled' : ''}>${preset.label} · ${preset.reserve}</button>`)
            .join('')}
        </div>
        <p class="inspector-action-panel__hint">${projectedCull.heads > 0
          ? `${projectedCull.heads} surplus head currently project ${projectedCull.food.toFixed(0)} fresh ${SPECIES_MEAT_LABEL[herd.species]}${projectedCull.preservedFood > 0 ? ` + up to ${projectedCull.preservedFood.toFixed(1)} cured provisions using ${renderResourceAmount('salt', livestockPreservationSaltRequired(projectedCull.preservedFood), { compact: true })}` : ''}. Species meat enters the shared meat inventory. Slaughter pauses unless the holding can store a whole animal’s actual yield; any unsalted cured share enters the fresh store instead.`
          : `No current surplus. The holding will keep up to ${breedingReserve} head through winter.`}</p>
      </div>`
    : '';
  const haymakingForecastHint = !fodderPlan
    ? ''
    : fodderPlan.hayStock + 0.05 >= LIVESTOCK_HAY_STORAGE_CAPACITY
      ? 'The loft is full, so designated meadow has returned to grazing until hay is consumed.'
      : onsiteLabor <= 0
      ? 'The meadow allocation is configured, but no hay is cut while the holding is unstaffed.'
      : isLivestockHaymakingMonth(month)
        ? `${fodderPlan.haymakingDaysRemaining} cutting days remain at current ${pairedOxen > 0 ? 'ox-assisted ' : ''}staffing, projecting ${fodderPlan.projectedHayStock.toFixed(1)} / ${LIVESTOCK_HAY_STORAGE_CAPACITY} in the loft; drought can reduce the cut.`
        : month < LIVESTOCK_HAYMAKING_START_MONTH
          ? `At current ${pairedOxen > 0 ? 'ox-assisted ' : ''}staffing, the coming hay season projects ${fodderPlan.projectedHayStock.toFixed(1)} / ${LIVESTOCK_HAY_STORAGE_CAPACITY} in the loft; drought can reduce the cut.`
          : `This year's cutting season has ended with ${Math.round(fodderPlan.hayStock)} / ${Math.round(LIVESTOCK_HAY_STORAGE_CAPACITY)} in the loft.`;
  const haymakingControls = herd && building.kind === 'pastoral_farmstead' && fodderPlan
    ? `<div class="inspector-action-panel" data-inspector-panel-title="Haymaking">
        <p class="resource-inspector-note">June–August local haymaking — reserving more pasture from grazing builds this holding’s winter hay reserve. Cattle and sheep consume that hay before Animal Feed in winter, but the reserved meadow reduces warm-season grazing capacity while grass is being cut.</p>
        <div class="resource-action-row">
          ${livestockHaymakingPresets()
            .map((preset) => `<button type="button" class="resource-action-button" data-livestock-haymaking-percent="${preset.percent}" ${fodderPlan.haymakingPercent === preset.percent ? 'disabled' : ''}>${preset.label} · ${preset.percent}%</button>`)
            .join('')}
        </div>
        <p class="inspector-action-panel__hint">${fodderPlan.haymakingPercent <= 0
          ? 'No meadow is reserved for hay. Winter pasture shortages will fall directly on stored Animal Feed.'
          : `${fodderPlan.summerReservedCapacity.toFixed(1)} head-capacity is reserved in hay season. ${haymakingForecastHint}`}</p>
      </div>`
    : '';

  const recentOutput = herd
    ? `${Math.round(herd.lastFoodOutput)} fresh food · ${Math.round(herd.lastPreservedOutput)} salted provisions${herd.lastHayOutput > 0 ? ` · ${Math.round(herd.lastHayOutput)} local hay` : ''}${herd.lastCulled > 0 ? ` · ${herd.lastCulled} culled` : ''}`
    : 'None';
  const manurePerCycle = herd?.species === 'cattle'
    ? cattleManurePerCycle(
      Math.min(herd.headCount, herd.suppliedCapacity) * herd.health,
      environment.season,
    )
    : 0;
  const capacity = herd
    ? `${herd.headCount} / ${neutralWholeHeadLimit} head · ${neutralCapacity.toFixed(1)} neutral land · ${herd.suppliedCapacity.toFixed(1)} currently supplied`
    : 'No herd';
  const woodlandRows = building.kind === 'swineherd'
    ? `<li><span>Fenced woodland trees</span><span>${maturePannageTrees} mature · ${(pannageCapacity?.mastHeadCapacity ?? 0).toFixed(1)} pig capacity</span></li>
       <li><span>Pannage bottleneck</span><span>${(pannageCapacity?.areaHeadCapacity ?? 0).toFixed(1)} by area / ${(pannageCapacity?.mastHeadCapacity ?? 0).toFixed(1)} by woodland mast · ${maturePannageTrees > 0 ? 'autumn mast peak' : 'clear-cut — winter Animal Feed required'}</span></li>`
    : '';
  const benefitRow = herd?.species === 'cattle'
    ? `<li><span>Ox team</span><span>Highest-priority ${CATTLE_MAX_PLOUGH_SUPPORTED_FIELDS} fields inside work extent · ${Math.round((1 - CATTLE_PLOUGH_WORK_MULTIPLIER) * 100)}% less ploughing</span></li>
       <li><span>Manure output</span><span>${manurePerCycle.toFixed(2)} per work cycle now · supplied heads, health, and seasonal housing govern collection</span></li>
       <li><span>Manure yard</span><span>${Math.round(Math.max(0, building.manure ?? 0))} / ${Math.round(storageCaps.manure ?? 0)} · carts deliver it to road-linked crop farmsteads, where it is spread during ploughing and restores up to ${Math.round(FARM_MANURE_FERTILITY_BONUS * 100)} fertility points after harvest</span></li>`
    : herd?.species === 'sheep'
      ? `<li><span>Sheep advantage</span><span>Steeper, drier upland pasture · faster breeding · annual ${SHEEP_WOOL_PER_SHEARING_PER_HEAD} wool/head clip feeds the weaver-to-cloth export chain</span></li>`
      : '<li><span>Seasonality</span><span>No passive pork · actual surplus culls in October–November</span></li>';
  const feedingCoverage = !fodderPlan
    ? 'No herd'
    : environment.season !== 'winter'
      ? fodderPlan.currentUnsupportedHeads <= 0.01
        ? `${herd?.species === 'swine' ? 'Woodland forage' : 'Pasture'} covers the current herd; Animal Feed is reserved for winter and trough water remains separate`
        : `${fodderPlan.currentUnsupportedHeads.toFixed(1)} head exceed current ${herd?.species === 'swine' ? 'woodland forage' : 'pasture'} capacity · Animal Feed is winter-only, so expand forage, reduce haymaking, or reduce the herd`
      : fodderPlan.currentFeedPerDay <= 0.01
        ? `${herd?.species === 'swine' ? 'Winter mast' : 'Winter pasture'} covers the current herd; trough water remains a separate need`
        : herd?.species !== 'swine' && fodderPlan.hayStock > 0
          ? `${fodderPlan.currentUnsupportedHeads.toFixed(1)} head unsupported by winter pasture · local hay is consumed first, then ${renderResourceAmount('animalFeed', fodderPlan.currentFeedPerDay, { compact: true, suffix: '/day' })} · ready feed alone covers ${formatProvisionRunway(fodderPlan.currentFeedRunwayDays)} at that eventual rate${onsiteLabor <= 0 ? ' · no herder is replenishing it' : ''}`
          : `${fodderPlan.currentUnsupportedHeads.toFixed(1)} head unsupported by winter ${herd?.species === 'swine' ? 'mast' : 'pasture'} · Animal Feed draw ${renderResourceAmount('animalFeed', fodderPlan.currentFeedPerDay, { compact: true, suffix: '/day' })} · ${formatProvisionRunway(fodderPlan.currentFeedRunwayDays)} ready onsite${onsiteLabor <= 0 ? ' · no herder is replenishing it' : ''}`;
  const winterHerdPlan = !fodderPlan
    ? 'No herd'
    : `${fodderPlan.projectedHeadCount} head after ${fodderPlan.executableCullHeads}/${fodderPlan.plannedCullHeads} currently executable planned culls${fodderPlan.unsecuredCullHeads > 0 ? ` · ${fodderPlan.unsecuredCullHeads} surplus still provisioned until labor and whole-carcass storage are ready` : ''} · ${fodderPlan.winterPastureCapacity.toFixed(1)} ${herd?.species === 'swine' ? 'mast' : 'pasture'}-supported · ${fodderPlan.winterUnsupportedHeads.toFixed(1)} ${herd?.species === 'swine' ? 'need Animal Feed' : 'need local hay, then Animal Feed'}`;
  const haymakingPlan = !fodderPlan || herd?.species === 'swine'
    ? 'Pigs use winter woodland mast, then Animal Feed; they do not make hay'
    : fodderPlan.hayStock + 0.05 >= LIVESTOCK_HAY_STORAGE_CAPACITY
      ? `${fodderPlan.haymakingPercent}% policy · loft full, so all meadow is grazing again`
      : `${fodderPlan.haymakingPercent}% of summer pasture · ${fodderPlan.summerReservedCapacity.toFixed(1)} head-capacity · ${fodderPlan.hayOutputPerDay.toFixed(1)} local hay / day ${isLivestockHaymakingMonth(month) ? 'now' : 'in season'}`;
  const winterHayReserve = !fodderPlan || herd?.species === 'swine'
    ? 'Woodland pigs use mast, not the hay chain'
    : `${Math.round(fodderPlan.hayStock)} stored · ${Math.floor(fodderPlan.projectedHayStock)} projected at winter / ${Math.ceil(fodderPlan.winterHayNeed)} needed · ${formatProvisionRunway(fodderPlan.winterHayRunwayDays)}`;
  const winterFeedReserve = !fodderPlan
    ? 'No herd'
    : fodderPlan.winterReserveTarget <= 0.01
        ? fodderPlan.winterUnsupportedHeads <= 0.01
          ? `Winter ${herd?.species === 'swine' ? 'mast' : 'pasture'} covers the projected herd`
          : 'Projected local hay covers the remaining winter feed demand'
        : `${Math.round(fodderPlan.winterReserveStock)} / ${Math.ceil(fodderPlan.winterReserveTarget)} Animal Feed ${herd?.species === 'swine' ? 'onsite after winter mast capacity' : 'onsite after local hay'} · ${formatProvisionRunway(fodderPlan.winterCombinedRunwayDays)} combined coverage${onsiteLabor <= 0 ? ' · assign herders to receive or prepare feed' : ''}`;
  const winterResupplyRow = fodderPlan
    && fodderPlan.winterFeedNeed > fodderPlan.winterReserveTarget + 0.05
    ? `<li><span>Winter resupply</span><span>A full Animal Feed store covers ${formatProvisionRunway(fodderPlan.storageRunwayDays)} · ${renderResourceAmount('animalFeed', fodderPlan.winterFeedNeed, { compact: true, suffix: `needed across ${LIVESTOCK_WINTER_FODDER_RESERVE_DAYS} days` })}</span></li>`
    : '';
  const feedSupplyRow = building.kind === 'pastoral_farmstead'
    ? fodderPlan
      ? `<li><span>Feed workshop</span><span>${Math.round(fodderPlan.oatInputStock)} oats${inboundOats > 0.001 ? ` + ${Math.round(inboundOats)} inbound` : ''} / ${Math.ceil(fodderPlan.oatInputTarget)} local input target · ${LIVESTOCK_FEED_OAT_GRAIN_PER_CYCLE} oat → ${LIVESTOCK_ANIMAL_FEED_PER_CYCLE} Animal Feed · ${renderResourceAmount('animalFeed', fodderPlan.feedConversionPerDay, { compact: true, suffix: '/day' })} at current staffing${onsiteLabor <= 0 ? ' · paused until staffed' : ''}</span></li>`
      : `<li><span>Feed workshop</span><span>Choose a herd and assign staff to prepare ${LIVESTOCK_FEED_OAT_GRAIN_PER_CYCLE} oat → ${LIVESTOCK_ANIMAL_FEED_PER_CYCLE} Animal Feed</span></li>`
    : `<li><span>Feed supply</span><span>Finished Animal Feed arrives by road from staffed pastoral farmsteads; raw oats are not fed here</span></li>`;
  const dairySaltRow = building.kind !== 'pastoral_farmstead' || !fodderPlan
    ? ''
    : `<li><span>Cheese salt</span><span>${Math.round(fodderPlan.dairySaltStock)} onsite${inboundSalt > 0.001 ? ` + ${Math.round(inboundSalt)} inbound` : ''} / ${Math.ceil(fodderPlan.dairySaltTarget)} working target · ${renderResourceAmount('salt', fodderPlan.dairySaltPerDay, { compact: true, suffix: '/day' })} at current herd and ${pairedOxen > 0 ? 'ox-assisted ' : ''}staffing · ${formatProvisionRunway(fodderPlan.dairySaltRunwayDays)} onsite</span></li>
      <li><span>Salt logistics</span><span>${inboundSalt > 0.001
        ? `Salt cart ${formatTripPhaseLabel(inboundTrip!.phase).toLowerCase()} from ${context.worldQueries.getBuildingLabel(context.worldQueries.getBuilding(inboundTrip!.buildingId)?.kind ?? 'marketplace')}`
        : 'Road-linked mine or marketplace carts share salt between smokehouses and pastoral holdings by runway and road distance'} · empty salt stops farmhouse cheese, not fresh milk or herd care</span></li>`;

  return {
    eyebrow: 'Livestock holding',
    title: definition.label,
    statusText,
    statusState: winterReserveAtRisk
      || shearingStorageBlocked
      || shearingFlockBlocked
      || overCapacity
      || Boolean(herd && herd.headCount > careCapacity)
      || Boolean(herd && troughWater + 1e-6 < troughWaterPerCycle)
      || (herd?.health ?? 1) < 0.45
      || dairySaltEmpty
      ? 'warning'
      : active
        ? 'active'
        : 'idle',
    detailsHtml: `
      <li><span>Role</span><span>${role}</span></li>
      <li><span>Herd</span><span>${herd ? SPECIES_LABEL[herd.species] : 'None'}</span></li>
      ${herd?.species !== 'swine' && herd ? `<li><span>Milk use</span><span>${milkUse.label} · ${milkAllocation?.freshMilk.toFixed(2) ?? '0.00'} milk + ${milkAllocation?.cheese.toFixed(2) ?? '0.00'} cheese per husbandry cycle · ${dairyProductiveHeads.toFixed(1)} lactating-equivalent head</span></li>` : ''}
      <li><span>Stocking</span><span>${capacity}</span></li>
      <li><span>Pastures</span><span>${pastures.length} · ${Math.round(pastureArea)} m² fenced</span></li>
      <li><span>Main holding</span><span>Winter shelter, local hayloft, Animal Feed store, herd policy, sales, and separate water trough${building.kind === 'pastoral_farmstead' ? ' · staffed workshop prepares oats into feed' : ''}</span></li>
      <li><span>Feeding rule</span><span>${feedingRule}</span></li>
      <li><span>Herding care</span><span>${herd ? `${careCapacity} / ${herd.headCount} head covered by ${onsiteLabor} onsite worker${onsiteLabor === 1 ? '' : 's'}${pairedOxen > 0 ? ` + ${pairedOxen} paired stable ox${pairedOxen === 1 ? '' : 'en'} = ${effectiveLabor} effective workers` : ''} · ${headsPerWorker} head/${pairedOxen > 0 ? 'effective ' : ''}worker` : 'Choose a species first'}</span></li>
      <li><span>Water trough</span><span>${herd ? `${troughWater.toFixed(1)} / ${Math.round(storageCaps.water ?? 0)} water · ${troughWaterPerCycle.toFixed(2)} needed/cycle · ${Number.isFinite(troughCycles) ? troughCycles.toFixed(1) : '∞'} cycles onsite` : 'Not stocked'}</span></li>
      <li><span>Health</span><span>${herd && herd.headCount > 0 ? `${healthPercent}%` : 'Not stocked'}</span></li>
      <li><span>Spring breeding</span><span>${herd ? herd.headCount < LIVESTOCK_MINIMUM_BREEDING_HEADS ? `Needs at least ${LIVESTOCK_MINIMUM_BREEDING_HEADS} head` : `${breedingPercent}% toward the next birth · pauses outside spring` : 'Not started'}</span></li>
      <li><span>Winter reserve</span><span>${herd ? `${breedingReserve} head · ${projectedCull.heads} current surplus` : 'None'}</span></li>
      <li><span>Last husbandry cycle</span><span>${recentOutput}</span></li>
      ${dairySaltRow}
      ${feedSupplyRow}
      <li><span>Animal Feed store</span><span>${Math.round(Math.max(0, building.animalFeed ?? 0))}${inboundAnimalFeed > 0.001 ? ` + ${Math.round(inboundAnimalFeed)} inbound` : ''} / ${Math.round(storageCaps.animalFeed ?? 0)} ready winter fodder · non-food</span></li>
      <li><span>Feeding coverage</span><span>${feedingCoverage}</span></li>
      <li><span>Summer haymaking</span><span>${haymakingPlan}</span></li>
      <li><span>Local hayloft</span><span>${fodderPlan ? `${Math.round(fodderPlan.hayStock)} / ${Math.round(LIVESTOCK_HAY_STORAGE_CAPACITY)} hay` : 'No herd'}</span></li>
      <li><span>Winter hay coverage</span><span>${winterHayReserve}</span></li>
      <li><span>Winter herd plan</span><span>${winterHerdPlan}</span></li>
      <li><span>Winter Animal Feed</span><span>${winterFeedReserve}</span></li>
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
            ? `Waiting for full-clip room · ${projectedFleece.toFixed(1)} needed / ${woolRoom.toFixed(1)} free · other husbandry continues`
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
      hint: (herd?.headCount ?? 0) > 0
        ? `Sell the ${herd!.headCount} remaining head before demolition.`
        : pastures.length > 0
        ? `Remove its ${pastures.length === 1 ? 'pasture' : 'pastures'} first. ${buildingDemolishHint(building.kind)}`
        : buildingDemolishHint(building.kind),
    },
    labor: buildingLaborView(building, context.populationStats, context.worldQueries),
    supplementalPanelHtml: `${speciesControls ?? ''}${pastureControls}${herdManagementControls}${milkUseControls}${reserveControls}${haymakingControls}`,
  };
}
