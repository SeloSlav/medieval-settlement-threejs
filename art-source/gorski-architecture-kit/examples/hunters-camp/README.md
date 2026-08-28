# Hunter's Camp example

This is the atlas-textured Blender/GLB assembly for the authoritative runtime key `hunters_hall`. Its visual identity is intentionally an open Hunter's Camp rather than an enclosed lodge.

The canonical exported asset contains one guyed A-frame canvas tent, a sagging canvas processing canopy, field worktable, stone hearth and cooking tripod, hunter bow/snare rack, sparse service supplies, and an open split-rail edge. It contains no deer or other harvested-game mesh, no stocked firewood, no baked flame or smoke, and no living vegetation. SeedThree owns vegetation; runtime activity and inventory systems own transient state.

Build from the generated kit library:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' --background '..\..\out\gorski_architecture_kit.blend' --python-exit-code 1 --python '.\build_hunters_camp.py'
```

Validate the source assembly and exported GLB:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' --background '.\out\hunters_camp_textured.blend' --python-exit-code 1 --python '.\validate_hunters_camp.py'
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' --background --factory-startup --python-exit-code 1 --python '.\validate_hunters_camp_roundtrip.py'
```

Outputs:

- `out/hunters_camp_textured.blend`
- `out/hunters_camp_textured.glb`
- `out/hunters_camp_assembly.json`
- `out/hunters_camp_validation.json`
- `out/hunters_camp_roundtrip_validation.json`
- `renders/hunters_camp_hero_v1.png`
- `renders/hunters_camp_overhead_v1.png`
- `renders/hunters_camp_workside_v1.png`
