import type { SettlementState } from '../../resources/types.ts';
import { buildingClientId, settlementClientId } from '../spacetimeIds.ts';
import { normalizeNightPolicyCode } from '../../economy/nightPolicy.ts';
import { normalizePantrySafeguardPolicy } from '../../economy/pantrySafeguardPolicy.ts';
import { wholeResourceUnits } from '../../resources/resourceUnits.ts';

/** Structural row type keeps the client source buildable before bindings regenerate. */
export type SettlementRow = {
  id: bigint | number;
  owner: { toHexString(): string };
  name: string;
  anchorX: number;
  anchorZ: number;
  foundingCampId: bigint | number;
  founderPopulation: bigint | number;
  unhousedFounders: bigint | number;
  active: boolean;
  townHallId: bigint | number;
  createdTick: bigint | number;
  economicActivityTaxRate: number;
  pantrySafeguardPolicy: number;
  landLevyRate: number;
  importDutyRate: number;
  exportDutyRate: number;
  seasonalLaborStewardEnabled: boolean;
  constructionLaborStewardEnabled: boolean;
  productionLaborStewardEnabled: boolean;
  laborStewardReserve: bigint | number;
  nightWatchPolicy: number;
  nightGatheringPolicy: number;
  nightWorkPolicy: number;
  nightLightingPolicy: number;
  nightCurfewPolicy: number;
  landLevyAssessedTotal: number;
  landLevyCollectedTotal: number;
  importDutyCollectedTotal: number;
  exportDutyCollectedTotal: number;
  lastNightReportDay: bigint | number;
  lastNightHouseholds: bigint | number;
  lastNightWellRestedHouseholds: bigint | number;
  lastNightColdHouseholds: bigint | number;
  lastNightSocialHouseholds: bigint | number;
  lastNightWorkers: bigint | number;
  lastNightWatchStrength: number;
  lastNightIncidents: bigint | number;
  lastNightTheftGold: number;
  lastNightWildlifeSightings: bigint | number;
  lastNightLightingFuelUsed: number;
  lastNightLightingFuelShortfall: number;
  nightCommunityCohesion: number;
  nightLaborFatigue: number;
};

export function syncSettlements(
  rows: Iterable<SettlementRow>,
  identityHex: string | null,
): Map<string, SettlementState> {
  const settlements = new Map<string, SettlementState>();
  if (!identityHex) return settlements;
  for (const row of rows) {
    if (row.owner.toHexString() !== identityHex) continue;
    const id = settlementClientId(row.id);
    settlements.set(id, {
      id,
      name: row.name.trim() || 'Unnamed community',
      anchorX: Number(row.anchorX),
      anchorZ: Number(row.anchorZ),
      foundingCampId: optionalBuildingId(row.foundingCampId),
      founderPopulation: Number(row.founderPopulation),
      unhousedFounders: Number(row.unhousedFounders),
      active: row.active,
      townHallId: optionalBuildingId(row.townHallId),
      createdTick: Number(row.createdTick),
      economicActivityTaxRate: Number(row.economicActivityTaxRate),
      pantrySafeguardPolicy: normalizePantrySafeguardPolicy(row.pantrySafeguardPolicy),
      landLevyRate: Number(row.landLevyRate),
      importDutyRate: Number(row.importDutyRate),
      exportDutyRate: Number(row.exportDutyRate),
      seasonalLaborStewardEnabled: row.seasonalLaborStewardEnabled,
      constructionLaborStewardEnabled: row.constructionLaborStewardEnabled,
      productionLaborStewardEnabled: row.productionLaborStewardEnabled,
      laborStewardReserve: Number(row.laborStewardReserve),
      nightWatchPolicy: normalizeNightPolicyCode(row.nightWatchPolicy),
      nightGatheringPolicy: normalizeNightPolicyCode(row.nightGatheringPolicy),
      nightWorkPolicy: normalizeNightPolicyCode(row.nightWorkPolicy),
      nightLightingPolicy: normalizeNightPolicyCode(row.nightLightingPolicy),
      nightCurfewPolicy: normalizeNightPolicyCode(row.nightCurfewPolicy),
      landLevyAssessedTotal: wholeResourceUnits(row.landLevyAssessedTotal),
      landLevyCollectedTotal: wholeResourceUnits(row.landLevyCollectedTotal),
      importDutyCollectedTotal: wholeResourceUnits(row.importDutyCollectedTotal),
      exportDutyCollectedTotal: wholeResourceUnits(row.exportDutyCollectedTotal),
      lastNightReportDay: Number(row.lastNightReportDay),
      lastNightHouseholds: Number(row.lastNightHouseholds),
      lastNightWellRestedHouseholds: Number(row.lastNightWellRestedHouseholds),
      lastNightColdHouseholds: Number(row.lastNightColdHouseholds),
      lastNightSocialHouseholds: Number(row.lastNightSocialHouseholds),
      lastNightWorkers: Number(row.lastNightWorkers),
      lastNightWatchStrength: Number(row.lastNightWatchStrength),
      lastNightIncidents: Number(row.lastNightIncidents),
      lastNightTheftGold: wholeResourceUnits(row.lastNightTheftGold),
      lastNightWildlifeSightings: Number(row.lastNightWildlifeSightings),
      lastNightLightingFuelUsed: wholeResourceUnits(row.lastNightLightingFuelUsed),
      lastNightLightingFuelShortfall: wholeResourceUnits(row.lastNightLightingFuelShortfall),
      nightCommunityCohesion: Number(row.nightCommunityCohesion),
      nightLaborFatigue: Number(row.nightLaborFatigue),
    });
  }
  return settlements;
}

function optionalBuildingId(value: bigint | number): string | undefined {
  return BigInt(value) === 0n ? undefined : buildingClientId(value);
}
