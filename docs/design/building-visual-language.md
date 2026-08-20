# Building Visual Language

This document is the source of truth for settlement architecture. Read it before creating or substantially revising any building or residence model.

The canonical reference is the parish church (the legacy `chapel` kind) in `src/buildings/meshes/chapelMesh.ts`. New work should belong to the same village without copying the church literally.

## Locked direction

**Grounded Croatian/Gorski vernacular, stylized for strategy-camera readability.**

The settlement should feel built by local craftspeople from nearby limestone and timber, repaired over generations, and adapted to wet mountain weather. It is not high fantasy, storybook Tudor England, a pristine model village, or a photoreal historical reconstruction.

The image should feel warm, tactile, legible, and slightly irregular. Shapes are simplified, but construction should remain believable.

## Visual priorities

Judge every model in this order:

1. **Silhouette:** the building kind must be identifiable when small and untextured.
2. **Material blocks:** roof, wall, foundation, frame, and openings must separate clearly.
3. **Functional story:** visible props should explain what happens here.
4. **Craft detail:** close-range elements reward first-person inspection.

Do not trade silhouette clarity for more small geometry. Details that disappear at settlement zoom are supporting detail, never the main design.

## Shared shape grammar

- Prefer compact, useful footprints and steep roofs suited to rain and snow.
- Use deep eaves, visible ridge lines, and a strong roof-to-wall ratio.
- Anchor enclosed buildings with a structural foundation course and open worksites with terrain-contacting equipment.
- Do not place a broad circular or elliptical presentation plinth beneath a model. Functional excavations, shaft mouths, well curbs, and purpose-built masonry floors are allowed, but they must read as part of the worksite rather than as a display base.
- Use dark structural timber to frame pale walls and openings.
- Let civic buildings be more vertical; let production buildings spread horizontally.
- Use asymmetry through chimneys, lean-tos, stacked goods, porches, sheds, and work equipment.
- Allow modest hand-built irregularity: alternating stone sizes, slight rotations, uneven courses, and restrained color variation.
- Keep doors, windows, steps, tools, and carts believable relative to villagers.

### Shared façade openings

- Build doors and windows from the shared procedural façade-opening kit. A building specifies the face, anchor, width, and height; the kit owns recess depth, casing proportions, seams, sill, threshold, and hardware.
- Windows are clear recessed panes bounded by jambs, a lintel, and a projecting sill. Do not add a generic central plus, cross, mullion, or transom as decoration.
- Doors need a shadowed reveal, a visible timber leaf, narrow vertical plank seams, jambs, a lintel, a threshold, compact hinges, and a latch. Do not cover the leaf with generic full-width cross braces.
- Specialized profiles such as church lancets may author their own surround, but must expose the same semantic opening metadata and keep the pane or leaf visually unobstructed.
- Open work sites, market canopies, camps, pits, and similar unenclosed structures do not receive token doors or windows.

Every building gets one signature silhouette feature. Examples include the church belfry, the mill's long saw hall, a quarry derrick, or the well's shelter roof. Do not give every building a tower, cross-gable, or ornamental roof.

## Materials and color

Use `src/buildings/buildingMaterials.ts` as the palette authority.

### Primary family

- Pale warm limestone: foundations, steps, buttresses, curbs, quoins, and civic trim.
- Warm limewash: residences and important enclosed buildings.
- Dark oak: structural frames, door leaves, perimeter window casings, and machinery.
- Weathered mid-tone timber: cladding, sheds, fences, racks, and working surfaces.
- Deep terracotta red: important tiled roofs and restrained painted accents.
- Brown wood shingles: humble, woodland, and utility buildings.
- Near-black iron: straps, hinges, tools, cranks, and structural hardware.
- Muted brass: rare focal hardware such as the church bell.

### Accent rules

- Folk red, blue, ochre, and green are accents, not facade-wide colors.
- Keep accent areas small enough that limestone, timber, and roof material remain dominant.
- Use saturation to create focal hierarchy, not random variety.
- Glass is dark blue-grey by day and may gain a restrained warm glow when occupied at night.
- Quarry stone remains cooler and greyer than village limestone.

Avoid pure white, pure black, neon color, broad glossy surfaces, and clean modern metal.

## Detail hierarchy

### Settlement view

The viewer should read:

- overall footprint and height;
- roof form and color;
- main openings;
- signature feature;
- one or two functional yard props.

### Working view

The viewer should discover:

- foundation courses and corner structure;
- doors, windows, braces, roof bands, chimneys, and lean-tos;
- stored resources and characteristic equipment;
- deliberate asymmetry.

### First-person view

The viewer may discover:

- iron straps, handles, mullions, tile courses, carved or painted trim;
- small construction offsets and material changes;
- believable attachment points and supports.

Do not build close details until the first two levels work.

## Building identities

