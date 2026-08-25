# Seasons, calendar, weather, and simulation speed

## Calendar contract

The calendar is deliberately fictional and fixed:

- 24 displayed hours per day.
- 30 days per month.
- 12 named months per year.
- 120 simulation seconds per day.
- Every month and year has the same length. There are no leap years, variable month
  lengths, accumulated drift, or real-time-zone rules.
- A new world begins on 1 March, Year 1 at 08:00 so the first session opens after
  dawn, near the beginning of spring and the workday.
- Labor normally works from 06:00 to 20:00. A staffed chapel can make Sunday a
  sabbath. Sunday still consumes ordinary household provisions, so it must be
  supplied in advance. Named holy days use the separate protected-rest contract
  below.
- Work hours and Sabbath observance block new ordinary-cart departures. A cart
  that already departed remains a committed crew and completes its delivery,
  unloading, and return home across the boundary instead of camping on the road.
- Visible workers use the same commitment principle. They choose households by
  routed road travel, may depart before 06:00 to reach a distant site, and leave a
  long shift early enough to travel home. Dawn and dusk never reverse an active
  journey. Reaching home establishes at least six displayed hours of rest, even
  when an unusually long return finishes after the next workday begins.
- Exposed extraction worksites may instead construct persistent remote lodging.
  Lumber mills, stonecutters' camps, large quarries, mines, clay pits, and charcoal
  yards expose a worksite-card order that starts targeted placement within 80 m,
  leaving usable clear ground beyond large stone and mineral deposit footprints.
  The resulting two-tent camp is a normal building project: it reserves 14 timber
  and 3 stone, awaits physical material carts and builder labor, can burn, and can
  be demolished into ordinary reclamation. The crew keeps commuting until it is
  complete, then gathers at its fire, disappears into a tent while indoors or
  asleep, and starts locally the next day. Reforester huts, woodcutters' lodges,
  hunters' halls, foragers' sheds, fishing camps, pastoral farmsteads, and
  swineherds have built-in crew lodging; barns, apiaries, vineyards, processors,
  civic sites, and urban jobs retain the daily household commute. Inspectors report
  the measured journey, effective workday cost, lodging rule, and linked project.

### 1550s Gorski Kotar holy-day schedule

This is a schedule system, not a second calendar UI. It adapts a Latin-Christian
1550s observance cycle to the game's rational 30-day months. Game Year 1 uses the
Julian computus for 1550, Years 2–10 use 1551–1559, and Year 11 repeats that
ten-year historical cycle. A real feast falling on a day 31 is folded onto day 30;
relative Easter feasts keep their proper spacing.

| Date or rule | Protected observance | Length | Visible custom |
| --- | --- | ---: | --- |
| 1 January | Circumcision of the Lord | 1 day | Church and household visiting |
| 6 January | Epiphany | 1 day | Church and procession |
| 2 February | Candlemas | 1 day | Church and procession |
| Easter −48 to −47 | Shrovetide | 2 days | Congregating and carnival visiting |
| 25 March | Annunciation | 1 day | Church and household rest |
| Easter −2 to +1 | Good Friday through Easter Monday | 4 days | Church, congregation, and household feasting |
| 23 April | Jurjevo / St George | 1 day | Church, field procession, evening bonfire gathering |
| Easter +39 | Ascension | 1 day | Church and procession |
| Easter +49 to +50 | Pentecost and Whit Monday | 2 days | Church, congregation, and household visiting |
| Easter +60 | Corpus Christi | 1 day | Church and procession |
| 24 June | Ivanje / St John | 1 day | Church, wreath custom, evening bonfire gathering |
| 29 June | Sts Peter and Paul | 1 day | Church and household rest |
| 15 August | Assumption of Mary | 1 day | Church and procession |
| 8 September | Nativity of Mary | 1 day | Church and household rest |
| 29 September | Michaelmas | 1 day | Church and household rest |
| 1 November | All Saints | 1 day | Church and household visiting |
| 11 November | Martinje / St Martin | 1 day | Parish fair and congregation |
| 6 December | St Nicholas | 1 day | Church and household visiting |
| 24–26 December | Christmas Eve through St Stephen | 3 days | Church, household feasting, and visiting |

