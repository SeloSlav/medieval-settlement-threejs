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

export type BanditRecoveredGood = {
  kind: string;
  amount: number;
};

export type BanditIncidentState = {
  id: string;
  campId: string;
  kind: BanditIncidentKind;
  buildingId: string | null;
  goodsTotal: number;
  recoveredGoods: readonly BanditRecoveredGood[];
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
      recoveredGoods: parseBanditGoods(row.goodsJson),
      occurredTick: Number(row.occurredTick),
      x: row.x,
      z: row.z,
    });
  }
  return incidents;
}

function storedGoods(json: string): number {
  return parseBanditGoods(json).reduce(
    (total, good) => good.kind === 'gold' ? total : total + good.amount,
    0,
  );
}

export function parseBanditGoods(json: string): BanditRecoveredGood[] {
  try {
    const bundles = JSON.parse(json) as Array<Record<string, unknown>>;
    const totals = new Map<string, number>();
    for (const bundle of bundles) {
      for (const [kind, rawAmount] of Object.entries(bundle)) {
        const amount = Math.max(0, Number(rawAmount) || 0);
        if (amount <= 0) continue;
        totals.set(kind, (totals.get(kind) ?? 0) + amount);
      }
    }
    return [...totals.entries()]
      .map(([kind, amount]) => ({ kind, amount }))
      .sort((left, right) => right.amount - left.amount || left.kind.localeCompare(right.kind));
  } catch {
    return [];
  }
}

export function formatBanditGoodsSummary(
  goods: readonly BanditRecoveredGood[],
  maxKinds = 3,
): string {
  const positive = goods.filter((good) => good.amount > 0);
  if (positive.length === 0) return 'no stolen goods';
  const shown = positive.slice(0, Math.max(1, maxKinds));
  const labels = shown.map((good) => (
    `${Math.round(good.amount)} ${good.kind.replaceAll('_', ' ')}`
  ));
  const summary = labels.length === 1
    ? labels[0]!
    : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
  const hiddenKinds = positive.length - shown.length;
  return hiddenKinds > 0 ? `${summary}, plus ${hiddenKinds} more ${hiddenKinds === 1 ? 'kind' : 'kinds'}` : summary;
}
