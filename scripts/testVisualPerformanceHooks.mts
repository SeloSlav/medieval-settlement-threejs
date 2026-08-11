import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  areVisualSlowFrameGpuTimingsTerminal,
  appendVisualSlowFrameRecord,
  calculateVisualPerformanceMetrics,
  createRuntimeAppFrameAttribution,
  createUnavailableVisualGpuTimingEvidence,
  createVisualPerformanceDomPublicationGate,
  createVisualPerformanceReadyReportLatch,
  createVisualPerformanceResettleGate,
  createVisualPerformanceResetCoordinator,
  createVisualPerformanceReport,
  createVisualPerformanceTraceArmingBoundary,
  createVisualPerformanceTraceCapture,
  createVisualSlowFrameRecordForInterval,
  doVisualSlowFrameRecordsReproduceMetrics,
  executeVisualProfileRenderPath,
  hydrateVisualSlowFrameGpuTiming,
  resetVisualPerformanceSubsystems,
  selectVisualWorstFrameRecords,
  shouldCaptureVisualSlowFrame,
  VISUAL_FRAME_CPU_SPAN,
  VISUAL_FRAME_CPU_SUBSPANS,
  VISUAL_FRAME_GPU_SPAN,
  type ProfileSubsystem,
  type VisualSlowFrameContext,
  type VisualSlowFrameRecord,
} from '../src/e2e/visualPerformanceHooks.ts';
import {
  createUnavailableVisualGpuTimestampProfiler,
  createVisualGpuTimestampProfiler,
  VISUAL_GPU_NO_RENDER_CONTROL_LIMITATION,
  VISUAL_GPU_TIMESTAMP_MARKERS_DISABLED_LIMITATION,
} from '../src/e2e/webGpuTimestampProfiler.ts';
import {
  acquireWebGPUAdapterDevice,
  createPreferredRenderer,
  readWebGLAdapterEvidence,
  type RendererBackend,
} from '../src/scene/RendererBackend.ts';

class FakeGpuBuffer {
  readonly data: ArrayBuffer;
  mapState = 'unmapped';

  constructor(size: number) {
    this.data = new ArrayBuffer(size);
  }

  destroy(): void {}

  getMappedRange(): ArrayBuffer {
    return this.data;
  }

  async mapAsync(): Promise<void> {
    this.mapState = 'mapped';
  }

  unmap(): void {
    this.mapState = 'unmapped';
  }
}

class FakeGpuQuerySet {
  readonly values: bigint[];

  constructor(count: number) {
    this.values = Array.from({ length: count }, () => 0n);
  }

  destroy(): void {}
}

class FakeGpuDevice {
  timestampNanoseconds = 1_000_000n;
  submissions = 0;
  readonly features = {
    has: (feature: string) => feature === 'timestamp-query',
  };
  readonly queue = {
    submit: (commandBuffers: readonly unknown[]) => {
      this.submissions += 1;
      for (const commandBuffer of commandBuffers as Array<{ execute(): void }>) {
        commandBuffer.execute();
      }
    },
  };

  createBuffer(descriptor: { size: number }): FakeGpuBuffer {
    return new FakeGpuBuffer(descriptor.size);
  }

  createQuerySet(descriptor: { count: number }): FakeGpuQuerySet {
    return new FakeGpuQuerySet(descriptor.count);
  }

  createCommandEncoder(): {
    beginComputePass(descriptor?: {
      timestampWrites?: {
        querySet: FakeGpuQuerySet;
        beginningOfPassWriteIndex?: number;
        endOfPassWriteIndex?: number;
      };
    }): { end(): void };
    copyBufferToBuffer(
      source: FakeGpuBuffer,
      sourceOffset: number,
      destination: FakeGpuBuffer,
      destinationOffset: number,
      size: number,
    ): void;
    finish(): { execute(): void };
    resolveQuerySet(
      querySet: FakeGpuQuerySet,
      firstQuery: number,
      queryCount: number,
      destination: FakeGpuBuffer,
      destinationOffset: number,
    ): void;
  } {
    const operations: Array<() => void> = [];
    return {
      beginComputePass: (descriptor) => ({
        end: () => {
          operations.push(() => {
            const writes = descriptor?.timestampWrites;
            if (!writes) return;
            if (writes.beginningOfPassWriteIndex !== undefined) {
              writes.querySet.values[writes.beginningOfPassWriteIndex] =
                this.timestampNanoseconds;
            }
            if (writes.endOfPassWriteIndex !== undefined) {
              writes.querySet.values[writes.endOfPassWriteIndex] =
                this.timestampNanoseconds;
            }
          });
        },
      }),
      copyBufferToBuffer: (
        source,
        sourceOffset,
        destination,
        destinationOffset,
        size,
      ) => {
        operations.push(() => {
          new Uint8Array(destination.data, destinationOffset, size).set(
            new Uint8Array(source.data, sourceOffset, size),
          );
        });
      },
      finish: () => ({
        execute: () => {
          for (const operation of operations) operation();
        },
      }),
      resolveQuerySet: (
        querySet,
        firstQuery,
        queryCount,
        destination,
        destinationOffset,
      ) => {
        operations.push(() => {
          const output = new BigUint64Array(
            destination.data,
            destinationOffset,
            queryCount,
          );
          for (let index = 0; index < queryCount; index += 1) {
            output[index] = querySet.values[firstQuery + index]!;
          }
        });
      },
    };
  }
}

const frameTimes = [10, 20, 25, 25.01, 50, 50.01, 100];
const metrics = calculateVisualPerformanceMetrics(frameTimes);
assert.ok(metrics);
assert.equal(metrics.medianFps, 1000 / 25.01);
assert.equal(metrics.onePercentLowFps, 10);
assert.equal(metrics.meanFps, (frameTimes.length * 1000) / 280.02);
assert.equal(metrics.p99FrameMs, 100);
assert.equal(metrics.maxFrameMs, 100);
assert.equal(metrics.framesOver25Ms, 4);
assert.equal(metrics.framesOver50Ms, 2);

const twoHundredFrameTimes = Array.from({ length: 200 }, (_, index) => index + 1);
const longTraceMetrics = calculateVisualPerformanceMetrics(twoHundredFrameTimes);
assert.ok(longTraceMetrics);
assert.equal(longTraceMetrics.onePercentLowFps, 1000 / 199.5);
assert.equal(
  longTraceMetrics.p99FrameMs,
  199.5,
  'p99 must preserve the collector existing slowest-one-percent mean',
);

const tenThousandFrameTimes = Array.from(
  { length: 10_000 },
  (_, index) => 10 + index * 0.001,
);
const boundedLongTraceMetrics =
  calculateVisualPerformanceMetrics(tenThousandFrameTimes);
assert.ok(boundedLongTraceMetrics);
const uncappedLongTraceWorstFrames = [...tenThousandFrameTimes]
  .sort((a, b) => b - a)
  .slice(0, Math.ceil(tenThousandFrameTimes.length * 0.01));
const uncappedLongTraceWorstMean =
  uncappedLongTraceWorstFrames.reduce((sum, frameTime) => sum + frameTime, 0)
  / uncappedLongTraceWorstFrames.length;
assert.equal(
  boundedLongTraceMetrics.p99FrameMs,
  uncappedLongTraceWorstMean,
  'standard worst-one-percent metrics must remain uncapped above 6,400 samples',
);
assert.equal(
  boundedLongTraceMetrics.onePercentLowFps,
  1000 / uncappedLongTraceWorstMean,
);

assert.equal(
  calculateVisualPerformanceMetrics([Number.NaN, Number.POSITIVE_INFINITY, 0, -1]),
  null,
);
assert.deepEqual(calculateVisualPerformanceMetrics([20, Number.NaN]), {
  medianFps: 50,
  onePercentLowFps: 50,
  meanFps: 50,
  p99FrameMs: 20,
  maxFrameMs: 20,
  framesOver25Ms: 0,
  framesOver50Ms: 0,
});

const fakeGpuDevice = new FakeGpuDevice();
const fakeGpuProfiler = createVisualGpuTimestampProfiler(
  {
    adapterEvidence: {
      source: 'webgpu-adapter-info',
      identityStatus: 'available',
      fallbackStatus: 'non-fallback',
      vendor: 'test',
      architecture: 'test',
      device: 'test',
      description: 'fake timestamp-query device',
      isFallbackAdapter: false,
      limitations: [],
    },
    kind: 'webgpu',
    maxAnisotropy: 16,
    renderer: {
      backend: {
        device: fakeGpuDevice,
      },
    },
  } as unknown as RendererBackend,
  {
    slotCount: 2,
    constants: {
      bufferUsage: {
        COPY_DST: 1,
        COPY_SRC: 2,
        MAP_READ: 4,
        QUERY_RESOLVE: 8,
      },
      mapModeRead: 1,
    },
  },
);
const fakeGpuHandle = fakeGpuProfiler.beginFrame(1_234.5);
assert.equal(fakeGpuHandle.queryId, 1);
assert.equal(
  fakeGpuProfiler.getFrameTiming(1_234.5).status,
  'pending',
  'the causally identified frame must remain pending until GPU readback resolves',
);
fakeGpuDevice.timestampNanoseconds = 5_250_000n;
fakeGpuProfiler.endFrame(fakeGpuHandle);
await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert.deepEqual(fakeGpuProfiler.getFrameTiming(1_234.5), {
  frameRafTimestampMs: 1_234.5,
  queryId: 1,
  status: 'available',
  durationMs: 4.25,
  limitation: null,
});
assert.equal(
  fakeGpuDevice.submissions,
  2,
  'timestamp markers must remain enabled by default, with one submission before and one after Three',
);
assert.deepEqual(fakeGpuProfiler.getEvidence(), {
  requested: true,
  status: 'available',
  source: 'webgpu-timestamp-query',
  feature: 'timestamp-query',
  api: 'compute-pass-timestamp-writes',
  span: 'full-post-processing-queue-bookends',
  unit: 'milliseconds',
  slotCount: 2,
  attemptedFrames: 1,
  submittedFrames: 1,
  resolvedFrames: 1,
  pendingFrames: 0,
  droppedFrames: 0,
  failedFrames: 0,
  limitations: [
    'Measures elapsed device-timeline time between queue-ordered markers submitted immediately before and after the full post-processing render; it includes any queue-idle gaps or intervening GPU work inside that bracket and excludes display presentation latency.',
    'The two empty compute-pass marker submissions are profile-only measurement overhead.',
    'The existing CPU render-submission subspan includes the profile-only beginning marker; ending-marker encoding, submission, and asynchronous readback initiation are part of the existing post-render CPU subspan.',
  ],
});
const defaultRenderPathGpuDevice = new FakeGpuDevice();
const defaultRenderPathGpuProfiler = createVisualGpuTimestampProfiler(
  {
    kind: 'webgpu',
    renderer: {
      backend: {
        device: defaultRenderPathGpuDevice,
      },
    },
  } as unknown as RendererBackend,
  {
    slotCount: 2,
    constants: {
      bufferUsage: {
        COPY_DST: 1,
        COPY_SRC: 2,
        MAP_READ: 4,
        QUERY_RESOLVE: 8,
      },
      mapModeRead: 1,
    },
  },
);
let defaultPostProcessorRenderCalls = 0;
const defaultRenderPathResult = executeVisualProfileRenderPath({
  dt: 1 / 60,
  frameRafTimestampMs: 2_000,
  skipPostProcessorRender: false,
  postProcessorRender: () => {
    defaultPostProcessorRenderCalls += 1;
    defaultRenderPathGpuDevice.timestampNanoseconds = 3_500_000n;
  },
  gpuTimestampProfiler: defaultRenderPathGpuProfiler,
  now: () => 2_004.25,
});
assert.deepEqual(defaultRenderPathResult, {
  postProcessorRendered: true,
  renderPathCompletedAtMs: 2_004.25,
});
assert.equal(
  defaultPostProcessorRenderCalls,
  1,
  'default profiling must still call postProcessor.render exactly once',
);
assert.equal(
  defaultRenderPathGpuDevice.submissions,
  2,
  'default marker-on profiling must retain both queue submissions',
);

