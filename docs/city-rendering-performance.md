# City rendering investigation — 2026-09-06

## Resumed SeedThree review — 2026-10-12

The upstream merge and the game's material-output ownership fix remain intact.
The current seven shipped branch-card families use upstream bake revision 6.
The saved native comparison covers 12 season/wind/camera cases with identical
pixels, draw counts and triangles. The production client build and 21 upstream
species/LOD/material tests pass.

Further changes are shared by single-player and multiplayer:

- Deposit footprint queries now look up nearby immutable footprints. A rotated
  ellipse remains the exact narrow-phase test. 71,009 query comparisons preserve
  stone depressions, terrain blending, prop/grass exclusion and rich-clay values,
  including negative cell boundaries and non-finite diagnostic inputs. The
  100,000-point realm workload changed from 1,952–1,985 ms to 21–30 ms. Its stone
  candidate count changed from 8,100,000 to 2,088. This is a placement/terrain
  query improvement; it is not a claim of an equivalent steady-frame gain.
- Distant-water height sampling now indexes immutable path segments. The lookup
  retains every nearest competitor within the global maximum carving radius,
  so a nearer narrow channel still suppresses a farther wide one. 22,084 exact
  carving comparisons cover source-order ties, varying widths, degeneracies,
  cell edges and non-finite probes. A 20,000-query workload changed from 832 ms
  to 3.22 ms, with the same 122 carved points. The coastal horizon join test
  still passes. This addresses a previously profiled startup full scan.
- Small repeated opaque building geometry expands into bounded spatial material
  draws. Each shared shape is limited to 65,536 expanded vertices; larger repeated
  shapes retain instancing. The varied 100-home contract now submits 48 objects
  and 48 native draws instead of 355 objects. All 283,356 triangles remain. Its
  rendered geometry is 33,098,160 bytes and retained editing/render geometry is
  63,891,272 bytes, within the existing 64 MiB contract. Sixty native building and
  shadow comparisons pass the existing raster-edge tolerance (maximum 273 of
  307,200 pixels). The threshold was not loosened.
- Road clearance indexes sampled centerline segments once per road snapshot.
  Tree, undergrowth, ivy, nettle, twig and rock clearance retain the original
  distance calculations, source paths and left-to-right threshold arithmetic.
  106,286 queries match the exhaustive scan; oversized diagnostic margins fall
  back to that scan. A 20,000-query test changed from 1,968 ms to 6.78 ms,
  selecting the same 62 points and 10 decorative rocks. The existing rock
  clearance fixture was updated with its missing terrain material and passes.

The production startup CPU capture identifies a much larger road-clearance
problem than the earlier short startup profile could reach: forest-floor
`refreshBlockedMask` occupies about 451.6 seconds of a 514.3-second capture,
mostly exhaustive polyline distance queries. The long startup also reproduced
with the ordinary renderer after removing the shared-buffer experiment. The
road-segment index targets that measured stall; a new native run verifies it.

The large single-player visual fixture retains terrain, shadows and post effects,
with 100 workplaces, 100 tier-one homes, 500 civilians, 100 dogs and 30 oxen.
With frame instrumentation disabled, populated stationary means changed from
20.04 to 19.16 ms, and the cleared moving-camera case from 25.29 to 22.83 ms.
P95 remains above 16.67 ms. These are sequential runs with system-load variance,
not a paired estimate of the batching change. This fixture edits offline visual
state; the absent `city-builder` database on port 3000 produces a recorded 404
connection error, so this is not an end-to-end economy validation.

The 50-client multiplayer run with the production bundle averages 58.77 ms,
P95 66.8 ms, with no browser errors. All seven card families load from shipped
assets even with deliberately stale browser records. Fog, parchment and terrain
cache checks complete; the frame-budget gate fails. Evidence is under
`artifacts/realm-browser-production-expanded/`.

