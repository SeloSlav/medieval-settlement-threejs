/** Diagnostic only; run after the frame-time cohort, never during it. */
export function beginGpuPassCosts(renderer) {
  const backend = renderer.backend;
  if (!backend.device.features.has('timestamp-query')) throw Error('Pass timestamps unavailable');
  const labels = new Map(), costs = new Map();
  const device = backend.device, createEncoder = device.createCommandEncoder;
  const computeReads = [];
  device.createCommandEncoder = function(descriptor) {
    const encoder = createEncoder.call(this,descriptor);
    if (descriptor?.label !== 'Authored animation before body/shadow submission') return encoder;
    const querySet = device.createQuerySet({ type: 'timestamp', count: 2 });
    const resolveBuffer = device.createBuffer({ size: 256, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    const readback = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const beginCompute = encoder.beginComputePass, finish = encoder.finish;
    let workgroups = 0;
    encoder.beginComputePass = function(options) {
      const pass = beginCompute.call(this,{ ...options,timestampWrites: {
        querySet,beginningOfPassWriteIndex: 0,endOfPassWriteIndex: 1,
      } });
      const dispatch = pass.dispatchWorkgroups;
      pass.dispatchWorkgroups = function(x,...args) { workgroups += x; return dispatch.call(this,x,...args); };
      return pass;
    };
    encoder.finish = function(options) {
      this.resolveQuerySet(querySet,0,2,resolveBuffer,0);
      this.copyBufferToBuffer(resolveBuffer,0,readback,0,16);
      const command = finish.call(this,options);
      computeReads.push({ querySet,resolveBuffer,readback,workgroups });
      return command;
    };
    return encoder;
  };
  const begin = backend.beginRender, previousTracking = backend.trackTimestamp;
  backend.beginRender = function(context) {
    const uid = this.getTimestampUID(context);
    labels.set(uid, `context ${context.id}: ${context.textures?.map(t => t.name || t.uuid).join(',') || 'canvas'} (${context.width}x${context.height})`);
    return begin.call(this, context);
  };
  backend.trackTimestamp = true;
  let pending = null;
  const collect = async () => {
    if (pending) return pending;
    const reads = computeReads.splice(0);
    pending = Promise.all([
      ...['render','compute'].map(type => renderer.resolveTimestampsAsync(type)),
      ...reads.map(async ({querySet,resolveBuffer,readback,workgroups}) => {
        try {
          await readback.mapAsync(GPUMapMode.READ);
          const values = new BigUint64Array(readback.getMappedRange());
          const ms = Number(values[1]-values[0])/1e6;
          const name = `authored animation compute (${workgroups} workgroups)`;
          let cost = costs.get(name);
          if (!cost) costs.set(name,cost = { name,ms: 0,calls: 0,maxMs: 0 });
          cost.ms += ms; cost.calls++; cost.maxMs = Math.max(cost.maxMs,ms);
          readback.unmap();
        } finally { readback.destroy(); resolveBuffer.destroy(); querySet.destroy(); }
      }),
    ]).then(() => {
      for (const [type, pool] of Object.entries(backend.timestampQueryPool)) {
        if (!pool) continue;
        for (const [uid, ms] of pool.timestamps) {
          const name = labels.get(uid) || `${type} ${uid.replace(/:f\d+$/, '')}`;
          let cost = costs.get(name);
          if (!cost) costs.set(name,cost = { name, ms: 0, calls: 0, maxMs: 0 });
          cost.ms += ms; cost.calls++; cost.maxMs = Math.max(cost.maxMs,ms);
          labels.delete(uid);
        }
        pool.timestamps.clear();
      }
    }).finally(() => { pending = null; });
    return pending;
  };
  const timer = setInterval(() => { void collect(); },250);
  return async () => {
    clearInterval(timer);
    try {
      if (pending) await pending;
      await collect();
      return [...costs.values()].map(c => ({ ...c,meanMs: c.ms/c.calls })).sort((a,b) => b.ms-a.ms);
    } finally {
      backend.trackTimestamp = previousTracking; backend.beginRender = begin;
      device.createCommandEncoder = createEncoder;
    }
  };
}
