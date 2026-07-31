import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';

type WebGPUPowerPreference = 'low-power' | 'high-performance';

type WebGPUAdapterInfoLike = {
  vendor?: unknown;
  architecture?: unknown;
  device?: unknown;
  description?: unknown;
  isFallbackAdapter?: unknown;
};

type WebGPUDeviceLike = {
  readonly queue?: {
    onSubmittedWorkDone?: () => Promise<void>;
  };
};

type WebGPUAdapterLike = {
  readonly info?: WebGPUAdapterInfoLike;
  // Legacy browser compatibility only. The current standard field is
  // GPUAdapter.info.isFallbackAdapter.
  readonly isFallbackAdapter?: unknown;
  readonly features?: {
    forEach(callback: (feature: string) => void): void;
  };
  requestDevice(descriptor?: {
    requiredFeatures?: string[];
    requiredLimits?: Record<string, number>;
  }): Promise<unknown>;
};

export type WebGPUProviderLike = {
  requestAdapter(options?: {
    powerPreference?: WebGPUPowerPreference;
    featureLevel?: 'compatibility';
    xrCompatible?: boolean;
  }): Promise<WebGPUAdapterLike | null>;
};

type NavigatorWithWebGPU = Navigator & {
  gpu?: WebGPUProviderLike;
};

type RendererWithBackend = WebGPURenderer & {
  backend: {
    isWebGPUBackend?: boolean;
    isWebGLBackend?: boolean;
    device?: WebGPUDeviceLike | null;
  };
};

type ShadowMapWithManualRefresh = THREE.WebGLRenderer['shadowMap'] & {
  autoUpdate?: boolean;
  needsUpdate?: boolean;
};

export type RendererBackendKind = 'webgpu' | 'webgl2-node' | 'webgl';
export type SupportedRenderer = THREE.WebGLRenderer | WebGPURenderer;

export type RendererAdapterEvidence = {
  source:
    | 'webgpu-adapter-info'
    | 'webgl-debug-renderer-info'
    | 'unavailable';
  identityStatus: 'available' | 'unavailable';
  fallbackStatus: 'non-fallback' | 'fallback' | 'unavailable';
  vendor: string | null;
  architecture: string | null;
  device: string | null;
  description: string | null;
  isFallbackAdapter: boolean | null;
  limitations: string[];
};

export type RendererBackend = {
  adapterEvidence: RendererAdapterEvidence;
  kind: RendererBackendKind;
  maxAnisotropy: number;
  renderer: SupportedRenderer;
  /**
   * Resolves once every command submitted before this call has completed.
   * Exact drawing-buffer captures use this to avoid reading a stale frame.
   */
  waitForSubmittedWork: () => Promise<void>;
};

export type RendererConstructionOptions = {
  alpha: boolean;
  antialias: boolean;
  device?: unknown;
  forceWebGL?: boolean;
  powerPreference: WebGPUPowerPreference;
};

export type RendererBackendDependencies = {
  gpu: WebGPUProviderLike | null;
  createRenderer(options: RendererConstructionOptions): WebGPURenderer;
  waitForStartup<T>(promise: Promise<T>, label: string): Promise<T>;
};

const RENDERER_OPTIONS = {
  antialias: true,
  powerPreference: 'high-performance' as const,
};
const WEBGPU_STARTUP_TIMEOUT_MS = 2500;

export async function createPreferredRenderer(
  dependencies: RendererBackendDependencies = defaultRendererBackendDependencies(),
): Promise<RendererBackend> {
  const webGPU = await requestPreferredWebGPUDevice(
    dependencies.gpu,
    dependencies.waitForStartup,
  );
  if (webGPU) {
    const renderer = dependencies.createRenderer({
      ...RENDERER_OPTIONS,
      alpha: true,
      device: webGPU.device,
    });
    configureRenderer(renderer);

    try {
      await dependencies.waitForStartup(
        renderer.init(),
        'WebGPU renderer initialization',
      );

      if (isNativeWebGPU(renderer)) {
        return {
          adapterEvidence: webGPU.adapterEvidence,
          kind: 'webgpu',
          maxAnisotropy: renderer.getMaxAnisotropy(),
          renderer,
          waitForSubmittedWork: () =>
            waitForNativeWebGPUSubmittedWork(renderer),
        };
      }

      if (isNodeWebGL(renderer)) {
        console.warn('WebGPU is unavailable; using Three.js node materials through its WebGL 2 backend.');
        return {
          adapterEvidence: readWebGLAdapterEvidence(renderer),
          kind: 'webgl2-node',
          maxAnisotropy: renderer.getMaxAnisotropy(),
          renderer,
          waitForSubmittedWork: async () => {},
        };
      }
    } catch (error) {
      console.warn('WebGPU renderer initialization failed; falling back to WebGL.', error);
    }

    renderer.dispose();
  }

  const renderer = dependencies.createRenderer({
    ...RENDERER_OPTIONS,
    alpha: true,
    forceWebGL: true,
  });
  configureRenderer(renderer);

  try {
    await dependencies.waitForStartup(
      renderer.init(),
      'WebGL 2 node renderer initialization',
    );
    return {
      adapterEvidence: readWebGLAdapterEvidence(renderer),
      kind: 'webgl2-node',
      maxAnisotropy: renderer.getMaxAnisotropy(),
      renderer,
      waitForSubmittedWork: async () => {},
    };
  } catch (error) {
    renderer.dispose();
    throw new Error(
      'This browser could not initialize the WebGPU or WebGL 2 renderer required by the game.',
      { cause: error },
    );
  }
}

