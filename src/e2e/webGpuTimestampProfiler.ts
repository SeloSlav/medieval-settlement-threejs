import type { RendererBackend } from '../scene/RendererBackend.ts';

export type VisualGpuFrameTimingStatus =
  | 'available'
  | 'pending'
  | 'unavailable'
  | 'failed'
  | 'dropped'
  | 'missing';

export type VisualGpuFrameTiming = {
  frameRafTimestampMs: number;
  queryId: number | null;
  status: VisualGpuFrameTimingStatus;
  durationMs: number | null;
  limitation: string | null;
};

export type VisualGpuTimingEvidence = {
  requested: true;
  status: 'available' | 'unavailable';
  source: 'webgpu-timestamp-query' | 'unavailable';
  feature: 'timestamp-query';
  api: 'compute-pass-timestamp-writes' | 'unavailable';
  span: 'full-post-processing-queue-bookends' | 'unavailable';
  unit: 'milliseconds';
  slotCount: number;
  attemptedFrames: number;
  submittedFrames: number;
  resolvedFrames: number;
  pendingFrames: number;
  droppedFrames: number;
  failedFrames: number;
  limitations: string[];
};

type GpuFeatureSetLike = {
  has(feature: string): boolean;
};

type GpuQuerySetLike = {
  destroy?(): void;
};

type GpuBufferLike = {
  readonly mapState?: string;
  destroy?(): void;
  getMappedRange(offset?: number, size?: number): ArrayBuffer;
  mapAsync(mode: number, offset?: number, size?: number): Promise<void>;
  unmap(): void;
};

type GpuComputePassLike = {
  end(): void;
};

type GpuCommandEncoderLike = {
  beginComputePass(descriptor?: {
    label?: string;
    timestampWrites?: {
      querySet: GpuQuerySetLike;
      beginningOfPassWriteIndex?: number;
      endOfPassWriteIndex?: number;
    };
  }): GpuComputePassLike;
  copyBufferToBuffer(
    source: GpuBufferLike,
    sourceOffset: number,
    destination: GpuBufferLike,
    destinationOffset: number,
    size: number,
  ): void;
  finish(descriptor?: { label?: string }): unknown;
  resolveQuerySet(
    querySet: GpuQuerySetLike,
    firstQuery: number,
    queryCount: number,
    destination: GpuBufferLike,
    destinationOffset: number,
  ): void;
};

type GpuDeviceLike = {
  readonly features?: GpuFeatureSetLike;
  readonly queue?: {
    submit(commandBuffers: readonly unknown[]): void;
  };
  createBuffer(descriptor: {
    label?: string;
    size: number;
    usage: number;
  }): GpuBufferLike;
  createCommandEncoder(descriptor?: { label?: string }): GpuCommandEncoderLike;
  createQuerySet(descriptor: {
    label?: string;
    type: 'timestamp';
    count: number;
  }): GpuQuerySetLike;
};

type WebGpuConstants = {
  bufferUsage: {
    COPY_DST: number;
    COPY_SRC: number;
    MAP_READ: number;
    QUERY_RESOLVE: number;
  };
  mapModeRead: number;
};

type TimestampSlot = {
  index: number;
  busy: boolean;
  queryId: number | null;
  readBuffer: GpuBufferLike;
};

export type VisualGpuTimestampFrameHandle = {
  frameRafTimestampMs: number;
  queryId: number | null;
  slotIndex: number | null;
};

export type VisualGpuTimestampProfiler = {
  beginFrame(frameRafTimestampMs: number): VisualGpuTimestampFrameHandle;
  dispose(): void;
  endFrame(handle: VisualGpuTimestampFrameHandle): void;
  getEvidence(): VisualGpuTimingEvidence;
  getFrameTiming(frameRafTimestampMs: number): VisualGpuFrameTiming;
};

export type VisualGpuTimestampProfilerOptions = {
  slotCount?: number;
  constants?: WebGpuConstants;
  submitTimestampMarkers?: boolean;
};

export const VISUAL_GPU_TIMESTAMP_MARKERS_DISABLED_LIMITATION =
  'The two WebGPU timestamp marker submissions were disabled by the profile-only visualGpuTimestampMarkers=0 experimental control; no GPU duration was measured.';

export const VISUAL_GPU_NO_RENDER_CONTROL_LIMITATION =
  'The profile-only visualNoRender=1 control skipped postProcessor.render() only during the post-warmup measured window; GPU timestamp instrumentation and both marker submissions were disabled because no GPU render span existed. The schema-5 render-submission CPU subspan therefore measures the immediate no-render branch from its pre-render timestamp to the skip boundary; update/pre-render and post-render spans are unchanged.';

