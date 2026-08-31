import * as THREE from 'three';
import {
  isMilitaryEquipmentKind,
  type WorkerToolKind,
} from './workerTools.ts';

const DEFAULT_CAPACITY = 2_048;
const LAYER_NAMES = [
  'torso',
  'pelvis',
  'head',
  'headwear',
  'left-arm',
  'right-arm',
  'left-leg',
  'right-leg',
] as const;

type StrategicHumanoidLayerName = (typeof LAYER_NAMES)[number];

export const STRATEGIC_HUMANOID_LAYER_COUNT = LAYER_NAMES.length;
export const STRATEGIC_HUMANOID_TRIANGLE_BUDGET_PER_PERSON = 240;

export type StrategicHumanoidAgent = {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  appearanceSeed: number;
  variant: 'man' | 'woman';
  presentation?: 'common' | 'cleric' | 'raider';
  mode: string;
  tunicColor: number;
  skinColor: number;
  hairColor: number;
  tool?: WorkerToolKind | null;
  movementSpeed: number;
  active?: boolean;
  combatLocomotion?: 'idle' | 'walk' | 'run';
  combatTargetDistance?: number;
};

export type StrategicHumanoidDiagnostic = {
  instances: number;
  requestedInstances: number;
  capacityDroppedInstances: number;
  livingInstances: number;
  downedInstances: number;
  layerDraws: number;
  trianglesPerPerson: number;
  submittedTriangles: number;
  /** Permanent strategic people never use the old capsule/pill proxy tier. */
  capsuleProxyCount: 0;
};

type StrategicLayer = {
  name: StrategicHumanoidLayerName;
  mesh: THREE.InstancedMesh;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  colors: Uint32Array;
  initializedColors: Uint8Array;
  triangleCount: number;
  colorsDirty: boolean;
};

const DOWN = new THREE.Vector3(0, -1, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);

/**
 * Shared strategic representation for people outside the authored-rig budget.
 *
 * Eight instanced layers preserve an actual human silhouette, opposing limb
 * motion, faction clothing, skin and headwear.  The hot path owns one fixed
 * scratch set and typed color caches; it creates no Mesh or temporary object
 * per person or per frame.
 */
export class StrategicHumanoidRenderer {
  private readonly group = new THREE.Group();
  private readonly layers = new Map<StrategicHumanoidLayerName, StrategicLayer>();
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly materials = new Set<THREE.MeshStandardMaterial>();
  private readonly capacity: number;
  private readonly rootPosition = new THREE.Vector3();
  private readonly rootQuaternion = new THREE.Quaternion();
  private readonly fallQuaternion = new THREE.Quaternion();
  private readonly localPosition = new THREE.Vector3();
  private readonly worldPosition = new THREE.Vector3();
  private readonly localQuaternion = new THREE.Quaternion();
  private readonly worldQuaternion = new THREE.Quaternion();
  private readonly localEuler = new THREE.Euler();
  private readonly direction = new THREE.Vector3();
  private readonly partScale = new THREE.Vector3();
  private readonly matrix = new THREE.Matrix4();
  private readonly color = new THREE.Color();
  private elapsedSeconds = 0;
  private instanceCount = 0;
  private requestedCount = 0;
  private downedCount = 0;
  private readonly trianglesPerPerson: number;

  constructor(parent: THREE.Group, capacity = DEFAULT_CAPACITY) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.group.name = 'Instanced strategic humanoids · no capsule proxies';
    parent.add(this.group);

    const torsoGeometry = new THREE.CylinderGeometry(0.82, 1, 1, 6, 1, false);
    torsoGeometry.name = 'Strategic humanoid faceted tunic torso';
    const pelvisGeometry = new THREE.BoxGeometry(1, 1, 1);
    pelvisGeometry.name = 'Strategic humanoid pelvis';
    const armGeometry = new THREE.CylinderGeometry(0.82, 1, 1, 5, 1, false);
    armGeometry.name = 'Strategic humanoid tapered arm';
    const legGeometry = new THREE.CylinderGeometry(0.78, 1, 1, 5, 1, false);
    legGeometry.name = 'Strategic humanoid tapered leg';
    const headGeometry = new THREE.DodecahedronGeometry(1, 0);
    headGeometry.name = 'Strategic humanoid faceted head';
    const headwearGeometry = new THREE.SphereGeometry(
      1,
      8,
      3,
      0,
      Math.PI * 2,
      0,
      Math.PI * 0.55,
    );
    headwearGeometry.name = 'Strategic humanoid hair helmet or turban silhouette';

