# Physical forestry — implementation and verification

Implemented and published to the local `city-builder` database at `http://127.0.0.1:3000`. The production module has the new forestry schema and does not export the regression reducer. See `local-deployment.json` for the build hash and deployment time. Reload the local game client to load the new bindings and presentation.

## Gameplay

- The original SeedThree trunk, branches, and foliage rotate about the tree base and settle against sampled terrain. The fall takes 3.5 simulation seconds. Rendering interpolates authoritative progress; impact sound fires at the rendered terminal pose.
- Workers approach and cut the fallen tree before it becomes usable logs. Travel time depends on distance; labor, tools, production rate, and forestry land use affect cutting. Workers stop targeting a standing tree as soon as it falls.
- Each tree produces up to three stable log slots. Bark, cut ends, thickness, and length follow the source tree species and scale. Remaining health shortens the ground mesh, and hauled timber preserves the corresponding fraction of the source log's length.
- One timber consumes **10 health**; one firewood consumes **5 health**. Both camps draw from the same stock in overlapping work areas. Prepared firewood remains at the cutting site until collected. Depleted slots retain their identities until every log and prepared pile is gone, then the tree becomes a regrowable stump.
- Timber requires a purchased ox posted to that logging camp or in the automatic pool. An empty ox and guide travel to the reserved log, collect it, and return it to camp storage. Timber also requires an ox from the camp to the storehouse. Oxen posted elsewhere and oxen already hauling cannot be borrowed.
- Firewood uses a worker cart from forest to lodge, then physical storehouse collection. Workshops and construction receive these commodities through the storehouse. Forestry output is collectible immediately, without the previous producer overflow threshold.
- Both camp kinds can be placed near usable fallen wood. Working areas may overlap. Full storage, unavailable labor, pause, fire, transport reservations, missing oxen, and pickup headroom are respected.
- The two MP3 effects were generated through ElevenLabs. They obey game audio preferences, pan relative to the camera, fade with distance, and are culled beyond the shared world-foley range/zoom limits. Existing fallen trees do not replay sounds on reconnect.

## Verification

Passed:

- Production WASM compilation and production Vite build; TypeScript checking.
- All **532 Rust logic tests**.
- `scripts/testForestryIntegration.ps1`: real SpacetimeDB reducer execution in a uniquely named disposable database. Covers fall, cutting, automatic/posted/wrongly posted oxen, exclusive log and ox claims, loss of the ox, full storage at pickup, physical arrival, shared firewood, automatic storehouse collection below the old threshold, complete depletion, no duplicate yield, and exact wood conservation. Final stock from the 120-health fixture is four timber plus sixteen firewood. Result: `economy-regression.log`.
- `scripts/testForestryBehavior.mts`: phase-event deduplication, species materials, proportional meshes, worker targets and stance, distance/zoom/mute/pan, impact stopping fall audio, bounded voices, and ElevenLabs file hashes.
- `scripts/testForestryVisuals.mjs`: actual WebGPU renderer, beech/fir/oak phase captures, partial depletion, camera distances 13/65/180, lighting/normal/AO diagnostics, exactly one fall and impact event, browser audio decoding, empty/loaded ox haul, firewood cart, and a worker reaching and chopping the fallen trunk. No page errors. Result: `verification.json`.
- Existing stump lifecycle, SeedThree instance compaction, stable ox allocation, lodge logistics, industrial firewood logistics, and placement checks for all fourteen buildings with work/service radii.

Images include `workers-bucking.png`, `haul-timber-loaded.png`, `haul-firewood-loaded.png`, and the three species' mature/falling/fallen/log views. `diagnostic-lighting.png` is the lighting baseline without final grading effects; normal and AO views are retained separately.

GPU measurements use native WebGPU timestamp queries, 24 frames per capture, across the complete renderer. Beech mature/falling/full-log medians were 17.58/20.55/21.25 ms. Cutting workers measured 24.96 ms; the loaded ox view measured 36.91 ms. These are whole-scene smoke measurements, not an isolated forestry benchmark or a 60 fps guarantee. Raw log geometry is shared and has 48 triangles per section. See `gpu-summary.json` for all samples' summaries.

Broader existing checks encountered unrelated failures: the construction test expects a retired `preserved_food` field; the audio-wide manifest check reports a chapel-bell byte mismatch; the stable client test expects older build-menu copy; the worker suite expects the previous 1024 crowd budget instead of 1200. The forestry-specific behavior is covered independently above.

## Reproduction

From the project root:

```powershell
node --import tsx scripts/testForestryBehavior.mts
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/testForestryIntegration.ps1
node scripts/testForestryVisuals.mjs
```

The integration runner expects the isolated SpacetimeDB server on port 3013 (or pass `-Server`); it publishes to a new unique test database and never clears an existing game database. The browser test expects Vite on port 5193 and uses the opt-in `forestry-lineup.html` fixture. Normal Cargo builds exclude the `forestry-tests` feature. Older development databases require a clean publish for the tree/trip schema changes; no save compatibility layer was added.
