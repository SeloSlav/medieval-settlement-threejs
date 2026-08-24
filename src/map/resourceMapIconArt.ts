import type { ResourceNodeKind } from '../resources/types.ts';

export type WorldResourceIconKind = ResourceNodeKind | 'clay' | 'iron' | 'salt';

function resourceIconMarkup(kind: WorldResourceIconKind): string {
  return `<span class="map-resource-icon-glyph map-resource-icon-glyph--${kind}" aria-hidden="true"></span>`;
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
 * Canonical resource markup shared by projected map icons and minimap markers.
 * CSS supplies the same normal/rich map-stamp art used by the inspector card.
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
