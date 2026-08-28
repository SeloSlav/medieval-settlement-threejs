# Ages and historical progression

**Status:** Concept — planning only; no implementation is authorized by this document
**Last updated:** 2026-08-27
**Project:** Selo Empire

## Decision

Selo Empire should progress through a small number of visually distinct historical **Ages**. An Age is not completed by filling a separate technology tree or proving an abstract list of supply chains. It is completed by building a meaningful cohort of that Age's best residences and continuously satisfying the needs those residences already expose to the player.

For the current Croatian Frontier game, the capstone residence is the **Tier 4 home**. Supplying and maintaining enough occupied Tier 4 homes is itself proof that the settlement has built as much farming, processing, distribution, trade, infrastructure, and institutional capacity as it needs to advance. Optional industries and unused production routes do not become hidden blockers.

The campaign has exactly four playable Ages:

1. **Croatian Frontier — 1550**;
2. **The Karolina Road — 1726**;
3. **Railway and Industrial Municipality — 1873**;
4. **Electrified Socialist Municipality — 1966**.

Four Ages are enough. Together they form a specifically Gorski Kotar infrastructure ladder: pack trails and noble-estate roads become an engineered imperial road, then a mountain railway and industrial municipality, and finally an electrified, motorized, publicly serviced socialist municipality. Each entry must create a large, legible change in architecture, transport, utilities, public space, residence forms, clothing, props, production, and household expectations.

Intermediate periods still matter, but they are handled through generational jumps, chronicles, inherited conditions, and optional historical scenarios rather than receiving additional progression ladders. The World Wars are **historical ruptures between Ages**, not prosperous production Ages the player is rewarded for reaching. The main progression ends in the mature socialist period; post-1990 history is outside this four-Age campaign rather than a fifth Age.

An entered Age is permanent. Shortages can make households lose welfare and stop progress toward the next Age, but they cannot make the calendar run backward, delete knowledge, demote structures, or revoke an Age already reached.

## Geographic scope

The current sandbox is Gorski Kotar, Croatia, in 1550. The four-Age campaign remains locally grounded in that region rather than becoming a generic history of Croatia, Yugoslavia, or the Balkans. Other localities require their own researched manifests if they ever become playable.

The first Age is called **Croatian Frontier**. Historically, the 1550 setting is early modern and late Renaissance, although medieval institutions and material practices persist. The exact anchor years below are content and art-direction boundaries: they identify the historical transformation each Age owns without claiming that every village changed in a single year.

## Design principles

- **Residences are the progression gate.** The current Age ends when enough occupied capstone residences have had all of their declared needs maintained for the required window.
- **Household needs are the economy test.** Goods and services count only when they actually reach the qualifying residences through the authoritative simulation.
- **No parallel economy exam.** There is no separate requirement to operate every possible supply family. A chain matters to advancement only when it supplies a declared capstone-residence need.
- **A cohort prevents showcase-house exploits.** One mansion surrounded by deprivation cannot advance the settlement.
- **Ages are rare visual transformations.** Each Age must justify itself with a strongly different built environment and residence path. Historical periods that do not warrant that production scope are crossed in a time jump.
- **No bridge-item leakage.** Assign a commodity or production chain to the earliest Age in which it has a clear, mature cultural and economic role. An isolated earlier attestation is not a reason to introduce a next-Age item near the end of the current roster.
- **Advancement is earned, previewed, and player-triggered.** Eligibility produces an announcement and confirmation screen; the game never changes Age without the player's choice.
- **History accumulates.** Roads, parcels, landmarks, workshops, ruins, and selected older production methods remain visible as the settlement changes.
- **Residence Tier and Age are separate.** Tier describes prosperity within a residence family. Age determines which residence forms, upgrades, services, and visual language are available.
- **Historical politics are systems, not stereotypes.** Identity, religion, nationalism, class, and state power act through institutions, media, policy, and material conditions—not inherent population traits.

## Player-facing vocabulary