    const clothingMaterial = strategicMaterial(
      'Strategic woven clothing',
      0.88,
      0,
    );
    const lowerClothingMaterial = strategicMaterial(
      'Strategic heavy trousers',
      0.92,
      0,
    );
    const skinMaterial = strategicMaterial('Strategic skin', 0.82, 0);
    const headwearMaterial = strategicMaterial('Strategic headwear', 0.72, 0.08);

    this.addLayer('torso', torsoGeometry, clothingMaterial);
    this.addLayer('pelvis', pelvisGeometry, lowerClothingMaterial);
    this.addLayer('head', headGeometry, skinMaterial);
    this.addLayer('headwear', headwearGeometry, headwearMaterial);
    this.addLayer('left-arm', armGeometry, clothingMaterial);
    this.addLayer('right-arm', armGeometry, clothingMaterial);
    this.addLayer('left-leg', legGeometry, lowerClothingMaterial);
    this.addLayer('right-leg', legGeometry, lowerClothingMaterial);

    this.trianglesPerPerson = LAYER_NAMES.reduce(
      (sum, name) => sum + this.layer(name).triangleCount,
      0,
    );
    if (this.trianglesPerPerson > STRATEGIC_HUMANOID_TRIANGLE_BUDGET_PER_PERSON) {
      throw new Error(
        `Strategic humanoid costs ${this.trianglesPerPerson} triangles; `
          + `budget is ${STRATEGIC_HUMANOID_TRIANGLE_BUDGET_PER_PERSON}`,
      );
    }
  }

  sync(
    agents: readonly StrategicHumanoidAgent[],
    excludedIds?: ReadonlySet<string>,
    dtSeconds = 0,
  ): void {
    this.elapsedSeconds += Math.min(0.08, Math.max(0, dtSeconds));
    let count = 0;
    let requestedCount = 0;
    let downedCount = 0;
    for (const agent of agents) {
      if (excludedIds?.has(agent.id)) continue;
      requestedCount += 1;
      if (count >= this.capacity) continue;

      const isDowned = agent.mode === 'fall';
      const hasMilitaryEquipment = Boolean(
        agent.tool && isMilitaryEquipmentKind(agent.tool),
      );
      if (isDowned) downedCount += 1;
      const femaleScale = agent.variant === 'woman' ? 0.955 : 1;
      const heightScale = femaleScale * (
        0.96 + ((agent.appearanceSeed >>> 8) & 0xff) / 0xff * 0.08
      );
      const bodyWidthScale = agent.variant === 'woman' ? 0.92 : 1;
      const phase = this.elapsedSeconds * locomotionFrequency(agent)
        + (agent.appearanceSeed % 997) / 997 * Math.PI * 2;
      const motion = locomotionKind(agent);
      const strideAmplitude = motion === 'run'
        ? 0.72
        : motion === 'walk'
          ? 0.4
          : 0;
      const stride = Math.sin(phase) * strideAmplitude;

      let torsoPitch = 0;
      let torsoRoll = 0;
      let torsoDrop = 0;
      let leftArmSwing = -stride * 0.76;
      let rightArmSwing = stride * 0.76;
      let leftLegSwing = stride;
      let rightLegSwing = -stride;
      let armOutward = 0.04;

      if (motion === 'run') torsoPitch = -0.16;
      if (agent.mode === 'fight') {
        torsoPitch = -0.1;
        // Distance equipment is compiled around a +Z guard position. Keep
        // both hands converged on that authored grip instead of letting the
        // weapon float alongside an unrelated gesture.
        leftArmSwing = 0.88 + Math.sin(phase * 0.72) * 0.1;
        rightArmSwing = 0.68 + Math.cos(phase * 0.72) * 0.16;
        armOutward = -0.12;
      } else if (agent.mode === 'hurt') {
        torsoPitch = 0.18;
        torsoRoll = ((agent.appearanceSeed & 1) ? 1 : -1) * 0.22;
        if (hasMilitaryEquipment) {
          // A hit reaction bends the torso without releasing the weapon.
          leftArmSwing = 0.78;
          rightArmSwing = 0.58;
          armOutward = -0.1;
        } else {
          leftArmSwing = 0.42;
          rightArmSwing = -0.38;
          armOutward = 0.28;
        }
      } else if (
        agent.mode === 'chop'
        || agent.mode === 'mine'
        || agent.mode === 'build'
      ) {
        torsoPitch = -0.18;
        const workingSwing = 0.72 + Math.sin(phase * 0.68) * 0.42;
        leftArmSwing = workingSwing;
        rightArmSwing = workingSwing + 0.12;
      } else if (agent.mode === 'carry' || agent.mode === 'gather') {
        leftArmSwing = 0.86;
        rightArmSwing = 0.86;
        armOutward = -0.03;
      } else if (agent.mode === 'sit' || agent.mode === 'rest') {
        torsoDrop = 0.23;
        leftLegSwing = -0.92;
        rightLegSwing = -0.92;
        leftArmSwing = -0.28;
        rightArmSwing = -0.28;
      } else if (
        agent.mode === 'talk'
        || agent.mode === 'greet'
        || agent.mode === 'sermon'
        || agent.mode === 'agree'
      ) {
        rightArmSwing = 0.58 + Math.sin(phase * 0.45) * 0.24;
        armOutward = 0.14;
      }

      this.rootPosition.set(agent.x, agent.y, agent.z);
      this.rootQuaternion.setFromAxisAngle(Y_AXIS, agent.yaw);
      if (isDowned) {
        // Rotate the complete articulated silhouette onto the terrain and move
        // its former vertical midpoint back over the logical agent root.
        this.rootPosition.x += Math.sin(agent.yaw) * 0.84 * heightScale;
        this.rootPosition.y += 0.18;
        this.rootPosition.z += Math.cos(agent.yaw) * 0.84 * heightScale;
        this.fallQuaternion.setFromAxisAngle(X_AXIS, -Math.PI / 2);
        this.rootQuaternion.multiply(this.fallQuaternion);
        torsoPitch = 0;
        torsoRoll = ((agent.appearanceSeed & 1) ? 1 : -1) * 0.08;
        torsoDrop = 0;
        leftArmSwing = -0.2;
        rightArmSwing = 0.16;
        leftLegSwing = -0.12;
        rightLegSwing = 0.18;
        armOutward = 0.24;
      }

      const tunicColor = normalizedHex(agent.tunicColor, 0x735442);
      const lowerColor = darkenHex(tunicColor, 0.53);
      const skinColor = normalizedHex(agent.skinColor, 0xb87958);
      const headwearColor = strategicHeadwearColor(
        agent,
        tunicColor,
        hasMilitaryEquipment,
      );
      const shoulderX = 0.285 * bodyWidthScale;
      const hipX = 0.125 * bodyWidthScale;

      this.writeRigid(
        this.layer('torso'), count,
        0, (1.07 - torsoDrop) * heightScale, 0,
        torsoPitch, 0, torsoRoll,
        0.245 * bodyWidthScale, 0.62 * heightScale, 0.205 * bodyWidthScale,
        tunicColor,
      );
      this.writeRigid(
        this.layer('pelvis'), count,
        0, (0.73 - torsoDrop * 0.82) * heightScale, 0,
        0, 0, 0,
        0.37 * bodyWidthScale, 0.22 * heightScale, 0.25 * bodyWidthScale,
        lowerColor,
      );
      this.writeRigid(
        this.layer('head'), count,
        0, (1.52 - torsoDrop) * heightScale, -torsoPitch * 0.045,
        torsoPitch * -0.34, 0, torsoRoll * -0.22,
        0.17 * bodyWidthScale, 0.195 * heightScale, 0.165 * bodyWidthScale,
        skinColor,
      );
      this.writeRigid(
        this.layer('headwear'), count,
        0, (1.62 - torsoDrop) * heightScale, -torsoPitch * 0.045,
        torsoPitch * -0.34, 0, torsoRoll * -0.22,
        0.195 * bodyWidthScale,
        (agent.presentation === 'raider' ? 0.13 : 0.095) * heightScale,
        0.185 * bodyWidthScale,
        headwearColor,
      );

      this.writeLimb(
        this.layer('left-arm'), count,
        -shoulderX, (1.31 - torsoDrop) * heightScale, 0,
        -armOutward, leftArmSwing, 0.58 * heightScale,
        0.072 * bodyWidthScale, tunicColor,
      );
      this.writeLimb(
        this.layer('right-arm'), count,
        shoulderX, (1.31 - torsoDrop) * heightScale, 0,
        armOutward, rightArmSwing, 0.58 * heightScale,
        0.072 * bodyWidthScale, tunicColor,
      );
      this.writeLimb(
        this.layer('left-leg'), count,
        -hipX, (0.68 - torsoDrop * 0.62) * heightScale, 0,
        -0.025, leftLegSwing, 0.66 * heightScale,
        0.092 * bodyWidthScale, lowerColor,
      );
      this.writeLimb(
        this.layer('right-leg'), count,
        hipX, (0.68 - torsoDrop * 0.62) * heightScale, 0,
        0.025, rightLegSwing, 0.66 * heightScale,
        0.092 * bodyWidthScale, lowerColor,
      );
      count += 1;
    }

    this.instanceCount = count;
    this.requestedCount = requestedCount;
    this.downedCount = downedCount;
    for (const layer of this.layers.values()) this.commitLayer(layer, count);
    this.group.visible = count > 0;
  }

  diagnostics(): StrategicHumanoidDiagnostic {
    return {
      instances: this.instanceCount,
      requestedInstances: this.requestedCount,
      capacityDroppedInstances: Math.max(0, this.requestedCount - this.instanceCount),
      livingInstances: this.instanceCount - this.downedCount,
      downedInstances: this.downedCount,
      layerDraws: this.instanceCount > 0 ? STRATEGIC_HUMANOID_LAYER_COUNT : 0,
      trianglesPerPerson: this.trianglesPerPerson,
      submittedTriangles: this.trianglesPerPerson * this.instanceCount,
      capsuleProxyCount: 0,
    };
  }

  dispose(): void {
    for (const layer of this.layers.values()) layer.mesh.removeFromParent();
    this.layers.clear();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.geometries.clear();
    this.materials.clear();
    this.group.removeFromParent();
  }

  private addLayer(
    name: StrategicHumanoidLayerName,
    geometry: THREE.BufferGeometry,
    material: THREE.MeshStandardMaterial,
  ): void {
    const mesh = new THREE.InstancedMesh(geometry, material, this.capacity);
    mesh.name = `Strategic humanoid · ${name}`;
    mesh.count = 0;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(this.capacity * 3),
      3,
    );
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.group.add(mesh);
    const triangleCount = Math.floor((
      geometry.index?.count ?? geometry.getAttribute('position').count
    ) / 3);
    this.layers.set(name, {
      name,
      mesh,
      geometry,
      material,
      colors: new Uint32Array(this.capacity),
      initializedColors: new Uint8Array(this.capacity),
      triangleCount,
      colorsDirty: false,
    });
    this.geometries.add(geometry);
    this.materials.add(material);
  }

  private layer(name: StrategicHumanoidLayerName): StrategicLayer {
    const layer = this.layers.get(name);
    if (!layer) throw new Error(`Missing strategic humanoid layer ${name}`);
    return layer;
  }

  private writeRigid(
    layer: StrategicLayer,
    index: number,
    localX: number,
    localY: number,
    localZ: number,
    rotationX: number,
    rotationY: number,
    rotationZ: number,
    scaleX: number,
    scaleY: number,
    scaleZ: number,
    color: number,
  ): void {
    this.localPosition.set(localX, localY, localZ);
    this.localEuler.set(rotationX, rotationY, rotationZ, 'XYZ');
    this.localQuaternion.setFromEuler(this.localEuler);
    this.writePart(layer, index, scaleX, scaleY, scaleZ, color);
  }

  private writeLimb(
    layer: StrategicLayer,
    index: number,
    jointX: number,
    jointY: number,
    jointZ: number,
    outward: number,
    forwardAngle: number,
    length: number,
    radius: number,
    color: number,
  ): void {
    this.direction.set(
      outward,
      -Math.cos(forwardAngle),
      Math.sin(forwardAngle),
    ).normalize();
    this.localPosition.set(jointX, jointY, jointZ).addScaledVector(
      this.direction,
      length * 0.5,
    );
    this.localQuaternion.setFromUnitVectors(DOWN, this.direction);
    this.writePart(layer, index, radius, length, radius, color);
  }

  private writePart(
    layer: StrategicLayer,
    index: number,
    scaleX: number,
    scaleY: number,
    scaleZ: number,
    color: number,
  ): void {
    this.worldPosition.copy(this.localPosition)
      .applyQuaternion(this.rootQuaternion)
      .add(this.rootPosition);
    this.worldQuaternion.copy(this.rootQuaternion).multiply(this.localQuaternion);
    this.partScale.set(scaleX, scaleY, scaleZ);
    this.matrix.compose(this.worldPosition, this.worldQuaternion, this.partScale);
    layer.mesh.setMatrixAt(index, this.matrix);
    if (!layer.initializedColors[index] || layer.colors[index] !== color) {
      layer.initializedColors[index] = 1;
      layer.colors[index] = color;
      this.color.setHex(color);
      layer.mesh.setColorAt(index, this.color);
      layer.colorsDirty = true;
    }
  }

  private commitLayer(layer: StrategicLayer, count: number): void {
    layer.mesh.count = count;
    layer.mesh.visible = count > 0;
    publishPrefix(layer.mesh.instanceMatrix, count);
    if (layer.colorsDirty && layer.mesh.instanceColor) {
      publishPrefix(layer.mesh.instanceColor, count);
      layer.colorsDirty = false;
    }
  }
}

