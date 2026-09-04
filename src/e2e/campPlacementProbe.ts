// @ts-nocheck -- Opt-in diagnostic instrumentation of browser/Three internals.
// Injected only by scripts/camp-placement-debug-server.mjs, never by the game.
import { BuildingTool } from '../buildings/BuildingTool.ts';
import { BuildingMarkers } from '../buildings/BuildingMarkers.ts';
import { SceneManager } from '../scene/SceneManager.ts';
import { SettlementCrowdRenderer } from '../settlement/SettlementCrowdRenderer.ts';
import { VillagerRenderer } from '../settlement/VillagerRenderer.ts';
import { CampStandardRenderer } from '../settlement/CampStandardRenderer.ts';
import { WebGPURenderer } from 'three/webgpu';
import { installFireTransitionControls } from './fireLightingProbe.ts';

export function installCampPlacementProbe(app) {
  const events = [];
  let placementStart = 0;
  let pendingStart = 0;
  let pendingFenceSubmitted = false;
  let renderDepth = 0;
  let renderResources = null;
  let lastLights = '';
  const record = (name, details = {}) => {
    events.push({ t: Math.round(performance.now() * 100) / 100, name, ...details });
  };
  let firePhase = null;
  const wrap = (target, key, prefix) => {
    const original = target?.[key];
    if (typeof original !== 'function' || original.__campProbe) return;
    const fn = function (...args) {
      const start = performance.now();
      if (key === 'showPendingPlacement') { pendingStart = start; pendingFenceSubmitted = false; }
      const outerRender = prefix === 'WebGPURenderer' && key === 'render' && renderDepth++ === 0;
      if (outerRender) {
        renderResources = { objects: {}, shaders: 0, pipelines: 0, uploads: 0, bytes: 0 };
        if (this._objects && !this._objects.__campProbe) {
          this._objects.__campProbe = true;
          const create = this._objects.createRenderObject;
          this._objects.createRenderObject = function (...a) {
            if (renderResources) {
              const name = `${a[3]?.name || a[3]?.type} / ${a[4]?.name || a[4]?.type}`;
              renderResources.objects[name] = (renderResources.objects[name] ?? 0) + 1;
            }
            return create.apply(this, a);
          };
        }
        const lights = [];
        app.sceneManager?.scene.traverseVisible(o => { if (o.isLight) lights.push({ id: o.id, type: o.type, name: o.name }); });
        const signature = JSON.stringify(lights);
        if (signature !== lastLights) {
          record('lights-changed', { lights });
          lastLights = signature;
        }
      }
      if (renderResources) {
        if (key === 'createShaderModule') renderResources.shaders++;
        if (key === 'createRenderPipeline' || key === 'createRenderPipelineAsync') renderResources.pipelines++;
        if (key === 'writeBuffer') { renderResources.uploads++; renderResources.bytes += args[2]?.byteLength ?? 0; }
      }
      try {
        const value = original.apply(this, args);
        if (value?.then && /prewarm|prepare|compile|start|placeAt/i.test(key)) {
          value.then(() => record(`${prefix}.${key}:resolved`, { ms: performance.now() - start }), () => {});
        }
        return value;
      } finally {
        const ms = performance.now() - start;
        if (prefix === 'WebGPURenderer' && key === 'render') renderDepth--;
        if (outerRender) {
          if (firePhase || ms > 100 || Object.keys(renderResources.objects).length) record('render-resources', { phase: firePhase, ms, ...renderResources });
          if (pendingStart && !pendingFenceSubmitted) {
            pendingFenceSubmitted = true;
            record('pending-first-submit', { ms: performance.now() - pendingStart, renderMs: ms, ...renderResources });
            this.backend.device.queue.onSubmittedWorkDone().then(() => record('pending-gpu-complete', { ms: performance.now() - pendingStart }));
          }
          renderResources = null;
        }
        if (ms > 3 || /showPendingPlacement|placeAt|setMode|beginFirstPlayable|beginFoundersCamp/.test(key)) {
          record(`${prefix}.${key}`, { ms });
        }
      }
    };
    fn.__campProbe = true;
    target[key] = fn;
  };
  for (const klass of [BuildingTool, BuildingMarkers, SceneManager, SettlementCrowdRenderer, VillagerRenderer, CampStandardRenderer]) {
    for (const key of Object.getOwnPropertyNames(klass.prototype)) {
      if (key === 'constructor' || Object.getOwnPropertyDescriptor(klass.prototype, key)?.get) continue;
      wrap(klass.prototype, key, klass.name);
    }
  }
  for (const key of ['render', 'compileAsync']) wrap(WebGPURenderer.prototype, key, 'WebGPURenderer');
  for (const key of ['createRenderPipeline', 'createRenderPipelineAsync', 'createBindGroup', 'createShaderModule']) {
    wrap(globalThis.GPUDevice?.prototype, key, 'GPUDevice');
  }
  for (const key of ['submit', 'writeBuffer', 'writeTexture']) wrap(globalThis.GPUQueue?.prototype, key, 'GPUQueue');
  document.addEventListener('pointerdown', e => {
    record('pointerdown', { x: e.clientX, y: e.clientY, target: e.target?.tagName, mode: app.buildingTool?.getMode() });
    if (e.target?.tagName === 'CANVAS' && app.buildingTool?.getMode() === 'founders_camp') {
      placementStart = performance.now();
      record('placement-manifest', { viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
        camera: app.sceneManager.camera.matrixWorld.toArray(), projection: app.sceneManager.camera.projectionMatrix.toArray(),
        stats: app.sceneManager.getPerformanceStats(), adapter: app.sceneManager.getRendererAdapterEvidence() });
    }
  }, true);
  document.addEventListener('pointerup', e => record('pointerup', { target: e.target?.tagName }), true);
  new PerformanceObserver(list => {
    for (const task of list.getEntries()) record('longtask', { start: task.startTime, ms: task.duration });
  }).observe({ type: 'longtask', buffered: true });
  try {
    new PerformanceObserver(list => {
      for (const frame of list.getEntries()) record('long-animation-frame', {
        start: frame.startTime, ms: frame.duration, blocking: frame.blockingDuration,
        scripts: frame.scripts.map(s => ({ name: s.sourceFunctionName, url: s.sourceURL, ms: s.duration, invoker: s.invoker })),
      });
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch {}
  let previousFrame = 0;
  const frame = () => {
    const now = performance.now();
    if (placementStart && now - placementStart < 30000) record('present-frame', { ms: now - previousFrame, sinceClick: now - placementStart, buildings: app.gameState?.buildings.size });
    previousFrame = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  setInterval(() => {
    if (!events.length) return;
    const body = JSON.stringify(events.splice(0));
    fetch('/__camp_probe', { method: 'POST', body }).catch(() => {});
  }, 1000);
  record('probe-installed');
  setTimeout(() => record('adapter', { evidence: app.sceneManager?.getRendererAdapterEvidence() }), 20000);
  const controls = document.createElement('div');
  controls.style.cssText = 'position:fixed;bottom:3px;left:3px;z-index:99999;display:flex;gap:4px';
  for (const [name, zoom] of [['Near camp', 220], ['Design camp', 110], ['Far camp', 37]]) {
    const button = document.createElement('button');
    button.textContent = name;
    button.onclick = () => {
      const camp = [...(app.gameState?.buildings.values() ?? [])].find(b => b.kind === 'founders_camp');
      if (camp) app.cameraController.focusWorldPositionAtZoom(camp.x, camp.z, zoom);
    };
    controls.append(button);
  }
  const noPost = document.createElement('button');
  noPost.textContent = 'Toggle post';
  let savedRender;
  noPost.onclick = () => {
    const manager = app.sceneManager;
    if (savedRender) { manager.postProcessor.render = savedRender; savedRender = null; }
    else { savedRender = manager.postProcessor.render; manager.postProcessor.render = () => manager.renderer.render(manager.scene, manager.camera); }
  };
  controls.append(noPost);
  installFireTransitionControls(app, controls, record, phase => { firePhase = phase; });
  document.body.append(controls);
}