| Term | Meaning |
| --- | --- |
| **Historical Age** | The highest Age entered. It is permanent and never decreases. |
| **Age Standard** | The residence needs, services, infrastructure, and visual language introduced by an Age. |
| **Capstone Residence** | The highest residence upgrade or residence form whose sustained needs complete the current Age. |
| **Completion Cohort** | The required group of occupied capstone residences that must pass together. |
| **Maintenance Window** | The rolling period during which every counted residence must remain at its complete, player-visible standard. |
| **Legacy Building** | An earlier-Age building that remains as working fallback, adaptive reuse, heritage, or ruin. |
| **Historical Rupture** | A war, dissolution, occupation, or systemic break handled as a transition/scenario rather than an advancement tier. |

Do not call Ages “settlement tiers.” Residence tiers, Approval tiers, and the map's Hamlet/Village/Town labels already have separate meanings.

## Core progression loop

1. Build the current Age's economy and services as needed during ordinary play.
2. Unlock and build the Age's capstone residence upgrade or residence form.
3. Establish the required occupied Completion Cohort.
4. Keep every declared need of those residences satisfied through one shared Maintenance Window.
5. Use the residence panel or Town Hall summary to find any failing home, need, or road branch.
6. When the cohort passes, receive an **Age Ready** announcement and review the next Age's time jump, new needs, unlocks, and visual changes.
7. Choose when to advance. The confirmation crosses the generational time jump; it does not start another resource-delivery project.
8. Begin the new Age with new residence upgrades and building options while older districts remain usable.

Reaching the final Age opens its endgame and leaves the sandbox running.

## Residence completion contract

### The only advancement proof

Age completion is derived from the same authoritative household state the player already manages. If a requirement does not appear as a need or service on the relevant capstone residence, it cannot silently block advancement.

A qualifying residence must:

- be the current Age's declared capstone residence or final upgrade;
- be occupied rather than an empty shell;
- meet a minimum meaningful occupancy so nearly empty prestige buildings cannot carry the gate;
- have every declared food, water, fuel, goods, utility, institution, access, and comfort need satisfied;
- receive those goods and services through the real road, distribution, utility, or service network;
- remain free of a sustained household warning throughout its Maintenance Window.

The residence need list is the contract. It may contain substitutable goods, but the player needs only one valid path for each substitutable need. Optional orchards, exports, recipes, workshops, military systems, or institutions do not block an Age unless the chosen scenario makes their output an explicit residence need visible before the window begins.

Transient cart timing or a one-tick service refresh should use the household system's normal grace behavior. A sustained failure stops that residence's qualifying timer. The UI must show which home failed, which need failed, and how much maintained time was lost; it must not expose an opaque civilization progress percentage.

### Age I completion cohort

For **Age I — Croatian Frontier**, the capstone is the existing **Tier 4 home**.

The provisional cohort target remains scaled and capped:

`required Tier 4 homes = min(24, max(world-size floor, ceil(20% × peak occupied homes during the Maintenance Window)))`

Suggested starting floors are 8 homes on a Small world, 12 on a Medium world, and 16 on a Large world. These are balance targets, not final constants. Using the trailing peak prevents demolition or short-term depopulation from lowering the target during proof.

Every counted Age I home must:

- average at least the current Tier 1 household baseline of three residents across the window;
- be at structural Tier 4;
- maintain every need shown for a Tier 4 household, including its complete diet, cured provisions, beverage, cloth, shoes, pottery, luxury, water, fuel, faith/civic service, storage, and marketplace access where those remain part of the authoritative Tier 4 contract.

Maintaining that cohort demonstrates all supply capacity actually necessary for Age I completion. There are no additional permanent chain badges and no second checklist for unused industries.

### Later-Age capstones

Each later Age declares one visually and mechanically clear capstone residence path. It may be an upgrade to an older home, a new detached or row-house family, or a multi-household apartment building. Dense buildings count their actually occupied, fully serviced dwelling units, not their exterior shell as dozens of free completions.

Later Ages should reuse the same rule:

`build the capstone cohort + maintain all declared capstone needs = Age complete`

The exact cohort size and Maintenance Window may vary with dwelling capacity and game pace, but the underlying rule must not change between Ages.

### Maintenance Window