const DEFAULT_SLOT_COUNT = 32;
const MAX_RETAINED_FRAME_TIMINGS = 8_192;
const QUERY_RESOLVE_OFFSET_ALIGNMENT = 256;
const TIMESTAMP_PAIR_BYTE_LENGTH = 16;

export function createVisualGpuTimestampProfiler(
  backend: RendererBackend,
  options: VisualGpuTimestampProfilerOptions = {},
): VisualGpuTimestampProfiler {
  if (options.submitTimestampMarkers === false) {
    return createUnavailableVisualGpuTimestampProfiler(
      VISUAL_GPU_TIMESTAMP_MARKERS_DISABLED_LIMITATION,
    );
  }
  if (backend.kind !== 'webgpu') {
    return createUnavailableVisualGpuTimestampProfiler(
      `Selected renderer backend "${backend.kind}" is not WebGPU.`,
    );
  }

  const rendererWithDevice = backend.renderer as unknown as {
    backend?: {
      device?: unknown;
    };
  };
  const device = rendererWithDevice.backend?.device as GpuDeviceLike | undefined;
  if (!device) {
    return createUnavailableVisualGpuTimestampProfiler(
      'The initialized Three.js WebGPU backend did not expose its selected GPUDevice.',
    );
  }
  if (!device.features?.has('timestamp-query')) {
    return createUnavailableVisualGpuTimestampProfiler(
      'The selected GPUDevice did not enable the WebGPU timestamp-query feature.',
    );
  }
  const constants = options.constants ?? readWebGpuConstants();
  if (!constants) {
    return createUnavailableVisualGpuTimestampProfiler(
      'WebGPU buffer-usage or map-mode constants are unavailable in this runtime.',
    );
  }
  if (
    typeof device.queue?.submit !== 'function'
    || typeof device.createBuffer !== 'function'
    || typeof device.createCommandEncoder !== 'function'
    || typeof device.createQuerySet !== 'function'
  ) {
    return createUnavailableVisualGpuTimestampProfiler(
      'The selected GPUDevice does not expose the command, query, buffer, and queue APIs required for timestamp readback.',
    );
  }

  const slotCount = Math.max(
    1,
    Math.min(256, Math.floor(options.slotCount ?? DEFAULT_SLOT_COUNT)),
  );
  try {
    return createAvailableProfiler(device, constants, slotCount);
  } catch (error) {
    return createUnavailableVisualGpuTimestampProfiler(
      `Creating WebGPU timestamp-query resources failed: ${errorMessage(error)}`,
    );
  }
}

