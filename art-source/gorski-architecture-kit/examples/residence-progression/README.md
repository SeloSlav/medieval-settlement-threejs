# Residence progression example

This example converts the useful massing ideas from the supplied Tier 1–4
reference GLBs into native Gorski Kotar residence assemblies. The reference
meshes, UVs, textures, and materials are not copied. Every production object is
either an independently placeable component from `gorski-architecture-kit-1.1.0`
or an assembly-specific low-poly roof skin that retains the kit's metric UV and
semantic material contract.

The progression is:

- Tier 1: existing compact `tier1_residence_retopo_v28` kit assembly;
- Tier 2: larger stone-and-timber gabled house with one chimney;
- Tier 3: tall stone lower storey, limewashed upper storey, gallery, annex, and
  two chimneys;
- Tier 4: deeper high-status stone/limewash house with clay tile, gallery,
  covered dormer, and restrained civic trim.

Build Tiers 2–4 from the repository root, starting from the source kit library:

```powershell
$env:GK_RESIDENCE_TIER = '2'
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' `
  --background 'art-source\gorski-architecture-kit\out\gorski_architecture_kit.blend' `
  --python 'art-source\gorski-architecture-kit\examples\residence-progression\build_residence_tier.py'
```

Repeat with `GK_RESIDENCE_TIER` set to `3` and `4`. Each build writes an
editable `.blend`, game-ready `.glb`, assembly manifest, native validation
report, and fixed hero/front/rear renders.

Run `validate_residence_roundtrip.py` with the same `GK_RESIDENCE_TIER` value
under `--factory-startup` after each build. It re-imports the runtime GLB and
checks placement count, triangle count, metric UVs, semantic materials, and
component provenance independently of the source scene.
