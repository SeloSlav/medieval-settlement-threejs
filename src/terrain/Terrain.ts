import * as THREE from 'three';

export type TerrainBounds = {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export class Terrain {
  readonly size = 520;
  readonly resolution = 241;
  readonly bounds: TerrainBounds;
  readonly mesh: THREE.Mesh;

  constructor(material: THREE.Material) {
    const half = this.size * 0.5;
    this.bounds = { minX: -half, maxX: half, minZ: -half, maxZ: half };
    this.mesh = new THREE.Mesh(this.createGeometry(), material);
    this.mesh.name = 'Continuous terrain heightfield';
    this.mesh.receiveShadow = true;
    this.mesh.userData.terrain = true;
  }

  getHeightAt(x: number, z: number): number {
    const n1 = this.fbm(x * 0.018, z * 0.018, 4) * 5.8;
    const n2 = this.fbm(x * 0.052 + 18.4, z * 0.052 - 9.2, 3) * 1.4;
    const broad = Math.sin(x * 0.018 + z * 0.007) * 1.5 + Math.cos(z * 0.015) * 1.1;
    const basin = -Math.exp(-(x * x + z * z) / 18000) * 1.8;
    return n1 + n2 + broad + basin;
  }

  getPointAt(x: number, z: number, offset = 0): THREE.Vector3 {
    return new THREE.Vector3(x, this.getHeightAt(x, z) + offset, z);
  }

  clampXZ(x: number, z: number): { x: number; z: number } {
    return {
      x: THREE.MathUtils.clamp(x, this.bounds.minX, this.bounds.maxX),
      z: THREE.MathUtils.clamp(z, this.bounds.minZ, this.bounds.maxZ),
    };
  }

  dispose(): void {
    this.mesh.geometry.dispose();
  }

  private createGeometry(): THREE.BufferGeometry {
    const positions: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const step = this.size / (this.resolution - 1);
    const half = this.size * 0.5;

    for (let zIndex = 0; zIndex < this.resolution; zIndex++) {
      for (let xIndex = 0; xIndex < this.resolution; xIndex++) {
        const x = -half + xIndex * step;
        const z = -half + zIndex * step;
        positions.push(x, this.getHeightAt(x, z), z);
        uvs.push(x / 18, z / 18);
        colors.push(...this.getTerrainBlendTint(x, z));
      }
    }

    for (let zIndex = 0; zIndex < this.resolution - 1; zIndex++) {
      for (let xIndex = 0; xIndex < this.resolution - 1; xIndex++) {
        const a = zIndex * this.resolution + xIndex;
        const b = a + 1;
        const c = a + this.resolution;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  private getTerrainBlendTint(x: number, z: number): [number, number, number] {
    const dirtNoise = this.fbm(x * 0.022, z * 0.022, 4) + 0.5;
    const liveNoise = this.fbm(x * 0.0165 + 101.3, z * 0.0165 - 55.8, 4) + 0.5;
    const deadNoise = this.fbm(x * 0.011 + 31.7, z * 0.011 - 19.4, 4) + 0.5;
    const gravelNoise = this.fbm(x * 0.038 - 47.2, z * 0.038 + 22.1, 4) + 0.5;
    const rawDirt = this.smoothstep(0.58, 0.82, dirtNoise) + 0.018;
    const rawDead = this.smoothstep(0.54, 0.8, deadNoise) + 0.024;
    const rawLive = this.smoothstep(0.16, 0.56, liveNoise) + 0.28;
    const primarySum = Math.max(rawDirt + rawDead + rawLive, 0.0001);
    const dirtWeight = rawDirt / primarySum;
    const deadWeight = rawDead / primarySum;
    const liveWeight = rawLive / primarySum;
    const gravelOfDirt = this.smoothstep(0.64, 0.86, gravelNoise) * 0.28;
    const gravelWeight = dirtWeight * gravelOfDirt;
    const visibleDirtWeight = dirtWeight * (1 - gravelOfDirt);
    const macro = this.fbm(x * 0.0085 + 8, z * 0.0085 + 29, 4) + 0.5;
    const macroMul = 0.9 + macro * 0.22;

    const live: [number, number, number] = [0.96, 1.06, 0.9];
    const dead: [number, number, number] = [1.08, 1.02, 0.86];
    const dirt: [number, number, number] = [1.08, 0.93, 0.78];
    const gravel: [number, number, number] = [0.98, 0.98, 0.95];
    return [
      (live[0] * liveWeight + dead[0] * deadWeight + dirt[0] * visibleDirtWeight + gravel[0] * gravelWeight) * macroMul,
      (live[1] * liveWeight + dead[1] * deadWeight + dirt[1] * visibleDirtWeight + gravel[1] * gravelWeight) * macroMul,
      (live[2] * liveWeight + dead[2] * deadWeight + dirt[2] * visibleDirtWeight + gravel[2] * gravelWeight) * macroMul,
    ];
  }

  private smoothstep(edge0: number, edge1: number, value: number): number {
    const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  private fbm(x: number, z: number, octaves: number): number {
    let value = 0;
    let amplitude = 0.5;
    let frequency = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      value += this.valueNoise(x * frequency, z * frequency) * amplitude;
      norm += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return value / norm - 0.5;
  }

  private valueNoise(x: number, z: number): number {
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const tx = x - x0;
    const tz = z - z0;
    const sx = tx * tx * (3 - 2 * tx);
    const sz = tz * tz * (3 - 2 * tz);
    const a = this.hash(x0, z0);
    const b = this.hash(x0 + 1, z0);
    const c = this.hash(x0, z0 + 1);
    const d = this.hash(x0 + 1, z0 + 1);
    return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, sx), THREE.MathUtils.lerp(c, d, sx), sz);
  }

  private hash(x: number, z: number): number {
    const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
    return n - Math.floor(n);
  }
}


