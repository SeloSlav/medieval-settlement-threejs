import type { Residence, ResidenceNeed } from '../../generated/types.ts';
import { residenceClientId, settlementClientId, zoneClientId } from '../spacetimeIds.ts';
import {
  createDefaultNeeds,
  mergeNeedRow,
  needKindFromId,
} from '../../residences/residenceNeedState.ts';
import type { ResidenceState } from '../../resources/types.ts';
import { wholeResourceUnits } from '../../resources/resourceUnits.ts';

function buildNeedsByResidence(rows: Iterable<ResidenceNeed>): Map<string, ResidenceState['needs']> {
  const needsByResidence = new Map<string, ResidenceState['needs']>();
  for (const row of rows) {
    const kind = needKindFromId(Number(row.needKind));
    if (!kind) continue;
    const residenceId = residenceClientId(row.residenceId);
    const sourceRow = row as ResidenceNeed & Partial<{ sourceKind: number }>;
    const sourceKind = Number(sourceRow.sourceKind ?? 65535);
    const needs = needsByResidence.get(residenceId) ?? createDefaultNeeds();
    needsByResidence.set(
      residenceId,
      mergeNeedRow(needs, kind, {
        stock: wholeResourceUnits(row.stock),
        deficitTicks: Number(row.deficitTicks),
        sourceKind: sourceKind < 65535 ? sourceKind : null,
      }),
    );
  }
  return needsByResidence;
}