function defaultRendererBackendDependencies(): RendererBackendDependencies {
  const gpu = typeof navigator === 'undefined'
    ? null
    : (navigator as NavigatorWithWebGPU).gpu ?? null;
  return {
    gpu,
    createRenderer: (options) => new WebGPURenderer(options),
    waitForStartup: (promise, label) =>
      withTimeout(promise, WEBGPU_STARTUP_TIMEOUT_MS, label),
  };
}

async function waitForNativeWebGPUSubmittedWork(
  renderer: WebGPURenderer,
): Promise<void> {
  const backend = (renderer as RendererWithBackend).backend;
  const queue = backend?.isWebGPUBackend === true
    ? backend.device?.queue
    : undefined;
  if (typeof queue?.onSubmittedWorkDone !== 'function') {
    throw new Error(
      'Native WebGPU capture synchronization is unavailable on the active renderer device queue.',
    );
  }
  await queue.onSubmittedWorkDone();
}

export async function acquireWebGPUAdapterDevice(
  gpu: WebGPUProviderLike,
): Promise<{
  adapterEvidence: RendererAdapterEvidence;
  device: unknown;
} | null> {
  const adapter = await gpu.requestAdapter({
    powerPreference: RENDERER_OPTIONS.powerPreference,
    featureLevel: 'compatibility',
    xrCompatible: false,
  });
  if (!adapter) return null;

  let adapterEvidence: RendererAdapterEvidence;
  try {
    adapterEvidence = sanitizeWebGPUAdapterEvidence(
      adapter.info,
      adapter.isFallbackAdapter,
    );
  } catch {
    adapterEvidence = unavailableAdapterEvidence(
      'Reading the selected GPUAdapter.info failed.',
    );
  }
  const requiredFeatures: string[] = [];
  adapter.features?.forEach((feature) => {
    requiredFeatures.push(feature);
  });
  const device = await adapter.requestDevice({
    requiredFeatures,
    requiredLimits: {},
  });

  return {
    adapterEvidence,
    device,
  };
}

export function readWebGLAdapterEvidence(
  renderer: SupportedRenderer,
): RendererAdapterEvidence {
  type WebGlContextLike = {
    getExtension(name: string): unknown;
    getParameter(parameter: unknown): unknown;
  };
  type RendererWithContextAccess = {
    backend?: {
      getContext?: () => unknown;
      gl?: unknown;
    };
    getContext?: () => unknown;
  };

  try {
    const accessibleRenderer = renderer as unknown as RendererWithContextAccess;
    const backendContext = accessibleRenderer.backend?.getContext?.()
      ?? accessibleRenderer.backend?.gl;
    const context = (backendContext ?? accessibleRenderer.getContext?.()) as
      | WebGlContextLike
      | null
      | undefined;
    if (!context) {
      return unavailableAdapterEvidence(
        'The active renderer did not expose its WebGL context.',
      );
    }
    const extension = context.getExtension('WEBGL_debug_renderer_info') as
      | {
        UNMASKED_VENDOR_WEBGL?: unknown;
        UNMASKED_RENDERER_WEBGL?: unknown;
      }
      | null;
    if (!extension) {
      return unavailableAdapterEvidence('WEBGL_debug_renderer_info is unavailable.');
    }
    const vendor = adapterText(context.getParameter(extension.UNMASKED_VENDOR_WEBGL));
    const description = adapterText(
      context.getParameter(extension.UNMASKED_RENDERER_WEBGL),
    );
    const identityStatus = vendor !== null || description !== null
      ? 'available'
      : 'unavailable';
    const limitations = [
      'WebGL does not expose the standard WebGPU isFallbackAdapter signal.',
    ];
    if (identityStatus === 'unavailable') {
      limitations.push('The browser redacted the WebGL adapter identity fields.');
    }

    return {
      source: 'webgl-debug-renderer-info',
      identityStatus,
      fallbackStatus: 'unavailable',
      vendor,
      architecture: null,
      device: null,
      description,
      isFallbackAdapter: null,
      limitations,
    };
  } catch {
    return unavailableAdapterEvidence('Reading renderer adapter information failed.');
  }
}