Use one concurrent rolling window for the whole cohort. A provisional Age I target is **120 in-game days**, subject to playtesting. The purpose is only to prove sustained household operation rather than a one-day stockpile spike.

Seasonal requirements remain ordinary residence needs. The system must not add a hidden forecast, reserve-horizon score, or separate winter exam. If testing shows 120 days is too long or too easy to schedule around, tune the visible duration or the residence's seasonal needs rather than restoring a second progression system.

## Soft Age transition

Eligibility does not immediately change the world. It raises a prominent but non-blocking **Age Ready** announcement. The player can keep playing in the current Age and open the transition screen when convenient.

The confirmation screen previews:

- the next Age and the approximate historical time skipped;
- the new residence upgrades and residence forms that will unlock;
- the new needs that future current-standard homes will introduce;
- new buildings, utilities, transport, policies, and institutions;
- which existing building visuals will update, remain historic, or gain a retrofit option;
- how population records, stock, treasury, carts, and unfinished work are treated across the time jump;
- any locality-specific historical rupture or campaign choice crossed during the jump.

Confirming plays a short chronicle, announcement, or map montage and then enters the new Age. There is no additional civic megaproject or resource checklist after the residence cohort has already qualified.

Age entry should feel soft in simulation terms and strong in presentation:

- new residence upgrades and Age-owned build cards unlock;
- a declared set of continuing buildings can swap to new Age-appropriate meshes, materials, props, or frontage treatments where the change is purely visual and preserves function and footprint;
- functional improvements such as electricity, sewerage, heating, rail access, or modern logistics require explicit player-built retrofits;
- important older buildings and coherent historic districts remain as legacy architecture instead of being universally reskinned;
- newly introduced household needs apply to new or upgraded current-standard residences and then phase into the wider settlement through a visible grace policy.

The Age manifest must list every automatic mesh replacement. A visual swap may not change capacity, inventory, staffing, service area, or upkeep behind the player's back.

## Residences across Ages

Do not add a generic Tier 5, Tier 6, and Tier 7 merely to mirror chronology. There are only four Ages, and each later Age can introduce a specific residence upgrade path or new housing family when that produces a genuinely different settlement shape.

- A Tier 4 Croatian Frontier home is never demoted merely by an Age transition or shortage.
- In a later Age it may remain a maintained historic home, receive a current-standard retrofit, or become the base for a newly unlocked upgrade.
- New row houses, workers' housing, villas, and apartment blocks can express later standards without stretching one Medieval cottage mesh across five centuries.
- Old homes remain occupied under the persistent-home philosophy; missing modern services reduce welfare and opportunity but do not erase tenure.
- Only homes or dwelling units at the current Age's declared capstone standard count toward the next transition.

New-Age residence needs must phase in through a grace period and explicit upgrade program. Advancing should unlock the next planning challenge, not make every existing household fail on the first simulation tick.

## Continuity of the physical settlement

An Age transition is a generational jump, not a new map.

Every existing asset belongs to one of four categories:

1. **Visual continuation** — keeps its function and footprint but may receive an automatic Age-appropriate mesh/material variant.
2. **Retrofittable** — can gain a new utility, safety, power, frontage, or logistics connection through player action.
3. **Adaptively reusable** — can become a school, workshop, cooperative store, clinic, cultural site, or other later use.
4. **Legacy/obsolete** — remains as low-throughput fallback, heritage, ruin, or a candidate for deliberate demolition.

Earlier infrastructure must not be dead content. Historic roads can shape later streets, rail approaches, and utility corridors. Traditional production can provide low-throughput resilience. Preserved buildings and districts can later create civic, cultural, educational, or visitor value.

The day/month simulation cannot run for five hundred literal years. Transitions advance macro-history by decades or generations while ordinary seasonal simulation continues inside each Age. Household identities may become family lines or community records so continuity survives even though individuals do not live across the whole campaign.

Before confirmation, the transition preview must state exactly how perishables, durable stock, active carts, unfinished projects, population records, and treasury balances survive or are normalized. A montage must not silently duplicate, destroy, or preserve impossible physical state.

## Four-Age historical ladder

