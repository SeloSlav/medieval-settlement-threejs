import type { BuildingKind, BuildingState } from '../resources/types.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import type { RoadNetwork } from '../roads/RoadNetwork.ts';
import { buildingPlacementYaw } from './buildingPlacement.ts';

export const REMOTE_WORK_CAMP_NAME = 'RemoteWorkCamp';
export const REMOTE_WORK_CAMPFIRE_NAME = 'RemoteWorkCampfire';
export const REMOTE_WORK_CAMP_MAX_DISTANCE = 34;

/** Exposed extraction yards where a separate sleeping camp is believable. */
export const BUILDABLE_REMOTE_WORK_CAMP_KINDS = [
  'lumber_mill',
  'stone_quarry',
  'large_quarry',
  'mine',
  'clay_pit',
  'charcoal_burner',
] as const satisfies readonly BuildingKind[];

/** Rural buildings whose existing hut, lodge, hall, or farmstead includes bunks. */
export const BUILT_IN_WORK_LODGING_KINDS = [
  'reforester',
  'woodcutters_lodge',
  'hunters_hall',
  'foragers_shed',
  'fishing_camp',
  'pastoral_farmstead',
  'swineherd',
] as const satisfies readonly BuildingKind[];

export type RemoteWorkCampKind = (typeof BUILDABLE_REMOTE_WORK_CAMP_KINDS)[number];
export type BuiltInWorkLodgingKind = (typeof BUILT_IN_WORK_LODGING_KINDS)[number];
export type WorksiteLodgingPolicy = 'buildable_camp' | 'built_in' | 'daily_commute';
export type WorksiteLodging = {
  mode: 'remote_camp' | 'built_in';
  lodging: BuildingState;
};

export type RemoteWorkCampLayout = {
  tents: readonly { x: number; z: number; yaw: number }[];
  campfire: { x: number; z: number };
};

const CAMP_LAYOUT: RemoteWorkCampLayout = {
  tents: [
    { x: -1.55, z: -0.75, yaw: 0.48 },
    { x: 1.45, z: -1.1, yaw: -0.42 },
  ],
  campfire: { x: 0, z: 1.9 },
};

export function supportsRemoteWorkCamp(kind: BuildingKind): kind is RemoteWorkCampKind {
  return BUILDABLE_REMOTE_WORK_CAMP_KINDS.includes(kind as RemoteWorkCampKind);
}

export function hasBuiltInWorkLodging(kind: BuildingKind): kind is BuiltInWorkLodgingKind {
  return BUILT_IN_WORK_LODGING_KINDS.includes(kind as BuiltInWorkLodgingKind);
}

export function worksiteLodgingPolicy(kind: BuildingKind): WorksiteLodgingPolicy {
  if (supportsRemoteWorkCamp(kind)) return 'buildable_camp';
  if (hasBuiltInWorkLodging(kind)) return 'built_in';
  return 'daily_commute';
}

export function linkedRemoteWorkCamp(
  worksiteId: string,
  buildings: Iterable<BuildingState>,
): BuildingState | null {
  for (const building of buildings) {
    if (building.kind === 'remote_work_camp' && building.linkedWorksiteId === worksiteId) {
      return building;
    }
  }
  return null;
}

export function resolveWorksiteLodging(
  worksite: BuildingState,
  buildings: Iterable<BuildingState>,
  fireDisabledBuildingIds: ReadonlySet<string> = new Set(),
): WorksiteLodging | null {
  if (
    worksite.constructionComplete === false
    || fireDisabledBuildingIds.has(worksite.id)
  ) {
    return null;
  }
  if (hasBuiltInWorkLodging(worksite.kind)) {
    return { mode: 'built_in', lodging: worksite };
  }
  if (!supportsRemoteWorkCamp(worksite.kind)) return null;
  const camp = linkedRemoteWorkCamp(worksite.id, buildings);
  return camp
    && camp.constructionComplete !== false
    && !fireDisabledBuildingIds.has(camp.id)
    ? { mode: 'remote_camp', lodging: camp }
    : null;
}

export function remoteWorkCampLayout(): RemoteWorkCampLayout {
  return CAMP_LAYOUT;
}

export function workLodgingDoorPosition(
  lodging: Pick<BuildingState, 'kind' | 'x' | 'z'>,
  slotIndex: number,
  roadNetwork: RoadNetwork | null,
): { x: number; z: number; yaw: number } {
  if (lodging.kind !== 'remote_work_camp') {
    const radius = getBuildingDefinition(lodging.kind).pickRadius;
    const sideOffset = ((Math.abs(Math.floor(slotIndex)) % 3) - 1) * 0.55;
    return localToWorld(lodging, sideOffset, radius * 0.58, Math.PI, roadNetwork);
  }
  const layout = remoteWorkCampLayout();
  const tent = layout.tents[Math.abs(Math.floor(slotIndex)) % layout.tents.length]!;
  const localX = tent.x + Math.sin(tent.yaw) * 1.45;
  const localZ = tent.z + Math.cos(tent.yaw) * 1.45;
  return localToWorld(lodging, localX, localZ, tent.yaw, roadNetwork);
}

export function workLodgingFiresidePosition(
  lodging: Pick<BuildingState, 'kind' | 'x' | 'z'>,
  slotIndex: number,
  roadNetwork: RoadNetwork | null,
): { x: number; z: number; yaw: number } {
  if (lodging.kind !== 'remote_work_camp') {
    const radius = getBuildingDefinition(lodging.kind).pickRadius;
    const angle = -0.52 + (Math.abs(Math.floor(slotIndex)) % 5) * 0.26;
    return localToWorld(
      lodging,
      Math.sin(angle) * radius * 0.54,
      Math.cos(angle) * radius * 0.54,
      Math.PI + angle,
      roadNetwork,
    );
  }
  const layout = remoteWorkCampLayout();
  const angle = (Math.abs(Math.floor(slotIndex)) % 6) / 6 * Math.PI * 2;
  const radius = 1.45 + (Math.abs(Math.floor(slotIndex)) % 2) * 0.24;
  const localX = layout.campfire.x + Math.sin(angle) * radius;
  const localZ = layout.campfire.z + Math.cos(angle) * radius;
  const point = localToWorld(lodging, localX, localZ, 0, roadNetwork);
  const fire = localToWorld(lodging, layout.campfire.x, layout.campfire.z, 0, roadNetwork);
  return {
    x: point.x,
    z: point.z,
    yaw: Math.atan2(fire.x - point.x, fire.z - point.z),
  };
}

function localToWorld(
  building: Pick<BuildingState, 'kind' | 'x' | 'z'>,
  localX: number,
  localZ: number,
  localYaw: number,
  roadNetwork: RoadNetwork | null,
): { x: number; z: number; yaw: number } {
  const yaw = buildingPlacementYaw(building.kind, building.x, building.z, roadNetwork);
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return {
    x: building.x + localX * cos + localZ * sin,
    z: building.z - localX * sin + localZ * cos,
    yaw: yaw + localYaw,
  };
}
