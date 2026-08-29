# Authored Mineworks

This example assembles the architecture kit's reusable extraction, sitework,
and prop components into the game's permanent `mine` / Mineworks structure.
It is a source-authored Blender/GLB replacement for the legacy Three.js shell,
not a new component family or a baked gameplay state.

The canonical GLB contains the guarded shaft, timber headframe, road-facing
walkway, integral hand-winding headframe, sorting shelter, and empty fixed equipment.
Iron, salt, clay, replacement supports, civilian tools, workers, motion, dust,
sound, deposit depletion, and all vegetation remain runtime-owned.

Build from the repository root:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' --background art-source\gorski-architecture-kit\out\gorski_architecture_kit.blend --python-exit-code 1 --python art-source\gorski-architecture-kit\examples\mineworks\build_mineworks.py
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' --background art-source\gorski-architecture-kit\examples\mineworks\out\mineworks_textured_v1.blend --python-exit-code 1 --python art-source\gorski-architecture-kit\examples\mineworks\validate_mineworks.py
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' --background --factory-startup --python-exit-code 1 --python art-source\gorski-architecture-kit\examples\mineworks\validate_mineworks_roundtrip.py
```

Outputs include the `.blend`, `.glb`, assembly manifest, source validation
report, round-trip report, and six fixed-view PNGs under `out/` and `renders/`.
