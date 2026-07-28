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
- During August, any food or fibre crop at 55% growth may be ordered into early
  harvest. Its current ripeness locks 47–85% of normal yield, opens fieldwork one
  month early, and cannot be undone by saving or reconnecting. Waiting until
  September preserves the full yield.
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

September is the normal full-yield crop harvest month:

- A field reaching at least 75% maturity enters harvesting.
- An immature crop fails and returns to ploughing with zero yield.
- Farmers collect normal harvests during September; crops deliberately cut early
  may also be gathered during August at their locked reduced yield.
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
- Household firewood demand rises to 200% and continues through nights and
  sabbaths. An unsupplied higher-tier residence accumulates its ordinary firewood
  deficit and can eventually be abandoned.
- Vegetable, herb, and flower garden work stops. Hens continue at 75%.
- Fresh-food spoilage falls to 0.2% per day.
- New cart trips travel at 72% pace on frosted tracks.

Winter's advantage is preservation and freedom for non-agricultural labor. Logging,
mining, stone gathering, construction, crafting, trade, ordinary hunting, and
threshing stored wheat have no general seasonal shutdown, but their road haulage is
slower. Granary ovens, smokehouses, and brewhouses also remain productive only while
their physical firewood buffers are supplied, so ale production competes with baking,
preservation, and the sharply higher household heating claim.

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

Winter ground cover is derived from the same calendar without save state: a light
dusting begins during the last third of November, cover builds through December,
reaches its maximum in January, and thaws into sheltered remnants during February
and the first part of March. Settled snow is independent of the day's precipitation,
so it can remain during a fair spell or a rainy thaw. The terrain shader reveals a
generated seamless snow surface over the existing ecological grass/dirt material
using the shared road frost uniform. Snow and dry grass share one packed albedo
sampler, preserving the portable 16-texture WebGPU limit and adding no terrain mesh
or draw call.

Forest color follows the calendar independently of weather. Broadleaf trees and
European larch leaf out gradually during April with a pale spring flush, mature
during May, begin changing in late September, reach species-specific gold, copper,
orange, or red during October, and shed progressively through November. Silver fir,
spruce, Scots pine, and black pine remain evergreen. The per-tree deciduous flag is
packed into an existing forest-card instance buffer, so the seasonal treatment adds
no texture, vertex buffer, mesh, or draw call.

The seasonal HUD tooltip and staffed or unstaffed Town Hall ledger also show a
deterministic next-dawn outlook. It uses the same seed, hydrology, calendar, and
environment policy as the authoritative next day, then reports road movement,
crop growth, pasture, firewood demand, and fresh-food loss. A deteriorating route
outlook explicitly recommends pre-hauling remote stock and regional orders. The
calculation is constant-time and advisory: it changes no orders, labor, or saves.

## Backyard food and household trade

Backyard plots produce only during the ordinary 06:00–20:00 workday. Their home
food and market activity share one seasonal multiplier: apple and cherry orchards
concentrate the annual crop into September at twelve times the baseline daily
yield; vegetable and herb beds run at full output in spring and summer, taper to
55% in autumn, and sleep in winter; flowers run at 140% in spring, 100% in
summer, 35% in autumn, and sleep in winter; hens run year-round but fall to 75%
in winter. Summer drought multiplies exposed annual beds by another 55%, while
orchards and sheltered hens retain their seasonal rate. A staffed chapel with
Sunday observance pauses both home production and sale for the whole Sabbath.

Home food does not require trade access. Gold activity does: the residence and a
completed marketplace must share at least one cached road component. An unstaffed
market may still receive household produce, matching the authoritative rule, but
an unfinished or disconnected market cannot turn it into activity. The assessed
tax follows the mayor's rate and productivity penalty; without any staffed,
completed Town Hall, only the configured 60% is collected and the balance remains
with the household. Wealth beyond the household cap is not stored.

