import type { BuildingKind } from '../generated/gameBalance.ts';
import type { BuildingState } from '../resources/types.ts';
import type { ProductionPocketKind } from './audioCatalog.ts';

export type { ProductionPocketKind } from './audioCatalog.ts';

export const PRODUCTION_POCKET_KINDS = [
  'wood',
  'metal-stone',
  'food-farm',
  'textile-leather',
] as const satisfies readonly ProductionPocketKind[];

export type ProductionPocketTarget = {
  kind: ProductionPocketKind;
  sourceId: string;
  x: number;
  z: number;
  /** Gain before the positional panner applies its distance rolloff. */
  mixGain: number;
  /** Selection score used to enforce the global voice limit. */
  priority: number;
};

export const PRODUCTION_POCKET_FULL_VOLUME_DISTANCE = 10;
export const PRODUCTION_POCKET_CUTOFF_DISTANCE = 72;
export const PRODUCTION_POCKET_FULL_ZOOM_DISTANCE = 34;
export const PRODUCTION_POCKET_SILENT_ZOOM_DISTANCE = 104;
export const PRODUCTION_POCKET_MAX_ACTIVE = 2;

const PRODUCTION_POCKET_KIND_BY_BUILDING: Partial<Record<BuildingKind, ProductionPocketKind>> = {
  lumber_mill: 'wood',
  woodcutters_lodge: 'wood',
  reforester: 'wood',
  carpenter: 'wood',
  bowyer_fletcher: 'wood',

  stone_quarry: 'metal-stone',
  large_quarry: 'metal-stone',
  mine: 'metal-stone',
  charcoal_burner: 'metal-stone',
  smithy: 'metal-stone',
  weaponsmith_armorer: 'metal-stone',
  potter_kiln: 'metal-stone',

  hunters_hall: 'food-farm',
  foragers_shed: 'food-farm',
  fishing_camp: 'food-farm',
  threshing_barn: 'food-farm',
  pastoral_farmstead: 'food-farm',
  swineherd: 'food-farm',
  brewery: 'food-farm',
  smokehouse: 'food-farm',
  bakery: 'food-farm',
  apiary: 'food-farm',
  watermill: 'food-farm',
  windmill: 'food-farm',

  spinning_retting_house: 'textile-leather',
  weaver: 'textile-leather',
  tannery: 'textile-leather',
  cobbler: 'textile-leather',
  chandlery: 'textile-leather',
};

export function productionPocketKindForBuilding(
  kind: BuildingKind,
): ProductionPocketKind | null {
  return PRODUCTION_POCKET_KIND_BY_BUILDING[kind] ?? null;
}

export function isAudiblyActiveProductionBuilding(
  building: BuildingState,
): boolean {
  return productionPocketKindForBuilding(building.kind) !== null
    && building.constructionComplete !== false
    && building.fireRepairActive !== true
    && building.assignedLabor > 0
    && (building.productionRatePercent ?? 50) > 0;
}

export function productionPocketZoomGain(orbitDistance: number): number {
  return 1 - smoothstep(
    PRODUCTION_POCKET_FULL_ZOOM_DISTANCE,
    PRODUCTION_POCKET_SILENT_ZOOM_DISTANCE,
    orbitDistance,
  );
}

export function productionPocketDistanceGain(distance: number): number {
  if (distance <= PRODUCTION_POCKET_FULL_VOLUME_DISTANCE) return 1;
  if (distance >= PRODUCTION_POCKET_CUTOFF_DISTANCE) return 0;
  return 1 - smoothstep(
    PRODUCTION_POCKET_FULL_VOLUME_DISTANCE,
    PRODUCTION_POCKET_CUTOFF_DISTANCE,
    distance,
  );
}

export function buildProductionPocketTargets(params: {
  buildings: Iterable<BuildingState>;
  listener: { x: number; z: number };
  orbitDistance: number;
  isNight: boolean;
  laborPaused: boolean;
}): ProductionPocketTarget[] {
  if (params.isNight || params.laborPaused) return [];
  const zoomGain = productionPocketZoomGain(params.orbitDistance);
  if (zoomGain <= 0) return [];

  const bestByKind = new Map<ProductionPocketKind, ProductionPocketTarget>();
  for (const building of params.buildings) {
    if (!isAudiblyActiveProductionBuilding(building)) continue;
    const kind = productionPocketKindForBuilding(building.kind);
    if (!kind) continue;
    const distance = Math.hypot(
      building.x - params.listener.x,
      building.z - params.listener.z,
    );
    const distanceGain = productionPocketDistanceGain(distance);
    if (distanceGain <= 0) continue;
    const laborGain = Math.min(1, 0.55 + Math.min(3, building.assignedLabor) * 0.15);
    const candidate: ProductionPocketTarget = {
      kind,
      sourceId: building.id,
      x: building.x,
      z: building.z,
      mixGain: zoomGain * laborGain,
      priority: zoomGain * laborGain * distanceGain,
    };
    const incumbent = bestByKind.get(kind);
    if (
      !incumbent
      || candidate.priority > incumbent.priority
      || (
        candidate.priority === incumbent.priority
        && candidate.sourceId.localeCompare(incumbent.sourceId) < 0
      )
    ) {
      bestByKind.set(kind, candidate);
    }
  }

  return [...bestByKind.values()]
    .sort((left, right) => (
      right.priority - left.priority
      || left.kind.localeCompare(right.kind)
      || left.sourceId.localeCompare(right.sourceId)
    ))
    .slice(0, PRODUCTION_POCKET_MAX_ACTIVE);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
