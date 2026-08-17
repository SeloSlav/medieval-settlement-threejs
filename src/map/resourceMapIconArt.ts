import type { ResourceNodeKind } from '../resources/types.ts';

export type WorldResourceIconKind = ResourceNodeKind | 'clay' | 'iron' | 'salt';

function resourceIconMarkup(kind: WorldResourceIconKind): string {
  return `
    <span class="map-resource-icon-glyph map-resource-icon-glyph--${kind}" aria-hidden="true"></span>
    <svg class="rich-resource-crown" viewBox="0 0 44 26" aria-hidden="true" focusable="false">
      <path class="rich-resource-crown__body" d="M5 22l2.5-9 7.5 6 7-12 7 12 7.5-6 2.5 9c-8.5-4.8-25.5-4.8-34 0Z"></path>
      <path class="rich-resource-crown__rim" d="M6 21.5c8-4 24-4 32 0"></path>
    </svg>
  `;
}

export const QUARRY_ICON_HTML = resourceIconMarkup('quarry');
export const GAME_ICON_HTML = resourceIconMarkup('game');
export const BERRY_ICON_HTML = resourceIconMarkup('berries');
export const MUSHROOM_ICON_HTML = resourceIconMarkup('mushrooms');
export const FISH_ICON_HTML = resourceIconMarkup('fish');
export const CLAY_ICON_HTML = resourceIconMarkup('clay');
export const IRON_ICON_HTML = resourceIconMarkup('iron');
export const SALT_ICON_HTML = resourceIconMarkup('salt');

/**
 * Canonical generated resource art shared by far-zoom map icons and minimap.
 * The atlas is authored at public/assets/ui/icons/map-resources.png.
 */
export const RESOURCE_MAP_ICON_HTML: Readonly<Record<WorldResourceIconKind, string>> = {
  quarry: QUARRY_ICON_HTML,
  game: GAME_ICON_HTML,
  berries: BERRY_ICON_HTML,
  mushrooms: MUSHROOM_ICON_HTML,
  fish: FISH_ICON_HTML,
  clay: CLAY_ICON_HTML,
  iron: IRON_ICON_HTML,
  salt: SALT_ICON_HTML,
};
