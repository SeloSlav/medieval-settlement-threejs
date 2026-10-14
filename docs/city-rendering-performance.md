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

Rotating windmill sails now retain their authored parent transform but compile
their 42 rigid sail leaves into four material batches at runtime. The authored
source hierarchy remains available for disposal and asset checks. The structural
regression preserves all 560 sail triangles, and the native WebGPU comparison
checks twelve lit, shadowed camera-and-rotation combinations with no meaningful
pixel change. In the rebuilt 50-client realm at 1280×720, the settled capture
remained above target (32.62 ms mean, 48.40 ms P95, 2.73 M submitted triangles),
so this removes a confirmed submission hotspot without claiming the frame budget
has been achieved. Evidence: `artifacts/realm-browser-windmill-sail-batch/` and
`artifacts/city-performance/windmill-sail-batch/`.

Rigid transform caches now support registered animated subtrees. Mills, church
clocks, and buildings with campfires cache their static structure while continuing
to update their moving children every frame. Marketplace state changes invalidate
the cache. Clay and mineral deposits use the same cache, and progressive quarry
hydration invalidates both transform and render classification. These paths are
shared by single-player and multiplayer. The matrix regression compares 90,120
node transforms over 120 frames against ordinary Three propagation, including
nonuniform ancestor scale, relocation, changing stock and live fire/clock/mill
animation. It observes 627 rigid descendants updated only on state edits. The
deposit test covers zero idle descendant updates, moved chunk ancestors, late
quarry loading, depletion and restoration. Twelve native shadowed sail views
still match the uncached rendering reference.

In the later 50-client capture, building-marker matrix work averages 0.13 ms per
frame versus 0.58 ms in the prior profile; the selection root containing those
markers averages 0.71 ms versus 1.20 ms. The three deposit roots together use
about 0.003 ms per frame versus 0.62 ms. These are sequential diagnostic samples;
ancestor and child times overlap and must not be added together. The full frame
cohort still fails: 31.16 ms mean / 42.50 ms P95. Its pass-local main GPU average
is 1.14 ms, with 0.79 ms per refreshed shadow pass. Evidence:
`artifacts/realm-browser-animated-transform-cache/`.

The large offline single-player fixture requests 100 workplaces, 100 homes,
500 civilians, 100 dogs and 30 oxen. At 1280×720 and pixel ratio 1 with profiling
disabled, its populated stationary cohort averages 19.69 ms / 24.30 ms P95. The
cleared moving-camera cohort averages 24.08 ms / 30.40 ms P95; render submission
accounts for 16.84 ms on average. Its local single-player database connection
was refused, so this is client presentation evidence, not a live economy test.
It does not prove an isolated FPS gain from the transform changes. Evidence:
`artifacts/city-performance/sp-animated-transform-cache/`.

The fresh realm still needs simulation work. The 14 October phase capture has
5,004 homes, 2,549 buildings and 867 delivery trips; 15 heartbeats average
1.90 seconds, with about 98 seconds of retained clock debt at capture time.
There are still no farm fields or pastures in this fixture. Sustainable full
production and a stable five-minute multiplayer day remain unverified.
Evidence: `artifacts/realm-phases-2026-10-14.json`.

Server cart labor now shares compact totals within each production phase in both
game modes. Cart creation and confirmed removal update those totals immediately;
crew reassignment invalidates them. Unguarded reducers continue querying live
tables. `test:delivery-labor-cache` executes the actual Rust cache, free-labor and
onsite-labor getters, and crew-preemption function against in-memory tables.
Four thousand labor queries preserve results while reducing returned cart-row
reads from 55,000 to 1,000 and table queries from 7,000 to one. The regression
also checks 600 mixed dispatch/return/preemption events, changing assigned labor,
phase reset, and ordinary uncached operation.

Local-only counters confirm that the developed realm actually reuses the cache:
production phases make roughly 3,340 lookups against about 714 cart rows, with
the initial scan averaging 0.57 ms. Counter fields, scan timers and phase logs
are absent from the production build. `inspectRealmPhases.mjs` records the raw
phase counters alongside timing spans. Evidence:
`artifacts/realm-phases-delivery-labor-counters.json`.

