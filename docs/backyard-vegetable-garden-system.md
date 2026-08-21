# Backyard vegetable garden system

## Construction and seed choice

`vegetable_garden` is a completed shell: three prepared household beds built by free laborers for 5 timber, 2 stone, and 2 gold. It has no crop and produces no food until the player purchases one seed specialization. Direct construction of a specialized crop garden is rejected by the server.

The seed choice fills every bed and remains fixed until the whole backyard extension is demolished.

| Crop | Seed purchase | First maturity | Harvest window | Yield profile |
| --- | ---: | ---: | --- | --- |
| Beetroot | 1 gold | 60 days | May–October | Earliest and cheapest, but lowest yield |
| Carrot | 2 gold | 75 days | June–November | Balanced maturity, season, and yield |
| Cabbage | 3 gold | 105 days | July–November | Slowest and costliest, but highest yield |

These are temperate succession-cropping abstractions. The first-maturity clock models establishment of the first usable sowing; production during the authored window represents later rows following the same household seed crop.

## Economy and state

All three crops remain the typed `Vegetables` commodity so they continue through existing household food storage, Marketplace overflow, spoilage, food-needs, tax, and wealth systems. Their identity remains on the backyard kind, where it controls timing, yield, inspector language, and visuals.

Seed gold uses the same protected household-savings and civic shortfall rules as orchard planting and animal stocking. Demolition removes the specialization and returns the parcel to the ordinary backyard-extension picker after reclaimed materials are hauled away.

## Visual contract

The system reuses the existing authored kitchen-crop textures and plant builders:

- cabbage uses layered outer and curled-heart leaf cards;
- carrots use the existing feathery frond cards;
- beetroot uses the existing broad root-crop leaf asset, renamed semantically, plus a visible burgundy root shoulder.

The empty shell shows only prepared soil beds and a seed-choice marker. A specialized garden has three homogeneous crop groups, deterministic row placement, bounded plant counts, maturity scaling, and calendar scaling. No mixed cabbage/carrot/beetroot bed remains.

Fixed visual validation covers the shell and all crops at close, design, far, and no-post views. Diagnostics assert that each selected garden exposes exactly one crop identity.
