# Development points — the estate’s legacy

Status: **client-only prototype**, September 2026. The earning model below is a design proposal, not an implemented reward system.

## The contract

- One shared development tree and point balance for the **entire map**. No community, settlement, parish, residence, or region owns a separate balance. Changing selection never changes the tree.
- Four branches, six skills each, **24 skills total**. Each skill costs **one point**; the lifetime cap is **nine points**.
- Six points complete any one branch, leaving three for half of another. Spreading points across all four is allowed. There are no hidden mutually exclusive choices.
- Prerequisites must be learned first. The final mastery in each branch requires **both** advanced specialisms, so a mastery really represents completing its branch.
- Benefits will eventually apply map-wide to eligible buildings, households, resources, and companies. They must not bypass physical inputs, existing operational prerequisites, or workforce requirements. Existing basic systems are not newly locked behind this tree.
- No conquering, annexing, or creating extra settlements to obtain more points.

The current preview grants all nine points immediately. Selecting a seal only inspects it; pressing **Unlock development** spends one point. Locked seals still show their name, one-sentence effect, and clickable prerequisites. Learned seals and their connecting paths light up. When the budget is empty, reachable skills say that no points remain.

The **Reset preview** button requires a second click, clears the tree, and refunds all nine points. Closing/reopening preserves choices in this client instance; **reloading or starting a fresh client instance resets them**. There is deliberately no local storage, database field, reducer, simulation modifier, or server-side earning listener. Other clients do not share this temporary preview. Free refunds are a testing aid, not a commitment to a production respec policy.

## Four branches

Every description below is a **proposed future effect**, not an active bonus. Exact numerical modifiers need economy/combat playtesting before simulation integration.

### Land & Harvest

```text
Field Stewards
├─ Deep Furrows ── Harvest Hands ────┐
└─ Living Soil ─── Orchard Keepers ──┴─ Breadbasket
```

| Skill | Prerequisite | One-sentence description |
| --- | --- | --- |
| Field Stewards | None | Careful field planning reduces the labor needed to plough and sow crops. |
| Deep Furrows | Field Stewards | Experienced ox teams prepare larger fields with less ploughing work. |
| Living Soil | Field Stewards | Manure and worked fallow restore more fertility between harvests. |
| Harvest Hands | Deep Furrows | Practised harvest crews gather ripe crops faster before the autumn deadline. |
| Orchard Keepers | Living Soil | Tended household orchards produce more fruit from every mature tree. |
| Breadbasket | Harvest Hands **and** Orchard Keepers | Coordinated fields, orchards, and granaries increase the estate’s harvest yield. |

### Woodland & Waters

```text
Woodland Lore
├─ Coppice Craft ── Forest Gardens ─┐
└─ Hunters’ Paths ─ River Wardens ──┴─ Keepers of the Wild
```

| Skill | Prerequisite | One-sentence description |
| --- | --- | --- |
| Woodland Lore | None | Local knowledge helps foresters and gatherers bring home more useful woodland resources. |
| Coppice Craft | Woodland Lore | Managed regrowth improves the long-term supply of firewood from worked woodland. |
| Hunters’ Paths | Woodland Lore | Experienced hunters recover more meat and hides from each hunted animal. |
| Forest Gardens | Coppice Craft | Carefully tended gathering grounds improve seasonal berry and mushroom yields. |
| River Wardens | Hunters’ Paths | Selective fishing preserves more breeding stock while maintaining a useful catch. |
| Keepers of the Wild | Forest Gardens **and** River Wardens | Estate-wide stewardship strengthens the recovery of renewable woodland and river resources. |

### Craft & Trade

```text
Apprenticeships
├─ Charcoal Mastery ── Master Smiths ─┐
└─ Merchant Ledgers ── Carters’ Guild ┴─ Chartered Markets
```