The clock remains unfinished. A pre-change module built from source commit
`98e0e163` replaced the older running WASM before comparison. Its 90-second
50-client capture advanced 205 steps in 90.11 seconds while catching up debt
from 13.47 to 0.86 seconds; this fails the steady-clock gate. The cache build's
full 50-client capture advanced 636 steps in 300.28 seconds, reducing debt from
39.75 to 22.03 seconds, with a maximum sampled debt of 41.36 seconds. It also
fails both clock gates. Sequential workshop samples average 198.36 ms before
and 212.47 ms afterward; the advancing world and differing catch-up workload
do not establish a workshop or FPS improvement. The exact labor-query reduction
is verified, but further server work and a sustainable farm/pasture fixture are
still required. Evidence: `artifacts/realm-clock-delivery-labor-baseline.json`,
`artifacts/realm-clock-delivery-labor-cache.json` and the corresponding
`realm-phases-delivery-labor-*.json` captures.

Canonical road paths now cache exact directed endpoints, including unreachable
results. FIFO eviction limits each graph to 256 entries and 16,384 points;
oversized routes are returned in full without being retained. Callers own their
returned polylines, and replacing river navigation clears the cache. The native
road suite passes 27 checks. Its recurring workload preserves every path while
reducing 4,800 route requests to 48 solves.

Snapshot retention is also per owner. A 50-owner test warms all graphs, edits one,
removes one and admits another. Only the edited and new graphs are parsed; the
other 48 retain their exact graph identities and warm routes. Existing reducer
contexts keep their original immutable graphs, and removed owners are released
after those contexts end. Reordering unchanged table rows reuses the outer map.
Invalid snapshots remain absent until their source changes. Single-player and
multiplayer use the same cache, with no database schema or save conversion.

The first live capture reused 928 of 930 route requests in one heartbeat, with
332 cached entries and 834 points across the realm. It used temporary per-route
timing logs, which have been removed in favor of one aggregate heartbeat counter.
Its five-minute test subscribed 50 clients and advanced 604 steps in 300.05
seconds: a projected 298.06-second day, passing the rate tolerance. It still
retained 31.65 seconds of clock debt, with a maximum sampled debt of 34.95 seconds,
so the full clock gate fails. The fixture still lacks farm fields and pastures.
Evidence: `artifacts/realm-phases-canonical-route-cache-warm.json` and
`artifacts/realm-clock-canonical-route-cache.json`.

The final module removes individual route timing logs. Its later aggregate capture
records 6,949 hits among 6,957 requests over seven heartbeats, with 596 entries and
2,121 points across the realm. This sample still averages 1.75 seconds per heartbeat
and retains about 126 seconds of clock debt. The production-client browser cohort
with 49 computer clients and profiling disabled remains at 31.16 ms mean / 42.40 ms
P95. Paper-map fog and terrain-cache return checks pass, and the browser reports no
runtime errors; the frame-budget gate fails. These sequential captures establish
cache reuse, not an overall performance gain. Evidence:
`artifacts/realm-phases-canonical-route-cache-final.json` and
`artifacts/realm-browser-canonical-route-cache/`.

A separate renderer experiment grouped uniform updates by type while retaining
Three's native value packers. Across 834 bindings and 5,323 uniforms, eight native
WebGPU comparisons preserved every pixel under camera, fog, lighting, material,
object and wind changes. The alternating CPU samples were slower: about 6.06 ms
with native dispatch versus 6.58 ms with the experiment. This remains an isolated
probe and is not installed in gameplay. Reproduce with
`node scripts/probeUniformDispatchBrowser.mjs`; evidence:
`artifacts/city-performance/uniform-dispatch-probe/report.json`.

The global economy step now loads household need rows through one authoritative
table scan instead of one indexed query per existing home. Its existing cache
continues to receive stock and deficit-anchor writes, invalidates deleted homes,
and reads through for newly created homes. The native source-extraction regression
checks all 55,044 rows across 5,004 homes, four repeated read rounds, 600 mixed
writes, deletion/restoration, new homes, and phase retirement. Results match the
previous read-through implementation exactly; initial table queries fall from
5,004 to one, with the same number of returned rows. Household timer checks pass.

