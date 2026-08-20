import type { SettlementMapMarkerTier } from './settlementMapMarker.ts';

const SVG_START = '<svg class="settlement-map-icon-art" viewBox="0 0 64 52" aria-hidden="true" focusable="false">';
const SVG_END = '</svg>';

export const SETTLEMENT_MAP_ICON_HTML: Record<SettlementMapMarkerTier, string> = {
  founders: `${SVG_START}
    <path class="settlement-map-icon-art__wash" d="M5 43 Q18 39 31 42 T59 42 L59 47 L5 47 Z"/>
    <path d="M7 42 L18 20 L31 42 Z M18 20 L18 42 M12 42 L18 32 L24 42"/>
    <path d="M35 42 L44 27 L55 42 Z M44 27 L44 42"/>
    <path d="M28 43 q3-7 6 0 q-3 3-6 0 Z M31 36 q-4-4 0-8 q4-4 1-8"/>
    <path class="settlement-map-icon-art__ground" d="M4 45 Q17 42 30 45 T60 44"/>
  ${SVG_END}`,
  hamlet: `${SVG_START}
    <path class="settlement-map-icon-art__wash" d="M4 43 Q18 39 31 42 T60 42 L60 48 L4 48 Z"/>
    <path d="M20 43 V26 L32 15 L44 26 V43 M17 27 L32 12 L47 27 M28 43 V33 H36 V43"/>
    <path d="M5 43 V35 L12 29 L19 35 V43 M3 36 L12 27 L21 36 M47 43 V35 L54 30 L61 35 V43 M45 36 L54 28 L63 36"/>
    <path d="M24 29 H28 V33 H24 Z M36 29 H40 V33 H36 Z"/>
    <path class="settlement-map-icon-art__ground" d="M3 45 Q16 42 31 45 T61 44"/>
  ${SVG_END}`,
  village: `${SVG_START}
    <path class="settlement-map-icon-art__wash" d="M3 42 Q18 38 32 41 T61 41 L61 48 L3 48 Z"/>
    <path d="M21 43 V24 L32 14 L43 24 V43 M18 25 L32 11 L46 25 M28 43 V32 H36 V43"/>
    <path d="M27 17 V8 H37 V17 M25 9 H39 M32 8 V4 M32 4 l7 2-7 2"/>
    <path d="M3 43 V35 L10 30 L18 35 V43 M1 36 L10 28 L20 36 M46 43 V34 L54 28 L62 34 V43 M44 35 L54 26 L64 35"/>
    <path d="M9 43 V38 H13 V43 M52 43 V37 H56 V43 M24 28 H28 V32 H24 Z M36 28 H40 V32 H36 Z"/>
    <path class="settlement-map-icon-art__ground" d="M2 45 Q17 41 31 45 T62 44"/>
  ${SVG_END}`,
  town: `${SVG_START}
    <path class="settlement-map-icon-art__wash" d="M2 42 Q17 37 32 41 T62 41 L62 49 L2 49 Z"/>
    <path d="M20 43 V23 L32 13 L44 23 V43 M17 24 L32 9 L47 24 M27 43 V31 H37 V43"/>
    <path d="M26 15 V6 H38 V15 M24 7 H40 M32 6 V2 M32 2 l8 2-8 2"/>
    <path d="M1 43 V34 L8 29 L16 34 V43 M0 35 L8 27 L18 35 M48 43 V34 L56 28 L63 34 V43 M46 35 L56 26 L64 35"/>
    <path d="M10 43 V37 L15 33 L20 37 V43 M8 38 L15 31 L22 38 M42 43 V37 L48 33 L53 37 V43 M40 38 L48 31 L55 38"/>
    <path d="M5 43 V38 H10 V43 M54 43 V37 H59 V43 M28 26 H31 V30 H28 Z M35 26 H38 V30 H35 Z"/>
    <path class="settlement-map-icon-art__ground" d="M1 45 Q16 40 31 45 T63 44"/>
  ${SVG_END}`,
};