The backyard inspector reports today's full-workday food, routed activity,
assessed versus collected tax, seasonal state, and the missing market or clerk
when relevant. The Town Hall groups occupied plots and completed markets by every
road component touching their access point, separates routed from stranded trade,
shows home food, forecasts the next 120 days with deterministic weather and
Sundays, and links to the highest-value unserved home. The client pass is linear
in plots plus markets and performs no shortest-path solves. The server builds the
same owner-scoped market-component sets once per tick instead of checking every
garden against every market. No save field is added.

## Household emergency market orders

Occupied homes use their own saved gold as a last-resort provision buffer. When
food runway, or water runway at a tier that consumes water, reaches 0.75 day
(18 displayed hours), the household seeks its nearest completed marketplace by
exact road distance. Equal routes use stable marketplace order. Market staffing
is not required for this local baseline cart; construction completion and a
usable road route are required.

Food is tried before water. The household chooses the affordable offer with the
most provision per current gold, and the regional food or firewood/water price
multiplier is applied before affordability is tested. A full purchased lot must
fit temporarily in marketplace storage and completely in the household cupboard.
The market must have no other active cart. Gold, imported stock, and the
household's 450-tick (90 simulation-second) cooldown commit only when that exact
home's cart departs; blocked attempts are rolled back and never charge the home.
A blocked food attempt may still fall through to a viable water lot when both
needs are critical.

Night hours and an observed Sunday Sabbath pause new household orders while
consumption continues under the ordinary calendar rules, making Saturday
stockpiling and short market branches valuable. Fire-disabled homes do not order.
The residence inspector shows the current lot, price, route, and exact blocker.
Each marketplace shows the critical and affordable homes for which it is the
nearest market. The Town Hall totals settlement purchasing coverage, separates
route, wealth, cooldown, cart, storage, rest, and fire bottlenecks, and links to
the most urgent blocked home.

The server assigns homes with one one-to-many road solve per completed market,
rather than performing two pairwise route searches for every home. A paid named
dispatch reads only its intended residence instead of scanning all residences
again. The client uses the same batched route claim, offer order, capacity rules,
and stable tie breaks; its read-only test projection evaluates 100,000 homes
across eight markets in about 170 ms. Existing saves already contain the last
successful order tick, and older client fixtures default it to zero.

## Parish alms and Monday poor relief

Every road-connected home belongs to exactly one completed staffed chapel: the
chapel with the shortest exact road route. Equal routes use stable chapel order.
This territory is shared by tithes, chapel settlement support, household
recovery modifiers, and parish charity, so adding a second chapel creates a
real spatial division rather than duplicating benefits across the same road
component. Fire-disabled and unstaffed chapels do not claim a territory.

After priest wages and upkeep, a chapel with at least 120 gold in its coffer
gives the configured 0.12 gold/day alms stream to its poorest occupied parish
household. The server credits the household first, observes the 200-gold
household cap, then withdraws and records only the amount actually received.
Equal-wealth households use stable residence order.

Configured daily tithes, priest wages, upkeep, and alms are normalized across
the 06:00-20:00 work window. They therefore total their displayed per-day rate
instead of losing the 10 night hours when parish services pause. Automatic
coffer sweep is an accounting transfer rather than a cart journey, so its
global 900-tick cadence still fires when an interval lands at night; physical
poor-relief imports remain subject to work and rest hours. When Sunday Sabbath
is enabled, tithe forecasts use a seven-day average: the attendance bonus
applies on the six collection days, while Sunday itself remains tithe-free.

At the Monday 08:00 tick, each eligible parish may spend up to 14 coffer gold on
one full regional food lot for recovery. It considers only abandoned homes in
its own territory, assigns each to its nearest completed marketplace by exact
road route, and selects the routed home with the lowest food stock and room for
the entire lot. The current regional price determines which food offer has the
best provision per gold. The import must fit in marketplace storage, the target
cupboard must fit the full lot, the market cart must be free, and the route must
be usable. The coffer and parish ledger change only after that named cart
departs; a blocked order is free and waits until the next Monday.

