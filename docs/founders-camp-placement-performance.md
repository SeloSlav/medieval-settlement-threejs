# Founders' camp placement performance — 2026-09-04

## Root cause and fix

The camp model was not causing the reported 10–20 second freeze. On the real
mouse path, inserting the pending mesh took 0.1 ms. Rendering it blocked.

The loading warmup attached the camp PointLight, then removed it with the camp.
Three 0.185.1 includes light IDs in `LightsNode.customCacheKey()` and disposes
render objects when that key changes. Reattaching the light on placement rebuilt
the whole-world lighting state: a trace recorded 270 shader modules and 232
pipelines, including terrain, trees, and animal batches.

The separately rendered planted banner was also absent from warmup. Its first
cloth/hardware frame created another seven shader modules.

The initial fix retained the first camp's light for the session. It has now been
replaced by `FireLighting`, covering **every** shared fire: founders' camps,
hunting camps, bandit camps, and structural fires. Fire lights are data in one
resizable read-only GPU storage buffer, not entries in the material shader key.
Detached, hidden, demolished, and unoccupied fires contribute no light. The
camp banner still participates in covered GPU warmup; restoration empties its
batches without disposing them. The clean-frame submission remains before the
loader fades. The special first-camp resident-light class was removed.

No geometry, textures, worker count, animation, or quality settings were reduced.

## Live measurements

Actual toolbar selection and ground clicks, normal graphics (not VITE_E2E_TEST),
local database, hardware WebGPU: NVIDIA Lovelace, non-fallback adapter.
Small / Mrkopaljsko Polje / Easy / double supplies / initial orbit zoom 37%.

| Capture | Seed | Result |
| --- | --- | --- |
| Before, initial reproduction | `0x4d5a2e0d` | Render stalls of 3,825 ms, 13,292 ms, then 5,182 ms |
| Before, detailed reproduction | `0x4d5a2e0d` | 4,659 ms world shader rebuild; 6,993 ms banner frame; 277 new shader modules total |
| Fixed, first clean world | `0x4d5a2e0d` | First camp render about 30 ms; confirmation 152 ms; no new placement shaders/pipelines |
| Fixed, second clean world | `0x4d51bd98` | Pending frame submitted at 26.8 ms; GPU completion observed at 135.6 ms; confirmation 103.7 ms; no new placement shaders/pipelines |
| Shared lighting, fresh world | `0x4d5a2e0d` | Pending frame submitted at **14.3 ms**; render 11.8 ms; confirmation 90.3 ms; GPU completion observed at 120.2 ms; **0 new shaders / 0 pipelines** |

Second fixed capture: viewport 737×792, browser DPR 1.5, renderer pixel ratio 1.
The render itself took 18.2 ms. GPU completion is `onSubmittedWorkDone` observed
from pending insertion: an upper bound including JS callback scheduling, not a
GPU timestamp duration. The first fixed capture used a wider viewport and is
corroborating evidence, not a pixel-identical benchmark comparison.

The camp and ten founders were inspected at 37%, 110%, and 220% zoom, including a
near view without post-processing. Tents, supplies, fire, both banner panels,
and workers remain present. Poses and flag shape change over time. The fresh
world is empty before the click; no warmup camp/banner/light remains at origin.

Ordinary authoritative world-sync work (~0.1 s here) remains. Diagnostic changes
to post-processing can themselves compile different shader variants; these are
separate from placement and excluded from the placement measurements.

## Regression coverage and reproduction

Passed: `npm run build`, `npm run test:starter-camp`, `npm run test:camp-standards`,
`npm run test:campfire-occupancy`, `npm run test:fire-lighting`, and
`npm run test:visual-performance-hooks`. Tests check full shader-cache stability
through zero/one/many fires, exact transformed light parameters, occupancy,
influence-sphere culling, buffer growth/disposal, nested scenes, no stray
light/banner, banner reuse, and installation **before** renderer initialization.

Publish the current server module to a NEW isolated local test database, then run:

```text
node scripts/camp-placement-debug-server.mjs <isolated-database-name>
```

Open port 5177 and place through the real toolbar and mouse path. The harness
appends ignored `artifacts/camp-placement/events.jsonl` records. Split page runs
at `probe-installed`; inspect ten seconds after the camp pointerdown, excluding
later debug/camera actions. Records include light identities, created render
objects/shaders, first submission, GPU completion, long frames, and a camera/
backend manifest. The harness and its inspection buttons are never injected by
the normal app or production build.

## Shared-light visual contract and validation

Invariants: unchanged fire colour, intensity, decay, range, flicker, meshes,
textures, and workers; unchanged sunlight and directional shadows; no stranded
glow after extinguishing/removal; no world-material invalidation on fire lifecycle
changes; no truncation of overlapping lights. There is no model-quality tradeoff.

The first compilation includes the shared loop even with zero fires. Only
zero-energy lights and influence spheres wholly outside the view are omitted.
An offscreen flame whose light reaches visible ground remains included. Buffer
capacity starts at 128 lights (4 KiB), grows geometrically, and does not shrink or
recompile on removal. The 261-active-light stress uses 16 KiB. No render targets,
shadow maps, sampled textures, or permanent placeholder PointLights are added.

`Verify light pixels` compares GPU readbacks against ordinary Three PointLights:
256×256 RGBA8, fixed cameras and geometry, no post or tone mapping. At near,
design, and far views it checks zero lights, a night-intensity fire, day intensity,
and an edge-of-view fire; then checks 257 overlapping lights and removal to zero.
All **14 cases passed with zero differing RGB bytes** on NVIDIA Lovelace/WebGPU.
The dense reference uses one coincident ordinary light with summed intensity,
which is equivalent by linear light accumulation and avoids a huge reference
shader. The full game was also visually checked for restored terrain/forest
lighting and clean startup before placing the first camp.

`Test fire transitions` drives the actual BuildingMarkers, BanditCampRenderer,
and FireEffectsRenderer locally without calling server reducers. It warms their
model/VFX variants before measurement. Newly respawned bandit models still create
a few local model/VFX/shadow shaders, and extinguishing a structural fire first
reveals rubble; these are **not** world-lighting rebuilds. Their resource records
contain no terrain, forest, animal, or unrelated-building recreation. This work
does not promise zero cost for constructing every new building model.

### Regression traps caught during browser validation

- Installing lighting after `renderer.init()` is too late: RenderLists already
  captured the previous manager. Installation now precedes init.
- Runtime imports from Three's source-node modules create a separate TSL stack
  from the bundled renderer. Use bundled runtime exports; leaf imports are types
  only. The intermediate version caused missing lighting assignments.
- A light-data texture pushed terrain from 16 to 17 fragment texture bindings,
  invalidating its pipeline and causing the black scene. Storage data consumes
  no texture slots and stays within the existing device limits.
- Resizable storage in material texture bind groups can reuse a stale cached
  buffer in r185. The buffer/count now belong to the render uniform group; GPU
  readback verifies both growth and extinguishing afterward.

The intermediate black-screen implementation is rejected. Reload the page fully
after this renderer-initialization change; an already-created broken renderer
cannot be repaired through module hot replacement alone.

Validation follows the `threejs-visual-validation` contract: fixed camera/seed,
near/design/far and no-post checks, actual GPU pixels, temporal lifecycle cases,
resource accounting, and distinct CPU submission versus GPU completion evidence.
