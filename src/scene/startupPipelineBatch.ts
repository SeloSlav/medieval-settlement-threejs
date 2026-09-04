type PipelineManager = {
  getForRender(object: unknown, promises?: Promise<unknown>[] | null): unknown;
};
export type StartupPipelineRenderer = { _pipelines: PipelineManager };

/**
 * Three 0.185 compileAsync awaits each GPU pipeline before building the next
 * material. Keep node/geometry/binding work sequential, but let up to eight
 * independent driver compilations overlap. All are drained before releasing
 * the renderer lease, including on failure. Never used during gameplay.
 */
export async function withStartupPipelineBatch(
  renderer: StartupPipelineRenderer,
  compile: () => Promise<void>,
  concurrency = 8,
): Promise<void> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Invalid startup pipeline concurrency');
  const manager = renderer._pipelines;
  const original = manager.getForRender;
  const pending = new Set<Promise<void>>();
  const failures: unknown[] = [];
  manager.getForRender = function (object, promises) {
    const result = original.call(this, object, promises);
    if (promises && promises.length > 0) {
      for (const promise of promises.splice(0)) {
        // Install rejection handlers immediately, not when the batch fills.
        const completion = Promise.resolve(promise)
          .then(() => undefined, error => { failures.push(error); })
          .finally(() => { pending.delete(completion); });
        pending.add(completion);
      }
      if (pending.size >= concurrency) promises.push(Promise.race(pending));
    }
    return result;
  };
  try {
    await compile();
  } finally {
    manager.getForRender = original;
    await Promise.all(pending);
  }
  if (failures.length > 0) throw new AggregateError(failures, 'Startup GPU pipeline compilation failed');
}
