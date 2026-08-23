import type { PopulationStats, ResourceTotals } from '../resourceTotals.ts';
import type { ParishPolicyState } from '../../economy/chapelParish.ts';
import type { MonasteryPolicyState } from '../../economy/monasteryPolicy.ts';
import type { MarketplaceTradeAvailability } from '../../economy/marketplaceTrade.ts';
import type { RegionalMarketState } from '../../economy/regionalMarket.ts';
import type { GameState, InspectableTarget } from '../types.ts';
import type { SettlementSecurityState } from '../../security/frontierSecurity.ts';
import type { CombatAgentState } from '../../security/combatAgents.ts';
import type { NightPolicyState } from '../../economy/nightPolicy.ts';
import type { FiscalPolicyState } from '../../economy/fiscalPolicy.ts';
import type { PantrySafeguardPolicyCode } from '../../economy/pantrySafeguardPolicy.ts';
import type { SettlementProductionCapacity } from '../../economy/settlementProduction.ts';
import type { WorldQueries } from '../WorldQueries.ts';
import type { ServiceCoverageView } from '../serviceCoverage.ts';
import type { WorksiteCommuteSummary } from '../../settlement/workerCommute.ts';
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
  label?: string;
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
  serviceCoverage?: ServiceCoverageView;
};

export type InspectorRenderContext = {
  gameState: GameState;
  worldQueries: WorldQueries;
  populationStats: PopulationStats;
  resourceTotals: ResourceTotals;
  worldHydrology: number;
  severeWeatherEnabled?: boolean;
  wellAquiferNetworksEnabled?: boolean;
  worldResourceAbundance?: number;
  conflictEnabled?: boolean;
  enemyPressure?: number;
  settlementProduction?: SettlementProductionCapacity;
  getEconomicActivityTaxRate?: () => number;
  getPantrySafeguardPolicy?: () => PantrySafeguardPolicyCode;
  getFiscalPolicy?: () => FiscalPolicyState;
  getSeasonalLaborStewardEnabled?: () => boolean;
  getConstructionLaborStewardEnabled?: () => boolean;
  getProductionLaborStewardEnabled?: () => boolean;
  getLaborStewardReserve?: () => number;
  getParishPolicy?: () => ParishPolicyState;
  getMonasteryPolicy?: () => MonasteryPolicyState;
  getNightPolicy?: () => NightPolicyState;
  getTradeAvailability?: (
    marketplace: Extract<InspectableTarget, { kind: 'building' }>['building'],
  ) => MarketplaceTradeAvailability;
  getMarketState?: () => RegionalMarketState;
  getSettlementSecurity?: () => SettlementSecurityState;
  combatAgents?: Iterable<CombatAgentState>;
  getWorksiteCommuteSummary?: (buildingId: string) => WorksiteCommuteSummary | null;
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
