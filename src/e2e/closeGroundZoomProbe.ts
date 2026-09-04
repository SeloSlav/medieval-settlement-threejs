// @ts-nocheck -- Opt-in real-world diagnostics, injected only by the local probe server.
import { createVisualGpuTimestampProfiler } from './webGpuTimestampProfiler.ts';

/** Low-overhead final check: no per-draw/per-upload wrappers from the camp probe. */
export function installCloseGroundZoomProbe(app) {
  const events = [];
  let phase = null;
  const record = (name, details = {}) => events.push({ t: performance.now(), name, ...details });
  for (const key of ['createShaderModule', 'createRenderPipeline', 'createRenderPipelineAsync']) {
    const original = GPUDevice.prototype[key];
    GPUDevice.prototype[key] = function (...args) {
      if (phase) record('zoom-gpu-resource', { phase, resource: key, label: args[0]?.label });
      return original.apply(this, args);
    };
  }
  setInterval(() => {
    if (!events.length) return;
    fetch('/__camp_probe', { method: 'POST', body: JSON.stringify(events.splice(0)) }).catch(() => {});
  }, 1000);
  const controls = document.createElement('div');
  controls.style.cssText = 'position:fixed;bottom:3px;left:3px;z-index:99999;display:flex;gap:4px';
  installCloseGroundZoomControls(app, controls, record, next => { phase = next; });
  document.body.append(controls);
  record('probe-installed', { probeMode: 'zoom-only' });
}

export function installCloseGroundZoomControls(app, controls, record, setPhase) {
  const button = document.createElement('button');
  button.textContent = 'Test first grass zoom';
  controls.append(button);
  button.onclick = async () => {
    if (button.disabled || !app.sceneManager?.grassField) return;
    button.disabled = true;
    const manager = app.sceneManager;
    const renderer = manager.renderer;
    const grass = manager.grassField;
    // Fixed Mrkopalj pond/woodland stress view. Never derive this from a camera
    // the player may have moved between page loads: it invalidates the A/B.
    const x = 170.1;
    const z = -45.36;
    const gpu = createVisualGpuTimestampProfiler({ kind: 'webgpu', renderer });
    const frames = [];
    let phase = 'far';
    let lastFrame = performance.now();
    const originalRender = manager.render;
    manager.render = function (...args) {
      const start = performance.now();
      const handle = gpu.beginFrame(start);
      try { return originalRender.apply(this, args); }
      finally {
        gpu.endFrame(handle);
        frames.push({ phase, t: start, intervalMs: start - lastFrame,
          cpuMs: performance.now() - start, grass: grass.getStreamTelemetry() });
        lastFrame = start;
      }
    };
    const waitFrames = async count => {
      for (let i = 0; i < count; i++) await new Promise(requestAnimationFrame);
    };
    try {
      record('zoom-manifest', { viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
        x, z, adapter: manager.getRendererAdapterEvidence(),
        settings: manager.worldLayout.settings, seed: manager.worldLayout.treeSeed,
        startup: window.__medievalRoadStartup?.firstPlayableAssets });
      for (const [name, zoom] of [['below-first', 190], ['cross-first', 230],
        ['below-repeat', 190], ['cross-repeat', 230], ['full-close', 650]]) {
        phase = name;
        setPhase(name);
        button.textContent = `${name}: ${zoom}%`;
        record('zoom-phase', { phase, zoom });
        app.cameraController.focusWorldPositionAtZoom(x, z, zoom);
        await waitFrames(180);
        record('zoom-checkpoint', { phase, camera: manager.camera.matrixWorld.toArray(),
          projection: manager.camera.projectionMatrix.toArray(), stats: manager.getPerformanceStats(),
          grass: grass.getStreamTelemetry(), meshes: grass.group.children.map(m => ({
            name: m.name, count: m.count, visible: m.visible,
            vertices: m.geometry?.attributes.position.count,
          })) });
      }
      await renderer.backend.device.queue.onSubmittedWorkDone();
      record('zoom-timings', { evidence: gpu.getEvidence(),
        frames: frames.map(f => ({ ...f, gpu: gpu.getFrameTiming(f.t) })) });
      button.textContent = 'Grass zoom trace complete';
    } catch (error) {
      record('zoom-error', { message: String(error), stack: error?.stack });
      button.textContent = 'Grass zoom trace FAILED';
    } finally {
      manager.render = originalRender;
      gpu.dispose();
      setPhase(null);
      button.disabled = false;
    }
  };
}
