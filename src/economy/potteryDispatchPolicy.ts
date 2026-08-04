export const POTTERY_DISPATCH_HOUSEHOLDS_FIRST = 0;
export const POTTERY_DISPATCH_PRESERVATION_FIRST = 1;

export type PotteryDispatchPolicy =
  | typeof POTTERY_DISPATCH_HOUSEHOLDS_FIRST
  | typeof POTTERY_DISPATCH_PRESERVATION_FIRST;

export type PotteryDispatchDuty = 'market-stalls' | 'preservation' | 'export';

export const POTTERY_DISPATCH_POLICY_PRESETS: readonly {
  policy: PotteryDispatchPolicy;
  label: string;
  hint: string;
}[] = [
  {
    policy: POTTERY_DISPATCH_HOUSEHOLDS_FIRST,
    label: 'Market wares first',
    hint: 'Send wares to a staffed storehouse for market stalls, then stage smokehouse vessels, then export.',
  },
  {
    policy: POTTERY_DISPATCH_PRESERVATION_FIRST,
    label: 'Preservation first',
    hint: 'Stage smokehouse vessels, then send wares to a staffed storehouse, then export.',
  },
];

export function isPotteryDispatchPolicy(
  policy: number | null | undefined,
): policy is PotteryDispatchPolicy {
  return policy === POTTERY_DISPATCH_HOUSEHOLDS_FIRST
    || policy === POTTERY_DISPATCH_PRESERVATION_FIRST;
}

export function normalizePotteryDispatchPolicy(
  policy: number | null | undefined,
): PotteryDispatchPolicy {
  return isPotteryDispatchPolicy(policy)
    ? policy
    : POTTERY_DISPATCH_HOUSEHOLDS_FIRST;
}

export function potteryDispatchOrder(
  policy: number | null | undefined,
): readonly PotteryDispatchDuty[] {
  return normalizePotteryDispatchPolicy(policy)
    === POTTERY_DISPATCH_PRESERVATION_FIRST
    ? ['preservation', 'market-stalls', 'export']
    : ['market-stalls', 'preservation', 'export'];
}

export function potteryDispatchPolicyLabel(
  policy: number | null | undefined,
): string {
  return normalizePotteryDispatchPolicy(policy)
    === POTTERY_DISPATCH_PRESERVATION_FIRST
    ? 'Preservation first'
    : 'Market wares first';
}
