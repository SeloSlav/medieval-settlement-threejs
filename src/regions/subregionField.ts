export const SUBREGION_KINDS = [
  'meadow',
  'woodland',
  'farmland',
  'rural',
  'urban',
] as const;

export type SubregionKind = (typeof SUBREGION_KINDS)[number];

export type SubregionDefinition = {
  kind: SubregionKind;
  label: string;
  color: string;
  rgb: readonly [number, number, number];
  affinity: string;
  effect: string;
  maximumBonus: number;
};

export const SUBREGION_DEFINITIONS: readonly SubregionDefinition[] = [
  {
    kind: 'meadow',
    label: 'Meadow',
    color: '#d5b84f',
    rgb: [213, 184, 79],
    affinity: 'Pollination',
    effect: 'Realm-wide apiary pollination plus open grazing and haymaking',
    maximumBonus: 0.20,
  },
  {
    kind: 'woodland',
    label: 'Woodland',
    color: '#397148',
    rgb: [57, 113, 72],
    affinity: 'Forestry',
    effect: 'Realm-wide forestry, wild harvest, tree recovery, and swine pannage',
    maximumBonus: 0.18,
  },
  {
    kind: 'farmland',
    label: 'Farmland',
    color: '#b8783f',
    rgb: [184, 120, 63],
    affinity: 'Cultivation',
    effect: 'Realm-wide field harvest yield',
    maximumBonus: 0.15,
  },
  {
    kind: 'rural',
    label: 'Rural',
    color: '#83a35b',
    rgb: [131, 163, 91],
    affinity: 'Husbandry',
    effect: 'Realm-wide livestock capacity and husbandry support',
    maximumBonus: 0.12,
  },
  {
    kind: 'urban',
    label: 'Urban',
    color: '#8b6d88',
    rgb: [139, 109, 136],
    affinity: 'Industry',
    effect: 'Realm-wide workshop throughput',
    maximumBonus: 0.12,
  },
] as const;

export function subregionDefinition(kind: SubregionKind): SubregionDefinition {
  return SUBREGION_DEFINITIONS.find((definition) => definition.kind === kind)!;
}

/** Fraction of untouched natural land that begins as woodland. */
export function naturalWoodlandFraction(forestDensity: number): number {
  const density = Math.max(0, Math.min(100, Number.isFinite(forestDensity) ? forestDensity : 50));
  return 0.18 + density / 100 * 0.42;
}

/** Useful local classifier; the realm overlay quota-ranks this same forest signal. */
export const WOODLAND_FOREST_BLEND_MIN = 0.5;

export function naturalSubregionFromForestBlend(
  forestBlend: number,
): 'meadow' | 'woodland' {
  const safeBlend = Number.isFinite(forestBlend) ? forestBlend : 0;
  return safeBlend >= WOODLAND_FOREST_BLEND_MIN ? 'woodland' : 'meadow';
}
