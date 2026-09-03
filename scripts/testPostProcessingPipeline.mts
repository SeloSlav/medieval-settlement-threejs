import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const postSource = readFileSync(`${root}/src/scene/PostProcessing.ts`, 'utf8');
const appSource = readFileSync(`${root}/src/app/App.ts`, 'utf8');
const rendererBackendSource = readFileSync(`${root}/src/scene/RendererBackend.ts`, 'utf8');
const stockBloomSource = readFileSync(
  `${root}/node_modules/three/examples/jsm/tsl/display/BloomNode.js`,
  'utf8',
);

assert.match(postSource, /WEBGPU_BLOOM_FULLSCREEN_PASS_COUNT = 12/);
assert.match(
  postSource,
  /WEBGPU_POST_FULLSCREEN_PASS_COUNT = WEBGPU_BLOOM_FULLSCREEN_PASS_COUNT \+ 2/,
);
assert.match(postSource, /class StableSizeBloomNode extends BloomNode/);
assert.match(postSource, /if \(width === this\.width && height === this\.height\) return/);
assert.match(postSource, /super\.setSize\(width, height\)/);
assert.match(
  postSource,
  /this\.illustratedMapPipeline = new RenderPipeline\(renderer\)/,
  'the WebGPU paper map should own a pipeline on the same submission path as the world',
);
assert.match(
  postSource,
  /this\.renderPipelineToCanvas\(this\.illustratedMapPipeline\)/,
  'the WebGPU paper map should render through its pipeline instead of a direct submission',
);
assert.match(
  postSource,
  /private renderPipelineToCanvas\(pipeline: RenderPipeline\): void \{[\s\S]*?resetWebGPUCanvasTarget\(this\.renderer\);[\s\S]*?pipeline\.render\(\);/,
  'every top-level WebGPU pipeline must explicitly reclaim the canvas target and clear MRT state',
);
assert.match(
  rendererBackendSource,
  /export function resetWebGPUCanvasTarget\(renderer: WebGPURenderer\): void \{[\s\S]*?setRenderTarget\(null\);[\s\S]*?setOutputRenderTarget\(null\);[\s\S]*?setMRT\(null\);/,
  'the WebGPU canvas-target guard must clear render-target, output-target, and MRT ownership',
);
assert.match(
  rendererBackendSource,
  /waitForStartup: \(promise\) => promise/,
  'native WebGPU startup must await non-cancellable adapter and renderer initialization work',
);
assert.doesNotMatch(
  rendererBackendSource,
  /WEBGPU_STARTUP_TIMEOUT_MS|function withTimeout/,
  'native WebGPU startup must not race initialization against a non-cancelling timeout',
);
assert.match(
  rendererBackendSource,
  /function createNativeWebGPURenderer\([\s\S]*?new WebGPURenderer\(options\)[\s\S]*?_getFallback = null/,
  'production renderer construction must disable Three r185\'s internal WebGL2 fallback',
);
assert.equal(
  (postSource.match(/this\.renderPipelineToCanvas\(/g) ?? []).length,
  2,
  'both world and illustrated-map owners must submit through the canvas-target guard',
);
assert.doesNotMatch(
  postSource,
  /override (setup|updateBefore)/,
  'the optimized node must retain Three\'s exact stock render and shader paths',
);

assert.match(stockBloomSource, /new RenderTarget\( 1, 1, \{ depthBuffer: false, type: HalfFloatType \} \)/);
assert.match(stockBloomSource, /Bloom \[ High Pass \]/);
assert.match(stockBloomSource, /Bloom \[ Blur Horizontal - \$\{ i \} \]/);
assert.match(stockBloomSource, /Bloom \[ Blur Vertical - \$\{ i \} \]/);
assert.match(stockBloomSource, /Bloom \[ Composite \]/);
assert.equal(
  (stockBloomSource.match(/_quadMesh\.render\( renderer \)/g) ?? []).length,
  4,
  'stock source must retain high-pass, looped horizontal/vertical blur, and composite calls',
);
assert.match(stockBloomSource, /this\.setSize\( size\.width, size\.height \)/);

assert.doesNotMatch(
  postSource,
  /InlineCompositeBloomNode|_textureNodeBlur[0-4]|RendererUtils|QuadMesh/,
  'no quantization-changing bloom-composite fusion may remain',
);

assert.match(
  appSource,
  /setRendererAnimationLoop\(session\.sceneManager\.renderer, this\.tick\)/,
  'the renderer must own the production callback so WebGPU passes and visible submission share a frame lifecycle',
);
assert.match(
  appSource,
  /setRendererAnimationLoop\(this\.sceneManager\.renderer, null\)/,
  'disposing the app must release renderer animation-loop ownership',
);
assert.doesNotMatch(
  appSource,
  /requestAnimationFrame\(this\.tick\)/,
  'production rendering must not create a second animation scheduler beside Three\'s WebGPU lifecycle',
);

console.log('Post-processing pipeline parity and pass-budget tests passed.');
