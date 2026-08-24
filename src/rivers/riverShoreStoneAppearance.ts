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
  const cluster = valueNoise2(x * 0.018 + 21.7, z * 0.018 - 4.9);
  const detail = valueNoise2(x * 0.115 - 8.3, z * 0.115 + 13.1);
  const individual = valueNoise2(x * 0.39 + 5.8, z * 0.39 - 19.2);
  const clustered = smoothstep(0.46, 0.72, cluster);
  // Scale variation must never double as a visibility mask: shrinking most
  // instances to six percent made the otherwise populated banks look empty.
  const scale = 0.58 + clustered * 0.3 + detail * 0.2 + individual * 0.12;
  return Math.max(0.58, Math.min(1.2, scale));
}

export function computeShoreStoneTint(x: number, z: number): number {
  const weathering = valueNoise2(x * 0.065 + 3.6, z * 0.065 - 17.4);
  const fineGrain = valueNoise2(x * 0.17 - 6.1, z * 0.17 + 9.8);
  return 0.84 + (1 - 0.84) * (weathering * 0.72 + fineGrain * 0.28);
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