const noRenderPathGpuDevice = new FakeGpuDevice();
const noRenderPathGpuProfiler = createVisualGpuTimestampProfiler(
  {
    kind: 'webgpu',
    renderer: {
      backend: {
        device: noRenderPathGpuDevice,
      },
    },
  } as unknown as RendererBackend,
  {
    slotCount: 2,
    constants: {
      bufferUsage: {
        COPY_DST: 1,
        COPY_SRC: 2,
        MAP_READ: 4,
        QUERY_RESOLVE: 8,
      },
      mapModeRead: 1,
    },
  },
);
let noRenderPostProcessorRenderCalls = 0;
const noRenderPathResult = executeVisualProfileRenderPath({
  dt: 1 / 60,
  frameRafTimestampMs: 3_000,
  skipPostProcessorRender: true,
  postProcessorRender: () => {
    noRenderPostProcessorRenderCalls += 1;
  },
  gpuTimestampProfiler: noRenderPathGpuProfiler,
  now: () => 3_000.125,
});
assert.deepEqual(noRenderPathResult, {
  postProcessorRendered: false,
  renderPathCompletedAtMs: 3_000.125,
});
assert.equal(
  noRenderPostProcessorRenderCalls,
  0,
  'the no-render profiled path must not call postProcessor.render',
);
assert.equal(
  noRenderPathGpuDevice.submissions,
  0,
  'the no-render profiled path must not submit either GPU marker',
);

const noRenderGpuProfiler = createUnavailableVisualGpuTimestampProfiler(
  VISUAL_GPU_NO_RENDER_CONTROL_LIMITATION,
);
const noRenderGpuHandle = noRenderGpuProfiler.beginFrame(3_000);
noRenderGpuProfiler.endFrame(noRenderGpuHandle);
assert.deepEqual(noRenderGpuProfiler.getFrameTiming(3_000), {
  frameRafTimestampMs: 3_000,
  queryId: null,
  status: 'unavailable',
  durationMs: null,
  limitation: VISUAL_GPU_NO_RENDER_CONTROL_LIMITATION,
});
assert.deepEqual(noRenderGpuProfiler.getEvidence(), {
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
  limitations: [VISUAL_GPU_NO_RENDER_CONTROL_LIMITATION],
});
const markerOffGpuDevice = new FakeGpuDevice();
const markerOffGpuProfiler = createVisualGpuTimestampProfiler(
  {
    kind: 'webgpu',
    renderer: {
      backend: {
        device: markerOffGpuDevice,
      },
    },
  } as unknown as RendererBackend,
  {
    submitTimestampMarkers: false,
  },
);
const markerOffGpuHandle = markerOffGpuProfiler.beginFrame(1_234.5);
markerOffGpuProfiler.endFrame(markerOffGpuHandle);
assert.equal(
  markerOffGpuDevice.submissions,
  0,
  'the marker-off control must submit neither profile-only timestamp marker',
);
assert.deepEqual(markerOffGpuProfiler.getFrameTiming(1_234.5), {
  frameRafTimestampMs: 1_234.5,
  queryId: null,
  status: 'unavailable',
  durationMs: null,
  limitation: VISUAL_GPU_TIMESTAMP_MARKERS_DISABLED_LIMITATION,
});
assert.deepEqual(markerOffGpuProfiler.getEvidence(), {
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
  limitations: [VISUAL_GPU_TIMESTAMP_MARKERS_DISABLED_LIMITATION],
});
const unavailableGpuProfiler = createVisualGpuTimestampProfiler(
  {
    kind: 'webgl2-node',
  } as unknown as RendererBackend,
);
assert.equal(unavailableGpuProfiler.getEvidence().status, 'unavailable');
assert.deepEqual(unavailableGpuProfiler.getFrameTiming(9), {
  frameRafTimestampMs: 9,
  queryId: null,
  status: 'unavailable',
  durationMs: null,
  limitation: 'Selected renderer backend "webgl2-node" is not WebGPU.',
});
const featureMissingGpuProfiler = createVisualGpuTimestampProfiler(
  {
    kind: 'webgpu',
    renderer: {
      backend: {
        device: {
          features: {
            has: () => false,
          },
        },
      },
    },
  } as unknown as RendererBackend,
);
assert.deepEqual(featureMissingGpuProfiler.getEvidence().limitations, [
  'The selected GPUDevice did not enable the WebGPU timestamp-query feature.',
]);

const selectedDevice = { label: 'selected adapter device' };
let adapterRequests = 0;
let adapterOptions: unknown = null;
let deviceDescriptor: unknown = null;
const nativeAcquisition = await acquireWebGPUAdapterDevice({
  requestAdapter: async (options) => {
    adapterRequests += 1;
    adapterOptions = options;
    return {
      info: {
        vendor: '0x10de',
        architecture: 'ada',
        device: '0x2684',
        description: 'Discrete test adapter',
        isFallbackAdapter: false,
      },
      features: {
        forEach: (visit) => {
          visit('texture-compression-bc');
          visit('timestamp-query');
        },
      },
      requestDevice: async (descriptor) => {
        deviceDescriptor = descriptor;
        return selectedDevice;
      },
    };
  },
});
assert.ok(nativeAcquisition);
assert.equal(adapterRequests, 1, 'the adapter used for evidence must only be requested once');
assert.deepEqual(adapterOptions, {
  powerPreference: 'high-performance',
  featureLevel: 'compatibility',
  xrCompatible: false,
});
assert.strictEqual(
  nativeAcquisition.device,
  selectedDevice,
  'the device passed to Three must come from the evidenced adapter',
);
assert.deepEqual(deviceDescriptor, {
  requiredFeatures: ['texture-compression-bc', 'timestamp-query'],
  requiredLimits: {},
});
const nativeAdapter = nativeAcquisition.adapterEvidence;
assert.deepEqual(nativeAdapter, {
  source: 'webgpu-adapter-info',
  identityStatus: 'available',
  fallbackStatus: 'non-fallback',
  vendor: '0x10de',
  architecture: 'ada',
  device: '0x2684',
  description: 'Discrete test adapter',
  isFallbackAdapter: false,
  limitations: [],
});

const fallbackAcquisition = await acquireWebGPUAdapterDevice({
  requestAdapter: async () => ({
    info: {
      vendor: 'Google',
      architecture: '',
      device: '',
      description: 'SwiftShader Device (Subzero)',
      isFallbackAdapter: true,
    },
    requestDevice: async () => ({}),
  }),
});
assert.ok(fallbackAcquisition);
const fallbackAdapter = fallbackAcquisition.adapterEvidence;
assert.equal(fallbackAdapter.identityStatus, 'available');
assert.equal(fallbackAdapter.fallbackStatus, 'fallback');
assert.equal(fallbackAdapter.isFallbackAdapter, true);

const missingFallbackAcquisition = await acquireWebGPUAdapterDevice({
  requestAdapter: async () => ({
    info: {
      vendor: '0x8086',
      architecture: 'xe',
      device: '0x1234',
      description: 'Identity without fallback evidence',
    },
    requestDevice: async () => ({}),
  }),
});
assert.ok(missingFallbackAcquisition);
assert.equal(missingFallbackAcquisition.adapterEvidence.identityStatus, 'available');
assert.equal(missingFallbackAcquisition.adapterEvidence.fallbackStatus, 'unavailable');
assert.equal(missingFallbackAcquisition.adapterEvidence.isFallbackAdapter, null);

const legacyFallbackAcquisition = await acquireWebGPUAdapterDevice({
  requestAdapter: async () => ({
    info: {
      vendor: 'Legacy Browser Vendor',
      architecture: 'legacy',
      device: 'legacy-device',
      description: 'Legacy fallback signal adapter',
    },
    isFallbackAdapter: false,
    requestDevice: async () => ({}),
  }),
});
assert.ok(legacyFallbackAcquisition);
assert.equal(legacyFallbackAcquisition.adapterEvidence.fallbackStatus, 'non-fallback');
assert.equal(legacyFallbackAcquisition.adapterEvidence.isFallbackAdapter, false);
assert.match(
  legacyFallbackAcquisition.adapterEvidence.limitations.join(' '),
  /legacy GPUAdapter\.isFallbackAdapter/,
);

