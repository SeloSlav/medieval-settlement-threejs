import type { BackyardGarden } from '../../generated/types.ts';
import { backyardGardenKindFromId } from '../../residences/backyardGarden.ts';
import { gardenClientId, residenceClientId } from '../spacetimeIds.ts';
import type { BackyardGardenState } from '../../resources/types.ts';

export function syncBackyardGardens(
  rows: Iterable<BackyardGarden>,
  identityHex: string | null,
): Map<string, BackyardGardenState> {
  const backyardGardens = new Map<string, BackyardGardenState>();
  if (!identityHex) return backyardGardens;

  for (const row of rows) {
    if (row.owner.toHexString() !== identityHex) continue;
    const residenceId = residenceClientId(row.residenceId);
    const kind = backyardGardenKindFromId(Number(row.kind));
    if (!kind) continue;
    backyardGardens.set(residenceId, {
      id: gardenClientId(row.id),
      residenceId,
      kind,
    });
  }
  return backyardGardens;
}
