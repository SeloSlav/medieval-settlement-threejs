/** Paired live-game diagnostic after the formal cohort; actor counts stay fixed. */
export async function measureCharacterDetailCosts(app) {
  const crowd = app.villagers.renderer, manager = app.sceneManager;
  const original = crowd.syncAgents;
  let fullDetail = false;
  crowd.syncAgents = function(agents, view, ...rest) {
    const savedHeight = view?.renderPixelHeight;
    if (view && fullDetail) view.renderPixelHeight = Infinity;
    try { return original.call(this, agents, view, ...rest); }
    finally { if (view) view.renderPixelHeight = savedHeight; }
  };
  const rows = [];
  try {
    for (const arm of ['distance-detail-before', 'original-full-detail', 'distance-detail-restored']) {
      fullDetail = arm === 'original-full-detail';
      for (let i = 0; i < 60; i++) await new Promise(requestAnimationFrame);
      const samples = []; let previous;
      for (let i = 0; i < 180; i++) {
        const time = await new Promise(requestAnimationFrame);
        if (previous !== undefined) samples.push(time - previous);
        previous = time;
      }
      samples.sort((a,b) => a-b);
      const diagnostic = crowd.authoredCrowdDiagnostics();
      rows.push({ arm, meanFrameMs: samples.reduce((sum,x) => sum+x,0)/samples.length,
        p95FrameMs: samples[Math.floor(samples.length*.95)],
        visibleAgents: diagnostic.visibleAgents, submittedInstances: diagnostic.submittedInstances,
        submittedBodyTriangles: diagnostic.detailBatches.reduce((sum,batch) => sum+batch.submittedTriangles,0),
        bodyBatches: diagnostic.detailBatches.map(batch => ({ count: batch.count, triangles: batch.submittedTriangles })),
        stats: manager.getPerformanceStats() });
    }
    return rows;
  } finally { crowd.syncAgents = original; }
}
