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

export type WeaverFibreCommodity = 'wool' | 'flax';

export const WEAVER_INPUT_POLICY_PRESETS = [
  {
    policy: WEAVER_INPUT_POLICY_AUTO,
    label: 'Auto',
    hint: 'Shares fibre carts normally and uses the route with the most complete cycles already staged.',
  },
  {
    policy: WEAVER_INPUT_POLICY_WOOL_FIRST,
    label: 'Wool first',
    hint: 'Prioritizes wool carts and preserves flax while a complete dry wool cycle is ready.',
  },
  {
    policy: WEAVER_INPUT_POLICY_FLAX_FIRST,
    label: 'Flax first',
    hint: 'Prioritizes flax carts and preserves wool while a complete flax-and-water cycle is ready.',
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

/**
 * Lower ranks win when equal-priority active looms compete for one raw-fibre
 * cart. Auto remains a neutral middle pool; the opposite specialization stays
 * eligible as a fallback after matching working buffers are covered.
 */
export function weaverFibreDeliveryPreferenceRank(
  policy: number | undefined,
  commodity: WeaverFibreCommodity,
): number {
  const normalized = normalizeWeaverInputPolicy(policy);
  if (normalized === WEAVER_INPUT_POLICY_AUTO) return 1;
  const matches = commodity === 'wool'
    ? normalized === WEAVER_INPUT_POLICY_WOOL_FIRST
    : normalized === WEAVER_INPUT_POLICY_FLAX_FIRST;
  return matches ? 0 : 2;
}

export function weaverFibreDeliveryPreferenceLabel(
  policy: number | undefined,
  commodity: WeaverFibreCommodity,
): string {
  switch (weaverFibreDeliveryPreferenceRank(policy, commodity)) {
    case 0:
      return `${weaverInputPolicyLabel(policy)} match`;
    case 1:
      return 'Auto pool';
    default:
      return 'Fallback route';
  }
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