Every named observance is mandatory and does not depend on the optional Sunday
policy or on having a staffed chapel. The calendar advances, but authoritative
production and every potentially adverse simulation mutation are frozen: carts,
construction, household consumption, heating, spoilage, wages, upkeep, taxes,
illness, fires, raids, and similar penalties neither progress nor accumulate.
Workers at remote camps return to their permanent households. With a staffed,
road-connected chapel, deterministic cohorts physically walk to morning services
and later processions, fairs, or bonfire gatherings; the remaining agents stand
behind their houses in stable backyard groups. Founders celebrate around their camp.
Emergency refuge behavior still has presentation priority if an already-active
threat is visible when an observance begins.

The historical basis is deliberately transparent rather than pretending that one
complete 1550 village calendar survives. Research on Gorski Kotar describes the
annual cycle as following the church calendar with patron-day dances, games, and
social gatherings; local continuity specifically records Jurjevo processions and
bonfires and Ivanje wreath customs. The work prohibition follows the period's
church-holiday tradition. Sources: [Gorski Kotar annual customs study](https://hrcak.srce.hr/file/264086),
[Jurjevo in Lič](https://gorskikotar.hr/en/jurjevo-u-licu/),
[Ivanje wreath tradition in Delnice](https://rgk.hr/etno-udruga-prepelinc-delnice-odrzala-je-17-etno-smotru-ivajnske-kresnice-pred-hiso-racki/),
and [Roman-canonical feast-day work rules](https://hrcak.srce.hr/file/455439).

| Speed | Day | Month | Season | Year |
| --- | ---: | ---: | ---: | ---: |
| Normal, 1× | 2 min 40 sec | 1 hr 20 min | 4 hr | 16 hr |
| Fast, 4× | 40 sec | 20 min | 1 hr | 4 hr |
| Fastest, 8× | 20 sec | 10 min | 30 min | 2 hr |

The scheduler still fires every 200 milliseconds and every completed substep retains
its established 0.2-second meaning. At 1× the fixed-point scheduler advances 0.75 simulation
seconds per real second, making a complete day-night cycle last two minutes forty seconds. Faster
modes receive four or eight times that budget. They accelerate movement,
labor, construction, production, deliveries, consumption, regrowth, reproduction,
weather damage, and the calendar together.

Controls are in the settlement clock. Click the pause button to stop the simulation;
`1`, `2`, and `3` select 1×, 4×, and 8×. Pause is a hard server and presentation boundary: the clock, economy,
agents, deliveries, combat, wildlife, weather, fires, and world animation stop while
camera and UI controls remain available. Speed is server authoritative and global to
the world. In the current shared-world model, any connected player can change it;
host-only authority should be added before a competitive multiplayer mode.

## Night settlement loop

Night remains part of the authoritative game rather than a cosmetic sky pass. Ordinary
field work, construction, and carts stop, but active delivery trips finish their routes,
hearths consume heating fuel, and households consume an explicit evening meal at dawn.
A staffed Town Hall exposes five persistent orders:

- Watch policy changes night-raid warning coverage, petty-theft risk, visible watchtower
  duty, and how quickly an unnoticed fire is reported.
- Evening gatherings keep a deterministic share of households outside in courtyards
  longer and build community cohesion; curfews trade that social benefit for safety.
- Continuous-process work lets stocked brewing, curing, milling, charcoal, and kiln
  batches continue without enabling carts. A full night shift adds selected indoor
  workshops and creates a persistent fatigue burden.
- Public lighting visibly scales camp and household lamps, consumes physical firewood,
  reduces theft, and shortens nighttime fire-discovery delay. Fuel shortfalls are
  reported rather than silently granting the benefit.
- Curfew can be unrestricted, children-only, or general.

At 06:00 the server writes one structured dawn report: warm and well-rested households,
social households, night workers, watch strength, lamp fuel used or missing, recent
fires, theft, and occasional wildlife sightings. Safe and sociable nights smooth
community cohesion upward; staffed night work smooths fatigue upward. Well-rested homes
receive a small settlement-progress benefit.

An incursion is never sliced into shifts. Once combat agents enter the map, guards and
raiders remain authoritative through dusk and dawn until they are downed, retreat, or
physically leave; the night policies affect warning and preparation, not whether the
fight is allowed to continue.

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

- Autumn-sown rye and maslin, along with worked-fallow fields, resume growth.
- Oats, barley, and flax are spring crops: farmers plough and sow them during
  March–April. Oat growth begins in April for the September harvest.
- Rain increases crop growth to 112% and well refill to 130%.
- Rain slows new dirt-road cart trips to 82% of their dry-weather pace.
- Berry and mushroom nodes regrow in place.
- Fish reproduce only in spring. Recovery follows surviving population, so a badly
  depleted shoal recovers slowly and a zero population is permanently extinct.
- Grass-pasture capacity is 115%. Woodland pannage is only 75%; drought, if
  present, overrides it to 55% because a dry spring weakens the coming mast crop.
- Livestock breeding is 125%.
- Household firewood demand is 100%.
- Fresh food spoilage is 0.4% per game day before storage modifiers.

Spring's strategic advantage is recovery: water, forage, fish, pasture, and breeding
are all favorable, while fields have time to recover from a weak start.

### Summer — June through August

- Spring-sown oats, barley, and flax and autumn-sown rye, maslin, and fallow
  continue growing.
- During August, any food or fibre crop at 55% growth may be ordered into early
  harvest. Its current ripeness locks 47–85% of normal yield, opens fieldwork one
  month early, and cannot be undone by saving or reconnecting. Waiting until
  September preserves the full yield.
- Berry and mushroom nodes continue regrowing.
- Grass-pasture capacity is 100%, woodland pannage is 90%, and household firewood
  demand falls to 70%.
- From June through August, staffed cattle and sheep holdings cut their chosen
  share of grazing meadow into local winter hay. That reserved meadow cannot feed
  the herd at the same time, so an aggressive hay policy may require direct grain
  supplementation during the cutting season. Woodland swine do not make hay.
- Fresh food spoilage rises to 0.8% per day.

During drought:

- Crop growth falls to 45%.
- Berry and mushroom regrowth falls to 35%.
- Well refill falls to 50%.
- Grass-pasture capacity falls to 65% and woodland pannage falls to 55%.
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
- Healthy, supplied cattle still reduce plough work on the two highest-priority
  nearby fields. Fertility now depends separately on physical manure: cattle
  holdings collect more dung-and-bedding stock while housed in winter, cart it
  over roads to crop farmsteads after their food duties, and farmers consume it
  in proportion to ploughing progress. Partial field coverage grants only a
  partial soil bonus.
- A fully sown field becomes dormant through winter.

Other autumn rules:

- Gorski Kotar mushroom beds enter their peak fruiting window and regrow at
  175% of their spring/summer rate through November; berry regrowth has ended.
- New cart trips travel at 90% pace on seasonally softened tracks.
- Grass-pasture capacity is 90%, while woodland pannage reaches its 125% acorn-
  and beechnut peak.
- Pigs consume this seasonal mast before drawing direct grain supplements.
- Household firewood demand rises to 115%.
- Fresh-food spoilage returns to 0.4% per day.
- Vegetable and herb gardens taper to 55%; flowers taper to 35%.

Autumn's advantage is the year's concentrated grain, orchard, and swine income. Its
constraint is labor scheduling: a late harvest cannot spill into October, and
unfinished sowing cannot spill into winter.

### Winter — December through February

- Berry and mushroom harvest visuals disappear and their nodes cannot be gathered.
  Their persistent underground resource nodes remain dormant and safe for spring.
- Fishing water is treated as frozen and fishing camps cannot harvest.
- Fully sown grain remains alive but dormant.
- A field still in the sowing stage when winter begins fails and must be ploughed
  again next autumn.
- Grass-pasture capacity falls to 35% and woodland pannage to 45%. Cattle and
  sheep use their holding's local hay first, then direct grain for unsupported
  heads. Pigs use the remaining mast and then direct grain because they do not
  participate in the hay chain.
- Livestock breeding falls to 60%.
- Sheep are not shorn; their annual physical fleece clip is an early-summer event.
- Household firewood demand rises to 200% and continues through nights and
  sabbaths. An unsupplied higher-tier residence accumulates its ordinary firewood
  deficit, lowering approval and household market/tax output and eventually
  blocking residence promotion; the home itself remains permanent.
- Vegetable, herb, and flower garden work stops. Hens continue at 75%.
- Fresh-food spoilage falls to 0.2% per day.
- New cart trips travel at 72% pace on frosted tracks.

Winter's advantage is preservation and freedom for non-agricultural labor. Logging,
mining, stone gathering, construction, crafting, trade, ordinary hunting, and
threshing stored wheat have no general seasonal shutdown, but their road haulage is
slower. Granary ovens, smokehouses, and brewhouses also remain productive only while
their physical firewood buffers are supplied, so ale production competes with baking,
preservation, and the sharply higher household heating claim.

## Livestock land, stocking, and the husbandry clock

A pastoral farmstead begins without a herd. The player first chooses cattle or
sheep, draws one or more pasture polygons inside the holding's work extent, and
then buys whole animals with civic gold. A woodland swineherd already has its pig
policy, but likewise begins at zero head and needs player-drawn pannage before pigs
can be bought. Selling live animals returns the lower regional sale price. Stocked
holdings cannot change species or be demolished; even an empty pastoral holding
must remove its linked species-shaped parcels before switching.

The exact placed land is authoritative, not just the main building. Cattle and
sheep capacity sums every linked polygon after its area, slope, and moisture are
evaluated. Pannage has two independent limits: suitable fenced area and the count
of mature trees whose positions actually fall inside those polygons. Its carrying
capacity is the smaller of the area and mast limits, then the species hard maximum
is applied. Growing trees and mature trees outside the fence do not count. This is
why clear-cutting a pig enclosure can reduce its support even though the polygon's
area has not changed.

The farmstead or swineherd is the animals' shelter, local feed store, separate
water trough, and logistics base. During each fixed daytime husbandry cycle, the
simulation resolves:

1. heads supported by grass or mast, then local winter hay where applicable, then
   direct emergency grain;
2. heads supplied by the water physically present in the holding's trough; and
3. heads covered by active herders at the species-specific care ratio.

Only the intersection of feed, water, and care counts as fully supplied. Poor
support reduces milk, manure, wool, and health; prolonged severe neglect can kill
animals. Additional labor raises care coverage, summer hay output, and hauling, but
does not make biological time run faster. Thirst, production, breeding progress,
and mortality use the building's fixed action interval even when a holding is
unstaffed or temporarily work-paused, so abandoned animals do not become immortal
and large crews cannot accelerate gestation.

There is no separate **Animal Feed** commodity or mixing recipe. Threshed oats are
both a ready-to-eat one-meal porridge grain for people and the preferred direct
livestock supplement, creating a deliberate household-versus-herd allocation choice.
Rye and maslin grain can be fed directly as weaker emergency substitutes. Cattle and
sheep normally graze during the warm seasons, cut local hay from June through August,
and consume that hay before grain in winter. Swine instead follow the pannage mast
calendar and turn directly to grain when mast cannot support the herd. Carried water
is consumed separately at the trough; it is not an input to a feed recipe.

Stable oxen used for transport or production remain a deliberate player abstraction:
their feed and water are abstracted and are not drawn from the settlement's livestock
stores.

Reproduction requires at least two animals, at least 90% support, and healthy
breeding stock. Births stop at the lower of neutral placed-land capacity and the
species management ceiling. Seasonal breeding still peaks at 125% in spring and
falls to 60% in winter; pannage capacity instead follows its separate mast calendar
described above.

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
reaches its maximum in January, and thaws completely during February. A new world
therefore opens on 1 March with green ground and no settled snow. While present,
settled snow is independent of the day's precipitation, so it can remain during a
fair spell or a rainy thaw. The terrain shader reveals a generated seamless snow
surface over the existing ecological grass/dirt material using the shared road
frost uniform. Snow and dry grass share one packed albedo sampler, preserving the
portable 16-texture WebGPU limit and adding no terrain mesh or draw call.

Forest color follows the calendar independently of weather. Broadleaf trees and
European larch leaf out as February's snow retreats, so a new world opens on 1
March with a full fresh-green deciduous canopy and no seasonally bare or half-bare
trees. The pale spring flush matures through April. Leaves begin changing in late
September, reach species-specific gold, copper, orange, or red during October, and
shed progressively through November. Silver fir, spruce, Scots pine, and black pine
remain evergreen. The per-tree deciduous flag is packed into an existing
forest-card instance buffer, so the seasonal treatment adds no texture, vertex
buffer, mesh, or draw call.

Evergreen foliage also reads the settled-snow coverage used by the terrain. A
restrained cool-white dusting settles only on foliage pixels in the upward-facing
parts of silver fir, spruce, Scots pine, and black pine crowns; deciduous trees,
European larch, baked twigs, and the undersides of evergreen crowns remain
uncoated. The response is shader-only and world-locked, adding no texture sample,
mesh, vertex buffer, or draw call.

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

## Trading Post regional exchange windows

A staffed, completed, fire-safe, road-connected Trading Post evaluates its
persistent import and export rules every 30 simulation seconds: six displayed
game hours, about 10 real seconds at 4× under the authoritative 0.75 base
simulation rate. The interval comes from `balance/gameBalance.json`; the client
countdown and Rust scheduler use the generated constant. A newly configured
rule waits for the next window rather than executing instantly. If work or
logistics is paused, the due window remains ready and executes when the post can
operate instead of silently skipping the order.

Local export carts continuously stage only reachable public stock above the
configured settlement floor. At each window all exports resolve before any
imports, so a settlement with no civic gold can legitimately sell a staged
surplus and use those proceeds for an import during the same exchange. Imports
remain limited by live regional prices, civic treasury gold, the configured
target deficit, and actual Trading Post storage room; they are neither free nor
instant. The regional counterparty is abstract, but local movement is not:
provisions and wares leave the post on conserved carts for Marketplaces, water
for wells, and imported ale, apple cider, or pear cider for a staffed reachable
Tavern. Homes receive Beverage service only through that Tavern.

For save and schema compatibility the persistent column remains named
`last_settled_month`; new code stores the monotonic exchange-window sequence in
that existing `u64`. Older monthly values are safely treated as overdue once,
then advance under the bounded cadence.

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
one full regional food lot for recovery. It considers occupied homes in its own
territory whose food need has remained unmet through the service-warning period,
assigns each to its nearest completed marketplace by exact road route, and
selects the routed home with the lowest food stock and room for the entire lot.
The current regional price determines which food offer has the best provision
per gold. The import must fit in marketplace storage, the target cupboard must
fit the full lot, the market cart must be free, and the route must be usable.
The coffer and parish ledger change only after that named cart departs; a blocked
order is free and waits until the next Monday.

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

Stable operating order and lowest cycle runway govern scarce grain carts at
watermills, breweries, and autonomous monasteries, plus industrial well-water
carts at breweries and granary bakeries. Grain dispatch first selects the
lowest cycle runway among workshops that still need their selected one-, two-,
or three-cycle working buffer, then the shortest road route and stable building
order. Wells keep fire response and household service ahead of industry, then
apply input specialization, water-stock ratio against the selected staging
target, route, and stable-order sequence. Construction queue intent never
carries into these completed-building logistics.
The same control also orders direct producer carts for the next link: flour
from watermills to staffed granary bakeries, fresh food dispatched from
granaries or swine holdings to smokehouses, and annual fleece sent to weavers.
These routes restore the workshop stock policy's one-, two-, or three-cycle
working buffer by priority before falling back to nearest-route overflow, so a
high tier cannot absorb every warehouse. Lean, Balanced, Deep, and Fill also
apply the same staging depth to bakery and smokehouse fuel plus well water;
Fill remains the save-compatible three-cycle default.

The crop-year grain account keeps its settlement-wide owned-stock view for
strategic harvest, seed, livestock-supplement, and reserve planning, but processor
runway has a second physical view. Sustained bread, ale, and monastery draw is
grouped by the same cached road components used by real carts. Only releasable
grain at a completed staffed farmstead or granary on that component counts as source
reserve: each holding's field seed claim and every selected granary floor remain
protected. Marketplace seed stock, livestock grain committed at holdings, roadless
stores, and surplus on a disconnected branch cannot cover a processor branch. The
Town Hall shows how many drawing branches have a source, the weakest branch's
equivalent days of source reserve, grain outside current processor branches, and a link to
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
breweries, apiaries, vineyards, pastoral holdings, weavers, and pottery kilns
contribute ale, wine, honey, cheese, cloth, or pottery still in their stores;
local household, preservation, and enabled monastery duties remain ahead of
export in the authoritative dispatch order. Apiaries additionally protect the
selected winter honey floor, and vineyards can export only wine that has
finished its staffed fermentation cycle. The ledger matches those producers
with completed Trading Posts on the same cached road component, subtracts
specialty cargo already approaching each post from
that commodity's remaining storage room, and respects the one inbound-supply
cart gate shared by the real dispatch code. It therefore distinguishes cargo
that is ready to haul from cargo waiting for producer labor, a returning source
cart, an occupied receiving slot, post storage, fire recovery, or a road
connection. An unstaffed Trading Post can still receive cargo, matching the server,
but that choice creates visible backpressure instead of implied income.

The second half of the account follows the broker desk. Trading Post stock and loaded
inbound carts form its projected queue. Drinks, provisions, and wares have
independent seasonal demand, current prices, and Any/Fair/Favorable floors, so
one family can move while another is held. A desk clears eligible stock only
when the post is complete, staffed, safe, on a road, and has a broker not
occupied by a manual transaction. The Town Hall shows all three rates,
free-broker throughput, the slowest active queue, every blocked or price-held
quantity, and a direct link to the largest high-priority failure.
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

The raid calendar remains authoritative but hidden until someone actually sees
the approach. Ordinary scouts have a fallible deterministic chance that rises
with party size. A staffed watchtower instead guarantees a report only when its
effective sight radius reaches the raid's planned map-edge lane. A second lookout
widens that radius, towers built farther toward the correct edge report earlier,
and coverage on another side contributes nothing; complete warning coverage
therefore requires a genuine frontier network. The persisted approach side also
drives the later physical spawn, so a directional report cannot change after
stores or targets move. The HUD shows an approximate countdown only after a
report and raises an immediate contact alarm when every warning source misses.

That warning now has a physical cost and benefit. Armed guards from road-linked
guardhouses leave with issued polearms, march to their ordered or nearest staffed
watch post, and hold the watch line before contact. Travel time matters:
guards still on the road do not count as present at the watch line, while an
unlinked company cannot pre-deploy and must react from its guardhouse once the
attack becomes visible. The same replicated people, health, readiness, and
weapons enter the ensuing fight; if the report is cancelled, they walk back and
return their equipment instead of disappearing.

Raid morale is resolved from the same live battlefield rather than as a hidden
economy roll. After one quarter of the original party has physically fallen,
surviving raiders break if the healthy, supplied guard strength contesting them
is at least ten percent greater; losing half the party causes a collapse even
without that advantage. Every survivor remains an agent and retreats over the
terrain, so guards can pursue fugitives and recover carried stores. The alarm
does not clear until the last capable attacker reaches the frontier or falls.

## Persistent wild resources

- Berries and mushrooms retain their node when empty. Both regrow in spring and
  summer; mushrooms alone receive a 175% autumn fruiting peak. Workers idle while
  a node is empty or winter-dormant.
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

1. Observe whether a 7.5-hour season at 1× creates a satisfying slow-play option.
2. Tune work requirements so an appropriately staffed farm can harvest in September
   and plough/sow in October–November without making failure impossible.
3. Tune winter firewood and pasture multipliers against one full six-hour year.
4. Tune drought frequency before drought severity; frequent severe droughts create
   unavoidable spirals.
5. Preserve a recovery route: trade, granary buffers, preserved food, grain-fed
   livestock, and protected fish populations must all remain viable responses.
