# Male villager elbow repair

Both rolled sleeve / forearm guard joints had open geometry in the source
model. Each elbow had 25 open edges. The repair closes those edges with
21 skinned triangles per arm and retains the exact boundary positions and
weights. New patch normals are smooth; exposed skin samples the existing atlas.

## Evidence

- [Right elbow before](weapon-qa/elbow-close-before-right-bow.png)
- [Right elbow after](weapon-qa/elbow-after-right-bow.png)
- [Left elbow before](weapon-qa/elbow-close-before-left-bow.png)
- [Left elbow after](weapon-qa/elbow-after-left-bow.png)
- [Melee attack close-up](weapon-qa/elbow-after-sword-cut.png)
- [Final design view](weapon-qa/elbow-after-bow-front.png)
- [Motion capture](weapon-qa/elbow-after-cases.webm)

Captures use the production SettlementCrowdRenderer in the weapon review
fixture, Three.js 0.185.1 / WebGPU, 1280×1000, DPR 1, seed 431, animation
time 0.35, bow phase 0.75 and sword phases 0.4 / 0.8. The fixture has no
post-processing. Close, design, far and seed 4294967295 views are recorded
in `weapon-qa/elbow-after-cases-report.json`, including camera transforms
and the render-target / memory inventory. The draw-call counter in this
fixture is cumulative, not a per-frame measurement.

Final motion capture ran bow for 5 seconds, spear / sword / halberd for
4 seconds each, and crossbow for 7 seconds, with no browser errors.
GPU timings were not measured. The model still has one mesh and one material:
the change adds 126 vertices and 42 triangles (9973 → 10015), no draw
submissions, bones, textures or render targets. The source cuff silhouettes
remain polygonal at extreme inspection magnification.

## Validation

- `testMaleVillagerElbows.mts`: every elbow edge has two neighboring faces;
  normalized patch normals; patch boundaries stay attached over 404 bow,
  sword, spear and crossbow attack poses.
- `testCustomWeaponAttacks.mts`: passes for all three humanoid rigs and
  every military equipment kind.
- `testMilitaryHandGrip.mts`: passes for all three rigs.
- `testAuthoredSkinnedInstanceBatch.mts`: GPU skinning / WGSL contract passes.
- `tsc --noEmit`: passes.
- Binary comparison against the pre-repair asset confirms all original
  geometry, texture, inverse-bind and animation buffer bytes are retained.
- `testAgentVisualAssets.mts` reaches the existing delivery-cart assertion
  `Firewood split log 1 should cast shadows`. This also fails with the
  original, unrepaired male asset.

The installed GLB includes repair metadata and the pre-repair SHA-256.
`scripts/repairMaleVillagerElbows.mts [original-source.glb]` reproduces the
repair. Running it without a source on the already repaired asset is a no-op.
