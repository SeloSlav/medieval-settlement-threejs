import assert from 'node:assert/strict';
import {
  beginRendererFrame,
  configureRendererFrameStats,
  readRendererFrameStats,
  type RendererInfoLike,
} from '../src/scene/rendererFrameStats.ts';

const webGlInfo: RendererInfoLike = {
  autoReset: true,
  render: { calls: 99, frame: 40, triangles: 999 },
  reset() {
    this.render.calls = 0;
    this.render.triangles = 0;
  },
};
configureRendererFrameStats(webGlInfo);
const webGlBoundary = beginRendererFrame(webGlInfo);
assert.equal(webGlInfo.autoReset, false, 'composer passes must not auto-reset counters');
const renderWebGlPass = (drawCalls: number, triangles: number): void => {
  if (webGlInfo.autoReset) webGlInfo.reset();
  webGlInfo.render.frame = (webGlInfo.render.frame ?? 0) + 1;
  webGlInfo.render.calls = (webGlInfo.render.calls ?? 0) + drawCalls;
  webGlInfo.render.triangles = (webGlInfo.render.triangles ?? 0) + triangles;
};
renderWebGlPass(11, 1_200);
renderWebGlPass(3, 6);
assert.deepEqual(
  readRendererFrameStats(webGlInfo, webGlBoundary),
  { drawCalls: 14, renderPasses: 2, triangles: 1_206 },
  'two WebGL composer renders must accumulate both passes',
);

const webGpuInfo: RendererInfoLike = {
  autoReset: true,
  render: { drawCalls: 90, frameCalls: 9, triangles: 900 },
  reset() {
    this.render.drawCalls = 0;
    this.render.frameCalls = 0;
    this.render.triangles = 0;
  },
};
configureRendererFrameStats(webGpuInfo);
const webGpuBoundary = beginRendererFrame(webGpuInfo);
webGpuInfo.render.drawCalls = 17;
webGpuInfo.render.frameCalls = 3;
webGpuInfo.render.triangles = 2_400;
assert.deepEqual(
  readRendererFrameStats(webGpuInfo, webGpuBoundary),
  { drawCalls: 17, renderPasses: 3, triangles: 2_400 },
  'WebGPU draw and render-pass counters must stay distinct',
);

console.log('renderer frame-stat accumulation tests passed');
