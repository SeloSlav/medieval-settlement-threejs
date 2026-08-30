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

  const combinedBonus = affinities.reduce(
    (multiplier, affinity) => multiplier * (1 + affinity.bonus),
    1,
  ) - 1;
  const combinedLabel = affinities.length > 1
    ? ` · +${formatPercent(combinedBonus)} combined`
    : '';
  const badges = affinities.map((affinity) => {
    const share = formatPercent(affinity.share);
    const bonus = formatPercent(affinity.bonus);
    const title = `${affinity.label} · +${bonus}`;
    const detail = `${share} of the realm is ${affinity.kind}. This gives +${bonus} ${affinity.effect}. ${affinity.reason} Placement inside the colored zone is not required.`;
    return `<span class="land-use-affinity-badge" data-land-use-kind="${affinity.kind}" tabindex="0" data-tooltip-title="${escapeHtml(title)}" data-tooltip="${escapeHtml(detail)}" aria-label="${escapeHtml(`${title}. ${detail}`)}">
      <span class="land-use-affinity-icon" aria-hidden="true"></span>
      <strong>+${bonus}</strong>
    </span>`;
  }).join('');

  return {
    ...view,
    detailsHtml: `
      <li data-land-use-affinities data-inspector-primary data-inspector-state="positive">
        <span>Realm benefits${combinedLabel}</span>
        <span class="land-use-affinity-strip" role="group" aria-label="Current realm-wide land-use benefits">${badges}</span>
      </li>
      ${view.detailsHtml}
    `,
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
