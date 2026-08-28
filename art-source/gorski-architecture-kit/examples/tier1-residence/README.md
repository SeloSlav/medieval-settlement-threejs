# Tier 1 residence example

This example assembles a finished, low Tier 1 Gorski Kotar residence from the reusable architecture kit without modifying the source asset library.

The 4 × 7 m body uses a low continuous fieldstone footing, a rough daub public front, horizontally oriented weathered timber boarding on the sides and rear, timber gables, and a deliberately restrained frame. Its 2.4 m wall body is subordinate to a steep, dark, three-course bundled-thatch roof with approximately 0.70 m side-eave and 0.50 m gable-end overhangs. Dark sloped verge rafters and short projecting lookouts visibly carry those overhangs. The thatch receives deterministic 7–11 cm longitudinal sag, side-specific eave droop, and skewed low points; deformation returns to zero at modular run seams so the roof hangs irregularly without opening cracks. Light and air enter through literal 38–42 cm unglazed square apertures rather than decorative window inserts. The only articulated opening is the low service door.

The material hierarchy follows the documented timber-first Gorski Kotar vernacular: wood body, low stone base, and minimal ornament. Bundled thatch remains an intentional Tier 1 game-progression cue; split fir or pine roofing is better documented for the region. The current atlas is sufficient for this pass. Two future additions would improve close-view specificity: hand-split softwood boarding and coarse clay-straw daub.

This artifact is the neutral architectural shell. `ResidenceMarkers` owns the state-driven firewood pile, its stock-dependent fill, smoke activation, and occupied window glow; none of those states are baked into the `.blend` or preview. Living vegetation and crops are also excluded because SeedThree owns those systems.

Every architectural material is driven by the production `gorski-building-atlas-v1` albedo, OpenGL normal, and packed material maps. Horizontal boarding is produced by rotating the metric UV sampling of the existing weathered-plank tile, not by introducing a one-off texture. The Blender file packs the atlas images for portability while retaining tile, scale, and orientation metadata on each material.

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
