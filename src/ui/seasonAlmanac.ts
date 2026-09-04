import type { Season } from '../world/seasonPolicy.ts';

export const SEASON_ALMANAC = {
  spring: {
    label: 'Spring',
    months: 'March–May',
    icon: '❀',
    description: 'Sow spring oats and use the faster crop growth and well recharge, but expect slower dirt roads. Forage and fish recover, livestock breed faster, and apiaries begin storing their Autumn honey crop.',
  },
  summer: {
    label: 'Summer',
    months: 'June–August',
    icon: '☀',
    description: 'Harvest maturing crops and cut winter hay while livestock graze and apiaries build their honey crop. Shearing peaks, and homes use less fuel.',
  },
  autumn: {
    label: 'Autumn',
    months: 'September–November',
    icon: '❧',
    description: 'Finish crops and collect apiary honey, then plough and sow winter fields by November. Thresh oat sheaves into oats; pastoral farmsteads turn them into Animal Feed, while woodland pigs thrive on mast.',
  },
  winter: {
    label: 'Winter',
    months: 'December–February',
    icon: '❄',
    description: 'Foraging, fishing, farming, apiary work, shearing, and milking stop; unharvested honey is lost. Stock hay, Animal Feed, and firewood: winter slows carts and doubles home fuel use.',
  },
} as const satisfies Record<Season, {
  label: string;
  months: string;
  icon: string;
  description: string;
}>;

const SEVERE_WEATHER_SUMMER_DESCRIPTION =
  'Harvest maturing crops and cut winter hay while livestock graze and apiaries build their honey crop. Drought may slow crops, cut well recharge, thin pasture and fish, reduce hay, and weaken mills.';

function buildSeasonAlmanacTooltip(severeWeatherEnabled: boolean): string {
  return Object.values(SEASON_ALMANAC)
    .map(({ icon, label, months, description }) => (
      `${icon} ${label} (${months}) — ${
        label === 'Summer' && severeWeatherEnabled
          ? SEVERE_WEATHER_SUMMER_DESCRIPTION
          : description
      }`
    ))
    .join(' · ');
}

const STANDARD_SEASON_ALMANAC_TOOLTIP = buildSeasonAlmanacTooltip(false);
const SEVERE_SEASON_ALMANAC_TOOLTIP = buildSeasonAlmanacTooltip(true);

export function seasonAlmanacTooltip(severeWeatherEnabled: boolean): string {
  return severeWeatherEnabled
    ? SEVERE_SEASON_ALMANAC_TOOLTIP
    : STANDARD_SEASON_ALMANAC_TOOLTIP;
}
