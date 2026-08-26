# Farming reference parity

Audit date: 26 August 2026

References:

- [Polygon — How to use farms and grow crops in Manor Lords](https://www.polygon.com/manor-lords-guides/24139739/farm-farming-field-crop-emmer-wheat-flax-barley-harvest-grow/)
- [Manor Lords official wiki — Field](https://wiki.hoodedhorse.com/Manor_Lords/Field)
- [Croatian Encyclopedia — flax processing](https://www.enciklopedija.hr/Clanak/lan?handler=ButtonSnimi)
- [Ethnographic Museum Zagreb — textile tools and raw materials](https://katalog.emz.hr/hr/Zbirke/Zbirka%20tekstilnih%20alatki%20i%20sirovina_46)
- [Hrčak — Croatian peasant flax production](https://hrcak.srce.hr/48526)

The project is feature-matched on the core annual field loop, three-year
rotation planning, reference crop roster, and the reference principle that a
player-drawn pasture determines how many animals fit. Spring oats and woodland
pannage are retained as regional additions. This pass did not add a technology
tree, development unlocks, or a Heavy Plow unlock.

## Parity matrix

| Farming behavior | Reference behavior | Current project | Status |
| --- | --- | --- | --- |
| Field layout | Free flexible four-sided field | A selected farmstead or livestock holding traces a convex four-corner parcel inside its work extent, with live boundary, area, shape, terrain, water, quarry, and overlap feedback | Matched |
| Pasture placement and capacity | A player draws an enclosure and its size determines the animal limit | Every cattle or sheep parcel owns its herd and exact terrain-adjusted whole-head limit; mixed cattle and sheep pastures may share one farmstead, while its 60-unit budget charges three units per cow and one per sheep | Matched in intent, with terrain-sensitive local capacity and a shared management ceiling |
| Woodland pannage | No equivalent core enclosure in the field reference | Every pig parcel is locally limited by the smaller of its suitable fenced area and exact mature-tree count, follows an autumn mast peak with drought/winter pressure, and shares a 30-pig ceiling with sibling pannage | Regional addition |
| Livestock acquisition | Animals are separate stock rather than free output from drawing land | Every parcel begins unstocked; the player chooses cattle or sheep on a pastoral parcel and buys whole animals there with civic gold, while pannage is pig-only. Sales return a lower price | Matched in intent, with explicit parcel-level trade |
| Livestock needs and reproduction | Herd management constrains productive stocking | One farmstead cadence apportions shared labor, prepared feed, and trough water across its parcel herds, while grass/mast and cattle/sheep hay remain local. Each healthy, 90%-supplied group of at least two breeds only in spring and stops at its local land cap or the shared hub ceiling | Different by design — explicit local forage, shared husbandry inputs, and fixed-cadence biology |
| Livestock parcel and demolition safety | Enclosures and their animals must remain coherently owned | A stocked parcel must sell its own animals before changing species or demolition; it may then switch cattle ↔ sheep on the same fence and buy replacements without removing or altering sibling pastures. The sale/rebuy spread is the conversion cost | Project integrity rule |
| Field size and labor | Larger fields yield more and take longer to work | Area drives yield, seed, ploughing, sowing, and harvest work; efficiency is full through 1,600 m² and then tapers softly | Matched |
| Farm workforce | Families assigned to a Farmhouse work connected fields | Assigned farmstead labor works only that holding’s fields and respects seasonal/Sabbath pauses | Matched |
| Work stages | Plough, sow, grow, harvest | Authoritative `ploughing`, `sowing`, `growing`, and `harvesting` stages with normalized progress | Matched |
| Visible stages | Soil, crop growth, ripe crop, and cleared harvest are readable in the world | Terrain-hugging worked soil and furrows; crop-specific rye ears, oat panicles, barley awns, maslin heads, and blue flax; ragged harvest boundary; cut stubble; fallow cover | Matched |
| Harvest season | Autumn harvest, normally beginning in September | Mature cereals enter harvest in September; uncollected crop closes at the October deadline | Matched |
| Crop fertility | Crop suitability/fertility guides field placement and yield | Field layout shows crop-specific terrain pockets from soil texture, topsoil depth and water retention, authoritative groundwater, and each crop's slope tolerance; persistent fertility, drought/rain response, and the same factors drive actual yield | Matched |
| Fallow | Resting a field restores fertility and yields nothing | Fallow produces no grain and restores persistent fertility when worked | Matched |
| Crop rotation | Three yearly slots can rotate crops and fallow | Explicit Year 1, Year 2, and Year 3 crops rotate cyclically after completed or failed seasons, with soil, seed, and output forecasts at field, holding, and settlement scale | Matched |
| Crop roster | Wheat/emmer, barley, flax, rye, and fallow | Mountain rye, spring oats, barley, fibre flax, wheat–rye maslin, and fallow | Matched, with oats as a regional addition |
| Grain food chain | Wheat/rye is threshed, milled into flour, and baked into bread | Harvested cereal becomes physical grain; watermill makes flour; staffed granary bakery turns flour, water, and firewood into food | Matched at commodity-chain level |
| Barley/ale chain | Barley becomes malt and then ale | Barley is harvested, seeded, stored, traded, and hauled separately from bread grain; the brewhouse spends one fueled, watered work cycle floor-malting it and a second cycle brewing physical malt into ale | Matched |
| Flax/linen chain | Flax becomes linen | Harvested flax remains a distinct physical commodity, may be buffered in a Granary, and is carted with one unit of well water to a staffed Spinning & Retting House; each three-flax batch becomes two Linen, which is then hauled to a Weaver where two Linen becomes two Clothing | Matched with an explicit retting and weaving chain |
| Wool/yarn chain | Sheep fleece is prepared before weaving | Wool is hauled from pastoral holdings or a Village Storehouse to the same Spinning & Retting House; each dry three-wool batch becomes two Yarn, and a Weaver turns two Yarn into two Clothing | Regional addition with explicit spinning, storage, and transport |
| Field priority | Players can prioritize field work | Fields have four priority states, including paused, and the farm plan schedules higher priorities first | Matched |
| Early harvest | A player may force an early harvest | In August, a crop at 55% growth may be cut to spread labor or secure emergency stores; its current ripeness permanently locks 47–85% of normal yield, while waiting for September keeps 100% | Matched |
| Ox/plough support | Ox ploughing is tied to a development and Farmhouse upgrade | Healthy cattle reduce plough work on the two highest-priority nearby fields; independently posted stable oxen pair with present farmstead labor to double that farmer's ploughing and threshing pace and add 50% at harvest, while sowing stays human-only | Different by design |
| Manure and soil improvement | Fertility can be restored through farming choices | Supplied cattle collect a seasonal physical manure stock at their holding; one visible road cart distributes it to the least-covered crop farmstead, and farmers spread it during ploughing for a proportional, capped fertility benefit | Different by design — spatial livestock, cart availability, field priority, and timing replace a passive proximity bonus |
| Household food variety | Burgage food access is evaluated as distinct food types | Household pantries retain physical goods but progression counts eight categories; equivalent items such as apples/cherries or milk/eggs/cheese cannot inflate variety, and market deliveries prefer missing categories | Matched in intent, with explicit category grouping |
| Livestock extensions | Burgage extensions are chosen explicitly and trade land for specialist output | Goat pens alternate small Milk and Meat batches without wool, plough support, or collectable field manure; hen yards supply Eggs; full sheep and cattle holdings retain their larger-scale wool, milk/meat, manure, and plough roles | Different by design — explicit low-output household alternative |
| Household apiary | Specialist food extensions can supplement the market | A small backyard apiary produces less Honey and a smaller pollination bonus than the staffed specialist Apiary | Regional addition |
| Technology tree / Heavy Plow unlock | Development-gated feature | Explicitly excluded from this scope; no unlock or technology-tree work was added | Intentionally excluded |

## Visual acceptance target

The supplied screenshots establish these requirements for a mature cereal field:

- individual upright stems remain visible at close camera distance;
- pale, narrow, awned seed heads form the brightest layer of the crop;
- the field reads as a dense continuous mass from settlement camera distance;
- height, lean, color, and spacing vary enough to avoid a repeated grid;
- worked earth remains brown-grey and uneven rather than becoming a yellow crop
  texture;
- harvest progress removes an irregular band of standing plants and leaves short
  stubble behind;
- all geometry follows rolling terrain without floating or flattening the field.

The deterministic visual QA scene is
[`farm-field-lineup.html`](../farm-field-lineup.html). Its default camera checks
the field-scale silhouette; `?view=detail&clean=1` checks individual heads and
stalks, `?view=overview&clean=1` checks terrain contact and field coverage, and
`?view=crops&clean=1` compares all six field treatments.

## Deliberately deferred gaps

Retting and spinning are no longer folded into the Weaver. The physical chain
now uses one dual-purpose Spinning & Retting House, separate Yarn and Linen
commodities, visible handcart loads, and workshop stockpiles. The existing
save-compatible textile preference is reused at both workshops: it chooses
Wool versus Flax at the preparation house and Yarn versus Linen at the Weaver,
while a complete alternate recipe remains a fallback. Village Storehouses
accept Wool, Yarn, and Linen; Granaries accept Flax. Development unlocks and
Heavy Plow technology remain out of scope until explicitly requested.