function strategicMaterial(
  name: string,
  roughness: number,
  metalness: number,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    name,
    color: 0xffffff,
    vertexColors: true,
    roughness,
    metalness,
  });
}

function locomotionKind(
  agent: StrategicHumanoidAgent,
): 'idle' | 'walk' | 'run' {
  if (agent.mode === 'run' || agent.mode === 'flee') return 'run';
  if (agent.mode === 'walk') return 'walk';
  if (agent.mode === 'fight' && agent.combatLocomotion) {
    return agent.combatLocomotion;
  }
  return agent.movementSpeed > 0.55 ? 'walk' : 'idle';
}

function locomotionFrequency(agent: StrategicHumanoidAgent): number {
  const motion = locomotionKind(agent);
  if (motion === 'run') return 7.4 + Math.min(2.6, agent.movementSpeed * 0.5);
  if (motion === 'walk') return 3.8 + Math.min(1.8, agent.movementSpeed * 0.32);
  return 1.1;
}

function strategicHeadwearColor(
  agent: StrategicHumanoidAgent,
  tunicColor: number,
  hasMilitaryEquipment: boolean,
): number {
  if (agent.presentation === 'raider') {
    return mixHex(tunicColor, 0x872b23, 0.72);
  }
  if (agent.presentation === 'cleric') {
    return mixHex(agent.hairColor, 0x35291f, 0.68);
  }
  if (hasMilitaryEquipment) {
    return mixHex(agent.hairColor, 0x667070, 0.52);
  }
  return normalizedHex(agent.hairColor, 0x493326);
}

