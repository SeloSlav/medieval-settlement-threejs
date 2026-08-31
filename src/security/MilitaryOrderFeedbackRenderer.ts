import * as THREE from 'three';

export type MilitaryOrderFeedbackKind = 'move' | 'attack';

export const MILITARY_ORDER_FEEDBACK_LIFETIME_SECONDS = 1.35;

export type MilitaryOrderFeedbackSample = {
  visible: boolean;
  opacity: number;
  ringScale: number;
  chevronScale: number;
  lift: number;
};

export type MilitaryOrderFeedbackDiagnostics = MilitaryOrderFeedbackSample & {
  kind: MilitaryOrderFeedbackKind;
  x: number;
  y: number;
  z: number;
  ageSeconds: number;
};

const MOVE_COLOR = 0xe1b538;
const ATTACK_COLOR = 0xd95c38;

/**
 * One normalized acknowledgement envelope shared by rendering and tests.
 * It contracts quickly onto the picked point, holds long enough to read, then
 * expands and fades without depending on frame rate.
 */
export function sampleMilitaryOrderFeedback(ageSeconds: number): MilitaryOrderFeedbackSample {
  const finiteAge = Number.isFinite(ageSeconds) ? Math.max(0, ageSeconds) : 0;
  const progress = THREE.MathUtils.clamp(
    finiteAge / MILITARY_ORDER_FEEDBACK_LIFETIME_SECONDS,
    0,
    1,
  );
  if (finiteAge >= MILITARY_ORDER_FEEDBACK_LIFETIME_SECONDS) {
    return {
      visible: false,
      opacity: 0,
      ringScale: 1.3,
      chevronScale: 1.08,
      lift: 0.035,
    };
  }

  const acquire = THREE.MathUtils.smoothstep(progress, 0, 0.18);
  const release = THREE.MathUtils.smoothstep(progress, 0.56, 1);
  const visibleEnvelope = 1 - release;
  return {
    visible: visibleEnvelope > 0.001,
    opacity: visibleEnvelope,
    ringScale: progress < 0.18
      ? THREE.MathUtils.lerp(1.46, 1, acquire)
      : THREE.MathUtils.lerp(1, 1.3, release),
    chevronScale: THREE.MathUtils.lerp(1.2, 1, acquire)
      + Math.sin(progress * Math.PI) * 0.06,
    lift: 0.035 + Math.sin(progress * Math.PI) * 0.045,
  };
}

/**
 * A pooled, textureless ground marker. The same two meshes are reused for
 * every order; no object or GPU allocation occurs when the player clicks.
 */
export class MilitaryOrderFeedbackRenderer {
  readonly group = new THREE.Group();

  private readonly ringMaterial = createMaterial(MOVE_COLOR, 0.7);
  private readonly chevronMaterial = createMaterial(MOVE_COLOR, 0.98);
  private readonly ring = new THREE.Mesh(
    new THREE.RingGeometry(0.83, 1.01, 48),
    this.ringMaterial,
  );
  private readonly chevrons = new THREE.Mesh(
    createRadialChevronGeometry(),
    this.chevronMaterial,
  );
  private issuedAtMs = Number.NaN;
  private baseY = 0;
  private kind: MilitaryOrderFeedbackKind = 'move';

  constructor(parent: THREE.Object3D) {
    this.group.name = 'Military order destination feedback';
    this.group.visible = false;
    this.group.renderOrder = 96;
    this.ring.name = 'Military order destination pulse';
    this.chevrons.name = 'Military order destination chevrons';
    this.ring.rotation.x = -Math.PI / 2;
    this.chevrons.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 96;
    this.chevrons.renderOrder = 97;
    this.ring.frustumCulled = false;
    this.chevrons.frustumCulled = false;
    this.group.add(this.ring, this.chevrons);
    parent.add(this.group);
  }

  show(
    x: number,
    y: number,
    z: number,
    kind: MilitaryOrderFeedbackKind,
    issuedAtMs: number,
  ): void {
    this.kind = kind;
    this.issuedAtMs = Number.isFinite(issuedAtMs) ? issuedAtMs : 0;
    this.baseY = Number.isFinite(y) ? y : 0;
    this.group.position.set(
      Number.isFinite(x) ? x : 0,
      this.baseY,
      Number.isFinite(z) ? z : 0,
    );
    const color = kind === 'attack' ? ATTACK_COLOR : MOVE_COLOR;
    this.ringMaterial.color.setHex(color);
    this.chevronMaterial.color.setHex(color);
    this.update(this.issuedAtMs);
  }

  update(nowMs: number): void {
    if (!Number.isFinite(this.issuedAtMs)) {
      this.group.visible = false;
      return;
    }
    const ageSeconds = Math.max(0, (nowMs - this.issuedAtMs) / 1_000);
    const sample = sampleMilitaryOrderFeedback(ageSeconds);
    this.group.visible = sample.visible;
    if (!sample.visible) return;

    this.group.position.y = this.baseY + sample.lift;
    this.ring.scale.setScalar(sample.ringScale);
    this.chevrons.scale.setScalar(sample.chevronScale);
    this.ringMaterial.opacity = sample.opacity * 0.7;
    this.chevronMaterial.opacity = sample.opacity * 0.98;
  }

  diagnostics(nowMs: number): MilitaryOrderFeedbackDiagnostics {
    const ageSeconds = Number.isFinite(this.issuedAtMs)
      ? Math.max(0, (nowMs - this.issuedAtMs) / 1_000)
      : MILITARY_ORDER_FEEDBACK_LIFETIME_SECONDS;
    const sample = sampleMilitaryOrderFeedback(ageSeconds);
    return {
      ...sample,
      kind: this.kind,
      x: this.group.position.x,
      y: this.baseY,
      z: this.group.position.z,
      ageSeconds,
    };
  }

  dispose(): void {
    this.group.removeFromParent();
    this.ring.geometry.dispose();
    this.chevrons.geometry.dispose();
    this.ringMaterial.dispose();
    this.chevronMaterial.dispose();
  }
}

function createMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function createRadialChevronGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let direction = 0; direction < 4; direction += 1) {
    const angle = direction * Math.PI / 2;
    const radialX = Math.cos(angle);
    const radialY = Math.sin(angle);
    const tangentX = -radialY;
    const tangentY = radialX;
    const baseIndex = positions.length / 3;
    pushPoint(positions, radialX * 0.47, radialY * 0.47);
    pushPoint(positions, radialX * 0.77 + tangentX * 0.13, radialY * 0.77 + tangentY * 0.13);
    pushPoint(positions, radialX * 0.69, radialY * 0.69);
    pushPoint(positions, radialX * 0.77 - tangentX * 0.13, radialY * 0.77 - tangentY * 0.13);
    indices.push(
      baseIndex, baseIndex + 1, baseIndex + 2,
      baseIndex, baseIndex + 2, baseIndex + 3,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function pushPoint(positions: number[], x: number, y: number): void {
  positions.push(x, y, 0);
}