const legacyOnlyFallbackAcquisition = await acquireWebGPUAdapterDevice({
  requestAdapter: async () => ({
    isFallbackAdapter: true,
    requestDevice: async () => ({}),
  }),
});
assert.ok(legacyOnlyFallbackAcquisition);
assert.equal(legacyOnlyFallbackAcquisition.adapterEvidence.identityStatus, 'unavailable');
assert.equal(legacyOnlyFallbackAcquisition.adapterEvidence.fallbackStatus, 'fallback');
assert.equal(legacyOnlyFallbackAcquisition.adapterEvidence.isFallbackAdapter, true);
assert.equal(legacyOnlyFallbackAcquisition.adapterEvidence.vendor, null);
assert.equal(legacyOnlyFallbackAcquisition.adapterEvidence.description, null);
assert.match(
  legacyOnlyFallbackAcquisition.adapterEvidence.limitations.join(' '),
  /identity is unavailable or redacted/,
);
assert.match(
  legacyOnlyFallbackAcquisition.adapterEvidence.limitations.join(' '),
  /legacy GPUAdapter\.isFallbackAdapter/,
);

const standardWinsAcquisition = await acquireWebGPUAdapterDevice({
  requestAdapter: async () => ({
    info: {
      vendor: 'Current Browser Vendor',
      description: 'Standard signal wins',
      isFallbackAdapter: false,
    },
    isFallbackAdapter: true,
    requestDevice: async () => ({}),
  }),
});
assert.ok(standardWinsAcquisition);
assert.equal(standardWinsAcquisition.adapterEvidence.fallbackStatus, 'non-fallback');
assert.deepEqual(standardWinsAcquisition.adapterEvidence.limitations, []);

const redactedAcquisition = await acquireWebGPUAdapterDevice({
  requestAdapter: async () => ({
    info: {
      vendor: '',
      architecture: '',
      device: '',
      description: '',
    },
    requestDevice: async () => ({}),
  }),
});
assert.ok(redactedAcquisition);
const redactedAdapter = redactedAcquisition.adapterEvidence;
assert.equal(redactedAdapter.identityStatus, 'unavailable');
assert.equal(redactedAdapter.fallbackStatus, 'unavailable');
assert.equal(redactedAdapter.isFallbackAdapter, null);
assert.equal(redactedAdapter.limitations.length, 2);

const noInfoAcquisition = await acquireWebGPUAdapterDevice({
  requestAdapter: async () => ({
    requestDevice: async () => ({}),
  }),
});
assert.ok(noInfoAcquisition);
assert.equal(noInfoAcquisition.adapterEvidence.source, 'unavailable');
assert.equal(noInfoAcquisition.adapterEvidence.identityStatus, 'unavailable');
assert.equal(noInfoAcquisition.adapterEvidence.fallbackStatus, 'unavailable');

const webGlAdapter = readWebGLAdapterEvidence({
  backend: {
    getContext: () => ({
      getExtension: () => ({
        UNMASKED_VENDOR_WEBGL: 'vendor-key',
        UNMASKED_RENDERER_WEBGL: 'renderer-key',
      }),
      getParameter: (key: unknown) => key === 'vendor-key'
        ? 'NVIDIA Corporation'
        : 'ANGLE (NVIDIA GeForce)',
    }),
  },
} as never);
assert.equal(webGlAdapter.identityStatus, 'available');
assert.equal(webGlAdapter.fallbackStatus, 'unavailable');
assert.equal(webGlAdapter.vendor, 'NVIDIA Corporation');
assert.equal(webGlAdapter.description, 'ANGLE (NVIDIA GeForce)');

const unavailableAcquisition = await acquireWebGPUAdapterDevice({
  requestAdapter: async () => null,
});
assert.equal(unavailableAcquisition, null);

let selectedDeviceSubmittedWorkWaits = 0;
const integratedDevice = {
  label: 'integrated selected device',
  queue: {
    onSubmittedWorkDone: async () => {
      selectedDeviceSubmittedWorkWaits += 1;
    },
  },
};
let activeRendererSubmittedWorkWaits = 0;
const activeRendererDevice = {
  label: 'active renderer device',
  queue: {
    onSubmittedWorkDone: async () => {
      activeRendererSubmittedWorkWaits += 1;
    },
  },
};
let activeRendererBackend: {
  isWebGPUBackend: true;
  device: unknown;
} | null = null;
let integratedAdapterRequests = 0;
let constructedRendererOptions: {
  device?: unknown;
  forceWebGL?: boolean;
} | null = null;
let constructedRenderer: unknown = null;
const integrationGpu = {
  requestAdapter: async () => {
    integratedAdapterRequests += 1;
    return {
      info: {
        vendor: '0x1002',
        architecture: 'rdna3',
        device: '0x744c',
        description: 'Integrated bridge adapter',
        isFallbackAdapter: false,
      },
      features: {
        forEach: (visit: (feature: string) => void) => {
          visit('texture-compression-bc');
        },
      },
      requestDevice: async () => integratedDevice,
    };
  },
};
const integratedBackend = await createPreferredRenderer({
  gpu: integrationGpu,
  createRenderer: (options) => {
    constructedRendererOptions = options;
    activeRendererBackend = {
      isWebGPUBackend: true,
      device: activeRendererDevice,
    };
    const renderer = {
      backend: activeRendererBackend,
      dispose: () => {},
      getMaxAnisotropy: () => 16,
      init: async () => {
        // Three requests its own adapter when no device is supplied. Model that
        // behavior so removing the production device bridge fails this test.
        if (options.device === undefined) {
          await integrationGpu.requestAdapter();
        }
        return renderer;
      },
      outputColorSpace: '',
      setClearColor: () => {},
      shadowMap: {
        enabled: false,
        type: 0,
      },
      toneMapping: 0,
      toneMappingExposure: 1,
    };
    constructedRenderer = renderer;
    return renderer as never;
  },
  waitForStartup: async (promise) => promise,
});
assert.equal(
  integratedAdapterRequests,
  1,
  'createPreferredRenderer must not let Three request a second adapter',
);
assert.strictEqual(
  constructedRendererOptions?.device,
  integratedDevice,
  'createPreferredRenderer must supply the exact acquired device to Three',
);
assert.equal(constructedRendererOptions?.forceWebGL, undefined);
assert.strictEqual(integratedBackend.renderer, constructedRenderer);
assert.equal(integratedBackend.kind, 'webgpu');
assert.equal(integratedBackend.adapterEvidence.source, 'webgpu-adapter-info');
assert.equal(integratedBackend.adapterEvidence.fallbackStatus, 'non-fallback');
await integratedBackend.waitForSubmittedWork();
assert.equal(
  activeRendererSubmittedWorkWaits,
  1,
  'native capture synchronization must wait on the active renderer device queue',
);
assert.equal(
  selectedDeviceSubmittedWorkWaits,
  0,
  'native capture synchronization must inspect the active backend instead of retaining a stale device reference',
);
assert.ok(activeRendererBackend);
activeRendererBackend.device = {};
await assert.rejects(
  integratedBackend.waitForSubmittedWork(),
  /Native WebGPU capture synchronization is unavailable on the active renderer device queue/,
  'native WebGPU capture must fail explicitly when queue synchronization is unavailable',
);

const subsystemNames = [
  'post',
  'sky',
  'shadows',
  'river',
  'riverSimulation',
  'riverRender',
  'precipitation',
  'selection',
  'preview',
  'terrain',
  'groundcover',
  'forest',
  'ui',
] as const satisfies readonly ProfileSubsystem[];
const subsystems = Object.fromEntries(
  subsystemNames.map((name) => [name, name !== 'riverSimulation']),
) as Record<ProfileSubsystem, boolean>;

const enabledBaseline = Object.fromEntries(
  subsystemNames.map((name) => [name, true]),
) as Record<ProfileSubsystem, boolean>;
let schedulerNow = 1_000;
let runtimeReport: { status: 'ready' } | null = { status: 'ready' };
let runtimeStatus = 'ready';
let startedTraces = 0;
const lifecycleStatuses: string[] = [];
const resettleGate = createVisualPerformanceResettleGate(
  () => schedulerNow,
  (status) => {
    runtimeReport = null;
    runtimeStatus = status;
    lifecycleStatuses.push(status);
  },
);
resetVisualPerformanceSubsystems(
  (subsystem, enabled) => {
    enabledBaseline[subsystem] = enabled;
  },
  resettleGate.invalidate,
);
assert.equal(
  Object.values(enabledBaseline).every(Boolean),
  true,
  'reset starts from and retains an already-enabled full baseline',
);
assert.equal(runtimeReport, null, 'reset must clear an existing ready report');
assert.equal(runtimeStatus, 'settling');
assert.deepEqual(lifecycleStatuses, ['settling']);

const runScheduledFrame = (): void => {
  if (resettleGate.allowFrame(schedulerNow)) startedTraces += 1;
};
schedulerNow = 5_999;
runScheduledFrame();
assert.equal(startedTraces, 0, 'reset must block a new trace before five seconds');
assert.equal(runtimeStatus, 'settling');
schedulerNow = 6_000;
runScheduledFrame();
assert.equal(startedTraces, 1, 'reset may start a fresh trace after five seconds');
assert.equal(runtimeStatus, 'collecting');
assert.deepEqual(lifecycleStatuses, ['settling', 'collecting']);

const startupBaseline = Object.fromEntries(
  subsystemNames.map((name) => [name, true]),
) as Record<ProfileSubsystem, boolean>;
let startupNow = 10_000;
let startupReport: { status: 'ready' } | null = { status: 'ready' };
let startupStatus = 'waiting-vegetation';
let startupTraceStarts = 0;
const startupGate = createVisualPerformanceResettleGate(
  () => startupNow,
  (status) => {
    startupReport = null;
    startupStatus = status;
  },
);
const startupResetCoordinator = createVisualPerformanceResetCoordinator(
  () => startupNow,
  () => {
    startupReport = null;
    startupStatus = 'settling';
  },
);
resetVisualPerformanceSubsystems(
  (subsystem, enabled) => {
    startupBaseline[subsystem] = enabled;
  },
  startupResetCoordinator.requestReset,
);
assert.equal(
  startupReport,
  null,
  'reset before deferred readiness must clear the exposed report immediately',
);
assert.equal(startupStatus, 'settling');

startupNow = 11_000;
startupResetCoordinator.attach(startupGate.settleThrough);
const runStartupFrame = (): void => {
  if (startupGate.allowFrame(startupNow)) startupTraceStarts += 1;
};
startupNow = 14_999;
runStartupFrame();
assert.equal(
  startupTraceStarts,
  0,
  'a collector attached later must preserve the original reset deadline',
);
assert.equal(startupStatus, 'settling');
startupNow = 15_000;
runStartupFrame();
assert.equal(
  startupTraceStarts,
  1,
  'startup collection may begin exactly five seconds after the queued reset',
);
assert.equal(startupStatus, 'collecting');

