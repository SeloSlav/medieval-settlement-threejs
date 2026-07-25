/**
 * Adapted from Game-icons.net for small map-marker use.
 *
 * - Stone pile by Delapouite
 * - Deer head by Caro Asercion
 * - Berry bush by Delapouite
 * - Fish silhouette drawn in-project
 * - Mushroom silhouette drawn in-project
 *
 * The original black square backgrounds were removed, the quarry and berry
 * artwork was redrawn as low-detail silhouettes, and every glyph now inherits
 * the marker's currentColor. See public/assets/third-party/game-icons-LICENSE.txt.
 */
import type { ResourceNodeKind } from '../resources/types.ts';

export const QUARRY_ICON_SVG = `
  <svg class="map-resource-icon-glyph quarry-map-icon-glyph" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M4.8 18.6 7 14.1l3.3.8 2.2-3.5 3.8.8 3.2 6.4H4.8Z"/>
    <path fill="currentColor" d="M4.7 5.4C8.2 2.8 15 2.5 19.4 5.2L18 7.3c-1.8-1-3.4-1.4-4.8-1.4L7 18.4l-2.2-1.1 6-11.6C9 5.9 7.5 6.5 6.1 7.5L4.7 5.4Z"/>
  </svg>
`.trim();

export const GAME_ICON_SVG = `
  <svg class="map-resource-icon-glyph foraging-map-icon-glyph foraging-map-icon-glyph--game" viewBox="36 18 440 476" aria-hidden="true">
    <path fill="currentColor" d="M155.2 25.2c-58.44 28-81.24 63.4-77.16 96.6 1.77 14.5 8.78 28.8 20.67 42.4-19.59-12.8-30.66-26.7-36.15-40.5-14.71-37 11.66-71.4 11.66-71.4L60.96 42.2s-31.94 42.2-13.88 87.7c6.5 16.3 19.6 33.4 43.74 48.8.49.3.34.2.49.3 4.86 3.1 10.19 6.2 15.99 9.1 45.6 27.1 64.4 48.4 64.4 48.4l5.7 6.4 26.7-24.9-4.8-6s-19-24.3-19.2-57.7l-16.7-.2-.9 35.7c-40.3-19.4-64.71-43.9-67.92-70C91.14 91.7 113 63.9 162.4 40.2zm201.6 0-7.2 15c49.4 23.7 71.3 51.5 67.8 79.6-3.2 26.1-27.6 50.6-67.9 70l-.9-35.7-16.7.2c-.2 33.4-19.2 57.7-19.2 57.7l-4.8 6 26.7 24.9 5.7-6.4s18.8-21.3 64.4-48.4c5.9-3 11.6-6.3 16.5-9.4 24.1-15.4 37.2-32.5 43.7-48.8C483 84.4 451 42.2 451 42.2l-13.2 10.1s26.4 34.4 11.6 71.4c-5.5 13.8-16.5 27.7-36.1 40.5 11.9-13.6 18.9-27.9 20.7-42.4 4-33.2-18.8-68.6-77.2-96.6zM221.9 228l-38.4 34.8c-63.3-26.7-138.65-24.6-138.65-24.6 24.89 103 105.05 92.2 105.05 92.2s3.3 15.3 6.8 31.2c4.9 22.8 18.1 43 37.1 56.2 0 0 5.1 14 10.4 28 7.5 19 23.9 34 44.1 39 4.6 1 7.7 2 7.7 2s3.1-1 7.7-2c20.2-5 36.6-20 44.1-39 5.3-14 10.4-28 10.4-28 19-13.2 32.2-33.4 37.1-56.2 3.5-15.9 6.8-31.2 6.8-31.2s80.2 10.8 105.1-92.2c0 0-75.4-2.1-138.7 24.6L290.1 228l-34.1 4.4zm-32 104.3c13.7-.2 34.6 5.3 39.7 39.7-42.1 34.8-44.8-26.5-44.8-26.5l-7.3-11.3s5.2-1.7 12.4-1.9zm132.2 0c7.2.2 12.4 1.9 12.4 1.9l-7.3 11.3s-2.7 61.3-44.8 26.5c5.1-34.4 26-39.9 39.7-39.7zm-69.6 99.5h3.5c38.7-1 20.9 15 20.9 15-.8-11-12.1-10-12.1 1 0 6 6.6 12 16.5 9 0 0-5.6 15-25.1 16h-.4c-19.5-1-25.1-16-25.1-16 9.9 3 16.5-3 16.5-9 0-11-11.3-12-12.1-1 0 0-16.7-15 17.4-15z"/>
  </svg>
`.trim();

export const BERRY_ICON_SVG = `
  <svg class="map-resource-icon-glyph foraging-map-icon-glyph foraging-map-icon-glyph--berries" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M11.5 8.4c.4-3.1 2.7-4.9 6.3-4.6-.6 3-2.7 4.6-6.3 4.6Z"/>
    <path fill="currentColor" d="M12.4 8c-2.2-.2-3.8-1.2-4.9-3 2.6-.4 4.5.6 5.6 2.8l-.7.2Z"/>
    <path d="m12.4 7.5 1.1 2.1" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.7"/>
    <circle cx="8" cy="11.8" r="2.45" fill="currentColor"/>
    <circle cx="14.1" cy="11.1" r="2.5" fill="currentColor"/>
    <circle cx="10.8" cy="16.6" r="2.55" fill="currentColor"/>
    <circle cx="16.5" cy="16.2" r="2.35" fill="currentColor"/>
  </svg>
`.trim();

export const MUSHROOM_ICON_SVG = `
  <svg class="map-resource-icon-glyph foraging-map-icon-glyph foraging-map-icon-glyph--mushrooms" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M3.2 11.1C3.8 6.3 7.2 3.6 12 3.6s8.2 2.7 8.8 7.5c-2.6-.8-5.6-1.2-8.8-1.2s-6.2.4-8.8 1.2Z"/>
    <path fill="currentColor" d="M9.7 10.2h4.6c-.5 2.1-.4 4.1.3 6.2.5 1.6-.3 3.6-2.6 3.6s-3.1-2-2.6-3.6c.7-2.1.8-4.1.3-6.2Z"/>
    <circle cx="8" cy="7.6" r="1" fill="var(--panel, #171915)"/>
    <circle cx="13.4" cy="6.3" r=".85" fill="var(--panel, #171915)"/>
    <circle cx="16.4" cy="8.5" r=".7" fill="var(--panel, #171915)"/>
  </svg>
`.trim();

export const FISH_ICON_SVG = `
  <svg class="map-resource-icon-glyph foraging-map-icon-glyph foraging-map-icon-glyph--fish" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M3.2 6.4c2.4.6 4 1.6 5 3 2.4-2.1 5.1-3.2 8-3.2 2.1 0 3.7.9 4.8 2.7-1.1 1.8-2.7 2.7-4.8 2.7-2.9 0-5.6-1.1-8-3.2-1 1.4-2.6 2.4-5 3 .7-1.8.7-3.2 0-5Z" transform="translate(0 2.5)"/>
    <circle cx="17.2" cy="11.4" r="1" fill="var(--panel, #171915)"/>
  </svg>
`.trim();

/**
 * Canonical resource glyphs shared by the far-zoom map icons and minimap.
 */
export const RESOURCE_MAP_ICON_SVG: Readonly<Record<ResourceNodeKind, string>> = {
  quarry: QUARRY_ICON_SVG,
  game: GAME_ICON_SVG,
  berries: BERRY_ICON_SVG,
  mushrooms: MUSHROOM_ICON_SVG,
  fish: FISH_ICON_SVG,
};