The cadence is derived from the global simulation tick, so no save migration or
per-chapel timer is required. A low automatic coffer-sweep reserve can keep a
parish below the 120-gold gate, deliberately prioritizing treasury liquidity
over daily alms and recovery carts. Chapel and Town Hall inspectors show the
exclusive territory, current recipient, live food lot, days until dispatch,
shared-market cart/storage blockers, and the first affected home. The matching
read-only projection uses one batched road solve per chapel and marketplace and
evaluates 100,000 homes across eight of each in roughly 230 ms.

## Daily Town Hall steward order

Optional Town Hall stewards review labor only when the authoritative calendar
crosses into a new day. Ordinary simulation ticks return before any steward
settlement scan. Existing saves keep all three policies disabled:

1. Seasonal work releases dormant crews and fills active, time-critical sites.
2. Production releases only surplus labor from genuinely stalled target-governed
   or source-bound sites, then fills supplied and capacity-open work by staffing
   priority. Matching inbound supplies and necessary dispatchers remain protected.
3. Construction releases builders from blocked sites without approaching material
   carts, then fills immediately productive sites from the remaining labor pool.

This order keeps sowing and harvest windows ahead of routine industry while
letting workshop output targets act as durable automation rules. Construction
uses only the labor left after the settlement's seasonal and production plans.
Removing the Town Hall clerk pauses every enabled steward without changing its
saved setting; enabling any policy performs its safe rotation immediately.

The Town Hall may reserve 0, 1, 2, 4, or 6 free villagers from all automatic
call-ups. The three stages share that single floor, so released labor can still
move to a more urgent earlier stage while the selected number remains available
for explicit orders or emergencies. Raising the reserve does not dismiss a
productive crew merely to reach the floor; a later safe recall can restore it.
Manual call-ups remain unrestricted. Existing saves default to a zero reserve,
preserving the previous full-deployment behavior.

The Town Hall's Dawn labor review projects only the enabled stages in this same
sequence. Each stage sees the crew assignments and free pool left by the previous
stage, so seasonal call-ups can consume labor before workshops and seasonal
releases can feed production or construction. The projection uses the next day's
month, including April, September, and winter work-window transitions, and links
to the first site whose crew would change. It also reports whether the shared
reserve will be met or remain temporarily short because productive crews stay
assigned. It is read-only and runs only while the Town Hall inspector is open.

The construction queue also keeps two views of its reservations. The ownership
ledger continues to earmark material settlement-wide so placing or holding a
project cannot spend the same timber or stone twice. Its physical road view
matches the portion still awaiting pickup only with stock at completed sources
on the same cached component as each road-required site. Founders' reserve
transfers and loaded carts are already committed and stay outside that match.
Buildings designed for off-road work retain their straight-line hauling ceiling
from the source stock left after road-bound claims. The Town Hall therefore
distinguishes actual settlement-wide scarcity from an otherwise sufficient pile
stranded on another road branch and links to the highest-priority exposed claim.
The audit reuses component identifiers, adds no save state or path solve, and is
linear in buildings and active construction branches.

The same completed-building work priority also governs scarce grain carts at
watermills, breweries, and autonomous monasteries, plus industrial well-water
carts at breweries and granary bakeries. Grain dispatch first selects the
highest-priority tier that still needs its selected one-, two-, or three-cycle
working buffer, then the lowest cycle runway, shortest road route, and stable
building order. Wells keep
fire response and household service ahead of industry, then apply the same tier,
water-stock ratio against the selected staging target, route, and stable-order
sequence. This lets the player keep
staple milling or baking ahead of brewing and hospitality through a lean crop
year without adding another priority field. Existing buildings remain normal.
The same control also orders direct producer carts for the next link: flour
from watermills to staffed granary bakeries, fresh food dispatched from
granaries or swine holdings to smokehouses, and annual fleece sent to weavers.
These routes restore the workshop stock policy's one-, two-, or three-cycle
working buffer by priority before falling back to nearest-route overflow, so a
high tier cannot absorb every warehouse. Lean, Balanced, Deep, and Fill also
apply the same staging depth to bakery and smokehouse fuel plus well water;
Fill remains the save-compatible three-cycle default.

