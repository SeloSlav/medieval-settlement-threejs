# Hunter's Camp example

This is the atlas-textured Blender/GLB assembly for the authoritative runtime key `hunters_hall`. Its visual identity is intentionally an open Hunter's Camp rather than an enclosed lodge.

The canonical exported asset contains one correctly oriented, guyed A-frame sewn-linen tent, a low asymmetric processing fly made from stitched weathered hides, a planked field worktable with dressing knife, stone hearth and cooking tripod, crooked-sapling bow/snare rack, chopping block with forged axe, sparse service supplies, and an open split-rail edge. The tent uses the production building atlas; the fly uses a dedicated repeatable PBR hide surface. It contains no deer or other harvested-game mesh, no stocked firewood, no baked flame or smoke, and no living vegetation. SeedThree owns vegetation; runtime activity and inventory systems own transient state.

Build from the generated kit library:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' --background '..\..\out\gorski_architecture_kit.blend' --python-exit-code 1 --python '.\build_hunters_camp.py'
```

Validate the source assembly and exported GLB:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' --background '.\out\hunters_camp_textured_v4.blend' --python-exit-code 1 --python '.\validate_hunters_camp.py'
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' --background --factory-startup --python-exit-code 1 --python '.\validate_hunters_camp_roundtrip.py'
```

Outputs:

- `out/hunters_camp_textured_v4.blend`
- `out/hunters_camp_textured_v4.glb`
- `out/hunters_camp_assembly_v4.json`
- `out/hunters_camp_validation_v4.json`
- `out/hunters_camp_roundtrip_validation_v4.json`
- `renders/hunters_camp_hero_v4.png`
- `renders/hunters_camp_overhead_v4.png`
- `renders/hunters_camp_workside_v4.png`
- `renders/hunters_camp_tent_detail_v4.png`
- `renders/hunters_camp_hide_shelter_detail_v4.png`
- `renders/hunters_camp_tools_detail_v4.png`
- `renders/hunters_camp_axe_detail_v4.png`
