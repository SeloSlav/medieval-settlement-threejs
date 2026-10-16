import * as THREE from 'three';
import { StorageInstancedBufferAttribute } from 'three/webgpu';

/** Test-only CPU copy of the selected LOD, with no camera/frustum rejection. */
export function unculledInstanceReference(helper: any) {
  const source: THREE.InstancedMesh = helper.source;
  const rows: number[] = [];
  for (let row = 0; row < source.count; row++) {
    if (!helper.groupVisible || helper.groupVisible(Math.floor(row / helper.groupSize))) rows.push(row);
  }
  const capacity = Math.max(1, rows.length);
  const geometry = new THREE.BufferGeometry();
  if (source.geometry.index) geometry.setIndex(source.geometry.index.clone());
  geometry.setDrawRange(source.geometry.drawRange.start, source.geometry.drawRange.count);
  for (const group of source.geometry.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  const copy = (attribute: THREE.InstancedBufferAttribute, storage = false) => {
    const stride = storage && attribute.itemSize === 3 ? 4 : attribute.itemSize;
    const ArrayType = attribute.array.constructor as typeof Float32Array;
    const output = storage ? new StorageInstancedBufferAttribute(capacity, stride)
      : new THREE.InstancedBufferAttribute(new ArrayType(capacity * stride), stride, attribute.normalized);
    output.gpuType = attribute.gpuType;
    rows.forEach((row, index) => {
      for (let component = 0; component < attribute.itemSize; component++) {
        output.array[index * stride + component] = attribute.array[row * attribute.itemSize + component]!;
      }
    });
    return output;
  };
  for (const [name, attribute] of Object.entries(source.geometry.attributes)) {
    geometry.setAttribute(name, (attribute as THREE.InstancedBufferAttribute).isInstancedBufferAttribute
      ? copy(attribute as THREE.InstancedBufferAttribute) : attribute.clone());
  }
  const draw = new THREE.InstancedMesh(geometry, source.material, capacity);
  draw.instanceMatrix = copy(source.instanceMatrix, true);
  if (source.instanceColor) draw.instanceColor = copy(source.instanceColor, true);
  draw.count = rows.length;
  draw.name = `${source.name} unculled CPU reference`;
  draw.layers.mask = helper.draw.layers.mask;
  draw.castShadow = source.castShadow; draw.receiveShadow = source.receiveShadow;
  draw.renderOrder = source.renderOrder; draw.frustumCulled = false; draw.visible = false;
  draw.customDepthMaterial = source.customDepthMaterial;
  draw.customDistanceMaterial = source.customDistanceMaterial;
  source.add(draw);
  draw.updateWorldMatrix(true, false);
  return { source, draw: helper.draw, reference: draw, dispose() {
    draw.removeFromParent(); draw.dispose(); geometry.dispose();
  } };
}