| Skill | Prerequisite | One-sentence description |
| --- | --- | --- |
| Apprenticeships | None | Apprentices help staffed workshops complete ordinary production cycles faster. |
| Charcoal Mastery | Apprenticeships | Carefully banked kilns turn the same timber into more charcoal. |
| Merchant Ledgers | Apprenticeships | Better trading records reduce the gold cost of imported workshop materials. |
| Master Smiths | Charcoal Mastery | Master smiths forge civilian tools and military equipment with less iron waste. |
| Carters’ Guild | Merchant Ledgers | Organised cart crews carry larger loads on workshop and trade deliveries. |
| Chartered Markets | Master Smiths **and** Carters’ Guild | An estate-wide market charter improves the sale value of locally made exports. |

### Hearth & Watch

```text
Common Cause
├─ Parish Care ── Winter Hearths ─┐
└─ Watch Fires ── Trained Bands ─┴─ Steadfast Estate
```

| Skill | Prerequisite | One-sentence description |
| --- | --- | --- |
| Common Cause | None | Shared building customs reduce the work needed to construct and improve residences. |
| Parish Care | Common Cause | Parish relief reaches struggling households with fewer provisions lost along the way. |
| Watch Fires | Common Cause | A practised watch gives earlier warning of approaching bandits and raiders. |
| Winter Hearths | Parish Care | Better household insulation reduces winter firewood consumption. |
| Trained Bands | Watch Fires | Regular militia drills improve company cohesion and recovery after battle. |
| Steadfast Estate | Winter Hearths **and** Trained Bands | Secure homes and a trusted watch soften household approval losses during hardship. |

## How points should be earned

Use **development experience (DX)** as progress toward each point, not as a second spendable currency. Normal play starts at **zero points / zero DX**; the preview’s nine-point grant must be removed when real earning is connected. Earned points remain earned when spent or when a settlement suffers losses.

| Point earned | Cumulative DX | DX since previous point | Intended mixed-speed playtime |
| ---: | ---: | ---: | --- |
| 1 | 100 | 100 | 20–40 minutes |
| 2 | 250 | 150 | 45–90 minutes |
| 3 | 450 | 200 | 1.5–2.5 hours |
| 4 | 700 | 250 | 2.5–4 hours |
| 5 | 1,000 | 300 | 4–5.5 hours |
| 6 | 1,350 | 350 | 5.5–7 hours |
| 7 | 1,750 | 400 | 7–9 hours |
| 8 | 2,250 | 500 | 9–11 hours |
| 9 | 2,800 | 550 | 10–14 hours |

Times are **tuning targets, not measured playtest results or real-time gates**. Early points should reward establishing a working economy; later points need several productive seasons, broader infrastructure, and sustained care. Grant a point immediately on crossing its threshold, including multiple thresholds crossed in one transaction. Stop at nine; surplus DX never buys a tenth point.

### A. Homes and useful infrastructure — 950 DX lifetime maximum

| Achievement | DX | Validation |
| --- | ---: | --- |
| 5 / 10 / 20 / 35 / 50 occupied residences | 50 / 75 / 100 / 125 / 150 | Each threshold once map-wide; residences must be complete and occupied for seven consecutive game days. |
| 5 / 10 upgraded occupied residences, tier 2 or higher | 75 / 75 | Each threshold once, with the same seven-day occupancy check. |
| First working well, lumber mill, village storehouse, chapel, marketplace, and granary | 25 each, 150 total | Each building kind once; complete, connected as required, supplied/staffed where required, and delivering its normal service for seven days. |
| First working food chain | 50 | Locally harvested cereal must pass through threshing/milling/baking into at least 50 delivered bread units. |
| First working materials chain | 50 | Produce and deliver at least 20 civilian tools using locally produced metal and fuel. |
| First working household-goods chain | 50 | Produce and deliver 50 total locally made clothing, shoes, pottery, or candles, using at least two of those goods. |

These are achievements, not rewards for every building placement. Building extra shells, demolishing and rebuilding, moving goods between stores, or changing a community boundary produces no DX. Imported finished goods do not satisfy production-chain achievements.

### B. Harvests and renewable production — 1,200 DX lifetime maximum

Count **productive years since map creation**, each 360 calendar days from the starting timestamp, rather than resetting allowances on 1 January. Earn up to **400 DX per productive year**, and no more than 1,200 lifetime.