function sanitizeWebGPUAdapterEvidence(
  adapterInfo: WebGPUAdapterInfoLike | undefined,
  fallbackValue: unknown,
): RendererAdapterEvidence {
  const legacyFallbackValue = typeof fallbackValue === 'boolean'
    ? fallbackValue
    : null;
  if (!adapterInfo && legacyFallbackValue === null) {
    return unavailableAdapterEvidence('The selected GPUAdapter did not expose info.');
  }

  const vendor = adapterText(adapterInfo?.vendor);
  const architecture = adapterText(adapterInfo?.architecture);
  const device = adapterText(adapterInfo?.device);
  const description = adapterText(adapterInfo?.description);
  const standardFallbackValue = typeof adapterInfo?.isFallbackAdapter === 'boolean'
    ? adapterInfo.isFallbackAdapter
    : null;
  const isFallbackAdapter = standardFallbackValue ?? legacyFallbackValue;
  const identityStatus =
    vendor !== null || architecture !== null || device !== null || description !== null
      ? 'available'
      : 'unavailable';
  const limitations: string[] = [];
  if (identityStatus === 'unavailable') {
    limitations.push(
      adapterInfo
        ? 'The browser redacted all WebGPU adapter identity fields.'
        : 'The selected GPUAdapter did not expose info, so its identity is unavailable or redacted.',
    );
  }
  if (standardFallbackValue === null && legacyFallbackValue !== null) {
    limitations.push(
      'Fallback status came from the legacy GPUAdapter.isFallbackAdapter field.',
    );
  }
  if (isFallbackAdapter === null) {
    limitations.push('GPUAdapter.info did not expose isFallbackAdapter.');
  }

  return {
    source: 'webgpu-adapter-info',
    identityStatus,
    fallbackStatus: isFallbackAdapter === null
      ? 'unavailable'
      : isFallbackAdapter
        ? 'fallback'
        : 'non-fallback',
    vendor,
    architecture,
    device,
    description,
    isFallbackAdapter,
    limitations,
  };
}

function adapterText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function unavailableAdapterEvidence(limitation: string): RendererAdapterEvidence {
  return {
    source: 'unavailable',
    identityStatus: 'unavailable',
    fallbackStatus: 'unavailable',
    vendor: null,
    architecture: null,
    device: null,
    description: null,
    isFallbackAdapter: null,
    limitations: [limitation],
  };
}

function configureRenderer(renderer: SupportedRenderer): void {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // Day/night presentation refines exposure every clock update. Keep startup
  // neutral so the first frame does not flash brighter than the settled grade.
  renderer.toneMappingExposure = 1.04;
  renderer.shadowMap.enabled = true;
  // Restore the original soft filtering for the authored tree/building atlas.
  // Manual refresh and the view-fitted 2048px frustum retain the existing cost
  // controls while preserving natural foliage penumbrae.
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x9bb8c8, 1);

  const shadowMap = renderer.shadowMap as ShadowMapWithManualRefresh;
  // The expensive casters are static trees/buildings. SceneManager explicitly
  // invalidates this map for camera, sun, construction, and preference changes.
  if ('autoUpdate' in shadowMap) shadowMap.autoUpdate = false;
}

async function requestPreferredWebGPUDevice(
  gpu: WebGPUProviderLike | null,
  waitForStartup: RendererBackendDependencies['waitForStartup'],
): Promise<{
  adapterEvidence: RendererAdapterEvidence;
  device: unknown;
} | null> {
  if (!gpu) return null;

  try {
    return await waitForStartup(
      acquireWebGPUAdapterDevice(gpu),
      'WebGPU adapter and device request',
    );
  } catch (error) {
    console.warn('WebGPU adapter or device request failed; falling back to WebGL.', error);
    return null;
  }
}

function isNativeWebGPU(renderer: WebGPURenderer): boolean {
  return (renderer as RendererWithBackend).backend.isWebGPUBackend === true;
}

function isNodeWebGL(renderer: WebGPURenderer): boolean {
  return (renderer as RendererWithBackend).backend.isWebGLBackend === true;
}

export function supportsNodeMaterials(backend: RendererBackendKind): boolean {
  return backend === 'webgpu' || backend === 'webgl2-node';
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