function createAvailableProfiler(
  device: GpuDeviceLike,
  constants: WebGpuConstants,
  slotCount: number,
): VisualGpuTimestampProfiler {
  const querySet = device.createQuerySet({
    label: 'visual-profile-full-post-query-set',
    type: 'timestamp',
    count: slotCount * 2,
  });
  const resolveBuffer = device.createBuffer({
    label: 'visual-profile-full-post-query-resolve',
    size: slotCount * QUERY_RESOLVE_OFFSET_ALIGNMENT,
    usage: constants.bufferUsage.QUERY_RESOLVE | constants.bufferUsage.COPY_SRC,
  });
  const slots: TimestampSlot[] = Array.from({ length: slotCount }, (_, index) => ({
    index,
    busy: false,
    queryId: null,
    readBuffer: device.createBuffer({
      label: `visual-profile-full-post-query-read-${index}`,
      size: TIMESTAMP_PAIR_BYTE_LENGTH,
      usage: constants.bufferUsage.COPY_DST | constants.bufferUsage.MAP_READ,
    }),
  }));
  const probeEncoder = device.createCommandEncoder({
    label: 'visual-profile-timestamp-api-probe',
  });
  if (
    typeof probeEncoder.beginComputePass !== 'function'
    || typeof probeEncoder.resolveQuerySet !== 'function'
    || typeof probeEncoder.copyBufferToBuffer !== 'function'
    || typeof probeEncoder.finish !== 'function'
  ) {
    querySet.destroy?.();
    resolveBuffer.destroy?.();
    for (const slot of slots) slot.readBuffer.destroy?.();
    throw new Error(
      'GPUCommandEncoder does not expose compute-pass timestamp writes and query resolution.',
    );
  }

  const timings = new Map<number, VisualGpuFrameTiming>();
  let nextQueryId = 1;
  let disposed = false;
  let attemptedFrames = 0;
  let submittedFrames = 0;
  let resolvedFrames = 0;
  let droppedFrames = 0;
  let failedFrames = 0;

  const recordTiming = (timing: VisualGpuFrameTiming): void => {
    timings.set(timing.frameRafTimestampMs, timing);
    if (timings.size <= MAX_RETAINED_FRAME_TIMINGS) return;
    for (const [frameTimestamp, retained] of timings) {
      if (retained.status === 'pending') continue;
      timings.delete(frameTimestamp);
      if (timings.size <= MAX_RETAINED_FRAME_TIMINGS) break;
    }
  };

  const failHandle = (
    handle: VisualGpuTimestampFrameHandle,
    limitation: string,
  ): void => {
    if (handle.slotIndex !== null) {
      const slot = slots[handle.slotIndex];
      if (slot?.queryId === handle.queryId) {
        slot.busy = false;
        slot.queryId = null;
      }
    }
    failedFrames += 1;
    recordTiming({
      frameRafTimestampMs: handle.frameRafTimestampMs,
      queryId: handle.queryId,
      status: 'failed',
      durationMs: null,
      limitation,
    });
  };

  const beginFrame = (
    frameRafTimestampMs: number,
  ): VisualGpuTimestampFrameHandle => {
    attemptedFrames += 1;
    const queryId = nextQueryId;
    nextQueryId += 1;
    const slot = slots.find((candidate) => !candidate.busy);
    if (!slot) {
      droppedFrames += 1;
      recordTiming({
        frameRafTimestampMs,
        queryId,
        status: 'dropped',
        durationMs: null,
        limitation:
          'All timestamp readback slots were still pending; this frame was not measured.',
      });
      return {
        frameRafTimestampMs,
        queryId,
        slotIndex: null,
      };
    }

    const handle = {
      frameRafTimestampMs,
      queryId,
      slotIndex: slot.index,
    };
    slot.busy = true;
    slot.queryId = queryId;
    recordTiming({
      frameRafTimestampMs,
      queryId,
      status: 'pending',
      durationMs: null,
      limitation: null,
    });

    try {
      const encoder = device.createCommandEncoder({
        label: `visual-profile-post-begin-${queryId}`,
      });
      const markerPass = encoder.beginComputePass({
        label: `visual-profile-post-begin-marker-${queryId}`,
        timestampWrites: {
          querySet,
          endOfPassWriteIndex: slot.index * 2,
        },
      });
      markerPass.end();
      device.queue!.submit([encoder.finish()]);
    } catch (error) {
      failHandle(
        handle,
        `Submitting the beginning timestamp marker failed: ${errorMessage(error)}`,
      );
      return {
        ...handle,
        slotIndex: null,
      };
    }

    return handle;
  };

  const endFrame = (handle: VisualGpuTimestampFrameHandle): void => {
    if (disposed || handle.slotIndex === null || handle.queryId === null) return;
    const slot = slots[handle.slotIndex];
    if (!slot || !slot.busy || slot.queryId !== handle.queryId) return;
    const firstQuery = slot.index * 2;
    const resolveOffset = slot.index * QUERY_RESOLVE_OFFSET_ALIGNMENT;

    try {
      const encoder = device.createCommandEncoder({
        label: `visual-profile-post-end-${handle.queryId}`,
      });
      const markerPass = encoder.beginComputePass({
        label: `visual-profile-post-end-marker-${handle.queryId}`,
        timestampWrites: {
          querySet,
          beginningOfPassWriteIndex: firstQuery + 1,
        },
      });
      markerPass.end();
      encoder.resolveQuerySet(
        querySet,
        firstQuery,
        2,
        resolveBuffer,
        resolveOffset,
      );
      encoder.copyBufferToBuffer(
        resolveBuffer,
        resolveOffset,
        slot.readBuffer,
        0,
        TIMESTAMP_PAIR_BYTE_LENGTH,
      );
      device.queue!.submit([encoder.finish()]);
      submittedFrames += 1;
    } catch (error) {
      failHandle(
        handle,
        `Submitting or resolving the ending timestamp marker failed: ${errorMessage(error)}`,
      );
      return;
    }

    void slot.readBuffer
      .mapAsync(constants.mapModeRead, 0, TIMESTAMP_PAIR_BYTE_LENGTH)
      .then(() => {
        if (disposed || slot.queryId !== handle.queryId) return;
        const times = new BigUint64Array(
          slot.readBuffer.getMappedRange(0, TIMESTAMP_PAIR_BYTE_LENGTH),
        );
        const startNanoseconds = times[0];
        const endNanoseconds = times[1];
        if (
          startNanoseconds === undefined
          || endNanoseconds === undefined
          || endNanoseconds < startNanoseconds
        ) {
          throw new Error('Timestamp results were missing or not monotonic.');
        }
        const durationMs = Number(endNanoseconds - startNanoseconds) / 1_000_000;
        if (!Number.isFinite(durationMs) || durationMs < 0) {
          throw new Error('Timestamp results did not produce a finite duration.');
        }
        resolvedFrames += 1;
        recordTiming({
          frameRafTimestampMs: handle.frameRafTimestampMs,
          queryId: handle.queryId,
          status: 'available',
          durationMs,
          limitation: null,
        });
      })
      .catch((error: unknown) => {
        if (disposed || slot.queryId !== handle.queryId) return;
        failedFrames += 1;
        recordTiming({
          frameRafTimestampMs: handle.frameRafTimestampMs,
          queryId: handle.queryId,
          status: 'failed',
          durationMs: null,
          limitation: `Timestamp readback failed: ${errorMessage(error)}`,
        });
      })
      .finally(() => {
        if (slot.readBuffer.mapState === 'mapped') slot.readBuffer.unmap();
        if (slot.queryId !== handle.queryId) return;
        slot.busy = false;
        slot.queryId = null;
      });
  };

  return {
    beginFrame,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      querySet.destroy?.();
      resolveBuffer.destroy?.();
      for (const slot of slots) {
        if (slot.readBuffer.mapState === 'mapped') slot.readBuffer.unmap();
        slot.readBuffer.destroy?.();
      }
    },
    endFrame,
    getEvidence: () => ({
      requested: true,
      status: 'available',
      source: 'webgpu-timestamp-query',
      feature: 'timestamp-query',
      api: 'compute-pass-timestamp-writes',
      span: 'full-post-processing-queue-bookends',
      unit: 'milliseconds',
      slotCount,
      attemptedFrames,
      submittedFrames,
      resolvedFrames,
      pendingFrames: slots.reduce(
        (count, slot) => count + (slot.busy ? 1 : 0),
        0,
      ),
      droppedFrames,
      failedFrames,
      limitations: [
        'Measures elapsed device-timeline time between queue-ordered markers submitted immediately before and after the full post-processing render; it includes any queue-idle gaps or intervening GPU work inside that bracket and excludes display presentation latency.',
        'The two empty compute-pass marker submissions are profile-only measurement overhead.',
        'The existing CPU render-submission subspan includes the profile-only beginning marker; ending-marker encoding, submission, and asynchronous readback initiation are part of the existing post-render CPU subspan.',
      ],
    }),
    getFrameTiming: (frameRafTimestampMs) => {
      const timing = timings.get(frameRafTimestampMs);
      if (timing) return { ...timing };
      return {
        frameRafTimestampMs,
        queryId: null,
        status: 'missing',
        durationMs: null,
        limitation: 'No timestamp query was recorded for this frame identity.',
      };
    },
  };
}

