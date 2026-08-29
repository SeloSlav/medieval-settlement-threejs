# Mining Camp authored assembly

This is the production-quality `stone_quarry` visual: a low, mobile day-work camp for finite surface stone, iron, salt, and clay deposits. It is deliberately distinct from the centered deep `mine` / Mineworks silhouette.

The neutral GLB contains only fixed architecture and work equipment:

- sewn canvas A-frame sleeping/day shelter;
- open four-post canvas sorting canopy;
- separate sorting bench and sieve table;
- handcart, quarry tool rack, water buckets, and survey markers.

Stone, iron, salt, clay, civilian-tool inventory, workers, dust, sound, and deposit-specific ground dressing are runtime-owned. Living vegetation is excluded because SeedThree owns it.

Build from the canonical kit blend:

```powershell
$env:GK_MINING_CAMP_OUTPUT_ROOT = (Resolve-Path '.codex-tmp/mining-camp-v1')
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' --background `
  'art-source/gorski-architecture-kit/out/gorski_architecture_kit.blend' `
  --python 'art-source/gorski-architecture-kit/examples/mining-camp/build_mining_camp.py'
```

Validate the source blend and exported GLB by running `validate_mining_camp.py` against the generated blend and `validate_mining_camp_roundtrip.py` in an empty Blender process.