assert.deepEqual(VISUAL_FRAME_CPU_SPAN, {
  durationField: 'precedingFrameCpuDurationMs',
  frameTimestampField: 'precedingFrameRafTimestampMs',
  callbackEntryTimestampField:
    'precedingFrameCallbackEntryTimestampMs',
  entryLatenessField: 'precedingFrameEntryLatenessMs',
  intervalStartTimestampField: 'intervalStartRafTimestampMs',
  intervalEndTimestampField: 'intervalEndRafTimestampMs',
  alignment: 'preceding-frame-callback-at-interval-start',
  start: 'animation-frame-callback-entry',
  end: 'animation-frame-callback-completion',
  callbackEntryTimestamp:
    'performance-now-sampled-at-animation-frame-callback-entry',
  entryLateness:
    'callback-entry-performance-now-minus-animation-frame-callback-timestamp',
  entryLatenessNegativeToleranceMs: 0.101,
});
assert.deepEqual(VISUAL_FRAME_CPU_SUBSPANS, {
  alignment: 'same-preceding-frame-callback',
  updatePreRenderDurationField:
    'precedingFrameUpdatePreRenderDurationMs',
  renderSubmissionDurationField:
    'precedingFrameRenderSubmissionDurationMs',
  postRenderDurationField: 'precedingFramePostRenderDurationMs',
  updatePreRender:
    'animation-frame-callback-entry-to-immediately-before-render-call',
  renderSubmission:
    'immediately-before-render-call-to-post-processor-render-return',
  postRender:
    'post-processor-render-return-to-callback-completion-telemetry-evidence-dom',
});
assert.deepEqual(VISUAL_FRAME_GPU_SPAN, {
  durationField: 'precedingFrameGpuDurationMs',
  statusField: 'precedingFrameGpuTimingStatus',
  queryIdField: 'precedingFrameGpuQueryId',
  frameTimestampField: 'precedingFrameGpuRafTimestampMs',
  intervalStartTimestampField: 'intervalStartRafTimestampMs',
  intervalEndTimestampField: 'intervalEndRafTimestampMs',
  alignment:
    'preceding-frame-full-post-processing-render-at-interval-start',
  source: 'webgpu-timestamp-query',
  unit: 'milliseconds',
  start:
    'gpu-queue-timestamp-after-profile-marker-submitted-immediately-before-post-processor-render',
  end:
    'gpu-queue-timestamp-before-profile-marker-submitted-immediately-after-post-processor-render-return',
});
const precedingFrameContext = {
  frameRafTimestampMs: 8_216.5,
  frameCallbackEntryTimestampMs: 8_217.25,
  frameCpuDurationMs: 7.75,
  frameUpdatePreRenderDurationMs: 2.25,
  frameRenderSubmissionDurationMs: 3,
  framePostRenderDurationMs: 2.5,
  frameGpuTiming: {
    frameRafTimestampMs: 8_216.5,
    queryId: 42,
    status: 'pending' as const,
    durationMs: null,
    limitation: null,
  },
  renderer: {
    drawCalls: 157,
    frameCalls: 15,
    triangles: 3_345_221,
  },
  routeElapsedMs: 7_250,
  routeCycle: 0,
  phase: 'settlement',
  forest: {
    selectionChanged: true,
    selectorSkipped: false,
    workChunks: 2,
    matrixWrites: 4_096,
    bucketUploads: 1,
    pendingBuckets: 3,
  },
  groundcoverDelta: {
    generationSubsteps: 1,
    clearWriteSubsteps: 1,
    refreshes: 1,
    gpuFlagUpdates: 4,
    gpuUpdateRanges: 4,
    bytesUploaded: 12_800,
    completedSlots: 1,
    cancelledSlots: 0,
    pendingSlots: 2,
  },
};
const routeResetBoundary = createVisualPerformanceTraceArmingBoundary();
routeResetBoundary.armAfterCurrentFrame();
routeResetBoundary.reset();
assert.equal(
  routeResetBoundary.consumeCompletedFrame(),
  false,
  'a collector reset must clear a stale route-boundary exclusion',
);
routeResetBoundary.armAfterCurrentFrame();
const routeBoundaryCapture = createVisualPerformanceTraceCapture(30_000);
type RouteBoundaryFrame = {
  rafTimestampMs: number;
  renderer: VisualSlowFrameRecord['renderer'];
  context: VisualSlowFrameContext;
};
const routeBoundaryFrames: RouteBoundaryFrame[] = [
  {
    rafTimestampMs: 10_000,
    renderer: {
      drawCalls: 232,
      frameCalls: 5,
      triangles: 5_197_146,
    },
    context: {
      ...precedingFrameContext,
      frameRafTimestampMs: 10_000,
      frameCallbackEntryTimestampMs: 10_003,
      frameCpuDurationMs: 77.7,
      frameUpdatePreRenderDurationMs: 6.5,
      frameRenderSubmissionDurationMs: 71,
      framePostRenderDurationMs: 0.2,
      frameGpuTiming: {
        frameRafTimestampMs: 10_000,
        queryId: 501,
        status: 'available',
        durationMs: 64.094_208,
        limitation: null,
      },
      routeElapsedMs: 0,
      phase: 'strategic',
    },
  },
  {
    rafTimestampMs: 10_078.9,
    renderer: {
      drawCalls: 145,
      frameCalls: 3,
      triangles: 3_371_365,
    },
    context: {
      ...precedingFrameContext,
      frameRafTimestampMs: 10_078.9,
      frameCallbackEntryTimestampMs: 10_079.4,
      frameCpuDurationMs: 5,
      frameUpdatePreRenderDurationMs: 0.2,
      frameRenderSubmissionDurationMs: 4.5,
      framePostRenderDurationMs: 0.3,
      frameGpuTiming: {
        frameRafTimestampMs: 10_078.9,
        queryId: 502,
        status: 'available',
        durationMs: 4.1,
        limitation: null,
      },
      routeElapsedMs: 12.2,
      phase: 'strategic',
    },
  },
  {
    rafTimestampMs: 10_091.1,
    renderer: {
      drawCalls: 146,
      frameCalls: 3,
      triangles: 3_371_365,
    },
    context: {
      ...precedingFrameContext,
      frameRafTimestampMs: 10_091.1,
      frameCallbackEntryTimestampMs: 10_091.6,
      frameCpuDurationMs: 5.1,
      frameUpdatePreRenderDurationMs: 0.2,
      frameRenderSubmissionDurationMs: 4.6,
      framePostRenderDurationMs: 0.3,
      frameGpuTiming: {
        frameRafTimestampMs: 10_091.1,
        queryId: 503,
        status: 'available',
        durationMs: 4.2,
        limitation: null,
      },
      routeElapsedMs: 24.4,
      phase: 'strategic',
    },
  },
];
let routeBoundaryTraceStart = 0;
let routeBoundaryPreviousFrame: RouteBoundaryFrame | null = null;
for (const frame of routeBoundaryFrames) {
  if (routeResetBoundary.consumeCompletedFrame()) {
    routeBoundaryTraceStart = 0;
    routeBoundaryPreviousFrame = null;
    continue;
  }
  if (routeBoundaryTraceStart === 0) {
    routeBoundaryTraceStart = frame.rafTimestampMs;
    routeBoundaryPreviousFrame = frame;
    continue;
  }
  assert.ok(routeBoundaryPreviousFrame);
  const slowFrame = createVisualSlowFrameRecordForInterval({
    intervalStartRafTimestampMs: routeBoundaryPreviousFrame.rafTimestampMs,
    intervalEndRafTimestampMs: frame.rafTimestampMs,
    traceStartRafTimestampMs: routeBoundaryTraceStart,
    precedingFrame: {
      ...routeBoundaryPreviousFrame.context,
      renderer: routeBoundaryPreviousFrame.renderer,
    },
  });
  assert.ok(slowFrame);
  routeBoundaryCapture.appendInterval(
    {
      at: frame.rafTimestampMs,
      dt: frame.rafTimestampMs - routeBoundaryPreviousFrame.rafTimestampMs,
      ...routeBoundaryPreviousFrame.renderer,
    },
    slowFrame,
  );
  routeBoundaryPreviousFrame = frame;
}
const routeBoundarySamples = routeBoundaryCapture.getSamples();
const routeBoundaryFrameTimes = routeBoundarySamples.map((sample) => sample.dt);
const routeBoundaryDetails = selectVisualWorstFrameRecords(
  routeBoundaryCapture.getSlowFrames(),
  routeBoundaryFrameTimes.length,
);
const routeBoundaryMetrics =
  calculateVisualPerformanceMetrics(routeBoundaryFrameTimes);
