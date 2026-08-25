import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { createPostProcessor } from '../scene/PostProcessing.ts';
import {
  createPreferredRenderer,
  setRendererAnimationLoop,
  setWebGPUOutputRenderTarget,
  setWebGPURenderTarget,
} from '../scene/RendererBackend.ts';

type FixtureOwner = 'world' | 'illustrated-map';
type PendingRender = {
  owner: FixtureOwner;
  reject(error: unknown): void;
  resolve(frame: number): void;
  simulateLeakedTargets: boolean;
};

const host = document.querySelector<HTMLElement>('#fixture');
if (!host) throw new Error('WebGPU render-owner fixture host is missing.');

try {
  const backend = await createPreferredRenderer();
  if (backend.kind !== 'webgpu') throw new Error('Fixture requires native WebGPU.');
  const renderer = backend.renderer as WebGPURenderer;
  renderer.setPixelRatio(1);
  renderer.setSize(256, 256, false);
  host.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 20);
  camera.position.z = 4;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const worldScene = new THREE.Scene();
  const worldBackground = new THREE.Color(0x173f8f);
  worldScene.background = worldBackground;
  const mapScene = new THREE.Scene();
  mapScene.background = new THREE.Color(0xc17832);
  const postProcessor = createPostProcessor(
    backend,
    worldScene,
    camera,
    mapScene,
  );
  postProcessor.setPixelRatio(1);
  postProcessor.setSize(256, 256);

  const leakedTarget = new THREE.WebGLRenderTarget(16, 16);
  const pendingRenders: PendingRender[] = [];
  let renderInFlight = false;
  let renderedFrame = 0;
  const renderOwner = (
    owner: FixtureOwner,
    simulateLeakedTargets = true,
  ): Promise<number> => new Promise((resolve, reject) => {
    pendingRenders.push({ owner, reject, resolve, simulateLeakedTargets });
  });

  setRendererAnimationLoop(renderer, () => {
    if (renderInFlight) return;
    const request = pendingRenders.shift();
    if (!request) return;

    renderInFlight = true;
    const frame = ++renderedFrame;
    try {
      if (request.simulateLeakedTargets) {
        setWebGPURenderTarget(renderer, leakedTarget);
        setWebGPUOutputRenderTarget(renderer, leakedTarget);
      }
      if (request.owner === 'world') postProcessor.render(0);
      else postProcessor.renderIllustratedMap();
    } catch (error) {
      renderInFlight = false;
      request.reject(error);
      return;
    }

    void backend.waitForSubmittedWork().then(() => {
      document.body.dataset.owner = request.owner;
      document.body.dataset.renderedFrame = String(frame);
      request.resolve(frame);
    }, request.reject).finally(() => {
      renderInFlight = false;
    });
  });

  window.__WEBGPU_RENDER_OWNER_FIXTURE__ = {
    backend: backend.kind,
    renderOwner,
    setWorldColor: (color) => worldBackground.set(color),
  };
  await renderOwner('world', false);
  document.body.dataset.ready = 'true';

  window.addEventListener('pagehide', () => {
    setRendererAnimationLoop(renderer, null);
    postProcessor.dispose();
    leakedTarget.dispose();
    renderer.dispose();
  }, { once: true });
} catch (error) {
  document.body.dataset.error = 'true';
  const messages: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  if (current !== undefined) messages.push(String(current));
  document.body.dataset.errorReason = messages.join(' Caused by: ');
  host.textContent = document.body.dataset.errorReason;
}

declare global {
  interface Window {
    __WEBGPU_RENDER_OWNER_FIXTURE__?: {
      backend: string;
      renderOwner(owner: FixtureOwner, simulateLeakedTargets?: boolean): Promise<number>;
      setWorldColor(color: number): void;
    };
  }
}
