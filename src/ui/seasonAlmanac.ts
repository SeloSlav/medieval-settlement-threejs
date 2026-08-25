import type { Season } from '../world/seasonPolicy.ts';

export const SEASON_ALMANAC = {
  spring: {
    label: 'Spring',
    months: 'March–May',
    icon: '❀',
    description: 'Spring rain speeds crop growth and shallow-well recharge but slows dirt roads. Spring oats are sown; berries and mushrooms regrow, fish recover, and pasture livestock breed faster.',
  },
  summer: {
    label: 'Summer',
    months: 'June–August',
    icon: '☀',
    description: 'Crops mature while cattle and sheep graze, holdings cut local winter hay, shearing peaks, and homes use less fuel.',
  },
  autumn: {
    label: 'Autumn',
    months: 'September–November',
    icon: '❧',
    description: 'Finish the late harvest, then plough and sow winter crops in October–November. Oat sheaves become edible oats at threshing barns; staffed pastoral farmsteads turn those oats into stored Animal Feed. Woodland swine feed best on autumn mast.',
  },
  winter: {
    label: 'Winter',
    months: 'December–February',
    icon: '❄',
    description: 'Foraging, fishing, field work, and shearing stop. Pasture and mast thin: cattle and sheep use local hay before prepared Animal Feed, while pigs use remaining mast before Animal Feed. Livestock never eat raw grain; transport and production ox upkeep remains abstract. Frozen roads slow carts, while heated homes need twice their normal fuel.',
  },
} as const satisfies Record<Season, {
  label: string;
  months: string;
  icon: string;
  description: string;
}>;

const SEVERE_WEATHER_SUMMER_DESCRIPTION =
  'Crops mature while cattle and sheep graze, holdings cut local winter hay, shearing peaks, and homes use less fuel. Drought may slow crops, cut well recharge, thin pasture and fish, reduce hay, and weaken mills.';

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
