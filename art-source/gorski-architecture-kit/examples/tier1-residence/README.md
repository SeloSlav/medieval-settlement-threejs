# Tier 1 residence example

This example assembles a finished, low Tier 1 Gorski Kotar residence from the reusable architecture kit without modifying the source asset library.

The 4 × 7 m body uses a closed fieldstone footing, rough daub on the public front, horizontal timber boarding on the sides and rear, timber gables, and a restrained structural frame. Four shortened corner posts terminate inside the roof-bearing envelope, while the central front post remains full height beneath the gable baseline. Two closed retopologized roof skins carry the production split-softwood-shingle atlas and meet on one shared, irregular capless apex. There is no separate ridge joist, ridge cap, exterior fascia, or exposed rafter. The settlement remains visible at the ridge and hanging eaves but is pinned to the ±2 m bearing lines. Its concealed 12.6 cm build-up represents shingles plus boarding/laths and prevents wall or support geometry from leaking through the exterior skin. Light and air enter through literal 38–42 cm unglazed square apertures. The smoke exit is a true topological void through the right roof skin, not a dark surface mesh.

The native assembly is 3,136 triangles, including 2,016 roof triangles. The exported GLB re-imports as 5,184 triangles and remains below the 9,000-triangle residence budget.

The material hierarchy follows the documented timber-first Gorski Kotar vernacular: wood body, low stone base, split fir or pine roofing, and minimal ornament. The fieldstone footing now uses a named darker, moisture-stained material variant and the daub front adds blotchy wear with stronger accumulation near grade. These variants preserve the shared clean atlas tiles for maintained and later-tier buildings rather than globally aging every use. The current atlas is sufficient for this pass. Two future additions would improve close-view specificity: hand-split softwood wall boarding and coarse clay-straw daub.

This artifact is the neutral architectural shell. `ResidenceMarkers` owns the state-driven firewood pile, its stock-dependent fill, smoke activation, and occupied window glow; none of those states are baked into the `.blend` or preview. Living vegetation and crops are also excluded because SeedThree owns those systems.

Every architectural material is driven by the production `gorski-building-atlas-v1` albedo, OpenGL normal, and packed material maps. Horizontal boarding is produced by rotating the metric UV sampling of the existing weathered-plank tile, not by introducing a one-off texture. The Blender file packs the atlas images for portability while retaining tile, scale, and orientation metadata on each material.

The build writes both the editable packed `.blend` and a game-ready `.glb`. Preview staging, cameras, and lights are excluded from the GLB; only the neutral architectural shell and its fixed stone threshold are exported.

Build from the repository root:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' `
  --background 'art-source\gorski-architecture-kit\out\gorski_architecture_kit.blend' `
  --python 'art-source\gorski-architecture-kit\examples\tier1-residence\build_tier1_residence.py'
```

Outputs:

- `out/tier1_residence_retopo_v28.blend` — editable assembly with packed atlas images and separated staging.
- `out/tier1_residence_retopo_v28.glb` — game-ready shell with joint-free gathered-stone foundations widened beneath every timber edge.
- `out/tier1_residence_assembly_v28.json` — placements, dimensions, atlas references, and tier decisions.
- `renders/tier1_residence_hero_retopo_v28.png` — fixed hero preview.
- `renders/tier1_residence_front_retopo_v28.png` and `renders/tier1_residence_side_retopo_v28.png` — alignment-check views.

Validate the generated Blender artifact:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' `
  --background 'art-source\gorski-architecture-kit\examples\tier1-residence\out\tier1_residence_retopo_v28.blend' `
  --python 'art-source\gorski-architecture-kit\examples\tier1-residence\validate_tier1_residence.py'

& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' `
  --background --factory-startup --python-exit-code 1 `
  --python 'art-source\gorski-architecture-kit\examples\tier1-residence\validate_tier1_residence_roundtrip.py'
```

The validators write `out/tier1_residence_validation_v28.json` and `out/tier1_residence_roundtrip_validation_v28.json` with topology, UV, unit-scale, aperture, atlas, structural-footprint containment, triangle-budget, metadata, and runtime-dressing checks.
