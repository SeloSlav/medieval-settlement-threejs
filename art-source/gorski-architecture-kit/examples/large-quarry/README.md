# Large Quarry authored assembly

This example assembles the authoritative `large_quarry` building from the modular Gorski Kotar architecture kit.

## Visual contract

- Identity: a permanent rich-stone open cut, substantially larger and more infrastructural than the mobile Mining Camp while remaining distinct from underground Mineworks.
- Signature silhouette: one large hand-built timber derrick inside a continuous U-shaped stepped quarry face.
- Materials: cool exposed quarry stone, restrained fieldstone retaining work, dark structural oak, weathered planks, split fir/pine shingles, and near-black iron.
- Fixed equipment: plank causeway, grounded hoist bucket, shingled sorting canopy, sorting bench, stonecutters' wedge rack, empty handcart, and fixed tool rack.
- Runtime-owned state: dressed-stone output, replacement support timber, civilian-tool inventory, workers, dust, sound, and deposit depletion.
- Invariants: five canonical bench modules remain continuous; the road-facing approach stays open; no broad display plinth; no canvas; no headframe, shaft, tunnel, or mine portal; no baked output stockpile; no living vegetation.
- Runtime budget: 7k–8k triangles before batching, shared production atlas, no export bevel modifiers, no animation or dedicated render targets.

## Source and outputs

- `build_large_quarry.py` is the source-of-truth assembly generator.
- `validate_large_quarry.py` audits source geometry, construction coverage, materials, UVs, bounds, topology, and runtime-state separation.
- `validate_large_quarry_roundtrip.py` reimports the exported GLB and verifies retained roles and material metadata.
- `out/large_quarry_textured_v1.blend` is the editable authored scene.
- `out/large_quarry_textured_v1.glb` is the embedded-texture source delivery.
- Runtime compaction externalizes the shared building atlas into `public/assets/models/buildings/gorski/large_quarry_textured_v1.glb`.
