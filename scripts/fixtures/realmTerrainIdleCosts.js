/** Isolated diagnostic after the frame cohort; the source stays unchanged here. */
export function measureRealmTerrainIdle(stream, x, z) {
  if (stream.stream.stats.loading || stream.stream.stats.queued) throw Error('Terrain probe requires settled residency');
  for (let i = 0; i < 100 && stream.pendingRefreshes.size; i++) stream.update(x, z, false);
  if (stream.pendingRefreshes.size) throw Error('Terrain edits did not settle');
  let referenceVisits = 0;
  const oldIdleScan = () => {
    const start = performance.now();
    stream.synchronizeSource();
    for (const [id, tile] of stream.attached) {
      if (performance.now() - start >= 2) break;
      stream.refreshTile(id, tile); referenceVisits++;
    }
    stream.stream.pump(Math.max(0, 2 - (performance.now() - start)));
  };
  const optimized = () => stream.update(x, z, false);
  const arms = [];
  for (let cycle = 0; cycle < 6; cycle++) {
    const cached = cycle % 2 === 1, run = cached ? optimized : oldIdleScan;
    for (let i = 0; i < 100; i++) run();
    const before = stream.stats.tileChecks, visits = referenceVisits, samples = 1000;
    const start = performance.now();
    for (let i = 0; i < samples; i++) run();
    arms.push({ cycle, cached, samples, totalMs: performance.now() - start,
      tileVisits: stream.stats.tileChecks - before, referenceVisits: referenceVisits - visits });
  }
  return { resident: stream.stream.stats.resident, pendingRefreshes: stream.stats.pendingRefreshes, arms };
}
