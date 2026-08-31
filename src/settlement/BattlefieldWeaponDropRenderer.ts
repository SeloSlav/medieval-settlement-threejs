import * as THREE from 'three';
import type { CrowdViewState } from './crowdView.ts';
import {
  isMilitaryEquipmentKind,
  isMilitaryEquipmentSource,
  type MilitaryEquipmentKind,
  type MilitaryEquipmentSource,
} from './militaryEquipment.ts';
import type { WorkerToolKind, WorkerToolSources } from './workerTools.ts';

export const BATTLEFIELD_WEAPON_DROP_CAPACITY = 256;
export const BATTLEFIELD_WEAPON_DROP_MAX_ORBIT_DISTANCE = 150;
/** Nine weapon families batched by PBR role. */
export const BATTLEFIELD_WEAPON_DROP_DRAW_CALL_BUDGET = 50;

export type BattlefieldWeaponDropOwnership = {
  /** Stable combat-agent identity shared with the recoverable battlefield site. */
  ownerId: string;
  kind: MilitaryEquipmentKind;
  recoverable: boolean;
};

export type BattlefieldWeaponDropAgent = {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  appearanceSeed: number;
  active: boolean;
  tool?: WorkerToolKind | null;
  battlefieldWeaponDrop?: BattlefieldWeaponDropOwnership;
};

export type BattlefieldWeaponDropDiagnostic = {
  owners: number;
  pieces: number;
  instances: number;
  activeDrawCalls: number;
  triangles: number;
  droppedOwners: number;
  capacity: number;
  exactPbrMaterials: boolean;
};

type DropLayer = {
  mesh: THREE.InstancedMesh;
  sourceMatrix: THREE.Matrix4;
  triangleCount: number;
  count: number;
};

type DropPiece = {
  kind: MilitaryEquipmentKind;
  pieceIndex: number;
  sourceScale: number;
  layers: DropLayer[];
};

type DropCandidate = {
  agent: BattlefieldWeaponDropAgent;
  ownership: BattlefieldWeaponDropOwnership;
  distanceSq: number;
};

/**
 * Renders the actual authored procedural weapon assemblies beside casualties.
 * Geometry, PBR materials, and texture maps are shared with the hand-mounted
 * source objects; dynamic InstancedMesh prefixes keep draw calls independent
 * of the number of fallen combatants.
 */
export class BattlefieldWeaponDropRenderer {
  private readonly group = new THREE.Group();
  private readonly piecesByKind = new Map<MilitaryEquipmentKind, DropPiece[]>();
  private readonly layers: DropLayer[] = [];
  private readonly candidates: DropCandidate[] = [];
  private readonly ownership: BattlefieldWeaponDropOwnership[] = [];
  private readonly capacity: number;
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly yawQuaternion = new THREE.Quaternion();
  private readonly layQuaternion = new THREE.Quaternion();
  private readonly rootMatrix = new THREE.Matrix4();
  private readonly instanceMatrix = new THREE.Matrix4();
  private droppedOwners = 0;

