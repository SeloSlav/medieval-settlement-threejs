import * as THREE from 'three';
import { BUILDING_STORAGE_CAPS } from '../generated/gameBalance.ts';
import type { BuildingState } from '../resources/types.ts';
import {
  stockpileVisualLevel,
  syncStockpileSegments,
} from './buildingStockpileVisuals.ts';

export const CARPENTER_TIMBER_VISUAL_SEGMENTS = 5;
export const CARPENTER_IRONWORK_VISUAL_SEGMENTS = 3;
export const CARPENTER_POLEARM_VISUAL_SEGMENTS = 6;
export const GUARDHOUSE_FOOD_VISUAL_SEGMENTS = 2;
export const GUARDHOUSE_POLEARM_VISUAL_SEGMENTS = 6;

export function armoryStockpileVisualSignature(building: BuildingState): string {
  if (building.constructionComplete === false) return '';
  switch (building.kind) {
    case 'carpenter':
      return `:armory-store:${
        stockpileVisualLevel(
          building.timber,
          BUILDING_STORAGE_CAPS.carpenter.timber,
          CARPENTER_TIMBER_VISUAL_SEGMENTS,
        )
      }:${
        stockpileVisualLevel(
          building.ironwork ?? 0,
          BUILDING_STORAGE_CAPS.carpenter.ironwork ?? 0,
          CARPENTER_IRONWORK_VISUAL_SEGMENTS,
        )
      }:${
        stockpileVisualLevel(
          building.polearms ?? 0,
          BUILDING_STORAGE_CAPS.carpenter.polearms ?? 0,
          CARPENTER_POLEARM_VISUAL_SEGMENTS,
        )
      }`;
    case 'guardhouse':
      return `:company-store:${
        stockpileVisualLevel(
          building.food,
          BUILDING_STORAGE_CAPS.guardhouse.food,
          GUARDHOUSE_FOOD_VISUAL_SEGMENTS,
        )
      }:${
        stockpileVisualLevel(
          building.polearms ?? 0,
          BUILDING_STORAGE_CAPS.guardhouse.polearms ?? 0,
          GUARDHOUSE_POLEARM_VISUAL_SEGMENTS,
        )
      }`;
    default:
      return '';
  }
}

export function syncArmoryStockpileVisuals(
  marker: THREE.Group,
  building: BuildingState,
): void {
  switch (building.kind) {
    case 'carpenter':
      syncNamedStockpile(
        marker,
        'CarpenterTimberStockpile',
        'CarpenterTimberSegment',
        building.timber,
        BUILDING_STORAGE_CAPS.carpenter.timber,
      );
      syncNamedStockpile(
        marker,
        'CarpenterIronworkStockpile',
        'CarpenterIronworkSegment',
        building.ironwork ?? 0,
        BUILDING_STORAGE_CAPS.carpenter.ironwork ?? 0,
      );
      syncNamedStockpile(
        marker,
        'CarpenterPolearmStockpile',
        'CarpenterPolearmSegment',
        building.polearms ?? 0,
        BUILDING_STORAGE_CAPS.carpenter.polearms ?? 0,
      );
      break;
    case 'guardhouse':
      syncNamedStockpile(
        marker,
        'GuardhouseFoodStockpile',
        'GuardhouseFoodSegment',
        building.food,
        BUILDING_STORAGE_CAPS.guardhouse.food,
      );
      syncNamedStockpile(
        marker,
        'GuardhousePolearmStockpile',
        'GuardhousePolearmSegment',
        building.polearms ?? 0,
        BUILDING_STORAGE_CAPS.guardhouse.polearms ?? 0,
      );
      break;
  }
}

function syncNamedStockpile(
  marker: THREE.Group,
  containerName: string,
  segmentName: string,
  amount: number,
  capacity: number,
): void {
  const stockpile = marker.getObjectByName(containerName);
  if (!(stockpile instanceof THREE.Group)) return;
  syncStockpileSegments(stockpile, segmentName, amount, capacity);
}
