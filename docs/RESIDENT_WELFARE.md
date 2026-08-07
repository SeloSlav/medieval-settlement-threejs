# Resident welfare, mortality, burial, and persistent homes

Resident welfare is authoritative on the SpacetimeDB server. The client renders
replicated household health, service pressure, corpses, graveyards, and reusable
housing capacity.

## Needs and household satisfaction

- Every occupied tier-1 cottage requires one food category, road-linked well
  water, firewood, and access to a staffed church. Marketplace firewood is used
  first, with charcoal accepted as a household fallback after smithy buffers
  are supplied. Food shortage advances through hungry, malnourished, and
  starving stages. Water and cold exposure increase illness risk.
- Tier 2 continues those needs and adds cloth plus a second food category.
  Tier 3 requires three food categories, preserved food, ale, pottery, and a
  tier-2 stone church while retaining the lower-tier obligations.
- Food variety counts categories rather than labels in the pantry: grains,
  vegetables, fruits, animal produce, meats, fish, foraged foods, and honey.
  Apples and legacy cherries therefore do not count twice, nor do milk, eggs,
  and cheese. Market delivery planning prefers a category the destination home
  is missing.
- Preserved food is an emergency substitute for fresh food. It is not consumed
  as an unavoidable second daily meal.
- No need shortage removes residents through migration or abandons a home.
  Supplying food again reduces hunger and heals malnutrition gradually.

Mortality is probabilistic rather than scheduled. Starvation risk begins after
14 accumulated unfed days and rises over the following 21 shortage days. A
household that remains completely unheated in winter receives a three-day grace
period before exposure deaths become possible; that risk rises over the next
seven consecutive cold days. Restoring food or winter heat stops the respective
death rolls, and non-winter firewood deficits never pre-age the cold clock.

Every continuously unmet active need contributes to one household service timer.
The default balance deliberately stages its consequences:

1. after 3 in-game days, the household becomes a visible approval warning;
2. after 6 days, promotion to tier 2 or 3 is blocked until service recovers;
3. household market activity and assessed tax ramp down gradually, reaching a
   55% floor after 18 days.

The first three days are a no-penalty logistics grace period. The economic curve
then ramps rather than jumping, so a temporary cart delay is recoverable while a
neglected road branch has a meaningful settlement-wide cost. Backyard food kept
for the household is not reduced; only market activity and the tax derived from
it are affected.

The timings and multiplier live under `population` in
`balance/gameBalance.json` and are generated into both Rust and TypeScript.

## Illness and herbs

Illness risk rises with malnutrition, unsafe water, winter exposure, and nearby
uncollected bodies. Sick residents remain housed but are removed from the
available labor pool.

An occupied herb-garden backyard produces stored remedies. A sick household
uses those remedies automatically, recovering faster and suffering a lower
mortality chance.

## Settlement feedback

The settlement HUD shows welfare only when an occupied household, body, burial
queue, or sustained service shortage needs attention. A watch becomes critical
for starvation, a serious untreated outbreak, or a body that has no available
grave or has remained at a home for at least one in-game day.

The Town Hall ledger always shows:

- occupied homes without a current health or service warning;
- hungry, malnourished, starving, sick, service-strained, and promotion-blocked
  households;
- average taxable household output after service penalties;
- stored remedies, daily treatment demand, and homes missing treatment;
- bodies and burial-cart states, plus occupied, reserved, and open graves;
- empty homes that remain available to new settlers without vacancy decay.

The **Inspect** action selects the highest-risk occupied household. Equal risks
use stable server-id order, so table iteration and reconnects cannot change the
suggested target. The summary shares the existing settlement-provisioning
residence scan rather than adding a second per-snapshot pass.

## Death and burial

Each death reduces the population of that residence by one and creates one
persistent `corpse` row at the home. The freed capacity remains an ordinary
empty slot, so future population can move into it once the household's settlement
requirements are ready. A completely empty completed home remains reusable.

A completed chapel can use **Lay adjacent burial ground** in its inspector. The
player traces a convex four-corner parcel like a farm field. The server validates
area, edge length, slope, water, quarry pits, overlap, chapel range, and direct
adjacency. Capacity is derived from parcel area and remains occupied permanently.

Each assigned chapel worker can operate one burial cart. The server reserves a
free grave and plans both halves of the journey: the empty handcart travels from
the chapel to the home, then returns with the body to the linked graveyard. The
body remains at the home, including its local disease pressure, until collection.
On arrival the corpse row is removed and the graveyard burial count increases.

## Persistent and damaged residences

Vacancy never changes a residence's condition and never creates a repair project.
Old save rows carrying the former abandonment, vacancy, or condition fields are
normalized to a sound, non-abandoned home. Those additive columns remain only for
save compatibility and are not gameplay state.

Fire damage is separate from vacancy. A burned residence is temporarily disabled
until its physical fire-recovery project completes, but the parcel and home
identity remain permanent and never enter an abandonment loop.

World reset removes corpses and graveyards. A chapel cannot be demolished while
it still owns consecrated burial ground, and a graveyard containing burials
cannot be demolished.