| Building | Signature read | Material emphasis | Functional evidence |
| --- | --- | --- | --- |
| Parish church | Open oak belfry over a prominent nave | Limewash, limestone, red tile, restrained folk trim | Bell, entrance steps, parish wall |
| Wayside shrine | Tiny gabled niche and iron ridge cross | Limewash, rough limestone, shingles | Marian icon, votive ledge, worn roadside steps |
| Residence | Steep domestic gable with chimney and lived-in asymmetry | Limewash or timber, stone base, tile/shingle roof | Firewood, porch, shutters, small household props |
| Well | Sheltered vertical frame over a circular stone curb | Limestone, dark timber, iron | Crank, rope, bucket, worn apron |
| Lumber mill | Long, low saw hall with a dominant roof | Timber frame, stone plinth, red tile | Saw, intake bay, log stacks |
| Reforester | Compact woodland hut with a steep protective roof | Shingles, weathered timber, stone base | Sapling racks, tools, planting stock |
| Woodcutter's lodge | Sturdy processing hut with a busy side yard | Timber, shingles, iron | Chopping block, split logs, stacked firewood |
| Stone quarry | Rugged open worksite rather than a polished house | Cool quarry stone, timber machinery, iron | Derrick, cut blocks, spoil, tool shelter |
| Hunter's hall | Low forest hall with a lean-to profile | Dark timber, shingles, stone hearth | Drying rack, hides, bows or traps |
| Forager's shed | Smallest and lightest enclosed work building | Weathered timber, shingles | Baskets, herb racks, drying bundles |
| Marketplace | Broad open civic canopy or arcade | Timber posts, stone paving, selective tile or canvas | Stalls, crates, scales, barrels |
| Rye and oat field | Bounded crop parcel with a tiny red-roof shelter | Earth, dry grain, rough oak, red tile | Crop rows, fence, field shelter |
| Threshing barn | Large high-roofed through-barn | Weathered oak, stone plinth, red tile | Broad opposing doors, grain sheaves |
| Pauline monastery | L-shaped pale complex with restrained belfry | Limewash, limestone, red tile | Cloister edge, cells, belfry |
| Brewhouse | Stout warm-walled house with a tall chimney | Limewash, stone, red tile, oak | Barrels, brewing hearth |
| Smokehouse | Dark compact gable dominated by its flue | Stone ground floor, dark timber, shingles | Tall chimney and smoke plume |
| Granary | Grounded long timber storehouse | Continuous stone foundation, weathered timber, shingles | Paired vent openings and stored grain sacks |
| Forest apiary | Modest yellow hut beside ordered hive rows | Ochre limewash, shingles, painted hive boxes | Hive stands and small work hut |
| Grain watermill | Riverside stone house with a dominant wheel | Limestone, limewash, red tile, oak | Full-height wheel and axle |
| Carpenter & wheelwright | Workshop with a deep side working bay | Timber, stone plinth, red tile | Lean-to, wheels, work yard |
| Vineyard terrace | Broad stepped stone-banked agricultural parcel | Earth, limestone, dark vine posts | Terraces, vine rows, vintner shelter |

## Residence variants

Residence variety must not be color-only.

Residence tiers are structural, not cosmetic:

- Tier 1 is a compact single-storey-plus-attic cottage for three people. It must read lower, narrower, and humbler than the established two-storey family.
- Tier 2 is the canonical two-storey Gorski house for six people, using the three established archetypes.
- Tier 3 is a wider, taller prosperous house for ten people. It gains a working annex or lean-to as well as additional upper-storey mass.
- Paint, roof, trim, archetype, chimney, and firewood variants persist across tiers because the deterministic residence id seed does not change on upgrade.
- Backyard gardens remain parcel features rather than being baked into a tier mesh.

- Share a construction kit: foundations, wall systems, roof families, openings, chimneys, porches, and props.
- Vary at least two major traits per house: footprint/proportion, roof form, entry placement, chimney placement, porch/lean-to, or upper-storey treatment.
- Then vary secondary traits: facade color, roof material, shutters, firewood, garden clutter, and trim.
- Use deterministic seeds so a residence keeps its appearance across sessions.
- Keep the village palette bounded; repetition creates cohesion.
- Prefer three to five strong house archetypes with controlled variants over dozens of weak random combinations.

Narrow and wide parcels should affect the architecture, not merely stretch the same mesh.

The current procedural residence family in `ResidenceMarkers.ts` and `residenceAppearance.ts` establishes three canonical archetypes: `stone_portal`, `timber_balcony`, and `working_lean_to`. Preserve this level of structural variation when extending the family. All three use an exposed-stone lower storey, a limewashed upper storey, steep weather roof, deterministic paint/roof/trim choices, and the state-driven firewood pile.

The current non-residential family is also canonical. Its dedicated meshes live in `src/buildings/meshes/`: `industryBuildingMeshes.ts`, `serviceBuildingMeshes.ts`, `stoneQuarryMesh.ts`, `marketplaceMesh.ts`, `chapelMesh.ts`, and `expandedBuildingMeshes.ts`. Shared enclosed-building construction belongs in `buildingMeshKit.ts`; do not regress to one generic hut with scale and prop substitutions.

## Backyard gardens and cultivated plants

Backyards are small working landscapes, not map icons enlarged into 3D. Their source of truth is `backyardGardenMesh.ts`; cultivated tree forms live in `vegetation/seedthree/backyardPlantAssets.ts`.

