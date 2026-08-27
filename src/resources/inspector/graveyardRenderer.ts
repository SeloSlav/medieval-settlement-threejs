import type { InspectableTarget } from '../types.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import { hiddenLabor } from './renderInspectableTarget.ts';

export function renderGraveyardInspector(
  target: Extract<InspectableTarget, { kind: 'graveyard' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { graveyard, chapel } = target;
  const capacity = Math.max(0, Math.floor(graveyard.capacity));
  const burials = Math.max(0, Math.min(capacity, Math.floor(graveyard.burials)));
  const available = Math.max(0, capacity - burials);
  let incoming = 0;
  for (const corpse of context.gameState.corpses.values()) {
    if (corpse.graveyardId === graveyard.id && corpse.state !== 0) incoming += 1;
  }
  const removable = burials === 0 && incoming === 0;

  return {
    eyebrow: 'Consecrated church parcel',
    title: 'Burial ground',
    statusText: capacity <= 0
      ? 'No grave spots available'
      : available <= 0
        ? `Full · ${burials} dead resting here`
        : burials <= 0 && incoming <= 0
          ? `${capacity} grave spots ready`
          : `${available} grave spot${available === 1 ? '' : 's'} remain${incoming > 0 ? ` · ${incoming} incoming` : ''}`,
    statusState: capacity <= 0 || available <= 0 ? 'warning' : burials > 0 || incoming > 0 ? 'active' : 'idle',
    detailsHtml: `
      <li><span>Total grave spots</span><strong>${capacity}</strong></li>
      <li><span>Dead resting here</span><strong>${burials}</strong></li>
      <li><span>Open grave spots</span><span>${available}</span></li>
      ${incoming > 0 ? `<li><span>Incoming burials</span><span>${incoming}</span></li>` : ''}
      <li><span>Linked church</span><span>${chapel ? context.worldQueries.getBuildingLabel(chapel.kind) : 'Missing'}</span></li>
    `,
    demolish: {
      visible: removable,
      label: 'Remove burial ground',
      hint: 'Removes this empty consecrated parcel. Grounds containing burials or reserved for an incoming body cannot be removed.',
    },
    labor: hiddenLabor(),
  };
}
