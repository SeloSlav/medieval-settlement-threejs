import type { SettlementMapMarkerTier } from './settlementMapMarker.ts';

const WOODCUT_CAMP_ICON = '<span class="settlement-map-icon-art settlement-map-icon-art--woodcut gk-icon gk-icon--construction gk-icon--camp" aria-hidden="true"></span>';
const WOODCUT_COMMUNITY_ICON = '<span class="settlement-map-icon-art settlement-map-icon-art--woodcut gk-icon gk-icon--construction gk-icon--town-hall" aria-hidden="true"></span>';

export const SETTLEMENT_MAP_ICON_HTML: Record<SettlementMapMarkerTier, string> = {
  founders: WOODCUT_CAMP_ICON,
  hamlet: WOODCUT_COMMUNITY_ICON,
  village: WOODCUT_COMMUNITY_ICON,
  town: WOODCUT_COMMUNITY_ICON,
};
