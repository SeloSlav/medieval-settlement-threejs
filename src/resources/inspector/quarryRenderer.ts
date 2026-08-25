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
  const resourceLabel = definition.resource === 'iron'
    ? 'iron ore'
    : definition.resource === 'salt'
      ? 'salt'
      : definition.resource === 'clay'
        ? 'clay'
        : 'stone';
  const deepWorksiteInstruction = definition.resource === 'stone'
    ? 'center a timber-supported Quarry on this node'
    : 'center timber-supported Mineworks on this node';

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
      <li><span>Surface extraction</span><span>Place a Mining Pit nearby · finite ${resourceLabel} reserve</span></li>
      ${state.isRich ? `<li><span>Underground source</span><span>Does not deplete · ${deepWorksiteInstruction}</span></li>` : '<li><span>Underground source</span><span>None · imports remain available after surface exhaustion</span></li>'}
    `,
    demolish: hiddenDemolish(),
    labor: hiddenLabor(),
  };
}
