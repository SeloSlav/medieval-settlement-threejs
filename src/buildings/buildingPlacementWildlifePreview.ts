import { GAME_HABITAT_DISRUPTION_RADIUS } from '../generated/gameBalance.ts';
import { polygonOverlapsCircle } from '../resources/physicalDepositProtection.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import type {
  BuildingKind,
  ForagingNodeState,
} from '../resources/types.ts';
import { getBuildingFootprintCorners } from './BuildingTerrainLayout.ts';

export type BuildingPlacementWildlifeHabitat = {
  nodeId: string;
  x: number;
  z: number;
  radius: number;
  directBuildingRisk: boolean;
  huntingReach: boolean;
  loggingReach: boolean;
};

export type BuildingPlacementWildlifePreview = {
  habitats: readonly BuildingPlacementWildlifeHabitat[];
  loggingWorkRadius: number | null;
  signature: string;
};

/**
 * Selects only the habitat warnings that explain the candidate building's
 * wildlife impact. The returned data is advisory presentation state; placement
 * validation deliberately remains independent from it.
 */
export function resolveBuildingPlacementWildlifePreview(
  kind: BuildingKind,
  x: number,
  z: number,
  yaw: number,
  nodes: Iterable<ForagingNodeState>,
): BuildingPlacementWildlifePreview {
  const definition = getBuildingDefinition(kind);
  const footprint = getBuildingFootprintCorners(kind, x, z, yaw);
  const huntingWorkRadius = kind === 'hunters_hall'
    ? Math.max(0, definition.workRadius)
    : 0;
  const loggingWorkRadius = kind === 'lumber_mill' || kind === 'woodcutters_lodge'
    ? Math.max(0, definition.workRadius)
    : null;
  const habitats: BuildingPlacementWildlifeHabitat[] = [];

  for (const node of nodes) {
    if (node.kind !== 'game') continue;
    const distance = Math.hypot(node.x - x, node.z - z);
    const directBuildingRisk = polygonOverlapsCircle(
      footprint,
      node.x,
      node.z,
      GAME_HABITAT_DISRUPTION_RADIUS,
    );
    const huntingReach = huntingWorkRadius > 0
      && distance <= huntingWorkRadius + GAME_HABITAT_DISRUPTION_RADIUS;
    const loggingReach = loggingWorkRadius != null
      && loggingWorkRadius > 0
      && distance <= loggingWorkRadius + GAME_HABITAT_DISRUPTION_RADIUS;
    if (!directBuildingRisk && !huntingReach && !loggingReach) continue;

    habitats.push({
      nodeId: node.nodeId,
      x: node.x,
      z: node.z,
      radius: GAME_HABITAT_DISRUPTION_RADIUS,
      directBuildingRisk,
      huntingReach,
      loggingReach,
    });
  }

  habitats.sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  const signature = [
    kind,
    yaw.toFixed(4),
    loggingWorkRadius ?? 0,
    ...habitats.map((habitat) => [
      habitat.nodeId,
      habitat.x.toFixed(2),
      habitat.z.toFixed(2),
      habitat.directBuildingRisk ? 1 : 0,
      habitat.huntingReach ? 1 : 0,
      habitat.loggingReach ? 1 : 0,
    ].join(':')),
  ].join('|');

  return {
    habitats,
    loggingWorkRadius,
    signature,
  };
}