function normalizedHex(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(0xffffff, value >>> 0)) : fallback;
}

function darkenHex(hex: number, factor: number): number {
  const value = normalizedHex(hex, 0x4a382d);
  return (
    (Math.round(((value >> 16) & 0xff) * factor) << 16)
    | (Math.round(((value >> 8) & 0xff) * factor) << 8)
    | Math.round((value & 0xff) * factor)
  );
}

function mixHex(left: number, right: number, rightWeight: number): number {
  const a = normalizedHex(left, 0x4a382d);
  const b = normalizedHex(right, 0x4a382d);
  const t = Math.max(0, Math.min(1, rightWeight));
  return (
    (mixHexChannel(a, b, t, 16) << 16)
    | (mixHexChannel(a, b, t, 8) << 8)
    | mixHexChannel(a, b, t, 0)
  );
}

function mixHexChannel(left: number, right: number, weight: number, shift: number): number {
  return Math.round(
    ((left >> shift) & 0xff) * (1 - weight)
      + ((right >> shift) & 0xff) * weight,
  );
}

function publishPrefix(
  attribute: THREE.InstancedBufferAttribute,
  instanceCount: number,
): void {
  attribute.clearUpdateRanges();
  if (instanceCount <= 0) return;
  attribute.addUpdateRange(0, instanceCount * attribute.itemSize);
  attribute.needsUpdate = true;
}
