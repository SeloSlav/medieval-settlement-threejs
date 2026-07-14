import * as THREE from 'three';
import { isWithinShadowRange } from './crowdView.ts';
import type { CrowdViewState } from './crowdView.ts';

const MAX_INSTANCES = 1024;
const BODY_GEOMETRY = new THREE.CapsuleGeometry(0.22, 0.72, 4, 8);
const LEGS_GEOMETRY = new THREE.CapsuleGeometry(0.16, 0.34, 4, 8);
const HEAD_GEOMETRY = new THREE.SphereGeometry(0.19, 10, 10);

type PartLayer = {
  mesh: THREE.InstancedMesh;
  capacity: number;
};

export type CrowdRenderAgent = {
  slot: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  tunicColor: number;
  skinColor: number;
  active: boolean;
};

export type SettlementCrowdRendererOptions = {
  parent: THREE.Group;
};

export class SettlementCrowdRenderer {
  private readonly group = new THREE.Group();
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly color = new THREE.Color();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly nearBody: PartLayer;
  private readonly nearLegs: PartLayer;
  private readonly nearHead: PartLayer;
  private readonly farBody: PartLayer;
  private readonly farLegs: PartLayer;
  private readonly farHead: PartLayer;

  constructor(options: SettlementCrowdRendererOptions) {
    this.group.name = 'Villagers';
    options.parent.add(this.group);

    this.nearBody = this.createPartLayer('VillagerBodyNear', BODY_GEOMETRY, true);
    this.nearLegs = this.createPartLayer('VillagerLegsNear', LEGS_GEOMETRY, true);
    this.nearHead = this.createPartLayer('VillagerHeadNear', HEAD_GEOMETRY, true);
    this.farBody = this.createPartLayer('VillagerBodyFar', BODY_GEOMETRY, false);
    this.farLegs = this.createPartLayer('VillagerLegsFar', LEGS_GEOMETRY, false);
    this.farHead = this.createPartLayer('VillagerHeadFar', HEAD_GEOMETRY, false);
  }

  syncAgents(agents: readonly CrowdRenderAgent[], view?: CrowdViewState): void {
    this.updateLayer(this.nearBody, this.nearLegs, this.nearHead, agents, true, view);
    this.updateLayer(this.farBody, this.farLegs, this.farHead, agents, false, view);
  }

  dispose(): void {
    for (const layer of [
      this.nearBody,
      this.nearLegs,
      this.nearHead,
      this.farBody,
      this.farLegs,
      this.farHead,
    ]) {
      layer.mesh.geometry.dispose();
      (layer.mesh.material as THREE.Material).dispose();
      layer.mesh.removeFromParent();
    }
    this.group.removeFromParent();
  }

  private createPartLayer(
    name: string,
    geometry: THREE.BufferGeometry,
    castShadow: boolean,
  ): PartLayer {
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.9,
      metalness: 0,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, MAX_INSTANCES);
    mesh.name = name;
    mesh.count = 0;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return { mesh, capacity: MAX_INSTANCES };
  }

  private updateLayer(
    body: PartLayer,
    legs: PartLayer,
    head: PartLayer,
    agents: readonly CrowdRenderAgent[],
    nearLayer: boolean,
    view?: CrowdViewState,
  ): void {
    let count = 0;
    for (const agent of agents) {
      if (!agent.active) continue;
      const wantsNear = isWithinShadowRange(agent.x, agent.z, view);
      if (wantsNear !== nearLayer) continue;
      if (count >= body.capacity) break;

      this.writeInstance(body.mesh, count, agent.x, agent.y + 0.62, agent.z, agent.yaw, agent.tunicColor);
      this.writeInstance(legs.mesh, count, agent.x, agent.y + 0.22, agent.z, agent.yaw, 0x3a3028);
      this.writeInstance(head.mesh, count, agent.x, agent.y + 1.18, agent.z, agent.yaw, agent.skinColor);
      count++;
    }

    body.mesh.count = count;
    legs.mesh.count = count;
    head.mesh.count = count;
    body.mesh.instanceMatrix.needsUpdate = true;
    legs.mesh.instanceMatrix.needsUpdate = true;
    head.mesh.instanceMatrix.needsUpdate = true;
    if (body.mesh.instanceColor) body.mesh.instanceColor.needsUpdate = true;
    if (head.mesh.instanceColor) head.mesh.instanceColor.needsUpdate = true;
  }

  private writeInstance(
    mesh: THREE.InstancedMesh,
    index: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    hexColor: number,
  ): void {
    this.position.set(x, y, z);
    this.euler.set(0, yaw, 0);
    this.quaternion.setFromEuler(this.euler);
    this.matrix.compose(this.position, this.quaternion, this.scale);
    mesh.setMatrixAt(index, this.matrix);
    this.color.setHex(hexColor);
    mesh.setColorAt(index, this.color);
  }
}
