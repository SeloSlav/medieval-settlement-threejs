import {
  residenceZoneCost,
  STONE_SALVAGE_FRACTION,
  TIMBER_SALVAGE_FRACTION,
} from '../buildingEconomy.ts';
import {
  formatFirewoodRunwayDays,
  RESIDENCE_WATER_CAPACITY,
  residenceFirewoodRunwayDays,
  SIM_TICK_SECONDS,
} from '../resourceTotals.ts';
import {
  RESIDENCE_ALE_CAPACITY,
  CALENDAR_SECONDS_PER_DAY,
  HUNGER_WARNING_DAYS,
  MALNUTRITION_DAYS,
  PRESERVED_FOOD_STORAGE_RESIDENCE_FACTOR,
  RESIDENCE_CLOTH_CAPACITY,
  RESIDENCE_SHOES_CAPACITY,
  RESIDENCE_FOOD_CAPACITY,
  RESIDENCE_PRESERVED_FOOD_CAPACITY,
  RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC,
  RESIDENCE_POTTERY_CAPACITY,
  RESIDENCE_TILE_ROOF_SALVAGE_FRACTION,
  RESIDENCE_TILE_ROOF_TILE_COST,
  STARVATION_DEATH_START_DAYS,
  COLD_EXPOSURE_WARNING_DAYS,
  COLD_EXPOSURE_DEATH_START_DAYS,
  HERB_TREATMENT_PER_SICK_DAY,
} from '../../generated/gameBalance.ts';
import { formatPreservedFoodLoss } from '../../economy/foodPreservation.ts';
import {
  NAMED_FOOD_KINDS,
  NAMED_FOOD_LABELS,
  edibleFoodStock,
  foodCategoryQualifyingStock,
  foodProgressionStatus,
  householdFoodPerDay,
  presentFoodCategories,
  FOOD_CATEGORY_LABELS,
  FOOD_PROGRESSION_SLOT_LABELS,
  preservedFoodStock,
} from '../../economy/foodInventory.ts';
import {
  formatFoodRunwayDays,
  residenceFoodRunwayDays,
} from '../../logistics/foodLogistics.ts';
import {
  formatSpecialtyRunwayDays,
  SPECIALTY_CONSUMPTION_SECONDS_PER_DAY,
  residenceAleRunwayDays,
  residenceClothRunwayDays,
  residenceShoesRunwayDays,
  residencePreservedFoodRunwayDays,
  residencePotteryRunwayDays,
} from '../../logistics/specialtyLogistics.ts';
import { formatWaterRunwayDays, residenceWaterRunwayDays } from '../../logistics/waterLogistics.ts';
import { formatDeliveryRoadDistance } from '../../logistics/deliveryLogistics.ts';
import { effectiveResidenceSettleTicks } from '../../economy/chapelCommunity.ts';
import { formatHouseholdProsperity } from '../../economy/householdWealth.ts';
import {
  formatResidenceServiceConsequence,
  residenceServiceState,
} from '../../economy/residenceSatisfaction.ts';
import { DEFAULT_PARISH_POLICY } from '../../economy/chapelParish.ts';
import {
  DEFAULT_PANTRY_SAFEGUARD_POLICY,
  normalizePantrySafeguardPolicy,
  pantrySafeguardPolicyOption,
} from '../../economy/pantrySafeguardPolicy.ts';
import { gameClock } from '../../world/gameCalendar.ts';
import {
  environmentFor,
} from '../../world/seasonPolicy.ts';
import {
  allocatePreservedMeal,
  freshFoodRunwayWithPreservedRotation,
} from '../../economy/preservedFoodPolicy.ts';
import { residenceSettlementReadiness } from '../../economy/residenceSettlement.ts';
import {
  evaluateResidenceUpgrade,
  residenceBackyardProject,
  residenceFireRepairProject,
  residenceHasHouseholdLuxuryOption,
  residenceRoofTileProject,
  residenceUpgradeProject,
  type ResidenceFireRepairProject,
  type ResidenceRoofTileProject,
  type ResidenceUpgradePlan,
  type ResidenceUpgradeProject,
  type ResidenceUpgradeServiceKind,
} from '../../economy/residenceUpgrade.ts';
import { backyardGardenLabel } from '../../residences/backyardGarden.ts';
import {
  CONSTRUCTION_PRIORITIES,
  constructionPriorityLabel,
  type ConstructionPriority,
} from '../../logistics/constructionPriority.ts';
import {
  renderBuildingResourceCost,
  renderResourceCost,
} from '../../ui/resourceCost.ts';
import {
  computeSettlementProsperityPlan,
  projectTierFourUpgrade,
  type SettlementProsperityPlan,
  type TierFourUpgradeProjection,
} from '../../economy/settlementProsperity.ts';
import { productionRoadBranchKey } from '../../economy/settlementProduction.ts';
import { fireForTarget } from '../../fires/fireIncident.ts';
import {
  buildResidenceCommunityContext,
  buildResidenceParishEconomyView,
} from '../../economy/economyInspectorViews.ts';
import {
  RESIDENCE_FIREWOOD_CAPACITY,
  activeResidenceNeedKinds,
  residenceNeedCategory,
  residenceNeedsStatus,
  getNeed,
  getNeedStock,
} from '../../residences/residenceNeeds.ts';
import { requiredChapelTierForResidence } from '../../residences/residenceNeedState.ts';
import type { BuildingState, InspectableTarget, ResidenceState } from '../types.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import { hiddenLabor } from './renderInspectableTarget.ts';

