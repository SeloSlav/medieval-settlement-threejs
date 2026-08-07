import {
  EXPORT_DUTY_RATE_DEFAULT,
  EXPORT_DUTY_RATE_MAX,
  EXPORT_DUTY_RATE_MIN,
  IMPORT_DUTY_RATE_DEFAULT,
  IMPORT_DUTY_RATE_MAX,
  IMPORT_DUTY_RATE_MIN,
  LAND_LEVY_AREA_MULTIPLIER_MAX,
  LAND_LEVY_AREA_MULTIPLIER_MIN,
  LAND_LEVY_BACKYARD_MULTIPLIER,
  LAND_LEVY_RATE_DEFAULT,
  LAND_LEVY_RATE_MAX,
  LAND_LEVY_RATE_MIN,
  LAND_LEVY_REFERENCE_PLOT_AREA,
  LAND_LEVY_TIER1_ASSESSED_VALUE,
  LAND_LEVY_TIER2_ASSESSED_VALUE,
  LAND_LEVY_TIER3_ASSESSED_VALUE,
} from '../generated/gameBalance.ts';
import type { BurgageZoneState, GameState } from '../resources/types.ts';

export type FiscalPolicyState = {
  landLevyRate: number;
  importDutyRate: number;
  exportDutyRate: number;
  landLevyAssessedTotal: number;
  landLevyCollectedTotal: number;
  importDutyCollectedTotal: number;
  exportDutyCollectedTotal: number;
  privateExportIncomeTotal: number;
  localDiscretionarySpendTotal: number;
  localProducerIncomeTotal: number;
};

export const DEFAULT_FISCAL_POLICY: FiscalPolicyState = {
  landLevyRate: LAND_LEVY_RATE_DEFAULT,
  importDutyRate: IMPORT_DUTY_RATE_DEFAULT,
  exportDutyRate: EXPORT_DUTY_RATE_DEFAULT,
  landLevyAssessedTotal: 0,
  landLevyCollectedTotal: 0,
  importDutyCollectedTotal: 0,
  exportDutyCollectedTotal: 0,
  privateExportIncomeTotal: 0,
  localDiscretionarySpendTotal: 0,
  localProducerIncomeTotal: 0,
};

function clampFiniteRate(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min;
}

export function normalizeFiscalPolicy(policy: FiscalPolicyState): FiscalPolicyState {
  return {
    ...policy,
    landLevyRate: clampFiniteRate(policy.landLevyRate, LAND_LEVY_RATE_MIN, LAND_LEVY_RATE_MAX),
    importDutyRate: clampFiniteRate(policy.importDutyRate, IMPORT_DUTY_RATE_MIN, IMPORT_DUTY_RATE_MAX),
    exportDutyRate: clampFiniteRate(policy.exportDutyRate, EXPORT_DUTY_RATE_MIN, EXPORT_DUTY_RATE_MAX),
  };
}

export function fiscalRatePercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function householdImportDuty(baseCost: number, rate: number): number {
  const clampedRate = clampFiniteRate(rate, IMPORT_DUTY_RATE_MIN, IMPORT_DUTY_RATE_MAX);
  return Math.max(0, baseCost) * clampedRate;
}

export function splitPrivateExportReceipt(
  grossReceipt: number,
  rate: number,
): { householdIncome: number; exportDuty: number } {
  const gross = Math.max(0, grossReceipt);
  const clampedRate = clampFiniteRate(rate, EXPORT_DUTY_RATE_MIN, EXPORT_DUTY_RATE_MAX);
  const exportDuty = gross * clampedRate;
  return { householdIncome: gross - exportDuty, exportDuty };
}

export function burgageZoneArea(zone: BurgageZoneState): number {
  const points = [zone.cornerA, zone.cornerB, zone.cornerC, zone.cornerD];
  let doubledArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    doubledArea += a.x * b.z - b.x * a.z;
  }
  return Math.abs(doubledArea) * 0.5;
}

export function landLevyAssessedValue(
  tier: number,
  plotArea: number,
  hasBackyardImprovement: boolean,
): number {
  const tierValue = tier >= 3
    ? LAND_LEVY_TIER3_ASSESSED_VALUE
    : tier >= 2
      ? LAND_LEVY_TIER2_ASSESSED_VALUE
      : LAND_LEVY_TIER1_ASSESSED_VALUE;
  const areaMultiplier = Math.max(
    LAND_LEVY_AREA_MULTIPLIER_MIN,
    Math.min(LAND_LEVY_AREA_MULTIPLIER_MAX, plotArea / LAND_LEVY_REFERENCE_PLOT_AREA),
  );
  return tierValue * areaMultiplier * (hasBackyardImprovement ? LAND_LEVY_BACKYARD_MULTIPLIER : 1);
}

export type LandLevyForecast = {
  monthlyAssessed: number;
  monthlyCollectable: number;
  occupiedHomes: number;
};

export function forecastMonthlyLandLevy(
  state: GameState,
  annualRate: number,
  collectionMultiplier: number,
): LandLevyForecast {
  const zones = new Map(
    [...state.burgageZones.values()].map((zone) => [
      zone.id,
      burgageZoneArea(zone) / Math.max(1, zone.plotCount),
    ]),
  );
  let monthlyAssessed = 0;
  let monthlyCollectable = 0;
  let occupiedHomes = 0;
  for (const residence of state.residences.values()) {
    if (residence.population <= 0 || residence.abandoned || residence.tier <= 0) continue;
    occupiedHomes += 1;
    const assessedValue = landLevyAssessedValue(
      residence.tier,
      zones.get(residence.zoneId) ?? 0,
      state.backyardGardens.has(residence.id),
    );
    const installment = assessedValue
      * clampFiniteRate(annualRate, LAND_LEVY_RATE_MIN, LAND_LEVY_RATE_MAX)
      / 12;
    monthlyAssessed += installment;
    monthlyCollectable += Math.min(
      Math.max(0, residence.householdWealth),
      installment * clampFiniteRate(collectionMultiplier, 0, 1),
    );
  }
  return { monthlyAssessed, monthlyCollectable, occupiedHomes };
}

export {
  EXPORT_DUTY_RATE_MAX,
  EXPORT_DUTY_RATE_MIN,
  IMPORT_DUTY_RATE_MAX,
  IMPORT_DUTY_RATE_MIN,
  LAND_LEVY_RATE_MAX,
  LAND_LEVY_RATE_MIN,
};