The crop-year grain account keeps its settlement-wide owned-stock view for
strategic harvest, seed, fodder, and reserve planning, but processor runway has
a second physical view. Sustained bread, ale, and monastery draw is grouped by
the same cached road components used by real carts. Only releasable grain at a
completed staffed farmstead or granary on that component counts as source
reserve: each holding's field seed claim and every selected granary floor remain
protected. Marketplace seed stock, livestock fodder, roadless stores, and
surplus on a disconnected branch cannot cover a processor branch. The Town Hall
shows how many drawing branches have a source, the weakest branch's equivalent
days of source reserve, grain outside current processor branches, and a link to
the first exposed processor. On-site workshop grain and cargo already committed
to a workshop stay in the existing per-building buffer forecast, so the branch
reserve neither reallocates locked inputs nor counts them twice. The reduction
reuses component identifiers, adds no save state or shortest-path work, and is
linear in buildings and active road branches.

Seed recovery uses a related physical view rather than the settlement-wide grain
total. Each completed farmstead's active field claim is reduced by grain already
onsite and by carts already approaching it. The remaining claim can be covered
only by completed granary stock, completed marketplace stock, and selected future
market lots on the same cached road component. A market or granary on a remote
branch therefore cannot make an isolated holding look ready for sowing, while
joining the roads immediately restores the forecasted coverage. The Town Hall
separately reports apparent coverage stranded by topology, recovery grain outside
current branch gaps, and claims belonging to incomplete or orphaned holdings, then
links to the weakest exposed farmstead. Future purchases remain excluded from the
crop-year owned-stock balance until the broker actually buys them. This advisory
reduction adds no save field or path solve and is linear in buildings, active
grain carts, holdings, and road components.

The Town Hall's sustained bread forecast matches watermill flour and granary
bakery intake inside each road component rather than across the whole
settlement. A productive mill on one isolated branch cannot conceal a bakery
without flour on another. The ledger reports paired, mill-only, and bakery-only
branches, quantifies the food throughput unavailable until roads connect, and
links to the largest imbalance. It reuses the pathfinder's cached component map
and performs no shortest-path solves.

Prosperity throughput uses the same topology rule. Staffed smokehouses,
breweries, and weavers contribute their preserved-food, ale, and cloth capacity
only to their own road component. Each branch can sustain the smallest of those
three resident-equivalent outputs; complete branch capacities are summed, while
split specializations are reported as stranded installed capacity. Current
tier-three residents and every vacant place in existing tier-three houses are
audited against their own branch, and the first exposed home is inspectable.
When previewing a tier-two promotion, the immediate occupants and the full
house are compared with that specific branch rather than remote surplus.
Upgrade authority remains with the existing physical service-route and resource
checks. The forecast adds no save state or path solve and runs only for the Town
Hall and tier-two residence inspectors that already request the production
scan.

The annual textile account now follows the physical sheep-to-loom step as well.
Each completed holding's projected and currently secured clip is grouped on
the same cached road component used when the livestock simulation dispatches
wool. Installed loom capacity can consume only that branch's fleece, and the
cloth produced there first covers current prosperous-house demand on that
branch; any local remainder is reported as above household need rather than
silently covering a disconnected home. A separate physical export ledger then
decides whether that remainder can actually reach a market. The Town Hall retains the settlement-wide
installed ceiling for long-range planning, then reports physically paired
output, topology-stranded capacity, local household coverage, and the first
exposed home or wool holding. Joined and independently complete satellite
branches keep their full output.

The current textile reserve uses the same physical scope. Cloth in an occupied
tier-three cupboard, at a completed staffed weaver on that household's branch,
or already aboard a cart bound for the home counts toward service runway.
Treasury cloth, marketplace export stock, an unstaffed loom's inventory, and
stock on a branch without current prosperous households remain in the owned
total but cannot conceal a local service gap. The Town Hall reports the weakest
branch, branches without a stocked loom route, and reserves below fourteen
days—roughly one two-cloth delivery for a full ten-person household—then links
to the first exposed home. Individual-house runway labels use the same
seventy simulated seconds per calendar day (the 06:00–20:00 consumption
window) as the aggregate forecast, instead of treating nighttime as active
consumption. The reduction adds no save fields or path solves and remains
linear in holdings, active textile branches, buildings, homes, and moving
carts.

