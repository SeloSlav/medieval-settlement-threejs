import {
  assignStableOxen,
  isOxProductionWorkplace,
  isOxSupportedWorkplace,
  oxWorkplaceCapacity,
} from '../../settlement/stableOxen.ts';
import { fireDisabledBuildingIds, fireForTarget } from '../../fires/fireIncident.ts';
import type { BuildingState } from '../types.ts';
import type {
  InspectorRenderContext,
  InspectorView,
} from './renderInspectableTarget.ts';

/** Adds the persistent posting controls shared by every ox-supported workplace. */
export function withBuildingOxTeam(
  view: InspectorView,
  building: BuildingState,
  context: InspectorRenderContext,
): InspectorView {
  if (!isOxSupportedWorkplace(building.kind)) return view;

  const haulingOxIds = new Set(
    [...context.gameState.deliveryTrips.values()]
      .map((trip) => trip.oxId)
      .filter((oxId): oxId is string => oxId != null),
  );
  const activeAssignments = assignStableOxen(
    context.gameState.stableOxen.values(),
    context.gameState.buildings,
    context.gameState.deliveryTrips.values(),
    fireDisabledBuildingIds(context.gameState.fireIncidents.values()),
  );
  let postedCount = 0;
  let activePostedCount = 0;
  let automaticPoolCount = 0;
  let postingReadyAutomaticCount = 0;
  for (const ox of context.gameState.stableOxen.values()) {
    if (ox.assignedBuildingId === building.id) {
      postedCount += 1;
      if (
        activeAssignments.get(ox.id)?.buildingId === building.id
        || haulingOxIds.has(ox.id)
      ) {
        activePostedCount += 1;
      }
    }
    else if (ox.assignedBuildingId == null) {
      automaticPoolCount += 1;
      if (!haulingOxIds.has(ox.id)) postingReadyAutomaticCount += 1;
    }
  }

  const maxCount = oxWorkplaceCapacity(building.kind);
  const postingLocked = fireForTarget(
    context.gameState.fireIncidents.values(),
    'building',
    building.id,
  ) != null;
  const waitingPostedCount = Math.max(0, postedCount - activePostedCount);
  const postingState = postedCount <= 0
    ? 'No oxen posted here.'
    : `${activePostedCount} active · ${waitingPostedCount} waiting for labor.`;
  const effect = building.kind === 'threshing_barn'
    ? 'Each paired ox doubles one farmer’s ploughing and threshing pace and adds 50% to harvesting; sowing remains human-only.'
    : isOxProductionWorkplace(building.kind)
      ? 'Each paired ox doubles one present worker’s throughput.'
      : 'An active ox cart doubles one present hauler’s carrying capacity.';
  const baseHint = `${postingState} Capacity ${maxCount}. ${effect}`;

  return {
    ...view,
    oxTeam: {
      visible: true,
      count: postedCount,
      automaticPoolCount,
      maxCount,
      hint: postingLocked
        ? `Posting changes resume after fire recovery. ${baseHint}`
        : postedCount < maxCount
          && automaticPoolCount > 0
          && postingReadyAutomaticCount === 0
          ? `Automatic oxen can be posted after their current cart trips. ${baseHint}`
          : baseHint,
      decreaseDisabled: postingLocked || postedCount <= 0,
      increaseDisabled: postingLocked
        || postedCount >= maxCount
        || postingReadyAutomaticCount <= 0,
    },
  };
}
