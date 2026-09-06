import * as THREE from 'three';
import { retainDynamicRenderSubtree } from '../scene/StaticTransformBoundary.ts';

const SMOKE_GEOMETRY = new THREE.SphereGeometry(1, 6, 4);
const SMOKE_COLOR = 0xd4d8df;

const PUFF_INTERVAL_MIN_SEC = 2.8;
const PUFF_INTERVAL_MAX_SEC = 6.5;
const PUFF_PARTICLE_MIN = 3;
const PUFF_PARTICLE_MAX = 5;

type SmokeParticle = {
  mesh: THREE.Mesh;
  age: number;
  lifetime: number;
  riseSpeed: number;
  driftX: number;
  driftZ: number;
  startScale: number;
};

function nextPuffDelay(): number {
  return PUFF_INTERVAL_MIN_SEC + Math.random() * (PUFF_INTERVAL_MAX_SEC - PUFF_INTERVAL_MIN_SEC);
}

function disposeSmokeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    material.forEach((entry) => entry.dispose());
    return;
  }
  material.dispose();
}

function createSmokeMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: SMOKE_COLOR,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
}

export class ChimneySmokeEmitter {
  private readonly root: THREE.Object3D;
  private readonly particles: SmokeParticle[] = [];
  private timeUntilNextPuff = 0;
  private active = false;

  constructor(parent: THREE.Object3D, seed: number) {
    this.root = new THREE.Object3D();
    this.root.name = 'ChimneySmoke';
    retainDynamicRenderSubtree(this.root);
    parent.add(this.root);
    this.timeUntilNextPuff = (seed % 97) / 97 * PUFF_INTERVAL_MAX_SEC;
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (!active) this.clearParticles();
  }

  tick(dt: number): void {
    if (!this.active) return;

    this.timeUntilNextPuff -= dt;
    if (this.timeUntilNextPuff <= 0) {
      this.spawnPuff();
      this.timeUntilNextPuff = nextPuffDelay();
    }

    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const particle = this.particles[i];
      particle.age += dt;
      const t = particle.age / particle.lifetime;
      if (t >= 1) {
        this.root.remove(particle.mesh);
        disposeSmokeMaterial(particle.mesh.material);
        this.particles.splice(i, 1);
        continue;
      }

      particle.mesh.position.y += particle.riseSpeed * dt;
      particle.mesh.position.x += particle.driftX * dt;
      particle.mesh.position.z += particle.driftZ * dt;

      const scale = particle.startScale * (1 + t * 2.1);
      particle.mesh.scale.setScalar(scale);

      const material = particle.mesh.material;
      if (material instanceof THREE.MeshBasicMaterial) {
        material.opacity = 0.48 * (1 - t) * (1 - t);
      }
    }
    // The house is rigid between state updates. Smoke owns its moving subtree.
    this.root.updateWorldMatrix(true, true);
  }

  dispose(): void {
    this.clearParticles();
    this.root.removeFromParent();
  }

  private clearParticles(): void {
    for (const particle of this.particles) {
      this.root.remove(particle.mesh);
      disposeSmokeMaterial(particle.mesh.material);
    }
    this.particles.length = 0;
  }

  private spawnPuff(): void {
    const count = PUFF_PARTICLE_MIN + Math.floor(Math.random() * (PUFF_PARTICLE_MAX - PUFF_PARTICLE_MIN + 1));
    for (let i = 0; i < count; i += 1) {
      const mesh = new THREE.Mesh(SMOKE_GEOMETRY, createSmokeMaterial());
      mesh.position.set(
        (Math.random() - 0.5) * 0.14,
        Math.random() * 0.1,
        (Math.random() - 0.5) * 0.14,
      );
      const startScale = 0.07 + Math.random() * 0.05;
      mesh.scale.setScalar(startScale);
      this.root.add(mesh);
      this.particles.push({
        mesh,
        age: i * 0.18,
        lifetime: 2.1 + Math.random() * 1.4,
        riseSpeed: 0.42 + Math.random() * 0.28,
        driftX: (Math.random() - 0.5) * 0.14,
        driftZ: (Math.random() - 0.5) * 0.14,
        startScale,
      });
    }
  }
}
