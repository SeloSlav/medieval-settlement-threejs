import {
  BACKYARD_GARDEN_DEFINITIONS,
  BACKYARD_GARDEN_KINDS,
  backyardGardenLabel,
  formatBackyardGardenCost,
  formatBackyardGardenSalvage,
  getBackyardGardenCost,
  type BackyardGardenKind,
} from '../../residences/backyardGarden.ts';
import { canAffordBackyardGarden } from '../buildingEconomy.ts';
import { ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT } from '../../economy/villageEconomy.ts';
import { buildBackyardEconomyView, formatBackyardSavingsLabel } from '../../economy/economyInspectorViews.ts';
import { STONE_SALVAGE_FRACTION, TIMBER_SALVAGE_FRACTION } from '../../generated/gameBalance.ts';
import { getNeedStock } from '../../residences/residenceNeeds.ts';
import type { InspectableTarget } from '../types.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import { hiddenLabor } from './renderInspectableTarget.ts';

export function renderBackyardInspector(
  target: Extract<InspectableTarget, { kind: 'backyard' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { residence, zone, garden } = target;

  if (!garden) {
    return renderEmptyBackyardPicker(residence, zone.plotCount, residence.parcelIndex, context);
  }

  const def = BACKYARD_GARDEN_DEFINITIONS[garden.kind];
  const foodStock = Math.round(getNeedStock(residence.needs, 'food'));
  const taxRate = context.getEconomicActivityTaxRate?.() ?? ECONOMIC_ACTIVITY_TAX_RATE_DEFAULT;
  const hasMarketAccess = context.worldQueries.isResidenceConnectedToMarketplace(residence);
  const economy = buildBackyardEconomyView(garden.kind, residence.population, taxRate, hasMarketAccess);
  const producesFood = def.foodPerPersonPerSec > 0;

  return {
    eyebrow: 'Backyard',
    title: backyardGardenLabel(garden.kind),
    statusText: residence.abandoned
      ? 'Paused — residence abandoned'
      : hasMarketAccess
        ? 'Growing'
        : 'Growing — no marketplace link',
    statusState: residence.abandoned ? 'warning' : hasMarketAccess ? 'ok' : 'idle',
    detailsHtml: `
      <li><span>Parcel</span><span>#${residence.parcelIndex + 1}</span></li>
      <li><span>Population</span><span>${residence.abandoned ? 0 : residence.population}</span></li>
      ${producesFood
        ? `<li><span>Home food share</span><span>${Math.round(def.foodSelfShare * 100)}% stays on the plot</span></li>
           <li><span>Household food stock</span><span>${foodStock}</span></li>`
        : ''}
      <li><span>Marketplace link</span><span>${hasMarketAccess ? 'Road-connected' : 'None — sales paused'}</span></li>
      <li><span>Economic activity</span><span>${hasMarketAccess
        ? `Sells ${producesFood ? 'surplus produce & ' : ''}garden goods`
        : 'Sales need a road path to a marketplace'}</span></li>
      <li><span>Mayor tax (${economy.taxPercent})</span><span>${hasMarketAccess ? `~${economy.taxPerDay.toFixed(1)} gold / day` : '0 gold / day'}</span></li>
      <li><span>Household savings</span><span>${formatBackyardSavingsLabel(economy.netWealthPerDay, hasMarketAccess)}</span></li>
      <li><span>Build cost</span><span>${formatBackyardGardenCost(garden.kind)}</span></li>
    `,
    demolish: {
      visible: true,
      label: 'Remove garden',
      hint: `Clears the backyard and salvages about ${formatBackyardGardenSalvage(garden.kind)} (${Math.round(TIMBER_SALVAGE_FRACTION * 100)}% timber, ${Math.round(STONE_SALVAGE_FRACTION * 100)}% stone).`,
    },
    labor: hiddenLabor(),
  };
}

function renderEmptyBackyardPicker(
  residence: Extract<InspectableTarget, { kind: 'backyard' }>['residence'],
  plotCount: number,
  parcelIndex: number,
  context: InspectorRenderContext,
): InspectorView {
  const totals = context.resourceTotals;
  const abandoned = residence.abandoned;
  const options = BACKYARD_GARDEN_KINDS.map((kind) => {
    const def = BACKYARD_GARDEN_DEFINITIONS[kind];
    const tag = def.foodPerPersonPerSec > 0 ? 'Food' : 'Market';
    const cost = getBackyardGardenCost(kind);
    const affordable = !abandoned && canAffordBackyardGarden(totals, kind);
    const disabledReason = abandoned
      ? 'Cannot plant while the residence is abandoned.'
      : affordable
        ? ''
        : `Need ${cost.timber} timber and ${cost.stone} stone (you have ${Math.floor(totals.timber)} timber, ${Math.floor(totals.stone)} stone).`;
    return `
      <li class="backyard-picker-row">
        <button
          type="button"
          class="backyard-picker-option${affordable ? '' : ' backyard-picker-option--disabled'}"
          data-inspector-action="place-garden"
          data-garden-kind="${kind}"
          ${affordable ? '' : 'disabled'}
          ${disabledReason ? `title="${disabledReason}"` : ''}
        >
          <span class="backyard-picker-option__title">${backyardGardenLabel(kind)}</span>
          <span class="backyard-picker-option__meta">
            <span class="backyard-picker-option__tag">${tag}</span>
            <span class="backyard-picker-option__cost">${cost.timber}t · ${cost.stone}s</span>
          </span>
        </button>
      </li>
    `;
  }).join('');

  return {
    eyebrow: 'Backyard',
    title: 'Empty backyard',
    statusText: abandoned ? 'Abandoned — gardens unavailable' : 'Pick a garden type',
    statusState: abandoned ? 'warning' : 'neutral',
    detailsHtml: `
      <li><span>Parcel</span><span>#${parcelIndex + 1} of ${plotCount}</span></li>
      <li><span>Population</span><span>${residence.abandoned ? 0 : residence.population}</span></li>
      <li><span>Available timber</span><span>${Math.floor(totals.timber)}</span></li>
      <li><span>Available stone</span><span>${Math.floor(totals.stone)}</span></li>
    `,
    demolish: { visible: false, hint: '' },
    labor: hiddenLabor(),
    supplementalPanelHtml: `
      <p class="resource-inspector-note">Orchards and gardens cost timber and stone from your settlement stockpile.</p>
      <ul class="backyard-picker-list">${options}</ul>
    `,
  };
}

export function parseGardenPickerKind(button: HTMLElement): BackyardGardenKind | null {
  const option = button.closest<HTMLButtonElement>('[data-inspector-action="place-garden"]');
  if (!option || option.disabled) {
    return null;
  }
  const value = option.getAttribute('data-garden-kind');
  if (!value) return null;
  return (BACKYARD_GARDEN_KINDS as readonly string[]).includes(value)
    ? (value as BackyardGardenKind)
    : null;
}
