import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { withScenePassCompileState, type CompileStateRenderer } from '../src/scene/scenePassCompileState.ts';
import { LoadingScreen } from '../src/ui/LoadingScreen.ts';
import { withStartupPipelineBatch, type StartupPipelineRenderer } from '../src/scene/startupPipelineBatch.ts';

const savedTarget = new THREE.RenderTarget(4, 4);
const sceneTarget = new THREE.RenderTarget(8, 8, { count: 3 });
const savedMrt = {};
const sceneMrt = {};
let target: THREE.RenderTarget | null = savedTarget;
let mrt: unknown = savedMrt;
const getContext = (_target?: THREE.RenderTarget | null, _mrt?: unknown, depth = 0) => depth;
const renderer: CompileStateRenderer = {
  getRenderTarget: () => target, setRenderTarget: value => { target = value; },
  getMRT: () => mrt, setMRT: value => { mrt = value; },
  toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace,
  _callDepth: -1, _renderContexts: { get: getContext },
};
const pass = { renderTarget: sceneTarget, getMRT: () => sceneMrt };
const assertRestored = () => {
  assert.equal(target, savedTarget);
  assert.equal(mrt, savedMrt);
  assert.equal(renderer.toneMapping, THREE.ACESFilmicToneMapping);
  assert.equal(renderer.outputColorSpace, THREE.SRGBColorSpace);
  assert.equal(renderer._callDepth, -1);
  assert.equal(renderer._renderContexts.get, getContext);
};
await withScenePassCompileState(renderer, pass, async () => {
  assert.equal(target, sceneTarget);
  assert.equal(mrt, sceneMrt);
  assert.equal(renderer.toneMapping, THREE.NoToneMapping);
  assert.equal(renderer.outputColorSpace, THREE.ColorManagement.workingColorSpace);
  assert.equal(renderer._renderContexts.get(sceneTarget, sceneMrt), 1);
  assert.equal(renderer._renderContexts.get(savedTarget, null), 0);
  assert.equal(renderer._renderContexts.get(sceneTarget, sceneMrt, 2), 2);
  assert.equal(renderer._callDepth + 1, 2, 'nested shadow render uses its live depth');
  await Promise.resolve();
  assert.equal(target, sceneTarget, 'state lease spans async compilation');
});
assertRestored();
await assert.rejects(withScenePassCompileState(renderer, pass, async () => { throw Error('compile failed'); }), /compile failed/);
assertRestored();
renderer._callDepth = 0;
await assert.rejects(withScenePassCompileState(renderer, pass, async () => {}), /idle renderer/);
renderer._callDepth = -1;
assertRestored();
savedTarget.dispose();
sceneTarget.dispose();

let inFlight = 0;
let maxInFlight = 0;
let completed = 0;
const pipelines: StartupPipelineRenderer = { _pipelines: {
  getForRender: (_object, promises) => {
    if (!promises) return 'sync';
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    promises.push(new Promise<void>(resolve => setTimeout(() => {
      completed++; inFlight--; resolve();
    }, 1)));
    return 'pipeline';
  },
} };
const originalPipeline = pipelines._pipelines.getForRender;
await withStartupPipelineBatch(pipelines, async () => {
  for (let i = 0; i < 21; i++) {
    const promises: Promise<unknown>[] = [];
    assert.equal(pipelines._pipelines.getForRender({}, promises), 'pipeline');
    if (promises.length) await Promise.all(promises);
  }
}, 4);
assert.equal(maxInFlight, 4, 'GPU work overlaps, but stays bounded');
assert.equal(completed, 21, 'the final partial batch is drained');
assert.equal(pipelines._pipelines.getForRender, originalPipeline);
await assert.rejects(withStartupPipelineBatch(pipelines, async () => {
  pipelines._pipelines.getForRender({}, []);
  throw Error('node failure');
}), /node failure/);
assert.equal(inFlight, 0, 'early failure cannot release the renderer with pending work');
assert.equal(pipelines._pipelines.getForRender, originalPipeline);
pipelines._pipelines.getForRender = (_object, promises) => promises?.push(Promise.reject(Error('driver failure')));
await assert.rejects(withStartupPipelineBatch(pipelines, async () => {
  pipelines._pipelines.getForRender({}, []);
  await new Promise(resolve => setTimeout(resolve, 1));
}), /Startup GPU pipeline compilation failed/);

