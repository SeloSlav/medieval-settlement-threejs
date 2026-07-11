import type { BuildingKind } from '../generated/gameBalance.ts';
import { getBuildingDefinition } from './buildings.ts';

export function buildingRequiresRoad(kind: BuildingKind): boolean {
  return getBuildingDefinition(kind).requiresRoad;
}

export function buildingFacesRoad(kind: BuildingKind): boolean {
  return getBuildingDefinition(kind).facesRoad;
}