assert.ok(routeBoundaryMetrics);
assert.equal(routeBoundarySamples.length, 1);
assert.deepEqual(
  routeBoundarySamples.map(({ drawCalls, frameCalls, triangles }) => ({
    drawCalls,
    frameCalls,
    triangles,
  })),
  [{ drawCalls: 145, frameCalls: 3, triangles: 3_371_365 }],
  'the first ordinary post-reset callback must be eligible for the metric cohort',
);
assert.deepEqual(
  routeBoundaryDetails.map((record) => ({
    routeElapsedMs: record.routeElapsedMs,
    drawCalls: record.renderer.drawCalls,
    frameCalls: record.renderer.frameCalls,
    triangles: record.renderer.triangles,
  })),
  [{
    routeElapsedMs: 12.2,
    drawCalls: 145,
    frameCalls: 3,
    triangles: 3_371_365,
  }],
  'the duplicated route-zero reset callback must not enter the detail cohort',
);
assert.equal(
  routeBoundaryFrameTimes.some((dtMs) => Math.abs(dtMs - 78.9) < 1e-9),
  false,
  'the route-reset interval must not enter metric arithmetic',
);
assert.equal(routeBoundaryMetrics.maxFrameMs, routeBoundaryFrameTimes[0]);
assert.equal(routeBoundaryMetrics.p99FrameMs, routeBoundaryFrameTimes[0]);
assert.equal(
  doVisualSlowFrameRecordsReproduceMetrics(
    routeBoundaryDetails,
    routeBoundaryFrameTimes,
    routeBoundaryMetrics,
  ),
  true,
  'post-boundary sample and slow-record arithmetic must retain exact witness identity',
);
assert.equal(
  routeResetBoundary.consumeCompletedFrame(),
  false,
  'the route boundary must exclude exactly one completed callback',
);
assert.equal(
  createVisualSlowFrameRecordForInterval({
    intervalStartRafTimestampMs: 8_216.5,
    intervalEndRafTimestampMs: 8_250,
    traceStartRafTimestampMs: 0,
    precedingFrame: null,
  }),
  null,
  'the first retained callback must prime attribution without inventing an interval',
);
assert.equal(
  createVisualSlowFrameRecordForInterval({
    intervalStartRafTimestampMs: 8_216.5,
    intervalEndRafTimestampMs: 8_250,
    traceStartRafTimestampMs: 0,
    precedingFrame: {
      ...precedingFrameContext,
      frameRafTimestampMs: 8_250,
    },
  }),
  null,
  'current callback CPU must not be attached to the interval that ends at its entry',
);
const slowFrameTemplate = createVisualSlowFrameRecordForInterval({
  intervalStartRafTimestampMs: 8_216.5,
  intervalEndRafTimestampMs: 8_250,
  traceStartRafTimestampMs: 0,
  precedingFrame: precedingFrameContext,
});
assert.ok(slowFrameTemplate);
assert.equal(slowFrameTemplate.dtMs, 33.5);
assert.equal(slowFrameTemplate.intervalStartRafTimestampMs, 8_216.5);
assert.equal(slowFrameTemplate.intervalEndRafTimestampMs, 8_250);
assert.equal(slowFrameTemplate.precedingFrameRafTimestampMs, 8_216.5);
assert.equal(
  slowFrameTemplate.precedingFrameCallbackEntryTimestampMs,
  8_217.25,
);
assert.equal(slowFrameTemplate.precedingFrameEntryLatenessMs, 0.75);
assert.equal(slowFrameTemplate.precedingFrameCpuDurationMs, 7.75);
assert.equal(slowFrameTemplate.precedingFrameUpdatePreRenderDurationMs, 2.25);
assert.equal(slowFrameTemplate.precedingFrameRenderSubmissionDurationMs, 3);
assert.equal(slowFrameTemplate.precedingFramePostRenderDurationMs, 2.5);
assert.equal(slowFrameTemplate.precedingFrameGpuRafTimestampMs, 8_216.5);
assert.equal(slowFrameTemplate.precedingFrameGpuQueryId, 42);
assert.equal(slowFrameTemplate.precedingFrameGpuDurationMs, null);
assert.equal(slowFrameTemplate.precedingFrameGpuTimingStatus, 'pending');
assert.equal(slowFrameTemplate.precedingFrameGpuTimingLimitation, null);
assert.equal(
  slowFrameTemplate.precedingFrameUpdatePreRenderDurationMs
    + slowFrameTemplate.precedingFrameRenderSubmissionDurationMs
    + slowFrameTemplate.precedingFramePostRenderDurationMs,
  slowFrameTemplate.precedingFrameCpuDurationMs,
  'schema-3 subspans must partition the existing preceding callback CPU span',
);
assert.equal('cpuDurationMs' in slowFrameTemplate, false);
const markerOffSlowFrame = createVisualSlowFrameRecordForInterval({
  intervalStartRafTimestampMs: 8_216.5,
  intervalEndRafTimestampMs: 8_250,
  traceStartRafTimestampMs: 0,
  precedingFrame: {
    ...precedingFrameContext,
    frameGpuTiming: markerOffGpuProfiler.getFrameTiming(8_216.5),
  },
});
assert.ok(markerOffSlowFrame);
assert.deepEqual(
  {
    callbackEntryTimestampMs:
      markerOffSlowFrame.precedingFrameCallbackEntryTimestampMs,
    entryLatenessMs: markerOffSlowFrame.precedingFrameEntryLatenessMs,
    cpuDurationMs: markerOffSlowFrame.precedingFrameCpuDurationMs,
    updatePreRenderDurationMs:
      markerOffSlowFrame.precedingFrameUpdatePreRenderDurationMs,
    renderSubmissionDurationMs:
      markerOffSlowFrame.precedingFrameRenderSubmissionDurationMs,
    postRenderDurationMs:
      markerOffSlowFrame.precedingFramePostRenderDurationMs,
  },
  {
    callbackEntryTimestampMs:
      slowFrameTemplate.precedingFrameCallbackEntryTimestampMs,
    entryLatenessMs: slowFrameTemplate.precedingFrameEntryLatenessMs,
    cpuDurationMs: slowFrameTemplate.precedingFrameCpuDurationMs,
    updatePreRenderDurationMs:
      slowFrameTemplate.precedingFrameUpdatePreRenderDurationMs,
    renderSubmissionDurationMs:
      slowFrameTemplate.precedingFrameRenderSubmissionDurationMs,
    postRenderDurationMs:
      slowFrameTemplate.precedingFramePostRenderDurationMs,
  },
  'marker-off must retain the schema-5 callback entry and all CPU subspans unchanged',
);
assert.equal(
  markerOffSlowFrame.precedingFrameGpuTimingStatus,
  'unavailable',
);
assert.equal(
  markerOffSlowFrame.precedingFrameGpuTimingLimitation,
  VISUAL_GPU_TIMESTAMP_MARKERS_DISABLED_LIMITATION,
);
assert.equal(
  areVisualSlowFrameGpuTimingsTerminal([markerOffSlowFrame]),
  true,
  'marker-off records must be terminal immediately rather than pending on nonexistent readback',
);
for (const invalidCallbackEntryTimestampMs of [
  Number.NaN,
  -1,
  8_216.3,
]) {
  assert.equal(
    createVisualSlowFrameRecordForInterval({
      intervalStartRafTimestampMs: 8_216.5,
      intervalEndRafTimestampMs: 8_250,
      traceStartRafTimestampMs: 0,
      precedingFrame: {
        ...precedingFrameContext,
        frameCallbackEntryTimestampMs: invalidCallbackEntryTimestampMs,
      },
    }),
    null,
    'non-finite, negative, or materially early callback entry clocks must be rejected',
  );
}
const toleratedClockRoundoff = createVisualSlowFrameRecordForInterval({
  intervalStartRafTimestampMs: 8_216.5,
  intervalEndRafTimestampMs: 8_250,
  traceStartRafTimestampMs: 0,
  precedingFrame: {
    ...precedingFrameContext,
    frameCallbackEntryTimestampMs: 8_216.4,
  },
});
assert.ok(toleratedClockRoundoff);
assert.equal(
  toleratedClockRoundoff.precedingFrameCallbackEntryTimestampMs,
  8_216.4,
  'the actual callback-entry performance.now sample must be serialized unchanged',
);
assert.equal(
  toleratedClockRoundoff.precedingFrameEntryLatenessMs,
  0,
  'a one-quantum negative callback-entry delta from a low-work forest-hidden frame may clamp to zero',
);
assert.equal(
  areVisualSlowFrameGpuTimingsTerminal([slowFrameTemplate]),
  false,
  'a schema-4 report must not become ready while retained GPU timing is pending',
);
const hydratedSlowFrame = hydrateVisualSlowFrameGpuTiming(
  slowFrameTemplate,
  {
    frameRafTimestampMs: 8_216.5,
    queryId: 42,
    status: 'available',
    durationMs: 11.375,
    limitation: null,
  },
);
assert.equal(hydratedSlowFrame.precedingFrameGpuDurationMs, 11.375);
assert.equal(hydratedSlowFrame.precedingFrameGpuTimingStatus, 'available');
assert.equal(
  areVisualSlowFrameGpuTimingsTerminal([hydratedSlowFrame]),
  true,
);
assert.deepEqual(
  hydrateVisualSlowFrameGpuTiming(slowFrameTemplate, {
    frameRafTimestampMs: 8_250,
    queryId: 42,
    status: 'available',
    durationMs: 99,
    limitation: null,
  }),
  slowFrameTemplate,
  'a mismatched frame identity must never receive another frame GPU duration',
);
assert.deepEqual(
  hydrateVisualSlowFrameGpuTiming(slowFrameTemplate, {
    frameRafTimestampMs: 8_216.5,
    queryId: 43,
    status: 'available',
    durationMs: 99,
    limitation: null,
  }),
  slowFrameTemplate,
  'a mismatched query identity must never receive another query result',
);
const invalidGpuDuration = hydrateVisualSlowFrameGpuTiming(
  slowFrameTemplate,
  {
    frameRafTimestampMs: 8_216.5,
    queryId: 42,
    status: 'available',
    durationMs: Number.NaN,
    limitation: null,
  },
);
assert.equal(invalidGpuDuration.precedingFrameGpuTimingStatus, 'failed');
assert.equal(invalidGpuDuration.precedingFrameGpuDurationMs, null);

