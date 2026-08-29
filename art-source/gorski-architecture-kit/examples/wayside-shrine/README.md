# Wayside Shrine authored assembly

This example assembles the authoritative `wayside_shrine` from the modular Gorski Kotar architecture kit. It is a compact roadside `poklonac`: a limewashed masonry niche, exposed local stone, a timber gable canopy, hand-split softwood shingles, and a forged iron ridge cross.

## Visual contract

- Identity: tiny gabled devotional niche rather than a miniature chapel or freestanding fantasy monument.
- Signature silhouette: the steep shingle cap and iron ridge cross above a recessed Marian icon.
- Materials: weather-darkened fieldstone, warm limestone, aged limewash, dark oak, split fir/pine shingles, iron, and restrained blue/ochre devotional pigment.
- Construction: nine canonical kit components at unit scale; the canopy visibly carries the roof; the cross is anchored to the ridge; the icon stays inside the masonry recess; a reusable limewashed rear closure and one worn limestone tread complete the roadside object.
- State boundary: the built-in icon insert supplies the permanent votive ledge, so no duplicate votive component is added. Characters, vegetation, weather effects, and inventory remain runtime-owned.
- Camera envelope: readable at settlement distance, front/rear working views, and close devotional inspection.
- Runtime budget: 1,000–1,800 triangles, shared production atlas only, no dedicated render targets or animation.

## Source and outputs

- `build_wayside_shrine.py` is the source-of-truth assembly generator.
- `validate_wayside_shrine.py` audits component provenance, transforms, topology, materials, UVs, silhouette bounds, and state boundaries.
- `validate_wayside_shrine_roundtrip.py` reimports the exported GLB and verifies retained roles and atlas metadata.
- `out/wayside_shrine_textured_v1.blend` is the editable authored scene.
- `out/wayside_shrine_textured_v1.glb` is the embedded-atlas source delivery.
- Runtime compaction externalizes the shared building atlas into `public/assets/models/buildings/gorski/wayside_shrine_textured_v1.glb`.