Specialty exports now have their own physical road-branch account. Completed
breweries, apiaries, vineyards, and weavers contribute the ale, honey, wine, or
cloth still in their stores; local household deliveries and enabled monastery
hospitality remain ahead of export in the authoritative dispatch order. The
ledger matches those producers with completed marketplaces on the same cached
road component, subtracts specialty cargo already approaching each market from
that commodity's remaining storage room, and respects the one inbound-supply
cart gate shared by the real dispatch code. It therefore distinguishes cargo
that is ready to haul from cargo waiting for producer labor, a returning source
cart, an occupied receiving slot, market storage, fire recovery, or a road
connection. An unstaffed market can still receive cargo, matching the server,
but that choice creates visible backpressure instead of implied income.

The second half of the account follows the broker desk. Market stock and loaded
inbound carts form its projected queue. A desk clears that queue only when the
market is complete, staffed, safe, on a road, above its selected regional-price
floor, and has a broker not occupied by a manual transaction. The Town Hall
shows free-broker throughput, the slowest active queue, every blocked or
price-held quantity, and a direct link to the largest high-priority failure.
Road reconnection and labor reassignment change the forecast immediately. The
reduction adds no save fields or simulation-tick scans, performs no shortest
path solves, and remains linear in buildings, active carts, and road branches.

The settlement reserve now has a second, physical road-branch view. For each
occupied component it combines food and firewood already in household stores,
stock at completed staffed household distributors, and carts already bound for
that branch. The HUD warns from the weakest branch's spoilage-adjusted food
runway and, during the cold half of the year, its winter-fuel runway; the Town
Hall counts branches without a stocked food route or firewood distributor and
links to the first exposed home. The settlement-wide total remains visible for
strategic accounting, but treasury goods, inaccessible stores, and
service-restricted monastery stock do not promise a delivery they cannot make.
This reuses cached component identifiers, adds no save state or shortest-path
work, and remains linear in buildings, carts, and homes.

In conflict-enabled worlds, the same current multiplier converts each guardhouse's
physical route to its nearest staffed watchtower into a time-equivalent muster
distance. A compact company can still provide its full strength in rain, while a
route near the dry-weather response limit becomes delayed. The selected guardhouse
route changes from green to amber or red as appropriate, and its inspector shows
both physical and response-equivalent distance. This reuses the existing security
report interval and road path result rather than adding per-tick pathfinding.

The contested-world Town Hall also audits present armament by road component.
A guard counts as armed now only from polearms already stored at that guardhouse.
The next coverage tier adds non-returning carts actually bound for the company's
remaining vacancies and finished stock held by a completed, staffed carpenter on
the same component. Polearms in the founding treasury, surplus locked at another
guardhouse, stock in an unstaffed carpenter, and stock on an armory-only component
remain owned but do not promise current company cover. This matches the server:
guardhouses do not redistribute their excess, while staffed carpenters dispatch
finished weapons only along reachable roads.

The ready-craft tier is deliberately narrower than a full production projection.
It adds only the carpenter's selected reserve shortfall that can be made from
timber and imported ironwork already onsite or on a non-returning cart bound for
that workshop. Connected lumber-store and staffed-market stock is shown beside
the remaining input claims, but is not counted as finished output before a cart
actually commits it; other duties may still claim that source or its hauler.
The weakest uncovered company is inspectable directly. Component lookup is
cached, the ledger performs no route solve or save mutation, and the benchmark
covers 100,000 buildings distributed across 200 components.

The existing low, normal, or high guardhouse policy is a company priority rather
than a wage-only switch. Guardhouses are already stepped from high to low for
routine provisioning and payroll. A staffed carpenter now uses the same tier for
its next reachable polearm cart; within that tier it restores the lowest armed
share, then prefers the shorter road and stable building order. This prevents a
nearby low-priority rear company from absorbing every scarce weapon while an
explicitly urgent frontier company remains unarmed. Emergency granary food is
still selected by lowest runway, because immediate starvation overrides standing
company rank. The policy field and normal legacy default are unchanged.

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