const boundedSlowFrames: VisualSlowFrameRecord[] = [];
for (const [index, dtMs] of [18, 24.3, 17.2, 22, 19.13].entries()) {
  const intervalStartRafTimestampMs = index;
  const record = createVisualSlowFrameRecordForInterval({
    intervalStartRafTimestampMs,
    intervalEndRafTimestampMs: intervalStartRafTimestampMs + dtMs,
    traceStartRafTimestampMs: 0,
    precedingFrame: {
      ...precedingFrameContext,
      frameRafTimestampMs: intervalStartRafTimestampMs,
      frameCallbackEntryTimestampMs: intervalStartRafTimestampMs + 0.5,
      frameCpuDurationMs: index + 0.25,
      frameUpdatePreRenderDurationMs: index + 0.05,
      frameRenderSubmissionDurationMs: 0.1,
      framePostRenderDurationMs: 0.1,
      frameGpuTiming: {
        frameRafTimestampMs: intervalStartRafTimestampMs,
        queryId: 100 + index,
        status: 'available',
        durationMs: index + 0.5,
        limitation: null,
      },
    },
  });
  assert.ok(record);
  appendVisualSlowFrameRecord(boundedSlowFrames, record, 3);
}
assert.deepEqual(
  boundedSlowFrames.map((record) => record.dtMs),
  [24.3, 22, 19.13],
  'detailed attribution must retain the bounded worst frames below the old 25 ms cutoff',
);
assert.equal(shouldCaptureVisualSlowFrame(boundedSlowFrames, 19.12, 3), false);
assert.equal(shouldCaptureVisualSlowFrame(boundedSlowFrames, 19.13, 3), false);
assert.equal(shouldCaptureVisualSlowFrame(boundedSlowFrames, 19.14, 3), true);
const skippedDetailCapture = createVisualPerformanceTraceCapture(30_000);
assert.equal(
  skippedDetailCapture.appendInterval(
    { at: 1, dt: 19.12, drawCalls: 1, frameCalls: 1, triangles: 1 },
    null,
  ),
  true,
);
assert.equal(skippedDetailCapture.getSamples().length, 1);
assert.equal(
  skippedDetailCapture.getSlowFrames().length,
  0,
  'non-candidate intervals should enter the metric cohort without allocating detail records',
);
assert.deepEqual(
  boundedSlowFrames.map((record) => [
    record.dtMs,
    record.precedingFrameCpuDurationMs,
    record.precedingFrameUpdatePreRenderDurationMs,
    record.precedingFrameRenderSubmissionDurationMs,
    record.precedingFramePostRenderDurationMs,
    record.precedingFrameGpuDurationMs,
    record.precedingFrameGpuQueryId,
    record.precedingFrameCallbackEntryTimestampMs,
    record.precedingFrameEntryLatenessMs,
    record.precedingFrameRafTimestampMs,
    record.intervalStartRafTimestampMs,
  ]),
  [
    [24.3, 1.25, 1.05, 0.1, 0.1, 1.5, 101, 1.5, 0.5, 1, 1],
    [22, 3.25, 3.05, 0.1, 0.1, 3.5, 103, 3.5, 0.5, 3, 3],
    [19.13, 4.25, 4.05, 0.1, 0.1, 4.5, 104, 4.5, 0.5, 4, 4],
  ],
  'callback entry, CPU/GPU timing, and interval identities must stay attached while sorting',
);
const worstOnePercentFrames = selectVisualWorstFrameRecords(
  boundedSlowFrames,
  200,
  3,
);
assert.deepEqual(
  worstOnePercentFrames.map((record) => record.dtMs),
  [24.3, 22],
  'a 200-frame report must emit the same two frames used by the one-percent-low metric',
);
const treatmentScaleCandidates: VisualSlowFrameRecord[] = [];
for (let index = 0; index < 80; index++) {
  const intervalStartRafTimestampMs = 20_000 + index * 100;
  const record = createVisualSlowFrameRecordForInterval({
    intervalStartRafTimestampMs,
    intervalEndRafTimestampMs: intervalStartRafTimestampMs + 10 + index,
    traceStartRafTimestampMs: 20_000,
    precedingFrame: {
      ...precedingFrameContext,
      frameRafTimestampMs: intervalStartRafTimestampMs,
      frameCallbackEntryTimestampMs: intervalStartRafTimestampMs + 0.25,
      frameGpuTiming: {
        frameRafTimestampMs: intervalStartRafTimestampMs,
        queryId: 1_000 + index,
        status: 'available',
        durationMs: index * 0.1,
        limitation: null,
      },
    },
  });
  assert.ok(record);
  appendVisualSlowFrameRecord(treatmentScaleCandidates, record);
}
assert.equal(treatmentScaleCandidates.length, 64);
assert.equal(
  selectVisualWorstFrameRecords(treatmentScaleCandidates, 3_217).length,
  33,
  'the matched treatment sample count must expose all 33 worst-one-percent records',
);
assert.equal(
  selectVisualWorstFrameRecords(treatmentScaleCandidates, 10_000).length,
  64,
  'emitted detailed evidence must remain capped even at unusually high sample counts',
);
const cappedLongTraceEvidence = [...tenThousandFrameTimes]
  .sort((a, b) => b - a)
  .slice(0, 64)
  .map((dtMs, index) => ({
    ...treatmentScaleCandidates[index]!,
    dtMs,
  }));
assert.equal(
  doVisualSlowFrameRecordsReproduceMetrics(
    cappedLongTraceEvidence,
    tenThousandFrameTimes,
    boundedLongTraceMetrics,
  ),
  true,
  'above 6,400 samples the capped evidence must prove exact leading identity without redefining the uncapped metric',
);
assert.equal(
  doVisualSlowFrameRecordsReproduceMetrics(
    [
      {
        ...cappedLongTraceEvidence[0]!,
        dtMs: cappedLongTraceEvidence[0]!.dtMs + 0.001,
      },
      ...cappedLongTraceEvidence.slice(1),
    ],
    tenThousandFrameTimes,
    boundedLongTraceMetrics,
  ),
  false,
);

const reportGpuEvidence = fakeGpuProfiler.getEvidence();
const exactWindowCapture = createVisualPerformanceTraceCapture(30_000);
const exactWindowTraceStart = 50_000;
let exactWindowIntervalStart = exactWindowTraceStart;
let exactWindowIntervalIndex = 0;
while (!exactWindowCapture.isFrozen()) {
  const dtMs = exactWindowIntervalIndex === 117
    ? 30.3
    : exactWindowIntervalIndex === 311
      ? 24.1
      : 11.4 + (exactWindowIntervalIndex % 97) * 0.067;
  const intervalEndRafTimestampMs = exactWindowIntervalStart + dtMs;
  const queryId = 20_000 + exactWindowIntervalIndex;
  const record = createVisualSlowFrameRecordForInterval({
    intervalStartRafTimestampMs: exactWindowIntervalStart,
    intervalEndRafTimestampMs,
    traceStartRafTimestampMs: exactWindowTraceStart,
    precedingFrame: {
      ...precedingFrameContext,
      frameRafTimestampMs: exactWindowIntervalStart,
      frameCallbackEntryTimestampMs: exactWindowIntervalStart + 0.125,
      frameGpuTiming: {
        frameRafTimestampMs: exactWindowIntervalStart,
        queryId,
        status: 'pending',
        durationMs: null,
        limitation: null,
      },
    },
  });
  assert.ok(record);
  assert.equal(
    exactWindowCapture.appendInterval(
      {
        at: intervalEndRafTimestampMs,
        dt: intervalEndRafTimestampMs - exactWindowIntervalStart,
        drawCalls: 150 + exactWindowIntervalIndex % 3,
        frameCalls: 15,
        triangles: 3_345_221,
      },
      record,
    ),
    true,
  );
  exactWindowCapture.freezeIfComplete(
    exactWindowTraceStart,
    intervalEndRafTimestampMs,
  );
  exactWindowIntervalStart = intervalEndRafTimestampMs;
  exactWindowIntervalIndex += 1;
  assert.ok(
    exactWindowIntervalIndex < 5_000,
    'the deterministic trace must cross its 30-second boundary',
  );
}

const exactWindowSamples = exactWindowCapture.getSamples();
const exactWindowSlowFrames = exactWindowCapture.getSlowFrames();
assert.ok(exactWindowSamples.length > 2_000);
assert.ok(exactWindowSlowFrames.length <= 64);
assert.ok(
  exactWindowSamples.at(-2)!.at - exactWindowTraceStart < 30_000,
  'the penultimate interval must end before the exact trace expiry',
);
assert.ok(
  exactWindowSamples.at(-1)!.at - exactWindowTraceStart >= 30_000,
  'the first interval crossing the exact trace expiry must close the frozen prefix',
);
const exactWindowSnapshot = JSON.stringify({
  samples: exactWindowSamples,
  slowFrames: exactWindowSlowFrames,
});
const expiredIntervalStart = exactWindowSamples.at(-1)!.at;
const expiredRecord = createVisualSlowFrameRecordForInterval({
  intervalStartRafTimestampMs: expiredIntervalStart,
  intervalEndRafTimestampMs: expiredIntervalStart + 999,
  traceStartRafTimestampMs: exactWindowTraceStart,
  precedingFrame: {
    ...precedingFrameContext,
    frameRafTimestampMs: expiredIntervalStart,
    frameCallbackEntryTimestampMs: expiredIntervalStart + 0.125,
    frameGpuTiming: {
      frameRafTimestampMs: expiredIntervalStart,
      queryId: 99_999,
      status: 'available',
      durationMs: 999,
      limitation: null,
    },
  },
});
assert.ok(expiredRecord);
assert.equal(
  exactWindowCapture.appendInterval(
    {
      at: expiredIntervalStart + 999,
      dt: 999,
      drawCalls: 999,
      frameCalls: 999,
      triangles: 999,
    },
    expiredRecord,
  ),
  false,
  'post-expiry intervals must never enter the frozen metric or detail cohorts',
);
assert.equal(
  exactWindowCapture.freezeIfComplete(
    exactWindowTraceStart,
    expiredIntervalStart + 999,
  ),
  true,
);
assert.equal(
  JSON.stringify({
    samples: exactWindowCapture.getSamples(),
    slowFrames: exactWindowCapture.getSlowFrames(),
  }),
  exactWindowSnapshot,
  'both metric samples and detailed evidence must remain fixed after expiry',
);

const exactWindowFrameTimes = exactWindowSamples.map((sample) => sample.dt);
const exactWindowMetrics =
  calculateVisualPerformanceMetrics(exactWindowFrameTimes);
assert.ok(exactWindowMetrics);
const exactWindowWorstFrames = selectVisualWorstFrameRecords(
  exactWindowSlowFrames,
  exactWindowFrameTimes.length,
);
assert.equal(
  exactWindowWorstFrames.length,
  Math.min(64, Math.ceil(exactWindowFrameTimes.length * 0.01)),
);
assert.equal(
  doVisualSlowFrameRecordsReproduceMetrics(
    exactWindowWorstFrames,
    exactWindowFrameTimes,
    exactWindowMetrics,
  ),
  true,
  'the emitted records must be the exact bounded cohort that reproduces p99 and one-percent-low',
);
const exactWindowWorstMean =
  exactWindowWorstFrames.reduce((sum, record) => sum + record.dtMs, 0)
  / exactWindowWorstFrames.length;
assert.equal(exactWindowWorstMean, exactWindowMetrics.p99FrameMs);
assert.equal(
  1000 / exactWindowWorstMean,
  exactWindowMetrics.onePercentLowFps,
);
assert.equal(
  doVisualSlowFrameRecordsReproduceMetrics(
    [
      {
        ...exactWindowWorstFrames[0]!,
        dtMs: exactWindowWorstFrames[0]!.dtMs + 0.001,
      },
      ...exactWindowWorstFrames.slice(1),
    ],
    exactWindowFrameTimes,
    exactWindowMetrics,
  ),
  false,
  'a stale or substituted detail record must fail the publication invariant',
);