This is the final spine for the Gorski Kotar campaign. It is a visual, infrastructure, and production ladder, not a claim that the years between its anchors were historically empty.

### Age I — Croatian Frontier

**Anchor:** 1550.

**Historical identity:** a cold late-Renaissance Croatian mountain frontier shaped by Frankopan and Zrinski estates, nearby Habsburg–Ottoman conflict, Adriatic trade, forest subsistence, and older local institutions.

**Visual identity:** timber and masonry houses, shingle and tile roofs, household plots, pack trails and handcart roads, mills, craft yards, parish and estate landmarks, frontier works, and a small Adriatic-facing rural market network.

**Economic identity:** household farming, forest extraction, pack-animal trade, hand production, preservation, ale, apple and pear cider, mead, and wine. Strong distilled spirits do not enter this Age's commodity roster merely because isolated sixteenth-century attestations exist.

**Capstone:** a maintained cohort of occupied Tier 4 Croatian Frontier homes.

Once that cohort qualifies, further Age I work should prioritize polish, balance, resilience, historical texture, and readability rather than absorbing industries whose mature identity belongs to Age II.

### Generational jump — from estate frontier to imperial corridor

The chronicle crosses the consolidation of the Military Frontier, the Zrinski and Frankopan period and its end, the wars of the seventeenth century, the 1699 settlement, Habsburg/Cameral control, migration, and the shift from threatened mountain estates toward an imperial route between the interior and the Adriatic. These changes shape inherited ownership, settlement records, landmarks, obligations, and road alignments without becoming a separate Age.

### Age II — The Karolina Road

**Anchor:** 1726, when construction of the Karolina road began through Gorski Kotar.

**Historical identity:** an early-eighteenth-century Habsburg road frontier in which mercantilist policy and an engineered Karlovac–Adriatic connection begin reorganizing settlement and trade.

**Visual identity:** surveyed road alignments, cut slopes, gravel and stone roadbeds, retaining walls, drainage, stone bridges, wagon yards, post stages, tollhouses, customs points, roadside inns, larger stables, sawmills, charcoal yards, and Baroque religious and administrative buildings.

**Economic identity:** draft-animal and wagon logistics, road construction and maintenance, timber and sawn-lumber exports, charcoal, ironworking, grain and salt transit, imperial contracts, hospitality, and higher-value imported goods.

**Signature commodity — rakija:** rakija belongs wholly to Age II, not as a late Age I bridge item. A distillery converts fermented fruit, cider, wine, or suitable by-products with firewood and copper equipment into a compact, durable, high-value spirit. It supports trade, hospitality, luxury, and remedies; it is not another interchangeable everyday thirst drink.

**New pressures:** road gradient, bridge and drainage upkeep, winter closure, wagon and draft-animal capacity, convoy safety, banditry and smuggling, toll policy, fire risk, and dependence on distant markets.

**Capstone direction:** a maintained cohort of prosperous roadside households, coachmasters, merchants, or upgraded Baroque homes supplied with dependable road access, fuel, varied food, household wares, hospitality goods, and the Age's declared civic and religious services.

### Generational jump — reform, the Lujzijana, and municipal modernization

The 1777 administrative formation of Gorski Kotar, the Lujzijana road begun in 1803, Napoleonic and Habsburg reforms, the end of feudal obligations, literacy, schooling, cadastral administration, migration, and national movements appear in the chronicle and inherited map. The Lujzijana is an important engineered upgrade and route choice, but it is not a fifth Age or a near-duplicate road ladder.

### Age III — Railway and Industrial Municipality

**Anchor:** 1873, when the Karlovac–Rijeka railway opened through Gorski Kotar.

**Historical identity:** a steam-rail mountain corridor tying timber-producing settlements and municipal centers to Rijeka, Zagreb, Budapest, and wider export markets.

**Visual identity:** cuttings, embankments, tunnels, rails, stations, water towers, signals, depots, warehouses, steam locomotives, industrial sawmills, denser plastered streets, civic schools and offices, worker housing, street lighting, and the beginnings of piped municipal services.

