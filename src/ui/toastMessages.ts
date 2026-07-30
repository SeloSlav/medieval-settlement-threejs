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
  'building.placement.within_pasture': 'Cannot build inside a fenced pasture',
  'building.placement.on_resource_deposit': 'Cannot build over a physical resource deposit',
  'building.placement.no_quarry_in_range': 'No quarry stone within work range',
  'building.placement.requires_rich_deposit': 'Large Quarries must be placed directly over a rich stone deposit',
  'building.placement.requires_mineral_deposit': 'Mineral mines must be placed directly over an iron or salt deposit',
  'building.placement.requires_clay_deposit': 'Clay Pits must be placed directly over a marked ordinary or rich clay deposit',
  'building.placement.no_game_in_range': 'No game within work range',
  'building.placement.no_berries_in_range': 'Place within 48 m of a berry patch or mushroom bed (dormant and depleted patches still count)',
  'building.placement.no_fish_in_range': 'No fish shoal within work range',
  'building.placement.no_trees_in_range': 'No mature trees within work range',
  'building.placement.on_road': 'Cannot build on a road',
  'building.placement.insufficient_resources': 'Not enough timber or stone',
  'building.placement.requires_completed_watchtower': 'Complete a frontier watchtower before establishing a paid guardhouse',
  'building.placement.requires_completed_guardhouse': 'Complete a frontier guardhouse before enclosing a palisaded refuge',
  'building.placement.requires_staffed_chapel': 'A staffed church is required before founding a monastery',
  'building.placement.requires_parish_population': 'The parish needs at least 12 residents before founding a monastery',
  'building.placement.town_hall_exists': 'Only one Town Hall may serve a settlement',
  'building.placement.requires_town_hall_population': 'The settlement needs at least 24 residents before building a Town Hall',
  'building.placement.requires_completed_chapel': 'Build a church before founding the Town Hall',
  'building.placement.requires_completed_marketplace': 'Build a marketplace before founding the Town Hall',
  'building.placement.requires_civic_road_link': 'The Town Hall must be road-linked to both the church and marketplace',
  'burgage.placement.water': 'Cannot place residences on water',
  'burgage.placement.too_steep': 'The slope is too steep here',
  'burgage.placement.invalid_shape': 'Invalid residence plot shape',
  'burgage.placement.too_small': 'Plot is too shallow — pull the back edge farther from the road',
  'burgage.placement.too_deep': 'Plot is too deep — shorten the backyard behind the road',
  'burgage.placement.no_road_frontage': 'Frontage must face a road',
  'burgage.placement.overlaps_existing': 'Overlaps an existing residence plot',
  'burgage.placement.overlaps_building': 'Overlaps an existing building',
  'burgage.placement.overlaps_farm_field': 'Overlaps cultivated farmland',
  'burgage.placement.on_resource_deposit': 'Cannot place residences over a physical resource deposit',
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
    case 'on_resource_deposit':
      return 'burgage.placement.on_resource_deposit';
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
    case 'within_pasture':
      return 'building.placement.within_pasture';
    case 'on_resource_deposit':
      return 'building.placement.on_resource_deposit';
    case 'no_quarry_in_range':
      return 'building.placement.no_quarry_in_range';
    case 'requires_rich_deposit':
      return 'building.placement.requires_rich_deposit';
    case 'requires_mineral_deposit':
      return 'building.placement.requires_mineral_deposit';
    case 'requires_clay_deposit':
      return 'building.placement.requires_clay_deposit';
    case 'no_game_in_range':
      return 'building.placement.no_game_in_range';
    case 'no_berries_in_range':
      return 'building.placement.no_berries_in_range';
    case 'no_fish_in_range':
      return 'building.placement.no_fish_in_range';
    case 'no_trees_in_range':
      return 'building.placement.no_trees_in_range';
    case 'on_road':
      return 'building.placement.on_road';
    case 'insufficient_resources':
      return 'building.placement.insufficient_resources';
    case 'requires_completed_watchtower':
      return 'building.placement.requires_completed_watchtower';
    case 'requires_completed_guardhouse':
      return 'building.placement.requires_completed_guardhouse';
    case 'requires_staffed_chapel':
      return 'building.placement.requires_staffed_chapel';
    case 'requires_parish_population':
      return 'building.placement.requires_parish_population';
    case 'town_hall_exists':
      return 'building.placement.town_hall_exists';
    case 'requires_town_hall_population':
      return 'building.placement.requires_town_hall_population';
    case 'requires_completed_chapel':
      return 'building.placement.requires_completed_chapel';
    case 'requires_completed_marketplace':
      return 'building.placement.requires_completed_marketplace';
    case 'requires_civic_road_link':
      return 'building.placement.requires_civic_road_link';
    default: {
      const unhandled: never = reason;
      return unhandled;
    }
  }
}
