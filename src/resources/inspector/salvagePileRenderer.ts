import {
  cargoKindLabel,
  formatTripPhaseLabel,
} from '../../logistics/deliveryTrips.ts';
import type { BuildingState, InspectableTarget } from '../types.ts';
import {
  NAMED_FOOD_KINDS,
  NAMED_FOOD_LABELS,
} from '../../economy/foodInventory.ts';
import {
  hiddenDemolish,
  hiddenLabor,
  type InspectorRenderContext,
  type InspectorView,
} from './renderInspectableTarget.ts';

const STOCK_ROWS: Array<[
  label: string,
  amount: (building: BuildingState) => number,
]> = [
  ['Timber', (building) => building.timber],
  ['Stone', (building) => building.stone],
  ['Firewood', (building) => building.firewood],
  ['Water', (building) => building.water],
  ['Legacy mixed food', (building) => building.food],
  ['Grain', (building) => building.grain],
  ['Flour', (building) => building.flour],
  ['Ale', (building) => building.ale],
  ['Legacy preserved staples', (building) => building.preservedFood],
  ...NAMED_FOOD_KINDS.map((kind) => [
    NAMED_FOOD_LABELS[kind],
    (building: BuildingState) => building[kind] ?? 0,
  ] as [string, (building: BuildingState) => number]),
  ['Wine', (building) => building.wine],
  ['Ironwork', (building) => building.ironwork ?? 0],
  ['Polearms', (building) => building.polearms ?? 0],
  ['Wool', (building) => building.wool ?? 0],
  ['Flax fibre', (building) => building.flax ?? 0],
  ['Cloth', (building) => building.cloth ?? 0],
  ['Gold lockbox', (building) => building.gold],
];

export function renderSalvagePileInspector(
  target: Extract<InspectableTarget, { kind: 'building' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { building } = target;
  const activeTrip = context.worldQueries.getActiveDeliveryTrip(building);
  const roadAccess = context.worldQueries.getRoadAccessLabel(building.x, building.z);
  const stockRows = STOCK_ROWS
    .map(([label, amountFor]) => [label, amountFor(building)] as const)
    .filter(([, amount]) => amount > 1e-6)
    .map(([label, amount]) =>
      `<li><span>${label}</span><span>${amount.toFixed(amount < 10 ? 1 : 0)}</span></li>`)
    .join('');
  const totalStock = STOCK_ROWS.reduce(
    (total, [, amountFor]) => total + Math.max(0, amountFor(building)),
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
      ${stockRows || '<li><span>Recoverable stock</span><span>Empty</span></li>'}
      <li><span>Construction claim</span><span>Reserved sites may take reclaimed timber and stone before depot clearance</span></li>
      <li><span>Clearance rule</span><span>One free hauler moves a cartload at a time; the footprint clears when all goods and carts are gone</span></li>
      ${building.gold > 1e-6 ? '<li><span>Treasury recovery</span><span>Requires a Town Hall or the founding lockbox; roads speed the cart</span></li>' : ''}
    `,
    demolish: hiddenDemolish(),
    labor: hiddenLabor(),
  };
}