| Action | DX | Limit |
| --- | ---: | --- |
| Bring a genuine cereal or flax harvest into storage | 40 per qualifying 800 m² | At least 60% of that area’s non-development-adjusted expected yield must be delivered; maximum 200 DX per productive year. |
| Bring a household garden or orchard harvest into storage | 20 per 10 producing plots | At least 10 delivered food units per counted plot; maximum 80 DX per productive year. |
| Harvest diversity | 40 for two / 40 for three distinct harvested crops or orchard/garden species | Each threshold once per productive year; a species needs at least 20 delivered units. |
| Steward a renewable food source | 40 | Once per productive year: deliver 100 local fish/forage units while its source remains above 50% of its seasonally applicable capacity for 30 consecutive days. |

Areas/plots are credited once per harvest cycle, tracked cumulatively to avoid losing fractional progress. Early harvesting can qualify only when the delivered-yield requirement is met. Repeated transfers, bought crops, replanting without growth, dividing one field into smaller plots, or deliberately depleting and respawning sources cannot count again. The skill’s own yield bonus does not inflate the reference yield or the earned DX.

### C. Sustained stewardship — 750 DX lifetime maximum

Maximum **250 DX per productive year**, 750 lifetime. Each achievement is available once per productive year:

| Achievement | DX | Validation |
| --- | ---: | --- |
| Reliable provisioning | 100 | Sustain at least 20 occupied residences with neither food nor fuel shortages for 30 consecutive game days. |
| A cared-for estate | 75 | Keep at least 20 occupied residences above 70% approval, with no unresolved severe welfare need, for 30 consecutive game days. |
| Resilient local supply | 75 | Make and deliver at least 100 units each from two different local chains (food, materials, or household goods) while retaining seven game days of household food and fuel at the end. |

A qualifying 30-day window cannot be counted twice across a year boundary. Progress pauses when the simulation is paused; adverse-condition holidays cannot fabricate production or consumption events. Disabled needs/approval do not automatically satisfy their checks: substitute an equal-length local-production target (200 additional delivered food/fuel units for provisioning, 150 additional household goods for care) instead. Count only unique newly produced units.

### D. Protecting the estate — 350 DX lifetime maximum, optional

| Action | DX | Lifetime limit |
| --- | ---: | ---: |
| Defeat a hostile bandit | 2 | 60 DX |
| Clear a naturally generated bandit camp | 35 | 105 DX, three unique camps |
| Repel a naturally scheduled raider assault | 50 | 150 DX, three unique raids |
| Kill a dangerous wild animal during an actual attack on people/livestock | 5 | 35 DX, seven unique attackers |

Bandit defeats count unique hostile combatants who die in legitimate combat with the player’s forces; routed enemies do not also award kill DX. A resolved bandit camp may award its camp bonus as well as capped bandit-kill DX. Raider kills have no extra per-unit reward: the encounter pays only once when repelled, not when attackers leave after a successful raid. Do not award combat DX for ordinary hunting, livestock slaughter, friendly casualties, debug-spawned encounters, reloads, or repeatedly provoking the same animal. Normal hunting is supported through the woodland branch and the wider food economy, without encouraging wildlife extermination.

Combat is a modest accelerator, never mandatory. Peaceful sources offer **950 + 1,200 + 750 = 2,900 DX**, exceeding the 2,800 cap threshold even with all hostile encounters disabled. With combat enabled the total possible is 3,250 DX; this headroom allows some missed milestones. Reaching the cap peacefully will require using most of the available civilian achievements, which should be verified on small maps.

## Pacing against the actual game clock

The current [calendar contract](SEASONS_AND_TIME.md) and `src/generated/gameBalance.ts` define 120 simulation seconds/day, `SIM_REALTIME_RATE = 0.75`, 30 days/month, and 360 days/year. The actual speeds in `src/world/gameSpeed.ts` are **1×, 4×, and 8×**, plus pause.

| Running speed | Real seconds per game day | Real hours per full game year | First normal September harvest from a March start |
| --- | ---: | ---: | ---: |
| 1× | 160 | 16 | About 8 hours |
| 4× | 40 | 4 | About 2 hours |
| 8× | 20 | 2 | About 1 hour |