Single-player pass-local timestamps additionally include direct authored-animation
compute submissions. The large cleared fixture averages about 6.41 ms for its
main pass, 6.53 ms for a refreshed shadow pass (111 of 609 frames), and about
1.47 ms total authored compute per frame. These execution times exclude CPU
submission and queue gaps. The compute work alone does not explain missed frames.

A mapped-staging upload experiment passed byte and pixel parity but increased
the terrain-only frame mean to 46.25 ms. That implementation was removed. It is
not part of the game. A shared-buffer alternative also passed 24 native pixel
comparisons but did not improve the large single-player frame cohort (cleared
moving-camera mean 24.95 ms, P95 30.4 ms). Its production multiplayer probe
stalled during startup and was terminated after more than ten minutes. That
implementation was removed too; no shared-buffer hooks remain in the renderer.

Optional post-cohort browser traces include main-thread, GPU-process and
presentation scheduling. Use `--trace` with `profileCityRuntime.mjs` or
`REALM_BROWSER_TRACE=1` with `testRealmBrowser.mjs`. These captures are separate
from the reported frame intervals and address queue/scheduling time that
pass-local GPU timestamps cannot account for.

The single-player scheduling capture contains 233 animation callbacks in 5.05 s,
averaging 20.65 ms of callback wall time. Its GPU-process WebGPU decoder events
cover 2.01 s during the capture. These nested trace durations are not hardware
GPU execution times or CPU utilization. The run also reports thermal throttling
at 86–87 °C; sequential frame means ranged substantially. Preserve that limitation
when comparing runs. The trace is in
`artifacts/city-performance/resumed-sp-browser-trace/`.

The rich-stone and mineral suites currently fail older Rust source-pattern
assertions for direct support-timber requests; those server files are unchanged
by this work. Rich-clay checks and the new exact-footprint test pass. This is not
a claim that the whole repository's CI passes.

**60 FPS is still unverified in both populated modes.**

## Later native measurements and remaining limits

The marker cascade overrode the browser's `[hidden]` rule with `display: grid`
or `flex`. About 500 fog-hidden resource markers continued composing blurred
layers. Explicit hidden selectors and projection-owned visibility fix that
rendering and information-leak bug. Twelve browser cases pass in both modes,
including hidden fog markers, revealed and remembered resources, projection
occlusion, stationary mutation counts and panel restoration. The subsequent
production realm cohort averaged 25.56 ms, P95 54.5 ms; first playable was
40.26 seconds with no browser errors. A paired diagnostic after the fix shows
roughly 22–24 ms with normal UI and with its filters disabled. Earlier disabling
filters changed roughly 81 ms to 45 ms. These diagnostics are separate from
the formal frame-budget cohort.

Static route legs now share a bounded exact-endpoint cache. Static disk
overlap queries also cache exact coordinates/radii until collider invalidation.
Water and dynamic hazards remain uncached. The navigation tests cover negative
results, copied return values, signed zero, eviction and collider invalidation;
150 reachable synthetic detours preserve their routes. The captured realm's
160 requests were all unreachable before and after caching, which is a fixture
problem rather than evidence of 160 successful paths. The disk cache matches
40,090 exhaustive comparisons. Deterministic civilian accumulator phases keep
15 Hz simulation but spread 500 agents across frames: peak fixed-step work
changes from 500 to 134 agents, with 30 steps per agent over two seconds.

The new production realm cohort (519 population, 509 rendered civilian agents)
averages 29.78 ms, P95 42.6 ms, with no browser errors. Navigation accounts for
761.9 ms over the 12-second diagnostic, versus about 1.86 seconds in the earlier
leg-only run. This demonstrates less navigation work, not a proven FPS gain:
the sequential frame means remain affected by live workload and thermal state.
Evidence: `artifacts/realm-browser-phased-collision-cache/`.

