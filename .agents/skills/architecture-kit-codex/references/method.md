# Modular architecture-kit method

This is the Codex adaptation of Lunarsong's `architecture-kit` method. The upstream source is vendored at `vendor/architecture-kit-upstream` at revision `bf2d7a0f2912807afe7d2477c515a5d024e8232f` under the MIT license.

## The core distinction

A modular kit is a set of semantic construction parts governed by one dimensional contract. A scene containing several complete buildings is not a kit, even when those buildings share a material.

The strongest test is counterfactual: can the same wall, opening, frame, roof, and site modules create substantially different layouts without scaling or cutting them?

## Spec first

Write a `KitSpec` before geometry. It should define axes, units, base grid, authored fractions, storey families, structural sections, wall thicknesses, roof slopes, overhangs, opening contracts, origin rules, seam rules, palette keys, and budgets.

Keep a red-line rule: if a piece needs a new dimension, add that dimension to the contract or explicitly document the exception. Do not introduce silent near-duplicates.

## Origins and seams

A wall commonly uses X along the run, Y through its depth, and Z up. A host-wall origin belongs at bay center on grade. Opening inserts use the same public face and sill contract as their hosts. Roof pieces expose explicit eave, ridge, verge, and valley seams.

Record seam names in metadata. Treat the origin and seam contract as a public API.

## Authored fractions

Generate half and quarter pieces at their final sizes. Scaling a 2 m bay to 1 m changes structural-member widths, trims, reveals, profiles, and texture density. An authored fraction preserves those relationships.

## Determinism

Seed each part from its stable part ID. Procedural irregularity may vary stones, boards, or stockpiles within a part, but rebuilding the same ID must reproduce the same vertex hash.

## Semantic registry

Use data records with stable ID, family, label, tags, builder, seams, optional opening contract, topology allowance, triangle budget, and provenance. Reject duplicate IDs at registration time.

This enables automatic manifests, coverage validation, contact-sheet selection, and future engine importers.

## Coverage-led breadth

Start from the target catalog. Shared envelope families provide reusable breadth; category-specific signatures provide gameplay readability. A mine needs collars, portals, supports, headframes, and hoists. A watermill needs its wheel, axle, and gearing. A chapel needs its apse, lancet, door, and belfry. A pasture needs spans, gates, and animal fittings.

## Audit loop

Separate build, structural audit, GLB round-trip, and visual critique. A repair changes source generators, never only the generated `.blend`.

Structural checks should cover catalog keys, reference resolution, duplicate IDs, scales, parenting, metadata, material ownership, non-finite coordinates, empty geometry, topology, degeneracy, loose vertices, budgets, deterministic hashes, and authored-fraction seam metadata.

Visual checks should use fixed contact sheets with natural relative scale. Inspect every family, not only hero props.
