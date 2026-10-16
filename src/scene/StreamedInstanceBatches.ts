import * as THREE from 'three';
import { StorageInstancedBufferAttribute } from 'three/webgpu';
import { exactInstancePrototype } from './ExactInstancePrototype.ts';
import { StaticRenderBundle } from './StaticRenderBundle.ts';

type Attribute = THREE.InstancedBufferAttribute;
type Source = {
  mesh: THREE.InstancedMesh;
  geometry: THREE.BufferGeometry;
  prototype: THREE.BufferGeometry;
  layers: number;
  schema: string;
  staticAttributes: Array<{ name: string; attribute: THREE.BufferAttribute; version: number }>;
  instanceAttributes: Array<[string, Attribute]>;
  index: THREE.BufferAttribute | null;
  indexVersion: number;
};
type Bucket = { draw: THREE.InstancedMesh; capacity: number; signature: unknown[] };
export type StreamedBatchStats = { sourceDraws: number; draws: number; instances: number; capacityInstances: number; uploads: number };

/** Consolidate exact opaque prefixes while their chunks retain gameplay/LOD ownership. */
export class StreamedInstanceBatches {
  readonly root = new StaticRenderBundle();
  private readonly owners = new Map<THREE.Object3D, Source[]>();
  private readonly buckets = new Map<string, Bucket>();
  private readonly world = new THREE.Matrix4();
  private uploads = 0;

  constructor() { this.root.name = 'Combined streamed opaque instances'; }

  add(root: THREE.Object3D): void {
    if (this.owners.has(root)) return;
    const sources: Source[] = [];
    root.updateMatrixWorld(true);
    root.traverse(object => {
      const mesh = object as THREE.InstancedMesh;
      // GPU-produced prefixes have no CPU mirror for this CPU batch compiler.
      if (!mesh.isInstancedMesh || mesh.userData.instanceCompactionSource || mesh.userData.gpuInstanceGather || mesh.frustumCulled || mesh.morphTexture) return;
      const prototype = exactInstancePrototype(mesh.geometry);
      if (!prototype || !this.compatibleGeometry(mesh.geometry, prototype)) return;
      const attributes = Object.entries(mesh.geometry.attributes)
        .filter(([,a]) => (a as Attribute).isInstancedBufferAttribute) as Array<[string, Attribute]>;
      if (attributes.some(([,a]) => (a as Attribute).meshPerAttribute !== 1 || a.count < mesh.instanceMatrix.count)) return;
      if (Array.isArray(mesh.material) || mesh.material.transparent || mesh.geometry.getIndirect()) return;
      const schema = attributes.map(([name,a]) => `${name}:${a.itemSize}:${a.normalized}:${a.gpuType}:${a.array.constructor.name}`).sort().join('|');
      const staticAttributes=Object.entries(mesh.geometry.attributes).filter(([,a])=>!(a as Attribute).isInstancedBufferAttribute)
        .map(([name,a])=>({name,attribute:a as THREE.BufferAttribute,version:(a as THREE.BufferAttribute).version}));
      sources.push({ mesh, geometry: mesh.geometry, prototype, layers: mesh.layers.mask, schema, staticAttributes,
        instanceAttributes: attributes, index: mesh.geometry.index, indexVersion: mesh.geometry.index?.version ?? -1 });
      mesh.userData.streamedInstanceBatchSource = true;
    });
    this.owners.set(root, sources);
  }

  remove(root: THREE.Object3D): void {
    for (const source of this.owners.get(root) ?? []) {
      source.mesh.layers.mask = source.layers;
      delete source.mesh.userData.streamedInstanceBatchSource;
    }
    this.owners.delete(root);
  }

