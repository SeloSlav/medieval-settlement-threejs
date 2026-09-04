# Startup loading optimization

## Contract

Keep all live meshes, instance counts, texture sizes, material graphs, shadow
settings and render resolution. Keep the ten founders, camp preview and close
ground warmup covered until GPU preparation **and the clean replacement frame**
finish. Error recovery must not expose the warmup camp. Startup-only renderer
state must be restored even on failure; no asynchronous driver work may escape
the startup lease.

## Changes

- Decode sky/building/vineyard assets while vegetation is prepared; upload only
  after forest atlas baking relinquishes the renderer.
- Resolve forest LODs and shadow proxies before compiling the visible scene.
- Compile the live scene pass's exact HDR target, MRT, color state and nesting
  depth. Three 0.185's `compileAsync` otherwise uses depth zero, while the
  RenderPipeline scene pass renders at depth one and its shadows at depth two.
  `RenderObject` includes render-context identity in its shader cache key.
- Submit one visible-scene compile list. This does not force hidden woodland
  visible, and preserves the existing close-ground warmup visibility lease.
- Overlap up to eight independent GPU pipeline compilations. Node graph,
  geometry and binding preparation remain sequential. Drain the last partial
  batch and failures before restoring renderer state.
- Give the CSS spinner an explicit compositor layer; update progress with a
  transform and skip unchanged labels, percentage text and error-state writes.

The depth and pipeline batching shims are intentionally local to startup and
the installed Three 0.185 renderer. They use private renderer members because
the public compile API does not expose nested-pass depth or bounded pipeline
concurrency. Revalidate these tests and the cold-page trace on Three upgrades.

## Evidence and limitations

2026-09-05, Three 0.185.1, WebGPU, non-fallback NVIDIA Lovelace. Local isolated
database `close-ground-zoom-v1`, world seed 1297755661, forest seed 3356731464,
small Mrkopalj Polje, spring, unchanged normal game quality. These are fresh page
loads with persistent terrain/branch-card and browser asset caches available;
they are not first-install download measurements. Driver cache and host load
cause substantial wall-time variation.

The initial 737 × 792, DPR 1.5 baseline took 67.52 s. Its covered frame created
368 shader modules, blocked JavaScript for 10.29 s, then waited 14.71 s for the
GPU queue. The optimized run at the same viewport took 32.87 s; GPU preparation
was 11.19 s. Its covered frame created **zero shader modules**, submitted in
135.6 ms and waited 122.9 ms. It still created 52 inexpensive pipeline variants,
so do not describe the whole covered frame as allocation-free.

A subsequent read-only replay/current pair at 1280 × 720, DPR 1.5 measured:

| Stage | Baseline | Optimized |
| --- | ---: | ---: |
| First playable | 39.10 s | 24.65 s |
| GPU preparation including covered/clean frames | 25.36 s | 7.74 s |
| Covered frame CPU submission | 6.12 s | 102.5 ms |
| New shader modules in covered frame | 322 | 0 |

That pair is about 37% faster overall. All readiness flags were true, both
covered submissions completed, and all ten founder rigs were prepared. The
final and ungraded-lighting views were inspected; the world was lit, the
terrain/forest remained visible, and no warmup camp leaked into presentation.
The near/detail woodland view was also inspected after the zoom sweep. Weather
and wind were not frozen, so these are qualitative visual checks, not exact
pixel-difference acceptance.

After the timed runs, the camp preview and actual camp were placed through the
game UI in the isolated world; the settlement and all ten founders appeared.
This was a functional placement check, not a separately instrumented latency
benchmark. The test database now contains that camp; use a fresh isolated world
with no camp when reproducing the founding-party startup timings.

The 190 → 230 → 190 → 230 → 650 percent regression uses the fixed woodland/pond
focus (170.1, -45.36), 180 frames per view. The first 200% crossing created zero
shader modules and zero pipelines. All twelve full-close grass/flower instance
and geometry counts matched the previous close-ground regression. First-cross
maximum frame gap was 129.5 ms (repeat 109.7 ms); this is not a locked-60-FPS
claim. A moved camera at 190% revealed other water/mushroom variants outside the
close-ground threshold contract. GPU evidence uses actual queue-bracketing
timestamp queries, not CPU timing as a GPU proxy.

The CSS-only stress fixture schedules an eight-second main-thread block using
the real loader markup. Browser screenshot capture waited for the block to
finish, so this tool cannot certify continuous displayed animation through
that interval. The spinner is compositor eligible and independent of JS frame
callbacks, but a GPU/driver/compositor stall can still pause presentation.
Other startup CPU tasks (including asset processing and founding-party setup)
still produce long tasks; this change does not claim to eliminate every one.

## Reproduce

Run the isolated server with `--startup-baseline` for a read-only replay of the
pre-change startup files at commit `77710933`, or `--startup` for the current
implementation. Close the test tab before restarting the server. Use the same
viewport and world for both; never reset the user's normal game database.

`node scripts/analyzeStartupLoading.mjs` reports stage timing, shader/pipeline
counts and long tasks. `node scripts/analyzeCloseGroundZoom.mjs` reports the
zoom regression. The optional `?spinnerTest` URL runs only the loader stress
fixture; it does not enter or mutate the game world.

Tests cover exact compile state and nesting, success/failure restoration,
bounded driver concurrency, final partial-batch draining, rejected pipelines,
coalesced DOM updates, monotonic percentages, retry preservation and both
covered GPU completion barriers. Existing camp and close-ground tests retain
their original assertions.

Passing: `test:startup-loading`, `test:starter-camp`, `test:close-ground-prewarm`,
TypeScript and production build. The loading changes also retain the existing
connection recovery tests. No graphics budget or test ceiling was relaxed.
