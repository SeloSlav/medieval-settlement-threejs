import * as THREE from 'three';
import type { CombatProjectileKind } from './combatWeaponAnimation.ts';

const MAX_PROJECTILES = 96;
const MAX_MATCHLOCK_EFFECTS = 20;
const SMOKE_PUFFS_PER_SHOT = 4;
const FORWARD = new THREE.Vector3(0, 0, 1);
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** Arrows, bolts, flashes and smoke remain four instanced draw calls at peak. */
export const COMBAT_PROJECTILE_DRAW_CALL_BUDGET = 4;

type ProjectileVisual = {
  kind: 'arrow' | 'bolt';
  start: THREE.Vector3;
  end: THREE.Vector3;
  age: number;
  duration: number;
  arcHeight: number;
};

type MatchlockVisual = {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  lateral: readonly [number, number, number, number];
  age: number;
};

export type CombatProjectileSample = {
  position: THREE.Vector3;
  direction: THREE.Vector3;
};

/** Deterministic ballistic presentation shared by runtime and focused tests. */
export function sampleCombatProjectile(
  start: THREE.Vector3,
  end: THREE.Vector3,
  progress: number,
  arcHeight: number,
  target: CombatProjectileSample,
): CombatProjectileSample {
  const t = THREE.MathUtils.clamp(progress, 0, 1);
  const nextT = Math.min(1, t + 0.0125);
  target.position.copy(start).lerp(end, t);
  target.position.y += 4 * t * (1 - t) * arcHeight;
  target.direction.copy(start).lerp(end, nextT);
  target.direction.y += 4 * nextT * (1 - nextT) * arcHeight;
  target.direction.sub(target.position);
  if (target.direction.lengthSq() < 1e-8) target.direction.copy(end).sub(start);
  if (target.direction.lengthSq() < 1e-8) target.direction.copy(FORWARD);
  target.direction.normalize();
  return target;
}

/**
 * Bounded, allocation-stable ranged combat presentation. Only animated rigs
 * emit into this layer; every moving element is batched by visual material.
 */
