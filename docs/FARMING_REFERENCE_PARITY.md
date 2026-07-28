# Farming reference parity

Audit date: 28 July 2026

References:

- [Polygon — How to use farms and grow crops in Manor Lords](https://www.polygon.com/manor-lords-guides/24139739/farm-farming-field-crop-emmer-wheat-flax-barley-harvest-grow/)
- [Manor Lords official wiki — Field](https://wiki.hoodedhorse.com/Manor_Lords/Field)

The project is feature-matched on the core annual field loop, three-year
rotation planning, and reference crop roster, with spring oats retained as a
regional addition. This pass did not add a technology tree, development
unlocks, or a Heavy Plow unlock.

## Parity matrix

| Farming behavior | Reference behavior | Current project | Status |
| --- | --- | --- | --- |
| Field layout | Free flexible four-sided field | A selected farmstead or livestock holding traces a convex four-corner parcel inside its work extent, with live boundary, area, shape, terrain, water, quarry, and overlap feedback | Matched |
| Field size and labor | Larger fields yield more and take longer to work | Area drives yield, seed, ploughing, sowing, and harvest work; efficiency is full through 1,600 m² and then tapers softly | Matched |
| Farm workforce | Families assigned to a Farmhouse work connected fields | Assigned farmstead labor works only that holding’s fields and respects seasonal/Sabbath pauses | Matched |
| Work stages | Plough, sow, grow, harvest | Authoritative `ploughing`, `sowing`, `growing`, and `harvesting` stages with normalized progress | Matched |
| Visible stages | Soil, crop growth, ripe crop, and cleared harvest are readable in the world | Terrain-hugging worked soil and furrows; crop-specific rye ears, oat panicles, barley awns, maslin heads, and blue flax; ragged harvest boundary; cut stubble; fallow cover | Matched |
| Harvest season | Autumn harvest, normally beginning in September | Mature cereals enter harvest in September; uncollected crop closes at the October deadline | Matched |
| Crop fertility | Crop suitability/fertility guides field placement and yield | Field layout automatically shows a crop-specific terrain map combining authoritative groundwater, predicted starting soil, and slope; persistent fertility, drought/rain response, and the same factors drive actual yield | Matched |
| Fallow | Resting a field restores fertility and yields nothing | Fallow produces no grain and restores persistent fertility when worked | Matched |
| Crop rotation | Three yearly slots can rotate crops and fallow | Explicit Year 1, Year 2, and Year 3 crops rotate cyclically after completed or failed seasons, with soil, seed, and output forecasts at field, holding, and settlement scale | Matched |
| Crop roster | Wheat/emmer, barley, flax, rye, and fallow | Mountain rye, spring oats, barley, fibre flax, wheat–rye maslin, and fallow | Matched, with oats as a regional addition |
| Grain food chain | Wheat/rye is threshed, milled into flour, and baked into bread | Harvested cereal becomes physical grain; watermill makes flour; staffed granary bakery turns flour, water, and firewood into food | Matched at commodity-chain level |
| Barley/ale chain | Barley becomes malt and then ale | The brewhouse currently consumes generic grain, water, and firewood directly to make ale | Partial — no distinct barley or malt commodity |
| Flax/linen chain | Flax becomes linen | Flax is pulled as fibre, stored separately at the farmstead, and physically carted to the weaver through the shared raw-textile channel; the weaver makes cloth | Partial — no separate retting or linen intermediate |
| Field priority | Players can prioritize field work | Fields have four priority states, including paused, and the farm plan schedules higher priorities first | Matched |
| Early harvest | A player may force an early harvest | In August, a crop at 55% growth may be cut to spread labor or secure emergency stores; its current ripeness permanently locks 47–85% of normal yield, while waiting for September keeps 100% | Matched |
| Ox/plough support | Ox ploughing is tied to a development and Farmhouse upgrade | Healthy cattle can support the two highest-priority nearby fields without an unlock tree | Different by design |
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

Malt and linen/retting intermediates remain separate gameplay work. Barley
deliberately joins generic grain and flax deliberately joins the
raw-textile channel so both crops participate in existing physical logistics
without a save-schema migration. Development unlocks and Heavy Plow technology
remain out of scope until explicitly requested.