  constructor(parent: THREE.Group, capacity = BATTLEFIELD_WEAPON_DROP_CAPACITY) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.group.name = 'Instanced battlefield weapon drops';
    parent.add(this.group);
  }

  configureSources(sources: WorkerToolSources): void {
    if (this.layers.length > 0) return;
    for (const kind of Object.keys(sources) as WorkerToolKind[]) {
      const source = sources[kind];
      if (!isMilitaryEquipmentKind(kind) || !isMilitaryEquipmentSource(source)) continue;
      const pieces: DropPiece[] = [];
      pieces.push(this.createPiece(kind, 0, source, source.scene));

      this.piecesByKind.set(kind, pieces);
    }
  }

  sync(
    agents: readonly BattlefieldWeaponDropAgent[],
    view?: CrowdViewState,
  ): void {
    for (const layer of this.layers) layer.count = 0;
    this.candidates.length = 0;
    this.ownership.length = 0;
    this.droppedOwners = 0;
    if (
      view?.orbitDistance !== undefined
      && view.orbitDistance > BATTLEFIELD_WEAPON_DROP_MAX_ORBIT_DISTANCE
    ) {
      this.commitLayers();
      return;
    }

    const centerX = view?.centerX ?? 0;
    const centerZ = view?.centerZ ?? 0;
    for (const agent of agents) {
      const ownership = agent.battlefieldWeaponDrop;
      if (!agent.active || !ownership || !isMilitaryEquipmentKind(ownership.kind)) continue;
      if (!this.piecesByKind.has(ownership.kind)) continue;
      const dx = agent.x - centerX;
      const dz = agent.z - centerZ;
      this.candidates.push({
        agent,
        ownership,
        distanceSq: view ? dx * dx + dz * dz : 0,
      });
    }
    this.candidates.sort((left, right) => left.distanceSq - right.distanceSq
      || left.ownership.ownerId.localeCompare(right.ownership.ownerId, undefined, { numeric: true }));
    this.droppedOwners = Math.max(0, this.candidates.length - this.capacity);

    const count = Math.min(this.capacity, this.candidates.length);
    for (let index = 0; index < count; index += 1) {
      const candidate = this.candidates[index]!;
      this.ownership.push({ ...candidate.ownership });
      const pieces = this.piecesByKind.get(candidate.ownership.kind)!;
      for (const piece of pieces) this.writePiece(candidate.agent, piece);
    }
    this.commitLayers();
  }

  diagnostics(): BattlefieldWeaponDropDiagnostic {
    let pieces = 0;
    let instances = 0;
    let activeDrawCalls = 0;
    let triangles = 0;
    for (const pieceSet of this.piecesByKind.values()) pieces += pieceSet.length;
    for (const layer of this.layers) {
      instances += layer.mesh.count;
      if (layer.mesh.count > 0) activeDrawCalls += 1;
      triangles += layer.triangleCount * layer.mesh.count;
    }
    return {
      owners: this.ownership.length,
      pieces,
      instances,
      activeDrawCalls,
      triangles,
      droppedOwners: this.droppedOwners,
      capacity: this.capacity,
      exactPbrMaterials: true,
    };
  }

  ownershipSnapshot(): readonly BattlefieldWeaponDropOwnership[] {
    return this.ownership.map((entry) => ({ ...entry }));
  }

  dispose(): void {
    for (const layer of this.layers) layer.mesh.removeFromParent();
    this.layers.length = 0;
    this.piecesByKind.clear();
    this.candidates.length = 0;
    this.ownership.length = 0;
    this.group.removeFromParent();
  }

  private createPiece(
    kind: MilitaryEquipmentKind,
    pieceIndex: number,
    source: MilitaryEquipmentSource,
    sourceObject: THREE.Group,
    sourceScale = source.targetLength / source.sourceLength,
  ): DropPiece {
    sourceObject.updateWorldMatrix(true, true);
    const inverseRoot = sourceObject.matrixWorld.clone().invert();
    const piece: DropPiece = {
      kind,
      pieceIndex,
      sourceScale,
      layers: [],
    };
    sourceObject.traverse((object) => {
      const sourceMesh = object as THREE.Mesh;
      if (!sourceMesh.isMesh) return;
      const sourceMatrix = inverseRoot.clone().multiply(sourceMesh.matrixWorld);
      const mesh = new THREE.InstancedMesh(
        sourceMesh.geometry,
        sourceMesh.material,
        this.capacity,
      );
      mesh.name = `Battlefield drop · ${kind} · ${pieceIndex} · ${sourceMesh.name}`;
      mesh.count = 0;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.userData.battlefieldWeaponDrop = true;
      mesh.userData.battlefieldWeaponKind = kind;
      mesh.userData.battlefieldWeaponPiece = pieceIndex;
      this.group.add(mesh);
      const elements = sourceMesh.geometry.index?.count
        ?? sourceMesh.geometry.getAttribute('position')?.count
        ?? 0;
      const layer: DropLayer = {
        mesh,
        sourceMatrix,
        triangleCount: Math.floor(elements / 3),
        count: 0,
      };
      piece.layers.push(layer);
      this.layers.push(layer);
    });
    return piece;
  }

  private writePiece(agent: BattlefieldWeaponDropAgent, piece: DropPiece): void {
    const transform = battlefieldWeaponDropTransform(
      agent,
      piece.kind,
      piece.pieceIndex,
    );
    this.position.set(transform.x, transform.y, transform.z);
    this.yawQuaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, transform.yaw);
    this.layQuaternion.setFromEuler(new THREE.Euler(
      transform.pitch,
      0,
      transform.roll,
      'XYZ',
    ));
    this.quaternion.copy(this.yawQuaternion).multiply(this.layQuaternion).normalize();
    this.scale.setScalar(piece.sourceScale);
    this.rootMatrix.compose(this.position, this.quaternion, this.scale);
    for (const layer of piece.layers) {
      if (layer.count >= this.capacity) continue;
      this.instanceMatrix.multiplyMatrices(this.rootMatrix, layer.sourceMatrix);
      layer.mesh.setMatrixAt(layer.count, this.instanceMatrix);
      layer.count += 1;
    }
  }

  private commitLayers(): void {
    for (const layer of this.layers) {
      layer.mesh.count = layer.count;
      if (layer.count > 0) {
        layer.mesh.instanceMatrix.clearUpdateRanges();
        layer.mesh.instanceMatrix.addUpdateRange(0, layer.count * 16);
        layer.mesh.instanceMatrix.needsUpdate = true;
      }
    }
  }
}

