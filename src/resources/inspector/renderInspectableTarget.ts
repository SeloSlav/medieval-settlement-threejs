import type { PopulationStats, ResourceTotals } from '../resourceTotals.ts';
import type { ParishPolicyState } from '../../economy/chapelParish.ts';
import type { MonasteryPolicyState } from '../../economy/monasteryPolicy.ts';
import type { MarketplaceTradeAvailability } from '../../economy/marketplaceTrade.ts';
import type { RegionalMarketState } from '../../economy/regionalMarket.ts';
import type { GameState, InspectableTarget } from '../types.ts';
import type { WorldQueries } from '../WorldQueries.ts';
import { renderBackyardInspector } from './backyardRenderer.ts';
import { renderForagingInspector } from './foragingRenderer.ts';
import { renderBuildingInspector } from './buildingRenderer.ts';
import { renderQuarryInspector } from './quarryRenderer.ts';
import { renderResidenceInspector } from './residenceRenderer.ts';
import { renderRiverInspector } from './riverRenderer.ts';
import { renderFarmFieldInspector } from './farmFieldRenderer.ts';
import { renderPastureInspector } from './pastureRenderer.ts';

export type InspectorLaborView = {
  visible: boolean;
  count: number;
  hint: string;
  decreaseDisabled: boolean;
  increaseDisabled: boolean;
};

export type InspectorDemolishView = {
  visible: boolean;
  label?: string;
  hint: string;
  secondary?: {
    label: string;
    hint: string;
  };
};

export type InspectorView = {
  eyebrow: string;
  title: string;
  statusText: string;
  statusState: string;
  detailsHtml: string;
  demolish: InspectorDemolishView;
  labor: InspectorLaborView;
  supplementalPanelHtml?: string;
};

export type InspectorRenderContext = {
  gameState: GameState;
  worldQueries: WorldQueries;
  populationStats: PopulationStats;
  resourceTotals: ResourceTotals;
  getEconomicActivityTaxRate?: () => number;
  getParishPolicy?: () => ParishPolicyState;
  getMonasteryPolicy?: () => MonasteryPolicyState;
  getTradeAvailability?: () => MarketplaceTradeAvailability;
  getMarketState?: () => RegionalMarketState;
};

export function hiddenLabor(): InspectorLaborView {
  return {
    visible: false,
    count: 0,
    hint: '',
    decreaseDisabled: true,
    increaseDisabled: true,
  };
}

export function hiddenDemolish(): InspectorDemolishView {
  return { visible: false, hint: '' };
}

export function renderInspectableTarget(
  target: InspectableTarget,
  context: InspectorRenderContext,
): InspectorView {
  switch (target.kind) {
    case 'quarry':
      return renderQuarryInspector(target, context);
    case 'foraging':
      return renderForagingInspector(target, context);
    case 'building':
      return renderBuildingInspector(target, context);
    case 'residence':
      return renderResidenceInspector(target, context);
    case 'backyard':
      return renderBackyardInspector(target, context);
    case 'farm-field':
      return renderFarmFieldInspector(target, context);
    case 'pasture':
      return renderPastureInspector(target, context);
    case 'river':
      return renderRiverInspector(target);
    default: {
      const unreachable: never = target;
      return unreachable;
    }
  }
}
