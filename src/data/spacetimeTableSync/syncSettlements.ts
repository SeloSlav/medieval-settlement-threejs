import type { SettlementState } from '../../resources/types.ts';
import { buildingClientId, settlementClientId } from '../spacetimeIds.ts';
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
  landLevyAssessedTotal: number;
  landLevyCollectedTotal: number;
  importDutyCollectedTotal: number;
  exportDutyCollectedTotal: number;
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
      landLevyAssessedTotal: wholeResourceUnits(row.landLevyAssessedTotal),
      landLevyCollectedTotal: wholeResourceUnits(row.landLevyCollectedTotal),
      importDutyCollectedTotal: wholeResourceUnits(row.importDutyCollectedTotal),
      exportDutyCollectedTotal: wholeResourceUnits(row.exportDutyCollectedTotal),
    });
  }
  return settlements;
}

function optionalBuildingId(value: bigint | number): string | undefined {
  return BigInt(value) === 0n ? undefined : buildingClientId(value);
}