export class CombatProjectileRenderer {
  private readonly group = new THREE.Group();
  private readonly projectilePool: ProjectileVisual[] = [];
  private readonly matchlockPool: MatchlockVisual[] = [];
  private readonly arrowGeometry = projectileShaftGeometry(0.006, 0.72);
  private readonly boltGeometry = projectileShaftGeometry(0.009, 0.46);
  private readonly flashGeometry = new THREE.OctahedronGeometry(0.085, 0);
  private readonly smokeGeometry = new THREE.SphereGeometry(0.07, 7, 5);
  private readonly arrowMaterial = new THREE.MeshStandardMaterial({
    color: 0x8c6335,
    roughness: 0.82,
    metalness: 0.04,
  });
  private readonly boltMaterial = new THREE.MeshStandardMaterial({
    color: 0x6e5140,
    roughness: 0.72,
    metalness: 0.12,
  });
  private readonly flashMaterial = new THREE.MeshBasicMaterial({
    color: 0xffb34d,
    transparent: true,
    opacity: 0.94,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  private readonly smokeMaterial = new THREE.MeshBasicMaterial({
    color: 0xaaa69c,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
  });
  private readonly arrowInstances = new THREE.InstancedMesh(
    this.arrowGeometry,
    this.arrowMaterial,
    MAX_PROJECTILES,
  );
  private readonly boltInstances = new THREE.InstancedMesh(
    this.boltGeometry,
    this.boltMaterial,
    MAX_PROJECTILES,
  );
  private readonly flashInstances = new THREE.InstancedMesh(
    this.flashGeometry,
    this.flashMaterial,
    MAX_MATCHLOCK_EFFECTS,
  );
  private readonly smokeInstances = new THREE.InstancedMesh(
    this.smokeGeometry,
    this.smokeMaterial,
    MAX_MATCHLOCK_EFFECTS * SMOKE_PUFFS_PER_SHOT,
  );
  private readonly sample: CombatProjectileSample = {
    position: new THREE.Vector3(),
    direction: new THREE.Vector3(),
  };
  private readonly scratchStart = new THREE.Vector3();
  private readonly scratchEnd = new THREE.Vector3();
  private readonly scratchDirection = new THREE.Vector3();
  private readonly scratchRight = new THREE.Vector3();
  private readonly scratchPosition = new THREE.Vector3();
  private readonly scratchQuaternion = new THREE.Quaternion();
  private readonly scratchScale = new THREE.Vector3(1, 1, 1);
  private readonly scratchMatrix = new THREE.Matrix4();

  constructor(parent: THREE.Group) {
    this.group.name = 'Combat projectiles and matchlock effects';
    for (const mesh of [
      this.arrowInstances,
      this.boltInstances,
      this.flashInstances,
      this.smokeInstances,
    ]) {
      mesh.count = 0;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
    }
    parent.add(this.group);
  }

  spawnRelease(
    kind: CombatProjectileKind,
    originWorld: THREE.Vector3,
    targetWorld: THREE.Vector3,
    sequence: number,
  ): void {
    this.group.updateWorldMatrix(true, false);
    const start = this.group.worldToLocal(this.scratchStart.copy(originWorld));
    const end = this.group.worldToLocal(this.scratchEnd.copy(targetWorld));
    const direction = this.scratchDirection.copy(end).sub(start);
    if (direction.lengthSq() < 1e-6) direction.set(0, 0, 1);
    direction.normalize();
    if (kind === 'lead-shot') {
      this.spawnMatchlock(start, direction, sequence);
      return;
    }
    this.spawnProjectile(kind, start, end, sequence);
  }

  update(dtSeconds: number): void {
    const dt = THREE.MathUtils.clamp(dtSeconds, 0, 0.08);
    if (dt <= 0) return;
    let arrowCount = 0;
    let boltCount = 0;
    for (let index = 0; index < this.projectilePool.length;) {
      const projectile = this.projectilePool[index]!;
      projectile.age += dt;
      const progress = projectile.age / projectile.duration;
      if (progress >= 1) {
        this.projectilePool[index] = this.projectilePool.at(-1)!;
        this.projectilePool.pop();
        continue;
      }
      sampleCombatProjectile(
        projectile.start,
        projectile.end,
        progress,
        projectile.arcHeight,
        this.sample,
      );
      this.scratchQuaternion.setFromUnitVectors(FORWARD, this.sample.direction);
      this.scratchScale.set(1, 1, 1);
      this.scratchMatrix.compose(
        this.sample.position,
        this.scratchQuaternion,
        this.scratchScale,
      );
      if (projectile.kind === 'arrow') {
        this.arrowInstances.setMatrixAt(arrowCount++, this.scratchMatrix);
      } else {
        this.boltInstances.setMatrixAt(boltCount++, this.scratchMatrix);
      }
      index += 1;
    }
    this.setInstanceCount(this.arrowInstances, arrowCount);
    this.setInstanceCount(this.boltInstances, boltCount);

    let flashCount = 0;
    let smokeCount = 0;
    for (let index = 0; index < this.matchlockPool.length;) {
      const effect = this.matchlockPool[index]!;
      effect.age += dt;
      const smokeProgress = effect.age / 0.78;
      if (smokeProgress >= 1) {
        this.matchlockPool[index] = this.matchlockPool.at(-1)!;
        this.matchlockPool.pop();
        continue;
      }
      const flashProgress = effect.age / 0.075;
      if (flashProgress < 1) {
        const flashScale = 0.45 + Math.sin(flashProgress * Math.PI) * 1.35;
        this.scratchPosition.copy(effect.origin).addScaledVector(effect.direction, 0.075);
        this.scratchQuaternion.setFromUnitVectors(FORWARD, effect.direction);
        this.scratchScale.set(flashScale * 0.75, flashScale * 0.75, flashScale * 1.5);
        this.scratchMatrix.compose(
          this.scratchPosition,
          this.scratchQuaternion,
          this.scratchScale,
        );
        this.flashInstances.setMatrixAt(flashCount++, this.scratchMatrix);
      }
      this.scratchRight.crossVectors(effect.direction, WORLD_UP);
      if (this.scratchRight.lengthSq() < 1e-6) this.scratchRight.set(1, 0, 0);
      else this.scratchRight.normalize();
      for (let puffIndex = 0; puffIndex < SMOKE_PUFFS_PER_SHOT; puffIndex += 1) {
        const stagger = puffIndex * 0.035;
        const puffAge = effect.age - stagger;
        if (puffAge <= 0) continue;
        this.scratchPosition.copy(effect.origin)
          .addScaledVector(effect.direction, 0.055 + puffIndex * 0.035 + puffAge * 0.08)
          .addScaledVector(WORLD_UP, puffIndex * 0.012 + puffAge * (0.11 + puffIndex * 0.025))
          .addScaledVector(this.scratchRight, effect.lateral[puffIndex] * 0.035);
        const fadeScale = Math.sqrt(Math.max(0.02, 1 - smokeProgress));
        const scale = (0.55 + puffIndex * 0.08 + puffAge * (1.3 + puffIndex * 0.12))
          * fadeScale;
        this.scratchScale.setScalar(scale);
        this.scratchQuaternion.identity();
        this.scratchMatrix.compose(
          this.scratchPosition,
          this.scratchQuaternion,
          this.scratchScale,
        );
        this.smokeInstances.setMatrixAt(smokeCount++, this.scratchMatrix);
      }
      index += 1;
    }
    this.setInstanceCount(this.flashInstances, flashCount);
    this.setInstanceCount(this.smokeInstances, smokeCount);
  }

  dispose(): void {
    this.projectilePool.length = 0;
    this.matchlockPool.length = 0;
    for (const mesh of [
      this.arrowInstances,
      this.boltInstances,
      this.flashInstances,
      this.smokeInstances,
    ]) mesh.removeFromParent();
    this.arrowGeometry.dispose();
    this.boltGeometry.dispose();
    this.flashGeometry.dispose();
    this.smokeGeometry.dispose();
    this.arrowMaterial.dispose();
    this.boltMaterial.dispose();
    this.flashMaterial.dispose();
    this.smokeMaterial.dispose();
    this.group.removeFromParent();
  }

  private spawnProjectile(
    kind: 'arrow' | 'bolt',
    start: THREE.Vector3,
    target: THREE.Vector3,
    sequence: number,
  ): void {
    let projectile: ProjectileVisual;
    if (this.projectilePool.length < MAX_PROJECTILES) {
      projectile = {
        kind,
        start: new THREE.Vector3(),
        end: new THREE.Vector3(),
        age: 0,
        duration: 0.3,
        arcHeight: 0,
      };
      this.projectilePool.push(projectile);
    } else {
      projectile = this.projectilePool.reduce((oldest, candidate) => (
        candidate.age / candidate.duration > oldest.age / oldest.duration
          ? candidate
          : oldest
      ));
    }
    projectile.kind = kind;
    projectile.start.copy(start);
    projectile.end.copy(target);
    const scatter = signedUnitHash(sequence ^ (kind === 'arrow' ? 0x41c6ce57 : 0x9e3779b9));
    projectile.end.y += scatter * (kind === 'arrow' ? 0.12 : 0.07);
    projectile.end.x += signedUnitHash(sequence ^ 0x85ebca6b) * 0.045;
    const distance = projectile.start.distanceTo(projectile.end);
    const speed = kind === 'arrow' ? 25 : 32;
    projectile.duration = THREE.MathUtils.clamp(distance / speed, 0.11, 0.72);
    projectile.arcHeight = kind === 'arrow'
      ? THREE.MathUtils.clamp(distance * 0.035, 0.06, 0.52)
      : THREE.MathUtils.clamp(distance * 0.018, 0.025, 0.28);
    projectile.age = 0;
  }

  private spawnMatchlock(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    sequence: number,
  ): void {
    let effect: MatchlockVisual;
    if (this.matchlockPool.length < MAX_MATCHLOCK_EFFECTS) {
      effect = {
        origin: new THREE.Vector3(),
        direction: new THREE.Vector3(),
        lateral: [0, 0, 0, 0],
        age: 0,
      };
      this.matchlockPool.push(effect);
    } else {
      effect = this.matchlockPool.reduce((oldest, candidate) => (
        candidate.age > oldest.age ? candidate : oldest
      ));
    }
    effect.origin.copy(origin);
    effect.direction.copy(direction);
    effect.lateral = [
      signedUnitHash(sequence ^ 0x27d4eb2d),
      signedUnitHash(sequence ^ 0x4f1bbcdc),
      signedUnitHash(sequence ^ 0x165667b1),
      signedUnitHash(sequence ^ 0x85ebca6b),
    ];
    effect.age = 0;
  }

  private setInstanceCount(mesh: THREE.InstancedMesh, count: number): void {
    const changed = mesh.count !== count;
    mesh.count = count;
    if (count > 0 || changed) mesh.instanceMatrix.needsUpdate = true;
  }
}

function projectileShaftGeometry(radius: number, length: number): THREE.BufferGeometry {
  const geometry = new THREE.CylinderGeometry(radius, radius, length, 6);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, 0, length * 0.5);
  geometry.computeBoundingSphere();
  return geometry;
}

function signedUnitHash(value: number): number {
  let hash = value >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0xffff_ffff * 2 - 1;
}
