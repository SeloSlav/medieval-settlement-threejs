import * as THREE from 'three';
import { StorageInstancedBufferAttribute, type WebGPURenderer } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { inheritExactInstancePrototype } from './ExactInstancePrototype.ts';

type Pair = {
  name: string;
  source: THREE.InstancedBufferAttribute;
  input: StorageInstancedBufferAttribute;
  output: StorageInstancedBufferAttribute;
  version: number;
};
// The installed declarations omit several operators available in the runtime TSL API.
const nodes = TSL as any;

/** Cull whole crowns on the CPU, gather unchanged authored card data on the GPU. */
export class GroupedInstanceDraws {
  static supports(source: THREE.InstancedMesh, renderer: WebGPURenderer): boolean {
    const device=(renderer.backend as unknown as {device?:{limits:{maxStorageBufferBindingSize:number}}}).device;
    const bytes = Math.max(source.instanceMatrix.array.byteLength,
      ...Object.values(source.geometry.attributes)
        .filter(attribute => (attribute as THREE.InstancedBufferAttribute).isInstancedBufferAttribute)
        .map(attribute => attribute.array.byteLength),
      source.instanceColor ? source.instanceColor.count * 16 : 0);
    const supported=!!device&&bytes<=device.limits.maxStorageBufferBindingSize;
    if(!supported)source.userData.instanceGatherSkipped='storage-binding-limit';
    return supported;
  }
  readonly draw: THREE.InstancedMesh;
  private readonly source: THREE.InstancedMesh;
  private readonly renderer: WebGPURenderer;
  private readonly padding: () => number;
  private readonly groupSize: number;
  private readonly pairs: Pair[] = [];
  private readonly selected: StorageInstancedBufferAttribute;
  private readonly bounds: Float64Array;
  private readonly matrix = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();
  private readonly box = new THREE.Box3();
  private readonly projection = new THREE.Matrix4();
  private readonly frustum = new THREE.Frustum();
  private readonly kernels: any[] = [];
  private selectedCount = -1;
  private previousCount = -1;
  private readonly layers: number;
  private disposed = false;

