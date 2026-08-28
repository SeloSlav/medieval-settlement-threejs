# Tier 1 residence example

This example assembles a finished, compact Gorski Kotar residence from the reusable architecture kit without modifying the source asset library.

The building uses a continuous fieldstone footing, clay-lime daub infill within an exposed timber frame, true service-door and shuttered-window openings, plastered framed gables, a deep two-course bundled-thatch roof, authored eave and ridge junctions, and a bound-thatch smoke hood. A masonry chimney is intentionally absent at this tier. Living vegetation and crops are excluded; SeedThree owns those systems.

Every architectural material is driven by the production `gorski-building-atlas-v1` albedo, OpenGL normal, and packed material maps. The Blender file packs those images for portability while retaining the atlas tile and scale metadata on each material.

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
