# Backyard Animal Pen

The backyard build menu exposes one **Animal pen** shell. Free construction labor and physical timber/stone carts must complete that enclosure before the household can stock it. A completed, empty pen produces nothing.

Stocking is a permanent choice until the extension is demolished:

| Livestock | Stocking cost | First output / gestation | Primary output | Secondary output |
| --- | ---: | ---: | --- | --- |
| Chickens | 2 gold | 21 days | Eggs every 2 days, March–November | Chicken meat every 60 days, September–November |
| Goats | 4 gold | 150 days | Milk every 3 days, April–October | Goat meat and untanned hides every 150 days, October–November |
| Pigs | 5 gold | 114 days | Pork every 114 days, October–December | None |

Production clocks are persisted on the backyard row. A collection updates its own clock, so a due interval fires once rather than once per simulation tick. Primary collections and slower culls have independent clocks.

Food keeps its typed commodity identity. Eggs enter fresh animal-produce storage. Goat milk can continue through the cheese chain. Chicken, goat, and pig meat enter fresh meat storage and can continue through the cured-meat chain. Household reserves fill first; physical overflow can enter a connected, staffed Marketplace food group.

At tiers 1–2, any of these remains useful food. Tier 3 accepts animal produce or meat for its broad land-animal food goal. Tier 4 separates that goal into **animal produce** and **meat**, so eggs/milk and pork have genuinely different needs value instead of being interchangeable late-game stock.

Goat hides are generated only alongside an actual cull and remain physically recorded at the household pen, capped at 16. They are deliberately not relabeled as wool or automatically turned into gold while no tannery/leather chain exists.

All four visuals compile from the same deterministic semantic plan: enclosure, gate, shelter, bedding, and trough. Stocked variants add nesting boxes, a milking stand, or a mud wallow plus their species. Chickens and pigs use the bundled Quaternius rigged GLBs; goats use the sheep-derived rig with goat-specific proportions, material tint, horns, and beard.