  /** Call after chunk controllers commit their matrices, attributes and visibility. */
  prepare(): { changed: boolean; shadowChanged: boolean } {
    this.root.updateWorldMatrix(true, false);
    const grouped = new Map<string, Source[]>();
    for (const sources of this.owners.values()) for (const source of sources) {
      const mesh = source.mesh;
      // Shared model matrices matter to wind shaders as well as positions.
      // Unsupported transforms/material changes retain the original draw.
      this.world.copy(mesh.parent?.matrixWorld ?? new THREE.Matrix4()).multiply(mesh.matrix);
      const immutable = mesh.geometry === source.geometry
        && Object.keys(mesh.geometry.attributes).length === source.staticAttributes.length + source.instanceAttributes.length
        && source.staticAttributes.every(a => mesh.geometry.getAttribute(a.name) === a.attribute && a.attribute.version === a.version)
        && source.instanceAttributes.every(([name,a]) => mesh.geometry.getAttribute(name) === a
          && a.meshPerAttribute === 1 && a.count >= mesh.instanceMatrix.count)
        && mesh.geometry.index === source.index && (mesh.geometry.index?.version ?? -1) === source.indexVersion;
      if (Array.isArray(mesh.material) || mesh.material.transparent || mesh.frustumCulled || mesh.morphTexture || !immutable || !this.world.equals(this.root.matrixWorld)) {
        mesh.layers.mask = source.layers;
        continue;
      }
      mesh.layers.mask = 0;
      if (!mesh.count || !this.visible(mesh)) continue;
      const ranges=`${mesh.geometry.drawRange.start}:${mesh.geometry.drawRange.count}:${mesh.geometry.groups.map(g=>`${g.start},${g.count},${g.materialIndex}`).join(';')}`;
      const key = `${source.prototype.id}:${mesh.material.uuid}:${source.layers}:${source.schema}:${ranges}:${!!mesh.instanceColor}:${mesh.castShadow}:${mesh.receiveShadow}:${mesh.renderOrder}:${mesh.customDepthMaterial?.uuid}:${mesh.customDistanceMaterial?.uuid}`;
      const list = grouped.get(key) ?? [];
      list.push(source); grouped.set(key, list);
    }
    let changed = false, shadowChanged = false;
    for (const [key,bucket] of this.buckets) if (!grouped.has(key)) {
      shadowChanged ||= bucket.draw.castShadow;
      this.release(bucket); this.buckets.delete(key); changed = true;
    }
    for (const [key,sources] of grouped) {
      const count = sources.reduce((n,s) => n+s.mesh.count,0);
      let bucket = this.buckets.get(key);
      if (!bucket || bucket.capacity < count) {
        if (bucket) this.release(bucket);
        bucket = this.createBucket(sources[0]!,count);
        this.buckets.set(key,bucket); changed = true;
      }
      const signature: unknown[] = [];
      for (const {mesh} of sources) {
        signature.push(mesh, mesh.count, mesh.instanceMatrix, mesh.instanceMatrix.version, mesh.instanceColor, mesh.instanceColor?.version);
        for (const attr of Object.values(mesh.geometry.attributes)) if ((attr as Attribute).isInstancedBufferAttribute) signature.push(attr,(attr as Attribute).version);
      }
      if (signature.length === bucket.signature.length && signature.every((value,i) => value === bucket!.signature[i])) continue;
      bucket.signature = signature;
      const draw = bucket.draw;
      let offset = 0;
      for (const {mesh} of sources) {
        this.copy(mesh.instanceMatrix, draw.instanceMatrix, mesh.count, offset);
        if (mesh.instanceColor && draw.instanceColor) this.copy(mesh.instanceColor,draw.instanceColor,mesh.count,offset);
        for (const [name,attr] of Object.entries(mesh.geometry.attributes)) if ((attr as Attribute).isInstancedBufferAttribute) {
          this.copy(attr as Attribute,draw.geometry.getAttribute(name) as Attribute,mesh.count,offset);
        }
        offset += mesh.count;
      }
      draw.count = count;
      for (const attribute of [draw.instanceMatrix,draw.instanceColor,...Object.values(draw.geometry.attributes)]) {
        if (!attribute || !(attribute as Attribute).isInstancedBufferAttribute) continue;
        (attribute as Attribute).clearUpdateRanges();
        (attribute as Attribute).addUpdateRange(0,count*attribute.itemSize);
        (attribute as Attribute).needsUpdate = true;
      }
      this.uploads++; changed = true; shadowChanged ||= draw.castShadow;
    }
    return {changed,shadowChanged};
  }

  stats(shadowOnly = false): StreamedBatchStats {
    let sourceDraws=0,draws=0,instances=0,capacityInstances=0;
    for (const bucket of this.buckets.values()) {
      if (!!bucket.draw.userData.seedThreeShadowOnly !== shadowOnly) continue;
      if (bucket.draw.count) {
        draws++; instances+=bucket.draw.count;
        sourceDraws+=bucket.signature.filter(value => value instanceof THREE.InstancedMesh).length;
      }
      capacityInstances+=bucket.capacity;
    }
    return {sourceDraws,draws,instances,capacityInstances,uploads:this.uploads};
  }

