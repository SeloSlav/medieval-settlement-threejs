import {
  SPINNING_RETTING_FLAX_PER_CYCLE,
  SPINNING_RETTING_FLAX_WATER_PER_CYCLE,
  SPINNING_RETTING_WOOL_PER_CYCLE,
  WEAVER_LINEN_PER_CYCLE,
  WEAVER_YARN_PER_CYCLE,
} from '../generated/gameBalance.ts';
import type { BuildingState } from '../resources/types.ts';

export const WEAVER_INPUT_POLICY_AUTO = 0;
export const WEAVER_INPUT_POLICY_WOOL_FIRST = 1;
export const WEAVER_INPUT_POLICY_FLAX_FIRST = 2;

export type WeaverInputPolicy =
  | typeof WEAVER_INPUT_POLICY_AUTO
  | typeof WEAVER_INPUT_POLICY_WOOL_FIRST
  | typeof WEAVER_INPUT_POLICY_FLAX_FIRST;

export type WeaverFibreCommodity = 'wool' | 'flax' | 'yarn' | 'linen';

export const SPINNING_RETTING_INPUT_POLICY_PRESETS = [
  {
    policy: WEAVER_INPUT_POLICY_AUTO,
    label: 'Auto',
    hint: 'Shares raw-fibre carts and well service normally, using the route with the most complete cycles already staged.',
  },
  {
    policy: WEAVER_INPUT_POLICY_WOOL_FIRST,
    label: 'Yarn',
    hint: 'Spin wool into yarn only. Flax and water may still be stored for a later recipe change.',
  },
  {
    policy: WEAVER_INPUT_POLICY_FLAX_FIRST,
    label: 'Linen',
    hint: 'Ret flax into linen only. Wool may still be stored for a later recipe change.',
  },
] as const;

export const WEAVER_INPUT_POLICY_PRESETS = [
  {
    policy: WEAVER_INPUT_POLICY_AUTO,
    label: 'Auto',
    hint: 'Shares prepared-fibre carts normally, using the route with the most complete cycles already staged.',
  },
  {
    policy: WEAVER_INPUT_POLICY_WOOL_FIRST,
    label: 'Yarn clothing',
    hint: 'Weave clothing from yarn only. Linen may still be stored for a later recipe change.',
  },
  {
    policy: WEAVER_INPUT_POLICY_FLAX_FIRST,
    label: 'Linen clothing',
    hint: 'Weave clothing from linen only. Yarn may still be stored for a later recipe change.',
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

export function spinningRettingInputPolicyLabel(policy: number | undefined): string {
  const normalized = normalizeWeaverInputPolicy(policy);
  return SPINNING_RETTING_INPUT_POLICY_PRESETS.find(
    (preset) => preset.policy === normalized,
  )?.label ?? 'Auto';
}

/**
 * Lower ranks win when equal-priority textile processors compete for one cart.
 * Policy route 1 means wool at the spinner and yarn at the Weaver; route 2
 * means flax at the spinner and linen at the Weaver. Auto remains neutral.
 */
export function weaverFibreDeliveryPreferenceRank(
  policy: number | undefined,
  commodity: WeaverFibreCommodity,
): number {
  const normalized = normalizeWeaverInputPolicy(policy);
  if (normalized === WEAVER_INPUT_POLICY_AUTO) return 1;
  const matches = commodity === 'wool' || commodity === 'yarn'
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
      return `${commodity === 'wool' || commodity === 'flax'
        ? spinningRettingInputPolicyLabel(policy)
        : weaverInputPolicyLabel(policy)} match`;
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
  const woolCycles = wool / Math.max(1e-6, SPINNING_RETTING_WOOL_PER_CYCLE);
  const flaxCycles = Math.min(
    flax / Math.max(1e-6, SPINNING_RETTING_FLAX_PER_CYCLE),
    water / Math.max(1e-6, SPINNING_RETTING_FLAX_WATER_PER_CYCLE),
  );
  switch (normalizeWeaverInputPolicy(building.weaverInputPolicy)) {
    case WEAVER_INPUT_POLICY_WOOL_FIRST:
      return false;
    case WEAVER_INPUT_POLICY_FLAX_FIRST:
      return true;
    case WEAVER_INPUT_POLICY_AUTO:
    default:
      return (flax > 1e-6 && wool <= 1e-6)
        || flaxCycles > woolCycles + 1e-9;
  }
}

export function weaverUsesLinen(
  building: Pick<BuildingState, 'yarn' | 'linen' | 'weaverInputPolicy'>,
): boolean {
  const yarn = Math.max(0, building.yarn ?? 0);
  const linen = Math.max(0, building.linen ?? 0);
  const yarnCycles = yarn / Math.max(1e-6, WEAVER_YARN_PER_CYCLE);
  const linenCycles = linen / Math.max(1e-6, WEAVER_LINEN_PER_CYCLE);
  switch (normalizeWeaverInputPolicy(building.weaverInputPolicy)) {
    case WEAVER_INPUT_POLICY_WOOL_FIRST:
      return false;
    case WEAVER_INPUT_POLICY_FLAX_FIRST:
      return true;
    case WEAVER_INPUT_POLICY_AUTO:
    default:
      return (linen > 1e-6 && yarn <= 1e-6)
        || linenCycles > yarnCycles + 1e-9;
  }
}