**Economic identity:** timetable- and capacity-bound rail logistics, coal and water supply, machine maintenance, bulk timber and manufactured-wood export, industrial employment, municipal finance, print and education, larger shops, and early tourism.

**New pressures:** rail bottlenecks, locomotive servicing, industrial fire, sanitation, worker housing, food supply for denser settlements, pollution, labor relations, market shocks, and uneven access between station towns and bypassed villages.

**Capstone direction:** a maintained cohort of industrial-era masonry homes, townhouses, or worker dwellings with reliable food and fuel distribution, sanitation, education, municipal services, consumer wares, and access to the road-and-rail network.

### Generational jump — wars, reconstruction, and socialist development

The First World War, interwar state, economic crisis, Second World War, occupation, resistance, civilian loss, postwar reprisals, reconstruction, nationalization, and early socialist reforms are historical ruptures and transition history rather than economic Ages. Any playable wartime scenario requires precise local research and must focus on civilian survival, disrupted networks, relief, and remembrance rather than rewarding violence.

### Age IV — Electrified Socialist Municipality

**Anchor:** 1966, representing the mature modernization drive and the 1966–76 investment period in which much of the region's tourism infrastructure expanded.

**Historical identity:** a self-managed Yugoslav municipality balancing public services, wood industry, transport, tourism, consumer modernization, and migration between mountain settlements and larger cities.

**Visual identity:** paved motor roads, buses, trucks and private cars, power lines and substations, piped water and sewerage, district and household heating, mechanized forestry, wood-processing complexes, schools, clinics, municipal offices, social housing, apartment buildings, hotels, mountain lodges, reservoirs, recreational grounds, and civic monuments.

**Economic identity:** electricity, fuel and motor logistics, socially owned enterprises, mechanized forestry, higher-throughput wood products, construction materials, public-service staffing, domestic and international tourism, retail consumer goods, guest-worker remittances, and municipal investment.

**New pressures:** grid and utility maintenance, snow clearance, motor-road safety, housing allocation, enterprise productivity, public-service coverage, pollution and forest stewardship, investment tradeoffs, regional inequality, out-migration, labor shortages, debt, and inflation.

**Capstone direction:** a maintained cohort of fully serviced detached homes and/or apartment dwellings with electricity, safe water, sanitation, heating, communications, consumer supply, transit access, education, health care, and a functioning local employment base. Industrial output alone cannot complete the final Age.

Age IV is the endgame. It may contain internal early, mature, and late-socialist chapters, but there is no fifth contemporary Age. Completing its capstone records an outcome for the community and leaves the sandbox running.

## Historical and ethical guardrails

- Scope the main chronology to the Yugoslav region; do not use “the Balkans” as if it were one state or one people.
- Avoid “ancient ethnic hatreds,” “tribal,” “backward Balkans,” and similar deterministic explanations.
- Do not project modern national borders or fixed identities backward into Medieval play.
- Represent Muslim, Orthodox, Catholic, Jewish, Roma, Albanian, Vlach-designated communities, Aromanians, Hungarian, German, and other lives where locally relevant, using period- and locality-specific terminology and recognizing that identities and official categories changed over time.
- Do not make ethnic homogeneity, forced assimilation, territorial expansion, propaganda, expulsion, or atrocity an optimal strategy.
- Multiperspectivity means representing different civilian experiences and political viewpoints. It does not mean presenting court-established crimes as unknowable “competing narratives.”
- Treat the World Wars and 1990s conflicts through civilian consequences, precise local history, and remembrance rather than spectacle.
- Commission regional historians and sensitivity readers before locking any 1941–1945 or 1991–2001 scenario.
- Preserve an explicit distinction between a historically bounded campaign and any counterfactual sandbox path.

## Avoiding grind and exploits

- Count sustained, occupied capstone residences rather than production totals.
- Use the residence's real need satisfaction; do not duplicate those rules in a hidden Age ledger.
- Scale and cap the cohort so one showcase home cannot pass and large worlds do not become punitive.
- Apply meaningful minimum occupancy and count serviced dwelling units inside dense housing.
- Count only goods and services that actually reach the relevant residence.
- Let any valid local or trade-supported route satisfy a substitutable residence need.
- Keep the Maintenance Window visible and use ordinary household warning grace.
- Freeze an Age's capstone need contract for established saves or explicitly grandfather new requirements.
- Never require an Age-entry checklist again after a later shortage.