  constructor(source: THREE.InstancedMesh, renderer: WebGPURenderer, padding: () => number) {
    this.source = source; this.renderer = renderer; this.padding = padding;
    this.groupSize = Math.max(1, Number(source.userData.k) || 1);
    if (source.instanceMatrix.count % this.groupSize || Array.isArray(source.material) || source.material.transparent) throw new Error('Grouped draws require complete opaque crowns');
    const capacity = source.instanceMatrix.count;
    const groupCapacity = capacity / this.groupSize;
    this.layers = source.layers.mask;
    const geometry = new THREE.BufferGeometry();
    inheritExactInstancePrototype(geometry, source.geometry);
    geometry.userData = { ...source.geometry.userData, instanceCompactionDraw: true };
    if (source.geometry.index) geometry.setIndex(source.geometry.index);
    geometry.setDrawRange(source.geometry.drawRange.start, source.geometry.drawRange.count);
    for (const group of source.geometry.groups) geometry.addGroup(group.start,group.count,group.materialIndex);
    const attributes: Array<[string, THREE.InstancedBufferAttribute]> = [['instanceMatrix',source.instanceMatrix]];
    for (const [name, attribute] of Object.entries(source.geometry.attributes)) {
      if ((attribute as THREE.InstancedBufferAttribute).isInstancedBufferAttribute) attributes.push([name,attribute as THREE.InstancedBufferAttribute]);
      else geometry.setAttribute(name,attribute);
    }
    if (source.instanceColor) attributes.push(['instanceColor',source.instanceColor]);
    this.draw = new THREE.InstancedMesh(geometry,source.material,capacity);
    this.draw.name = `${source.name} GPU visible crowns`;
    this.draw.count = 0; this.draw.layers.mask = this.layers; this.draw.frustumCulled = false;
    this.draw.userData = { ...source.userData, instanceCompactionDraw:true, gpuInstanceGather:true };
    for (const [name, attribute] of attributes) {
      const matrix = name === 'instanceMatrix';
      if ((!matrix && attribute.itemSize > 4) || attribute.meshPerAttribute !== 1 || attribute.count < capacity) throw new Error('Incomplete crown attributes');
      // Inputs alias the canonical CPU arrays; no second packed forest copy.
      const input = new StorageInstancedBufferAttribute(attribute.array, attribute.itemSize);
      // Instance.js reads colors as storage vec3 (16-byte stride). Geometry
      // attributes use native vertex formats and retain their original stride.
      const output = new StorageInstancedBufferAttribute(capacity, name === 'instanceColor' ? 4 : attribute.itemSize);
      output.setUsage(THREE.StaticDrawUsage);
      this.pairs.push({name,source:attribute,input,output,version:-1});
      if (matrix) this.draw.instanceMatrix = output;
      else if (name === 'instanceColor') this.draw.instanceColor = output;
      else geometry.setAttribute(name,output);
    }
    this.selected = new StorageInstancedBufferAttribute(new Uint32Array(groupCapacity),1);
    this.bounds = new Float64Array(groupCapacity * 4);
    source.geometry.computeBoundingSphere();
    const groups = nodes.storage(this.selected,'uint',groupCapacity).toReadOnly();
    // Three input/output pairs + selected IDs = seven storage bindings, within
    // WebGPU's portable limit. Flat float arrays preserve packed vec3 data.
    for (let start=0;start<this.pairs.length;start+=3) {
      const buffers=this.pairs.slice(start,start+3).map(pair=>({pair,
        input:nodes.storage(pair.input, pair.name === 'instanceMatrix' ? 'mat4' : 'float',
          capacity * (pair.name === 'instanceMatrix' ? 1 : pair.input.itemSize)).toReadOnly(),
        output:nodes.storage(pair.output, pair.name === 'instanceMatrix' ? 'mat4' : 'float',
          capacity * (pair.name === 'instanceMatrix' ? 1 : pair.output.itemSize))}));
      const kernel=nodes.Fn(()=>{
        const index=nodes.instanceIndex;
        const sourceIndex=groups.element(index.div(nodes.uint(this.groupSize))).mul(this.groupSize).add(index.mod(this.groupSize));
        for(const {pair,input,output} of buffers){
          if(pair.name === 'instanceMatrix') output.element(index).assign(input.element(sourceIndex));
          else for(let component=0;component<pair.output.itemSize;component++) {
            output.element(index.mul(pair.output.itemSize).add(component)).assign(component < pair.source.itemSize
              ? input.element(sourceIndex.mul(pair.source.itemSize).add(component)) : 0);
          }
        }
      })().compute(1);
      this.kernels.push(kernel);
    }
    this.syncRenderState();
    source.userData.instanceGatherBytes=this.selected.array.byteLength
      +this.pairs.reduce((sum,pair)=>sum+pair.input.array.byteLength+pair.output.array.byteLength,0);
    source.layers.mask=0;source.userData.instanceCompactionSource=true;source.add(this.draw);
  }

  get submittedInstances(): number { return Math.max(0,this.selectedCount) * this.groupSize; }

  syncRenderState(): void {
    this.draw.castShadow=this.source.castShadow;this.draw.receiveShadow=this.source.receiveShadow;
    this.draw.renderOrder=this.source.renderOrder;this.draw.material=this.source.material;
    this.draw.customDepthMaterial=this.source.customDepthMaterial;this.draw.customDistanceMaterial=this.source.customDistanceMaterial;
  }

