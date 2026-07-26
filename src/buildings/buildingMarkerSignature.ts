import {
  BUILDING_STORAGE_CAPS,
  LIVESTOCK_HAY_STORAGE_CAPACITY,
} from '../generated/gameBalance.ts';
import type { BuildingState, LivestockHerdState } from '../resources/types.ts';
import { constructionVisualSignature } from './ConstructionSiteMesh.ts';
import {
  HAYLOFT_VISUAL_SEGMENTS,
  CLOTH_STOCKPILE_VISUAL_SEGMENTS,
  stockpileVisualLevel,
  TIMBER_STOCKPILE_VISUAL_SEGMENTS,
  WOOL_STOCKPILE_VISUAL_SEGMENTS,
} from './buildingStockpileVisuals.ts';

export function buildingMeshSignature(building: BuildingState): string {
  if (building.constructionComplete !== false) {
    return `complete:${building.kind}`;
  }
  return constructionVisualSignature(
    building.constructionProgress,
    ratio(building.constructionDeliveredTimber, building.constructionRequiredTimber),
    ratio(building.constructionDeliveredStone, building.constructionRequiredStone),
  );
}

export function buildingMarkerSignatures(
  buildings: ReadonlyMap<string, BuildingState>,
  livestockHerds?: ReadonlyMap<string, LivestockHerdState>,
): { visual: string; collider: string } {
  const entries = [...buildings.values()]
    .map((building) => {
      const timberState = building.kind === 'lumber_mill'
        && building.constructionComplete !== false
        ? `:timber:${stockpileVisualLevel(
          building.timber,
          BUILDING_STORAGE_CAPS.lumber_mill.timber,
          TIMBER_STOCKPILE_VISUAL_SEGMENTS,
        )}`
        : '';
      const hayState = building.kind === 'pastoral_farmstead'
        && building.constructionComplete !== false
        ? `:hay:${stockpileVisualLevel(
          livestockHerds?.get(building.id)?.hayStock ?? 0,
          LIVESTOCK_HAY_STORAGE_CAPACITY,
          HAYLOFT_VISUAL_SEGMENTS,
        )}`
        : '';
      const woolState = (building.kind === 'pastoral_farmstead' || building.kind === 'weaver')
        && building.constructionComplete !== false
        ? `:wool:${stockpileVisualLevel(
          building.wool ?? 0,
          BUILDING_STORAGE_CAPS[building.kind].wool ?? 0,
          WOOL_STOCKPILE_VISUAL_SEGMENTS,
        )}`
        : '';
      const clothState = building.kind === 'weaver'
        && building.constructionComplete !== false
        ? `:cloth:${stockpileVisualLevel(
          building.cloth ?? 0,
          BUILDING_STORAGE_CAPS.weaver.cloth ?? 0,
          CLOTH_STOCKPILE_VISUAL_SEGMENTS,
        )}`
        : '';
      const structural = [
        building.id,
        building.x.toFixed(2),
        building.z.toFixed(2),
        buildingMeshSignature(building),
      ].join(':');
      return {
        id: building.id,
        visual: `${structural}${timberState}${hayState}${woolState}${clothState}`,
        collider: structural,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    visual: entries.map((entry) => entry.visual).join('|'),
    collider: entries.map((entry) => entry.collider).join('|'),
  };
}

export function buildingMarkerCollectionSignature(
  buildings: ReadonlyMap<string, BuildingState>,
  livestockHerds?: ReadonlyMap<string, LivestockHerdState>,
): string {
  return buildingMarkerSignatures(buildings, livestockHerds).visual;
}

function ratio(value: number, required: number): number {
  if (required <= 1e-6) return 1;
  return Math.min(1, Math.max(0, value / required));
}
