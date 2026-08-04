import {
  linkedRemoteWorkCamp,
  worksiteLodgingPolicy,
} from '../../buildings/remoteWorkCamp.ts';
import type { BuildingState, InspectableTarget } from '../types.ts';
import { fireForTarget } from '../../fires/fireIncident.ts';
import type {
  InspectorRenderContext,
  InspectorView,
} from './renderInspectableTarget.ts';
import { hiddenLabor } from './renderInspectableTarget.ts';

export function withWorksiteLodging(
  view: InspectorView,
  building: BuildingState,
  context: InspectorRenderContext,
): InspectorView {
  if (building.constructionComplete === false || building.kind === 'remote_work_camp') return view;
  const policy = worksiteLodgingPolicy(building.kind);
  if (policy === 'daily_commute') return view;

  const summary = context.getWorksiteCommuteSummary?.(building.id) ?? null;
  const camp = policy === 'buildable_camp'
    ? linkedRemoteWorkCamp(building.id, context.gameState.buildings.values())
    : null;
  const worksiteFire = fireForTarget(
    context.gameState.fireIncidents.values(),
    'building',
    building.id,
  );
  const campFire = camp
    ? fireForTarget(context.gameState.fireIncidents.values(), 'building', camp.id)
    : null;
  const lodgingActive = !worksiteFire && (
    policy === 'built_in'
    || camp?.constructionComplete !== false && camp != null && !campFire
  );
  const commute = !summary || summary.measuredWorkers === 0
    ? 'No housed crew route measured'
    : `${Math.round(summary.averageOneWayDistance)} m average Â· ${formatDisplayedDuration(
        summary.averageOneWaySeconds,
      )} one way Â· ${Math.round(summary.longestOneWayDistance)} m longest`;
  const authoritativeEfficiency = Math.max(
    0,
    Math.min(1, building.commuteEfficiency ?? summary?.effectiveShiftRatio ?? 1),
  );
  const effectiveShift = lodgingActive
    ? '100% productive shift Â· crew sleeps at the worksite'
    : building.commuteEfficiency != null || summary && summary.measuredWorkers > 0
      ? `${Math.round(authoritativeEfficiency * 100)}% productive shift after commute Â· ${summary && summary.measuredWorkers > 0 ? commuteBandLabel(summary.band) : 'daily workforce cache'}`
      : 'Awaiting the first daily workforce review';

  const panel = policy === 'built_in'
    ? `
      <section class="inspector-action-panel">
        <h3>Built-in crew lodging</h3>
        <p class="inspector-action-panel__hint">${worksiteFire
          ? 'The building and its bunks are fire-disabled. Its crew returns to household lodging until repairs are complete.'
          : 'This building is canonically a staffed hut, lodge, hall, camp, or farmstead. Its assigned crew uses the existing shelter automatically, gathering outside after work and sleeping inside before the next shift.'}</p>
      </section>
    `
    : camp
      ? `
        <section class="inspector-action-panel">
          <h3>Overnight work camp</h3>
          <p class="inspector-action-panel__hint">${campFire
            ? 'The linked camp is fire-disabled. Its crew resumes the household commute until the camp is repaired or cleared.'
            : camp.constructionComplete === false
            ? 'Builders and haulers are raising the linked tents and fire ring. The crew still commutes home until construction is complete.'
            : 'The linked tents and campfire are operational, restoring the worksite\'s full productive shift. Demolish the camp itself to return this crew to household commuting.'}</p>
          <button type="button" class="inspector-action-panel__button" data-inspect-building="${camp.id}">${camp.constructionComplete === false ? 'Inspect camp construction' : 'Inspect overnight camp'}</button>
        </section>
      `
      : `
        <section class="inspector-action-panel">
          <h3>Overnight work camp</h3>
          <button type="button" class="inspector-action-panel__button" data-begin-remote-work-camp>Plan overnight camp</button>
          <p class="inspector-action-panel__hint">Choose a nearby clear site. Timber and stone are reserved normally, haulers deliver them, and assigned builders raise two tents and a campfire. It can later be demolished like any building.</p>
        </section>
      `;

  const lodgingLabel = policy === 'built_in'
    ? 'Bunks inside the existing building'
    : campFire
      ? 'Linked camp fire-disabled Â· household commute active'
      : camp?.constructionComplete !== false && camp
      ? 'Linked tents and campfire'
      : camp
        ? 'Camp under construction Â· household commute remains active'
        : 'Assigned household or founders\' camp';
  return {
    ...view,
    detailsHtml: `${view.detailsHtml}
      <li><span>Household commute</span><span>${commute}</span></li>
      <li><span>Authoritative output labor</span><span>${effectiveShift}</span></li>
      <li><span>Night lodging</span><span>${lodgingLabel}</span></li>`,
    supplementalPanelHtml: `${view.supplementalPanelHtml ?? ''}${panel}`,
  };
}

export function renderRemoteWorkCampInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const worksite = building.linkedWorksiteId
    ? context.gameState.buildings.get(building.linkedWorksiteId) ?? null
    : null;
  const parentLabel = worksite
    ? context.worldQueries.getBuildingLabel(worksite.kind)
    : 'Former worksite';
  return {
    eyebrow: 'Crew lodging',
    title: 'Overnight work camp',
    statusText: worksite
      ? `Operational Â· serving ${parentLabel.toLocaleLowerCase()}`
      : 'Unlinked Â· available for demolition',
    statusState: worksite ? 'active' : 'warning',
    detailsHtml: `
      <li><span>Linked worksite</span><span>${parentLabel}${worksite ? ` <button type="button" class="inspector-jump-button" data-inspect-building="${worksite.id}" aria-label="Inspect linked worksite">Inspect</button>` : ''}</span></li>
      <li><span>Shelter</span><span>Two canvas-and-timber sleeping tents</span></li>
      <li><span>Night routine</span><span>Crew gathers at the fire, sleeps in the tents, and begins the next shift locally</span></li>
      <li><span>Economic effect</span><span>Restores the linked yard to a full productive shift while this camp is complete and fire-safe</span></li>
      <li><span>Households</span><span>Workers keep their assigned homes; this is seasonal work lodging, not permanent housing</span></li>
    `,
    demolish: {
      visible: true,
      label: 'Demolish overnight camp',
      hint: 'Reclaim its materials normally. The linked crew resumes its household commute.',
    },
    labor: hiddenLabor(),
  };
}

function formatDisplayedDuration(simulationSeconds: number): string {
  const displayedMinutes = Math.max(0, simulationSeconds) * 12;
  if (displayedMinutes < 60) return `${Math.max(1, Math.round(displayedMinutes))} min`;
  const hours = Math.floor(displayedMinutes / 60);
  const minutes = Math.round(displayedMinutes % 60);
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function commuteBandLabel(band: 'short' | 'long' | 'severe'): string {
  if (band === 'short') return 'short commute';
  if (band === 'long') return 'long commute';
  return 'severe commute Â· nearby housing or a camp recommended';
}
