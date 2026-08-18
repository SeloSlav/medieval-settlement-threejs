export type PantrySafeguardPolicyCode = 0 | 1 | 2;

export const PANTRY_MARKET_DAY_ONLY: PantrySafeguardPolicyCode = 0;
export const PANTRY_ONE_DAY_SAFEGUARD: PantrySafeguardPolicyCode = 1;
export const PANTRY_TWO_DAY_SAFEGUARD: PantrySafeguardPolicyCode = 2;
export const DEFAULT_PANTRY_SAFEGUARD_POLICY = PANTRY_ONE_DAY_SAFEGUARD;

export type PantrySafeguardPolicyOption = {
  value: PantrySafeguardPolicyCode;
  label: string;
  hint: string;
};

export const PANTRY_SAFEGUARD_POLICY_OPTIONS: readonly PantrySafeguardPolicyOption[] = [
  {
    value: PANTRY_MARKET_DAY_ONLY,
    label: 'Market day only',
    hint: 'Homes receive their ordinary weekly issue. There is no daily food or fuel safeguard.',
  },
  {
    value: PANTRY_ONE_DAY_SAFEGUARD,
    label: 'One-day safeguard',
    hint: 'If covered food or fuel falls below one household day, markets automatically restore up to two days.',
  },
  {
    value: PANTRY_TWO_DAY_SAFEGUARD,
    label: 'Two-day safeguard',
    hint: 'If covered food or fuel falls below two household days, markets automatically restore up to three days.',
  },
] as const;

export function normalizePantrySafeguardPolicy(
  value: number | null | undefined,
): PantrySafeguardPolicyCode {
  return value === PANTRY_MARKET_DAY_ONLY || value === PANTRY_TWO_DAY_SAFEGUARD
    ? value
    : DEFAULT_PANTRY_SAFEGUARD_POLICY;
}

export function pantrySafeguardPolicyOption(
  policy: PantrySafeguardPolicyCode,
): PantrySafeguardPolicyOption {
  return PANTRY_SAFEGUARD_POLICY_OPTIONS.find((option) => option.value === policy)
    ?? PANTRY_SAFEGUARD_POLICY_OPTIONS[1];
}