class ElementStub {
  writes = 0;
  private text = '';
  hidden = false;
  attributes = new Map<string, string>();
  styles = new Map<string, string>();
  classes = new Set<string>();
  get textContent() { return this.text; }
  set textContent(value: string) { this.text = value; this.writes++; }
  classList = {
    add: (key: string) => { this.classes.add(key); this.writes++; },
    remove: (key: string) => { this.classes.delete(key); this.writes++; },
  };
  style = { setProperty: (key: string, value: string) => { this.styles.set(key, value); this.writes++; } };
  setAttribute(key: string, value: string) { this.attributes.set(key, value); this.writes++; }
  addEventListener() {}
  remove() {}
  querySelector(selector: string) { return elements.get(selector) ?? null; }
}
const selectors = ['[data-loading-percent]', '[data-loading-label]', '[data-loading-detail]',
  '[data-loading-bar]', '[data-loading-retry]', '[data-loading-recovery-hint]',
  '[data-loading-recovery]', '.app-loading-spinner'];
const elements = new Map(selectors.map(selector => [selector, new ElementStub()]));
const root = new ElementStub();
const savedDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: () => root } });
Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout: () => 0 } });
try {
  const loading = new LoadingScreen();
  loading.setProgress({ label: 'Loading', detail: 'Textures', percent: 50 });
  const writes = () => [...elements.values(), root].reduce((sum, el) => sum + el.writes, 0);
  const once = writes();
  loading.setProgress({ label: 'Loading', detail: 'Textures', percent: 50 });
  assert.equal(writes(), once, 'identical progress must not mutate the DOM');
  loading.setProgress({ label: 'Loading', detail: 'Textures', percent: 25 });
  assert.equal(writes(), once, 'late progress never rewinds or repaints the bar');
  assert.equal(elements.get('[data-loading-bar]')!.styles.get('--loading-progress'), '0.5');
  loading.setErrorState({ label: 'Connection lost', recoveryHint: 'Try again' }, () => {});
  const errorWrites = writes();
  loading.setProgress({ label: 'Done', percent: 100 });
  loading.dismiss();
  assert.equal(writes(), errorWrites, 'late hydration cannot erase Retry or dismiss an error');
  loading.clearErrorState();
  assert.equal(elements.get('[data-loading-retry]')!.hidden, true);
  assert.equal(elements.get('.app-loading-spinner')!.classes.has('is-hidden'), false);
  loading.setProgress({ label: 'Ready', percent: 100 });
  loading.dismiss();
  assert.equal(root.classes.has('is-dismissed'), true);
  assert.equal(elements.get('[data-loading-bar]')!.attributes.get('aria-valuenow'), '100');
} finally {
  if (savedDocument) Object.defineProperty(globalThis, 'document', savedDocument);
  else Reflect.deleteProperty(globalThis, 'document');
  if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow);
  else Reflect.deleteProperty(globalThis, 'window');
}
const html = readFileSync('index.html', 'utf8');
assert.match(html, /\.app-loading-spinner\s*\{[^}]*will-change: transform;[^}]*animation: app-loading-spin/);
assert.match(html, /\.app-loading-progress__fill\s*\{[^}]*transition: transform/);
const app = readFileSync('src/app/App.ts', 'utf8');
assert.ok(app.indexOf('const firstPlayableAssetResultsPromise') < app.indexOf('await session.sceneManager.finishVegetation()'));
assert.ok(app.indexOf('const textureUploadStartedAt') > app.indexOf('await session.sceneManager.finishVegetation()'));
assert.equal(app.match(/waitForFirstPlayableGpuWork\(\)/g)?.length, 2);
console.log('Startup loading: exact pass/depth cache state, failure restoration, coalesced progress and recovery passed.');
