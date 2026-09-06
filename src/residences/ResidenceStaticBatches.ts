import * as THREE from 'three';
import { BuildingStaticBatches } from '../buildings/BuildingStaticBatches.ts';
import { ResidenceWindowBatches } from './ResidenceWindowBatches.ts';

/** Residences use the same exact-geometry sharing and native instancing as workshops. */
export class ResidenceStaticBatches {
  readonly group: THREE.Group;
  private readonly batches: BuildingStaticBatches;
  private readonly windows: ResidenceWindowBatches;

  constructor(parent: THREE.Group) {
    this.windows = new ResidenceWindowBatches(parent);
    this.batches = new BuildingStaticBatches(parent, {
      sourceGroupName: 'Residence static batches',
      collisionProxyFlag: 'residenceStaticCollisionProxy',
      mergeDraws: true,
    });
    this.group = this.batches.group;
    this.group.name = 'Cross-residence static batches';
    this.group.userData.crossResidenceStaticBatches = true;
  }

  registerResidence(id: string, marker: THREE.Group): void {
    this.batches.registerBuilding(id, marker);
    this.windows.register(id, marker);
  }

  updateResidence(id: string, marker: THREE.Group, visible: boolean): void {
    this.batches.updateBuilding(id, marker, visible);
    this.windows.update(id, marker, visible);
  }

  setResidenceVisible(id: string, visible: boolean): void {
    this.batches.setBuildingVisible(id, visible);
    this.windows.setVisible(id, visible);
  }

  removeResidence(id: string): void {
    this.batches.removeBuilding(id);
    this.windows.remove(id);
  }

  finalizeGeometryBuffers(): void {
    this.batches.finalizeGeometryBuffers();
    this.windows.flush();
  }

  updateWindowMaterial(id: string): void { this.windows.updateMaterial(id); }

  getStats(): { renderObjects: number; nativeDraws: number; instances: number; geometryBytes: number } {
    const stats = this.batches.getStats();
    return { renderObjects: stats.renderObjects, nativeDraws: stats.nativeDrawCommands,
      instances: stats.instances, geometryBytes: stats.geometryBytes };
  }

  dispose(): void {
    this.batches.dispose();
    this.windows.dispose();
  }
}