export function syncResidences(
  residenceRows: Iterable<Residence>,
  needRows: Iterable<ResidenceNeed>,
  identityHex: string | null,
): Map<string, ResidenceState> {
  const residences = new Map<string, ResidenceState>();
  if (!identityHex) return residences;

  const needsByResidence = buildNeedsByResidence(needRows);
  for (const row of residenceRows) {
    if (row.owner.toHexString() !== identityHex) continue;
    // Additive server fields may be absent from an older generated binding
    // during a rolling local migration; defaults keep those saves readable.
    const upgradeRow = row as Residence & Partial<{
      upgradeTargetTier: number;
      upgradeProgress: number;
      upgradeRequiredTimber: number;
      upgradeRequiredStone: number;
      upgradeRequiredGold: number;
      upgradeDeliveredTimber: number;
      upgradeDeliveredStone: number;
      upgradeDeliveredGold: number;
      upgradeReservedTimber: number;
      upgradeReservedStone: number;
      upgradeReservedGold: number;
      upgradeAssignedLabor: number;
      upgradePriority: number;
      backyardProjectKind: number;
      fireRepairActive: boolean;
      hungerTicks: number;
      malnutrition: number;
      sickPopulation: number;
      illnessTicks: number;
      remedyStock: number;
      deathsTotal: number;
      comfortDeficitTicks: number;
      vacancyTicks: number;
      condition: number;
      decayRepairActive: boolean;
      tiledRoof: boolean;
      roofTileRetrofitActive: boolean;
      upgradeRequiredRoofTiles: number;
      upgradeDeliveredRoofTiles: number;
      upgradeReservedRoofTiles: number;
      pears: number;
      aronia: number;
      rosehips: number;
      cabbage: number;
      carrots: number;
      beetroot: number;
      jam: number;
      settlementId: bigint;
      smallholding: boolean;
    }>;
    const residenceId = residenceClientId(row.id);
    residences.set(residenceId, {
      id: residenceId,
      settlementId: upgradeRow.settlementId == null || upgradeRow.settlementId === 0n
        ? undefined
        : settlementClientId(upgradeRow.settlementId),
      zoneId: zoneClientId(row.zoneId),
      parcelIndex: Number(row.parcelIndex),
      x: row.x,
      z: row.z,
      yaw: row.yaw,
      population: Number(row.population),
      populationCapacity: Number(row.populationCapacity ?? row.population),
      tier: Math.max(0, Math.min(4, Number(row.tier ?? 1))) as 0 | 1 | 2 | 3 | 4,
      settlementTicks: Number(row.settlementTicks ?? 0),
      needs: needsByResidence.get(residenceId) ?? createDefaultNeeds(),
      food: wholeResourceUnits(row.food),
      honey: wholeResourceUnits(row.honey),
      oatGrain: wholeResourceUnits(row.oatGrain),
      ryeBread: wholeResourceUnits(row.ryeBread),
      maslinBread: wholeResourceUnits(row.maslinBread),
      meat: wholeResourceUnits(row.meat),
      fish: wholeResourceUnits(row.fish),
      berries: wholeResourceUnits(row.berries),
      mushrooms: wholeResourceUnits(row.mushrooms),
      milk: wholeResourceUnits(row.milk),
      apples: wholeResourceUnits(row.apples),
      pears: wholeResourceUnits(upgradeRow.pears),
      cherries: wholeResourceUnits(row.cherries),
      aronia: wholeResourceUnits(upgradeRow.aronia),
      rosehips: wholeResourceUnits(upgradeRow.rosehips),
      cabbage: wholeResourceUnits(upgradeRow.cabbage),
      carrots: wholeResourceUnits(upgradeRow.carrots),
      beetroot: wholeResourceUnits(upgradeRow.beetroot),
      eggs: wholeResourceUnits(row.eggs),
      grapes: wholeResourceUnits(row.grapes),
      curedMeat: wholeResourceUnits(row.curedMeat),
      smokedFish: wholeResourceUnits(row.smokedFish),
      cheese: wholeResourceUnits(row.cheese),
      jam: wholeResourceUnits(upgradeRow.jam),
      foodInventoryMigrated: row.foodInventoryMigrated,
      // Kept in the replicated schema for old saves only. Completed homes are
      // permanent housing and empty capacity immediately re-enters settlement.
      abandoned: false,
      householdWealth: wholeResourceUnits(row.householdWealth),
      lastHouseholdMarketTick: Number(row.lastHouseholdMarketTick ?? 0),
      lastDiscretionaryMarketDay: Number(row.lastDiscretionaryMarketDay ?? 0),
      upgradeTargetTier: Math.max(
        0,
        Math.min(4, Number(upgradeRow.upgradeTargetTier ?? 0)),
      ) as 0 | 1 | 2 | 3 | 4,
      upgradeProgress: Number(upgradeRow.upgradeProgress ?? 0),
      upgradeRequiredTimber: wholeResourceUnits(upgradeRow.upgradeRequiredTimber),
      upgradeRequiredStone: wholeResourceUnits(upgradeRow.upgradeRequiredStone),
      upgradeRequiredGold: wholeResourceUnits(upgradeRow.upgradeRequiredGold),
      upgradeDeliveredTimber: wholeResourceUnits(upgradeRow.upgradeDeliveredTimber),
      upgradeDeliveredStone: wholeResourceUnits(upgradeRow.upgradeDeliveredStone),
      upgradeDeliveredGold: wholeResourceUnits(upgradeRow.upgradeDeliveredGold),
      upgradeReservedTimber: wholeResourceUnits(upgradeRow.upgradeReservedTimber),
      upgradeReservedStone: wholeResourceUnits(upgradeRow.upgradeReservedStone),
      upgradeReservedGold: wholeResourceUnits(upgradeRow.upgradeReservedGold),
      upgradeAssignedLabor: Number(upgradeRow.upgradeAssignedLabor ?? 0),
      upgradePriority: Number(upgradeRow.upgradePriority ?? 2),
      backyardProjectKind: Number(upgradeRow.backyardProjectKind ?? 0),
      fireRepairActive: upgradeRow.fireRepairActive === true,
      hungerTicks: Number(upgradeRow.hungerTicks ?? 0),
      malnutrition: Number(upgradeRow.malnutrition ?? 0),
      sickPopulation: Number(upgradeRow.sickPopulation ?? 0),
      illnessTicks: Number(upgradeRow.illnessTicks ?? 0),
      remedyStock: wholeResourceUnits(upgradeRow.remedyStock),
      deathsTotal: Number(upgradeRow.deathsTotal ?? 0),
      comfortDeficitTicks: Number(upgradeRow.comfortDeficitTicks ?? 0),
      vacancyTicks: 0,
      condition: 0,
      decayRepairActive: false,
      tiledRoof: upgradeRow.tiledRoof === true,
      roofTileRetrofitActive: upgradeRow.roofTileRetrofitActive === true,
      upgradeRequiredRoofTiles: wholeResourceUnits(upgradeRow.upgradeRequiredRoofTiles),
      upgradeDeliveredRoofTiles: wholeResourceUnits(upgradeRow.upgradeDeliveredRoofTiles),
      upgradeReservedRoofTiles: wholeResourceUnits(upgradeRow.upgradeReservedRoofTiles),
      smallholding: upgradeRow.smallholding === true,
    });
  }
  return residences;
}
