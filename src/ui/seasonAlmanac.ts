import type { Season } from '../world/seasonPolicy.ts';

export const SEASON_ALMANAC = {
  spring: {
    label: 'Spring',
    months: 'March–May',
    icon: '❀',
    description: 'Spring rain speeds crop growth and improves shallow-well recharge, but slows dirt roads. Berries and mushrooms regrow, fish recover, and livestock breed faster.',
  },
  summer: {
    label: 'Summer',
    months: 'June–August',
    icon: '☀',
    description: 'Crops mature while haymaking and shearing peak, and homes use less fuel.',
  },
  autumn: {
    label: 'Autumn',
    months: 'September–November',
    icon: '❧',
    description: 'Finish the late harvest, then plough and sow winter crops in October–November.',
  },
  winter: {
    label: 'Winter',
    months: 'December–February',
    icon: '❄',
    description: 'Berries, mushrooms, fishing, field work, and shearing stop. Frozen roads slow carts, while heated homes need twice their normal fuel.',
  },
} as const satisfies Record<Season, {
  label: string;
  months: string;
  icon: string;
  description: string;
}>;

const SEVERE_WEATHER_SUMMER_DESCRIPTION =
  'Crops mature while haymaking and shearing peak, and homes use less fuel. Drought may slow crops, cut well recharge, thin pasture and fish, and weaken mills.';

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
