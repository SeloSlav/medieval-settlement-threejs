import type { ResourceNodeKind } from '../resources/types.ts';

function resourceIconMarkup(kind: ResourceNodeKind): string {
  return `<span class="map-resource-icon-glyph map-resource-icon-glyph--${kind}" aria-hidden="true"></span>`;
}

export const QUARRY_ICON_HTML = resourceIconMarkup('quarry');
export const GAME_ICON_HTML = resourceIconMarkup('game');
export const BERRY_ICON_HTML = resourceIconMarkup('berries');
export const MUSHROOM_ICON_HTML = resourceIconMarkup('mushrooms');
export const FISH_ICON_HTML = resourceIconMarkup('fish');

/**
 * Canonical generated resource art shared by far-zoom map icons and minimap.
 * The atlas is authored at public/assets/ui/icons/map-resources.png.
 */
export const RESOURCE_MAP_ICON_HTML: Readonly<Record<ResourceNodeKind, string>> = {
  quarry: QUARRY_ICON_HTML,
  game: GAME_ICON_HTML,
  berries: BERRY_ICON_HTML,
  mushrooms: MUSHROOM_ICON_HTML,
  fish: FISH_ICON_HTML,
};
