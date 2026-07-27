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
  const cluster = valueNoise2(x * 0.026 + 21.7, z * 0.026 - 4.9);
  const detail = valueNoise2(x * 0.11 - 8.3, z * 0.11 + 13.1);
  const clustered = smoothstep(0.28, 0.78, cluster);
  const presenceNoise = valueNoise2(x * 0.043 - 11.6, z * 0.043 + 7.2);
  const presence = smoothstep(0.4, 0.72, presenceNoise);
  const clusteredPresence = presence * (0.58 + clustered * 0.42);
  const scale = (0.18 + (1.04 - 0.18) * clusteredPresence) * (0.9 + detail * 0.1);
  return Math.max(0.18, Math.min(1.04, scale));
}

export function computeShoreStoneTint(x: number, z: number): number {
  const weathering = valueNoise2(x * 0.075 + 3.6, z * 0.075 - 17.4);
  return 0.58 + (0.9 - 0.58) * weathering;
}
