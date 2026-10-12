import assert from 'node:assert/strict';
import type { WebGPURenderer } from 'three/webgpu';
import WebGPUBindingUtils from 'three/src/renderers/webgpu/utils/WebGPUBindingUtils.js';
import { installUniformUploadCoalescing } from '../src/scene/UniformUploadCoalescing.ts';

function fixture(coalesce: boolean) {
  let writes = 0;
  const backend = {
    isWebGPUBackend: true,
    device: { queue: { writeBuffer(target: Uint8Array, offset: number, data: Float32Array, start = 0, count = data.length - start) {
      writes++;
      target.set(new Uint8Array(data.buffer, data.byteOffset + start * 4, count * 4), offset);
    } } },
    get: (binding: { gpu: Uint8Array }) => ({ buffer: binding.gpu }),
    updateBinding(binding: unknown) { native.updateBinding(binding); },
  };
  const native = new WebGPUBindingUtils(backend);
  const renderer = { backend } as unknown as WebGPURenderer;
  const restore = coalesce ? installUniformUploadCoalescing(renderer) : () => {};
  return { backend, renderer, restore, writes: () => writes };
}
const reference = fixture(false), optimized = fixture(true);
assert.equal(installUniformUploadCoalescing(optimized.renderer), optimized.restore, 'Installation is idempotent');
const cases = [
  { name: 'no ranges', size: 32, ranges: [] },
  { name: 'one range', size: 32, ranges: [{ start: 4, count: 4 }] },
  { name: 'contiguous ranges', size: 32, ranges: [{ start: 4, count: 4 }, { start: 8, count: 8 }] },
  { name: 'three sparse edits with integer bit patterns', size: 32,
    ranges: [{ start: 1, count: 1 }, { start: 8, count: 3 }, { start: 20, count: 4 }] },
  { name: 'bounded upload skips large sparse uniform blocks', size: 4096,
    ranges: [{ start: 1, count: 1 }, { start: 2048, count: 4 }] },
  { name: 'ordinary uniform buffer keeps native behavior', size: 32, group: false,
    ranges: [{ start: 1, count: 1 }, { start: 20, count: 4 }] },
  { name: 'storage binding keeps native behavior', size: 32, uniform: false,
    ranges: [{ start: 1, count: 1 }, { start: 20, count: 4 }] },
];
let avoidedWrites = 0;
for (const test of cases) {
  const initial = new Float32Array(test.size);
  for (let index = 0; index < initial.length; index++) initial[index] = index * .13;
  const bindings = [reference, optimized].map(() => ({
    isUniformBuffer: test.uniform !== false, isUniformsGroup: test.group !== false,
    buffer: initial.slice(), gpu: new Uint8Array(initial.buffer.slice(0)), updateRanges: test.ranges,
  }));
  for (let pass = 0; pass < 4; pass++) {
    const before = [reference.writes(), optimized.writes()];
    // Reuse the same binding for successive color, shadow, and camera values.
    for (const binding of bindings) {
      const bits = new Uint32Array(binding.buffer.buffer);
      for (const range of test.ranges.length ? test.ranges : [{ start: 0, count: test.size }]) {
        for (let index = range.start; index < range.start + range.count; index++) {
          bits[index] = 0x7fc00000 + index + pass * 100;
        }
      }
    }
    reference.backend.updateBinding(bindings[0]);
    optimized.backend.updateBinding(bindings[1]);
    assert.deepEqual(bindings[1].gpu, bindings[0].gpu, `${test.name}, pass ${pass}: exact GPU bytes`);
    assert.equal(bindings[1].updateRanges, test.ranges, 'Ranges remain owned by Three');
    const saved = reference.writes() - before[0] - (optimized.writes() - before[1]);
    avoidedWrites += saved;
    assert.equal(saved, test.name.startsWith('three sparse') ? 2 : 0, `${test.name}: native fallback or coalescing`);
  }
}
optimized.restore();
const reinstalled = installUniformUploadCoalescing(optimized.renderer);
assert.notEqual(reinstalled, optimized.restore, 'Restoration permits a new installation');
optimized.restore();
assert.equal(installUniformUploadCoalescing(optimized.renderer), reinstalled, 'An old restore cannot remove the current installation');
reinstalled();
assert.equal(avoidedWrites, 8);
console.log(`PASS: ${cases.length} cases × four successive passes; exact GPU bytes and eight avoided writes`);
