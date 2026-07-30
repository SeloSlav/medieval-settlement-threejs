import type {
  BuildingKind,
} from './types.ts';
import type {
  SettlementHouseholdMarketPlan,
} from '../economy/settlementHouseholdMarket.ts';

export type ServiceCoverageBuildingKind = Extract<
  BuildingKind,
  'well' | 'marketplace'
>;

export type ServiceCoverageView = {
  kind: ServiceCoverageBuildingKind;
  residenceIds: readonly string[];
};

export function serviceCoverageLabel(kind: ServiceCoverageBuildingKind): string {
  return kind === 'well' ? 'water service' : 'market service';
}

/**
 * Reuses the marketplace inspector's authoritative settlement plan. This
 * avoids a second all-market road projection every time its coverage toggle
 * refreshes.
 */
export function marketplaceServiceResidenceIds(
  plan: SettlementHouseholdMarketPlan | null,
  marketplaceId: string,
): string[] {
  return [...(plan?.branches.get(marketplaceId)?.assignedResidenceIds ?? [])];
}