export function renderResidenceInspector(
  target: Extract<InspectableTarget, { kind: 'residence' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { residence, zone, residenceCount } = target;
  const residenceFire = fireForTarget(
    context.gameState.fireIncidents.values(),
    'residence',
    residence.id,
  );
  const fireDisabled = residenceFire !== null;
  const intactPlotResidences = Array.from(context.gameState.residences.values()).filter(
    (candidate) =>
      candidate.zoneId === zone.id
      && fireForTarget(
        context.gameState.fireIncidents.values(),
        'residence',
        candidate.id,
      ) === null,
  );
  const completedIntactPlotResidenceCount = intactPlotResidences.filter(
    (candidate) => candidate.tier >= 1,
  ).length;
  const reclaimablePlotResidences = Array.from(context.gameState.residences.values()).filter(
    (candidate) =>
      candidate.zoneId === zone.id
      && (
        fireForTarget(
          context.gameState.fireIncidents.values(),
          'residence',
          candidate.id,
        ) === null
        || candidate.fireRepairActive === true
      ),
  );
  const reclaimablePlotResidenceCount = reclaimablePlotResidences.length;
  const singleCost = residenceZoneCost(1);
  const singleRefund = fireDisabled
    ? {
        timber: residence.fireRepairActive === true
          ? Math.round(
              (residence.upgradeDeliveredTimber ?? 0) * TIMBER_SALVAGE_FRACTION,
            )
          : 0,
        stone: residence.fireRepairActive === true
          ? Math.round(
              (residence.upgradeDeliveredStone ?? 0) * STONE_SALVAGE_FRACTION,
            )
          : 0,
        roofTiles: 0,
      }
    : {
        timber: Math.round(
          ((residence.tier >= 1 ? singleCost.timber : 0)
            + (residence.upgradeDeliveredTimber ?? 0))
          * TIMBER_SALVAGE_FRACTION,
        ),
        stone: Math.round(
          ((residence.tier >= 1 ? singleCost.stone : 0)
            + (residence.upgradeDeliveredStone ?? 0))
          * STONE_SALVAGE_FRACTION,
        ),
        roofTiles: Math.round(
          ((residence.tiledRoof === true ? RESIDENCE_TILE_ROOF_TILE_COST : 0)
            + (residence.upgradeDeliveredRoofTiles ?? 0))
          * RESIDENCE_TILE_ROOF_SALVAGE_FRACTION,
        ),
      };
  const plotRefund = {
    timber: Math.round(
      (residenceZoneCost(completedIntactPlotResidenceCount).timber
        + reclaimablePlotResidences.reduce(
          (sum, candidate) => sum + (candidate.upgradeDeliveredTimber ?? 0),
          0,
        ))
      * TIMBER_SALVAGE_FRACTION,
    ),
    stone: Math.round(
      (residenceZoneCost(completedIntactPlotResidenceCount).stone
        + reclaimablePlotResidences.reduce(
          (sum, candidate) => sum + (candidate.upgradeDeliveredStone ?? 0),
          0,
        ))
      * STONE_SALVAGE_FRACTION,
    ),
    roofTiles: Math.round(
      reclaimablePlotResidences.reduce(
        (sum, candidate) =>
          sum
          + (candidate.tiledRoof === true ? RESIDENCE_TILE_ROOF_TILE_COST : 0)
          + (candidate.upgradeDeliveredRoofTiles ?? 0),
        0,
      ) * RESIDENCE_TILE_ROOF_SALVAGE_FRACTION,
    ),
  };
  const singleRoofTileSalvage = singleRefund.roofTiles > 0
    ? ` and ${singleRefund.roofTiles} roof tiles`
    : '';
  const plotRoofTileSalvage = plotRefund.roofTiles > 0
    ? ` and ${plotRefund.roofTiles} roof tiles`
    : '';
  const nearestRoad = context.worldQueries.getNearestRoadNodeDistance(residence.x, residence.z);
  const roadAccess = context.worldQueries.getRoadAccessLabel(residence.x, residence.z);
  const servingFirewoodSupplier =
    context.worldQueries.getServingFirewoodSupplierForResidence(residence);
  const servingWell = context.worldQueries.getServingWellForResidence(residence);
  const servingFoodSupplier = context.worldQueries.getServingFoodSupplierForResidence(residence);
  const servingChapel = context.worldQueries.getServingChapelForResidence(residence);
  const upgradeChapel = residence.tier >= 1 && residence.tier < 4
    ? context.worldQueries.getServingChapelForResidence(
        residence,
        requiredChapelTierForResidence(residence.tier + 1),
      )
    : servingChapel;
  const servingPreservedFoodSupplier = residence.tier >= 4
    ? context.worldQueries.getServingPreservedFoodSupplierForResidence(residence)
    : null;
  const servingAleSupplier = residence.tier >= 2
    ? context.worldQueries.getServingAleSupplierForResidence(residence)
    : null;
  const servingClothSupplier = residence.tier >= 2
    ? context.worldQueries.getServingClothSupplierForResidence(residence)
    : null;
  const servingShoesSupplier = residence.tier >= 3
    ? context.worldQueries.getServingShoesSupplierForResidence(residence)
    : null;
  const servingPotterySupplier = residence.tier >= 4
    ? context.worldQueries.getServingPotterySupplierForResidence(residence)
    : null;
  const preservedFoodUpgradeSupplier = residence.tier === 3
    ? servingPreservedFoodSupplier
      ?? context.worldQueries.getPreservedFoodUpgradeSupplierForResidence(residence)
    : servingPreservedFoodSupplier;
  const aleUpgradeSupplier = residence.tier === 1
    ? servingAleSupplier
      ?? context.worldQueries.getAleUpgradeSupplierForResidence(residence)
    : servingAleSupplier;
  const clothUpgradeSupplier = residence.tier === 1
    ? servingClothSupplier
      ?? context.worldQueries.getClothUpgradeSupplierForResidence(residence)
    : servingClothSupplier;
  const shoesUpgradeSupplier = residence.tier === 2
    ? servingShoesSupplier
      ?? context.worldQueries.getShoesUpgradeSupplierForResidence(residence)
    : servingShoesSupplier;
  const potteryUpgradeSupplier = residence.tier === 3
    ? servingPotterySupplier
      ?? context.worldQueries.getPotteryUpgradeSupplierForResidence(residence)
    : servingPotterySupplier;
  const luxuryUpgradeSupplier = residence.tier === 3
    ? context.worldQueries.getLuxuryUpgradeSupplierForResidence(residence)
    : null;
  const householdLuxuryOption = residenceHasHouseholdLuxuryOption(
    residence,
    context.gameState.backyardGardens.get(residence.id),
  );
  const upgradeProject = residenceUpgradeProject(
    residence,
    context.gameState.deliveryTrips.values(),
  );
  const backyardProject = residenceBackyardProject(
    residence,
    context.gameState.deliveryTrips.values(),
  );
  const fireRepairProject = residenceFireRepairProject(
    residence,
    context.gameState.deliveryTrips.values(),
  );
  const roofTileProject = residenceRoofTileProject(
    residence,
    context.gameState.deliveryTrips.values(),
  );
  const remedyDelivery = [...context.gameState.deliveryTrips.values()].find(
    (trip) =>
      trip.destinationKind === 'care'
      && trip.cargoKind === 'remedies'
      && trip.residenceId === residence.id
      && trip.phase !== 'inbound',
  ) ?? null;
  const structuralRepairProject = fireRepairProject;
  const initialConstruction = residence.tier === 0 && upgradeProject?.targetTier === 1;
  const upgradePlan = upgradeProject
    || backyardProject
    || structuralRepairProject
    || roofTileProject
    ? null
    : evaluateResidenceUpgrade(
      residence,
      context.resourceTotals,
      {
      firewood: {
        supplier: servingFirewoodSupplier,
        stocked: upgradeSupplierHasStock('firewood', servingFirewoodSupplier),
      },
      water: {
        supplier: servingWell,
        stocked: upgradeSupplierHasStock('water', servingWell),
      },
      preservedFood: {
        supplier: preservedFoodUpgradeSupplier,
        stocked: servingPreservedFoodSupplier != null,
      },
      ale: {
        supplier: aleUpgradeSupplier,
        stocked: servingAleSupplier != null,
      },
      cloth: {
        supplier: clothUpgradeSupplier,
        stocked: servingClothSupplier != null,
      },
      shoes: {
        supplier: shoesUpgradeSupplier,
        stocked: servingShoesSupplier != null,
      },
      pottery: {
        supplier: potteryUpgradeSupplier,
        stocked: servingPotterySupplier != null,
      },
      luxury: {
        supplier: luxuryUpgradeSupplier,
        stocked: luxuryUpgradeSupplier != null || householdLuxuryOption,
        ready: luxuryUpgradeSupplier != null || householdLuxuryOption,
      },
      church: {
        supplier: upgradeChapel,
        stocked: upgradeChapel != null,
      },
      foodVariety: {
        supplier: null,
        stocked: presentFoodCategories(residence, residence.population).length > 0,
        ready: foodProgressionStatus(
          residence,
          residence.population,
          Math.min(4, residence.tier + 1) as 1 | 2 | 3 | 4,
        ).ready,
      },
      },
      {
        fireDisabled,
        physicalEconomy: context.gameState.physicalFoundingSiteEnabled === true,
      },
    );
  const prosperityPlan = !fireDisabled
    && upgradePlan?.nextTier === 4
    && context.settlementProduction
    ? computeSettlementProsperityPlan(context.settlementProduction)
    : null;
  const prosperityRoadKey = prosperityPlan?.roadPlan
    && typeof context.worldQueries.getRoadComponentId === 'function'
    ? productionRoadBranchKey(
        context.worldQueries.getRoadComponentId(residence.x, residence.z),
        'residence',
        residence.id,
      )
    : undefined;
  const tierThreeProjection = prosperityPlan && upgradePlan?.nextTier === 4
    ? projectTierFourUpgrade(
        prosperityPlan,
        residence,
        upgradePlan.populationCapacity,
        prosperityRoadKey,
      )
    : null;
  const parishPolicy = context.getParishPolicy?.() ?? DEFAULT_PARISH_POLICY;
  const pantrySafeguard = pantrySafeguardPolicyOption(
    normalizePantrySafeguardPolicy(
      context.getPantrySafeguardPolicy?.() ?? DEFAULT_PANTRY_SAFEGUARD_POLICY,
    ),
  );
  const currentClock = gameClock(context.gameState.tick);
  const environment = environmentFor(
    context.gameState.seed,
    context.worldHydrology,
    currentClock,
    context.severeWeatherEnabled ?? false,
  );
  const preservedFoodDemandMultiplier =
    environment.preservedFoodDemandMultiplier;
  const preservedFoodRotationPerDay = residence.population
    * RESIDENCE_PRESERVED_FOOD_PER_PERSON_PER_SEC
    * SPECIALTY_CONSUMPTION_SECONDS_PER_DAY
    * preservedFoodDemandMultiplier;
  const grossFoodPerDay = householdFoodPerDay(residence.population);
  const physicalPreservedFood = preservedFoodStock(residence);
  const physicalFreshMeals = Math.max(
    0,
    edibleFoodStock(residence) - physicalPreservedFood,
  );
  const householdFreshMeals = residence.foodInventoryMigrated === true
    ? physicalFreshMeals
    : Math.max(physicalFreshMeals, getNeedStock(residence.needs, 'food'));
  const householdPreservedFood = residence.foodInventoryMigrated === true
    ? physicalPreservedFood
    : Math.max(
        physicalPreservedFood,
        getNeedStock(residence.needs, 'preservedFood'),
      );
  const mealAllocation = allocatePreservedMeal(
    householdFreshMeals,
    householdPreservedFood,
    grossFoodPerDay,
    preservedFoodRotationPerDay,
    residence.tier >= 4,
  );
  const preservedMealUse = mealAllocation.preservedRotationUsed
    + mealAllocation.preservedFallbackUsed;
  const hasMonasteryCoverage = context.worldQueries.isResidenceInMonasteryCoverage(residence);
  const community = buildResidenceCommunityContext(
    servingChapel,
    parishPolicy,
    hasMonasteryCoverage,
  );
  const parishEconomy = buildResidenceParishEconomyView(
    residence,
    servingChapel,
    community.sabbathObservance,
    community.hasMonasteryCoverage,
  );
  const needs = residenceNeedsStatus(residence, {
    servingLodgeId: servingFirewoodSupplier?.id ?? null,
    servingWellId: servingWell?.id ?? null,
    servingFoodSupplierId: servingFoodSupplier?.id ?? null,
    servingPreservedFoodSupplierId: servingPreservedFoodSupplier?.id ?? null,
    servingAleSupplierId: servingAleSupplier?.id ?? null,
    servingClothSupplierId: servingClothSupplier?.id ?? null,
    servingPotterySupplierId: servingPotterySupplier?.id ?? null,
  }, community);
  const runwayDays = residence.tier > 0 ? residenceFirewoodRunwayDays(residence) : null;
  const firewoodRunwayLabel = runwayDays == null
    ? '—'
    : formatFirewoodRunwayDays(runwayDays);
  const waterRunwayDays = residence.tier > 0 ? residenceWaterRunwayDays(residence) : null;
  const waterRunwayLabel = waterRunwayDays == null
    ? '—'
    : formatWaterRunwayDays(waterRunwayDays);
  const foodRunwayDays = residence.tier >= 4
    ? freshFoodRunwayWithPreservedRotation({
        freshStock: householdFreshMeals,
        grossFoodDemandPerDay: grossFoodPerDay,
        preservedStock: householdPreservedFood,
        preservedRotationPerDay: preservedFoodRotationPerDay,
        preservedFoodSpoilageFractionPerDay:
          environment.preservedFoodSpoilageFractionPerDay
          * PRESERVED_FOOD_STORAGE_RESIDENCE_FACTOR,
      })
    : residenceFoodRunwayDays(residence);
  const foodRunwayLabel = foodRunwayDays == null
    ? '—'
    : formatFoodRunwayDays(foodRunwayDays);
  const preservedFoodRunwayDays = residence.tier >= 4
    ? residencePreservedFoodRunwayDays(
        residence,
        preservedFoodDemandMultiplier,
        environment.preservedFoodSpoilageFractionPerDay,
      )
    : null;
  const preservedFoodRunwayLabel = preservedFoodRunwayDays == null
    ? '—'
    : formatSpecialtyRunwayDays(preservedFoodRunwayDays);
  const aleRunwayDays = residence.tier >= 2 ? residenceAleRunwayDays(residence) : null;
  const aleRunwayLabel = aleRunwayDays == null
    ? '—'
    : formatSpecialtyRunwayDays(aleRunwayDays);
  const clothRunwayDays = residence.tier >= 2 ? residenceClothRunwayDays(residence) : null;
  const clothRunwayLabel = clothRunwayDays == null
    ? '—'
    : formatSpecialtyRunwayDays(clothRunwayDays);
  const shoesRunwayDays = residence.tier >= 3 ? residenceShoesRunwayDays(residence) : null;
  const shoesRunwayLabel = shoesRunwayDays == null
    ? '—'
    : formatSpecialtyRunwayDays(shoesRunwayDays);
  const potteryRunwayDays = residence.tier >= 4
    ? residencePotteryRunwayDays(residence)
    : null;
  const potteryRunwayLabel = potteryRunwayDays == null
    ? '—'
    : formatSpecialtyRunwayDays(potteryRunwayDays);
  const supplierLabel = (supplier: typeof servingFirewoodSupplier): string => {
    if (!supplier) return 'None on branch';
    const distance = context.worldQueries.getRoadPathDistance(
      residence.x,
      residence.z,
      supplier.x,
      supplier.z,
    );
    return `${context.worldQueries.getBuildingLabel(supplier.kind)} · ${formatDeliveryRoadDistance(distance)}`;
  };
  const firewoodSupplierLabel = supplierLabel(servingFirewoodSupplier);
  const wellLabel = supplierLabel(servingWell);
  const foodSupplierLabel = supplierLabel(servingFoodSupplier);
  const preservedFoodSupplierLabel = supplierLabel(servingPreservedFoodSupplier);
  const aleSupplierLabel = supplierLabel(servingAleSupplier);
  const clothSupplierLabel = supplierLabel(servingClothSupplier);
  const shoesSupplierLabel = supplierLabel(servingShoesSupplier);
  const potterySupplierLabel = supplierLabel(servingPotterySupplier);
  const capacity = residence.populationCapacity;
  const settlersRemaining = Math.max(0, capacity - residence.population);
  const settlementReadiness = residenceSettlementReadiness(residence, community);
  const settleTicks = effectiveResidenceSettleTicks(
    community.hasChapelAccess,
    community.sabbathObservance,
    community.hasMonasteryCoverage,
  );
  const settleEtaSeconds = residence.tier > 0
    && settlersRemaining > 0
    && settlementReadiness.ready
    && !fireDisabled
    ? Math.max(
        1,
        Math.round((settleTicks - residence.settlementTicks) * SIM_TICK_SECONDS),
      )
    : null;
  const activeNeedsLabel = activeResidenceNeedKinds(residence.tier)
    .map((kind) =>
      kind === 'preservedFood'
        ? 'preserved food'
        : kind === 'cloth'
          ? 'household textiles'
          : kind === 'pottery'
            ? 'household pottery'
          : kind === 'foodVariety'
            ? 'food variety'
            : kind === 'church'
              ? 'church access'
              : kind
    )
    .join(', ');
  const displayedNeedsLabel = structuralRepairProject
    ? 'Suspended until structural recovery is complete'
    : initialConstruction
    ? 'None until the cottage is complete'
    : activeNeedsLabel;
  const foodAndDrinkSection = residenceNeedCategory('food').label;
  const fuelAndWaterSection = residenceNeedCategory('firewood').label;
  const householdGoodsSection = residenceNeedCategory('cloth').label;
  const faithAndCommunitySection = residenceNeedCategory('church').label;
  const hungerDays = (residence.hungerTicks ?? 0) * SIM_TICK_SECONDS / CALENDAR_SECONDS_PER_DAY;
  const coldExposureDays = environment.season === 'winter'
    ? getNeed(residence.needs, 'firewood').deficitTicks
      * SIM_TICK_SECONDS / CALENDAR_SECONDS_PER_DAY
    : 0;
  const healthLabel = hungerDays >= STARVATION_DEATH_START_DAYS
    ? `Starving · ${hungerDays.toFixed(1)} days without enough food`
    : coldExposureDays >= COLD_EXPOSURE_DEATH_START_DAYS
      ? `Freezing · ${coldExposureDays.toFixed(1)} consecutive winter days without heat`
      : hungerDays >= MALNUTRITION_DAYS
        ? `Malnourished · ${hungerDays.toFixed(1)} shortage days`
        : coldExposureDays >= COLD_EXPOSURE_WARNING_DAYS
          ? `Cold-exposed · ${coldExposureDays.toFixed(1)} winter days without heat`
          : hungerDays >= HUNGER_WARNING_DAYS
            ? `Hungry · ${hungerDays.toFixed(1)} shortage days`
            : (residence.sickPopulation ?? 0) > 0
              ? `${residence.sickPopulation} sick`
              : 'Well';
  const healthWarning = hungerDays >= HUNGER_WARNING_DAYS
    || coldExposureDays >= COLD_EXPOSURE_WARNING_DAYS
    || (residence.sickPopulation ?? 0) > 0;
  const remedyDailyDemand = (residence.sickPopulation ?? 0) * HERB_TREATMENT_PER_SICK_DAY;
  const remedyCoverageDays = remedyDailyDemand > 1e-9
    ? (residence.remedyStock ?? 0) / remedyDailyDemand
    : Number.POSITIVE_INFINITY;
  const remedySupplyLabel = remedyDelivery
    ? `${Math.round(residence.remedyStock ?? 0)} at home · ${Math.round(remedyDelivery.amount)} incoming on a physical care cart`
    : remedyDailyDemand > 1e-9
      ? `${Math.round(residence.remedyStock ?? 0)} at home · ${remedyCoverageDays.toFixed(1)} treatment days`
      : `${Math.round(residence.remedyStock ?? 0)} at home · no current treatment demand`;
  const service = residenceServiceState(residence);
  const householdCorpses = Array.from((context.gameState.corpses ?? new Map()).values())
    .filter((corpse) => corpse.residenceId === residence.id);
  const statusText = roofTileProject
    ? roofTileProject.blockers[0]
      ?? `Roof retrofit ${Math.round(roofTileProject.progress * 100)}% complete`
    : structuralRepairProject
    ? structuralRepairProject.blockers[0]
      ?? `Structural recovery ${Math.round(structuralRepairProject.progress * 100)}% complete`
    : initialConstruction && upgradeProject
    ? upgradeProject.blockers[0]
      ?? `Cottage frame ${Math.round(upgradeProject.progress * 100)}% complete`
    : healthWarning
      ? healthLabel
      : needs.label;

  return {
    eyebrow: roofTileProject
      ? 'Roof worksite'
      : structuralRepairProject
      ? 'Fire recovery worksite'
      : initialConstruction
        ? 'Cottage worksite'
        : 'Residence',
    title: roofTileProject
      ? 'Fired-tile roof retrofit'
      : structuralRepairProject
      ? residenceFire?.status === 'destroyed'
        ? 'Homestead reconstruction'
        : 'Homestead repairs'
      : initialConstruction
      ? 'Cottage construction'
      : residenceCount === 1
        ? 'Residence'
        : `Residence plot (${residenceCount} residences)`,
    statusText,
    statusState: roofTileProject
      ? roofTileProject.blockers.length === 0 ? 'ok' : 'warning'
      : structuralRepairProject
      ? structuralRepairProject.blockers.length === 0 ? 'ok' : 'warning'
      : initialConstruction && upgradeProject
        ? upgradeProject.blockers.length === 0 ? 'ok' : 'warning'
        : healthWarning ? 'warning' : needs.state,
    detailsHtml: `
      <li><span>Plots</span><span>${zone.plotCount}</span></li>
      <li><span>Residences</span><span>${residenceCount}</span></li>
      <li><span>Parcel</span><span>#${residence.parcelIndex + 1}</span></li>
      <li data-inspector-primary><span>Population</span><span>${initialConstruction ? `0 / ${capacity} · founders remain at camp` : `${residence.population} / ${capacity}`}</span></li>
      <li data-inspector-primary><span>Health</span><span>${healthLabel}</span></li>
      <li><span>Malnutrition</span><span>${Math.round((residence.malnutrition ?? 0) * 100)}%</span></li>
      ${environment.season === 'winter' && residence.tier > 0 ? `<li><span>Cold exposure</span><span>${coldExposureDays > 0 ? `${coldExposureDays.toFixed(1)} consecutive unheated days · mortality risk begins after ${COLD_EXPOSURE_DEATH_START_DAYS} days` : 'Heated · no current exposure'}</span></li>` : ''}
      <li><span>Unable to work</span><span>${residence.sickPopulation ?? 0} sick resident${(residence.sickPopulation ?? 0) === 1 ? '' : 's'}</span></li>
      <li><span>Herbal remedies</span><span>${remedySupplyLabel} · treatment speeds recovery and reduces mortality</span></li>
      <li><span>Deaths</span><span>${residence.deathsTotal ?? 0} total · ${householdCorpses.length} unburied or in transit</span></li>
      <li><span>Housing tenure</span><span>Permanent · empty slots remain available to new settlers</span></li>
      <li data-inspector-primary><span>House tier</span><span>${initialConstruction ? 'Cottage frame → tier 1' : `${residence.tier} / 4`}</span></li>
      <li><span>Roof covering</span><span>${residence.tier >= 4 ? 'Fired clay tile · tier-4 finished roof' : residence.tier === 1 ? 'Bundled thatch · cottage roof' : 'Split wooden shingle · tier-2/3 roof'}</span></li>
      ${roofTileProject
        ? residenceRoofTileProjectRows(roofTileProject)
        : fireRepairProject
        ? residenceFireRepairProjectRows(fireRepairProject, residence.tier)
        : upgradeProject
        ? residenceUpgradeProjectRows(upgradeProject, initialConstruction)
        : backyardProject
          ? `<li><span>Household works</span><span>${backyardGardenLabel(backyardProject.kind)} · ${Math.round(backyardProject.progress * 100)}% complete · shares the construction queue</span></li>`
        : upgradePlan
          ? residenceUpgradeRows(upgradePlan, context.worldQueries.getBuildingLabel.bind(context.worldQueries))
          : ''}
      ${prosperityPlan && tierThreeProjection
        ? residenceProsperityRows(prosperityPlan, tierThreeProjection)
        : ''}
      <li data-inspector-primary><span>Active needs</span><span>${displayedNeedsLabel}</span></li>
      ${residence.tier > 0 && residence.population > 0 ? `<li><span>Approval & economy</span><span>${formatResidenceServiceConsequence(service)}</span></li>` : ''}
      ${residence.tier > 0 ? `<li><span>Household prosperity</span><span>${formatHouseholdProsperity(residence.householdWealth)}</span></li>` : ''}
      ${residence.tier > 0 ? `<li><span>Local supply cycle</span><span>Connected Marketplace goods issue as a one-day lot every day · Town Hall safeguard: ${pantrySafeguard.label} — ${pantrySafeguard.hint} · well water draws automatically in radius · no household cart or player prompt</span></li>` : ''}
      ${fireDisabled
        ? '<li><span>Parish economy</span><span>Paused · no tithe, alms, or relief claim until structural recovery</span></li>'
        : parishEconomy.hasChapelAccess
          ? `<li><span>Parish tithe</span><span>~${parishEconomy.tithePerDay.toFixed(1)} gold / day when attending (${parishEconomy.attendancePercent}% chance${parishEconomy.wealthLimited ? ', wealth-limited' : ''}) → church coffer</span></li>`
          : ''}
      ${residence.tier > 0 && settleEtaSeconds != null
        ? `<li><span>Settlers</span><span>${settlersRemaining} pending — next in ~${formatSettleEta(settleEtaSeconds)}</span></li>`
        : ''}
      ${residence.tier > 0
        && settlersRemaining > 0
        && !fireDisabled
        && !settlementReadiness.ready
        ? `<li><span>Settlers</span><span>${settlersRemaining} pending — paused for ${formatSettlementWait(settlementReadiness.waitingOn)}</span></li>`
        : ''}
      ${residence.tier > 0 && settlersRemaining > 0 && fireDisabled
        ? `<li><span>Settlers</span><span>${settlersRemaining} pending — structural recovery required before settlement resumes</span></li>`
        : ''}
      ${residence.tier > 0 ? `<li data-inspector-primary data-inspector-section="${foodAndDrinkSection}"><span>Fresh food</span><span>${householdFreshMeals.toFixed(1)} / ${RESIDENCE_FOOD_CAPACITY} · ${foodRunwayLabel} runway</span></li>` : ''}
      ${residence.tier > 0 ? householdFoodVarietyRow(residence, foodAndDrinkSection) : ''}
      ${residence.tier > 0 ? householdFoodContentsRow(residence, foodAndDrinkSection) : ''}
      ${residence.tier >= 4 ? `<li data-inspector-secondary data-inspector-section="${foodAndDrinkSection}"><span>Next daily meal</span><span>${mealAllocation.freshUsed.toFixed(2)} fresh + ${preservedMealUse.toFixed(2)} preserved${mealAllocation.preservedFallbackUsed > 1e-6 ? ` (${mealAllocation.preservedFallbackUsed.toFixed(2)} emergency fallback)` : ''}${mealAllocation.unmet > 1e-6 ? ` &middot; ${mealAllocation.unmet.toFixed(2)} unmet` : ''} &middot; ${grossFoodPerDay.toFixed(2)} total demand</span></li>` : ''}
      ${residence.tier >= 4 ? `<li data-inspector-primary data-inspector-section="${foodAndDrinkSection}"><span>Cured provisions</span><span>${householdPreservedFood.toFixed(1)} / ${RESIDENCE_PRESERVED_FOOD_CAPACITY} · ${preservedFoodRunwayLabel} runway</span></li>` : ''}
      ${residence.tier >= 4 ? `<li data-inspector-secondary data-inspector-section="${foodAndDrinkSection}"><span>Cupboard aging</span><span>${formatPreservedFoodLoss(
        householdPreservedFood
        * environment.preservedFoodSpoilageFractionPerDay
        * PRESERVED_FOOD_STORAGE_RESIDENCE_FACTOR,
      )} · consume or replenish regularly</span></li>` : ''}
      ${residence.tier >= 4 ? `<li data-inspector-secondary data-inspector-section="${foodAndDrinkSection}"><span>Seasonal ration rotation</span><span>${preservedFoodRotationPerDay.toFixed(2)} / day at ${preservedFoodDemandMultiplier.toFixed(2)}&times; seasonal use &middot; replaces the same amount of fresh food rather than adding a second meal</span></li>` : ''}
      ${residence.tier >= 2 ? `<li data-inspector-primary data-inspector-section="${foodAndDrinkSection}"><span>Beverages</span><span>${Math.round(getNeedStock(residence.needs, 'ale'))} / ${RESIDENCE_ALE_CAPACITY} · ${aleRunwayLabel} runway</span></li>` : ''}
      ${residence.tier > 0 ? `<li data-inspector-secondary data-inspector-section="${foodAndDrinkSection}"><span>Fresh-food supplier</span><span>${foodSupplierLabel}</span></li>` : ''}
      ${residence.tier >= 4 ? `<li data-inspector-secondary data-inspector-section="${foodAndDrinkSection}"><span>Preserved-food supplier</span><span>${preservedFoodSupplierLabel}</span></li>` : ''}
      ${residence.tier >= 2 ? `<li data-inspector-secondary data-inspector-section="${foodAndDrinkSection}"><span>Beverage service</span><span>${aleSupplierLabel}</span></li>` : ''}
      ${residence.tier > 0 ? `<li data-inspector-primary data-inspector-section="${fuelAndWaterSection}"><span>Firewood</span><span>${Math.round(getNeedStock(residence.needs, 'firewood'))} / ${RESIDENCE_FIREWOOD_CAPACITY} · ${firewoodRunwayLabel} runway</span></li>` : ''}
      ${residence.tier > 0 ? `<li data-inspector-primary data-inspector-section="${fuelAndWaterSection}"><span>Water</span><span>${Math.round(getNeedStock(residence.needs, 'water'))} / ${RESIDENCE_WATER_CAPACITY} · ${waterRunwayLabel} runway</span></li>` : ''}
      ${residence.tier > 0 ? `<li data-inspector-secondary data-inspector-section="${fuelAndWaterSection}"><span>Heating supplier</span><span>${firewoodSupplierLabel}</span></li>` : ''}
      ${residence.tier > 0 ? `<li data-inspector-secondary data-inspector-section="${fuelAndWaterSection}"><span>Serving well</span><span>${wellLabel}</span></li>` : ''}
      ${residence.tier >= 2 ? `<li data-inspector-primary data-inspector-section="${householdGoodsSection}"><span>Household textiles</span><span>${Math.round(getNeedStock(residence.needs, 'cloth'))} / ${RESIDENCE_CLOTH_CAPACITY} · ${clothRunwayLabel} runway</span></li>` : ''}
      ${residence.tier >= 3 ? `<li data-inspector-primary data-inspector-section="${householdGoodsSection}"><span>Footwear</span><span>${Math.round(getNeedStock(residence.needs, 'shoes'))} / ${RESIDENCE_SHOES_CAPACITY} · ${shoesRunwayLabel} replacement</span></li>` : ''}
      ${residence.tier >= 4 ? `<li data-inspector-primary data-inspector-section="${householdGoodsSection}"><span>Household pottery</span><span>${Math.round(getNeedStock(residence.needs, 'pottery'))} / ${RESIDENCE_POTTERY_CAPACITY} · ${potteryRunwayLabel} replacement</span></li>` : ''}
      ${residence.tier >= 2 ? `<li data-inspector-secondary data-inspector-section="${householdGoodsSection}"><span>Cloth supplier</span><span>${clothSupplierLabel}</span></li>` : ''}
      ${residence.tier >= 3 ? `<li data-inspector-secondary data-inspector-section="${householdGoodsSection}"><span>Shoe supplier</span><span>${shoesSupplierLabel}</span></li>` : ''}
      ${residence.tier >= 4 ? `<li data-inspector-secondary data-inspector-section="${householdGoodsSection}"><span>Pottery supplier</span><span>${potterySupplierLabel}</span></li>` : ''}
      ${residence.tier > 0 ? `<li data-inspector-primary data-inspector-section="${faithAndCommunitySection}"><span>Church access</span><span>${community.hasChapelAccess ? `Staffed level-${community.chapelTier ?? 1} parish on the road` : `No qualifying parish on branch · level ${residence.tier >= 4 ? 3 : residence.tier >= 2 ? 2 : 1} required`}</span></li>` : ''}
      ${residence.tier > 0 ? `<li data-inspector-secondary data-inspector-section="${faithAndCommunitySection}"><span>Monastery coverage</span><span>${community.hasMonasteryCoverage ? 'Linked Pauline house within parish radius' : 'None'}</span></li>` : ''}
      <li><span>Road access</span><span>${roadAccess}</span></li>
      <li><span>Build cost</span><span>${renderBuildingResourceCost(singleCost)}</span></li>
      <li><span>Nearest road</span><span>${nearestRoad == null ? 'None nearby' : `${nearestRoad.toFixed(1)} m`}</span></li>
    `,
    demolish: {
      visible: true,
      label: initialConstruction ? 'Cancel cottage works' : 'Demolish',
      hint: initialConstruction
        ? `Cancels this cottage and leaves about ${singleRefund.timber} timber, ${singleRefund.stone} stone${singleRoofTileSalvage} from material already delivered onsite. Reserved stock and incoming carts are released back to connected stores.`
        : structuralRepairProject
          ? `Clears the damaged homestead and leaves about ${singleRefund.timber} timber, ${singleRefund.stone} stone${singleRoofTileSalvage} from recovery material already delivered onsite. Reserved stock and incoming carts return to connected stores.`
        : fireDisabled
        ? 'Removes this fire-damaged residence. Its structural material is no longer recoverable.'
        : `Leaves about ${singleRefund.timber} timber, ${singleRefund.stone} stone${singleRoofTileSalvage} at this cottage footprint (${Math.round(TIMBER_SALVAGE_FRACTION * 100)}% timber, ${Math.round(STONE_SALVAGE_FRACTION * 100)}% stone, and ${Math.round(RESIDENCE_TILE_ROOF_SALVAGE_FRACTION * 100)}% of intact fired tiles). A free hauler must cart it to connected storage before the footprint clears.`,
      secondary: residenceCount > 1
        ? {
            label: 'Remove entire plot',
            hint: `Removes all ${residenceCount} residences and leaves up to ${reclaimablePlotResidenceCount} separate reclamation ${reclaimablePlotResidenceCount === 1 ? 'pile' : 'piles'} with about ${plotRefund.timber} timber, ${plotRefund.stone} stone${plotRoofTileSalvage} total. Unfinished cottages and active fire-recovery sites recover only material already delivered; unrepaired fire damage yields nothing; every salvage-bearing footprint remains occupied until free haulers reach connected storage.`,
          }
        : undefined,
    },
    labor: hiddenLabor(),
    supplementalPanelHtml: `${roofTileProject
      ? residenceRoofTileProjectPanel(roofTileProject)
      : fireRepairProject
      ? residenceFireRepairProjectPanel(fireRepairProject)
      : upgradeProject
      ? residenceUpgradeProjectPanel(upgradeProject, initialConstruction)
      : backyardProject
        ? `<p class="resource-inspector-note">${backyardGardenLabel(backyardProject.kind)} works are using this household's builder slot. Select the backyard marker to inspect carts, materials, priority, or cancel the project.</p>`
      : upgradePlan
        ? residenceUpgradePanel(upgradePlan, prosperityPlan, tierThreeProjection)
        : '<p class="resource-inspector-note">This household has reached tier 4.</p>'}`,
  };
}

function residenceUpgradeRows(
  plan: ResidenceUpgradePlan,
  buildingLabel: (kind: BuildingState['kind']) => string,
): string {
  const services = plan.services.map((service) =>
    `${service.label}: ${service.supplier
      ? `${buildingLabel(service.supplier.kind)} route${service.stocked ? '' : ' · currently empty'}`
      : 'missing'}`,
  ).join(' · ');
  const resources = plan.resources.map((resource) =>
    `<span class="resource-requirement${resource.ready ? '' : ' resource-requirement--short'}">${renderResourceCost(
      { [resource.kind]: resource.required },
      { compact: true },
    )}<span class="resource-requirement__available">${formatUpgradeAmount(resource.available)} available</span></span>`,
  ).join('');
  return `
    <li><span>Tier ${plan.nextTier} services</span><span>${services}</span></li>
    <li><span>Upgrade resources</span><span>${resources}</span></li>
    ${plan.physicalEconomy
      ? `<li><span>Project funding</span><span>${formatUpgradeAmount(plan.householdContribution)} household contribution · ${formatUpgradeAmount(plan.civicGoldRequired)} treasury grant</span></li>`
      : ''}
  `;
}

function residenceUpgradeProjectRows(
  project: ResidenceUpgradeProject,
  initialConstruction: boolean,
): string {
  const incoming = project.incomingTrips.length === 0
    ? 'None'
    : project.incomingTrips.map((trip) =>
      `${formatUpgradeAmount(trip.amount)} ${trip.cargoKind} <button type="button" class="inspector-jump-button" data-inspect-delivery-trip="${trip.id}" aria-label="Inspect incoming ${trip.cargoKind} cart">Inspect cart</button>`,
    ).join(' · ');
  return `
    <li><span>${initialConstruction ? 'Construction target' : 'Improvement target'}</span><span>Tier ${project.targetTier}</span></li>
    <li><span>Builder progress</span><span>${Math.round(project.progress * 100)}%</span></li>
    <li><span>Queue priority</span><span>${project.priorityLabel}</span></li>
    <li><span>Builder</span><span>${project.assignedLabor > 0 ? `1 on ${initialConstruction ? 'cottage frame' : 'household works'}` : 'Waiting for free labor'}</span></li>
    <li><span>Timber onsite</span><span>${formatUpgradeAmount(project.delivered.timber)} / ${formatUpgradeAmount(project.required.timber)} · ${formatUpgradeAmount(project.reserved.timber)} reserved</span></li>
    <li><span>Stone onsite</span><span>${formatUpgradeAmount(project.delivered.stone)} / ${formatUpgradeAmount(project.required.stone)} · ${formatUpgradeAmount(project.reserved.stone)} reserved</span></li>
    <li><span>Coin onsite</span><span>${formatUpgradeAmount(project.delivered.gold)} / ${formatUpgradeAmount(project.required.gold)} · ${formatUpgradeAmount(project.reserved.gold)} reserved</span></li>
    <li><span>Incoming haul</span><span>${incoming}</span></li>
  `;
}

function residenceFireRepairProjectRows(
  project: ResidenceFireRepairProject,
  tier: number,
): string {
  const incoming = project.incomingTrips.length === 0
    ? 'None'
    : project.incomingTrips.map((trip) =>
      `${formatUpgradeAmount(trip.amount)} ${trip.cargoKind} <button type="button" class="inspector-jump-button" data-inspect-delivery-trip="${trip.id}" aria-label="Inspect incoming ${trip.cargoKind} cart">Inspect cart</button>`,
    ).join(' · ');
  return `
    <li><span>Recovery target</span><span>Restore tier ${tier} homestead</span></li>
    <li><span>Builder progress</span><span>${Math.round(project.progress * 100)}%</span></li>
    <li><span>Queue priority</span><span>${project.priorityLabel}</span></li>
    <li><span>Builder</span><span>${project.assignedLabor > 0 ? '1 on structural recovery' : 'Waiting for free labor'}</span></li>
    <li><span>Timber onsite</span><span>${formatUpgradeAmount(project.delivered.timber)} / ${formatUpgradeAmount(project.required.timber)} · ${formatUpgradeAmount(project.reserved.timber)} at source</span></li>
    <li><span>Stone onsite</span><span>${formatUpgradeAmount(project.delivered.stone)} / ${formatUpgradeAmount(project.required.stone)} · ${formatUpgradeAmount(project.reserved.stone)} at source</span></li>
    <li><span>Incoming haul</span><span>${incoming}</span></li>
    <li><span>Household activity</span><span>Resumes only after structural recovery is complete</span></li>
  `;
}

function residenceRoofTileProjectRows(
  project: ResidenceRoofTileProject,
): string {
  const incoming = project.incomingTrips.length === 0
    ? 'None'
    : project.incomingTrips.map((trip) =>
      `${formatUpgradeAmount(trip.amount)} ${trip.cargoKind} <button type="button" class="inspector-jump-button" data-inspect-delivery-trip="${trip.id}" aria-label="Inspect incoming ${trip.cargoKind} cart">Inspect cart</button>`,
    ).join(' · ');
  return `
    <li><span>Retrofit target</span><span>Replace wooden shingles with fired clay tiles</span></li>
    <li><span>Builder progress</span><span>${Math.round(project.progress * 100)}%</span></li>
    <li><span>Queue priority</span><span>${project.priorityLabel}</span></li>
    <li><span>Builder</span><span>${project.assignedLabor > 0 ? '1 replacing battens and covering' : 'Waiting for free labor'}</span></li>
    <li><span>Timber onsite</span><span>${formatUpgradeAmount(project.delivered.timber)} / ${formatUpgradeAmount(project.required.timber)} · ${formatUpgradeAmount(project.reserved.timber)} at source</span></li>
    <li><span>Tiles onsite</span><span>${formatUpgradeAmount(project.delivered.roofTiles)} / ${formatUpgradeAmount(project.required.roofTiles)} · ${formatUpgradeAmount(project.reserved.roofTiles)} at source</span></li>
    <li><span>Incoming haul</span><span>${incoming}</span></li>
  `;
}

function residenceProsperityRows(
  plan: SettlementProsperityPlan,
  projection: TierFourUpgradeProjection,
): string {
  const immediateStatus = projection.immediateSustainable
    ? `${projection.immediateHeadroomResidents} resident capacity remains`
    : `short capacity for ${Math.abs(projection.immediateHeadroomResidents)} residents`;
  const usableCapacity = plan.roadPlan?.roadMatchedResidentCapacity
    ?? plan.installedResidentCapacity;
  const localCapacity = projection.immediateResidents
    + projection.immediateHeadroomResidents;
  const localCurrentResidents = projection.immediateResidents
    - projection.occupantsPromotedNow;
  return `
    <li><span>Settlement prosperity</span><span>${plan.currentResidents} / ${usableCapacity} road-matched residents at installed capacity${plan.roadPlan && plan.roadPlan.fragmentationResidentCapacity > 0 ? ` · ${plan.roadPlan.fragmentationResidentCapacity} capacity split between branches` : ''} · assumes fully supplied staffed workshops</span></li>
    ${projection.roadBranchScoped ? `<li><span>Local prosperity branch</span><span>${localCurrentResidents} current / ${localCapacity} resident capacity · ${projection.limitingLabel} limited</span></li>` : ''}
    <li><span>Promotion load</span><span>+${projection.occupantsPromotedNow} prosperous consumers now · +${projection.targetHouseCapacity} with this house full · ${immediateStatus}</span></li>
    <li><span>Prosperity planning load</span><span>+${projection.immediateDemand.preservedFood.toFixed(2)} winter-peak preserved ration/day · +${projection.immediateDemand.ale.toFixed(2)} beverages/day · +${projection.immediateDemand.cloth.toFixed(3)} cloth/day · +${projection.immediateDemand.pottery.toFixed(2)} pottery/day</span></li>
  `;
}

function residenceUpgradePanel(
  plan: ResidenceUpgradePlan,
  prosperity: SettlementProsperityPlan | null,
  projection: TierFourUpgradeProjection | null,
): string {
  const status = plan.ready
    ? `Ready · adds ${plan.addedCapacity} resident capacity (${plan.populationCapacity} total) · ${plan.addedNeeds.toLowerCase()}.`
    : `Blocked · ${plan.blockers.join(' · ')}.`;
  const guidance = plan.nextTier === 2
    ? 'Tier 2 needs a one-day grain staple plus one other stocked food group, a staffed basic church, a staffed road-connected Tavern, and a staffed weaver in addition to fuel and well access.'
    : plan.nextTier === 3
      ? 'Tier 3 needs separate one-day stocks of grain, produce or forage, meat or animal produce, and fish, plus a staffed level-2 church while retaining fuel, well, and Tier 2 services.'
      : 'Tier 4 needs cured provisions, pottery, a staffed level-3 church, physical fired roof tiles, and either a stocked road-reachable Marketplace with honey or wine or a household preserve/flower source while retaining the complete lower-tier diet and services.';
  const throughput = prosperity && projection
    ? projection.immediateSustainable
      ? projection.fullPipelineSustainable
        ? ` Installed capacity on ${projection.roadBranchScoped ? 'this road branch' : 'the settlement'} can sustain the current occupants and this house at full occupancy; ${projection.limitingLabel} is the tightest chain.`
        : ` Current occupants fit, but filling this house would exceed installed ${projection.limitingLabel} capacity on ${projection.roadBranchScoped ? 'this road branch' : 'the settlement'}.`
      : ` Warning: promoting the current occupants immediately exceeds installed ${projection.limitingLabel} capacity on ${projection.roadBranchScoped ? 'this road branch' : 'the settlement'} by ${Math.abs(projection.immediateHeadroomResidents)} residents.`
    : '';
  const funding = plan.physicalEconomy
    ? ` The household contributes ${formatUpgradeAmount(plan.householdContribution)} coin from savings above its protected reserve; the treasury grants the remaining ${formatUpgradeAmount(plan.civicGoldRequired)} coin. Exact household savings stay private. Materials remain at their stores until a builder and cart can move them.`
    : '';
  return `<button type="button" class="resource-action-button resource-action-button--icon" data-action="upgrade-residence" data-upgrade-tier="${plan.nextTier}" ${plan.ready ? '' : 'disabled'}><span class="inspector-action-icon" data-action-icon="residence-tier-${plan.nextTier}" aria-hidden="true"></span><span>Begin tier ${plan.nextTier} works</span></button><p class="resource-inspector-note">${status}${throughput}${funding} ${guidance}</p>`;
}

function residenceUpgradeProjectPanel(
  project: ResidenceUpgradeProject,
  initialConstruction: boolean,
): string {
  const status = project.blockers.length === 0
    ? 'Supplied and staffed; work advances as delivered material permits.'
    : project.blockers.join(' · ');
  return `<div class="inspector-action-panel">
    <p class="resource-inspector-note">${initialConstruction
      ? 'Cottage construction is physical: founders remain at camp while one builder raises the frame from onsite timber and stone brought by carts.'
      : 'Household works are physical: one builder works from onsite timber and stone, while carts bring reserved stores and treasury coin.'} ${status} Hold releases the builder and stops new carts without losing reservations.</p>
    <div class="resource-action-row">${CONSTRUCTION_PRIORITIES.map((candidate) =>
      residenceUpgradePriorityButton(candidate, project.priority)).join('')}</div>
  </div>`;
}

function residenceFireRepairProjectPanel(
  project: ResidenceFireRepairProject,
): string {
  const status = project.blockers.length === 0
    ? 'Supplied and staffed; recovery advances as delivered material permits.'
    : project.blockers.join(' · ');
  return `<div class="inspector-action-panel">
    <p class="resource-inspector-note">Recovery is physical: the damaged home remains offline while one builder uses timber and stone brought from real stores by cart. ${status} Hold releases the builder and stops new carts without losing reservations.</p>
    <div class="resource-action-row">${CONSTRUCTION_PRIORITIES.map((candidate) =>
      residenceUpgradePriorityButton(candidate, project.priority)).join('')}</div>
  </div>`;
}

function residenceRoofTileProjectPanel(
  project: ResidenceRoofTileProject,
): string {
  const status = project.blockers.length === 0
    ? 'Supplied and staffed; the covering advances as physical deliveries permit.'
    : project.blockers.join(' · ');
  return `<div class="inspector-action-panel">
    <p class="resource-inspector-note">This is a residence-local worksite: kiln stock is reserved but remains visible at its source until a real cart reaches the house. ${status} Hold releases the builder and stops new carts without losing reservations.</p>
    <div class="resource-action-row">${CONSTRUCTION_PRIORITIES.map((candidate) =>
      residenceUpgradePriorityButton(candidate, project.priority)).join('')}</div>
  </div>`;
}

function residenceUpgradePriorityButton(
  candidate: ConstructionPriority,
  current: ConstructionPriority,
): string {
  return `<button type="button" class="resource-action-button" data-residence-upgrade-priority="${candidate}" ${candidate === current ? 'disabled' : ''}>${constructionPriorityLabel(candidate)}</button>`;
}

function upgradeSupplierHasStock(
  kind: ResidenceUpgradeServiceKind,
  supplier: BuildingState | null,
): boolean {
  if (!supplier) return false;
  if (kind === 'firewood') return supplier.firewood > 1e-6;
  if (kind === 'water') return supplier.water > 1e-6;
  if (kind === 'preservedFood') return preservedFoodStock(supplier) > 1e-6;
  if (kind === 'ale') {
    return supplier.ale
      + (supplier.cider ?? 0)
      + (supplier.pearCider ?? 0)
      + (supplier.mead ?? 0) > 1e-6;
  }
  return (supplier.cloth ?? 0) > 1e-6;
}

function householdFoodContentsRow(
  residence: ResidenceState,
  section: string,
): string {
  const contents = NAMED_FOOD_KINDS
    .map((kind) => ({ kind, amount: Math.max(0, residence[kind] ?? 0) }))
    .filter(({ amount }) => amount > 1e-6)
    .map(({ kind, amount }) => `${NAMED_FOOD_LABELS[kind]} ${amount.toFixed(1)}`);
  if ((residence.food ?? 0) > 1e-6) {
    contents.push(`Legacy mixed food ${residence.food!.toFixed(1)}`);
  }
  if ((residence.preservedFood ?? 0) > 1e-6) {
    contents.push(`Legacy preserved staples ${residence.preservedFood!.toFixed(1)}`);
  }
  return `<li data-inspector-secondary data-inspector-section="${section}"><span>Pantry contents</span><span>${contents.length > 0 ? contents.join(' · ') : 'Empty'}</span></li>`;
}

function householdFoodVarietyRow(
  residence: ResidenceState,
  section: string,
): string {
  const categories = presentFoodCategories(residence, residence.population);
  const labels = categories.map((category) => FOOD_CATEGORY_LABELS[category]);
  const qualifyingStock = foodCategoryQualifyingStock(residence.population);
  const tier = Math.max(1, residence.tier) as 1 | 2 | 3 | 4;
  const progression = foodProgressionStatus(residence, residence.population, tier);
  const missing = progression.missingSlots
    .map((slot) => FOOD_PROGRESSION_SLOT_LABELS[slot].toLowerCase());
  const supplied = labels.length ? labels.join(', ') : 'none supplied';
  return `<li data-inspector-primary data-inspector-section="${section}"><span>Food standard</span><span>${progression.satisfiedSlots.length} / ${progression.requiredSlots.length} goals · ${supplied}${missing.length ? ` · missing ${missing.join(', ')}` : ''} · ${qualifyingStock.toFixed(1)} meal-equivalents per category</span></li>`;
}

function formatUpgradeAmount(value: number): string {
  const rounded = Math.round(value);
  return Math.abs(value - rounded) < 0.05 ? String(rounded) : value.toFixed(1);
}

function formatSettleEta(seconds: number): string {
  if (seconds >= 120) {
    return `${Math.max(1, Math.round(seconds / 60))} min`;
  }
  return `${Math.max(1, Math.round(seconds))}s`;
}

function formatSettlementWait(
  waitingOn: ReturnType<typeof residenceSettlementReadiness>['waitingOn'],
): string {
  return waitingOn.map(
    (buffer) =>
      `${buffer.label} ${formatUpgradeAmount(buffer.stock)} / ${formatUpgradeAmount(buffer.required)}`,
  ).join(' · ');
}
