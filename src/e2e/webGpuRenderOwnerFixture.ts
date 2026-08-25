import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { createPostProcessor } from '../scene/PostProcessing.ts';
import {
  createPreferredRenderer,
  setWebGPURenderTarget,
} from '../scene/RendererBackend.ts';

type FixtureOwner = 'world' | 'illustrated-map';

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
  worldScene.background = new THREE.Color(0x173f8f);
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
  const renderOwner = async (
    owner: FixtureOwner,
    simulateLeakedTarget = true,
  ): Promise<void> => {
    if (simulateLeakedTarget) setWebGPURenderTarget(renderer, leakedTarget);
    if (owner === 'world') postProcessor.render(0);
    else postProcessor.renderIllustratedMap();
    await backend.waitForSubmittedWork();
    document.body.dataset.owner = owner;
  };

  window.__WEBGPU_RENDER_OWNER_FIXTURE__ = {
    backend: backend.kind,
    renderOwner,
  };
  await renderOwner('world', false);
  document.body.dataset.ready = 'true';

  window.addEventListener('pagehide', () => {
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
      renderOwner(owner: FixtureOwner, simulateLeakedTarget?: boolean): Promise<void>;
    };
  }
}
