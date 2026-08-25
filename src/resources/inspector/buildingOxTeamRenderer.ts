import {
  isOxProductionWorkplace,
  isOxSupportedWorkplace,
} from '../../settlement/stableOxen.ts';
import { fireForTarget } from '../../fires/fireIncident.ts';
import { getBuildingDefinition } from '../buildings.ts';
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

  let postedCount = 0;
  let automaticPoolCount = 0;
  for (const ox of context.gameState.stableOxen.values()) {
    if (ox.assignedBuildingId === building.id) postedCount += 1;
    else if (ox.assignedBuildingId == null) automaticPoolCount += 1;
  }

  const maxCount = getBuildingDefinition(building.kind).maxLabor;
  const postingLocked = fireForTarget(
    context.gameState.fireIncidents.values(),
    'building',
    building.id,
  ) != null;
  const effect = isOxProductionWorkplace(building.kind)
    ? 'Each posted ox doubles one active worker’s yield.'
    : 'Each posted ox doubles one active hauler’s carrying capacity.';

  return {
    ...view,
    oxTeam: {
      visible: true,
      count: postedCount,
      automaticPoolCount,
      maxCount,
      hint: postingLocked
        ? `Posting changes resume after fire recovery. ${effect}`
        : effect,
      decreaseDisabled: postingLocked || postedCount <= 0,
      increaseDisabled: postingLocked
        || postedCount >= maxCount
        || automaticPoolCount <= 0,
    },
  };
}