- Apple orchards use low, broad, slightly gnarled SeedThree trees, visible apples, grass understorey, a harvest basket, and an open grass aisle without stepping stones.
- Cherry orchards use taller, lighter, vase-shaped SeedThree trees, paired dark cherries, and the same open-ground vernacular yard vocabulary without sharing the apple silhouette.
- Orchard trees occupy evenly centered cells in a grid selected from the backyard aspect ratio: roomy plots use two rows by two columns, while smaller plots align two trees along their longer dimension.
- Apple and cherry foliage consumes the shared deciduous presentation state: pale spring leaf-out matures to summer green, species-specific autumn color accompanies deterministic leaf drop, and every orchard crown is bare in winter while retaining its branch structure.
- Flower gardens are cottage gardens built around custom SeedThree rose shrubs, mixed-height blooms, irregular beds, and a stone footpath. Avoid uniform dots on a soil rectangle.
- Vegetable gardens use divided ground-level plots without timber frames, legible cabbage rosettes, a bean trellis where space permits, paths, and a working basket.
- Flower gardens and vegetable gardens keep their cultivated soil flush with the backyard terrain rather than mounding or boxing it above grade.
- Herb gardens use ordered kitchen-herb beds, varied green and silver foliage, restrained lavender color, terracotta, and a drying rack on deeper plots.
- Size every composition from the actual burgage backyard footprint. Shallow plots reduce tree/bed count rather than squashing plants non-uniformly.
- Residence ids seed layout and plant variants deterministically so a household keeps its garden identity.
- SeedThree geometry is shared by session-level prototypes. Garden disposal must never dispose those shared buffers; only per-garden prop geometry is owned by the marker.
- Keep colors muted and materials consistent with the residence palette. Fruit and flowers may carry focused saturation, but soil, stone, wicker, and timber must remain the dominant frame.

## Resource-state props

Visible stored goods must tell the truth about simulation state.

- Residences show their firewood pile only when the household has firewood.
- The lumber mill's `TimberStockpile` is hidden at zero timber and reveals its five `TimberStockSegment` groups progressively as storage fills.
- Equipment that defines a trade (saw, chopping block, quarry derrick, drying rack) may remain visible when idle; stored output should not be faked.
- New stock props should use named groups and be synchronized from building or household state rather than baked permanently into the base mesh.

## Procedural modeling rules

- Models remain native Three.js geometry unless an asset pipeline is explicitly approved.
- Build through the helpers in `src/buildings/buildingMaterials.ts` and `src/buildings/meshPrimitives.ts` where practical.
- Preserve the placement footprint defined in `BuildingTerrainLayout.ts`.
- When height changes materially, update both `BuildingPlacementPreview.ts` and `buildingShadowProxy.ts`.
- Use one invisible shadow proxy per building; detailed meshes should not all cast into the shadow pass.
- Reuse a small material vocabulary within a model.
- Put geometry where it changes silhouette, catches useful light, or explains function.
- Prefer low-sided cylinders and faceted curves consistent with the game's stylization.
- Avoid hidden interiors unless gameplay or a visible opening requires them.
- Ensure preview materials and disposal still work after introducing groups or custom geometry.
- Keep stored-resource props separate from permanent trade equipment so gameplay state can hide or scale them.

## Anti-drift rules

Do not introduce:

- generic high-fantasy castles, exaggerated spires, or ornamental clutter;
- ubiquitous Tudor half-timber patterns;
- pristine symmetry across every facade and yard;
- roof shapes chosen only for spectacle;
- color-only building differentiation;
- tiny repeated geometry that adds cost but no readable form;
- photoreal PBR assets that clash with the procedural environment;
- one-off palettes that do not use the shared limestone, timber, and roof family;
- oversized buildings that stop reading as parts of one village.

When historical authenticity and game readability conflict, keep the construction plausible but choose the clearer game silhouette.

## Review checklist

Before considering a model complete:

- [ ] It can be identified from its silhouette at settlement zoom.
- [ ] It has exactly one dominant signature feature.
- [ ] Roof, wall, foundation, frame, and openings separate clearly.
- [ ] Its props communicate gameplay function.
- [ ] It belongs beside the church without copying the church.
- [ ] It uses the shared palette and restrained accents.
- [ ] Doors, windows, steps, tools, and structural supports are plausibly scaled.
- [ ] It contains controlled asymmetry or hand-built variation.
- [ ] It has been checked from front three-quarter, rear three-quarter, and settlement distance.
- [ ] It has been checked under the game's daylight and shadow treatment.
- [ ] Placement footprint, preview height, shadow proxy, and disposal behavior still match.
- [ ] `npm run build` and the relevant tests pass.

## Workflow for the next model

1. Read this document and inspect the church mesh.
2. Name the building's signature silhouette and functional props before coding.
3. Block the largest masses and review at settlement distance.
4. Establish material blocks and mid-scale structure.
5. Add only the close details that reinforce craft or function.
6. Inspect in the actual renderer, correct silhouette/material balance, and repeat once.
7. Verify footprint, preview, shadow, build, and tests.

This direction is locked. Deviate only when the user explicitly requests a new architectural region, era, or visual style.