const partiallyHydratedWorstFrames = exactWindowWorstFrames.map(
  (record, index) =>
    index === 0
      ? hydrateVisualSlowFrameGpuTiming(record, {
          frameRafTimestampMs: record.precedingFrameGpuRafTimestampMs,
          queryId: record.precedingFrameGpuQueryId,
          status: 'available',
          durationMs: 4.5,
          limitation: null,
        })
      : record,
);
assert.equal(
  areVisualSlowFrameGpuTimingsTerminal(partiallyHydratedWorstFrames),
  false,
  'a frozen trace must remain collecting while any selected GPU query is pending',
);
const terminalWorstFrames = partiallyHydratedWorstFrames.map((record, index) =>
  record.precedingFrameGpuTimingStatus === 'pending'
    ? hydrateVisualSlowFrameGpuTiming(record, {
        frameRafTimestampMs: record.precedingFrameGpuRafTimestampMs,
        queryId: record.precedingFrameGpuQueryId,
        status: 'available',
        durationMs: 4.75 + index * 0.01,
        limitation: null,
      })
    : record
);
assert.equal(areVisualSlowFrameGpuTimingsTerminal(terminalWorstFrames), true);
assert.equal(
  doVisualSlowFrameRecordsReproduceMetrics(
    terminalWorstFrames,
    exactWindowFrameTimes,
    exactWindowMetrics,
  ),
  true,
  'asynchronous GPU hydration must not alter the frozen CPU interval cohort',
);
const markerOffWorstFrames: VisualSlowFrameRecord[] =
  exactWindowWorstFrames.map((record) => ({
    ...record,
    precedingFrameGpuQueryId: null,
    precedingFrameGpuDurationMs: null,
    precedingFrameGpuTimingStatus: 'unavailable',
    precedingFrameGpuTimingLimitation:
      VISUAL_GPU_TIMESTAMP_MARKERS_DISABLED_LIMITATION,
  }));
assert.equal(
  areVisualSlowFrameGpuTimingsTerminal(markerOffWorstFrames),
  true,
  'the exact marker-off witness cohort must never wait on GPU readback',
);
assert.equal(
  doVisualSlowFrameRecordsReproduceMetrics(
    markerOffWorstFrames,
    exactWindowFrameTimes,
    exactWindowMetrics,
  ),
  true,
  'marker-off GPU status must not alter the immutable worst-one-percent cohort',
);
const noRenderWorstFrames: VisualSlowFrameRecord[] =
  exactWindowWorstFrames.map((record) => ({
    ...record,
    precedingFrameGpuQueryId: null,
    precedingFrameGpuDurationMs: null,
    precedingFrameGpuTimingStatus: 'unavailable',
    precedingFrameGpuTimingLimitation:
      VISUAL_GPU_NO_RENDER_CONTROL_LIMITATION,
  }));
assert.equal(
  areVisualSlowFrameGpuTimingsTerminal(noRenderWorstFrames),
  true,
  'the exact no-render witness cohort must be terminal without GPU readback',
);
assert.equal(
  doVisualSlowFrameRecordsReproduceMetrics(
    noRenderWorstFrames,
    exactWindowFrameTimes,
    exactWindowMetrics,
  ),
  true,
  'no-render GPU unavailability must not change the exact schema-5 CPU interval cohort',
);

const createExactWindowReport = (
  status: 'collecting' | 'ready',
  slowFrames: VisualSlowFrameRecord[],
  meanFps = exactWindowMetrics.meanFps,
  gpuTiming = reportGpuEvidence,
) => createVisualPerformanceReport({
  status,
  elapsedSeconds: 30,
  sampleCount: exactWindowFrameTimes.length,
  metrics: {
    ...exactWindowMetrics,
    meanFps,
  },
  renderer: {
    medianDrawCalls: 151,
    medianFrameCalls: 15,
    medianTriangles: 3_345_221,
  },
  slowFrames,
  context: {
    backend: 'webgpu',
    viewport: {
      width: 1280,
      height: 720,
    },
    devicePixelRatio: 2,
    rendererPixelRatio: 1,
    visibility: 'visible',
    adapter: nativeAdapter,
    gpuTiming,
    subsystems,
  },
});
const markerOffReportStatus = exactWindowCapture.isFrozen()
  && areVisualSlowFrameGpuTimingsTerminal(markerOffWorstFrames)
  ? 'ready'
  : 'collecting';
assert.equal(markerOffReportStatus, 'ready');
const markerOffReadyReport = createExactWindowReport(
  markerOffReportStatus,
  markerOffWorstFrames,
  exactWindowMetrics.meanFps,
  markerOffGpuProfiler.getEvidence(),
);
assert.equal(markerOffReadyReport.schemaVersion, 5);
assert.equal(markerOffReadyReport.windowSeconds, 30);
assert.equal(markerOffReadyReport.status, 'ready');
assert.equal(markerOffReadyReport.context.gpuTiming.status, 'unavailable');
assert.ok(
  markerOffReadyReport.slowFrames.every(
    (record) => record.precedingFrameGpuTimingStatus === 'unavailable',
  ),
  'a ready marker-off report must serialize terminal unavailable records',
);
const noRenderReportStatus = exactWindowCapture.isFrozen()
  && areVisualSlowFrameGpuTimingsTerminal(noRenderWorstFrames)
  ? 'ready'
  : 'collecting';
assert.equal(noRenderReportStatus, 'ready');
const noRenderReadyReport = createExactWindowReport(
  noRenderReportStatus,
  noRenderWorstFrames,
  exactWindowMetrics.meanFps,
  noRenderGpuProfiler.getEvidence(),
);
assert.equal(noRenderReadyReport.schemaVersion, 5);
assert.equal(noRenderReadyReport.windowSeconds, 30);
assert.equal(noRenderReadyReport.status, 'ready');
assert.equal(noRenderReadyReport.context.gpuTiming.status, 'unavailable');
assert.deepEqual(noRenderReadyReport.context.gpuTiming.limitations, [
  VISUAL_GPU_NO_RENDER_CONTROL_LIMITATION,
]);
assert.ok(
  noRenderReadyReport.slowFrames.every(
    (record) =>
      record.precedingFrameGpuTimingStatus === 'unavailable'
      && record.precedingFrameGpuTimingLimitation
        === VISUAL_GPU_NO_RENDER_CONTROL_LIMITATION,
  ),
  'a ready no-render report must serialize terminal, self-identifying GPU evidence',
);
const readyReportLatch = createVisualPerformanceReadyReportLatch();
const waitingReport = createExactWindowReport(
  'collecting',
  partiallyHydratedWorstFrames,
);
assert.strictEqual(readyReportLatch.accept(waitingReport), waitingReport);
assert.equal(readyReportLatch.hasReadyReport(), false);
const exactWindowReadyReport =
  createExactWindowReport('ready', terminalWorstFrames);
const periodicDomGate = createVisualPerformanceDomPublicationGate();
assert.equal(
  periodicDomGate.accept(waitingReport).publishToDom,
  true,
  'default profiler behavior must retain periodic collecting publication',
);
assert.deepEqual(periodicDomGate.getEvidence(), {
  mode: 'periodic',
  inMemoryReportConstructions: 1,
  jsonSerializations: 1,
  cohortDomPublications: 1,
  terminalDomPublications: 0,
});
const deferredDomGate = createVisualPerformanceDomPublicationGate();
deferredDomGate.deferUntilReady();
for (let publishIndex = 0; publishIndex < 60; publishIndex += 1) {
  const inMemoryPublication = deferredDomGate.accept(waitingReport);
  assert.equal(
    inMemoryPublication.publishToDom,
    false,
    '500ms collecting reports must stay serialized in memory during the judged cohort',
  );
  assert.equal(
    JSON.parse(inMemoryPublication.serializedReport).status,
    'collecting',
  );
}
assert.deepEqual(
  deferredDomGate.getEvidence(),
  {
    mode: 'terminal-only-after-freeze',
    inMemoryReportConstructions: 60,
    jsonSerializations: 60,
    cohortDomPublications: 0,
    terminalDomPublications: 0,
  },
  'the deferred treatment must retain 500ms report construction and JSON serialization with zero cohort DOM publication',
);
const terminalDomPublication = deferredDomGate.accept(exactWindowReadyReport);
assert.equal(terminalDomPublication.publishToDom, true);
assert.equal(
  JSON.parse(terminalDomPublication.serializedReport).status,
  'ready',
);
assert.deepEqual(deferredDomGate.getEvidence(), {
  mode: 'terminal-only-after-freeze',
  inMemoryReportConstructions: 61,
  jsonSerializations: 61,
  cohortDomPublications: 0,
  terminalDomPublications: 1,
});
assert.equal(
  deferredDomGate.accept(exactWindowReadyReport).publishToDom,
  false,
  'the terminal schema-5 dataset publication must be one-shot',
);
assert.deepEqual(deferredDomGate.getEvidence(), {
  mode: 'terminal-only-after-freeze',
  inMemoryReportConstructions: 62,
  jsonSerializations: 62,
  cohortDomPublications: 0,
  terminalDomPublications: 1,
});
assert.strictEqual(
  readyReportLatch.accept(exactWindowReadyReport),
  exactWindowReadyReport,
);
assert.equal(readyReportLatch.hasReadyReport(), true);
const immutableReadySnapshot = JSON.stringify(exactWindowReadyReport);
const driftCandidate = createExactWindowReport(
  'ready',
  terminalWorstFrames,
  1,
);
driftCandidate.context.viewport.width = 1_920;
driftCandidate.context.gpuTiming.pendingFrames = 999;
assert.strictEqual(
  readyReportLatch.accept(driftCandidate),
  exactWindowReadyReport,
  'later publish attempts must return the first ready report',
);
assert.equal(
  JSON.stringify(readyReportLatch.accept(driftCandidate)),
  immutableReadySnapshot,
  'the ready report must not drift after asynchronous readiness completes',
);
readyReportLatch.reset();
assert.equal(readyReportLatch.hasReadyReport(), false);
assert.strictEqual(
  readyReportLatch.accept(driftCandidate),
  driftCandidate,
  'an explicit trace reset may begin a new immutable report lifecycle',
);

const report = createVisualPerformanceReport({
  status: 'ready',
  elapsedSeconds: 30,
  sampleCount: frameTimes.length,
  metrics,
  renderer: {
    medianDrawCalls: 120,
    medianFrameCalls: 121,
    medianTriangles: 34_500,
  },
  slowFrames: boundedSlowFrames,
  context: {
    backend: 'webgpu',
    viewport: {
      width: 1280,
      height: 720,
    },
    devicePixelRatio: 2,
    rendererPixelRatio: 1,
    visibility: 'visible',
    adapter: nativeAdapter,
    gpuTiming: reportGpuEvidence,
    subsystems,
  },
});