  prepare(camera: THREE.Camera | null): void {
    const dirty=new Set<number>();
    let all=this.previousCount !== this.source.count, matricesChanged=false, changed=false;
    for(const pair of this.pairs){
      if(pair.version === pair.source.version)continue;
      changed=true;matricesChanged ||= pair.name === 'instanceMatrix';
      const ranges=pair.version >= 0 && pair.version+1 === pair.source.version ? pair.source.updateRanges : [];
      pair.input.array = pair.source.array;
      pair.input.clearUpdateRanges();
      if(ranges.length) for(const range of ranges) pair.input.addUpdateRange(range.start,range.count);
      pair.input.needsUpdate = true;
      if(pair.name === 'instanceMatrix' && !ranges.length)all=true;
      else if(pair.name === 'instanceMatrix') for(const range of ranges){
        const end=Math.min(this.source.instanceMatrix.count,Math.ceil((range.start+range.count)/pair.source.itemSize));
        for(let group=Math.floor(range.start/pair.source.itemSize/this.groupSize);group<Math.ceil(end/this.groupSize);group++)dirty.add(group);
      }
      pair.version=pair.source.version;
    }
    this.previousCount=this.source.count;
    for(let group=0;group<this.bounds.length/4;group++){
      if(!all&&!dirty.has(group))continue;
      const start=group*this.groupSize,end=start+this.groupSize;
      if(!matricesChanged&&!all)continue;
      this.box.makeEmpty();
      for(let row=start;row<end;row++){
          this.source.getMatrixAt(row,this.matrix);this.sphere.copy(this.source.geometry.boundingSphere!).applyMatrix4(this.matrix);
          if(this.sphere.radius===0)continue;
          const center=this.sphere.center,r=this.sphere.radius;
          this.box.min.x=Math.min(this.box.min.x,center.x-r);this.box.max.x=Math.max(this.box.max.x,center.x+r);
          this.box.min.y=Math.min(this.box.min.y,center.y-r);this.box.max.y=Math.max(this.box.max.y,center.y+r);
          this.box.min.z=Math.min(this.box.min.z,center.z-r);this.box.max.z=Math.max(this.box.max.z,center.z+r);
      }
      if(matricesChanged||all){
        const at=group*4;
        if(this.box.isEmpty())this.bounds[at+3]=-1;
        else{this.box.getBoundingSphere(this.sphere);this.bounds[at]=this.sphere.center.x;this.bounds[at+1]=this.sphere.center.y;this.bounds[at+2]=this.sphere.center.z;this.bounds[at+3]=this.sphere.radius;}
      }
    }
    if(camera){camera.updateWorldMatrix(true,false);this.source.updateWorldMatrix(true,false);
      this.projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).multiply(this.source.matrixWorld);
      this.frustum.setFromProjectionMatrix(this.projection,camera.coordinateSystem,camera.reversedDepth);}
    let selected=0;const padding=this.padding(),planes=camera?this.frustum.planes:[];
    for(let group=0;group<this.source.count/this.groupSize;group++){
      const at=group*4,r=this.bounds[at+3]!;if(r<0)continue;
      let visible=true;
      for(const plane of planes)if(plane.normal.x*this.bounds[at]!+plane.normal.y*this.bounds[at+1]!+plane.normal.z*this.bounds[at+2]!+plane.constant<-(r+padding)){visible=false;break;}
      if(!visible)continue;
      if(this.selected.array[selected]!==group){this.selected.array[selected]=group;changed=true;}
      selected++;
    }
    if(selected!==this.selectedCount){changed=true;this.selectedCount=selected;}
    this.draw.count=selected*this.groupSize;this.source.userData.compactedInstanceCount=this.draw.count;
    if(changed&&selected){
      this.selected.clearUpdateRanges();this.selected.addUpdateRange(0,selected);this.selected.needsUpdate=true;
      for(const kernel of this.kernels)kernel.count=this.draw.count;
      this.renderer.compute(this.kernels as never);
    }
  }

  dispose(): void {
    if(this.disposed)return;this.disposed=true;
    this.draw.removeFromParent();this.draw.dispose();this.draw.geometry.dispose();
    for(const kernel of this.kernels)kernel.dispose();
    const attributes=(this.renderer as unknown as { _attributes: { delete(attribute: THREE.BufferAttribute): void } })._attributes;
    attributes.delete(this.selected);
    for(const pair of this.pairs){attributes.delete(pair.input);attributes.delete(pair.output);}
    this.source.layers.mask=this.layers;delete this.source.userData.instanceCompactionSource;delete this.source.userData.compactedInstanceCount;
    delete this.source.userData.instanceGatherBytes;
  }
}
