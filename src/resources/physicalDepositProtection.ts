import type { Point2 } from '../utils/polygonGeometry.ts';
import type { WorldLayout } from './WorldLayout.ts';

export type PhysicalDepositResource = 'stone' | 'clay' | 'iron' | 'salt';

export type PhysicalDepositFootprint = {
  x: number;
  z: number;
  radius: number;
  resource: PhysicalDepositResource;
  isRich: boolean;
};

// These circles conservatively contain the generated landmark meshes. Keeping
// one small footprint per deposit makes placement checks cheap and lets the
// server mirror the same rule from its compact authoritative resource rows.
export const ORDINARY_STONE_DEPOSIT_PROTECTION_RADIUS = 34;
export const RICH_STONE_DEPOSIT_PROTECTION_RADIUS = 67;
export const ORDINARY_MINERAL_DEPOSIT_PROTECTION_RADIUS = 23;
export const RICH_MINERAL_DEPOSIT_PROTECTION_RADIUS = 32;
export const ORDINARY_CLAY_DEPOSIT_PROTECTION_RADIUS = 16;
export const RICH_CLAY_DEPOSIT_PROTECTION_RADIUS = 21;

export function createPhysicalDepositFootprints(
  layout: Pick<WorldLayout, 'quarryLayout' | 'clayDepositLayout' | 'mineralDepositLayout'>,
): PhysicalDepositFootprint[] {
  return [
    ...layout.quarryLayout.sites.map((site) => ({
      x: site.x,
      z: site.z,
      radius: site.kind === 'large'
        ? RICH_STONE_DEPOSIT_PROTECTION_RADIUS
        : ORDINARY_STONE_DEPOSIT_PROTECTION_RADIUS,
      resource: 'stone' as const,
      isRich: site.kind === 'large',
    })),
    ...layout.clayDepositLayout.sites.map((site) => ({
      x: site.x,
      z: site.z,
      radius: site.kind === 'rich'
        ? RICH_CLAY_DEPOSIT_PROTECTION_RADIUS
        : ORDINARY_CLAY_DEPOSIT_PROTECTION_RADIUS,
      resource: 'clay' as const,
      isRich: site.kind === 'rich',
    })),
    ...layout.mineralDepositLayout.sites.map((site) => ({
      x: site.x,
      z: site.z,
      radius: site.grade === 'rich'
        ? RICH_MINERAL_DEPOSIT_PROTECTION_RADIUS
        : ORDINARY_MINERAL_DEPOSIT_PROTECTION_RADIUS,
      resource: site.resource,
      isRich: site.grade === 'rich',
    })),
  ];
}

export function isPhysicalDepositAt(
  deposits: readonly PhysicalDepositFootprint[],
  x: number,
  z: number,
): boolean {
  return deposits.some((deposit) =>
    Math.hypot(x - deposit.x, z - deposit.z) <= deposit.radius
  );
}

export function polygonOverlapsPhysicalDeposit(
  polygon: readonly Point2[],
  deposits: readonly PhysicalDepositFootprint[],
): boolean {
  return deposits.some((deposit) =>
    polygonOverlapsCircle(polygon, deposit.x, deposit.z, deposit.radius)
  );
}

function polygonOverlapsCircle(
  polygon: readonly Point2[],
  centerX: number,
  centerZ: number,
  radius: number,
): boolean {
  if (polygon.length < 3 || radius < 0) return false;
  const radiusSq = radius * radius;
  if (pointInsideConvexPolygon(centerX, centerZ, polygon)) return true;

  for (let index = 0; index < polygon.length; index++) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (distanceToSegmentSquared(centerX, centerZ, start, end) <= radiusSq) {
      return true;
    }
  }
  return false;
}

function pointInsideConvexPolygon(
  x: number,
  z: number,
  polygon: readonly Point2[],
): boolean {
  let sign = 0;
  for (let index = 0; index < polygon.length; index++) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const cross = (end.x - start.x) * (z - start.z)
      - (end.z - start.z) * (x - start.x);
    if (Math.abs(cross) <= 1e-9) continue;
    const nextSign = Math.sign(cross);
    if (sign !== 0 && nextSign !== sign) return false;
    sign = nextSign;
  }
  return true;
}

function distanceToSegmentSquared(
  x: number,
  z: number,
  start: Point2,
  end: Point2,
): number {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq <= 1e-12) {
    return (x - start.x) ** 2 + (z - start.z) ** 2;
  }
  const t = Math.max(
    0,
    Math.min(1, ((x - start.x) * dx + (z - start.z) * dz) / lengthSq),
  );
  const nearestX = start.x + dx * t;
  const nearestZ = start.z + dz * t;
  return (x - nearestX) ** 2 + (z - nearestZ) ** 2;
}
