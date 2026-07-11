import { formatResourceAmount } from '../yields.ts';
import type { InspectableTarget } from '../types.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import { hiddenDemolish, hiddenLabor } from './renderInspectableTarget.ts';

export function renderForagingInspector(
  target: Extract<InspectableTarget, { kind: 'foraging' }>,
  _context: InspectorRenderContext,
): InspectorView {
  const { definition, state } = target;
  const depleted = state.remaining <= 0;

  return {
    eyebrow: 'Wild harvest',
    title: definition.label,
    statusText: depleted
      ? 'Depleted — will return once the land recovers'
      : `${Math.round(state.remaining)} / ${Math.round(state.maxYield)} ${definition.resource} remaining`,
    statusState: depleted ? 'idle' : 'active',
    detailsHtml: `
      <li><span>Resource</span><span>${formatResourceAmount(definition.resource, state.remaining)}</span></li>
      <li><span>Harvest radius</span><span>${definition.pickRadius} m</span></li>
      <li><span>Location</span><span>${Math.round(definition.x)}, ${Math.round(definition.z)}</span></li>
    `,
    demolish: hiddenDemolish(),
    labor: hiddenLabor(),
  };
}
