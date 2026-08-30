import type { BanditCamp, BanditIncident } from '../generated/types.ts';

export type BanditCampState = {
  id: string;
  x: number;
  z: number;
  health: number;
  maxHealth: number;
  active: boolean;
  stolenGoods: number;
  spawnedTick: number;
  nextTheftTick: number;
  lastTheftTick: number;
  destroyedTick: number;
};

export type BanditIncidentKind = 'theft' | 'carrier-intercepted' | 'camp-destroyed';

export type BanditIncidentState = {
  id: string;
  campId: string;
  kind: BanditIncidentKind;
  buildingId: string | null;
  goodsTotal: number;
  occurredTick: number;
  x: number;
  z: number;
};

export function syncBanditCamps(
  rows: Iterable<BanditCamp>,
  identityHex: string | null,
): Map<string, BanditCampState> {
  const camps = new Map<string, BanditCampState>();
  if (!identityHex) return camps;
  for (const row of rows) {
    if (row.owner.toHexString() !== identityHex) continue;
    const id = `bandit-camp-${row.id}`;
    camps.set(id, {
      id,
      x: row.x,
      z: row.z,
      health: Math.max(0, row.health),
      maxHealth: Math.max(1, row.maxHealth),
      active: row.active,
      stolenGoods: storedGoods(row.inventoryJson),
      spawnedTick: Number(row.spawnedTick),
      nextTheftTick: Number(row.nextTheftTick),
      lastTheftTick: Number(row.lastTheftTick),
      destroyedTick: Number(row.destroyedTick),
    });
  }
  return camps;
}

export function syncBanditIncidents(
  rows: Iterable<BanditIncident>,
  identityHex: string | null,
): Map<string, BanditIncidentState> {
  const incidents = new Map<string, BanditIncidentState>();
  if (!identityHex) return incidents;
  for (const row of rows) {
    if (row.owner.toHexString() !== identityHex) continue;
    incidents.set(row.id.toString(), {
      id: row.id.toString(),
      campId: `bandit-camp-${row.campId}`,
      kind: row.kind === 1 ? 'carrier-intercepted' : row.kind === 2 ? 'camp-destroyed' : 'theft',
      buildingId: row.buildingId > 0n ? `building-${row.buildingId}` : null,
      goodsTotal: Math.max(0, row.goodsTotal),
      occurredTick: Number(row.occurredTick),
      x: row.x,
      z: row.z,
    });
  }
  return incidents;
}

function storedGoods(json: string): number {
  try {
    const bundles = JSON.parse(json) as Array<Record<string, unknown>>;
    return bundles.reduce((total, bundle) => total + Object.entries(bundle).reduce(
      (sum, [key, value]) => key === 'gold' ? sum : sum + Math.max(0, Number(value) || 0),
      0,
    ), 0);
  } catch {
    return 0;
  }
}
