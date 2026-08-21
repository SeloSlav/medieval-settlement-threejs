import type { BuildingKind } from '../generated/gameBalance.ts';
import { BUILDING_KINDS } from '../generated/gameBalance.ts';
import type { BuildingPlacementFailureReason } from '../buildings/BuildingPlacementValidation.ts';
import type { FarmCrop } from '../resources/types.ts';
import { formatBuildingCost, getBuildingCost } from '../resources/buildingEconomy.ts';
import type { BuildingResourceCost } from '../resources/buildingEconomy.ts';
import { getBuildingDefinition } from '../resources/buildings.ts';
import { buildingPlacementReasonToToastId, getToastMessage } from './toastMessages.ts';
import { renderBuildingResourceCost } from './resourceCost.ts';

export type ToolbarStats = {
  canBuild: boolean;
  hasDraft: boolean;
  mode: BuildingKind | 'road' | 'dry-stone-wall' | 'residences' | 'farm-fields' | 'pastures' | 'burial-grounds' | 'vineyards' | 'idle';
  statusDetail?: string | null;
  placementBlocked?: boolean;
  placementReady?: boolean;
  farmCrop?: FarmCrop;
  vineyardSuitability?: boolean;
  buildingCost?: BuildingResourceCost;
  carpenterSupported?: boolean;
  carpenterCartServiceEnabled?: boolean;
  carpenterCartServiceReady?: boolean;
};

export function describeBuildingPlacementBlocker(
  reason: BuildingPlacementFailureReason,
): string {
  return `Blocked: ${getToastMessage(buildingPlacementReasonToToastId(reason))}`;
}

export function isBuildingToolMode(mode: ToolbarStats['mode']): mode is BuildingKind {
  return (BUILDING_KINDS as readonly string[]).includes(mode);
}

export function isConstructionToolMode(mode: ToolbarStats['mode']): boolean {
  return isBuildingToolMode(mode)
    || mode === 'dry-stone-wall'
    || mode === 'residences'
    || mode === 'farm-fields'
    || mode === 'pastures'
    || mode === 'burial-grounds'
    || mode === 'vineyards';
}

export function isBuilderHudMode(mode: ToolbarStats['mode']): boolean {
  return mode === 'road' || isConstructionToolMode(mode);
}

const PLACEMENT_STATUS_HINTS: Partial<Record<BuildingKind, string>> = {
  founders_camp: ' — a temporary base while your settlement takes root',
  fishing_camp: ' — keep the camp on land; the finite shoal must be inside its work extent',
  town_hall: ' — requires 24 people, a church, a marketplace, and road access',
  village_storehouse: ' — road-linked haulers collect producer overflow',
  well: ' — use the water map for best spots',
  hunters_hall: ' — click near a game trail',
  foragers_shed: ' — place within 48 m of berries or mushrooms without covering the patch',
  chapel: ' — place near a road',
  marketplace: ' — place near a road',
};

export function describeToolbarStatus(stats: ToolbarStats): string {
  if (isBuildingToolMode(stats.mode)) {
    if (stats.statusDetail) {
      const cost = stats.buildingCost ?? getBuildingCost(stats.mode);
      const materialCost = cost.timber > 0 || cost.stone > 0 || (cost.ironwork ?? 0) > 0
        ? ` | Cost ${formatBuildingCost(cost)}`
        : '';
      return `${stats.statusDetail}${materialCost}`;
    }
    const hint = PLACEMENT_STATUS_HINTS[stats.mode] ?? '';
    const label = getBuildingDefinition(stats.mode).label;
    const cost = stats.buildingCost ?? getBuildingCost(stats.mode);
    const support = stats.carpenterSupported
      ? stats.carpenterCartServiceReady
        ? ' — carpenter-supported: 10% less timber; stocked wheelwright gives road carts +18% speed'
        : stats.carpenterCartServiceEnabled
          ? ' — carpenter-supported: 10% less timber; cart speed awaits repair timber and ironwork'
          : ' — carpenter-supported: 10% less timber; cart service disabled to conserve fittings'
      : '';
    return `Click terrain to place a ${label.toLowerCase()} (${formatBuildingCost(cost)})${support}${hint}`;
  }
  if (stats.mode === 'residences') {
    return stats.statusDetail ?? 'Set a road frontage, then shape two independent back corners';
  }
  if (stats.mode === 'farm-fields') {
    return stats.statusDetail ?? "Shape four free-form field corners inside a farmstead's work extent";
  }
  if (stats.mode === 'pastures') {
    return stats.statusDetail ?? "Shape a free-form fenced pasture inside a livestock holding's work extent";
  }
  if (stats.mode === 'burial-grounds') {
    return stats.statusDetail ?? 'Shape four free-form burial-ground corners beside a completed chapel';
  }
  if (stats.mode === 'vineyards') {
    return stats.statusDetail ?? 'Shape four free-form corners around a grape-growing parcel';
  }
  if (stats.mode === 'dry-stone-wall') {
    if (stats.canBuild) {
      return 'Dry-stone wall ready · L-click trace · Ctrl + wheel curve · Enter build free · Alt + L-click remove';
    }
    if (stats.hasDraft) {
      return 'Dry-stone wall · L-click trace · Ctrl + wheel curve · Esc cancel';
    }
    return 'Dry-stone wall · start beside a dirt road; the first span aligns parallel · free and instant';
  }
  if (stats.mode !== 'road') return 'Road tool off';
  if (stats.canBuild) {
    return 'Road ready · L-click add point · R-click undo · Enter build · Esc cancel';
  }
  if (stats.hasDraft) {
    return 'Road · L-click add point · R-click undo · Esc cancel';
  }
  return 'Road · L-click start · Alt + L-click remove segment · Esc cancel';
}

export function renderToolbarStatus(stats: ToolbarStats): string {
  if (!isBuildingToolMode(stats.mode)) {
    return escapeHtml(describeToolbarStatus(stats));
  }

  const cost = stats.buildingCost ?? getBuildingCost(stats.mode);
  const costMarkup = renderBuildingResourceCost(cost, { compact: true });
  if (stats.statusDetail) {
    const hasMaterialCost = cost.timber > 0 || cost.stone > 0 || (cost.ironwork ?? 0) > 0;
    return `${escapeHtml(stats.statusDetail)}${hasMaterialCost ? ` <span aria-hidden="true">|</span> Cost ${costMarkup}` : ''}`;
  }

  const hint = PLACEMENT_STATUS_HINTS[stats.mode] ?? '';
  const label = getBuildingDefinition(stats.mode).label;
  const support = stats.carpenterSupported
    ? stats.carpenterCartServiceReady
      ? ' — carpenter-supported: 10% less timber; stocked wheelwright gives road carts +18% speed'
      : stats.carpenterCartServiceEnabled
        ? ' — carpenter-supported: 10% less timber; cart speed awaits repair timber and ironwork'
        : ' — carpenter-supported: 10% less timber; cart service disabled to conserve fittings'
    : '';
  return `Click terrain to place a ${escapeHtml(label.toLowerCase())} (${costMarkup})${escapeHtml(support)}${escapeHtml(hint)}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
