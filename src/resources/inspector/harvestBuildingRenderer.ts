import { getBuildingCost } from '../buildingEconomy.ts';
import { getBuildingDefinition } from '../buildings.ts';
import { edibleFoodStock } from '../../economy/foodInventory.ts';
import { buildingStorageCaps } from '../resourceTotals.ts';
import type {
  BuildingKind,
  BuildingState,
  InspectableTarget,
  ResidenceState,
  ResourceNodeState,
} from '../types.ts';
import {
  buildingCostRows,
  buildingDemolishHint,
  buildingLaborView,
  buildingRoadAccessRow,
  buildingStorageRows,
  buildingExtentRow,
} from './buildingCommon.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import {
  formatTripBuildingDestinationLabel,
  formatTripDestinationLabel,
  formatTripPhaseLabel,
  onsiteBuildingLabor,
} from '../../logistics/deliveryTrips.ts';
import {
  formatDeliveryRoadDistance,
  formatDeliveryTripDuration,
} from '../../logistics/deliveryLogistics.ts';
import {
  foodLaborSplit,
  foodPerDelivery,
  formatFoodCrewSplit,
  formatFoodRunwayDays,
  householdFoodReserve,
  institutionalFoodDutyLabel,
  institutionalFoodSurplus,
  residenceFoodRunwayDays,
} from '../../logistics/foodLogistics.ts';
import { formatCooldown } from './woodcuttersLodgeStatus.ts';
import { gameClock } from '../../world/gameCalendar.ts';
import { isForagingHarvestAvailable } from '../../foraging/foragingSeason.ts';
import {
  HARVEST_RESERVE_PRESETS,
  harvestableWildStock,
  isWildStockHarvestable,
  normalizeHarvestReservePercent,
  protectedWildStock,
} from '../../foraging/harvestReservePolicy.ts';
import {
  FORAGER_REMEDIES_PER_HARVEST,
  FORAGER_REMEDY_SEASON_END_MONTH,
  FORAGER_REMEDY_SEASON_START_MONTH,
  HERB_REMEDY_CAPACITY,
  HERB_TREATMENT_PER_SICK_DAY,
  REMEDIES_PER_DELIVERY,
  REMEDY_DELIVERY_SPEED_MPS,
  REMEDY_DELIVERY_TARGET_DAYS,
  REMEDY_DELIVERY_UNLOAD_SEC,
} from '../../generated/gameBalance.ts';
import {
  compareStableEntityIds,
  localDeliveryDistancesFrom,
} from '../../logistics/roadLogistics.ts';

type HarvestBuildingKind = Extract<BuildingKind, 'foragers_shed' | 'hunters_hall' | 'fishing_camp'>;
type HarvestForagingKind = 'berries' | 'mushrooms' | 'game' | 'fish';

const HARVEST_BUILDING_COPY: Record<
  HarvestBuildingKind,
  { foragingKind: HarvestForagingKind | readonly HarvestForagingKind[]; idleLabel: string; activeUnit: string; patchLabel: string }
> = {
  foragers_shed: {
    foragingKind: ['berries', 'mushrooms'],
    idleLabel: 'Idle — assign labor to gather wild food',
    activeUnit: 'berries or mushrooms',
    patchLabel: 'wild patch',
  },
  hunters_hall: {
    foragingKind: 'game',
    idleLabel: 'Idle — assign labor to hunt game',
    activeUnit: 'game',
    patchLabel: 'trail',
  },
  fishing_camp: {
    foragingKind: 'fish',
    idleLabel: 'Idle - assign labor to fish the shoal',
    activeUnit: 'fish',
    patchLabel: 'shoal',
  },
};

function formatNextFoodTargetLabel(
  target: ReturnType<InspectorRenderContext['worldQueries']['getNextFoodDeliveryTargetForSupplier']>,
): string {
  if (!target) return 'None needing food';
  const runwayDays = residenceFoodRunwayDays(target);
  const runwaySuffix = runwayDays != null ? ` (${formatFoodRunwayDays(runwayDays)} left)` : '';
  return `Parcel #${target.parcelIndex + 1}${runwaySuffix}`;
}