Burial dispatch now uses the existing phase's building-kind index to select chapel
identities, then reads each candidate's current completion, staffing, ownership
and fire status. It retains corpse ordering, stable route ties, active crew and
grave-capacity reservations. The native regression checks 50 owners, 250 waiting
corpses, changed and deleted chapels, no-road/unreachable cases, paused owners,
active carts and full graveyards. Its scaled comparison preserves exact dispatch
results while reducing returned building rows from 12,000 to 500. Owners without
chapels read no building rows after the shared index has been populated. Both
changes are shared by single-player and multiplayer; no schema change is needed.

The locally published module's five-minute test passes both clock assertions with
50 subscribed clients: 606 economy steps in 300.76 seconds, a projected
297.78-second day, and maximum sampled backlog of 3.89 seconds. Sampled backlog
starts at 3.89 seconds and ends at 1.75 seconds. Separate sequential phase samples
record burial dispatch at 0.316 ms versus 34.48 ms in the previous module; the
fixture currently has no chapels. The new need snapshot averages 11.56 ms. These
advancing-world samples do not isolate an overall economy or client FPS gain.
The fixture still has 5,004 homes and 2,549 buildings without fields or herds,
so sustained full-production clock performance remains unverified. Evidence:
`artifacts/realm-clock-household-burial-index.json` and
`artifacts/realm-phases-household-burial-index.json`. Default single-player,
production persistent-world and local-loadtest compilation checks pass.

The local fixture now adds actual agricultural and parish coverage to all 50
owners and 17 outposts. It has 5,004 homes, 3,438 buildings, 702 fields covering
3.11 million m², 117 cattle/sheep herds holding 1,087 animals, and 117 cemeteries
with 7,473 burial spaces. Added wells cover every home geometrically. Missing
breweries, smokehouses, fibre workshops and outpost crop processors are ordinary
completed building rows. New fields start in mixed sowing, growth, ploughing and
harvest states, so harvest hauling can run without waiting for a crop year.
Initial stock is seeded once; ongoing production, needs, hauling and clock work
remain authoritative. Livestock purchases use the ordinary treasury and capacity
checks. The observation window sees 115 fields advance; herd changes were not
observed during that same window. This establishes workload coverage, not annual
self-sufficiency or uninterrupted household welfare.

Fixture sites reject shared-map water, steep ground, existing parcels, structures
and protected resource deposits. Chapel placement reserves its cemetery at the
same time. Short parcels use a 4 m search; large parcels use 16 m. Barns alternate
field claims and can use smaller legal parcels at constrained edges. Identity
ordering is deterministic. Cattle parcels retain enough area for at least two
head even at the allowed slope and moisture limits. Existing base fixture roads
and homes are retained; this is not a claim that their original placement was
fully validated against terrain or that every geometric well claim has reliable
annual supply. No production reducer or multiplayer time control is added.

`test:realm-production-parcels` executes the actual parcel-search functions
natively. Thirteen controlled tests cover occupied/steep/wet parcels, resource
exclusion, world edges, working ranges, cemetery clearance and 600 fields around
50 dense towns. A second native cohort uses the actual embedded terrain in all
81 founding regions: every region fits twelve fields around the base town layout,
with 5.19 million m² total area. This terrain cohort excludes the later additional
service buildings and resource blockers; the live setup separately checks those.
`test:realm-production-coverage` succeeds for every owner, including geometric
well coverage and real field changes. Evidence:
`artifacts/realm-production-coverage.json`.

With agricultural coverage, the subsequent five-minute clock test subscribes 50
clients and advances 520 steps in 300.76 seconds: a projected 347.03-second day.
Sampled debt starts at 185.26 seconds and grows to 226.01 seconds. The initial debt
includes fixture setup, but its further growth still fails the steady-clock gate.
The initial phase capture averages 2.42 seconds per heartbeat and 357.67 ms per
workshop step, including 115.66 ms for wells. The final capture after clients
disconnect averages 1.89 seconds per heartbeat, with wells at 96.96 ms. These
different subscription states and advancing workloads are not an isolated
optimization comparison. Clock stability, annual production balance and both
client frame budgets remain unfinished. Evidence:
`artifacts/realm-clock-production-coverage.json` and
`artifacts/realm-phases-production-coverage-{start,final}.json`.

