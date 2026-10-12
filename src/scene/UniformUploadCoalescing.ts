import type { WebGPURenderer } from 'three/webgpu';

type UniformBinding = {
  isUniformBuffer?: boolean;
  isUniformsGroup?: boolean;
  buffer: Float32Array;
  updateRanges: { start: number; count: number }[];
};
type Backend = {
  isWebGPUBackend?: boolean;
  device?: { queue: { writeBuffer(buffer: unknown, offset: number, data: Float32Array, start: number, count: number): void } };
  get(binding: UniformBinding): { buffer: unknown };
  updateBinding(binding: UniformBinding): void;
};

const installations = new WeakMap<object, () => void>();
const MAX_UPLOAD_BYTES = 4096;

/** Combine small uniform edits without changing storage or attribute uploads. */
export function installUniformUploadCoalescing(renderer: WebGPURenderer): () => void {
  const backend = (renderer as unknown as { backend: Backend }).backend;
  const previous = installations.get(backend);
  if (previous) return previous;
  if (!backend.isWebGPUBackend || !backend.device) return () => {};
  const original = backend.updateBinding;
  const upload: Backend['updateBinding'] = function(this: Backend, binding) {
    const ranges = binding.updateRanges;
    if (binding.isUniformBuffer && binding.isUniformsGroup && binding.buffer instanceof Float32Array && ranges.length > 1) {
      let start = ranges[0]!.start;
      let end = start + ranges[0]!.count;
      let hasGap = false;
      for (let index = 1; index < ranges.length; index++) {
        const range = ranges[index]!;
        hasGap ||= range.start !== end;
        start = Math.min(start, range.start);
        end = Math.max(end, range.start + range.count);
      }
      // Uniform buffers are read-only on the GPU. Their CPU array also owns
      // unchanged values and padding between edits, so copying a small gap is
      // exact. Keep every write at its original position in the queue: color,
      // shadow and later camera passes may use different values in one frame.
      if (hasGap && (end - start) * Float32Array.BYTES_PER_ELEMENT <= MAX_UPLOAD_BYTES) {
        this.device!.queue.writeBuffer(this.get(binding).buffer,
          start * Float32Array.BYTES_PER_ELEMENT, binding.buffer, start, end - start);
        return;
      }
    }
    original.call(this, binding);
  };
  backend.updateBinding = upload;
  const restore = () => {
    if (installations.get(backend) !== restore) return;
    if (backend.updateBinding === upload) backend.updateBinding = original;
    installations.delete(backend);
  };
  installations.set(backend, restore);
  return restore;
}
