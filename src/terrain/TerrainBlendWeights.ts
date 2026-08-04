import * as THREE from 'three';
import { getActiveWorldDimensions } from '../world/worldGenerationContext.ts';

export function sampleTerrainBlendWeights(x: number, z: number): [number, number, number] {
  const warpX = fbm(x * 0.006 + 41.1, z * 0.006 - 17.8, 4) * 22;
  const warpZ = fbm(x * 0.006 - 12.5, z * 0.006 + 73.2, 4) * 22;
  const wx = x + warpX;
  const wz = z + warpZ;
  const meadowNoise = fbm(wx * 0.011 + 101.3, wz * 0.011 - 55.8, 4) + 0.5;
  const denseNoise = fbm(wx * 0.015, wz * 0.015, 4) + 0.5;
  const dryNoise = fbm(wx * 0.0075 + 31.7, wz * 0.0075 - 19.4, 4) + 0.5;
  const hillT = sampleEdgeHillFactor(x, z);
  const rawMeadow = smoothstep(0.08, 0.54, meadowNoise) + 0.52 - hillT * 0.14;
  const rawDense = smoothstep(0.72, 0.94, denseNoise) * 0.38 + 0.1 + hillT * 0.26;
  const rawDry = smoothstep(0.72, 0.94, dryNoise) * 0.3 + 0.14 + hillT * 0.12;
  const sum = Math.max(rawMeadow + rawDense + rawDry, 0.0001);
  return [rawMeadow / sum, rawDense / sum, rawDry / sum];
}

export function sampleTerrainUv(x: number, z: number): [number, number] {
  const scale = 48;
  const rotatedX = x * 0.67 - z * 0.74;
  const rotatedZ = x * 0.74 + z * 0.67;
  const warpX = fbm(x * 0.0048 + 13.2, z * 0.0048 - 7.4, 4) * 0.38 + fbm(x * 0.018 - 71.5, z * 0.018 + 19.8, 3) * 0.055;
  const warpZ = fbm(x * 0.0053 - 28.6, z * 0.0053 + 44.1, 4) * 0.38 + fbm(x * 0.016 + 53.7, z * 0.016 - 38.2, 3) * 0.055;
  return [rotatedX / scale + warpX, rotatedZ / (scale * 1.17) + warpZ];
}

function sampleEdgeHillFactor(x: number, z: number): number {
  const { generationSize, terrainSize } = getActiveWorldDimensions();
  const edgeDistance = Math.max(Math.abs(x), Math.abs(z));
  const hillStart = generationSize * 0.44;
  const hillEnd = terrainSize * 0.5;
  return smoothstep(hillStart, hillEnd, edgeDistance);
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function fbm(x: number, z: number, octaves: number): number {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    value += valueNoise(x * frequency, z * frequency) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / norm - 0.5;
}

function valueNoise(x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = x - x0;
  const tz = z - z0;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const a = hash(x0, z0);
  const b = hash(x0 + 1, z0);
  const c = hash(x0, z0 + 1);
  const d = hash(x0 + 1, z0 + 1);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, sx), THREE.MathUtils.lerp(c, d, sx), sz);
}

function hash(x: number, z: number): number {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}