The later large offline single-player cohort has a 47.44 ms stationary mean
and 46.73 ms cleared moving-camera mean. It submits about 14.48 million colour
triangles and 27.49 million triangles on refreshed-shadow frames. Timestamp
measurements give 16.17 ms for the main pass, 16.94 ms for refreshed shadows
(86 of 260 frames), and about 3.04 ms total authored-animation compute. The
GPU reports 87 °C with software thermal slowdown active. These numbers cannot
be attributed solely to the CPU-cache change or directly compared with the
earlier cooler pass timings. The fixture still has its documented connection
404 and therefore does not validate the single-player server economy.
Evidence: `artifacts/city-performance/sp-phased-collision-cache/`.

The current realm server also misses its simulation cadence: nine measured
heartbeats average 2.70 seconds, with 2.61 seconds in the economy. Its existing
maximum catch-up allowance is two seconds per reducer; retained clock debt
therefore grows. The test realm has no farm fields, pastures or graveyards,
and is not yet a sustainable full-production benchmark. The five-minute shared
day and complete economy require further server work and a viable fixture.

Moving authored rigs were the largest measured settlement cost. Buildings also
add submission work, and the full terrain/post-processing scene has a separate
rendering cost. The stable walls disappearing during camera movement were a
batch texture invalidation bug, not an exhausted mesh limit.

The fixes preserve source meshes, materials, textures, bone counts, animation
rates, and the existing graphics settings:

- Hidden CPU animation rigs now sit behind `AuthoredRigEvaluatorGroup`. Their
  bones are evaluated explicitly for the visible instanced bodies and equipment;
  subsequent color/depth/shadow traversals do not walk those duplicate rigs again.
  This covers villagers and batched authored animals, including dogs and oxen.
- `AuthoredRigWorldMatrices` retains each bound clone's immutable hierarchy and
  only composes local transforms that changed. AnimationMixer, combat corrections,
  actor transforms, and the exact palette still update normally. The topology
  has the same lifetime as the existing cached clone binding; new equipment kinds
  receive separate pooled rigs.
- Residences now use the building batch manager's byte-checked geometry sharing
  and exact instancing. No approximate geometry matches or visual substitutions
  are accepted. Empty groups left by static merging are removed; construction
  boundaries and pre-existing anchors remain.
- Growing a `BatchedMesh` replaces its matrix and draw-indirection textures.
  `resizeBatchedMeshInstances` invalidates the material node bindings so shaders
  use the replacement textures. Previously, camera-dependent draw sorting could
  read retired data and hide or displace walls after the batch exceeded capacity.
- Replaced skinned instance layers dispose their renderer allocations while
  retaining borrowed source geometry and textures.

Measured on headless Edge, hardware WebGPU, non-fallback NVIDIA Lovelace,
1280×720 at pixel ratio 1. The deterministic offline fixture submits original
building, residence, civilian and dog assets. Each cohort has 40 warmup frames
and 120 measured frames, with animation advanced by 1/60 second per frame.
These are CPU update-plus-render-submission times, not GPU execution times or
guaranteed gameplay FPS. The fixture isolates assets and animation: it does not
include the game's terrain, shadows, simulation or post-processing. Its generous
visibility radius submits every requested actor; camera framing is fixed per
cohort, rather than requiring every submitted instance to fill the screen.

| Workplaces / homes / people / dogs | Before mean CPU ms | After mean CPU ms | After p95 ms | Native color draws before → after | Submitted triangles, unchanged |
| --- | ---: | ---: | ---: | ---: | ---: |
| 6 / 5 / 0 / 0 | 5.63 | 3.92 | 4.90 | 130 → 127 | 21,645 |
| 6 / 5 / 60 / 12 | 18.75 | 8.66 | 11.00 | 137 → 134 | 646,905 |
| 100 / 100 / 0 / 0 | 20.16 | 12.85 | 16.00 | 1,350 → 1,027 | 413,883 |
| 100 / 100 / 200 / 40 | — | 26.84 | 28.70 | — → 1,034 | 2,498,083 |
| 0 / 0 / 500 / 100 | 129.75 | 42.11 | 55.20 | 9 → 9 | 5,210,503 |
| 100 / 100 / 500 / 100 | 142.25 | 46.23 | 49.60 | 1,357 → 1,034 | 5,624,383 |

