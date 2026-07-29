import { formatResourceAmount } from '../yields.ts';
import type { InspectableTarget } from '../types.ts';
import type { InspectorView } from './renderInspectableTarget.ts';
import { hiddenDemolish, hiddenLabor } from './renderInspectableTarget.ts';

export function renderRiverInspector(
  target: Extract<InspectableTarget, { kind: 'river' }>,
): InspectorView {
  return {
    eyebrow: 'River',
    title: target.onWater ? 'Open water' : 'River access',
    statusText: target.onWater
      ? 'Shallow water — useful for wells and mills; armed foot units may ford.'
      : `Shoreline access (${target.shoreDistance.toFixed(1)} m from bank)`,
    statusState: 'active',
    detailsHtml: `
      <li><span>Resource</span><span>water</span></li>
      <li><span>On water</span><span>${target.onWater ? 'Yes' : 'No'}</span></li>
      <li><span>Shore distance</span><span>${target.shoreDistance.toFixed(1)} m</span></li>
      <li><span>Combat crossing</span><span>Raiders and guards may ford anywhere at 60% pace</span></li>
      <li><span>Cart crossing</span><span>Built road bridge required</span></li>
      <li><span>Stored water</span><span>${formatResourceAmount('water', 0)}</span></li>
    `,
    demolish: hiddenDemolish(),
    labor: hiddenLabor(),
  };
}
