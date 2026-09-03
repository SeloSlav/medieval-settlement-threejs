export const POTTER_FIRE_VESSELS = 0;
export const POTTER_FIRE_ROOF_TILES = 1;

export type PotterFiringPolicy =
  | typeof POTTER_FIRE_VESSELS
  | typeof POTTER_FIRE_ROOF_TILES;

export function normalizePotterFiringPolicy(value: number | undefined): PotterFiringPolicy {
  return value === POTTER_FIRE_ROOF_TILES
    ? POTTER_FIRE_ROOF_TILES
    : POTTER_FIRE_VESSELS;
}

export function potterFiringPolicyLabel(value: number | undefined): string {
  return normalizePotterFiringPolicy(value) === POTTER_FIRE_ROOF_TILES
    ? 'Fired roof tiles'
    : 'Household vessels';
}

export const POTTER_FIRING_POLICY_PRESETS = [
  {
    policy: POTTER_FIRE_VESSELS,
    label: 'Vessels',
    hint: 'Fire household vessels for Marketplaces and trade.',
  },
  {
    policy: POTTER_FIRE_ROOF_TILES,
    label: 'Roof tiles',
    hint: 'Fire clay roof tiles for homes and other buildings.',
  },
] as const;