The following native WebGPU capture uses the production client, profiling disabled
for its formal frame cohort, and 49 computer clients plus the measured browser.
It averages 30.87 ms / 42.60 ms P95, with 474 residents presented and no browser
runtime errors. Fog, paper-map switching and native terrain-buffer reuse pass;
the 16.67 ms frame gate fails. One frame reports 411 draws and 11.97 million
submitted triangles after agriculture is added. Separate pass timestamps average
2.92 ms for main rendering and 1.90 ms per refreshed shadow pass. This establishes
the larger workload's current cost, not an isolated rendering regression: the
world, lighting, crop stages and delivery activity differ from earlier captures.
Evidence: `artifacts/realm-browser-production-coverage/`.

Farm-field synchronization now keeps models whose exact geometry inputs are
unchanged. The previous global visual-band cadence remains intact; when one
field changes a band, fractional input changes in another field are still
observed. Hedges use a separate parcel-shape signature and survive crop-only
updates. A terrain position-buffer identity/version change invalidates models
and hedges. Late crop/perimeter catalogs and final disposal retain their existing
ownership rules. Single-player and multiplayer use the same implementation.

The CPU regression retains 99 of 100 models, reduces height sampling from 22,100
calls to 222, and compares 2,448,816 attribute values against fresh models. It
checks fractional changes below a band, growing/harvest transitions, insertion,
removal, order changes, terrain edits and exactly-once disposal. TypeScript and
the existing field-visual suite pass.

Two native WebGPU cohorts compare against the immutable pre-change source,
reversing render order in the second cohort. All 30 settled comparisons preserve
every pixel, draw and triangle across authored crop transitions, fertility,
wind, near/far cameras, terrain edits, insertion/removal and reorder. Both cohorts
retain all eleven tracked buffers from an unchanged field and eighteen hedge
buffers. Three new crop phases have first-use differences of 178–288 pixels;
the differences follow whichever path renders first, including the original.
This does not establish cold-insertion parity, and the unchanged shader
initialization issue remains. The alternating native 100-field synchronization
cohort measures 0.54–0.74 ms with retention versus 30.91–34.40 ms with full-list
rebuilds. A separate reversed-order cohort also verifies the same retention.
Evidence: `artifacts/city-performance/farm-field-cache/` and
`artifacts/city-performance/farm-field-cache-reference-first/`.

The subsequent production-client capture with 50 clients averages 25.40 ms /
36.30 ms P95, still failing 16.67 ms. Fog, paper-map return and native terrain
buffer reuse pass with no browser runtime errors. The advancing world's
different crop/lighting/activity state prevents attributing the entire frame
difference to this cache. Evidence: `artifacts/realm-browser-field-model-cache/`.

The single-player presentation probe now supports `--fields`: twelve authored
fields and periodic replica-style progress changes accompany its 100 workplaces,
100 homes, 500 civilians, 100 dogs and 30 oxen. This is a presentation fixture,
not a live authoritative farm economy. Its corrected field-clearance capture
averages 42.24 ms / 54.60 ms P95 stationary and 40.62 ms / 60.60 ms P95 during the
camera sweep. Both fail the budget. The local single-player database connection
is refused, and a stag variant retains individual exact rigs because its horns
are not skinned; this is not a whole-game success claim. Evidence:
`artifacts/city-performance/sp-field-model-cache-cleared/`. Reproduce with
`node scripts/profileCityRuntime.mjs sp-fields --large --normal --fields`.

Multiplayer terrain refresh now queues only tiles whose layout or source
attribute revisions changed. Idle frames still observe source versions but do
not scan every resident tile. Unfinished work remains in order across frames;
new edits requeue affected tiles without restarting at the beginning. Detachment
cancels pending work and cache attachment observes the latest source. Material
replacement propagates independently of geometry revisions.

The terrain-buffer regression proves zero tile visits over 100 idle frames with
81 residents. Its deterministic two-tile frame budget finishes all 81 tiles,
including a second full edit arriving before the first finishes. It also checks
seam-local updates, normalized attributes, added/removed layouts, cached return,
allocation reuse, bounds and disposal. TypeScript and streaming regressions pass.

The production-client capture with 49 computer clients and frame profiling
disabled still fails at 38.96 ms mean / 97.00 ms P95. It ends with 83 tile
allocations, 173 refreshes and no pending edits. Paper-map fog and cache return
checks pass, with no runtime errors. A separate alternating diagnostic in that
browser performs 1,000 idle updates per arm: the old scan takes 30.2–48.0 ms and
visits roughly 81,000 tiles; the queue takes 1.3–2.3 ms and visits none. This
isolated housekeeping reduction does not establish an overall FPS gain in the
advancing world. The earlier terrain profiler hotspot also leaves the top sampled
functions. Evidence: `artifacts/realm-browser-terrain-dirty-queue/`. Set
`REALM_BROWSER_TERRAIN_DIAGNOSTIC=1` to collect the isolated comparison after the
formal frame and CPU cohorts.

