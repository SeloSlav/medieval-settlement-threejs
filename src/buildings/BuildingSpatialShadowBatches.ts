import * as THREE from 'three';
import { SpatialMergedGeometry, type StaticGeometryPart } from '../scene/SpatialMergedGeometry.ts';
import { BUILDING_DETAIL_SHADOW_CASTER_FLAG } from './buildingShadowProxy.ts';

type Source = { mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>; state: THREE.Mesh<THREE.BufferGeometry, THREE.Material>; layers: number };
type Entry = { marker: THREE.Group; sources: Source[]; visible: boolean };

/** City-level draws for the existing exact, refreshable architectural casters. */
export class BuildingSpatialShadowBatches {
  private readonly merged: SpatialMergedGeometry;
  private readonly entries = new Map<string, Entry>();
  private signature: unknown[] = [];

  constructor(parent: THREE.Group) {
    this.merged = new SpatialMergedGeometry(parent);
    this.merged.group.name = 'Spatial building detail shadows';
  }

  register(id: string, marker: THREE.Group): void {
    this.remove(id);
    const sources: Source[] = [];
    marker.traverse(object => {
      const mesh = object as Source['mesh'];
      if (!mesh.isMesh || !mesh.userData.buildingDetailCasterBatch || Array.isArray(mesh.material)
        || mesh.material.transparent || Object.keys(mesh.geometry.morphAttributes).length) return;
      const state = new THREE.Mesh(mesh.geometry, mesh.material);
      state.receiveShadow = mesh.receiveShadow; state.layers.mask = mesh.layers.mask;
      state.renderOrder = mesh.renderOrder; state.frustumCulled = mesh.frustumCulled;
      state.customDepthMaterial = mesh.customDepthMaterial;
      state.customDistanceMaterial = mesh.customDistanceMaterial;
      sources.push({ mesh, state, layers: mesh.layers.mask });
      // Retain the authored visibility/geometry owner for refreshes and settings.
      // This local copy is replaced by the identical spatially combined caster.
      mesh.layers.mask = 0;
    });
    if (sources.length) this.entries.set(id, { marker, sources, visible: marker.visible });
  }

  setVisible(id: string, visible: boolean): void {
    const entry = this.entries.get(id);
    if (entry) entry.visible = visible;
  }

  remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    for (const source of entry.sources) source.mesh.layers.mask = source.layers;
    this.entries.delete(id);
  }

  flush(): void {
    const signature: unknown[] = [];
    for (const { marker, sources, visible } of this.entries.values()) {
      marker.updateMatrix();
      for (const { mesh } of sources) {
        signature.push(mesh, mesh.geometry, mesh.visible, mesh.castShadow, visible, ...marker.matrix.elements);
      }
    }
    if (signature.length === this.signature.length && signature.every((value, i) => value === this.signature[i])) return;
    this.signature = signature;
    const parts: StaticGeometryPart[] = [];
    for (const { marker, sources, visible } of this.entries.values()) {
      for (const { mesh, state } of sources) {
        if (!visible || !mesh.visible || !mesh.castShadow) continue;
        // Local detail batches are authored directly in the marker's coordinates.
        // Preserve their render state without mutating the retained source.
        state.castShadow = mesh.castShadow;
        parts.push({ source: state, geometry: mesh.geometry, matrix: marker.matrix });
      }
    }
    this.merged.rebuild(parts);
    for (const mesh of this.merged.group.children) mesh.userData[BUILDING_DETAIL_SHADOW_CASTER_FLAG] = true;
  }

  dispose(): void {
    for (const id of this.entries.keys()) this.remove(id);
    this.merged.dispose();
  }
}
