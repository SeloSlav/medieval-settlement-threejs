import { STARTING_POPULATION } from '../../generated/gameBalance.ts';
import {
  cargoKindLabel,
  formatTripPhaseLabel,
} from '../../logistics/deliveryTrips.ts';
import {
  planFoundingStockyardRelocation,
  type FoundingStockyardRelocationPlan,
} from '../../logistics/foundingStockyardLogistics.ts';
import type { InspectableTarget } from '../types.ts';
import {
  buildingDemolishHint,
  buildingRoadAccessRow,
  buildingStorageRows,
} from './buildingCommon.ts';
import {
  hiddenDemolish,
  hiddenLabor,
  type InspectorRenderContext,
  type InspectorView,
} from './renderInspectableTarget.ts';

function materialLabel(plan: FoundingStockyardRelocationPlan): string {
  if (plan.commodity === null) return 'material';
  return cargoKindLabel(plan.commodity);
}

function isExpansionCamp(
  building: Extract<InspectableTarget, { kind: 'building' }>['building'],
): boolean {
  return building.kind === 'founders_camp'
    && (
      building.constructionRequiredTimber > 1e-6
      || building.constructionRequiredStone > 1e-6
      || (building.constructionRequiredIronwork ?? 0) > 1e-6
      || (building.constructionRequiredRoofTiles ?? 0) > 1e-6
    );
}

function storageNeed(plan: FoundingStockyardRelocationPlan): string {
  switch (plan.commodity) {
    case 'timber':
    case 'stone':
    case 'firewood':
      return 'a Storehouse with intake enabled';
    case 'food':
    case 'ryeBread':
    case 'maslinBread':
    case 'meat':
    case 'fish':
    case 'berries':
    case 'mushrooms':
    case 'milk':
    case 'apples':
    case 'pears':
    case 'cherries':
    case 'aronia':
    case 'rosehips':
    case 'vegetables':
    case 'cabbage':
    case 'carrots':
    case 'beetroot':
    case 'eggs':
    case 'grapes':
    case 'curedMeat':
    case 'smokedFish':
    case 'cheese':
    case 'aroniaJam':
    case 'rosehipJam':
    case 'ryeSheaves':
    case 'oatSheaves':
    case 'barleySheaves':
    case 'maslinSheaves':
    case 'ryeGrain':
    case 'oatGrain':
    case 'maslinGrain':
    case 'barley':
    case 'ryeFlour':
    case 'maslinFlour':
    case 'preservedFood':
      return 'a Granary or another compatible provision store';
    case 'malt':
      return 'a Brewhouse with dry malt storage';
    case 'ale':
    case 'cider':
    case 'pearCider':
    case 'mead':
      return 'a staffed Tavern or Brewery';
    case 'honey':
    case 'wine':
      return 'a Marketplace, Monastery, or compatible producer';
    case 'ironwork':
      return 'a Carpenter or Marketplace';
    case 'iron':
      return 'a Forest Bloomery & Smithy or Marketplace';
    case 'clay':
      return "a Potter's Kiln or Marketplace";
    case 'salt':
      return 'a Smokehouse or Marketplace';
    case 'charcoal':
      return "a Forest Bloomery & Smithy or Charcoal Burner's Yard";
    case 'pottery':
      return "a Smokehouse, Marketplace, or Potter's Kiln";
    case 'roofTiles':
      return "a Potter's Kiln with a tile yard";
    case 'manure':
      return 'a crop Farmstead with a manure yard';
    case 'remedies':
      return "a Forager's Shed with a drying porch";
    case 'polearms':
      return 'a Guardhouse or Carpenter';
    case 'wool':
      return "a Weaver's Workshop or Pastoral Farmstead";
    case 'flax':
      return "a Weaver's Workshop or Threshing Barn";
    case 'cloth':
      return "a Marketplace or Weaver's Workshop";
    case 'hides':
      return "a Tannery, Hunter's Hall, Marketplace, or Storehouse";
    case 'leather':
      return "a Cobbler's Workshop, Marketplace, or Storehouse";
    case 'shoes':
      return 'a Marketplace, Cobbler, or Storehouse';
    case 'water':
      return 'a Well or water-using workshop';
    case null:
      return 'compatible permanent storage';
    default: {
      const unreachable: never = plan.commodity;
      return unreachable;
    }
  }
}

function permanentStorageStatus(
  plan: FoundingStockyardRelocationPlan,
  activeTrip: ReturnType<InspectorRenderContext['worldQueries']['getActiveDeliveryTrip']>,
  context: InspectorRenderContext,
): string {
  const plannedTarget = plan.targetBuildingId
    ? context.gameState.buildings.get(plan.targetBuildingId)
    : null;
  const plannedTargetLabel = plannedTarget
    ? context.worldQueries.getBuildingLabel(plannedTarget.kind)
    : 'compatible storage';
  switch (plan.blocker) {
    case 'active-trip': {
      if (!activeTrip) return 'Handcart active';
      const target = activeTrip.targetBuildingId
        ? context.gameState.buildings.get(activeTrip.targetBuildingId)
        : null;
      const destination = target
        ? context.worldQueries.getBuildingLabel(target.kind)
        : 'destination';
      return `${cargoKindLabel(activeTrip.cargoKind)} → ${destination} · ${formatTripPhaseLabel(activeTrip.phase)}`;
    }
    case 'shelters':
      return 'Relocation begins after every founder has a residence place';
    case 'empty':
      return 'Material yard empty';
    case 'reserved':
      return 'Remaining timber and stone are committed to construction or household improvements';
    case 'no-storage':
      return `Build ${storageNeed(plan)} before clearing ${materialLabel(plan).toLowerCase()}`;
    case 'intake-disabled':
      return `Enable ${materialLabel(plan).toLowerCase()} intake at a Storehouse`;
    case 'target-full':
      return `Create ${materialLabel(plan).toLowerCase()} room at ${storageNeed(plan)}`;
    case 'fire':
      return `Repair compatible storage for ${materialLabel(plan).toLowerCase()}`;
    case 'receiving':
      return 'Compatible storage is already receiving another cart';
    case 'disconnected':
      return `No usable haul route to ${storageNeed(plan)}`;
    case 'labor':
      return `${plan.loadAmount.toFixed(0)} ${materialLabel(plan).toLowerCase()} ready · awaiting one free hauler for ${plannedTargetLabel}`;
    case 'ready':
      return `${plan.loadAmount.toFixed(0)} ${materialLabel(plan).toLowerCase()} next · ${plannedTargetLabel} ${plan.routeDistance?.toFixed(0) ?? '?'} m travel equivalent`;
    default: {
      const unreachable: never = plan.blocker;
      return unreachable;
    }
  }
}

