# Lumber mill authored assembly

This example assembles the authoritative `lumber_mill` from reusable Gorski Kotar kit modules. It replaces the legacy circular-saw lodge with a historically plausible hand-sawing hall for circa-1550 Gorski Kotar.

## Visual and state contract

- Signature silhouette: a long, low twelve-metre plank hall beneath a dominant six-metre, fifty-degree split-shingle gable, with a lower supported intake canopy facing the road.
- Structure: continuous low fieldstone footing, canonical plank bays, dark oak posts and plates, new reusable six-metre timber gables and king-post trusses, deep eaves, and protected verges.
- Function: a hand-sawpit and log frame, sawyers' tool rack, and timber transport cart communicate the trade without an anachronistic powered circular blade.
- Runtime state: stored roundwood remains five progressive `TimberStockSegment` groups controlled by actual mill storage. Workers, sawing motion, dust, sound, terrain, and SeedThree vegetation remain runtime-owned.
- Materials: shared fieldstone, rough oak, weathered/sawn planks, split shingles, wrought iron, and packed-earth atlas tiles; no building-specific runtime texture set.
- Runtime result: 3,632 source triangles and 335.1 KiB after shared-atlas compaction, with eleven deliberate collision aggregates and no collision slab across the open intake.

## Outputs

- `build_lumber_mill.py`: deterministic source assembly and fixed render views.
- `validate_lumber_mill.py`: source topology, provenance, bounds, atlas, state-boundary, and triangle checks.
- `validate_lumber_mill_roundtrip.py`: clean-scene GLB reimport contract.
- `out/lumber_mill_textured_v1.blend`: editable authored scene.
- `out/lumber_mill_textured_v1.glb`: embedded-atlas source delivery.
- `renders/lumber_mill_hero_v1.png`, `lumber_mill_intake_v1.png`, `lumber_mill_rear_v1.png`, and `lumber_mill_settlement_v1.png`: fixed Blender QA views.
- `renders/lumber_mill_runtime_design_v1.png`: validated WebGPU/Three.js lineup capture of the compacted runtime GLB.
- Runtime compaction externalizes the shared atlas to `public/assets/models/buildings/gorski/lumber_mill_textured_v1.glb`.
