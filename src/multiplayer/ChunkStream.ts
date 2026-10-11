export type ChunkResource = { dispose(): void };
export type ChunkStreamStats = {
  resident: number; cached: number; queued: number; loading: number;
  hits: number; misses: number; evictions: number; failures: number;
};

/** Bounded loading with LRU retention. GPU attachment occurs only inside pump(). */
export class ChunkStream<T extends ChunkResource> {
  private desired = new Set<number>();
  private resident = new Map<number, T>();
  private cache = new Map<number, T>();
  private queue: number[] = [];
  private loading = new Map<number, AbortController>();
  private disposed = false;
  private counters = { hits: 0, misses: 0, evictions: 0, failures: 0 };
  private readonly options: {
    capacity: number; cacheCapacity: number; concurrency: number;
    load: (id: number, signal: AbortSignal) => Promise<T>;
    attach: (id: number, chunk: T) => void;
    detach: (id: number, chunk: T) => void;
    onError?: (id: number, error: unknown) => void;
  };
  constructor(options: ChunkStream<T>['options']) {
    this.options = options;
    if (options.capacity < 1 || options.cacheCapacity < 0 || options.concurrency < 1) {
      throw new RangeError('Invalid chunk stream limits');
    }
  }
  /** Nearest first. Camera teleports cancel requests that left interest. */
  setInterest(ids: Iterable<number>): void {
    if (this.disposed) return;
    this.desired = new Set([...new Set(ids)].slice(0, this.options.capacity));
    for (const [id, controller] of this.loading) if (!this.desired.has(id)) controller.abort();
    for (const [id, chunk] of this.resident) {
      if (this.desired.has(id)) continue;
      this.options.detach(id, chunk);
      this.resident.delete(id);
      this.retain(id, chunk);
    }
    this.queue = [...this.desired].filter(id => !this.resident.has(id) && !this.loading.has(id));
  }
  /** budgetMs is a CPU scheduling budget, not an assertion about GPU frame time. */
  pump(budgetMs: number, now: () => number = () => performance.now()): void {
    if (this.disposed || budgetMs <= 0) return;
    const deadline = now() + budgetMs;
    while (this.queue.length && now() < deadline) {
      const id = this.queue[0];
      const cached = this.cache.get(id);
      if (cached) {
        this.queue.shift(); this.cache.delete(id); this.resident.set(id, cached);
        this.options.attach(id, cached); this.counters.hits++;
        continue;
      }
      if (this.loading.size >= this.options.concurrency) break;
      this.queue.shift();
      const controller = new AbortController();
      this.loading.set(id, controller); this.counters.misses++;
      void Promise.resolve().then(() => this.options.load(id, controller.signal)).then(chunk => {
        if (this.disposed || controller.signal.aborted) chunk.dispose();
        else this.retain(id, chunk);
      }).catch(error => {
        if (!controller.signal.aborted) { this.counters.failures++; this.options.onError?.(id, error); }
      }).finally(() => {
        this.loading.delete(id);
        if (!this.disposed && this.desired.has(id) && !this.resident.has(id)
          && (this.cache.has(id) || controller.signal.aborted) && !this.queue.includes(id)) this.queue.unshift(id);
      });
    }
  }
  get stats(): ChunkStreamStats {
    return { resident: this.resident.size, cached: this.cache.size, queued: this.queue.length,
      loading: this.loading.size, ...this.counters };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const controller of this.loading.values()) controller.abort();
    for (const [id, chunk] of this.resident) { this.options.detach(id, chunk); chunk.dispose(); }
    for (const chunk of this.cache.values()) chunk.dispose();
    this.resident.clear(); this.cache.clear(); this.queue = []; this.desired.clear();
  }
  private retain(id: number, chunk: T): void {
    this.cache.get(id)?.dispose(); this.cache.delete(id); this.cache.set(id, chunk);
    while (this.cache.size + this.resident.size > this.options.cacheCapacity + this.options.capacity) {
      const oldest = this.cache.keys().next().value!;
      this.cache.get(oldest)!.dispose(); this.cache.delete(oldest); this.counters.evictions++;
    }
  }
}
