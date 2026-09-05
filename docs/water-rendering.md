# Water rendering

The river, pond and coastal surfaces share one optical composite. Their motion comes from different fields: an obstacle-aware current for channels, sheltered waves for ponds, and a three-band spectrum plus incoming shore waves for the sea. This is presentation code; navigation, water availability, flooding rules and terrain generation are unchanged.

## Surface and optical ownership

- `riverWaterShoreMaps.ts` builds the existing RGBA8 shore/rapid/flow map and an RGBA16F map containing velocity in metres per second, depth in metres and signed shore distance in metres. The organic terrain field stores distance in grid cells; conversion happens here. Coastal distance uses the authored coast, as does the horizon. The extra map costs 8 MiB at 1024², 0.5 MiB at 256², and is built once.
- `WaterHydraulics.ts` deflects the current around the same deterministic boulders placed by `RiverChannelRocks.ts`. Cylinder potential flow provides stagnation and shoulder acceleration with no normal flux at contact. A dissipative lee shelter and a local streamfunction pair provide downstream recirculation. Banks slow the current. The combined field is an approximation for shading, not a mass-conserving fluid simulation.
- `WaterOptics.ts` advects surface detail with two overlapping phases. Each phase resets while its weight is zero. Texture coordinates remain in world space through bends. Wave height and optical normal share the same shore-wave function; rain rings contribute to that normal too.
- Open water uses deterministic JONSWAP/TMA spectral data and Stockham IFFT evolution, including finite-depth dispersion, directional spread, a secondary swell and compression foam. The three disjoint bands use 64² textures over 240 m, 64 m and 8 m domains. All retained frequencies fit below their grid's Nyquist limit. Only the first two displace geometry. Both pixel footprint and mesh spacing suppress unresolved bands. Ponds use the first two at lower amplitude; quiet water within a river preset uses inexpensive analytic waves.
- The shader combines Schlick Fresnel (F0 0.0204, IOR 1.333), depth-dependent Beer–Lambert transmission, coloured inscattering, a bounded sun glint and foam. Refraction rejects samples in front of the water. Local differential-area focusing supplies shallow-bed caustics from the same normal, with bounded gain and distance/night filtering.
- Reflections trace a stable mean interface with 16 exponential steps (12 on the coast), at most five refinement steps, and early termination. Fine waves distort the resulting radiance. The same colour and depth snapshot nodes serve playable and horizon water: one opaque colour copy and one depth copy per scene pass, without rendering the forest again.
- The material writes the scene pass's output, normal and indirect attachments. Water's indirect attachment is zero because its optical composite already includes the lit bed; the ambient-occlusion pass must not darken it a second time. Existing scene fog, exposure and post processing remain the final image owners.

## Frame and resource budget

`SceneManager.render()` calls `updateWaterSpectra()` before rendering. Compute must never run inside an object/material update: it replaces Three's active node-frame camera during traversal. Object updates only mark visibility and refresh the shared light state.

Each active spectrum submits one ordered command batch per moving frame. River / pond / coast dispatch counts are 0 / 28 / 42. Paused or invisible spectra stop dispatching; the first visible frame initializes them. Playable and horizon surfaces share a spectrum. Time reversal clears stale foam history, and elapsed-time decay handles long visibility gaps. Reference counts dispose the spectrum and procedural noise after their final material is released.

Playable coastal depth is sea level minus the actual baked seabed. Horizon tiles are split exactly at the playable square, avoiding gaps and overlapping transparent surfaces. Playable spectral displacement fades over the final two grid cells (at least 8 m) to meet the coarse horizon mesh; optical normals retain their shared world-space fields.

The previous closed CPU visual solver and per-vertex `simDelta` uploads were removed from production water. Its original implementation remains in the QA baseline so performance comparisons include the old CPU cost. `WaterBaseline.ts`, `WaterBaselineProfile.ts` and `src/e2e/waterBaselineSimulation.ts` are comparison fixtures, not save compatibility layers; production routes do not import them.

## Boundaries of this renderer

Screen-space reflections can show only visible opaque geometry. Rays that leave the screen blend into an analytic sky colour; they do not recover offscreen trees, clouds or the moon. Thin foliage can retain small screen-space disocclusion holes. Refraction is a screen-space approximation and the caustics use a local bed plane. Compression foam persists in an Eulerian texture; it is not transported by a full ocean fluid solve. The spectrum uses an authored representative depth and weather envelope rather than solving spatial bathymetric refraction. Shore runup is a surface/opacity effect within the existing water mesh, not erosion or terrain wetting. Existing coarse terrain and shoreline geometry still bound the visible shore silhouette.

Obstacle flow is baked for authored channel rocks. Moving boats, newly placed obstacles and bridge piers do not dynamically rewrite it. Above-water views are the supported contract. These limits keep the system within the measured game rendering budget.

## Reproducing the gauntlet

Start a fresh stable Vite server after source changes; stable capture deliberately disables file watching and can otherwise retain old compiled modules.

```powershell
$env:SELO_STABLE_CAPTURE='1'
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5201 --strictPort
```

In a second terminal:

```powershell
$env:WATER_GAUNTLET_ORIGIN='http://127.0.0.1:5201'
node scripts/captureWaterWorldGauntlet.mjs world-accepted --all --paired
node scripts/captureWaterGauntlet.mjs surface-release --suite --production --benchmark
node scripts/checkWaterMotion.mjs motion-release --video
node node_modules/tsx/dist/cli.mjs scripts/testWaterHydraulics.mts
node node_modules/tsx/dist/cli.mjs scripts/testWaterHorizonJoin.mts
node node_modules/tsx/dist/cli.mjs scripts/testRiverWaterMaterial.mts
node node_modules/tsx/dist/cli.mjs scripts/testKupaRiverPresentation.mts
node node_modules/tsx/dist/cli.mjs scripts/testSparseVirtualPipesWater.mts
node node_modules/@playwright/test/cli.js test -c playwright.water.config.ts
```

Run GPU captures sequentially. Do not compare separate long runs as if they isolated the water cost: laptop thermal throttling changes the result substantially. The paired fixture keeps both variants in one loaded scene and alternates short ABBA blocks, including the original CPU simulation only for the baseline. GPU bookends encompass the full post-processing submission; compute time is recorded separately. A timestamp reported by a single render context is labelled as a sampled pass and is not the full-frame cost.

The full scene fixture includes production terrain, horizon, trees, grass, sky, shadows, post processing and wildlife. Settlement entities, database work and the game UI are omitted. The surface fixture isolates the production water with either simple geometry or real game vegetation/stone textures. Screenshots and video recording are visual evidence, not valid FPS measurements. The evidence index and review gallery live in `water-gauntlet-evidence/`.

Background references: [NVIDIA's water rendering treatment](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models), [USGS streamgaging basics](https://www.usgs.gov/mission-areas/water-resources/science/streamgaging-basics), and [NOAA on waves](https://oceanexplorer.noaa.gov/ocean-fact/waves/). The spectral adapter's MIT attribution is retained in `vendor/inkwell-webgpu-water/` and its source header.
