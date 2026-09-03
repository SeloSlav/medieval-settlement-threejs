# Backyard orchard specializations

## Player flow

1. A completed residence starts an **Orchard** backyard worksite.
2. Timber and stone are delivered physically and one free household laborer builds it through the existing residence-project pipeline.
3. The completed orchard is prepared but unplanted and produces nothing.
4. Selecting the orchard opens five planting choices: apple, cherry, pear, aronia, and rosehip.
5. Planting starts the species maturity timer. Output remains zero until the timer has elapsed and the species' harvest window is open.
6. Demolition removes either the prepared orchard or its specialization. After salvage is hauled away, the plot can select any backyard extension again.

The development schema intentionally makes Orchard the canonical first kind. Fruit and berry specialization ids are grouped after it, and the server rejects direct specialized-orchard construction; every planting therefore receives its full maturity timer.

## Balance contract

| Planting | Minimum maturity | Harvest window | Yield efficiency | Preserve output |
|---|---:|---|---:|---|
| Apple | 90 days | September | 100% | — |
| Cherry | 120 days | June | 92% | — |
| Pear | 150 days | September–October | 108% | — |
| Aronia | 60 days | August–September | 90% | Jam |
| Rosehip | 75 days | October–November | 82% | Jam, highest rate |

Harvest output is annualized over each window (`12 / windowMonths`) and then multiplied by the species efficiency. Drought sensitivity is also species-owned: orchard trees retain 90% output, aronia 75%, and rosehip 85%.

Pears use the existing physical orchard-fruit storage channel; aronia and rosehip use the berry channel. Their species identity, timing, efficiency, visuals, and inspector readouts remain distinct.

## Tier-4 luxury

Aronia and rosehip turn part of their harvest into household jam. Jam is physical local stock on the backyard row, capped at 12 jars, and is ordinary edible food for its owning residence at tiers 1–4. Aronia jam, rosehip jam, and honey share the **Sweet Preserves** dietary category. At tier 4, the same serving simultaneously satisfies the luxury-preserves requirement: it is withdrawn once, supplies calories once, and receives the additional luxury value. It is deliberately not teleported into a regional market inventory.

A tier-3 household preparing for promotion, or an existing tier-4 household, can instead buy an 8-gold cut-flower upgrade. Its bouquet table is visible in the world, and the upgraded garden satisfies the same luxury-comfort need without consuming jam. This makes jam and cultivated flowers alternative plot strategies rather than cumulative mandatory needs.

## Art and vegetation contract

- Pear uses an upright central-leader SeedThree tree preset and plot-local semi-dwarf cultivation scale.
- Aronia and rosehip use the shared dichotomous multi-cane shrub generator and terminal-stem fruit anchors from the new bush system.
- Each new species has dedicated albedo, normal, roughness, and leaf-translucency maps plus a dedicated baked GLB fruit or cluster.
- Species seeds are deterministic: `backyard:<species>:<variant>` for trees and `gorski:<species>:<variant>` for shrubs.
- The source leaf plates live in `art-source/seedthree/orchards`; the reproducible PBR/GLB generator is `scripts/generateOrchardSpeciesAssets.mjs`.

## Visual validation contract

The fixed close views are:

- `/backyard-lineup.html?view=pear-close`
- `/backyard-lineup.html?view=aronia-close`
- `/backyard-lineup.html?view=rosehip-close`

The Playwright contract captures all three through `e2e/backyard-lineup.spec.ts`. The broader geometry contract checks deterministic rows, maturity scaling, harvest visibility, fruit attachment, the unplanted orchard shell, luxury bouquets, texture channels, GLB presence, and winter foliage in `scripts/testBackyardGardenVisuals.mts`.

The gameplay/schema contract is `scripts/testOrchardSpecializations.mts`.
