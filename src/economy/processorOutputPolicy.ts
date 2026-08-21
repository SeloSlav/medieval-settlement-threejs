import { BUILDING_STORAGE_CAPS } from '../generated/gameBalance.ts';
import type { BuildingKind, BuildingState } from '../resources/types.ts';
import { preservedFoodStock } from './foodInventory.ts';
import { breadStock, flourStock } from './cropGoods.ts';
import {
  normalizePotterFiringPolicy,
  POTTER_FIRE_ROOF_TILES,
} from './potterFiringPolicy.ts';
import { breweryPolicyOutput } from './breweryRecipePolicy.ts';
import {
  isStorageCommodity,
  storageAcceptsCommodity,
} from './storageAcceptancePolicy.ts';

export const PROCESSOR_OUTPUT_TARGET_KINDS = [
  'watermill',
  'windmill',
  'bakery',
  'brewery',
  'smokehouse',
  'weaver',
  'charcoal_burner',
  'smithy',
  'potter_kiln',
  'tannery',
  'cobbler',
] as const satisfies readonly BuildingKind[];

export type ProcessorOutputTargetKind =
  (typeof PROCESSOR_OUTPUT_TARGET_KINDS)[number];

export const EXTRACTION_OUTPUT_TARGET_KINDS = [
  'stone_quarry',
  'large_quarry',
  'mine',
  'clay_pit',
] as const satisfies readonly BuildingKind[];

export type ExtractionOutputTargetKind =
  (typeof EXTRACTION_OUTPUT_TARGET_KINDS)[number];

export type ProcessorOutputCommodity =
  | 'flour'
  | 'bread'
  | 'ale'
  | 'cider'
  | 'pearCider'
  | 'mead'
  | 'preservedFood'
  | 'cloth'
  | 'charcoal'
  | 'ironwork'
  | 'pottery'
  | 'roofTiles'
  | 'leather'
  | 'shoes';

export type ExtractionOutputCommodity = 'stone' | 'iron' | 'salt' | 'clay';

export type ProcessorInputCommodity =
  | 'ryeGrain'
  | 'oatGrain'
  | 'maslinGrain'
  | 'barley'
  | 'apples'
  | 'pears'
  | 'honey'
  | 'ryeFlour'
  | 'maslinFlour'
  | 'water'
  | 'firewood'
  | 'food'
  | 'wool'
  | 'flax'
  | 'iron'
  | 'clay'
  | 'salt'
  | 'charcoal'
  | 'pottery'
  | 'ironwork'
  | 'hides'
  | 'leather';

export const PROCESSOR_OUTPUT_TARGET_DEFAULT_PERCENT = 100;
export const PROCESSOR_INPUT_STAGING_DEFAULT_CYCLES = 3;
export const PROCESSOR_OUTPUT_TARGET_PRESETS = [
  {
    percent: 25,
    label: 'Lean',
    hint: 'Stages one input cycle and keeps only a small finished-goods buffer.',
  },
  {
    percent: 50,
    label: 'Balanced',
    hint: 'Stages two input cycles and maintains a practical finished-goods buffer.',
  },
  {
    percent: 75,
    label: 'Deep',
    hint: 'Stages three input cycles and builds a strong seasonal reserve.',
  },
  {
    percent: 100,
    label: 'Fill',
    hint: 'Stages the legacy three input cycles and produces until physical capacity.',
  },
] as const;

export const EXTRACTION_OUTPUT_TARGET_PRESETS = [
  {
    percent: 25,
    label: 'Lean',
    hint: 'Keeps a small working yard and preserves finite ground until consumers need it.',
  },
  {
    percent: 50,
    label: 'Balanced',
    hint: 'Keeps a practical local buffer without tying up the full extraction crew.',
  },
  {
    percent: 75,
    label: 'Deep',
    hint: 'Builds a strong construction or winter reserve near the source.',
  },
  {
    percent: 100,
    label: 'Fill',
    hint: 'Retains the legacy behavior and works until the physical yard is full.',
  },
] as const;

const OUTPUT_BY_KIND: Record<
  ProcessorOutputTargetKind,
  ProcessorOutputCommodity
