import * as THREE from 'three';
import { StorageInstancedBufferAttribute, type WebGPURenderer } from 'three/webgpu';
import * as TSL from 'three/tsl';
import type { SupportedRenderer } from './RendererBackend.ts';

type Pair = {
  source: THREE.InstancedBufferAttribute;
  input: StorageInstancedBufferAttribute;
  output: StorageInstancedBufferAttribute;
  matrix: boolean;
  bytes: Uint8Array | null;
  padding: number;
  version: number;
  fullUpdatePending: boolean;
};
// Several runtime TSL scalar/bit operators are missing from the declarations.
const nodes = TSL as any;

/** Keep canonical plant attributes resident; upload only visible row IDs on camera moves. */
export class InstanceAttributeGather {
  static supports(
    source: THREE.InstancedMesh,
    renderer?: SupportedRenderer,
  ): renderer is WebGPURenderer {
    const limit = (renderer as WebGPURenderer | undefined)?.backend as unknown as
      { device?: { limits: { maxStorageBufferBindingSize: number } } } | undefined;
    const bytes = limit?.device?.limits.maxStorageBufferBindingSize ?? 0;
    // Keep small prefixes on direct copying to avoid compute dispatch overhead.
    if (!bytes || source.instanceMatrix.count < 1024) return false;
    const attributes = [
      source.instanceMatrix,
      source.instanceColor,
      ...Object.values(source.geometry.attributes).filter(
        (a) => (a as THREE.InstancedBufferAttribute).isInstancedBufferAttribute,
      ),
    ].filter((a): a is THREE.InstancedBufferAttribute => !!a);
    return attributes.every((attribute) => {
      const matrix = attribute === source.instanceMatrix;
      const stride = attribute.itemSize === 3 ? 4 : attribute.itemSize;
      return (
        (attribute.array instanceof Float32Array ||
          (!matrix && attribute.array instanceof Uint8Array)) &&
        (matrix ? attribute.itemSize === 16 : attribute.itemSize <= 4) &&
        attribute.gpuType === THREE.FloatType &&
        attribute.meshPerAttribute === 1 &&
        attribute.count >= source.instanceMatrix.count &&
        Math.max(attribute.array.byteLength, source.instanceMatrix.count * stride * 4) <= bytes
      );
    });
  }

  readonly pairs: Pair[] = [];
  readonly selected: StorageInstancedBufferAttribute;
  readonly stats = { sourceUploadBytes: 0, selectionUploadBytes: 0, dispatches: 0 };
  private readonly renderer: WebGPURenderer;
  private readonly kernels: any[] = [];

  constructor(source: THREE.InstancedMesh, draw: THREE.InstancedMesh, renderer: WebGPURenderer) {
    this.renderer = renderer;
    const capacity = source.instanceMatrix.count;
    this.selected = new StorageInstancedBufferAttribute(new Uint32Array(capacity), 1);
    const byAttribute = new Map<THREE.InstancedBufferAttribute, Pair>();
    const bind = (attribute: THREE.InstancedBufferAttribute, matrix = false): Pair => {
      const existing = byAttribute.get(attribute);
      if (existing) return existing;
      const bytes =
        attribute.array instanceof Uint8Array
          ? new Uint8Array(Math.ceil(attribute.array.length / 4) * 4)
          : null;
      // Flat scalar float inputs preserve packed vec3 arrays; storage vec3
      // would cause Three to replace the shared array with a padded allocation.
      const input = new StorageInstancedBufferAttribute(
        bytes ? new Uint32Array(bytes.buffer) : attribute.array,
        matrix ? 16 : 1,
      );
      const output = new StorageInstancedBufferAttribute(
        capacity,
        attribute.itemSize === 3 ? 4 : attribute.itemSize,
      );
      const pair = {
        source: attribute,
        input,
        output,
        matrix,
        bytes,
        // Padded RGB vertex colors must retain the original implicit alpha=1.
        padding:
          attribute === source.geometry.getAttribute('color') || attribute === source.instanceColor
            ? 1
            : 0,
        version: -1,
        fullUpdatePending: true,
      };
      byAttribute.set(attribute, pair);
      this.pairs.push(pair);
      return pair;
    };
    draw.instanceMatrix = bind(source.instanceMatrix, true).output;
    if (source.instanceColor) draw.instanceColor = bind(source.instanceColor).output;
    for (const [name, attribute] of Object.entries(source.geometry.attributes)) {
      if ((attribute as THREE.InstancedBufferAttribute).isInstancedBufferAttribute)
        draw.geometry.setAttribute(name, bind(attribute as THREE.InstancedBufferAttribute).output);
    }
    const selected = nodes.storage(this.selected, 'uint', capacity).toReadOnly();
    // Three input/output pairs and row IDs use seven portable storage bindings.
    for (let start = 0; start < this.pairs.length; start += 3) {
      const buffers = this.pairs.slice(start, start + 3).map((pair) => ({
        pair,
        input: nodes
          .storage(
            pair.input,
            pair.matrix ? 'mat4' : pair.bytes ? 'uint' : 'float',
            pair.input.count,
          )
          .toReadOnly(),
        output: nodes.storage(
          pair.output,
          pair.matrix ? 'mat4' : 'float',
          capacity * (pair.matrix ? 1 : pair.output.itemSize),
        ),
      }));
      this.kernels.push(
        nodes
          .Fn(() => {
            const row = nodes.instanceIndex,
              sourceRow = selected.element(row);
            for (const { pair, input, output } of buffers) {
              if (pair.matrix) output.element(row).assign(input.element(sourceRow));
              else
                for (let component = 0; component < pair.output.itemSize; component++) {
                  let value: any = nodes.float(pair.padding);
                  if (component < pair.source.itemSize) {
                    const index = sourceRow.mul(pair.source.itemSize).add(component);
                    if (pair.bytes) {
                      const word = input.element(index.div(nodes.uint(4)));
                      const byte = word
                        .shiftRight(index.mod(nodes.uint(4)).mul(nodes.uint(8)))
                        .bitAnd(nodes.uint(255));
                      value = nodes.float(byte);
                      if (pair.source.normalized) value = value.div(255);
                    } else value = input.element(index);
                  }
                  output.element(row.mul(pair.output.itemSize).add(component)).assign(value);
                }
            }
          })()
          .compute(1),
      );
    }
    draw.userData.gpuInstanceGather = true;
    source.userData.instanceGatherBytes =
      this.selected.array.byteLength +
      this.pairs.reduce(
        (sum, pair) => sum + pair.input.array.byteLength + pair.output.array.byteLength,
        0,
      );
    source.userData.instanceGatherUploads = this.stats;
  }