export function createUnavailableVisualGpuTimestampProfiler(
  reason: string,
): VisualGpuTimestampProfiler {
  const evidence: VisualGpuTimingEvidence = {
    requested: true,
    status: 'unavailable',
    source: 'unavailable',
    feature: 'timestamp-query',
    api: 'unavailable',
    span: 'unavailable',
    unit: 'milliseconds',
    slotCount: 0,
    attemptedFrames: 0,
    submittedFrames: 0,
    resolvedFrames: 0,
    pendingFrames: 0,
    droppedFrames: 0,
    failedFrames: 0,
    limitations: [reason],
  };
  return {
    beginFrame: (frameRafTimestampMs) => ({
      frameRafTimestampMs,
      queryId: null,
      slotIndex: null,
    }),
    dispose: () => {},
    endFrame: () => {},
    getEvidence: () => ({
      ...evidence,
      limitations: [...evidence.limitations],
    }),
    getFrameTiming: (frameRafTimestampMs) => ({
      frameRafTimestampMs,
      queryId: null,
      status: 'unavailable',
      durationMs: null,
      limitation: reason,
    }),
  };
}

function readWebGpuConstants(): WebGpuConstants | null {
  const globals = globalThis as typeof globalThis & {
    GPUBufferUsage?: Partial<WebGpuConstants['bufferUsage']>;
    GPUMapMode?: {
      READ?: number;
    };
  };
  const usage = globals.GPUBufferUsage;
  const mapModeRead = globals.GPUMapMode?.READ;
  if (
    typeof usage?.COPY_DST !== 'number'
    || typeof usage.COPY_SRC !== 'number'
    || typeof usage.MAP_READ !== 'number'
    || typeof usage.QUERY_RESOLVE !== 'number'
    || typeof mapModeRead !== 'number'
  ) {
    return null;
  }
  return {
    bufferUsage: {
      COPY_DST: usage.COPY_DST,
      COPY_SRC: usage.COPY_SRC,
      MAP_READ: usage.MAP_READ,
      QUERY_RESOLVE: usage.QUERY_RESOLVE,
    },
    mapModeRead,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
