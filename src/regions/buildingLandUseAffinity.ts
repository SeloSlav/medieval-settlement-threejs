import type { BuildingKind } from '../generated/gameBalance.ts';
import {
  meadowGrazingBonus,
  woodlandPannageBonus,
  woodlandWildHarvestBonus,
  type LandUseProfile,
} from './landUseProfile.ts';
import type { SubregionKind } from './subregionField.ts';

export type BuildingLandUseAffinity = {
  kind: SubregionKind;
  label: string;
  bonus: number;
  share: number;
  effect: string;
  reason: string;
};

const URBAN_WORKSHOP_KINDS = new Set<BuildingKind>([
  'charcoal_burner',
  'smithy',
  'weaponsmith_armorer',
  'bowyer_fletcher',
  'potter_kiln',
  'brewery',
  'smokehouse',
  'bakery',
  'carpenter',
  'spinning_retting_house',
  'weaver',
  'tannery',
  'cobbler',
  'chandlery',
]);

const FORESTRY_KINDS = new Set<BuildingKind>([
  'lumber_mill',
  'woodcutters_lodge',
  'reforester',
]);

const WILD_HARVEST_KINDS = new Set<BuildingKind>([
  'hunters_hall',
  'foragers_shed',
]);

export function buildingLandUseAffinities(
  kind: BuildingKind,
  profile: LandUseProfile,
): BuildingLandUseAffinity[] {
  const effects: BuildingLandUseAffinity[] = [];
  if (kind === 'apiary') {
    effects.push(effect(
      profile,
      'meadow',
      'Pollination',
      profile.bonuses.meadow,
      'apiary forage and pollination',
      'Flower-rich open country supports stronger colonies.',
    ));
  }
  if (kind === 'pastoral_farmstead') {
    effects.push(effect(
      profile,
      'meadow',
      'Open grazing',
      meadowGrazingBonus(profile),
      'grazing capacity and haymaking',
      'A larger meadow share provides more realm-wide grazing and hay knowledge.',
    ));
    effects.push(effect(
      profile,
      'rural',
      'Husbandry',
      profile.bonuses.rural,
      'grazing capacity and haymaking',
      'A larger rural economy supplies herding skill, fodder, and support.',
    ));
  }
  if (kind === 'swineherd') {
    effects.push(effect(
      profile,
      'woodland',
      'Mast and pannage',
      woodlandPannageBonus(profile),
      'pannage capacity',
      'A larger woodland share improves the realm-wide mast economy; local mature pasture trees still set the base capacity.',
    ));
    effects.push(effect(
      profile,
      'rural',
      'Husbandry',
      profile.bonuses.rural,
      'pannage capacity',
      'A larger rural economy supplies herding skill, fodder, and support.',
    ));
  }
  if (kind === 'threshing_barn') {
    effects.push(effect(
      profile,
      'farmland',
      'Cultivation',
      profile.bonuses.farmland,
      'linked field harvest yield',
      'More cultivated land spreads crop knowledge and specialist farm labor.',
    ));
  }
  if (FORESTRY_KINDS.has(kind)) {
    effects.push(effect(
      profile,
      'woodland',
      'Forestry',
      profile.bonuses.woodland,
      kind === 'reforester' ? 'tree recovery speed' : 'tree-work throughput',
      'A larger woodland share supplies mature forestry knowledge and woodland labor.',
    ));
  }
  if (WILD_HARVEST_KINDS.has(kind)) {
    effects.push(effect(
      profile,
      'woodland',
      'Wild abundance',
      woodlandWildHarvestBonus(profile),
      'hunting and foraging throughput',
      'A larger woodland share supports richer connected habitat and gathering knowledge.',
    ));
  }
  if (URBAN_WORKSHOP_KINDS.has(kind)) {
    effects.push(effect(
      profile,
      'urban',
      'Industry',
      profile.bonuses.urban,
      'workshop throughput',
      'A larger urban share deepens specialist trades, suppliers, and workshop practice.',
    ));
  }
  return effects;
}

function effect(
  profile: LandUseProfile,
  kind: SubregionKind,
  label: string,
  bonus: number,
  effectLabel: string,
  reason: string,
): BuildingLandUseAffinity {
  return {
    kind,
    label,
    bonus,
    share: profile.shares[kind],
    effect: effectLabel,
    reason,
  };
}