Evidence is in `artifacts/city-performance/baseline/results.json` and
`artifacts/city-performance/final-isolated/results.json`, with cohort screenshots.
Intermediate measurements varied with system load: the standalone 600-actor case
was 25–42 ms after the fixes. These runs demonstrate the direction and size of
the improvement, not a noise-free paired benchmark. The final capture additionally
includes timestamp-query overhead, which the baseline did not have.

Device timestamp queries bracket the isolated render submission. Their median
queue spans were 5.41 ms for the small populated cohort and 22.32 ms for the
largest cohort (117 resolved samples each). These spans include queue idle gaps
and any intervening GPU work; they are not pure shader time and must not be
added to CPU time. The shared profiler's generic “full-post-processing” label
does not change this fixture's explicitly limited rendering scope.

The separate full-game probe retained terrain, post-processing and shadows and
exercised six workplaces, five homes, 30 civilians and three stable oxen without
browser errors. Its populated phase averaged 25.63 ms between frames, including
22.06 ms in render submission and 1.84 ms in villager presentation (which includes
0.23 ms of ox presentation). Other terrain/camp phases varied substantially;
this is integration evidence, not a controlled estimate of each building's cost.
The probe modifies offline visual state only and does not alter the user's save.

**The large-city 60 FPS target is not yet met.** The largest isolated cohort is
about three times faster, but still exceeds the 16.67 ms frame budget. Its final
CPU averages are 28.51 ms for people, 5.96 ms for dogs, and 11.74 ms for render
submission. Exact animation evaluation/palette production is the next substantial
scaling constraint; the existing GPU animation library is not integrated into
the live crowd path. The full terrain/shadow/post-processing budget also needs
further work. No reduction in graphics quality was used to hide these limits.

Validation completed:

- TypeScript typecheck and the authored skinning, source-model batching, crowd
  hot-path, 1,024-agent selection, animal fidelity, equipment, company-standard,
  building, residence and construction lifecycle checks pass.
- Matrix parity covers 90 nodes over 180 animated frames, moving ancestors,
  nonuniform scale and manually managed matrices. Every resulting matrix matches
  Three's original propagation exactly; 16 later render passes perform zero
  duplicate rig updates.
- The 100 varied-home test now counts exact `InstancedMesh` submissions as well as
  packed meshes. All 283,356 visible triangles remain, with 1,015 native draws,
  355 render objects and 29.66 MB of rendered geometry, compared with 8,514
  individual draws and 32.75 MB before static batching. Exact instancing uses more
  render objects than packing alone while reducing native draws and memory.
- The WebGPU wall regression grows 12 actual building kinds and checks five
  camera angles at each size. All 60 settled comparisons differ from individual
  source meshes by at most 200 of 307,200 pixels, at rasterized edges. Every camera
  change also passes on its first rendered frame. The old capacity-growth bug
  changed 30,000–64,000 pixels persistently after nine buildings. A first-use
  upload/compilation frame immediately after adding geometry is recorded separately
  and can still differ; this test does not claim cold insertion is flicker-free.
- Full-suite discovery remains blocked by 28 unrelated unregistered test files.
  Earlier stable UI/roster checks also fail expectations outside these rendering
  edits. This is not a claim that the whole repository's CI passes.

Reproduce from the repository root (Node dependencies and installed Edge required):

```powershell
node scripts/benchmarkCityScale.mjs review --gpu
node scripts/benchmarkCityScale.mjs cpu-review --profile
node scripts/testBatchedBuildingGrowthBrowser.mjs review
node scripts/profileCityRuntime.mjs
node --experimental-strip-types scripts/testAuthoredRigWorldMatrices.mts
node --experimental-strip-types scripts/testResidenceStaticBatching.mts
node node_modules/typescript/bin/tsc --noEmit
```

The asset benchmark and wall regression start and close isolated Vite servers on
available ports. The full-game probe uses its own server on port 5191. Results and
images are written under `artifacts/city-performance/`; existing game servers and
database contents are left alone.