> = {
  watermill: 'flour',
  windmill: 'flour',
  bakery: 'bread',
  brewery: 'ale',
  smokehouse: 'preservedFood',
  weaver: 'cloth',
  charcoal_burner: 'charcoal',
  smithy: 'ironwork',
  potter_kiln: 'pottery',
  tannery: 'leather',
  cobbler: 'shoes',
};

const INPUTS_BY_KIND: Record<
  ProcessorOutputTargetKind,
  readonly ProcessorInputCommodity[]
> = {
  watermill: ['ryeGrain', 'oatGrain', 'maslinGrain'],
  windmill: ['ryeGrain', 'oatGrain', 'maslinGrain'],
  bakery: ['ryeFlour', 'maslinFlour', 'water', 'firewood'],
  brewery: ['barley', 'apples', 'honey', 'water', 'firewood'],
  smokehouse: ['food', 'firewood', 'salt', 'pottery'],
  weaver: ['wool', 'flax', 'water'],
  charcoal_burner: ['firewood'],
  smithy: ['iron', 'charcoal', 'water'],
  potter_kiln: ['clay', 'firewood', 'water'],
  tannery: ['hides', 'water', 'firewood'],
  cobbler: ['leather'],
};

export function isProcessorOutputTargetKind(
  kind: BuildingKind,
): kind is ProcessorOutputTargetKind {
  return (PROCESSOR_OUTPUT_TARGET_KINDS as readonly BuildingKind[]).includes(kind);
}

export function isExtractionOutputTargetKind(
  kind: BuildingKind,
): kind is ExtractionOutputTargetKind {
  return (EXTRACTION_OUTPUT_TARGET_KINDS as readonly BuildingKind[]).includes(kind);
}

export function isProductionOutputTargetKind(
  kind: BuildingKind,
): kind is ProcessorOutputTargetKind | ExtractionOutputTargetKind {
  return isProcessorOutputTargetKind(kind) || isExtractionOutputTargetKind(kind);
}

export function normalizeProcessorOutputTargetPercent(
  percent: number | undefined,
): number {
  if (!Number.isFinite(percent)) return PROCESSOR_OUTPUT_TARGET_DEFAULT_PERCENT;
  const rounded = Math.round(percent as number);
  return PROCESSOR_OUTPUT_TARGET_PRESETS.some((preset) => preset.percent === rounded)
    ? rounded
    : PROCESSOR_OUTPUT_TARGET_DEFAULT_PERCENT;
}

export function processorOutputCommodity(
  kind: ProcessorOutputTargetKind,
): ProcessorOutputCommodity {
  return OUTPUT_BY_KIND[kind];
}

export function processorOutputCommodityForBuilding(
  building: Pick<
    BuildingState,
    | 'kind'
    | 'potterFiringPolicy'
    | 'breweryRecipePolicy'
    | 'barley'
    | 'malt'
    | 'apples'
    | 'honey'
  >,
): ProcessorOutputCommodity | null {
  if (!isProcessorOutputTargetKind(building.kind)) return null;
  if (building.kind === 'brewery') {
    return breweryPolicyOutput(building.breweryRecipePolicy, building);
  }
  if (
    building.kind === 'potter_kiln'
    && normalizePotterFiringPolicy(building.potterFiringPolicy) === POTTER_FIRE_ROOF_TILES
  ) {
    return 'roofTiles';
  }
  return processorOutputCommodity(building.kind);
}

export function processorInputCommodities(
  kind: ProcessorOutputTargetKind,
): readonly ProcessorInputCommodity[] {
  return INPUTS_BY_KIND[kind];
}

export function processorOutputTarget(
  capacity: number,
  percent: number | undefined,
): number {
  if (!Number.isFinite(capacity)) return 0;
  return Math.max(0, capacity)
    * normalizeProcessorOutputTargetPercent(percent)
    / 100;
}

export function processorInputStagingCycles(
  percent: number | undefined,
): number {
  switch (normalizeProcessorOutputTargetPercent(percent)) {
    case 25:
      return 1;
    case 50:
      return 2;
    case 75:
    case 100:
      return PROCESSOR_INPUT_STAGING_DEFAULT_CYCLES;
    default:
      return PROCESSOR_INPUT_STAGING_DEFAULT_CYCLES;
  }
}

