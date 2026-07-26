# Seasons, calendar, weather, and simulation speed

## Calendar contract

The calendar is deliberately fictional and fixed:

- 24 displayed hours per day.
- 10 days per month.
- 12 named months per year.
- 120 simulation seconds per day.
- Every month and year has the same length. There are no leap years, variable month
  lengths, accumulated drift, or real-time-zone rules.
- A new world begins on 1 March, Year 1 at 08:00 so the first session opens after
  dawn, near the beginning of spring and the workday.
- Labor normally works from 06:00 to 20:00. A staffed chapel can make Sunday a
  sabbath. Household heating continues at night and on sabbaths even while other
  household consumption and labor are paused.

| Speed | Day | Month | Season | Year |
| --- | ---: | ---: | ---: | ---: |
| Scenic, 1× | 60 min | 10 hr | 30 hr | 5 days |
| Normal, 5× | 12 min | 2 hr | 6 hr | 24 hr |
| Fast, 20× | 3 min | 30 min | 1 hr 30 min | 6 hr |
| Ultra, 120× | 30 sec | 5 min | 15 min | 1 hr |

The scheduler still fires every 200 milliseconds and every completed substep retains
its established 0.2-second meaning, so existing save clocks do not jump when this
pacing is deployed. A persistent fixed-point budget completes one substep per thirty
scheduler callbacks at 1×. Faster modes receive 5, 20, or 120 times that budget, making 1×
a deliberately scenic baseline. Faster modes accelerate movement,
labor, construction, production, deliveries, consumption, regrowth, reproduction,
weather damage, and the calendar together.

Controls are in the settlement clock. `1`, `2`, `3`, and `4` select Scenic, Normal,
Fast, and Ultra. Pause remains supported by the server reducer for administration and
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
- Rain slows new dirt-road cart trips to 82% of their dry-weather pace.
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

- New cart trips travel at 90% pace on seasonally softened tracks.
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
- New cart trips travel at 72% pace on frosted tracks.

Winter's advantage is preservation and freedom for non-agricultural labor. Logging,
mining, stone gathering, construction, crafting, trade, ordinary hunting, and
threshing stored wheat have no general seasonal shutdown, but their road haulage is
slower.

## Seasonal road logistics

The road-condition multiplier is captured when a trip departs and applies to its
outbound and return legs. Existing trips therefore keep a stable ETA across a day
boundary, while the next dispatch reflects the new weather. Dry spring and summer
travel remain at 100%; spring rain uses 82%, autumn 90%, and winter frost 72%.
The carpenter's road-linked cartwright bonus multiplies with those values, partially
offsetting bad tracks without erasing the need for local reserves and shorter service
territories. The shared road material darkens and gains a wet sheen in rain, remains
mildly damp through autumn, and turns pale and rough under winter frost. Those
presentation-only uniforms add no road meshes or draw calls. Fire response and
construction carts use the same rule. No new save field is required because the
existing per-trip travel multiplier already stores the combined pace.

Regional marketplace caravans also capture the current multiplier when a bulk
trade or standing ironwork order begins. Their existing trade-desk cooldown stores
the longer settlement time, so a weather change does not rewrite an active order.
Additional brokers remain the economic counterplay, while the marketplace
inspector previews the next order's current-condition turnaround. Local cartwright
support does not speed foreign caravans before they reach the settlement.

The seasonal HUD tooltip and staffed or unstaffed Town Hall ledger also show a
deterministic next-dawn outlook. It uses the same seed, hydrology, calendar, and
environment policy as the authoritative next day, then reports road movement,
crop growth, pasture, firewood demand, and fresh-food loss. A deteriorating route
outlook explicitly recommends pre-hauling remote stock and regional orders. The
calculation is constant-time and advisory: it changes no orders, labor, or saves.

In conflict-enabled worlds, the same current multiplier converts each guardhouse's
physical route to its nearest staffed watchtower into a time-equivalent muster
distance. A compact company can still provide its full strength in rain, while a
route near the dry-weather response limit becomes delayed. The selected guardhouse
route changes from green to amber or red as appropriate, and its inspector shows
both physical and response-equivalent distance. This reuses the existing security
report interval and road path result rather than adding per-tick pathfinding.

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

1. Observe whether a 30-hour season at Scenic creates a satisfying slow-play option.
2. Tune work requirements so an appropriately staffed farm can harvest in September
   and plough/sow in October–November without making failure impossible.
3. Tune winter firewood and pasture multipliers against one full four-hour year.
4. Tune drought frequency before drought severity; frequent severe droughts create
   unavoidable spirals.
5. Preserve a recovery route: trade, granary buffers, preserved food, grain-fed
   livestock, and protected fish populations must all remain viable responses.
