# Fishing Camp authored assembly

This example assembles the authoritative `fishing_camp` building from the modular Gorski Kotar architecture kit. It is an original two-building inland fishery informed by, but not copied from, the supplied Manor Lords composition reference.

## Visual contract

- Identity: a four-metre fish house, a smaller two-metre plank service shed, permanent drying equipment in a clear side aisle, a split-rail rear yard, and one well-authored river craft.
- Silhouette: the main 50-degree roof leads; the smaller roof steps down; a hollow double-ended dugout grounded below and leaning against the rear-west fence is the signature feature.
- Materials: low gathered fieldstone, warm restrained limewash only on the public facade, dark structural oak, weathered boards, and hand-split fir/pine shingles.
- Invariants: two readable buildings; literal doors/window; one Tier-1-residence stone-block step beneath each door; lifted roof skins and protective verges fully cover the gable-edge timbers; the main-house collars terminate against both gable rake frames; five split-rail modules enclose the rear and sides with at least 0.65 m building clearance while the road frontage remains open; the east-side drying station and paired wash buckets clear both door approaches; the boat remains hollow, bears on grade, and contacts the rear-west rail; the drying rack remains empty for separately authored catch models; no living vegetation or water is embedded.
- Camera envelope: near boat/work details, 12–16 m design views, and 18 m overhead settlement read.
- Allowed divergence: the reference's exact footprint, roof proportions, fence layout, and boat pose are deliberately not copied.
- Runtime budget: 2.5k–4.5k triangles before batching, shared production atlas, no export bevel modifiers, no animation or dedicated render targets.

## Source and outputs

- `build_fishing_camp.py` is the source-of-truth assembly generator.
- `validate_fishing_camp.py` audits source geometry, construction coverage, materials, UVs, bounds, and topology.
- `validate_fishing_camp_roundtrip.py` reimports the exported GLB and verifies retained roles/material metadata.
- `out/fishing_camp_textured_v7.blend` is the editable authored scene.
- `out/fishing_camp_textured_v7.glb` is the embedded-texture source delivery with joint-free gathered-stone foundations widened beneath every timber edge.
- Runtime compaction externalizes the already resident shared building atlas into `public/assets/models/buildings/gorski/fishing_camp_textured_v7.glb`.

Fresh catch, stockpile quantity, characters, water, weather, and living vegetation remain runtime-owned state.