Resident multiplayer terrain now shares native vertex/index draws across fixed
4×4 chunk cells. Source tiles keep their independent CPU interpolation buffers
and cache lifecycle; only their exact packed vertices move into consolidated
GPU buffers. A complete 81-chunk window uses nine terrain draws and retains all
41,472 triangles. Buffer growth initializes the previous contents before partial
updates. Dense removal moves the last member into the freed slot, and bounds
include only active members. Different attribute layouts coexist while budgeted
refreshes finish. This adds no sampled textures to terrain's existing shader.

Empty draw cells retain their GPU buffers in an LRU cache bounded to 128 reserved
chunk slots. Reattachment updates source data and reuses the original allocation;
eviction and disposal release each owned geometry once. The CPU regression checks
495,720 float bit patterns, exact indices, growth, same-version buffer replacement,
mixed layouts, material changes and an 80-cell cache churn. Streaming, terrain
buffer and TypeScript checks pass.

The native WebGPU regression uses 14 material textures plus depth/color shadow
textures within the standard 16-texture limit. All 21 comparisons preserve every
pixel, including first-frame growth, five immediate camera changes, height/wetness
updates, dense removal, mixed layouts, material replacement and cached GPU-buffer
return. Its wide view changes 83 total draws to 11, including a shadowed test box,
with the same 41,496 triangles. An explicit visibility check covers 52,417 terrain
pixels, so empty matching frames cannot pass. Consolidated bounds are conservative:
some partial camera views submit more offscreen triangles than individual chunks,
while their rendered pixels still match exactly. Evidence:
`artifacts/city-performance/spatial-terrain-draws/report.json`.

The controlled cached-return case also compares the native GPUBuffer objects,
retaining all 18 vertex/index buffer identities. Indices are allocated as uint32
from the start, matching Three's native WebGPU format and avoiding first-use
array conversion in previously culled cells.

The following production-client 50-client capture has 81 resident chunks and nine
terrain draws, with 2.84 MB of active draw buffers. It averages 28.99 ms / 48.30 ms
P95, and the 16.67 ms gate still fails. Fog and paper-map return checks pass with no
browser runtime errors. The advancing world's later frame cohort does not isolate
an FPS gain from terrain consolidation. Evidence:
`artifacts/realm-browser-spatial-terrain-draws/`.

A subsequent 50-client run adds an explicit game-level allocation/cache-hit
gate. Returning from the paper map retains 19 geometry allocations and reuses all
nine draw cells, while fog and chunk-cache return checks pass without runtime
errors. Its frame cohort remains over budget at 30.85 ms mean / 48.50 ms P95.
Evidence: `artifacts/realm-browser-spatial-terrain-cache-return/`.

The final game-level check captures actual backend GPUBuffer identities before
entering the paper map. All ten buffers from the five already-rendered terrain
cells retain their identities on return; all nine draw cells reuse the same 19
geometry allocations, with 2.90 MB before and afterward. The final 50-client
cohort measures 26.57 ms mean / 42.50 ms P95, with no browser runtime errors and
passing fog/cache return gates. The frame-budget gate still fails. Evidence:
`artifacts/realm-browser-spatial-terrain-native-buffers/`.

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
node --experimental-strip-types scripts/testWindmillSailBatch.mts
node scripts/testWindmillSailBatchBrowser.mjs
node --experimental-strip-types scripts/testAnimatedBuildingTransforms.mts
node --import tsx scripts/testDepositTransformCache.mts
node scripts/testDeliveryLaborCache.mjs
node scripts/profileCityRuntime.mjs
node --experimental-strip-types scripts/testAuthoredRigWorldMatrices.mts
node --experimental-strip-types scripts/testResidenceStaticBatching.mts
node node_modules/typescript/bin/tsc --noEmit
```

The asset benchmark and wall regression start and close isolated Vite servers on
available ports. The full-game probe uses its own server on port 5191. Results and
images are written under `artifacts/city-performance/`; existing game servers and
database contents are left alone.
