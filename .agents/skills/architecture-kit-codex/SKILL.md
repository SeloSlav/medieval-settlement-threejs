---
name: architecture-kit-codex
description: Build, extend, audit, and export modular Blender architectural component kits for games. Use when a task calls for snap-together walls, authored fractional bays, roofs, openings, frames, foundations, fences, site works, production or extraction hardware, regional architectural vocabularies, Blender asset libraries, GLB delivery, catalog coverage, or architecture-kit validation. Do not use to model one finished building when a reusable component system is not required.
---

# Architecture Kit Codex

Produce a construction vocabulary, not a disguised collection of finished buildings. Every output component must be independently placeable, dimensionally explicit, deterministic, and traceable to the brief.

## Start from the project brief

Inspect the repository and supplied references before asking questions. Treat a concrete local objective, locked visual-language document, build catalog, or existing kit spec as sufficient input. Ask only when a missing choice would materially change the kit.

Before authoring geometry, establish:

- locale and date range;
- engine axes, units, grid, public face, origin, and transform rules;
- construction systems and shared material palette;
- all target structure categories, including non-building systems such as roads, bridges, fences, yards, mines, fields, and burial grounds;
- delivery formats, triangle budgets, and evidence requirements.

Read [references/method.md](references/method.md) for the generic architecture-kit method. In this repository, also read [references/gorski-contract.md](references/gorski-contract.md) before changing the Gorski kit.

## Make the catalog the coverage oracle

Extract the authoritative structure list from code or data. Build a coverage ledger whose keys match that catalog exactly, then add separately named supplemental systems for residences, fields, gardens, roads, and other placeable categories. Each row must cite multiple reusable part IDs and explain the intended architectural identity.

Never claim completeness from a large part count alone. Completeness means:

1. every authoritative category has a coverage row;
2. every referenced part exists;
3. every category has a recognizable signature module when its function calls for one;
4. generic walls and roofs are shared instead of cloned per building;
5. no individual finished-building assembly is included.

## Freeze a kit contract

Put shared constants in a small spec module and treat them as law:

- one authored unit scale;
- a base grid plus authored half and quarter fractions;
- fixed storey, wall-thickness, roof-pitch, overhang, and structural-section families;
- named opening contracts shared by host walls and inserts;
- canonical origins and seam metadata;
- a shared material-key palette;
- per-part triangle budgets and deterministic seeds.

Do not use non-uniform object scale as a substitute for authored dimensions. Do not bake display layout into mesh coordinates. Arrange components with object translations while keeping local geometry and object scale canonical.

## Author semantic component families

Prefer a registry of semantic `PartDefinition` records and small deterministic mesh-builder functions. Include the families the coverage ledger actually requires; a complete settlement kit commonly needs:

- foundations and slope adapters;
- wall systems, authored fractions, corners, and gable infills;
- posts, beams, braces, portals, galleries, and lean-tos;
- host walls and matching door, window, hatch, louver, and gate inserts;
- roof panels, ridges, eaves, verges, valleys, dormers, snow fittings, and material variants;
- fences, corners, person gates, cart gates, palisades, and parish walls;
- canopies, stalls, wells, docks, bridges, walkways, culverts, grave markers, and camps;
- mining and quarry collars, portals, supports, headframes, derricks, hoists, benches, and stockpiles;
- production equipment whose silhouette communicates function;
- agricultural infrastructure, civic, religious, defence, storage, and logistics modules; when the project assigns vegetation to a separate generator, keep every living plant outside the architecture kit;
- state props only when they support readable construction or gameplay states.

Use plausible real construction and regional materials. Avoid importing a familiar style shorthand merely because it is easy to proceduralize.

## Work in independent passes

Run these passes separately, even when one Codex agent performs them:

1. **Builder:** generate the components and manifest from the frozen contract.
2. **Auditor:** measure IDs, transforms, dimensions, materials, topology, hashes, budgets, and catalog coverage without editing the build.
3. **Round-trip auditor:** export GLB, import it into a clean Blender scene, and compare counts and metadata.
4. **Visual critic:** render fixed overview and family sheets; inspect readability, framing, collisions, accidental assemblies, and regional coherence.
5. **Repair:** fix the source generators and repeat all affected checks.

Do not let a passing script replace visual inspection. Do not let an attractive sheet replace structural validation.

## Deliver reproducible artifacts

The project should retain:

- source generators and registry;
- the frozen spec and coverage ledger;
- a machine-readable manifest with part IDs, families, tags, seams, materials, dimensions, budgets, hashes, and display positions;
- the `.blend` asset library and `.glb` export;
- structural and GLB round-trip reports;
- an overview plus one render sheet per component family;
- a concise README with build and validation commands.

Use [scripts/run_kit.ps1](scripts/run_kit.ps1) for the repository's complete Blender pipeline. Read [references/validation.md](references/validation.md) when adding checks, debugging a failure, or interpreting a report.

## Stop only at evidence-backed completion

Completion requires all structural checks to pass, the GLB round-trip to preserve every component, all expected family sheets to exist, and the final images to have been inspected. Report exact part/family/category counts and link the `.blend`, `.glb`, manifest, reports, and overview.
