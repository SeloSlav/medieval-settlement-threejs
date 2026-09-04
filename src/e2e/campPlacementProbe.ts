// @ts-nocheck -- Temporary runtime probe; removed after the production-path diagnosis.
import { BuildingTool } from '../buildings/BuildingTool.ts';
import { BuildingMarkers } from '../buildings/BuildingMarkers.ts';
import { SceneManager } from '../scene/SceneManager.ts';
import { SettlementCrowdRenderer } from '../settlement/SettlementCrowdRenderer.ts';
import { VillagerRenderer } from '../settlement/VillagerRenderer.ts';
import { CampStandardRenderer } from '../settlement/CampStandardRenderer.ts';
import { WebGPURenderer } from 'three/webgpu';

export function installCampPlacementProbe(app) {
  const events = [];
  let placementStart = 0;
  const record = (name, details = {}) => {
    events.push({ t: Math.round(performance.now() * 100) / 100, name, ...details });
  };
  const wrap = (target, key, prefix) => {
    const original = target?.[key];
    if (typeof original !== 'function' || original.__campProbe) return;
    const fn = function (...args) {
      const start = performance.now();
      try {
        const value = original.apply(this, args);
        if (value?.then && /prewarm|prepare|compile|start|placeAt/i.test(key)) {
          value.then(() => record(`${prefix}.${key}:resolved`, { ms: performance.now() - start }), () => {});
        }
        return value;
      } finally {
        const ms = performance.now() - start;
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
    if (e.target?.tagName === 'CANVAS' && app.buildingTool?.getMode() === 'founders_camp') placementStart = performance.now();
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
}
