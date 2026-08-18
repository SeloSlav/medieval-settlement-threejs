import type { FarmField } from '../../generated/types.ts';
import { buildingClientId, farmFieldClientId } from '../spacetimeIds.ts';
import { FARM_CROPS, type FarmFieldStage, type FarmFieldState } from '../../resources/types.ts';
import { wholeResourceUnits } from '../../resources/resourceUnits.ts';

const STAGES: readonly FarmFieldStage[] = ['ploughing', 'sowing', 'growing', 'harvesting'];

export function syncFarmFields(
  rows: Iterable<FarmField>,
  identityHex: string | null,
): Map<string, FarmFieldState> {
  const fields = new Map<string, FarmFieldState>();
  if (!identityHex) return fields;
  for (const row of rows) {
    if (row.owner.toHexString() !== identityHex) continue;
    const id = farmFieldClientId(row.id);
    fields.set(id, {
      id,
      farmsteadId: buildingClientId(row.farmsteadId),
      corners: [
        { x: row.cornerAx, z: row.cornerAz },
        { x: row.cornerBx, z: row.cornerBz },
        { x: row.cornerCx, z: row.cornerCz },
        { x: row.cornerDx, z: row.cornerDz },
      ],
      area: row.area,
      averageSlopeDegrees: row.averageSlopeDegrees,
      moisture: row.moisture,
      fertility: row.fertility,
      crop: FARM_CROPS[row.crop] ?? 'rye',
      nextCrop: FARM_CROPS[row.nextCrop] ?? 'rye',
      followingCrop: FARM_CROPS[row.followingCrop] ?? null,
      stage: STAGES[row.stage] ?? 'ploughing',
      stageProgress: row.stageProgress,
      priority: row.priority,
      harvestCount: Number(row.harvestCount),
      lastYield: wholeResourceUnits(row.lastYield),
      currentYield: wholeResourceUnits(row.currentYield),
      harvestYieldMultiplier: row.harvestYieldMultiplier ?? 1,
      manureApplied: wholeResourceUnits(row.manureApplied),
    });
  }
  return fields;
}