function nextRemedyDeliveryTarget(
  context: InspectorRenderContext,
  supplier: BuildingState,
): ResidenceState | null {
  const alreadySupplied = new Set(
    [...context.gameState.deliveryTrips.values()]
      .filter((trip) =>
        trip.destinationKind === 'care'
        && trip.cargoKind === 'remedies'
        && trip.phase !== 'inbound'
        && trip.residenceId
      )
      .map((trip) => trip.residenceId as string),
  );
  const eligible = [...context.gameState.residences.values()]
    .filter((residence) => {
      const sick = Math.min(
        residence.population,
        Math.max(0, residence.sickPopulation ?? 0),
      );
      const demand = sick * HERB_TREATMENT_PER_SICK_DAY;
      const target = Math.min(
        HERB_REMEDY_CAPACITY,
        demand * REMEDY_DELIVERY_TARGET_DAYS,
      );
      return !residence.abandoned
        && sick > 0
        && (residence.remedyStock ?? 0) + 1e-6 < target
        && !alreadySupplied.has(residence.id);
    });
  const distances = localDeliveryDistancesFrom(
    context.worldQueries.getRoadNetworkSnapshot(),
    supplier.x,
    supplier.z,
    eligible,
  );
  return eligible
    .map((residence, index) => {
      const sick = Math.max(1, residence.sickPopulation ?? 0);
      return {
        residence,
        runway: (residence.remedyStock ?? 0) / (sick * HERB_TREATMENT_PER_SICK_DAY),
        sick,
        distance: distances[index],
      };
    })
    .filter((candidate) => candidate.distance != null)
    .sort((left, right) =>
      left.runway - right.runway
      || right.sick - left.sick
      || (left.distance ?? Infinity) - (right.distance ?? Infinity)
      || compareStableEntityIds(left.residence.id, right.residence.id)
    )[0]?.residence ?? null;
}

