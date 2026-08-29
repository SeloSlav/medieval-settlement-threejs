# Hunter's Camp example

This is the atlas-textured Blender/GLB assembly for the authoritative runtime key `hunters_hall`. Its visual identity is intentionally an open Hunter's Camp rather than an enclosed lodge.

The canonical exported asset contains one correctly oriented, guyed A-frame sewn-linen tent with clean unsupported entrance flaps, a low asymmetric processing fly made from stitched weathered hides, a planked field worktable with dressing knife, stone hearth with four fixed cribbed fuel logs and an unladen ground-planted cooking tripod, a clean empty sapling utility frame, an empty chopping block, plain wooden buckets, sparse service supplies, and an open low boundary. The tent uses the production building atlas; the fly uses a dedicated repeatable PBR hide surface. It contains no fixed cooking hook, axe, hanging bows, snares, deer or other harvested-game mesh, no stocked firewood pile, no baked flame or smoke, and no living vegetation. SeedThree owns vegetation; runtime activity and inventory systems own transient state.

The v8 gameplay retopology is authored at 3,000-4,000 triangles. It retains the same silhouettes, UVs, materials, and fixed component inventory while using five-sided sapling profiles, lower-density but still deformed canvas/hide grids, and no blanket export bevel. Texture normal maps retain the small surface detail; automatic decimation is not used.

Build from the generated kit library:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' --background '..\..\out\gorski_architecture_kit.blend' --python-exit-code 1 --python '.\build_hunters_camp.py'
```

Validate the source assembly and exported GLB:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' --background '.\out\hunters_camp_textured_v8.blend' --python-exit-code 1 --python '.\validate_hunters_camp.py'
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' --background --factory-startup --python-exit-code 1 --python '.\validate_hunters_camp_roundtrip.py'
```

Outputs:

- `out/hunters_camp_textured_v8.blend`
- `out/hunters_camp_textured_v8.glb`
- `out/hunters_camp_assembly_v8.json`
- `out/hunters_camp_validation_v8.json`
- `out/hunters_camp_roundtrip_validation_v8.json`
- `renders/hunters_camp_hero_v8.png`
- `renders/hunters_camp_overhead_v8.png`
- `renders/hunters_camp_workside_v8.png`
- `renders/hunters_camp_tent_detail_v8.png`
- `renders/hunters_camp_hide_shelter_detail_v8.png`
- `renders/hunters_camp_tools_detail_v8.png`
- `renders/hunters_camp_chopping_block_detail_v8.png`
