# Architecture-kit validation

## Repository pipeline

Run from the repository root:

```powershell
& .\.agents\skills\architecture-kit-codex\scripts\run_kit.ps1
```

The runner locates Blender, regenerates the kit, validates the saved blend, round-trips the GLB in a clean scene, and renders the overview plus every family sheet.

Equivalent direct commands:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' --background --factory-startup --python-exit-code 1 --python art-source\gorski-architecture-kit\build_kit.py
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' --background art-source\gorski-architecture-kit\out\gorski_architecture_kit.blend --python-exit-code 1 --python art-source\gorski-architecture-kit\validate_kit.py
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' --background --factory-startup --python-exit-code 1 --python art-source\gorski-architecture-kit\validate_roundtrip.py
& 'C:\Program Files\Blender Foundation\Blender 5.1\blender.exe' --background art-source\gorski-architecture-kit\out\gorski_architecture_kit.blend --python-exit-code 1 --python art-source\gorski-architecture-kit\render_kit.py
```

## Required pass conditions

- `validation.json` status is `pass` with zero errors.
- Authoritative building coverage count equals catalog count.
- All coverage part references resolve.
- Part IDs are unique and vertex hashes match the manifest.
- All parts use canonical scale, are unparented, and carry family/origin/era metadata.
- Geometry is finite, non-empty, within budget, non-degenerate, and topologically documented.
- GLB `partsImported` equals `partsExpected` with zero errors.
- `renders/00-overview.png` and one numbered sheet per manifest family exist.
- The overview and all family sheets have been visually inspected after the last source change.

## Failure handling

Repair generators, spec, registry, or coverage data. Rebuild from scratch and rerun all affected checks. Do not patch the output blend by hand and do not weaken a validator merely to silence a genuine defect.

Topology allowances must be per-part metadata and narrowly justified. Warnings count as unresolved evidence until reviewed.