export function renderHarvestBuildingInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const copy = HARVEST_BUILDING_COPY[building.kind as HarvestBuildingKind];
  const label = context.worldQueries.getBuildingLabel(building.kind);
  const cost = getBuildingCost(building.kind);
  const definition = getBuildingDefinition(building.kind);
  const managesWildStock = building.kind === 'hunters_hall'
    || building.kind === 'fishing_camp';
  const reservePercent = managesWildStock
    ? normalizeHarvestReservePercent(building.harvestReservePercent ?? 0)
    : 0;
  const foragingKinds: readonly HarvestForagingKind[] = Array.isArray(copy.foragingKind)
    ? copy.foragingKind
    : [copy.foragingKind];
  let nearestPopulationNode: ResourceNodeState | null = null;
  let nearestHarvestableNode: ResourceNodeState | null = null;
  let nearestPopulationDistanceSq = Number.POSITIVE_INFINITY;
  let nearestHarvestableDistanceSq = Number.POSITIVE_INFINITY;
  if (managesWildStock) {
    const radiusSq = building.workRadius * building.workRadius;
    for (const node of context.gameState.foragingNodes.values()) {
      if (!foragingKinds.includes(node.kind as HarvestForagingKind)) continue;
      const distanceSq = (node.x - building.x) ** 2 + (node.z - building.z) ** 2;
      if (distanceSq > radiusSq) continue;
      if (distanceSq < nearestPopulationDistanceSq) {
        nearestPopulationNode = node;
        nearestPopulationDistanceSq = distanceSq;
      }
      if (
        distanceSq < nearestHarvestableDistanceSq
        && isWildStockHarvestable(node, reservePercent)
      ) {
        nearestHarvestableNode = node;
        nearestHarvestableDistanceSq = distanceSq;
      }
    }
  }
  // Match the authoritative selector: a farther healthy population may be
  // worked while the closest one is resting at its protected floor.
  const nearestNode = managesWildStock
    ? nearestHarvestableNode ?? nearestPopulationNode
    : context.worldQueries.findNearestForagingWithRemaining(
      building.x,
      building.z,
      building.workRadius,
      copy.foragingKind,
      true,
    );
  const protectedStock = nearestNode && managesWildStock
    ? protectedWildStock(
      nearestNode.kind as HarvestForagingKind,
      nearestNode.maxYield,
      reservePercent,
    )
    : 0;
  const harvestableStock = nearestNode && managesWildStock
    ? harvestableWildStock({
      kind: nearestNode.kind as HarvestForagingKind,
      remaining: nearestNode.remaining,
      maxYield: nearestNode.maxYield,
    }, reservePercent)
    : nearestNode?.remaining ?? 0;
  const month = gameClock(context.gameState.tick).month;
  const seasonAvailable = nearestNode
    ? isForagingHarvestAvailable(nearestNode.kind as HarvestForagingKind, month)
    : true;
  const crew = foodLaborSplit(
    building.assignedLabor,
    context.populationStats.available,
  );
  const claimedResidences = context.worldQueries.getClaimedResidencesForFoodSupplier(building);
  const foodCapacity = buildingStorageCaps(building.kind).food ?? 0;
  const managedStockFull = managesWildStock
    && foodCapacity > 0
    && edibleFoodStock(building) >= foodCapacity - 1e-6;
  const localFoodReserve = householdFoodReserve(claimedResidences.length, foodCapacity);
  const institutionalSurplus = institutionalFoodSurplus(
    edibleFoodStock(building),
    claimedResidences.length,
    foodCapacity,
  );
  const nextFoodDeliveryTarget =
    context.worldQueries.getNextFoodDeliveryTargetForSupplier(building);
  const nextCareTarget = building.kind === 'foragers_shed'
    && (building.remedies ?? 0) > 1e-6
    ? nextRemedyDeliveryTarget(context, building)
    : null;
  const nextDeliveryTarget = nextCareTarget ?? nextFoodDeliveryTarget;
  const nextTargetLabel = nextCareTarget
    ? `Parcel #${nextCareTarget.parcelIndex + 1} · ${nextCareTarget.sickPopulation ?? 0} sick · care first`
    : formatNextFoodTargetLabel(nextFoodDeliveryTarget);
  const nextInstitutionalDispatch =
    context.worldQueries.getNextInstitutionalFoodDispatch(
      building,
      context.conflictEnabled === true,
    );
  const nextInstitutionalLabel = nextInstitutionalDispatch
    ? `${institutionalFoodDutyLabel(nextInstitutionalDispatch.duty)} → ${context.worldQueries.getBuildingLabel(nextInstitutionalDispatch.target.kind)} · ${Math.round(edibleFoodStock(nextInstitutionalDispatch.target))} / ${Math.ceil(nextInstitutionalDispatch.desiredStock)} meals`
    : institutionalSurplus <= 1e-6
      ? 'None · local household reserve is protected'
      : 'No eligible institution requesting food';
  const deliveryTripSeconds = nextCareTarget
    ? (() => {
        const distance = context.worldQueries.getLocalDeliveryDistance(
          building.x,
          building.z,
          nextCareTarget.x,
          nextCareTarget.z,
        );
        const workers = Math.max(1, crew.delivering);
        return distance == null
          ? Infinity
          : distance * 2 / (REMEDY_DELIVERY_SPEED_MPS * workers)
            + REMEDY_DELIVERY_UNLOAD_SEC / workers;
      })()
    : context.worldQueries.getFoodDeliveryTripSeconds(
        building,
        nextFoodDeliveryTarget,
      );
  const deliveryDistance = nextDeliveryTarget
    ? context.worldQueries.getRoadPathDistance(building.x, building.z, nextDeliveryTarget.x, nextDeliveryTarget.z)
    : null;
  const foodPerTrip = foodPerDelivery(crew.delivering);
  const activeTrip = context.worldQueries.getActiveDeliveryTrip(building);
  const activeDestinationLabel = activeTrip?.destinationKind === 'building'
    ? formatTripBuildingDestinationLabel(
      activeTrip,
      (kind) => context.worldQueries.getBuildingLabel(kind),
      (id) => context.worldQueries.getBuilding(id),
      nextInstitutionalLabel,
    )
    : formatTripDestinationLabel(
      activeTrip,
      (id) => context.worldQueries.getResidence(id),
      nextTargetLabel,
    );
  const onsiteLabor = onsiteBuildingLabor(building, activeTrip);
  const processingWorkers = Math.min(crew.harvesting, onsiteLabor);
  const tripRemaining = context.worldQueries.getActiveTripRemainingSeconds(building);
  const harvesting = processingWorkers > 0
    && nearestNode != null
    && harvestableStock > 1e-6
    && seasonAvailable;
  const canDeliver = crew.delivering > 0
    && (
      (nextCareTarget != null && (building.remedies ?? 0) > 1e-6)
      || (nextFoodDeliveryTarget != null && edibleFoodStock(building) > 1e-6)
    )
    && !activeTrip;
  const cycleSeconds = definition.harvestInterval;

  let statusText: string;
  let statusState: InspectorView['statusState'];
  if (activeTrip) {
    statusText = `Deliverer ${formatTripPhaseLabel(activeTrip.phase).toLowerCase()} — ${formatCooldown(tripRemaining ?? Infinity)} remaining → ${activeDestinationLabel}`;
    statusState = 'active';
  } else if (canDeliver) {
    statusText = nextCareTarget
      ? `Dispatching remedies — care preempts the ordinary food round`
      : `Delivering food — ${claimedResidences.length} claimed home${claimedResidences.length === 1 ? '' : 's'}`;
    statusState = 'active';
  } else if (
    crew.delivering <= 0
    && (
      (nextCareTarget != null && (building.remedies ?? 0) > 1e-6)
      || (nextFoodDeliveryTarget != null && edibleFoodStock(building) > 1e-6)
    )
  ) {
    statusText = 'Stored goods ready — waiting for an unassigned hauler';
    statusState = 'idle';
  } else if (building.assignedLabor === 0) {
    statusText = copy.idleLabel;
    statusState = 'idle';
  } else if (managedStockFull) {
    statusText = 'Paused — local food storage is full';
    statusState = 'idle';
  } else if (nearestNode && !seasonAvailable) {
    statusText = nearestNode.kind === 'fish'
      ? 'Idle — the shoal is frozen until spring'
      : 'Idle — seasonal forage is dormant for winter';
    statusState = 'idle';
  } else if (nearestNode && nearestNode.remaining <= 0) {
    statusText = nearestNode.kind === 'fish'
      ? 'Idle — the shoal is extinct'
      : nearestNode.kind === 'game'
        ? 'Idle — the game habitat is extinct'
        : 'Idle — the patch is empty and waiting for spring or summer regrowth';
    statusState = nearestNode.kind === 'fish' || nearestNode.kind === 'game'
      ? 'warning'
      : 'idle';
  } else if (nearestNode && managesWildStock && harvestableStock <= 1e-6) {
    statusText = nearestNode.kind === 'fish'
      ? `Resting - ${nearestNode.remaining.toFixed(0)} fish protected; the shoal reproduces in spring`
      : `Resting - ${Math.round(nearestNode.remaining)} game protected as breeding stock`;
    statusState = 'idle';
  } else if (
    nearestNode?.kind === 'game'
    && nearestNode.remaining < 2
  ) {
    statusText = `Warning — ${Math.round(nearestNode.remaining)} animal left, below the breeding floor`;
    statusState = 'warning';
  } else if (harvesting) {
    const resourceLabel = nearestNode.kind === 'mushrooms' ? 'mushrooms' : copy.activeUnit;
    statusText = `Working — ${Math.round(nearestNode.remaining)} ${resourceLabel} left at ${copy.patchLabel}`;
    statusState = 'active';
  } else if (nearestNode) {
    statusText = `Idle — ${Math.round(nearestNode.remaining)} ${copy.activeUnit} in range`;
    statusState = 'idle';
  } else {
    statusText = `Idle — no ${copy.activeUnit} in range`;
    statusState = 'idle';
  }

  const deliveryRow = crew.delivering > 0
    ? `<li><span>Next delivery</span><span>${activeTrip ? activeDestinationLabel : nextTargetLabel}</span></li>
      <li><span>Road distance</span><span>${formatDeliveryRoadDistance(deliveryDistance)}</span></li>
      <li><span>Delivery timer</span><span>${activeTrip ? `${formatTripPhaseLabel(activeTrip.phase)} — ${formatCooldown(tripRemaining ?? Infinity)} left` : `Ready / ${formatDeliveryTripDuration(deliveryTripSeconds)}`}</span></li>
      <li><span>Cart load</span><span>${nextCareTarget ? `${REMEDIES_PER_DELIVERY * crew.delivering} remedies` : `${foodPerTrip} food`}</span></li>`
    : `<li><span>Delivery</span><span>Waiting for an unassigned hauler</span></li>`;

  const reserveRows = managesWildStock
    ? `<li><span>Wild-stock reserve</span><span>${reservePercent}% of carrying capacity${nearestNode ? ` / ${Math.ceil(protectedStock)} protected here` : ''}</span></li>
      <li><span>Harvestable stock</span><span>${nearestNode ? `${Math.floor(harvestableStock)} above reserve / ${Math.round(nearestNode.remaining)} of ${Math.round(nearestNode.maxYield)} population` : 'No population in range'}</span></li>`
    : '';
  const reservePanel = managesWildStock
    ? `<div class="inspector-action-panel">
        <p class="resource-inspector-note">Wild-stock reserve - this building's workers leave the chosen share of each population's carrying capacity untouched and may use another healthy population in range. Another hall or camp with a lower reserve can still harvest the same stock.</p>
        <div class="resource-action-row">
          ${HARVEST_RESERVE_PRESETS
            .map((preset) => `<button type="button" class="resource-action-button" data-harvest-reserve-percent="${preset.percent}" ${reservePercent === preset.percent ? 'disabled' : ''}>${preset.label} / ${preset.percent}%</button>`)
            .join('')}
        </div>
        <p class="inspector-action-panel__hint">${building.kind === 'fishing_camp'
          ? "A protected shoal rebuilds only in spring. Open harvest maximizes today's catch but can cause permanent extinction."
          : "Protected game can breed while the hall rests. Open harvest maximizes today's yield but can leave fewer than the two animals needed to reproduce."}</p>
      </div>`
    : undefined;
  const remedyRows = building.kind === 'foragers_shed'
    ? `<li><span>Dried remedies</span><span>${Math.round(building.remedies ?? 0)} / ${Math.round(buildingStorageCaps(building.kind).remedies ?? 0)} prepared at the shed</span></li>
      <li><span>Medicinal harvest</span><span>${FORAGER_REMEDIES_PER_HARVEST.toFixed(1)} per gatherer-cycle · months ${FORAGER_REMEDY_SEASON_START_MONTH}–${FORAGER_REMEDY_SEASON_END_MONTH}</span></li>
      <li><span>Care dispatch rule</span><span>Least-covered sick home first · ${REMEDY_DELIVERY_TARGET_DAYS.toFixed(0)} treatment-day target · care preempts food on the shared cart</span></li>`
    : '';

  return {
    eyebrow: 'Building',
    title: label,
    statusText,
    statusState,
    detailsHtml: `
      ${buildingCostRows(cost)}
      ${buildingExtentRow(building.kind)}
      ${buildingRoadAccessRow(context.worldQueries, building)}
      <li><span>Labor roles</span><span>${formatFoodCrewSplit(building.assignedLabor, context.populationStats.available)}</span></li>
      <li><span>Harvest interval</span><span>${processingWorkers > 0 ? `${cycleSeconds.toFixed(1)}s` : 'paused'} (${processingWorkers} harvesting / ${building.assignedLabor} assigned)</span></li>
      <li><span>Food territory</span><span>${edibleFoodStock(building) <= 1e-6 ? 'Yielding while stores are empty' : claimedResidences.length === 0 ? 'None in range' : `${claimedResidences.length} claimed`}</span></li>
      <li><span>Local food reserve</span><span>${Math.round(localFoodReserve)} protected · ${Math.round(institutionalSurplus)} central surplus</span></li>
      <li><span>Next surplus cart</span><span>${nextInstitutionalLabel}</span></li>
      ${remedyRows}
      ${reserveRows}
      ${deliveryRow}
      ${buildingStorageRows(building, building.kind)}
    `,
    demolish: {
      visible: true,
      hint: buildingDemolishHint(building.kind),
    },
    labor: buildingLaborView(building, context.populationStats, context.worldQueries),
    supplementalPanelHtml: reservePanel,
  };
}
