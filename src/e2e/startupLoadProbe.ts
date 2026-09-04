// @ts-nocheck -- Local opt-in diagnostics; never imported by the shipping entry.
import { SceneManager } from '../scene/SceneManager.ts';
import { LoadingScreen } from '../ui/LoadingScreen.ts';

export function installStartupLoadProbe(app, variant = 'unlabeled') {
  const events = [];
  let active = true;
  let stage = 'bootstrap';
  const counters = {};
  const record = (name, details = {}) => events.push({ t: performance.now(), name, ...details });
  const flush = () => {
    if (events.length) void fetch('/__camp_probe', {
      method: 'POST', body: JSON.stringify(events.splice(0)),
    }).catch(() => {});
  };
  const interval = setInterval(flush, 1000);
  const wrap = (owner, key, make) => {
    const original = owner[key];
    owner[key] = make(original);
  };
  for (const key of ['createShaderModule', 'createRenderPipeline', 'createRenderPipelineAsync']) {
    wrap(GPUDevice.prototype, key, original => function (...args) {
      if (active) counters[key] = (counters[key] ?? 0) + 1;
      return original.apply(this, args);
    });
  }
  const observer = new PerformanceObserver(list => {
    if (!active) return;
    for (const entry of list.getEntries()) record('startup-long-task', {
      start: entry.startTime, duration: entry.duration, stage,
    });
  });
  observer.observe({ type: 'longtask', buffered: true });
  wrap(LoadingScreen.prototype, 'setProgress', original => function (progress) {
    const next = `${progress.label}: ${progress.detail ?? ''}`;
    if (stage !== next) { stage = next; record('startup-progress', { stage }); }
    return original.call(this, progress);
  });
  for (const key of ['finishVegetation', 'precompileFirstPlayableObjects', 'waitForFirstPlayableGpuWork']) {
    wrap(SceneManager.prototype, key, original => async function (...args) {
      const start = performance.now();
      const before = { ...counters };
      record('startup-stage-start', { key });
      try { return await original.apply(this, args); }
      finally { record('startup-stage-end', { key, duration: performance.now() - start,
        resources: Object.fromEntries(Object.entries(counters).map(([k, v]) => [k, v - (before[k] ?? 0)])) }); }
    });
  }
  let rendererWrapped = false;
  wrap(SceneManager.prototype, 'render', original => function (...args) {
    if (!active) return original.apply(this, args);
    if (!rendererWrapped) {
      rendererWrapped = true;
      // Only log newly constructed render objects, not each draw call.
      wrap(this.renderer._objects, 'createRenderObject', create => function (...a) {
        const result = create.apply(this, a);
        if (active) record('startup-render-object', {
          object: a[3]?.name || a[3]?.type, material: a[4]?.name || a[4]?.type,
          target: result.context?.textures?.map(t => t.name),
        });
        return result;
      });
      wrap(this.renderer, 'compileAsync', compile => async function (object, ...rest) {
        const start = performance.now();
        const before = { ...counters };
        try { return await compile.call(this, object, ...rest); }
        finally { record('startup-compile', { object: object.name || object.type,
          duration: performance.now() - start,
          resources: Object.fromEntries(Object.entries(counters).map(([k, v]) => [k, v - (before[k] ?? 0)])) }); }
      });
    }
    const start = performance.now();
    const before = { ...counters };
    try { return original.apply(this, args); }
    finally { record('startup-render', { duration: performance.now() - start,
      resources: Object.fromEntries(Object.entries(counters).map(([k, v]) => [k, v - (before[k] ?? 0)])) }); }
  });
  wrap(LoadingScreen.prototype, 'dismiss', original => function (...args) {
    record('startup-ready', { variant, startup: window.__medievalRoadStartup,
      viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
      adapter: app.sceneManager?.getRendererAdapterEvidence(), resources: counters });
    const result = original.apply(this, args);
    active = false;
    observer.disconnect();
    // Leave GPU wrappers in place until navigation: the zoom probe wraps them.
    clearInterval(interval);
    flush();
    return result;
  });
  record('startup-probe-installed', { variant });
  const diagnostic = document.createElement('button');
  diagnostic.textContent = 'Inspect ungraded lighting';
  diagnostic.style.cssText = 'position:fixed;right:3px;bottom:3px;z-index:99999';
  let lighting = false;
  diagnostic.onclick = () => {
    if (!app.sceneManager) return;
    lighting = !lighting;
    app.sceneManager.setLightingDiagnostic(lighting ? 'lighting' : 'final');
    diagnostic.textContent = lighting ? 'Restore final image' : 'Inspect ungraded lighting';
  };
  document.body.append(diagnostic);
}

/** Isolate compositor animation from GPU work using the real loader markup. */
export function startLoadingSpinnerTest() {
  const loading = new LoadingScreen();
  loading.setProgress({ label: 'Spinner stress test', detail: 'Ready for an eight-second main-thread block', percent: 55 });
  const button = document.createElement('button');
  button.textContent = 'Block main thread for eight seconds';
  button.style.cssText = 'position:fixed;top:8px;left:8px;z-index:99999';
  document.body.append(button);
  button.onclick = () => {
    button.disabled = true;
    loading.setProgress({ label: 'Spinner stress test', detail: 'CPU block begins in two seconds', percent: 55 });
    setTimeout(() => {
      const startedAt = performance.now();
      while (performance.now() - startedAt < 8000) { /* Deliberate isolated diagnostic. */ }
      loading.setProgress({ label: 'Spinner stress test', detail: 'CPU block complete', percent: 55 });
      button.disabled = false;
    }, 2000);
  };
  return Promise.resolve();
}
