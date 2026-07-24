# Seasons, calendar, weather, and simulation speed

## Calendar contract

The calendar is deliberately fictional and fixed:

- 24 displayed hours per day.
- 10 days per month.
- 12 named months per year.
- 120 simulation seconds per day.
- Every month and year has the same length. There are no leap years, variable month
  lengths, accumulated drift, or real-time-zone rules.
- A new world begins on 1 March, Year 1 at 06:00 so the first session opens at the
  beginning of spring and the workday.
- Labor normally works from 06:00 to 20:00. A staffed chapel can make Sunday a
  sabbath. Household heating continues at night and on sabbaths even while other
  household consumption and labor are paused.

| Speed | Day | Month | Season | Year |
| --- | ---: | ---: | ---: | ---: |
| Leisurely, 1× | 5 min | 50 min | 2 hr 30 min | 10 hr |
| Fast, 4× | 1 min 15 sec | 12 min 30 sec | 37 min 30 sec | 2 hr 30 min |
| Very fast, 12× | 25 sec | 4 min 10 sec | 12 min 30 sec | 50 min |

The scheduler still fires every 200 milliseconds and every completed substep retains
its established 0.2-second meaning, so existing save clocks do not jump when this
pacing is deployed. A persistent fixed-point budget completes two substeps per five
scheduler callbacks at 1×. Fast modes receive 4 or 12 times that budget, making 1× a
deliberately leisurely baseline. Faster modes accelerate movement,
labor, construction, production, deliveries, consumption, regrowth, reproduction,
weather damage, and the calendar together.

Controls are in the settlement clock. `1`, `2`, and `3` select Leisurely, Fast, and
Very fast. Pause remains supported by the server reducer for administration and
recovery, but is not exposed as a player control. Speed is server authoritative and
global to the world. In the current shared-world model, any connected player can
change it; host-only authority should be added before a competitive multiplayer mode.

## Deterministic weather

Weather is derived from world seed, year, calendar day, and hydrology. It is not a
client-only random effect and does not require a mutable weather table. Every client
and every server system receives the same result for a given day.

- Spring rain has a base 55% daily chance, modestly increased by world hydrology.
- Each summer has a hydrology-adjusted 48% base chance to contain one four-day
  drought window. Wetter maps are safer but never immune.
- Autumn is normally fair.
- Winter is frost.

The HUD shows the active season/weather and a tooltip listing its major effects.

## Seasonal rules

### Spring — March through May

- Autumn-sown rye, oats, and fallow fields resume growth.
- Rain increases crop growth to 112% and well refill to 130%.
- Berry and mushroom nodes regrow in place.
- Fish reproduce only in spring. Recovery follows surviving population, so a badly
  depleted shoal recovers slowly and a zero population is permanently extinct.
- Pasture capacity is 115%.
- Livestock breeding is 125%.
- Household firewood demand is 100%.
- Fresh food spoilage is 0.4% per game day before storage modifiers.

Spring's strategic advantage is recovery: water, forage, fish, pasture, and breeding
are all favorable, while fields have time to recover from a weak start.

### Summer — June through August

- Grain and fallow continue growing.
- Berry and mushroom nodes continue regrowing.
- Pasture capacity is 100% and household firewood demand falls to 70%.
- Fresh food spoilage rises to 0.8% per day.

During drought:

- Crop growth falls to 45%.
- Berry and mushroom regrowth falls to 35%.
- Well refill falls to 50%.
- Pasture capacity falls to 65%.
- Fish ponds lose 4% of maximum population per drought day. This can finish off an
  already depleted shoal and make its extinction permanent.
- Fresh-food spoilage rises to 1.8% per day.
- Repeated drought ticks lower field moisture, reducing eventual yield even if the
  crop still reaches harvest maturity.

Summer's advantage is uninterrupted growth and low heating demand; its risk is a
compound water, food, pasture, and fish shock.

### Autumn — September through November

September is the only crop harvest month:

- A field reaching at least 75% maturity enters harvesting.
- An immature crop fails and returns to ploughing with zero yield.
- Farmers can collect grain only during September.
- A harvest still standing on 1 October is lost.
- Apple and cherry orchards produce their concentrated annual crop in September.

October and November are the only ploughing and sowing months:

- Farmers prioritize by player field priority, then harvesting, sowing, and
  ploughing urgency.
- Cattle support still reduces plough work and can add manure fertility.
- A fully sown field becomes dormant through winter.

Other autumn rules:

- Pasture capacity is 90%.
- Household firewood demand rises to 115%.
- Fresh-food spoilage returns to 0.4% per day.
- Vegetable and herb gardens taper to 55%; flowers taper to 35%.
- Swine retain their existing autumn mast-production bonus.

Autumn's advantage is the year's concentrated grain, orchard, and swine income. Its
constraint is labor scheduling: a late harvest cannot spill into October, and
unfinished sowing cannot spill into winter.

### Winter — December through February

- Berry and mushroom harvest visuals disappear and their nodes cannot be gathered.
- Fishing water is treated as frozen and fishing camps cannot harvest.
- Fully sown grain remains alive but dormant.
- A field still in the sowing stage when winter begins fails and must be ploughed
  again next autumn.
- Pasture capacity falls to 35%, so grain reserves are needed to support herd size.
- Livestock breeding falls to 60%.
- Sheep produce no wool income.
- Household firewood demand rises to 180% and continues through nights and
  sabbaths. An unsupplied higher-tier residence accumulates its ordinary firewood
  deficit and can eventually be abandoned.
- Vegetable, herb, and flower garden work stops. Hens continue at 75%.
- Fresh-food spoilage falls to 0.2% per day.

Winter's advantage is preservation and freedom for non-agricultural labor. Logging,
mining, stone gathering, construction, crafting, trade, ordinary hunting, and
threshing stored wheat have no general seasonal shutdown.

## Persistent wild resources

- Berries and mushrooms retain their node when empty and regrow in spring and
  summer. Workers idle while the node is empty or winter-dormant.
- Fish retain their water node, reproduce only from survivors in spring, suffer
  drought losses, and remain extinct if reduced to zero.
- Game retains a simulated herd population, reproduces with at least two animals,
  and can migrate when non-hunting buildings disrupt its habitat. It is huntable
  year-round.

## Food storage and spoilage

Food is stored in several places:

- Producer buildings hold fresh food locally: hunters' halls, foragers' sheds,
  fishing camps, swineherds, apiaries, vineyards, and similar producers.
- Granaries pull wild food from connected producers, hold up to their configured
  food capacity, bake flour into food, supply smokehouses, and deliver to homes.
- Smokehouses turn fresh food plus firewood into preserved food.
- Residences hold delivered food in their household need stock.
- Treasury food exists as an overflow/salvage fallback, but is the least efficient
  place to leave it.
- Village storehouses hold timber, stone, and firewood; they do not hold food.

Fresh food decays proportionally each simulation step. Granaries reduce spoilage to
35% of the seasonal rate, smokehouses to 55%, monasteries to 65%, and marketplaces
to 80%. Unprotected producer stock takes the full rate and treasury overflow takes
120%. Grain, flour, preserved food, honey, ale, and wine are not part of the fresh
food spoilage pass.

## Balance knobs

Calendar and seasonal multipliers live in `balance/gameBalance.json` and are
generated into both Rust and TypeScript. The deterministic weather algorithms are
mirrored in `server/src/season_policy.rs` and `src/world/seasonPolicy.ts`.

The most important tuning sequence is:

1. Observe whether a 150-minute season at Leisurely creates meaningful preparation.
2. Tune work requirements so an appropriately staffed farm can harvest in September
   and plough/sow in October–November without making failure impossible.
3. Tune winter firewood and pasture multipliers against one full four-hour year.
4. Tune drought frequency before drought severity; frequent severe droughts create
   unavoidable spirals.
5. Preserve a recovery route: trade, granary buffers, preserved food, grain-fed
   livestock, and protected fish populations must all remain viable responses.
