import { buildingLandUseAffinities } from '../../regions/buildingLandUseAffinity.ts';
import type { LandUseProfile } from '../../regions/landUseProfile.ts';
import type { BuildingState } from '../types.ts';
import type { InspectorView } from './renderInspectableTarget.ts';

export function withBuildingLandUseAffinities(
  view: InspectorView,
  building: BuildingState,
  profile: LandUseProfile,
): InspectorView {
  const affinities = buildingLandUseAffinities(building.kind, profile);
  if (affinities.length === 0) return view;

  const icons = affinities.map((affinity) => {
    const share = formatPercent(affinity.share);
    const bonus = formatPercent(affinity.bonus);
    const title = `${affinity.label} · +${bonus}`;
    const detail = `${share} of the realm is ${affinity.kind}. This gives +${bonus} ${affinity.effect}. ${affinity.reason}`;
    return `<span class="land-use-affinity-token" data-land-use-kind="${affinity.kind}" tabindex="0" data-tooltip-title="${escapeHtml(title)}" data-tooltip="${escapeHtml(detail)}" aria-label="${escapeHtml(`${title}. ${detail}`)}">
      <span class="land-use-affinity-icon" aria-hidden="true"></span>
    </span>`;
  }).join('');

  return {
    ...view,
    headerAffinitiesHtml: icons,
  };
}

function formatPercent(value: number): string {
  return `${Math.round(Math.max(0, value) * 100)}%`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
