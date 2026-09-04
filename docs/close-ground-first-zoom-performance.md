# First close-ground zoom residency

## Contract

Crossing 200% zoom must not synchronously compile the newly visible vegetation.
Preserve every authored grass/flower instance, mesh, texture, wind/season shader,
LOD distance, opacity curve, shadow policy and streaming budget. Startup-only
visibility must be restored before the loading screen fades. No camera movement
or temporary meadow may leak into the first playable frame.

## Cause and implementation

The terrain dirt blend already updates an existing shader's attribute. Grass
generation already has a 2 ms incremental budget. The cold boundary instead
revealed previously hidden grass, both wildflower geometry LODs, cattails,
dogwood, juniper, bilberry, ferns, ivy, nettles and twigs, plus shrub shadow
proxies. Allocating these meshes during vegetation loading did not put them in
Three's render list.

`CloseGroundGpuPrewarm` temporarily exposes those exact live roots, with one
instance per instanced mesh. The existing targeted `compileAsync` and covered
post/shadow submission upload their full backing buffers and prepare their live
pipelines. This is not a reduced gameplay instance budget. Mesh identities,
geometry, material settings, layers and instance arrays are never replaced or
rewritten. Only visibility, culling and submitted count are temporarily changed.

The normal camera-driven grass/reed/forest-floor updates are suspended for this
short startup lease. Tree camera updates continue normally. The existing
idempotent `finally` restoration and clean replacement submission run before
the loader fades. The complete woodland is deliberately not precompiled.

Tradeoff: the first-use GPU work now happens during loading. This change does
not reduce steady-state vegetation cost or promise that unrelated first-use
effects elsewhere in the world cannot hitch.

## Browser evidence

2026-09-04, Three 0.185.1, WebGPU, non-fallback NVIDIA Lovelace adapter, viewport
737 × 792, DPR 1.5, renderer pixel ratio 1. Isolated local test database
`close-ground-zoom-v1`, small Mrkopaljsko Polje, world seed `0x4d5a2e0d`, forest
seed 3356731464, normal gameplay settings, spring weather. No gameplay renderer
quality switches or smoke-test substitutions were used.

The trace crosses 190 → 230 → 190 → 230 → 650 percent, 180 frames per view.
The fixed woodland/pond target is (170.1, -45.36). Camera and projection matrices
match before/after to 1e-6. The instrumented baseline's first crossing created
55 shader modules / 42 pipelines, reached 636.2 ms CPU render submission, and
had a 1935.6 ms frame gap. The repeated crossing created none.

After the change, the fixed-view crossing created **no close-ground shaders or
pipelines**, including shadow proxies. A fish splash created two unrelated
pipelines about seven seconds into the view; it was not the threshold event.
The heavy attribution run still showed periodic 200 ms-class rendering spikes
away from the boundary, so those must not be presented as eliminated. A second
meadow-position cold crossing also created zero shaders/pipelines.

The final `--zoom-only` cold page confirmed 0 shader modules / 0 pipelines across
the entire 180-frame first crossing. Its first CPU render submission was 62.4 ms
(baseline 636.2 ms); the next frame began 67.9 ms later. However, the maximum
first-ten frame gap was 259.7 ms, and the repeated crossing still reached
223.5 ms. Across the first crossing, p95 frame interval was 82.9 ms and p95 GPU
queue bracket was 82.44 ms. These smaller recurring spikes survived removal of
the per-draw instrumentation: they must not be dismissed as profiler overhead
or represented as a locked-60-FPS result. The measured fix is removal of the
multi-second cold compilation event. The startup diagnostic reported the GPU
work complete before presentation; its total GPU precompile/covered-submission
stage was 57.36 s in this run (includes the existing camp/actor startup work,
not an isolated incremental cost of this change).

At full close zoom, all 12 grass/wildflower submitted counts and geometry vertex
counts matched exactly. Submitted counts (including parked toroidal grass
slots) were:

```text
grass:     105798, 105730
flowers:   165, 3844, 110, 2376, 170, 3618, 13, 307, 5, 217
```

Final and no-post woodland views were inspected. Wind and weather were allowed
to advance; screenshots are qualitative checks, not a deterministic RGB parity
claim. Buffer/material identity and instance-count restoration are covered by
the unit regression instead.

## Reproduce and tests

Run `node scripts/camp-placement-debug-server.mjs <isolated-db> --zoom-only`,
then use **Test first grass zoom** only after the loading cover disappears.
This low-overhead mode omits the camp probe's per-draw/per-upload instrumentation.
The normal version without the flag records attribution and new object names.
Reload between cold tests. Do not move the camera or change quality while a
trace runs. `node scripts/analyzeCloseGroundZoom.mjs` summarizes the JSONL log.

GPU timing uses actual WebGPU timestamp queries bracketing the full post queue.
These brackets can include queue-idle gaps; they are not pure shader execution
time or display latency. CPU frame intervals are reported separately.

Passing: `test:close-ground-prewarm`, `test:starter-camp`, TypeScript and production
build. Broader checks also exposed existing failures outside this change:
`test:startup-chunking` exceeds its old initial-bundle byte ceiling;
`test:forest-startup-streaming` expects overview-source text absent even in the
committed forest builder. Neither budget nor assertion was loosened.
