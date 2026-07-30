import type { InspectableTarget } from '../types.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import { hiddenDemolish, hiddenLabor } from './renderInspectableTarget.ts';

export function renderQuarryInspector(
  target: Extract<InspectableTarget, { kind: 'quarry' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { definition, state } = target;
  const nearestRoad = context.worldQueries.getNearestRoadNodeDistance(
    definition.x,
    definition.z,
  );
  const isStone = definition.resource === 'stone';
  const resourceLabel = definition.resource === 'iron'
    ? 'iron ore'
    : definition.resource === 'salt'
      ? 'salt'
      : 'stone';

  return {
    eyebrow: state.isRich
      ? `Rich ${definition.resource} deposit`
      : `${definition.resource[0].toUpperCase()}${definition.resource.slice(1)} deposit`,
    title: definition.label,
    statusText: state.remaining > 0
      ? `${Math.round(state.remaining)} / ${Math.round(state.maxYield)} ${resourceLabel} reserve`
      : state.isRich
        ? `Surface exhausted — deep ${resourceLabel} remains available`
        : `Exhausted — no ${resourceLabel} left`,
    statusState: state.remaining > 0 || state.isRich ? 'active' : 'idle',
    detailsHtml: `
      <li><span>Nearest road</span><span>${nearestRoad == null ? 'None nearby' : `${nearestRoad.toFixed(1)} m`}</span></li>
      <li><span>Extraction</span><span>${isStone ? "Assign at a Stonecutter's Camp nearby" : 'Build a Mineral mine directly over this deposit'}</span></li>
      ${state.isRich ? `<li><span>Deep source</span><span>Rich · supports a ${isStone ? 'Large Quarry' : 'faster, non-exhausting Mineral mine'}</span></li>` : '<li><span>Reserve</span><span>Finite · imports remain available after exhaustion</span></li>'}
    `,
    demolish: hiddenDemolish(),
    labor: hiddenLabor(),
  };
}