## Player-facing presentation

The Town Hall should eventually gain a compact **Age** panel showing:

- the current Historical Age;
- the current Age's capstone residence or residence options;
- required cohort size and currently qualifying count;
- maintained time and remaining time for each candidate residence;
- the exact failing residence, need, service, or route;
- the next Age's major residence, building, utility, and visual unlocks;
- the **Enter the Next Age** action after qualification.

Most diagnosis should link back to the existing residence and network interfaces. Do not build a second encyclopedic supply-chain screen for Age progression.

Age changes must also be visible in the world:

- selected common structures receive declared Age-appropriate mesh/material variants;
- new residence upgrade silhouettes reshape streets and skylines;
- old routes become street, rail, and utility corridors;
- institutions occupy adapted older buildings as well as new architecture;
- historic districts survive beside later construction;
- the Croatian naïve-art interface treatment remains a cross-Age thread while each Age receives its own architecture and object language.

## Scope-control rule for future features

Once the Medieval capstone residence contract is complete, every proposed system should answer:

1. Which of the four Ages owns this system?
2. Does it satisfy a declared residence need, establish an Age-defining network, or deepen a central historical tension?
3. Is it required for the capstone residence, an elective strategy, or visual texture?
4. Can an existing physical system be transformed or retrofitted instead of adding a parallel subsystem?
5. Is its world art distinct enough to help justify a playable Age rather than a chronicle transition?
6. What existing horizontal feature will be deferred if this enters the current Age?

Medieval can continue receiving fixes, polish, regional texture, balance, accessibility, performance work, and anything needed by Tier 4 residences. It should stop absorbing unrelated industries that belong to a later Age.

## Future delivery sequence

This is a planning order, not an implementation commitment.

1. **Lock the Medieval Tier 4 need contract.** Reconcile document drift against the authoritative server and define exactly which currently visible needs must remain satisfied.
2. **Tune the Completion Cohort.** Playtest map-size floors, minimum occupancy, cap, and the provisional 120-day Maintenance Window.
3. **Add authoritative residence timers.** The server records qualifying time per residence; the client only displays it.
4. **Prototype the Age Ready screen.** Preview the large time jump, unlocks, mesh changes, stock normalization, and historical choices without changing gameplay yet.
5. **Build one vertical slice.** Medieval → Railway and Industrial Municipality must prove map continuity, new residence upgrades, declared mesh replacements, retrofit rules, and the announcement transition.
6. **Parameterize art and world rules by Age.** Build cards, architecture, props, residents, vehicles, roads, iconography, holidays, and environmental framing need Age-owned variants.
7. **Add the two later Ages one at a time.** Each receives a capstone residence contract, visual manifest, historical review, and acceptance tests.
8. **Require specialist review for rupture and final-era content.** No wartime or post-Yugoslav scenario ships on systems design alone.

## Acceptance criteria for the eventual system

- The campaign contains four playable Ages, each with a clearly different world silhouette and residence path.
- The current Age completes only through a maintained cohort of its capstone residences.
- Medieval completion is based on occupied Tier 4 homes and their actual authoritative needs.
- No unused industry or separate supply-family badge can block advancement.
- Empty, nearly empty, disconnected, or briefly supplied residence shells cannot carry the cohort.
- Every failure is explained through a specific residence need or route the player already understands.
- Qualification produces an announcement and player-controlled confirmation, not an automatic transition.
- Confirmation performs a soft time jump and immediately unlocks the next residence upgrades and Age-owned build options.
- Declared visual-only mesh replacements preserve building state and gameplay values exactly.
- Earlier buildings and roads remain useful and visually present unless the player replaces them.
- Advancing never surprises the player with immediate universal household failure.
- Historical rupture content cannot be treated as an economic Age or victory ladder.
- The first new Age feels like a transformation of the same settlement, not a new game loaded on top of it.

## Non-goals