  updateInputs(): boolean {
    let changed = false;
    for (const pair of this.pairs) {
      if (pair.version === pair.source.version) continue;
      const ranges =
        pair.version >= 0 && pair.version + 1 === pair.source.version
          ? pair.source.updateRanges
          : [];
      pair.fullUpdatePending ||= ranges.length === 0;
      if (pair.fullUpdatePending) pair.input.clearUpdateRanges();
      if (pair.bytes) {
        const source = pair.source.array as Uint8Array;
        if (pair.fullUpdatePending) pair.bytes.set(source);
        else
          for (const range of ranges) {
            pair.bytes.set(source.subarray(range.start, range.start + range.count), range.start);
            const start = Math.floor(range.start / 4),
              end = Math.ceil((range.start + range.count) / 4);
            pair.input.addUpdateRange(start, end - start);
          }
      } else {
        pair.input.array = pair.source.array;
        if (!pair.fullUpdatePending)
          for (const range of ranges) pair.input.addUpdateRange(range.start, range.count);
      }
      pair.input.needsUpdate = true;
      pair.version = pair.source.version;
      changed = true;
    }
    return changed;
  }

  gather(count: number, ranges: readonly number[], selectionChanged: boolean): void {
    if (!count) return; // Retain every pending source edit until the next dispatch.
    if (selectionChanged) {
      for (let i = 0; i < ranges.length; i += 3) {
        const source = ranges[i]!,
          target = ranges[i + 1]!,
          length = ranges[i + 2]!;
        for (let row = 0; row < length; row++) this.selected.array[target + row] = source + row;
      }
      this.selected.clearUpdateRanges();
      this.selected.addUpdateRange(0, count);
      this.selected.needsUpdate = true;
      this.stats.selectionUploadBytes += count * 4;
    }
    for (const pair of this.pairs)
      if (pair.fullUpdatePending || pair.input.updateRanges.length) {
        this.stats.sourceUploadBytes += pair.fullUpdatePending
          ? pair.input.array.byteLength
          : pair.input.updateRanges.reduce(
              (sum, range) => sum + range.count * pair.input.array.BYTES_PER_ELEMENT,
              0,
            );
      }
    for (const kernel of this.kernels) kernel.count = count;
    this.renderer.compute(this.kernels as never);
    for (const pair of this.pairs) pair.fullUpdatePending = false;
    this.stats.dispatches++;
  }

  dispose(source: THREE.InstancedMesh): void {
    for (const kernel of this.kernels) kernel.dispose();
    const attributes = (
      this.renderer as unknown as {
        _attributes: { delete(attribute: THREE.BufferAttribute): void };
      }
    )._attributes;
    attributes.delete(this.selected);
    for (const pair of this.pairs) {
      attributes.delete(pair.input);
      attributes.delete(pair.output);
    }
    delete source.userData.instanceGatherBytes;
    delete source.userData.instanceGatherUploads;
  }
}
