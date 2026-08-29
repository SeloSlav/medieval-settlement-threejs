# Fishing Camp authored assembly

This example assembles the authoritative `fishing_camp` building from the modular Gorski Kotar architecture kit. It is an original two-building inland fishery informed by, but not copied from, the supplied Manor Lords composition reference.

## Visual contract

- Identity: a four-metre fish house, a smaller two-metre plank service shed, permanent drying equipment in a clear side aisle, a fully open workyard, and one well-authored river craft.
- Silhouette: the main 50-degree roof leads; the smaller roof steps down; a hollow double-ended dugout grounded at the rear shore edge is the sole signature feature.
- Materials: low gathered fieldstone, warm restrained limewash only on the public facade, dark structural oak, weathered boards, and hand-split fir/pine shingles.
- Invariants: two readable buildings; literal doors/window; lifted roof skins and protective verges fully cover the gable-edge timbers; the main-house collars terminate against both gable rake frames; the entire yard remains unenclosed; the east-side drying station and paired wash buckets clear both door approaches; the boat remains hollow and independently grounded; the drying rack remains empty for separately authored catch models; no living vegetation or water is embedded.
- Camera envelope: near boat/work details, 12–16 m design views, and 18 m overhead settlement read.
- Allowed divergence: the reference's exact footprint, roof proportions, fence layout, and boat pose are deliberately not copied.
- Runtime budget: 2.5k–4.5k triangles before batching, shared production atlas, no export bevel modifiers, no animation or dedicated render targets.

## Source and outputs

- `build_fishing_camp.py` is the source-of-truth assembly generator.
- `validate_fishing_camp.py` audits source geometry, construction coverage, materials, UVs, bounds, and topology.
- `validate_fishing_camp_roundtrip.py` reimports the exported GLB and verifies retained roles/material metadata.
- `out/fishing_camp_textured_v4.blend` is the editable authored scene.
- `out/fishing_camp_textured_v4.glb` is the embedded-texture source delivery.
- Runtime compaction externalizes the already resident shared building atlas into `public/assets/models/buildings/gorski/fishing_camp_textured_v4.glb`.

Fresh catch, stockpile quantity, characters, water, weather, and living vegetation remain runtime-owned state.