Formula: `seconds/day = 120 / (0.75 × speed)`. The first harvest estimate is six months of calendar travel and does not include pauses or harvest/haul labor. Early August harvests are possible but lower-yield. Spring crops can contribute in Year 1; autumn-sown crops need the next season. Do not promise an early point that requires a first harvest at 1×: the first two points should come from occupied housing and functioning infrastructure.

**Primary target: 10–14 real play hours**, mostly at 4×, returning to 1× for placement/combat and pausing for planning. Expect cap around the second to third productive year, commonly the third autumn for a peaceful estate. Three autumns from a March start require about 2.5 game years: **40 running hours at 1×, 10 at 4×, or 5 at 8×**, before pauses and delays. A deliberately accelerated 8× veteran run may finish in roughly 5–7 hours; a 1×-only run can take 32–45+ hours. These are consequences of the existing clock, not additional timers.

The caps prevent a builder or combat farmer from finishing immediately. Even perfect collection across two productive years gives only `950 + 800 + 500 + 350 = 2,600 DX`, below the 2,800 threshold. Some third-year actions are necessary. A viable peaceful route is approximately 300–500 DX from early infrastructure, 700–1,000 by the first harvest/established supply, 1,800–2,100 after the second productive year, and 2,800 after third-year harvests and stewardship. This route needs telemetry to validate construction, labor, plot counts, and delivery quantities; it is not a guarantee for every map.

No award should depend on real-world elapsed hours, waiting in a menu, idle time, or leaving the application open. Pausing and using slower speeds are not penalized with different DX; the same actual world accomplishments always pay the same reward.

## Later integration and validation — not part of this implementation

1. Introduce a map-owned authoritative record for cumulative DX, lifetime point awards, learned skill IDs, productive-year source totals, and credited achievements/events. No settlement ID as owner.
2. Consume committed construction/occupancy, production/delivery, harvest, welfare, and encounter-resolution events once. Use their natural unique event/production IDs for duplicate prevention, not compatibility scaffolding for old saves.
3. Validate prerequisites and unspent balance atomically when spending; never trust the client preview’s granted points. Deduplicate awards and clamp earned points to nine, including after reconnect.
4. Introduce each proposed bonus separately with measured modifiers and simulation tests; remove prototype refunds/grants or explicitly isolate them behind developer mode.
5. Playtest small/medium/large maps, peaceful/conflict modes, severe weather, failed first harvest, supply shortages, all three speeds, and players who favor either farming or industry. Track time to each point, source mix, blocked milestones, and branch choices.
6. Adjust DX quantities/thresholds first if pacing misses the target. Do not silently speed up the calendar, require conquest, or duplicate points per settlement. If small maps cannot support 50 residences or 10 productive plots, tune those thresholds before shipping.

## UI and reference

The archive woodcut launcher sits at the **far right of the top resource ribbon** and shows the unspent balance. The opaque full-view tree covers other HUD surfaces; the lord profile at the top right and calendar/speed controls at the bottom right remain usable. Escape/Return closes it, restores focus and world controls, and leaves learned choices intact. Locked nodes are inspectable by keyboard. The scrollable ledger and narrow-screen layout preserve access to every skill and the reset action.

Visual inspiration: the user-supplied circular four-quadrant Manor Lords screenshot. The linked [GameRant article](https://gamerant.com/manor-lords-how-to-get-development-points-best-ways-spend/) was not retrievable during implementation; no current Manor Lords mechanics are asserted from that unavailable page. This design uses the reference’s branching presentation, the existing Gorski woodcut assets, and this game’s actual calendar and building roster rather than copying settlement-tier or conquest progression.

## Verification

- Model regression: `node --experimental-strip-types scripts/testDevelopmentTree.mts`.
- UI fixture: `/scripts/fixtures/development-menu.html` on the local Vite server; uses the actual `BuildToolbar`, `SettlementHud`, and development menu without connecting to the simulation.
- Production mount: `src/ui/BuildToolbar.ts`; tree data and budget logic: `src/ui/developmentTree.ts`; interaction/markup: `src/ui/DevelopmentMenu.ts`; visual layer: `src/ui/developmentMenu.css`.
