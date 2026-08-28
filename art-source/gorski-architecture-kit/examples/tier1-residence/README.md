# Tier 1 residence example

This example assembles a finished, low Tier 1 Gorski Kotar residence from the reusable architecture kit without modifying the source asset library.

The 4 × 7 m body uses a low continuous fieldstone footing, a rough daub public front, horizontally oriented weathered timber boarding on the sides and rear, timber gables, and a deliberately restrained frame. Its 2.4 m wall body is subordinate to a steep, three-course hand-split softwood shingle roof with approximately 0.70 m side-eave and 0.50 m gable-end overhangs. The roof plane now bears directly at the top of the four-metre wall rather than floating above it. The continuous timber wall-head courses, six common rafter pairs, three tie beams, dark sloped verge rafters, and short projecting lookouts make the complete load path legible. Eight overlapping one-metre roof modules share a continuous settlement profile of up to 12.8 cm, with a slightly heavier right-side drop. Applying the same profile to every shingle, substrate, ridge, and eave vertex preserves contact while producing the crooked, locally hanging silhouette without stepped seams. Light and air enter through literal 38–42 cm unglazed square apertures rather than decorative window inserts. The only articulated opening is the low service door; the smoke exit is a small unadorned opening in the roof plane.

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

- `out/tier1_residence_textured.blend` — editable modular assembly with packed atlas images and clearly separated staging.
- `out/tier1_residence_assembly.json` — component placements, dimensions, atlas references, and tier-specific decisions.
- `renders/tier1_residence_hero.png` — fixed hero preview.
- `renders/tier1_residence_front.png` and `renders/tier1_residence_side.png` — alignment-check views.

Validate the generated Blender artifact:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' `
  --background 'art-source\gorski-architecture-kit\examples\tier1-residence\out\tier1_residence_textured.blend' `
  --python 'art-source\gorski-architecture-kit\examples\tier1-residence\validate_tier1_residence.py'
```

The validator writes `out/tier1_residence_validation.json` with topology, UV, unit-scale, aperture, atlas, triangle-budget, and runtime-dressing checks.