export function processorOutputTargetForBuilding(
  building: Pick<
    BuildingState,
    | 'kind'
    | 'processorOutputTargetPercent'
    | 'potterFiringPolicy'
    | 'breweryRecipePolicy'
    | 'barley'
    | 'malt'
    | 'apples'
    | 'honey'
  >,
): number | null {
  const output = processorOutputCommodityForBuilding(building);
  if (!output || !isProcessorOutputTargetKind(building.kind)) return null;
  const capacities = BUILDING_STORAGE_CAPS[building.kind] as Partial<
    Record<ProcessorOutputCommodity | 'food', number>
  >;
  const capacity = output === 'bread'
    ? capacities.food ?? 0
    : capacities[output] ?? 0;
  return processorOutputTarget(capacity, building.processorOutputTargetPercent);
}

export function processorOutputHeadroom(
  building: BuildingState,
): number | null {
  const output = processorOutputCommodityForBuilding(building);
  if (!output) return null;
  const target = processorOutputTargetForBuilding(building) ?? 0;
  const stock = building.kind === 'smokehouse'
    ? preservedFoodStock(building)
    : output === 'flour'
      ? flourStock(building)
      : output === 'bread'
        ? breadStock(building)
        : Math.max(0, building[output] ?? 0);
  return Math.max(0, target - stock);
}

export function extractionOutputTarget(
  kind: ExtractionOutputTargetKind,
  commodity: ExtractionOutputCommodity,
  percent: number | undefined,
): number {
  const capacity = (
    BUILDING_STORAGE_CAPS[kind] as Partial<
      Record<ExtractionOutputCommodity, number>
    >
  )[commodity] ?? 0;
  return processorOutputTarget(capacity, percent);
}

export function extractionOutputHeadroom(
  building: Pick<
    BuildingState,
    'kind' | 'processorOutputTargetPercent' | ExtractionOutputCommodity
  >,
  commodity: ExtractionOutputCommodity,
): number | null {
  if (!isExtractionOutputTargetKind(building.kind)) return null;
  const target = extractionOutputTarget(
    building.kind,
    commodity,
    building.processorOutputTargetPercent,
  );
  return Math.max(0, target - Math.max(0, building[commodity] ?? 0));
}

export function extractionOutputCommodity(
  kind: BuildingKind,
  mineralResource: 'iron' | 'salt' | null = null,
): ExtractionOutputCommodity | null {
  switch (kind) {
    case 'stone_quarry':
    case 'large_quarry':
      return 'stone';
    case 'clay_pit':
      return 'clay';
    case 'mine':
      return mineralResource;
    default:
      return null;
  }
}

/**
 * Replacement tools are durable worksite reserves, so an extraction yard may
 * refill its rack even while finished output is held at the chosen ceiling.
 * Unknown mineral sites remain ineligible because they have no valid workface.
 */
export function extractionAcceptsMaintenance(
  building: Pick<
    BuildingState,
    | 'kind'
    | 'processorOutputTargetPercent'
    | ExtractionOutputCommodity
  >,
  mineralResource: 'iron' | 'salt' | null = null,
): boolean {
  if (!isExtractionOutputTargetKind(building.kind)) return true;
  const output = extractionOutputCommodity(building.kind, mineralResource);
  return output !== null;
}

export function processorNeedsInputs(
  building: BuildingState,
): boolean {
  const headroom = processorOutputHeadroom(building);
  return headroom == null || headroom > 1e-6;
}

export function processorUsesInput(
  kind: BuildingKind,
  commodity: ProcessorInputCommodity,
): boolean {
  return isProcessorOutputTargetKind(kind)
    && INPUTS_BY_KIND[kind].includes(commodity);
}

export function processorAcceptsInput(
  building: BuildingState,
  commodity: ProcessorInputCommodity,
): boolean {
  if (isStorageCommodity(commodity) && !storageAcceptsCommodity(building, commodity)) {
    return false;
  }
  if (
    (building.kind === 'watermill' || building.kind === 'windmill')
    && commodity === 'oatGrain'
  ) return false;
  if (building.kind === 'pastoral_farmstead' && commodity === 'salt') {
    return preservedFoodStock(building) + 1e-6
      < (BUILDING_STORAGE_CAPS.pastoral_farmstead.preservedFood ?? 0);
  }
  return !processorUsesInput(building.kind, commodity)
    || processorNeedsInputs(building);
}
