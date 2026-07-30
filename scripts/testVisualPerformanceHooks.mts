import assert from 'node:assert/strict';
import {
  calculateVisualPerformanceMetrics,
  createVisualPerformanceResettleGate,
  createVisualPerformanceReport,
  resetVisualPerformanceSubsystems,
  type ProfileSubsystem,
} from '../src/e2e/visualPerformanceHooks.ts';
import {
  acquireWebGPUAdapterDevice,
  createPreferredRenderer,
  readWebGLAdapterEvidence,
} from '../src/scene/RendererBackend.ts';

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

const integratedDevice = { label: 'integrated selected device' };
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
    const renderer = {
      backend: {
        isWebGPUBackend: true,
      },
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
    subsystems,
  },
});

const serializedReport = JSON.parse(JSON.stringify(report)) as typeof report;
assert.equal(serializedReport.schemaVersion, 1);
assert.equal(serializedReport.windowSeconds, 30);
assert.equal(serializedReport.status, 'ready');
assert.equal(serializedReport.metrics.maxFrameMs, 100);
assert.equal(serializedReport.metrics.framesOver25Ms, 4);
assert.equal(serializedReport.metrics.framesOver50Ms, 2);
assert.deepEqual(Object.keys(serializedReport.context.subsystems), subsystemNames);
assert.equal(serializedReport.context.subsystems.riverSimulation, false);
assert.equal(serializedReport.context.adapter.identityStatus, 'available');
assert.equal(serializedReport.context.adapter.fallbackStatus, 'non-fallback');
assert.equal(serializedReport.context.adapter.isFallbackAdapter, false);
assert.equal('pass' in serializedReport, false);

subsystems.riverSimulation = true;
nativeAdapter.limitations.push('mutated after report creation');
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

console.log('Visual performance hook tests passed.');