  dispose(): void {
    for (const owner of [...this.owners.keys()]) this.remove(owner);
    for (const bucket of this.buckets.values()) this.release(bucket);
    this.buckets.clear(); this.root.removeFromParent();
  }

  private createBucket(source: Source, count: number): Bucket {
    const mesh=source.mesh, capacity=2**Math.ceil(Math.log2(Math.max(1,count)));
    const geometry=new THREE.BufferGeometry();
    // Own base attributes too: unloading a chunk or resizing another batch
    // must not dispose GPU buffers that this draw still uses.
    if (source.prototype.index) geometry.setIndex(source.prototype.index.clone());
    for (const [name,attribute] of Object.entries(mesh.geometry.attributes)) {
      if ((attribute as Attribute).isInstancedBufferAttribute) {
        const input=attribute as Attribute;
        const ArrayType=input.array.constructor as typeof Float32Array;
        const output=new THREE.InstancedBufferAttribute(new ArrayType(capacity*input.itemSize),input.itemSize,input.normalized);
        output.gpuType=input.gpuType;geometry.setAttribute(name,output);
      } else geometry.setAttribute(name,source.prototype.getAttribute(name).clone());
    }
    for (const group of mesh.geometry.groups) geometry.addGroup(group.start,group.count,group.materialIndex);
    geometry.setDrawRange(mesh.geometry.drawRange.start,mesh.geometry.drawRange.count);
    const draw=new THREE.InstancedMesh(geometry,mesh.material,capacity);
    draw.instanceMatrix=new StorageInstancedBufferAttribute(capacity,16);
    if (mesh.instanceColor) draw.instanceColor=new StorageInstancedBufferAttribute(capacity,4);
    draw.count=0; draw.frustumCulled=false; draw.name=`Combined ${mesh.name}`;
    draw.layers.mask=source.layers; draw.castShadow=mesh.castShadow; draw.receiveShadow=mesh.receiveShadow; draw.renderOrder=mesh.renderOrder;
    draw.customDepthMaterial=mesh.customDepthMaterial; draw.customDistanceMaterial=mesh.customDistanceMaterial;
    draw.userData={seedThreeShadowOnly:mesh.userData.seedThreeShadowOnly === true,streamedInstanceBatchDraw:true};
    this.root.add(draw);
    this.root.invalidateTransforms();
    return {draw,capacity,signature:[]};
  }

  private copy(source: Attribute,output: Attribute,count:number,offset:number): void {
    const size=source.itemSize,stride=output.itemSize;
    if (size===stride) output.array.set(source.array.subarray(0,count*size),offset*stride);
    else for(let row=0;row<count;row++)output.array.set(source.array.subarray(row*size,(row+1)*size),(offset+row)*stride);
  }
  private visible(mesh: THREE.Object3D): boolean {
    for(let object:THREE.Object3D|null=mesh;object;object=object.parent)if(!object.visible)return false;
    return true;
  }
  private compatibleGeometry(geometry:THREE.BufferGeometry,prototype:THREE.BufferGeometry):boolean {
    const same=(a:THREE.BufferAttribute|THREE.InterleavedBufferAttribute|null,b:THREE.BufferAttribute|THREE.InterleavedBufferAttribute|null) => {
      if (!a||!b)return a===b;
      if (!(a as THREE.BufferAttribute).isBufferAttribute || !(b as THREE.BufferAttribute).isBufferAttribute)return false;
      return a.itemSize===b.itemSize&&a.normalized===b.normalized&&a.array.constructor===b.array.constructor
        &&a.array.length===b.array.length&&a.array.every((value,i)=>value===b.array[i]);
    };
    if(!same(geometry.index,prototype.index))return false;
    return Object.entries(geometry.attributes).every(([name,a])=>(a as Attribute).isInstancedBufferAttribute||same(a,prototype.getAttribute(name)));
  }
  private release(bucket:Bucket):void {bucket.draw.removeFromParent();bucket.draw.dispose();bucket.draw.geometry.dispose();}
}