const serializedReport = JSON.parse(JSON.stringify(report)) as typeof report;
assert.equal(serializedReport.schemaVersion, 5);
assert.equal(serializedReport.windowSeconds, 30);
assert.equal(serializedReport.status, 'ready');
assert.deepEqual(serializedReport.frameCpuSpan, VISUAL_FRAME_CPU_SPAN);
assert.deepEqual(
  serializedReport.frameCpuSubspans,
  VISUAL_FRAME_CPU_SUBSPANS,
);
assert.deepEqual(serializedReport.frameGpuSpan, VISUAL_FRAME_GPU_SPAN);
assert.equal(serializedReport.metrics.maxFrameMs, 100);
assert.equal(serializedReport.metrics.framesOver25Ms, 4);
assert.equal(serializedReport.metrics.framesOver50Ms, 2);
assert.deepEqual(serializedReport.slowFrames, boundedSlowFrames);
assert.equal(serializedReport.slowFrames[0]!.forest.matrixWrites, 4_096);
assert.equal(serializedReport.slowFrames[0]!.groundcoverDelta.bytesUploaded, 12_800);
assert.equal(serializedReport.slowFrames[0]!.renderer.drawCalls, 157);
assert.equal(serializedReport.slowFrames[0]!.renderer.frameCalls, 15);
assert.equal(serializedReport.slowFrames[0]!.renderer.triangles, 3_345_221);
assert.equal(serializedReport.slowFrames[0]!.precedingFrameCpuDurationMs, 1.25);
assert.equal(
  serializedReport.slowFrames[0]!
    .precedingFrameUpdatePreRenderDurationMs,
  1.05,
);
assert.equal(
  serializedReport.slowFrames[0]!
    .precedingFrameRenderSubmissionDurationMs,
  0.1,
);
assert.equal(
  serializedReport.slowFrames[0]!.precedingFramePostRenderDurationMs,
  0.1,
);
assert.equal(
  serializedReport.slowFrames[0]!.precedingFrameRafTimestampMs,
  serializedReport.slowFrames[0]!.intervalStartRafTimestampMs,
);
assert.equal(
  serializedReport.slowFrames[0]!
    .precedingFrameCallbackEntryTimestampMs,
  1.5,
);
assert.equal(
  serializedReport.slowFrames[0]!.precedingFrameEntryLatenessMs,
  serializedReport.slowFrames[0]!
    .precedingFrameCallbackEntryTimestampMs
    - serializedReport.slowFrames[0]!.precedingFrameRafTimestampMs,
  'schema-5 callback entry lateness must exactly identify the preceding callback',
);
assert.equal(
  serializedReport.slowFrames[0]!.precedingFrameGpuRafTimestampMs,
  serializedReport.slowFrames[0]!.intervalStartRafTimestampMs,
);
assert.equal(serializedReport.slowFrames[0]!.precedingFrameGpuDurationMs, 1.5);
assert.equal(serializedReport.slowFrames[0]!.precedingFrameGpuQueryId, 101);
assert.equal(
  serializedReport.slowFrames[0]!.precedingFrameGpuTimingStatus,
  'available',
);
assert.equal('cpuDurationMs' in serializedReport.slowFrames[0]!, false);
assert.deepEqual(Object.keys(serializedReport.context.subsystems), subsystemNames);
assert.equal(serializedReport.context.subsystems.riverSimulation, false);
assert.equal(serializedReport.context.adapter.identityStatus, 'available');
assert.equal(serializedReport.context.adapter.fallbackStatus, 'non-fallback');
assert.equal(serializedReport.context.adapter.isFallbackAdapter, false);
assert.equal('pass' in serializedReport, false);

subsystems.riverSimulation = true;
nativeAdapter.limitations.push('mutated after report creation');
const unavailableEvidence = createUnavailableVisualGpuTimingEvidence(
  'explicit test limitation',
);
assert.equal(unavailableEvidence.status, 'unavailable');
assert.equal(
  report.context.subsystems.riverSimulation,
  false,
  'report context should snapshot subsystem state',
);
assert.deepEqual(
  report.context.adapter.limitations,
  [],
  'report context should snapshot adapter limitations',
);
reportGpuEvidence.limitations.push('mutated after report creation');
assert.notDeepEqual(
  report.context.gpuTiming.limitations,
  reportGpuEvidence.limitations,
  'report context should snapshot GPU timing limitations',
);

const realAppGroundcoverWork = {
  mode: 'active' as const,
  maxUpdateDurationBudgetMs: 0,
  updates: 3,
  generationSubsteps: 10,
  generationDurationMs: 0,
  clearWriteSubsteps: 20,
  clearWriteDurationMs: 0,
  refreshCount: 30,
  refreshDurationMs: 0,
  gpuFlagUpdates: 40,
  gpuUpdateRanges: 50,
  bytesUploaded: 60,
  boundsScans: 0,
  completedSlots: 70,
  cancelledSlots: 80,
  pendingSlots: 2,
  maxPendingSlots: 2,
  lastUpdateDurationMs: 0,
  maxUpdateDurationMs: 0,
  converged: false,
};
let realAppRenderCalls = 0;
const realAppPostProcessor = {
  render(this: unknown, _dt: number) {
    assert.equal(this, realAppPostProcessor);
    realAppRenderCalls += 1;
    realAppGroundcoverWork.generationSubsteps += 2;
    realAppGroundcoverWork.bytesUploaded += 128;
    realAppGroundcoverWork.pendingSlots = 1;
  },
};
const realAppAttribution = createRuntimeAppFrameAttribution({
  renderer: {},
  postProcessor: realAppPostProcessor,
  grassField: {
    getStreamTelemetry: (target: typeof realAppGroundcoverWork) =>
      Object.assign(target, realAppGroundcoverWork),
  },
  getPerformanceStats: () => ({ backend: 'webgpu' }),
  getRendererAdapterEvidence: () => ({
    source: 'unavailable',
    identityStatus: 'unavailable',
    fallbackStatus: 'unavailable',
    vendor: null,
    architecture: null,
    device: null,
    description: null,
    isFallbackAdapter: null,
    limitations: [],
  }),
} as never, false);
const realAppCallbackEntry = performance.now();
realAppAttribution.beginFrame(123.5, realAppCallbackEntry);
realAppAttribution.wrapPostRender(realAppPostProcessor.render)(1 / 60);
realAppAttribution.completeFrame(performance.now(), 'settlement');
const realAppContext = realAppAttribution.getSlowFrameContext(123.5);
assert.ok(realAppContext);
assert.equal(realAppRenderCalls, 1);
assert.equal(realAppContext.phase, 'settlement');
assert.equal(realAppContext.groundcoverDelta.generationSubsteps, 2);
assert.equal(realAppContext.groundcoverDelta.bytesUploaded, 128);
assert.equal(realAppContext.groundcoverDelta.pendingSlots, 1);
assert.equal(realAppContext.frameGpuTiming.status, 'unavailable');
assert.equal(
  realAppAttribution.getVisualGpuTimingEvidence().attemptedFrames,
  0,
  'marker-off certification must not submit or allocate per-frame timestamp-query work',
);
realAppAttribution.dispose();

const mainSource = readFileSync(
  new URL('../src/main.ts', import.meta.url),
  'utf8',
);
const appSource = readFileSync(
  new URL('../src/app/App.ts', import.meta.url),
  'utf8',
);
const sceneManagerSource = readFileSync(
  new URL('../src/scene/SceneManager.ts', import.meta.url),
  'utf8',
);
const hookSource = readFileSync(
  new URL('../src/e2e/visualPerformanceHooks.ts', import.meta.url),
  'utf8',
);
assert.match(
  mainSource,
  /installVisualPerformanceHooksIfRequested\(app,\s*\{\s*deferPeriodicReportsUntilReady:\s*true/,
  'the real App profile must not build and serialize growing reports inside its judged cohort',
);
assert.match(
  appSource,
  /frameProfiler\?\.beginFrame\(time, performance\.now\(\)\)[\s\S]*?frameProfiler\.completeFrame\(performance\.now\(\), phase\)/,
  'the real App callback must expose causally aligned CPU boundaries',
);
assert.match(
  appSource,
  /this\.updateFps\(time, rawDt\);/,
  'the actual-App FPS counter must include unclamped rAF stalls',
);
assert.doesNotMatch(
  sceneManagerSource,
  /webGpuTimestampProfiler|enableVisualFrameProfiling|VisualSlowFrameContext/,
  'profile-only attribution must not inflate the ordinary SceneManager chunk',
);
assert.match(
  hookSource,
  /createRuntimeAppFrameAttribution\([\s\S]*?setVisualFrameProfiler[\s\S]*?wrapPostRender\(initial\.postRender\)[\s\S]*?getSlowFrameContext/,
  'the dynamically loaded hook must install real App CPU/GPU attribution and wrap the render boundary',
);
assert.match(
  hookSource,
  /if \(deferPeriodicReportsUntilReady && !traceCapture\.isFrozen\(\)\) return;/,
  'terminal-only mode must skip report construction until the frame cohort freezes',
);
assert.match(
  hookSource,
  /const forestProfile = manager\.forestManager\.getSeedThreeProfileBreakdown\(\);[\s\S]*profileDataset\.visualProfileForestStructural = JSON\.stringify\(forestProfile\);[\s\S]*collectorSettleTimeout = window\.setTimeout/,
  'forest structural evidence must publish once before collection, never inside the judged frame loop',
);
assert.match(
  hookSource,
  /const disposeProfile = \(\): void => \{[\s\S]*?clearTimeout\(deferredScenePollTimeout\)[\s\S]*?manager\.postProcessor\.render = initial\.postRender;[\s\S]*?setVisualFrameProfiler\?\.\(null\)[\s\S]*?delete profileWindow\.__visualPerf;/,
  'disposing the real App profiler must cancel pending work and restore every runtime monkey patch',
);
assert.match(
  appSource,
  /setVisualFrameProfiler\(profiler: AppFrameProfiler \| null\): void/,
  'the dynamically installed profiler must be detachable without leaving ordinary frame work behind',
);

console.log('Visual performance hook tests passed.');
