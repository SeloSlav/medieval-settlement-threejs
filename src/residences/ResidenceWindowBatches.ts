import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type WindowMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
type WindowNodeMaterial = MeshStandardNodeMaterial & { emissiveNode: ReturnType<typeof attribute> | null };
type Range = { geometry: THREE.BufferGeometry; start: number; count: number };
type Part = { source: WindowMesh; layers: number; range?: Range };
type Home = { marker: THREE.Group; parts: Part[]; matrix: THREE.Matrix4; visible: boolean };

/** Keep household lighting independent while submitting whole streets together. */
export class ResidenceWindowBatches {
  readonly group = new THREE.Group();
  private readonly homes = new Map<string, Home>();
  private readonly materialKeys = new WeakMap<THREE.Material, string>();
  private dirty = false;

  constructor(parent: THREE.Group) {
    this.group.name = 'Residence window batches';
    parent.add(this.group);
  }

  register(id: string, marker: THREE.Group): void {
    this.remove(id);
    const material = marker.userData.windowMaterial as THREE.MeshStandardMaterial | undefined;
    const node = material as WindowNodeMaterial | undefined;
    // Custom shader color/emission and transparent sorting retain their owner.
    if (!material?.isMeshStandardMaterial || material.transparent || node?.colorNode || node?.emissiveNode
      || material.vertexColors || material.emissiveMap) return;
    const parts: Part[] = [];
    marker.traverse(object => {
      const source = object as WindowMesh;
      if (!source.isMesh || source.material !== material || source.layers.mask === 0
        || (source as unknown as THREE.InstancedMesh).isInstancedMesh
        || (source as unknown as THREE.SkinnedMesh).isSkinnedMesh
        || Object.keys(source.geometry.morphAttributes).length
        || source.geometry.drawRange.start !== 0 || source.geometry.drawRange.count !== Infinity
        || source.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) return;
      parts.push({ source, layers: source.layers.mask });
      source.layers.mask = 0;
    });
    if (!parts.length) return;
    marker.updateMatrix();
    this.homes.set(id, { marker, parts, matrix: marker.matrix.clone(), visible: marker.visible });
    this.dirty = true;
  }

  update(id: string, marker: THREE.Group, visible: boolean): void {
    const home = this.homes.get(id);
    if (!home) return;
    if (marker.matrixAutoUpdate) marker.updateMatrix();
    if (!home.matrix.equals(marker.matrix) || home.visible !== visible) {
      home.matrix.copy(marker.matrix); home.visible = visible; this.dirty = true;
    }
  }

  setVisible(id: string, visible: boolean): void {
    const home = this.homes.get(id);
    if (home && home.visible !== visible) { home.visible = visible; this.dirty = true; }
  }

  updateMaterial(id: string): void {
    for (const part of this.homes.get(id)?.parts ?? []) this.writeMaterial(part);
  }

  remove(id: string): void {
    const home = this.homes.get(id);
    if (!home) return;
    for (const part of home.parts) part.source.layers.mask = part.layers;
    this.homes.delete(id); this.dirty = true;
  }

