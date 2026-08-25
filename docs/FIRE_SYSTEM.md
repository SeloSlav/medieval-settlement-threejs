# Structural fires and firefighting

The implementation takes its baseline behavior from Manor Lords:

- A well enables firefighting.
- A villager travels to the nearest well, fills a bucket, and returns to the fire.
- Firefighting is an emergency, so it is not stopped by observed Sabbath or holy-day labor pauses.
- Thunderstorms can start rare structure fires.
- The Town Hall is treated as the local Manor analogue and is nonflammable.

The additional spread, damage, drought, work-extent, and probability rules below are
game-specific simulation design. They make well placement and staffing strategically
important while keeping outcomes server-authoritative and inspectable.

## Authoritative lifecycle

Each `fire_incident` targets either a workplace building or a residence and moves through:

1. `burning`: intensity and structural damage grow; the target stops operating.
2. `extinguished`: flames stop and cooling steam remains for 12 simulation seconds.
3. `destroyed`: labor and stored goods are lost; a persistent charred ruin remains until
   the player demolishes it.

An extinguished structure survives with its accumulated damage. Damage does not currently
repair itself, but only a future fire can increase it further.
Burning or destroyed structures provide no demolition salvage, preventing fire loss from
being bypassed by demolishing the target before the damage meter completes.

## Ignition and spread

All random checks are deterministic hashes of the world seed, simulation tick, incident,
and target. Reloading or reconnecting cannot reroll an outcome.

| Mechanic | Normal-speed balance |
| --- | ---: |
| Lightning ignition | 1% settlement-wide chance per rainy game day |
| Hearth/workshop accident | 0.05% base chance per structure per game day |
| Spread radius | 26 m |
| Full-intensity adjacent spread check | 0.8% per simulation second before modifiers |
| Initial intensity | 24% |
| Fair-weather intensity growth | 0.8 percentage points per second |
| Rain damping | 0.6 percentage points per second |
| Damage | 1 percentage point per intensity-second |

Drought multiplies accident, spread, and intensity growth risk by `1.8`. Rain multiplies
accident and spread risk by `0.25` and actively damps existing fire intensity.

Distance uses quadratic falloff, so close-packed buildings are much more vulnerable than
structures near the edge of the 26 m spread radius. Stored timber, firewood, and grain
increase flammability by up to 75%. Base risk is generated from the same balance table for
the Rust authority and client planning UI:

| Structure group | Base susceptibility |
| --- | ---: |
| Charcoal yards and smokehouses | 2.20x |
| Smithies and pottery kilns | 1.80x |
| Timber workplaces | 1.70x |
| Threshing barns | 1.65x |
| Granaries and breweries | 1.45x |
| Ordinary structures | 1.00x |
| Chapels and monasteries | 0.32x |
| Clay pits | 0.15x |
| Wells, marketplaces, quarries, founding camps, and Town Halls | Fire-safe |

High-risk placement and inspector readouts name the current susceptibility, stored-fuel
penalty, exposed-neighbor count, response route, and estimated first-bucket arrival.
The authoritative 26 m spread range and well-response extents are not drawn as world-space
circles. These are derived views; they add no save fields or periodic settlement scan.

## Well response

A well can respond only when all of the following are true:

- it is complete;
- it holds at least the 0.5-unit minimum response load (up to 3 units depart);
- the incident lies inside its work extent;
- it is the nearest eligible well, using road distance when connected and direct distance
  otherwise;
- at least one unassigned villager remains available for each bucket trip.

Fire calls take priority over automatic household and industrial well service and the
normal work schedule. A covered well reserves newly drawn water while a fire remains active,
so household demand cannot repeatedly consume a dry well's sub-bucket refill before it can
respond.
The responder uses a road route when possible and a direct emergency route otherwise. The
three water units are removed from the well when the carrier leaves, remain on the trip,
and affect the incident only after the visible 2.4-second unloading/spraying phase. If the
target no longer needs the water, the carrier returns it to the well.

A well may send as many bucket carriers concurrently as there are free villagers, stored
water, and useful water remaining in the incident's response wave. The initial wave fills
the incident's estimated water requirement. If that whole wave fails, one follow-up bucket
is requested at a time until the fire is out. Every carrier still travels physically, so
distance and well placement remain relevant without imposing an artificial one-hauler lock.

## Extinguishing probability

Every arriving bucket first cools the fire, then makes one deterministic extinguishing
attempt:

```text
effective water = bucket water × (1 − structural damage × 0.20)
new intensity   = old intensity − effective water × 0.14
chance          = 30%
                + bucket water × 8%
                + low-intensity bonus
                − intensity penalty
                − damage penalty
```

The chance is clamped to `4%–96%`. A probability roll is only allowed once intensity is at
or below 32%; reducing intensity to almost zero guarantees success. This means a nearby
well will often save a new fire with one bucket, while an established or badly damaged fire
still needs a coordinated response wave. The inspector shows
the exact last-attempt chance, accumulated water, current intensity, damage, cause, and
response state.

## Presentation

- Burning incidents render layered flickering flame cones, animated smoke, and firelight.
- A responder carries two visible water buckets on a small hand carrier.
- During unloading, a visible water stream and droplets connect the responder to the fire.
- Extinguished incidents replace dark smoke with pale cooling steam.
- Destroyed incidents render low smoke and charred rubble.
- The settlement HUD shows the number of active fires and bucket carriers in transit.
- Fire starts, successful extinguishing, and structure loss generate notifications.

All time values are simulation time, so Pause freezes incidents and 4×/8× speed advances
fire, agents, water use, and production consistently.
