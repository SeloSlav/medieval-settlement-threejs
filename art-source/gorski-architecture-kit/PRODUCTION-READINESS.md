# Production-readiness contract

This library is complete only as a reusable component vocabulary. It contains no finished building assemblies and no living vegetation.

## Required visual vocabularies

- Burgage/start tier: volumetric bound-thatch panels, tied ridge, exposed eave fringe, smoke vent, timber verge, humble wall/opening set.
- Established residence: overlapping split-shingle courses, ridge/eave/verge pieces, repair variants, covered dormer, flashing, chimney, gable truss, and curved brackets.
- Prosperous residence: laid clay tiles, ridge/eave/verge/end caps, repair variants, flashing, dormer cap, balcony/annex, gallery crowns, and fascia.
- High-status residence: tile hip and half-hip junctions, dormer, snow catch, carved finial, leaded casement, and restrained stone/civic trim.
- Parish church: modular nave and west-front bays, quoins, cornice/gable trim, buttresses, sacristy/apse junctions, lancets, paired lancets, oculus, belfry louver, portals, belfry transition/frame/bell, apse and belfry roofs, and iron/stone crosses.
- Wayside shrine: worn plinth, masonry niche, Marian icon insert, columns, votive ledge/candles, timber canopy, shingled gable roof, iron cross, steps, rail, fascia, and lattice.

The validator resolves these named sets independently of broad catalog coverage so a generic wall and roof cannot make a category appear complete.

## Texturing

Every component carries one deterministic `GK_UV0` layer using metric dominant-axis projection at one UV unit per metre. Materials expose shared slots for tileable/trim-sheet base color, tangent-space normal, and ORM textures. No unique baked textures are embedded yet; the GLB is ready for the game's existing building atlas/material pipeline or for later authored PBR maps without remodelling or re-unwrapping.

## SeedThree boundary

SeedThree is the sole owner of living vegetation: crops, orchard trees, vines, flowers, herbs, grass, and saplings. This kit may contain only non-living supports, boundaries, markers, containers, harvested/dried resource props, and attachment anchors. Validation fails if the removed crop-strip family or living vegetation tags/materials return.

## Evidence

- `out/validation.json`: native Blender mesh, coverage, UV, snap-contract, named-vocabulary, family-minimum, and SeedThree-boundary checks.
- `out/roundtrip-validation.json`: clean-scene GLB import, component/material/metadata/UV survival, and triangle budgets.
- `renders-release/13-religious-detail.png`: church, monastery, shrine, opening, roof, trim, bell, and cross components.
- `renders-release/14-residence-roof-progression.png`: thatch, shingle, tile, junction, dormer, half-hip, repair, and flashing progression.
