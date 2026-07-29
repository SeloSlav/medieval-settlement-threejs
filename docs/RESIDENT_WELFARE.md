# Resident welfare, mortality, burial, and vacant homes

Resident welfare is authoritative on the SpacetimeDB server. The client only
renders replicated household health, corpses, graveyards, and structural
condition.

## Needs and migration

- Food, water, and winter firewood are survival needs. Food shortage advances
  through hungry, malnourished, and starving stages. Water and cold exposure
  increase illness risk.
- Preserved food is an emergency substitute for fresh food. It is not consumed
  as an unavoidable second daily meal.
- Ale, cloth, and an empty preserved-food reserve are status needs. Sustained
  status shortages cause one resident at a time to emigrate; they do not cause
  starvation.
- Supplying food again reduces hunger and heals malnutrition gradually.

The timings and probabilities live under `population` in
`balance/gameBalance.json`.

## Illness and herbs

Illness is generic for now. Its risk rises with malnutrition, unsafe water,
winter exposure, and nearby uncollected bodies. Sick residents remain housed
but are removed from the available labor pool.

An occupied herb-garden backyard produces stored remedies. A sick household
uses those remedies automatically, recovering faster and suffering a lower
mortality chance.

## Death and burial

Each death reduces the residence population by one and creates one persistent
`corpse` row at that home. A body awaiting collection adds local disease
pressure.

A completed chapel can use **Lay adjacent burial ground** in its inspector.
The player traces a convex four-corner parcel like a farm field. The server
validates area, edge length, slope, water, quarry pits, overlap, chapel range,
and direct adjacency. Capacity is derived from parcel area and remains occupied
permanently.

Each assigned chapel worker can operate one burial cart. The server reserves a
free grave and plans both halves of the journey: the empty handcart travels from
the chapel to the home, then returns with the body to the linked graveyard. The
body remains at the home, including its local disease pressure, until collection.
On arrival the corpse row is removed and the graveyard burial count increases.
Bodies, empty and loaded carts, attendants, and occupied graves are visible in
the world.

## Vacant residences

An empty residence starts sound and then decays through:

1. neglected;
2. dilapidated;
3. ruin.

The default thresholds are deliberately long: roughly one, two, and four
in-game years. A neglected home can still be resettled and is cleaned up by the
new household. Dilapidated homes and ruins block resettlement until the player
starts a restoration from the residence inspector. In the physical economy this
creates a real project: road-linked timber and stone are reserved, carts deliver
them, and an assigned builder completes the work. The vacant home then still
needs the normal survival stock before a household can return.

World reset removes corpses and graveyards. A chapel cannot be demolished while
it still owns consecrated burial ground, and a graveyard containing burials
cannot be demolished.