  flush(): void {
    if (!this.dirty) return;
    this.clearDraws();
    const buckets = new Map<string, { parts: Part[]; geometries: THREE.BufferGeometry[] }>();
    const relative = new THREE.Matrix4(), chain: THREE.Object3D[] = [];
    for (const home of this.homes.values()) for (const part of home.parts) {
      part.range = undefined;
      if (!home.visible) continue;
      chain.length = 0;
      let object: THREE.Object3D | null = part.source, visible = true;
      while (object && object !== home.marker.parent) {
        if (!object.visible) { visible = false; break; }
        chain.push(object); object = object.parent;
      }
      if (!visible || !part.source.material.visible) continue;
      relative.identity();
      for (let i = chain.length - 1; i >= 0; i--) {
        const ancestor = chain[i]!;
        if (ancestor.matrixAutoUpdate) ancestor.updateMatrix();
        relative.multiply(ancestor.matrix);
      }
      const geometry = part.source.geometry.clone().applyMatrix4(relative);
      const count = geometry.getAttribute('position').count;
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
      geometry.setAttribute('residenceWindowEmissive', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
      const key = this.key(part);
      const bucket = buckets.get(key) ?? { parts: [], geometries: [] };
      bucket.parts.push(part); bucket.geometries.push(geometry); buckets.set(key, bucket);
    }
    for (const { parts, geometries } of buckets.values()) {
      const merged = mergeGeometries(geometries, false);
      const counts = geometries.map(geometry => geometry.getAttribute('position').count);
      for (const geometry of geometries) geometry.dispose();
      if (!merged) throw new Error('Residence window attribute bucket could not be merged');
      const first = parts[0]!;
      const material = new MeshStandardNodeMaterial().copy(first.source.material as MeshStandardNodeMaterial) as WindowNodeMaterial;
      material.name = 'Independent household window lighting';
      material.color.setHex(0xffffff); material.vertexColors = true;
      material.emissiveNode = attribute('residenceWindowEmissive', 'vec3');
      // Window glazing and its authored mullions can share a depth sample.
      // Keep the glazing behind those frames after changing draw grouping.
      material.polygonOffset = true; material.polygonOffsetFactor = 0; material.polygonOffsetUnits = 1;
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = 'Merged residence windows';
      mesh.castShadow = first.source.castShadow; mesh.receiveShadow = first.source.receiveShadow;
      mesh.renderOrder = first.source.renderOrder; mesh.layers.mask = first.layers;
      mesh.customDepthMaterial = first.source.customDepthMaterial;
      mesh.customDistanceMaterial = first.source.customDistanceMaterial;
      this.group.add(mesh);
      let start = 0;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        part.range = { geometry: merged, start, count: counts[i]! };
        this.writeMaterial(part); start += counts[i]!;
      }
      merged.computeBoundingBox(); merged.computeBoundingSphere();
    }
    this.dirty = false;
  }

  private writeMaterial(part: Part): void {
    if (!part.range) return;
    const { geometry, start, count } = part.range, material = part.source.material;
    const color = geometry.getAttribute('color') as THREE.BufferAttribute;
    const emissive = geometry.getAttribute('residenceWindowEmissive') as THREE.BufferAttribute;
    const channels = [material.color.r, material.color.g, material.color.b,
      material.emissive.r * material.emissiveIntensity, material.emissive.g * material.emissiveIntensity,
      material.emissive.b * material.emissiveIntensity];
    for (let i = 0; i < 2; i++) {
      const output = i === 0 ? color : emissive, offset = i * 3;
      const x = Math.fround(channels[offset]!), y = Math.fround(channels[offset + 1]!), z = Math.fround(channels[offset + 2]!);
      if (output.getX(start) === x && output.getY(start) === y && output.getZ(start) === z) continue;
      for (let vertex = start; vertex < start + count; vertex++) output.setXYZ(vertex, x, y, z);
      output.addUpdateRange(start * 3, count * 3); output.needsUpdate = true;
    }
  }

  private key(part: Part): string {
    const { source } = part, material = source.material;
    let materialKey = this.materialKeys.get(material);
    if (!materialKey) {
      const json = material.toJSON() as unknown as Record<string, unknown>;
      for (const key of ['uuid', 'name', 'userData', 'color', 'emissive', 'emissiveIntensity']) delete json[key];
      materialKey = JSON.stringify(json); this.materialKeys.set(material, materialKey);
    }
    const layout = Object.entries(source.geometry.attributes).sort(([a], [b]) => a.localeCompare(b))
      .map(([name, value]) => `${name}:${value.itemSize}:${value.normalized}:${value.array.constructor.name}`).join(',');
    // Bound batch extent keeps offscreen districts independently cullable.
    const home = source;
    home.updateWorldMatrix(true, false);
    const p = new THREE.Vector3().setFromMatrixPosition(home.matrixWorld);
    return [Math.floor(p.x / 192), Math.floor(p.z / 192), materialKey, layout,
      !!source.geometry.index, source.castShadow, source.receiveShadow, source.renderOrder,
      part.layers, source.customDepthMaterial?.uuid, source.customDistanceMaterial?.uuid].join('|');
  }

  private clearDraws(): void {
    for (const child of [...this.group.children]) {
      const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
      mesh.geometry.dispose(); mesh.material.dispose(); mesh.removeFromParent();
    }
  }

  dispose(): void {
    for (const id of this.homes.keys()) this.remove(id);
    this.clearDraws(); this.group.removeFromParent();
  }
}
