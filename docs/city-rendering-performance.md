# City rendering investigation — 2026-09-06

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
