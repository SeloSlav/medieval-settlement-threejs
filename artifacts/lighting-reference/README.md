# Lighting reference pass — verification in progress

Scope: sunlight and ambient balance, shadow detail/contact occlusion, atmospheric
depth, exposure, and grading. Foliage and surface-asset work are deferred.

## Implemented

- Fair-weather sunlight multiplier: 0.32 → 0.65; daylight hemisphere: 1.55 →
  0.65; ambient: 0.18 → 0.075. Existing astronomical day/night directions remain.
- Camera-fitted, cached soft sun-shadow atlas: 2048² → 4096².
- Half-resolution GTAO, 16 samples, 3.2 m radius, 1.6 m thickness, spatial
  denoising. Occlusion subtracts a bounded estimate of hemispheric/ambient
  diffuse illumination; direct sunlight, emission and atmospheric inscattering
  are excluded. This is not a complete indirect-light decomposition.
- Height-dependent haze with a clear near interval; weather still controls fog.
- Native WebGPU order: scene HDR → ambient occlusion + HDR bloom → one ACES
  tone map → display-linear grading → sRGB output. Bloom strength is 0.055.
- Trailer review controls for fixed views, time of day, haze, and render passes.
- A query-only held-frame mode renders on demand for inspecting the dense city.
  Weather selection settles immediately in this mode; normal gameplay retains
  its gradual weather transition.
- Recovery of a connection lost before the first playable frame, reproduced
  during city shader startup and covered by the connection-recovery regression.

## Verified

- TypeScript type check and production Vite build pass. Vite reports large
  bundle warnings; these are not runtime-performance measurements.
- Existing day/night, precipitation visuals, post-processing pipeline, and
  naïve-art post-effect checks pass.
- The isolated native-WebGPU fixture rendered thousands of frames. Contact
  occlusion was inspected in its diagnostic view; the saved evidence is
  `ambient-occlusion-fixture.png` (1280 × 720). This is a technical fixture, not
  an image-match result for the city.
- The fixture was also inspected with final lighting and its emissive block;
  the saved image only documents the occlusion view.
- The built city subsequently loaded and reported 72 homes, 216 residents and
  46 buildings. `city-first-pass.png` is an intermediate overview, not an
  accepted reference match. Later views revealed that the authoritative world
  is in early spring, unlike the reference's full foliage. The review now has
  an explicit summer foliage/weather preview without changing the saved world.

## Pending

Full-city browser control remains intermittent. A few city captures succeeded,
but the final fixed summer review again timed out on DOM reads and screenshots
after navigation. This prevents a trustworthy final comparison and camera-motion
check. The cause is not established. No reference match, settled summer capture,
or full-scene frame budget is claimed. Do not treat passing code checks as visual
acceptance. Foreground haze and shadow contrast still need calibration, followed
by near/far, rain, dusk and night checks.

After restoring the preview, use
`http://localhost:5176/?trailer=1&lightingReview=1` with the
isolated `selo-trailer-v3` database. The served Vite client configuration was
re-read on 2026-09-03; the older trailer README refers to `selo-trailer-1550`.
The current world was paused through the database CLI and verified at tick
2086 with `game_speed = 0`. Use the localhost origin associated with
the saved player session. The trailer world is medium Delnice, seed 1125127504.

1. Verify that the built city is present, then pause the trailer simulation.
2. The review query selects a held summer preview at 14:00 with an initial
   reference camera: target (-70, -220), yaw -0.78, pitch 0.65, distance 310 m.
   These are preliminary framing values, not a verified camera match. Click
   Redraw frame after the city connection is ready; F8 toggles clean capture.
3. Compare Final, Lighting only, No ambient occlusion, Ambient occlusion,
   Normals, Linear depth, and Ambient light. Toggle Atmospheric haze.
4. Check house foundations, eaves, tree silhouettes and crop rows at overview,
   near and street distances. Rotate/move the camera to check shadow stability
   and occlusion halos, then check dusk/night and rainy presentation.
5. Record the visible lighting/performance metrics and matched screenshots.
   Only then tune the final contrast/haze and conclude the reference review.
   Uncheck Hold frame before evaluating motion or frame rate.

The separate local fixture is at `http://localhost:5176/lighting-review.html`.
