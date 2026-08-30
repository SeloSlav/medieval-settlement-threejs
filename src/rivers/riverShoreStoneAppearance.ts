function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function hashGrid2(x: number, z: number): number {
  const value = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function valueNoise2(x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hashGrid2(x0, z0);
  const b = hashGrid2(x0 + 1, z0);
  const c = hashGrid2(x0, z0 + 1);
  const d = hashGrid2(x0 + 1, z0 + 1);
  const x0Lerp = a + (b - a) * ux;
  const x1Lerp = c + (d - c) * ux;
  return x0Lerp + (x1Lerp - x0Lerp) * uz;
}

export function computeShoreStoneVisualScale(x: number, z: number): number {
  const cluster = computeShoreStoneClusterDensity(x, z);
  const detail = valueNoise2(x * 0.115 - 8.3, z * 0.115 + 13.1);
  const individual = valueNoise2(x * 0.39 + 5.8, z * 0.39 - 19.2);
  const slab = smoothstep(0.68, 0.92, individual);
  // Cluster interiors carry a few dominant slabs while their skirts retain
  // smaller talus. Visibility is still owned by placement, never by collapsing
  // an instance toward zero scale.
  const scale = 0.58 + cluster * 0.2 + detail * 0.15 + slab * 0.27;
  return Math.max(0.58, Math.min(1.2, scale));
}

/**
 * Low-frequency talus-reach field. The hard zero outside the reach mask is
 * intentional: dry-bank carbonate appears in intermittent deposits separated
 * by readable meadow gaps instead of tracing the whole waterline as a curb.
 */
export function computeShoreStoneClusterDensity(x: number, z: number): number {
  const reach = valueNoise2(
    x * 0.011 + z * 0.003 - 14.2,
    z * 0.014 - x * 0.002 + 27.6,
  );
  const localBar = valueNoise2(x * 0.052 + 8.7, z * 0.052 - 11.9);
  const brokenEdge = valueNoise2(x * 0.13 - 3.1, z * 0.13 + 6.4);
  const reachPresence = smoothstep(0.44, 0.67, reach);
  if (reachPresence <= 0) return 0;
  const barPresence = smoothstep(0.3, 0.76, localBar);
  return Math.max(
    0,
    Math.min(
      1,
      reachPresence * (0.28 + barPresence * 0.58 + brokenEdge * 0.14),
    ),
  );
}

export function computeShoreStoneTint(x: number, z: number): number {
  const weathering = valueNoise2(x * 0.065 + 3.6, z * 0.065 - 17.4);
  const fineGrain = valueNoise2(x * 0.17 - 6.1, z * 0.17 + 9.8);
  // Pale Jurassic limestone / Triassic dolomite baseline. Keep enough range
  // for wet cool-grey stones without returning to the old brown-rock palette.
  return 0.74 + (0.98 - 0.74) * (weathering * 0.72 + fineGrain * 0.28);
}

export function computeShoreStoneMoss(x: number, z: number): number {
  return valueNoise2(x * 0.14 + 18.4, z * 0.14 - 12.7);
}

/**
 * Patchy dry-bank moss colonies. Channel crowns deliberately keep the older
 * continuous moisture sample so this talus-only polish cannot alter their
 * water-contact appearance or hydraulic silhouette.
 */
export function computeShoreStoneTalusMoss(x: number, z: number): number {
  const colony = valueNoise2(x * 0.047 - 9.8, z * 0.047 + 16.3);
  const fleck = valueNoise2(x * 0.22 + 4.1, z * 0.22 - 7.6);
  return smoothstep(0.49, 0.75, colony)
    * (0.24 + smoothstep(0.28, 0.82, fleck) * 0.76);
}

export type ShoreStoneVisualVariation = {
  aspect: number;
  height: number;
  yaw: number;
  offsetX: number;
  offsetZ: number;
  sink: number;
};

export function computeShoreStoneVisualVariation(
  x: number,
  z: number,
): ShoreStoneVisualVariation {
  const shape = valueNoise2(x * 0.31 - 7.4, z * 0.31 + 22.6);
  const height = valueNoise2(x * 0.43 + 15.1, z * 0.43 - 8.8);
  const yaw = valueNoise2(x * 0.37 - 24.2, z * 0.37 + 3.9);
  const offsetX = valueNoise2(x * 0.23 + 11.8, z * 0.23 - 26.1);
  const offsetZ = valueNoise2(x * 0.29 - 18.5, z * 0.29 + 14.7);
  const sink = valueNoise2(x * 0.19 + 4.6, z * 0.19 - 31.4);
  return {
    aspect: 0.64 + shape * 0.86,
    height: 0.72 + height * 0.5,
    yaw: yaw * Math.PI * 2,
    offsetX: (offsetX - 0.5) * 0.9,
    offsetZ: (offsetZ - 0.5) * 0.9,
    sink: 0.06 + sink * 0.2,
  };
}