- Five, six, or seven playable Ages that split chronology more finely than the art and mechanics justify.
- A generic Civilization-style technology tree detached from household life.
- A parallel Chain Mastery checklist in addition to residence needs.
- Literal simulation of every day from 1550 to the present.
- Automatic Age advancement at a calendar date or the instant eligibility is reached.
- Generic Tier 5+ residences added only to mirror chronology.
- Automatically replacing every old building with a modern mesh.
- Deleting or auto-demolishing obsolete buildings during transition.
- Revoking historical knowledge after an ordinary shortage.
- Making every commodity variant mandatory.
- Forcing a Yugoslav chronology onto non-Yugoslav Balkan regions.
- Turning war, nationalism, ethnic homogeneity, or displacement into a score-maximizing path.

## Open design decisions

- What are the final map-size cohort floors, cap, occupancy rule, and Maintenance Window?
- What capstone residence forms and needs define Ages II–IV?
- Which existing meshes receive an automatic visual continuation at each transition, and which require a retrofit or remain historic?
- Is the player a continuous settlement institution, a family line, a municipality, or an abstract civic stewardship across generations?
- Does the main campaign stay in Gorski Kotar, expand to a regional map, or allow locality-specific campaign modules?
- How much historical contingency is allowed around Yugoslav formation, survival, and dissolution?
- Are rupture periods chronicle transitions, survival scenarios, optional modules, or a mixture by campaign mode?
- How do dense apartment districts count occupied dwelling units without becoming an easy cohort exploit?
- What late-game outcome best expresses success without declaring one contested political program universally correct?

## Historical research baseline

These are starting points for terminology and chronology, not substitutes for commissioned regional review:

- Robert Skenderović, [“The Population of Gorski kotar in the Early Modern Period and the 19th Century: From Pre-Modern Society to the First Changes Caused by Modernisation”](https://doi.org/10.21857/ypn4oc4l59).
- United States Holocaust Memorial Museum, [“Yugoslavia”](https://encyclopedia.ushmm.org/content/en/article/yugoslavia).
- Glenn E. Curtis, ed., [_Yugoslavia: A Country Study_](https://www.loc.gov/item/91040323/) — its research ended in December 1990, so it is not a source for post-1991 events.
- 1914–1918 Online, [“Yugoslavia”](https://encyclopedia.1914-1918-online.net/article/yugoslavia/).
- Barbara Jelavich, [_History of the Balkans_](https://www.cambridge.org/core/books/history-of-the-balkans/E478B46D1EB3F80948EF66B1A777F5CC).
- John R. Lampe, [_Yugoslavia as History: Twice There Was a Country_](https://assets.cambridge.org/97805217/73577/frontmatter/9780521773577_frontmatter.pdf).
- Saul Estrin, [“Yugoslavia: The Case of Self-Managing Market Socialism”](https://www.aeaweb.org/articles?id=10.1257/jep.5.4.187).
- U.S. Office of the Historian, [“Eastern Europe, the Soviet Union and Foreign Policy Autonomy,” §§17–21](https://history.state.gov/historicaldocuments/frus1977-80v20/d30).
- International Criminal Tribunal for the former Yugoslavia, [historical overview of the conflicts](https://www.icty.org/en/about/what-former-yugoslavia/conflicts).
- Council of Europe Observatory on History Teaching, [guidance on multiperspectivity](https://www.coe.int/en/web/observatory-history-teaching/-/integrating-multiperspectivity-in-the-history-classroom).

## Related project documents

- [`README.md`](../../README.md) — current feature and economy inventory.
- [`SEASONS_AND_TIME.md`](../SEASONS_AND_TIME.md) — current calendar and seasonal simulation contract.
- [`RESIDENT_WELFARE.md`](../RESIDENT_WELFARE.md) — persistent homes, shortage grace, and welfare consequences.
- [`building-visual-language.md`](building-visual-language.md) — current 1550 Gorski architecture contract.
- [`leather-economy.md`](../leather-economy.md) — example of a complete physical household supply chain.
- [`server-authoritative-connection.md`](server-authoritative-connection.md) — authority and persistence model future Age state must respect.
