# Gorski Kotar / Primorje 1550 modular architecture kit

This directory contains the source, Blender asset library, GLB export, coverage ledger, validation reports, and visual evidence for the game's reusable architectural component kit.

It intentionally contains no assembled finished buildings. The 620 components are designed to combine into the game's full built vocabulary while retaining canonical local geometry and scale.

## Scope

- 12 component families: foundations, walls, frames, openings, roofs, enclosures, site works, extraction, production, agriculture, civic, and props.
- 44/44 authoritative `BUILDING_KINDS` from `src/generated/gameBalance.ts` have explicit multi-part coverage.
- 34 supplemental categories cover five residence tiers, non-living SeedThree placement/support interfaces for all six authoritative `FARM_CROP_KINDS`, all 17 authoritative `BACKYARD_GARDEN_KINDS`, road, bridge, burial ground, pasture, vineyard, and dry-stone wall systems. Validation requires exact key equality with those generated catalogs, not only matching counts.
- Mining includes shaft collars, headframes, portals, tunnel supports, hoists, ore buckets, sorting benches, survey stakes, stockpiles, and quarry-specific lifting/cutting equipment.
- Enclosures include authored 1 m, 2 m, and 4 m spans, corners, person gates, and cart gates for split rail, wattle, dry stone, palisade, and parish-wall systems.
- Roofs are construction-specific rather than recolored slabs: bound thatch with fringe/ridge/smoke-vent parts, overlapping split shingles, laid clay tiles, repair patches, eaves, verges, ridges, hips, half-hips, dormers, flashing, valleys, apse roofs, belfry roofs, and shrine roofs.
- Religious architecture includes nave and facade bays, quoins, cornices, restrained folk gable trim, buttresses, sacristy and apse junctions, multiple lancet/oculus/louver forms, portals, belfries, bells, crosses, monastery cells/cloisters, and a componentized wayside-shrine set.
- Living vegetation is deliberately excluded. SeedThree owns all crops, trees, vines, flowers, herbs, and other plants; this kit supplies only non-living attachment interfaces such as crop-row anchors, trellises, guards, markers, cold frames, fences, and equipment.

## Contract

- Units: metres.
- Axes: X run, Y depth, Z up.
- Base grid: 2 m with authored 1 m and 0.5 m fractions.
- Wall public face: Y=0, body toward +Y.
- Nominal regional roof pitch: 50 degrees.
- Object scale remains `(1, 1, 1)`; display layout uses object translations only.
- Part IDs seed deterministic procedural variation and are hashed in the manifest.
- Every mesh has a deterministic metre-scaled `GK_UV0` map (1 UV unit per metre), shared PBR material slots, and a `baseColor + normal + ORM` texture contract.
- Authored seams are exported as snap-socket metadata for later procedural assembly.

## Build and verify

From the repository root:

```powershell
& .\.agents\skills\architecture-kit-codex\scripts\run_kit.ps1
```

The pipeline rebuilds the `.blend` and `.glb`, validates all coverage and mesh contracts, imports the GLB into a clean Blender scene, and renders the overview, 12 family sheets, a religious-detail sheet, and a residence-roof-progression sheet.

## Deliverables

- `out/gorski_architecture_kit.blend` — Blender 5.1 asset library; every component is marked as an asset.
- `out/gorski_architecture_kit.glb` — engine-neutral export with part metadata in glTF extras.
- `out/gorski_architecture_kit_manifest.json` — parts, dimensions, materials, seams, budgets, hashes, provenance, and category coverage.
- `out/validation.json` — native blend validation.
- `out/roundtrip-validation.json` — clean-scene GLB re-import validation.
- `renders-release/00-overview.png` and family sheets plus `13-religious-detail.png` and `14-residence-roof-progression.png` — fixed, visually inspected QA evidence.

## Provenance

The workflow adapts [Lunarsong/architecture-kit](https://github.com/Lunarsong/architecture-kit) at revision `bf2d7a0f2912807afe7d2477c515a5d024e8232f`. The upstream source is retained at `vendor/architecture-kit-upstream`, and its MIT license is copied into the Codex skill.

The regional construction language follows `docs/design/building-visual-language.md`, the game's existing building generators and references, a scholarly source on traditional Gorski Kotar houses (`https://hrcak.srce.hr/file/264086`), and Croatian mining-history context (`https://enciklopedija.hr/clanak/rudarstvo`).
