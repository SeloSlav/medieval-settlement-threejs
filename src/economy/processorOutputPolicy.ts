import { BUILDING_STORAGE_CAPS } from '../generated/gameBalance.ts';
import type { BuildingKind, BuildingState } from '../resources/types.ts';

export const PROCESSOR_OUTPUT_TARGET_KINDS = [
  'watermill',
  'granary',
  'brewery',
  'smokehouse',
  'weaver',
  'charcoal_burner',
  'smithy',
  'potter_kiln',
] as const satisfies readonly BuildingKind[];

export type ProcessorOutputTargetKind =
  (typeof PROCESSOR_OUTPUT_TARGET_KINDS)[number];

export type ProcessorOutputCommodity =
  | 'flour'
  | 'food'
  | 'ale'
  | 'preservedFood'
  | 'cloth'
  | 'charcoal'
  | 'ironwork'
  | 'pottery';

export type ProcessorInputCommodity =
  | 'grain'
  | 'barley'
  | 'flour'
  | 'water'
  | 'firewood'
  | 'food'
  | 'wool'
  | 'flax'
  | 'iron'
  | 'clay'
  | 'salt'
  | 'charcoal'
  | 'pottery';

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

const OUTPUT_BY_KIND: Record<
  ProcessorOutputTargetKind,
  ProcessorOutputCommodity
> = {
  watermill: 'flour',
  granary: 'food',
  brewery: 'ale',
  smokehouse: 'preservedFood',
  weaver: 'cloth',
  charcoal_burner: 'charcoal',
  smithy: 'ironwork',
  potter_kiln: 'pottery',
};

const INPUTS_BY_KIND: Record<
  ProcessorOutputTargetKind,
  readonly ProcessorInputCommodity[]
> = {
  watermill: ['grain'],
  granary: ['flour', 'water', 'firewood'],
  brewery: ['barley', 'water', 'firewood'],
  smokehouse: ['food', 'firewood', 'salt', 'pottery'],
  weaver: ['wool', 'flax', 'water'],
  charcoal_burner: ['firewood'],
  smithy: ['iron', 'charcoal'],
  potter_kiln: ['clay', 'firewood'],
};

export function isProcessorOutputTargetKind(
  kind: BuildingKind,
): kind is ProcessorOutputTargetKind {
  return (PROCESSOR_OUTPUT_TARGET_KINDS as readonly BuildingKind[]).includes(kind);
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
  building: Pick<BuildingState, 'kind' | 'processorOutputTargetPercent'>,
): number | null {
  if (!isProcessorOutputTargetKind(building.kind)) return null;
  const output = processorOutputCommodity(building.kind);
  const capacity = (
    BUILDING_STORAGE_CAPS[building.kind] as Partial<
      Record<ProcessorOutputCommodity, number>
    >
  )[output] ?? 0;
  return processorOutputTarget(capacity, building.processorOutputTargetPercent);
}

export function processorOutputHeadroom(
  building: Pick<
    BuildingState,
    'kind' | 'processorOutputTargetPercent' | ProcessorOutputCommodity
  >,
): number | null {
  if (!isProcessorOutputTargetKind(building.kind)) return null;
  const output = processorOutputCommodity(building.kind);
  const target = processorOutputTargetForBuilding(building) ?? 0;
  return Math.max(0, target - Math.max(0, building[output] ?? 0));
}

export function processorNeedsInputs(
  building: Pick<
    BuildingState,
    'kind' | 'processorOutputTargetPercent' | ProcessorOutputCommodity
  >,
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
  building: Pick<
    BuildingState,
    'kind' | 'processorOutputTargetPercent' | ProcessorOutputCommodity
  >,
  commodity: ProcessorInputCommodity,
): boolean {
  return !processorUsesInput(building.kind, commodity)
    || processorNeedsInputs(building);
}
