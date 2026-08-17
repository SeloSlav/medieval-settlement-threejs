import { GAME_MIN_BREEDING_POPULATION } from '../../generated/gameBalance.ts';
import {
  foragingSeason,
  isForagingHarvestAvailable,
  isForagingRegrowthSeason,
} from '../../foraging/foragingSeason.ts';
import { displayedGameAnimalCount } from '../../foraging/foragingYields.ts';
import { gameClock } from '../../world/gameCalendar.ts';
import { formatResourceAmount } from '../yields.ts';
import type { InspectableTarget } from '../types.ts';
import type { InspectorRenderContext, InspectorView } from './renderInspectableTarget.ts';
import { hiddenDemolish, hiddenLabor } from './renderInspectableTarget.ts';

export function renderForagingInspector(
  target: Extract<InspectableTarget, { kind: 'foraging' }>,
  context: InspectorRenderContext,
): InspectorView {
  const { definition, state } = target;
  const clock = gameClock(context.gameState.tick);
  const season = foragingSeason(clock.month);
  const available = isForagingHarvestAvailable(state.kind, clock.month);
  const regrowing = isForagingRegrowthSeason(state.kind, clock.month)
    && state.remaining < state.maxYield;
  const depleted = state.remaining <= 1e-6;
  const belowGameBreedingFloor = state.kind === 'game'
    && state.remaining > 0
    && state.remaining < GAME_MIN_BREEDING_POPULATION;

  let statusText: string;
  let statusState: InspectorView['statusState'] = 'active';
  if (state.kind === 'fish' && depleted) {
    statusText = 'Extinct — no fish remain to reproduce';
    statusState = 'warning';
  } else if (state.kind === 'game' && depleted) {
    statusText = 'Extinct — the habitat remains empty';
    statusState = 'warning';
  } else if (belowGameBreedingFloor) {
    statusText = `${formatStock(state.kind, state.remaining, state.maxYield)} — below the two-animal breeding floor`;
    statusState = 'warning';
  } else if (!available) {
    statusText = state.kind === 'fish'
      ? `${formatStock(state.kind, state.remaining, state.maxYield)} — frozen for winter`
      : `${formatStock(state.kind, state.remaining, state.maxYield)} — dormant for winter`;
    statusState = 'idle';
  } else if (depleted) {
    statusText = `Empty — regrows here during spring and summer`;
    statusState = 'idle';
  } else if (regrowing) {
    statusText = `${formatStock(state.kind, state.remaining, state.maxYield)} — population recovering`;
  } else {
    statusText = formatStock(state.kind, state.remaining, state.maxYield);
  }

  const lifecycle = lifecycleDescription(state.kind);
  return {
    eyebrow: state.kind === 'fish' ? 'Water population' : 'Wild population',
    title: definition.label,
    statusText,
    statusState,
    detailsHtml: `
      <li><span>Resource</span><span>${formatResourceAmount(definition.resource, state.remaining)}</span></li>
      <li><span>Capacity</span><span>${Math.round(state.maxYield)}</span></li>
      <li><span>Season</span><span>${capitalize(season)}${available ? '' : ' — unavailable'}</span></li>
      <li><span>Recovery</span><span>${lifecycle}</span></li>
      ${richnessDetail(state.kind, state.isRich === true)}
      <li><span>Harvest radius</span><span>${definition.pickRadius} m</span></li>
      <li><span>Location</span><span>${Math.round(state.x)}, ${Math.round(state.z)}</span></li>
    `,
    demolish: hiddenDemolish(),
    labor: hiddenLabor(),
  };
}

function richnessDetail(
  kind: 'game' | 'berries' | 'mushrooms' | 'fish',
  isRich: boolean,
): string {
  if (kind === 'fish') {
    return `<li><span>Shoal</span><span>${isRich ? 'Rich population (1.75× catch)' : 'Small population'}</span></li>`;
  }
  if (kind === 'berries') {
    return `<li><span>Thicket</span><span>${isRich ? 'Rich growth (1.5× harvest)' : 'Ordinary growth'}</span></li>`;
  }
  if (kind === 'game') {
    return `<li><span>Habitat</span><span>${isRich ? 'Rich carrying capacity' : 'Ordinary carrying capacity'}</span></li>`;
  }
  return '';
}

function formatStock(
  kind: 'game' | 'berries' | 'mushrooms' | 'fish',
  remaining: number,
  maximum: number,
): string {
  if (kind === 'game') {
    return `${displayedGameAnimalCount(remaining)} / ${Math.round(maximum)}`;
  }
  return `${Math.max(0, remaining).toFixed(remaining < 10 ? 1 : 0)} / ${Math.round(maximum)}`;
}

function lifecycleDescription(kind: 'game' | 'berries' | 'mushrooms' | 'fish'): string {
  if (kind === 'fish') return 'Spring reproduction from surviving fish; zero is permanent';
  if (kind === 'game') return 'Herd-size reproduction; at least two animals required';
  return 'Regrows in place during spring and summer';
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