export function battlefieldWeaponDropTransform(
  agent: Pick<BattlefieldWeaponDropAgent, 'x' | 'y' | 'z' | 'yaw' | 'appearanceSeed' | 'id'>,
  kind: MilitaryEquipmentKind,
  pieceIndex = 0,
): { x: number; y: number; z: number; yaw: number; pitch: number; roll: number } {
  const seed = hashWeaponDrop(`${agent.id}:${kind}:${pieceIndex}`, agent.appearanceSeed);
  const side = unitHash(seed) * 0.52 - 0.26;
  const forward = 0.24 + unitHash(Math.imul(seed ^ 0x7f4a7c15, 0x9e3779b1)) * 0.34;
  const rightX = Math.cos(agent.yaw);
  const rightZ = -Math.sin(agent.yaw);
  const forwardX = Math.sin(agent.yaw);
  const forwardZ = Math.cos(agent.yaw);
  const longWeaponLift = kind === 'crossbow' || kind === 'bow'
    ? 0.085
    : 0.055;
  return {
    x: agent.x + rightX * side + forwardX * forward + pieceIndex * rightX * 0.24,
    y: agent.y + longWeaponLift + pieceIndex * 0.012,
    z: agent.z + rightZ * side + forwardZ * forward + pieceIndex * rightZ * 0.24,
    yaw: agent.yaw + (unitHash(seed ^ 0xb5297a4d) - 0.5) * 1.35,
    // Authored equipment runs along local +Y. A near-quarter turn lays it
    // across uneven ground while retaining enough roll to avoid z-fighting.
    pitch: Math.PI * 0.5 + (unitHash(seed ^ 0x68e31da4) - 0.5) * 0.12,
    roll: (unitHash(seed ^ 0x1b56c4e9) - 0.5) * 0.18,
  };
}

function hashWeaponDrop(value: string, appearanceSeed: number): number {
  let hash = (0x811c9dc5 ^ appearanceSeed) >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function unitHash(value: number): number {
  return (value >>> 0) / 0xffff_ffff;
}
