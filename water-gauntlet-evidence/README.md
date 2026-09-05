# Water gauntlet evidence

Open [the comparison gallery](review.html) for the supplied reference, three new motion clips, the old/new surface captures and production-world screenshots. [Implementation and reproduction notes](../docs/water-rendering.md) describe the system and its limits.

## Accepted evidence

- **world-accepted/** (river/pond) and **world-coastal-release/** (sea): final production environment, identical loaded scene alternating old/new water in four short ABBA cycles, 45 measured frames per block and six discarded transition frames. Each variant has 360 frame samples. Full post-processing GPU bookends and separate compute timing are reported. Source hashes are in [manifest.json](manifest.json).
- **surface-release/**: near/design/far views of the production shader with game tree and stone assets on controlled fixture terrain; moving-water measurements follow shader warmup.
- **motion-release/**: final optical passes, rain/night, five-second videos, and adjacent frames across the 6.25-second advection reset. These are visual evidence; recording and screenshot costs invalidate performance measurements in these records.
- **stress-release/**: extra seeds and DPR 1.5/2, near and far views. Compilation/visibility/copy-budget checks, not matched performance comparisons.
- **production-baseline/**: original water shader on the same controlled production-asset fixture.
- **reference-0.png … reference-8.png**: sampled frames from the supplied 45.46-second video. The local review copy of the original video is excluded from Git.

## Paired rendering results

1280 × 720, DPR 1, Microsoft Edge WebGPU, RTX 4070 Laptop GPU. Values are medians. GPU figures encompass the full environment/post pass; compute is shown separately. 7 of nine median frame intervals match; the remaining views differ by at most 0.1 ms, one timer step. The new shader has a small additional GPU cost; these results establish the observed FPS band on this machine, not a promise for every GPU or settlement workload.

| View | Old FPS | New FPS | Frame Δ ms | Old → new GPU ms + compute | Old → new CPU ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| River current / near | 32.89 | 32.89 | 0.000 | 32.22 → 32.47 + 0.000 | 17.4 → 18.3 |
| River current / design | 41.15 | 41.15 | 0.000 | 25.12 → 25.04 + 0.000 | 6.0 → 5.6 |
| River current / far | 27.47 | 27.47 | 0.000 | 35.27 → 35.52 + 0.000 | 8.0 → 7.6 |
| Sheltered pond / near | 33.00 | 33.00 | 0.000 | 29.49 → 30.05 + 0.089 | 5.1 → 5.3 |
| Sheltered pond / design | 23.58 | 23.58 | 0.000 | 41.24 → 41.87 + 0.095 | 7.2 → 7.4 |
| Sheltered pond / far | 20.62 | 20.62 | 0.000 | 46.99 → 47.23 + 0.100 | 7.2 → 7.3 |
| Coastline / near | 41.49 | 41.32 | 0.100 | 21.31 → 21.59 + 0.106 | 13.9 → 13.6 |
| Coastline / design | 54.95 | 54.95 | 0.000 | 19.59 → 19.86 + 0.116 | 5.1 → 5.0 |
| Coastline / far | 41.15 | 40.98 | 0.100 | 26.65 → 26.92 + 0.127 | 6.9 → 6.6 |

The fixture includes terrain, horizon, forest, grass, river details, sky, shadows, post processing and wildlife. Settlement entities, database and UI are omitted. Earlier standalone runs heated the laptop and changed GPU clocks, so they are not treated as controlled old/new comparisons. Even paired runs can have different absolute FPS under different thermal/background load; compare variants within a run.

## Visual judgement

The supplied clip sets the target for readable currents and boulder wakes. The new renderer adds contact-constrained split flow, downstream recirculation, visible bed transmission, real on-screen tree reflections, calmer pond motion, spectral sea waves, distinct shoreline response and weather/time-of-day response. The comparison remains a visual judgement; there is no objective score that proves one scene is universally “better”. The gallery exposes the actual output and reference rather than presenting an automated similarity score as proof.

The game currently has a steep, coarsely tessellated coastal bank. The water renderer follows that geometry; it cannot turn it into a gently sloped beach. Screen-space reflection misses and fine foliage disocclusions remain possible. Offscreen reflection uses sky colour. Full dynamic obstacles, underwater views, erosion, bathymetric fluid transport and terrain wetting are outside this rendering implementation.

## Validation

Numerical hydraulic/FFT/lifetime tests, river material tests, the Kupa geometry/presentation contract, the old sparse solver's conservation tests, TypeScript, and the four Edge browser water checks passed. Browser checks cover shader errors, bounded copies, paused compute, diagnostic restoration within one colour level, rain and night. Build results and temporal measurements are recorded alongside this index.

## Rejected and superseded iterations

- suite-02: compute was allocated but not dispatched; not an animated-spectrum result.
- suite-03: nested compute corrupted the active Three node frame; blank views rejected.
- suite-05 and moving-01: sampled-texture limit exceeded; blank coast rejected.
- world-01: MRT attachment mismatch; rejected.
- world-02: development reload interrupted collection; not final performance evidence.
- world-baseline/world-final/world-paired/world-budget: long separate or long-block runs affected by thermal drift; superseded.
- world-interleaved: identified repeated framebuffer capture cost; superseded by shared snapshot nodes.
- world-coastal-depth: actual seabed depth restored sea waves but a far-view frame-rate regression remained; superseded by the smaller fine-wave grid and shorter coastal reflection trace.
- The coastal records in world-accepted precede the seabed and horizon-join corrections; use world-coastal-release. Its conditions.json verifies exact production join coverage, and its rain/night screenshots exercise SceneManager weather integration.
- world-shared: first successful budget run; superseded by final world-accepted. Its per-variant copy counters inherited the last baseline block and must not be used as proof of the new renderer's copy budget.
- Other iteration, suite, moving, polished and production folders are intermediate visual development evidence. motion-final precedes the final stable mean-interface reflection adjustment; use motion-release.
