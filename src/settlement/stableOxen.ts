import { buildingPlacementYaw } from '../buildings/buildingPlacement.ts';
import { STABLE_OX_REST_ANCHORS } from '../buildings/meshes/stableMesh.ts';
import type { DeliveryTripState } from '../logistics/deliveryTrips.ts';
import { rosteredCartWorkersByBuilding } from '../logistics/deliveryTrips.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import type { BuildingKind, BuildingState } from '../resources/types.ts';

/**
 * Work where draught power can plausibly replace one worker's heavy effort.
 * Fine crafts, worship, guards, household service, and construction are
 * intentionally excluded. Logistics buildings use oxen for carts only.
 */
export const OX_SUPPORTED_WORKPLACE_KINDS = [
  'lumber_mill',
  'reforester',
  'woodcutters_lodge',
  'stone_quarry',
  'large_quarry',
  'mine',
  'clay_pit',
  'charcoal_burner',
  'threshing_barn',
  'pastoral_farmstead',
  'swineherd',
  'carpenter',
  'village_storehouse',
  'granary',
  'trading_post',
] as const satisfies readonly BuildingKind[];

const OX_SUPPORTED_WORKPLACE_KIND_SET = new Set<BuildingKind>(
  OX_SUPPORTED_WORKPLACE_KINDS,
);

const OX_LOGISTICS_ONLY_KIND_SET = new Set<BuildingKind>([
  'village_storehouse',
  'granary',
  'trading_post',
]);

export type StableOxLike = Readonly<{
  id: string;
  stableId: string;
  slot: number;
}>;

export type StableOxAssignment = Readonly<{
  oxId: string;
  stableId: string;
  buildingId: string;
  workerSlot: number;
}>;

export type StableOxRestPose = Readonly<{
  x: number;
  z: number;
  yaw: number;
  localGroundOffset: number;
}>;

export function isOxSupportedWorkplace(kind: BuildingKind): boolean {
  return OX_SUPPORTED_WORKPLACE_KIND_SET.has(kind);
}

/** Logistics buildings reserve oxen only while an actual cart trip is active. */
export function isOxProductionWorkplace(kind: BuildingKind): boolean {
  return isOxSupportedWorkplace(kind) && !OX_LOGISTICS_ONLY_KIND_SET.has(kind);
}

function stableOxOrder(left: StableOxLike, right: StableOxLike): number {
  return left.stableId.localeCompare(right.stableId)
    || left.slot - right.slot
    || left.id.localeCompare(right.id);
}

/**
 * Mirrors the server's automatic pairing contract. Active cart reservations
 * are removed first, then every remaining ox takes the nearest unclaimed
 * on-site heavy-work slot. Stable id, bay, building id, and worker slot make
 * every tie deterministic without exposing manual assignment controls.
 */
export function assignStableOxen(
  oxen: Iterable<StableOxLike>,
  buildings: ReadonlyMap<string, BuildingState>,
  deliveryTrips: Iterable<DeliveryTripState> = [],
  disabledBuildingIds: ReadonlySet<string> = new Set(),
): Map<string, StableOxAssignment> {
  const trips = [...deliveryTrips];
  const reservedOxIds = new Set(
    trips
      .map((trip) => trip.oxId ?? null)
      .filter((id): id is string => id != null),
  );
  const awayWorkers = rosteredCartWorkersByBuilding(buildings, trips);
  const openWorkerSlots = new Map<string, number[]>();

  for (const building of buildings.values()) {
    if (
      !isOxProductionWorkplace(building.kind)
      || building.constructionComplete === false
      || disabledBuildingIds.has(building.id)
    ) continue;
    const onsite = Math.max(
      0,
      Math.floor(building.assignedLabor)
        - Math.floor(awayWorkers.get(building.id) ?? 0),
    );
    if (onsite > 0) {
      openWorkerSlots.set(
        building.id,
        Array.from({ length: onsite }, (_, slot) => slot),
      );
    }
  }

  const assignments = new Map<string, StableOxAssignment>();
  const orderedOxen = [...oxen].sort(stableOxOrder);
  for (const ox of orderedOxen) {
    if (reservedOxIds.has(ox.id)) continue;
    const stable = buildings.get(ox.stableId);
    if (
      stable?.kind !== 'stable'
      || stable.constructionComplete === false
      || disabledBuildingIds.has(stable.id)
    ) continue;

    let best: {
      building: BuildingState;
      slot: number;
      distanceSq: number;
    } | null = null;
    for (const [buildingId, slots] of openWorkerSlots) {
      const slot = slots[0];
      if (slot == null) continue;
      const building = buildings.get(buildingId);
      if (!building) continue;
      const dx = building.x - stable.x;
      const dz = building.z - stable.z;
      const distanceSq = dx * dx + dz * dz;
      if (
        !best
        || distanceSq < best.distanceSq - 1e-6
        || (
          Math.abs(distanceSq - best.distanceSq) <= 1e-6
          && (
            building.id.localeCompare(best.building.id) < 0
            || (building.id === best.building.id && slot < best.slot)
          )
        )
      ) {
        best = { building, slot, distanceSq };
      }
    }
    if (!best) continue;

    assignments.set(ox.id, {
      oxId: ox.id,
      stableId: ox.stableId,
      buildingId: best.building.id,
      workerSlot: best.slot,
    });
    const slots = openWorkerSlots.get(best.building.id);
    slots?.shift();
    if (slots?.length === 0) openWorkerSlots.delete(best.building.id);
  }
  return assignments;
}

/** Converts one authored stable bay from local +Z-road space into world space. */
export function stableOxRestPose(
  stable: BuildingState,
  slot: number,
  roadNetwork: RoadNetwork | null,
): StableOxRestPose {
  const anchor = STABLE_OX_REST_ANCHORS[
    Math.max(0, Math.min(STABLE_OX_REST_ANCHORS.length - 1, Math.floor(slot)))
  ]!;
  const [localX, localY, localZ] = anchor.localPosition;
  const buildingYaw = buildingPlacementYaw(
    stable.kind,
    stable.x,
    stable.z,
    roadNetwork,
  );
  const cos = Math.cos(buildingYaw);
  const sin = Math.sin(buildingYaw);
  return {
    x: stable.x + localX * cos + localZ * sin,
    z: stable.z - localX * sin + localZ * cos,
    yaw: buildingYaw + anchor.localYaw,
    localGroundOffset: localY,
  };
}
