export type RendererInfoLike = {
  autoReset?: boolean;
  reset(): void;
  render: {
    calls?: number;
    drawCalls?: number;
    frame?: number;
    frameCalls?: number;
    triangles?: number;
  };
};

export type RendererFrameBoundary = {
  webGlFrame: number;
};

export type RendererFrameStats = {
  drawCalls: number;
  renderPasses: number;
  triangles: number;
};

export function configureRendererFrameStats(info: RendererInfoLike): void {
  info.autoReset = false;
}

export function beginRendererFrame(
  info: RendererInfoLike,
): RendererFrameBoundary {
  const webGlFrame = info.render.frame ?? 0;
  info.reset();
  return { webGlFrame };
}

export function readRendererFrameStats(
  info: RendererInfoLike,
  boundary: RendererFrameBoundary,
): RendererFrameStats {
  const render = info.render;
  return {
    drawCalls: render.drawCalls ?? render.calls ?? 0,
    renderPasses: render.frameCalls
      ?? Math.max(0, (render.frame ?? boundary.webGlFrame) - boundary.webGlFrame),
    triangles: render.triangles ?? 0,
  };
}
