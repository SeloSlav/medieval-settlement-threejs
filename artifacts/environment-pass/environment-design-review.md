# Environment design gauntlet — work in progress

The requested Manor Lords visual target is **not achieved or verified**. Keep the full environment-design goal active. The current work comprises asset/material iterations and a production-renderer review fixture; a complete settlement comparison and broader hardware/scene coverage remain outstanding.

## User clarification: intentional canopy cards

On 2026-09-05 the user challenged the diagnosis of “oversized leaves,” explaining that canopy cards are intentional. Preserve those authored representations, their LOD/distance rules, whole-crown fill, overview cards, and associated rendering policies. A screenshot alone is not evidence of an erroneous leaf scale.

The proposed smaller/more-numerous broadleaf experiment was confined to `environmentLineup.ts` behind `?broadleaf=fine`. It was **not installed into the production presets**, and that experiment has now been removed from the fixture.

`canopy-layer-audit-01` independently excludes detail cards, whole-crown underlays, and overview cards through temporary camera-layer masking, restoring all masks afterward. The close meadow and junction images are unchanged when excluding the whole-crown or overview layers. The foreground leaf/spray shapes disappear when the detail-card layer is excluded. They are baked card content, not separately rendered leaf geometry. This identifies the layer; it does not establish that its intentional appearance is defective.

## Changes currently in the worktree

- Fuller meadow tuft albedo, `close-meadow-tuft-fuller-v2.png`, installed into the existing SeedThree grass adapter. The original image is retained. Both images are 1254×1254 RGBA; geometry, material path, capacities, density, wind, seasons and LOD rules are unchanged. Prompt and tool provenance are in `grass-texture-provenance.json`.
- Forest-litter surface blend now starts at coverage 0.24 and finishes at 0.98, preserving meadow surface farther into sparse crown cover. Placement masks, canopy shade, grass budgets, and closed-forest litter are unchanged.
- Road-shoulder albedo and roughness use a shared world-space ground projection to avoid curled/stretched soil texture at caps and junctions. Existing masks, two texture samples, topology, logical width and bridge surfaces are retained.
- Earlier conifer spray-authoring trial: fir/spruce/pine use 8/7/8 foliage instances per terminal branch, sizes 0.9/1.1/1.05, coverage 1.3, and earlier starts. This remains **provisional** and must be evaluated with the intentional canopy representations understood. The original values are retained in the fixture’s `?conifers=baseline` control and the conifer regression script. An earlier, larger 1.25/1.4/1.3 trial was rejected. No production broadleaf authoring has changed.

## Evidence and limits

- `meadow-paired-01`: one scene, six alternating 480-frame image swaps per close view. Pooled GPU median: meadow 14.1793 → 14.1987 ms (+0.136%); junction 15.6180 → 15.6723 ms (+0.347%). Geometry submissions and texture dimensions match. The difference is smaller than repeated-control variation; this is not a guarantee for other hardware or full settlements.
- `full-control-01`: original conifers/road material/grass against an archived source cohort. Static images and runtime checks completed.
- `full-candidate-01`: contains useful seasonal images, but its initial static images followed a motion route with zero-delta settling. Canopy crossfades remained unfinished, increasing draws and visibly smearing crowns. Do **not** use those static images or their counts as an accepted comparison. The run was also interrupted before its final runtime report.
- The capture fixture now advances the existing fades before freezing each static view, and records cold and warm motion traversals separately. The corrected control in `broadleaf-pair-01/arm-0` returns to 89 design draws and 133 close-meadow draws.
- `broadleaf-pair-01/arm-1`: experimental leaf authoring, withdrawn. Timing was unstable and failed to establish non-regression. Never treat its equal draw counts as proof of equal FPS. The host GPU was observed at 99% utilization, 86–88°C and 1320 MHz during these later runs; this observation is recorded without attributing the result to a particular cause.
- `canopy-layer-audit-01/runtime.json`: no browser errors. Temporary diagnostic layer exclusions do not change production visibility settings.

Source cohorts are hashed per run and archived as `sources-<id>.json.gz`. The review server can replay an archive and refresh only explicitly allowed environment files, preventing unrelated active workspace edits from silently entering an A/B.

## Checks completed

TypeScript, production build (isolated `build-smoke` output), road junction topology, terrain ecology material, close-ground vegetation, canopy overview fade/hysteresis, and nine seeded conifer generation cases passed. The installed grass asset was verified in the production build output. These checks do not prove the full visual target or broad performance equivalence.

A subsequent whole-worktree TypeScript check, after the canopy audit, is currently failing in concurrent forestry changes: missing generated `forestrySource`, `harvestProgress`, `workBuildingId`, and `logs` fields in table synchronization, plus an `erasableSyntaxOnly` error in `TimberLogVisuals.ts`. Those files were not changed by this environment pass. The capture runner's JavaScript syntax check passes. Recheck the current complete build once that schema work settles; do not report the latest whole worktree as green.

## Next work

Continue ground/road/forest-edge art evaluation without treating intentional cards as geometry defects. Complete a matched, settled whole-environment comparison, validate conifer authoring separately, and inspect a representative inhabited settlement with building access paths. Preserve rejected evidence and report actual failures; do not substitute pass counts or fabricated visual scores for the requested visual standard.
