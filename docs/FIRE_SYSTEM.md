# Structural fires and firefighting

The implementation takes its baseline behavior from Manor Lords:

- A well enables firefighting.
- A villager travels to the nearest well, fills a bucket, and returns to the fire.
- Firefighting is an emergency, so it is not stopped by night or Sunday labor pauses.
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
| Lightning ignition | 10% settlement-wide chance per rainy game day |
| Hearth/workshop accident | 0.15% base chance per structure per game day |
| Spread radius | 26 m |
| Full-intensity adjacent spread check | 1.2% per simulation second before modifiers |
| Initial intensity | 28% |
| Fair-weather intensity growth | 1.2 percentage points per second |
| Rain damping | 0.4 percentage points per second |
| Damage | 1.3 percentage points per intensity-second |

Drought multiplies accident, spread, and intensity growth risk by `1.8`. Rain multiplies
ignition and spread risk by `0.25` and actively damps existing fire intensity.

Distance uses quadratic falloff, so close-packed buildings are much more vulnerable than
structures near the edge of the 26 m spread radius. Stored timber, firewood, and grain
increase flammability. Smokehouses, timber workplaces, granaries, breweries, and barns
carry elevated risk. Wells, marketplaces, quarries, and the Town Hall cannot ignite.

## Well response

A well can respond only when all of the following are true:

- it is complete;
- at least one laborer is assigned;
- it holds at least one 3-unit bucket load;
- the incident lies inside its work extent;
- it is the nearest eligible well, using road distance when connected and direct distance
  otherwise;
- its current delivery agent has returned.

Fire calls take priority over household water delivery and over the normal work schedule.
The responder uses a road route when possible and a direct emergency route otherwise. The
three water units are removed from the well when the carrier leaves, remain on the trip,
and affect the incident only after the visible 2.4-second unloading/spraying phase. If the
target no longer needs the water, the carrier returns it to the well.

One well sends one bucket carrier at a time. A second bucket can depart once that carrier
has returned. This keeps travel distance and well placement relevant instead of applying
suppression as an invisible radius aura.

## Extinguishing probability

Every arriving bucket first cools the fire, then makes one deterministic extinguishing
attempt:

```text
effective water = bucket water × (1 − structural damage × 0.20)
new intensity   = old intensity − effective water × 0.11
chance          = 22%
                + bucket water × 7%
                + low-intensity bonus
                − intensity penalty
                − damage penalty
```

The chance is clamped to `4%–96%`. A probability roll is only allowed once intensity is at
or below 30%; reducing intensity to almost zero guarantees success. This means a nearby
well can sometimes save a new fire with one bucket, while a distant response to an
established or badly damaged fire normally requires repeated trips. The inspector shows
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
