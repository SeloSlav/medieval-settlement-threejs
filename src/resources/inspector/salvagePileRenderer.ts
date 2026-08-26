import {
  cargoKindLabel,
  formatTripPhaseLabel,
} from '../../logistics/deliveryTrips.ts';
import type { InspectableTarget } from '../types.ts';
import { buildingLocalStorageItems } from './buildingLocalStorageRenderer.ts';
import {
  hiddenDemolish,
  hiddenLabor,
  type InspectorRenderContext,
  type InspectorView,
} from './renderInspectableTarget.ts';

export function renderSalvagePileInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const activeTrip = context.worldQueries.getActiveDeliveryTrip(building);
  const roadAccess = context.worldQueries.getRoadAccessLabel(building.x, building.z);
  const totalStock = buildingLocalStorageItems(building).reduce(
    (total, item) => total + item.amount,
    0,
  );
  const destination = activeTrip?.targetBuildingId
    ? context.worldQueries.getBuilding(activeTrip.targetBuildingId)
    : null;
  const activeHaul = activeTrip
    ? `${cargoKindLabel(activeTrip.cargoKind)} → ${
      destination
        ? context.worldQueries.getBuildingLabel(destination.kind)
        : 'connected storage'
    } · ${formatTripPhaseLabel(activeTrip.phase)}`
    : 'None';
  const status = activeTrip
    ? [`Recovering ${cargoKindLabel(activeTrip.cargoKind).toLocaleLowerCase()}`, 'active'] as const
    : totalStock <= 1e-6
      ? ['Empty · clearing after carts return', 'idle'] as const
      : ['Awaiting free hauler and compatible storage', 'warning'] as const;

  return {
    eyebrow: 'Physical reclamation',
    title: 'Reclamation pile',
    statusText: status[0],
    statusState: status[1],
    detailsHtml: `
      <li><span>Road access</span><span>${roadAccess}</span></li>
      <li><span>Active cart</span><span>${activeHaul}</span></li>
      <li><span>Construction claim</span><span>Reserved sites may take reclaimed timber and stone before depot clearance</span></li>
      <li><span>Clearance rule</span><span>One free hauler moves a cartload at a time; the footprint clears when all goods and carts are gone</span></li>
      ${building.gold > 1e-6 ? '<li><span>Treasury recovery</span><span>Requires a Town Hall or the founding lockbox; roads speed the cart</span></li>' : ''}
    `,
    demolish: hiddenDemolish(),
    labor: hiddenLabor(),
  };
}
