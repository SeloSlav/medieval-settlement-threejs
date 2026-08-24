import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const postSource = readFileSync(`${root}/src/scene/PostProcessing.ts`, 'utf8');
const stockBloomSource = readFileSync(
  `${root}/node_modules/three/examples/jsm/tsl/display/BloomNode.js`,
  'utf8',
);

assert.match(postSource, /WEBGPU_BLOOM_FULLSCREEN_PASS_COUNT = 12/);
assert.match(
  postSource,
  /WEBGPU_POST_FULLSCREEN_PASS_COUNT = WEBGPU_BLOOM_FULLSCREEN_PASS_COUNT \+ 1/,
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
  /this\.illustratedMapPipeline\.render\(\)/,
  'the WebGPU paper map should render through its pipeline instead of a direct submission',
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

console.log('Post-processing pipeline parity and pass-budget tests passed.');