export function renderFoundersCampInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  if (isExpansionCamp(building)) {
    return {
      eyebrow: 'Civic expansion outpost',
      title: "Founders' camp",
      statusText: 'Ready to anchor future settlement expansion',
      statusState: 'ok',
      detailsHtml: `
        <li><span>Role</span><span>Establishes a permanent civic foothold for future regional settlement and logistics</span></li>
        <li><span>Founding safeguard</span><span>Immune to fire, severe weather, and raids</span></li>
        <li><span>Camp shelters</span><span>Remain active as an expansion outpost rather than clearing with the original founders</span></li>
        ${buildingStorageRows(building, building.kind)}
        ${buildingRoadAccessRow(context.worldQueries, building)}
      `,
      demolish: {
        visible: true,
        hint: buildingDemolishHint(building.kind),
      },
      labor: hiddenLabor(),
    };
  }
  const shelterActive = building.foundingShelterActive !== false;
  const unhousedFounders = shelterActive
    ? Math.max(0, STARTING_POPULATION - context.populationStats.housed)
    : 0;
  const activeTrip = context.worldQueries.getActiveDeliveryTrip(building);
  const relocationPlan = planFoundingStockyardRelocation({
    state: context.gameState,
    camp: building,
    activeTrip,
    availableLabor: context.populationStats.available,
    roadPathDistance: (ax, az, bx, bz) =>
      context.worldQueries.getLocalDeliveryDistance(ax, az, bx, bz),
  });
  const hasStock = relocationPlan.pendingAmount > 1e-6 || building.gold > 1e-6;
  const completedTownHall = Array.from(context.gameState.buildings.values()).find(
    (candidate) =>
      candidate.kind === 'town_hall'
      && candidate.constructionComplete !== false,
  ) ?? null;
  const townHallRoadDistance = completedTownHall === null
    ? null
    : context.worldQueries.getRoadPathDistance(
        building.x,
        building.z,
        completedTownHall.x,
        completedTownHall.z,
      );
  const lockboxTrip = activeTrip?.cargoKind === 'gold' ? activeTrip : null;
  const lockboxStatus = lockboxTrip
    ? `${building.gold.toFixed(0)} gold on site · ${lockboxTrip.amount.toFixed(0)} travelling by handcart`
    : building.gold <= 1e-6
      ? 'Empty'
      : completedTownHall === null
        ? `${building.gold.toFixed(0)} gold · awaiting a completed Town Hall`
        : townHallRoadDistance === null
          ? `${building.gold.toFixed(0)} gold · connect the camp and Town Hall by road`
          : `${building.gold.toFixed(0)} gold · awaiting the next free hauler`;

  const status = activeTrip
    ? [`Handcart ${formatTripPhaseLabel(activeTrip.phase).toLowerCase()}`, 'active'] as const
    : shelterActive
      ? [`${unhousedFounders} founder${unhousedFounders === 1 ? '' : 's'} awaiting a home`, 'warning'] as const
      : hasStock
        ? ['Shelters cleared · founding stores remain', 'ok'] as const
        : ['Empty · awaiting permanent civic storage', 'idle'] as const;

  return {
    eyebrow: shelterActive ? 'Settlement origin' : 'Temporary stockyard',
    title: shelterActive ? "Founders' camp" : 'Founding stockyard',
    statusText: status[0],
    statusState: status[1],
    detailsHtml: `
      <li><span>Founding households</span><span>${STARTING_POPULATION} people · ${context.populationStats.housed} rehoused</span></li>
      <li><span>Shelter lifecycle</span><span>${shelterActive ? 'Tents clear after all founders have residence places' : 'All founders rehoused'}</span></li>
      <li data-inspector-state="positive"><span>Founding safeguard</span><span>Immune to fire, weather, and raids · cannot be demolished</span></li>
      <li><span>Construction supply</span><span>Free workers carry reserved loads by handcart; the founding stockyard can begin off-road</span></li>
      <li><span>Permanent storage</span><span>${permanentStorageStatus(relocationPlan, activeTrip, context)}</span></li>
      <li><span>Clearance order</span><span>${shelterActive ? 'Starter food moves before bulk fuel; other committed stores remain until every founder is housed' : 'Construction materials move first; provisions, drink, textiles, armaments, and water follow to compatible permanent stores'}</span></li>
      <li><span>Active cart</span><span>${activeTrip ? formatTripPhaseLabel(activeTrip.phase) : 'None'}</span></li>
      <li><span>Lockbox</span><span>${lockboxStatus}</span></li>
      ${buildingStorageRows(building, building.kind)}
      <li><span>Final clearance</span><span>After every cart returns, all founders are housed, the yard is empty, and both a Town Hall and Storehouse are complete</span></li>
    `,
    demolish: hiddenDemolish(),
    labor: hiddenLabor(),
  };
}
