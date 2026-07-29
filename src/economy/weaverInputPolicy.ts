import {
  WEAVER_FLAX_PER_CYCLE,
  WEAVER_FLAX_WATER_PER_CYCLE,
  WEAVER_WOOL_PER_CYCLE,
} from '../generated/gameBalance.ts';
import type { BuildingState } from '../resources/types.ts';

export const WEAVER_INPUT_POLICY_AUTO = 0;
export const WEAVER_INPUT_POLICY_WOOL_FIRST = 1;
export const WEAVER_INPUT_POLICY_FLAX_FIRST = 2;

export type WeaverInputPolicy =
  | typeof WEAVER_INPUT_POLICY_AUTO
  | typeof WEAVER_INPUT_POLICY_WOOL_FIRST
  | typeof WEAVER_INPUT_POLICY_FLAX_FIRST;

export const WEAVER_INPUT_POLICY_PRESETS = [
  {
    policy: WEAVER_INPUT_POLICY_AUTO,
    label: 'Auto',
    hint: 'Uses the route with the most complete cycles already staged.',
  },
  {
    policy: WEAVER_INPUT_POLICY_WOOL_FIRST,
    label: 'Wool first',
    hint: 'Preserves flax while a complete dry wool cycle is ready.',
  },
  {
    policy: WEAVER_INPUT_POLICY_FLAX_FIRST,
    label: 'Flax first',
    hint: 'Preserves wool while a complete flax-and-water cycle is ready.',
  },
] as const;

export function normalizeWeaverInputPolicy(
  policy: number | undefined,
): WeaverInputPolicy {
  if (policy === WEAVER_INPUT_POLICY_WOOL_FIRST) {
    return WEAVER_INPUT_POLICY_WOOL_FIRST;
  }
  if (policy === WEAVER_INPUT_POLICY_FLAX_FIRST) {
    return WEAVER_INPUT_POLICY_FLAX_FIRST;
  }
  return WEAVER_INPUT_POLICY_AUTO;
}

export function weaverInputPolicyLabel(policy: number | undefined): string {
  const normalized = normalizeWeaverInputPolicy(policy);
  return WEAVER_INPUT_POLICY_PRESETS.find((preset) => preset.policy === normalized)?.label
    ?? 'Auto';
}

export function weaverUsesFlax(
  building: Pick<BuildingState, 'wool' | 'flax' | 'water' | 'weaverInputPolicy'>,
): boolean {
  const wool = Math.max(0, building.wool ?? 0);
  const flax = Math.max(0, building.flax ?? 0);
  const water = Math.max(0, building.water);
  const woolCycles = wool / Math.max(1e-6, WEAVER_WOOL_PER_CYCLE);
  const flaxCycles = Math.min(
    flax / Math.max(1e-6, WEAVER_FLAX_PER_CYCLE),
    water / Math.max(1e-6, WEAVER_FLAX_WATER_PER_CYCLE),
  );
  const woolReady = woolCycles + 1e-9 >= 1;
  const flaxReady = flaxCycles + 1e-9 >= 1;

  switch (normalizeWeaverInputPolicy(building.weaverInputPolicy)) {
    case WEAVER_INPUT_POLICY_WOOL_FIRST:
      return !woolReady && flaxReady;
    case WEAVER_INPUT_POLICY_FLAX_FIRST:
      return flaxReady || !woolReady;
    case WEAVER_INPUT_POLICY_AUTO:
    default:
      return (flax > 1e-6 && wool <= 1e-6)
        || flaxCycles > woolCycles + 1e-9;
  }
}
