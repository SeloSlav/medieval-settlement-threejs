import type { Season } from '../world/seasonPolicy.ts';

export const SEASON_ALMANAC = {
  spring: {
    label: 'Spring',
    months: 'March–May',
    icon: '❀',
    description: 'Sow spring oats while crops, wells, forage, fishing, livestock, and apiaries recover, but expect slower dirt roads.',
  },
  summer: {
    label: 'Summer',
    months: 'June–August',
    icon: '☀',
    description: 'Harvest maturing crops and cut winter hay while livestock graze and apiaries build their honey crop.',
  },
  autumn: {
    label: 'Autumn',
    months: 'September–November',
    icon: '❧',
    description: 'Finish the harvest, collect apiary honey, and plough and sow winter fields by the end of November.',
  },
  winter: {
    label: 'Winter',
    months: 'December–February',
    icon: '❄',
    description: 'Most food production stops, so stock hay, Animal Feed, and firewood before carts slow and household fuel use doubles.',
  },
} as const satisfies Record<Season, {
  label: string;
  months: string;
  icon: string;
  description: string;
}>;

const SEVERE_WEATHER_SUMMER_DESCRIPTION =
  'Harvest crops and cut winter hay early, as drought can weaken crops, wells, pasture, fishing, hay, and mills.';

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
