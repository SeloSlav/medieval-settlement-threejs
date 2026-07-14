import type { RoadPlacementFailureReason } from '../roads/RoadPlacementValidation.ts';
import type { BuildingPlacementFailureReason } from '../buildings/BuildingPlacementValidation.ts';
import type { BurgagePlacementFailureReason } from '../residences/burgagePlacementValidation.ts';

export const TOAST_MESSAGES = {
  'road.placement.river': 'A river was in the way',
  'road.placement.river_too_wide': 'The river is too wide for a wooden bridge',
  'road.placement.rocks': 'Rocks were in the way',
  'road.placement.too_steep': 'The slope is too steep for a road',
  'road.placement.too_short': 'Road segment is too short — add another point',
  'building.placement.water': 'Cannot build on water',
  'building.placement.requires_shore': 'This building must be placed beside open water',
  'building.placement.requires_hillside': 'The Pauline monastery needs a hillside bench — find sloped ground above the valley floor',
  'building.placement.too_steep': 'The slope is too steep here',
  'building.placement.too_close': 'Too close to another building',
  'building.placement.overlapping_extent': 'Another building of the same type already covers this functional extent',
  'building.placement.within_residence_zone': 'Cannot build inside a residence plot',
  'building.placement.within_farm_field': 'Cannot build inside cultivated farmland',
  'building.placement.on_quarry_pit': 'Cannot build on a quarry pit',
  'building.placement.no_quarry_in_range': 'No quarry stone within work range',
  'building.placement.no_game_in_range': 'No game within work range',
  'building.placement.no_berries_in_range': 'No berries within work range',
  'building.placement.no_trees_in_range': 'No mature trees within work range',
  'building.placement.no_road_access': 'Building must be placed near a road',
  'building.placement.on_road': 'Cannot build on a road',
  'building.placement.insufficient_resources': 'Not enough timber or stone',
  'building.placement.requires_staffed_chapel': 'A staffed chapel is required before founding a monastery',
  'building.placement.requires_parish_population': 'The parish needs at least 12 residents before founding a monastery',
  'burgage.placement.water': 'Cannot place residences on water',
  'burgage.placement.too_steep': 'The slope is too steep here',
  'burgage.placement.invalid_shape': 'Invalid residence plot shape',
  'burgage.placement.too_small': 'Plot is too shallow — pull the back edge farther from the road',
  'burgage.placement.too_deep': 'Plot is too deep — shorten the backyard behind the road',
  'burgage.placement.no_road_frontage': 'Frontage must face a road',
  'burgage.placement.overlaps_existing': 'Overlaps an existing residence plot',
  'burgage.placement.overlaps_building': 'Overlaps an existing building',
  'burgage.placement.overlaps_farm_field': 'Overlaps cultivated farmland',
  'burgage.placement.on_quarry_pit': 'Cannot place residences on a quarry pit',
  'burgage.placement.insufficient_resources': 'Not enough timber or stone',
  'burgage.placement.no_fit': 'Too many plots for this frontage — press − to reduce plot count',
} as const;

export type ToastMessageId = keyof typeof TOAST_MESSAGES;

export function getToastMessage(id: ToastMessageId): string {
  return TOAST_MESSAGES[id];
}

export function roadPlacementReasonToToastId(reason: RoadPlacementFailureReason): ToastMessageId | null {
  switch (reason) {
    case 'river':
      return 'road.placement.river';
    case 'river_too_wide':
      return 'road.placement.river_too_wide';
    case 'rocks':
      return 'road.placement.rocks';
    case 'too_steep':
      return 'road.placement.too_steep';
    case 'too_short':
      return 'road.placement.too_short';
    default: {
      const unhandled: never = reason;
      return unhandled;
    }
  }
}

export function burgagePlacementReasonToToastId(reason: BurgagePlacementFailureReason): ToastMessageId {
  switch (reason) {
    case 'water':
      return 'burgage.placement.water';
    case 'too_steep':
      return 'burgage.placement.too_steep';
    case 'invalid_shape':
      return 'burgage.placement.invalid_shape';
    case 'too_small':
      return 'burgage.placement.too_small';
    case 'too_deep':
      return 'burgage.placement.too_deep';
    case 'no_road_frontage':
      return 'burgage.placement.no_road_frontage';
    case 'overlaps_existing':
      return 'burgage.placement.overlaps_existing';
    case 'overlaps_building':
      return 'burgage.placement.overlaps_building';
    case 'overlaps_farm_field':
      return 'burgage.placement.overlaps_farm_field';
    case 'on_quarry_pit':
      return 'burgage.placement.on_quarry_pit';
    case 'insufficient_resources':
      return 'burgage.placement.insufficient_resources';
    case 'no_fit':
      return 'burgage.placement.no_fit';
    default: {
      const unhandled: never = reason;
      return unhandled;
    }
  }
}

export function buildingPlacementReasonToToastId(reason: BuildingPlacementFailureReason): ToastMessageId {
  switch (reason) {
    case 'water':
      return 'building.placement.water';
    case 'requires_shore':
      return 'building.placement.requires_shore';
    case 'requires_hillside':
      return 'building.placement.requires_hillside';
    case 'too_steep':
      return 'building.placement.too_steep';
    case 'too_close':
      return 'building.placement.too_close';
    case 'overlapping_extent':
      return 'building.placement.overlapping_extent';
    case 'within_residence_zone':
      return 'building.placement.within_residence_zone';
    case 'within_farm_field':
      return 'building.placement.within_farm_field';
    case 'on_quarry_pit':
      return 'building.placement.on_quarry_pit';
    case 'no_quarry_in_range':
      return 'building.placement.no_quarry_in_range';
    case 'no_game_in_range':
      return 'building.placement.no_game_in_range';
    case 'no_berries_in_range':
      return 'building.placement.no_berries_in_range';
    case 'no_trees_in_range':
      return 'building.placement.no_trees_in_range';
    case 'no_road_access':
      return 'building.placement.no_road_access';
    case 'on_road':
      return 'building.placement.on_road';
    case 'insufficient_resources':
      return 'building.placement.insufficient_resources';
    case 'requires_staffed_chapel':
      return 'building.placement.requires_staffed_chapel';
    case 'requires_parish_population':
      return 'building.placement.requires_parish_population';
    default: {
      const unhandled: never = reason;
      return unhandled;
    }
  }
}
