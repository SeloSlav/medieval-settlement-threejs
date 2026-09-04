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

`ResidentFireLight` now retains the exact light object in the scene from startup
until session disposal. Position and intensity remain uniforms. Detached, hidden,
demolished, and unoccupied camps emit no light. The camp banner participates in
covered GPU warmup; restoration empties its batches without disposing them.
The existing clean-frame submission remains before the loader fades.

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
`npm run test:campfire-occupancy`, and `npm run test:resident-fire-light`.
Tests check light identity through warmup/placement, no stray light/banner,
transformed light anchors, occupancy, demolition/disposal, and banner buffer and
material reuse.

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
