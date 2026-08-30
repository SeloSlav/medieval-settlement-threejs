# Military Progression — Implemented Contract

## Status

Implemented in the authoritative SpacetimeDB simulation on 2026-08-30. This
document replaces the earlier proposal and records the live gameplay contract.
Mounted troops, siege engines, firearms, dedicated armorer buildings, and
equipment repair remain intentionally outside this pass.

## Core rules

1. Every local soldier is a specific healthy adult male resident. Recruitment
   reserves that household slot and subtracts the man from free settlement
   labor until he returns or dies. Mercenaries are the only outsiders.
   A resident-backed company therefore requires its full roster as currently
   unreserved labor in addition to every listed material cost.
2. Local recruitment is atomic: the company forms only when every required man
   and every complete equipment/provision lot selected by the world setting is available. Goods are withdrawn
   from completed Guardhouses, Storehouses, Granaries, other physical holdings,
   and only then legacy treasury stock. Timber and ironwork use their existing
   aggregate physical-store spending paths.
3. Issued equipment remains carried by each combat agent. A local survivor
   returns it to the recruiting building during disbandment; battlefield deaths
   leave a physical reclamation pile for ordinary haulers. A surviving
   mercenary carries his personal kit while physically marching back to his
   original map edge, while dropped mercenary equipment is recoverable when he
   dies.
4. Companies use the shared drag-select and right-click RTS command language.
   A company—not an individual soldier—is the smallest selectable unit. Clicking
   one member or drawing across any part of its formation selects the complete
   company, draws one circle around its footprint, and expands every order to
   all living members. They auto-acquire nearby bandits and Ottoman raiders,
   while explicit orders move them, hold them, or attack a bandit camp.
5. Morale, cohesion, fatigue, configured pay and field provisions, formation, individual
   health/armor/damage quality, and finite missile ammunition affect real
   combat. A broken company retreats.
6. Militia and mercenary spear companies are Town Hall forces in every game
   mode. They never depend on Ottoman conflict, raid pressure, an enabled
   Guardhouse, or another military building. This preserves a complete answer
   to physical bandits in peaceful settlements where bandit camps are enabled.

## Military demands world setting

The setting applies only to local, non-militia companies. Every ration issue
lasts three calendar days; the listed amounts are not charged again each day.

| Setting | Recruitment and resupply issue | Daily local wages |
| --- | --- | --- |
| Muster only (Easy) | Equipment and available resident labor only | Disabled |
| Light rations (Normal) | 1 preserved food per living soldier | Disabled |
| Full upkeep | 2 preserved food per living soldier + 1 ale per 4 living soldiers | Enabled |
| Campaign burden (Hardcore) | 2 preserved food + 1 ale per living soldier | Enabled |

Militia always require only one polearm per selected resident and never draw
provisions or wages. Mercenaries always use their independent 96-gold hiring
contract and one gold per surviving man per day; they never draw local field
provisions. Bow and crossbow ammunition remains a physical requirement in every
setting. Full upkeep and Campaign burden also retain each company's displayed
Treasury signing cost at recruitment.

## Progression and balance

### Town militia

- Source: completed Town Hall.
- Roster: player-selected from one to twelve currently unreserved resident men;
  the Town Hall picker defaults to five and previews one polearm per man.
- Cost: one polearm per man; no armor, pay, or carried field provisions.
- Formation: line, column, shield wall, or loose order.
- Behavior: every selected man walks from his actual home to the Town Hall to
  receive his spear. The company becomes active only after all survivors arrive.
- Role: cheap emergency numbers against bandits. At 52 health and 8 base damage,
  militia are intentionally poor against disciplined Ottoman forces.

### Spear company

- Source: completed Guardhouse.
- Roster: eight resident men, formed immediately at the Guardhouse.
- Equipment cost: 8 polearms, 8 shields, and 8 padded armor. The selected
  Military demands setting adds any initial three-day ration issue and pay.
- Paid-tier daily pay: one gold per four survivors.
- Role: the replacement for the old free abstract Guardhouse guard. It is the
  ordinary standing settlement formation and has a useful shield wall.

### Men-at-Arms company

- Source: completed Guardhouse.
- Roster: eight resident men, formed immediately.
- Equipment cost: 8 sidearms, 8 shields, and 8 mail armor. The selected setting
  adds any initial ration issue and pay.
- Paid-tier daily pay: one gold per two survivors.
- Role: armored sword-and-large-shield professionals with 96 base health, high
  morale/cohesion, and the strongest shield-wall mitigation. They hold against
  arrows and light footmen but are slow and intentionally lose to armor-piercing
  crossbows and polearms. They share neither spear reach nor spear bracing.

### Crossbow company

- Source: completed Guardhouse.
- Roster: six resident men, formed immediately in loose order.
- Equipment cost: 6 crossbows, 6 padded armor, and 6 ammunition bundles. The
  selected setting adds any initial ration issue and pay.
- Ammunition: 18 bolts per man (108 per full company). Resupply spends physical
  ammunition bundles and, where enabled, restores three provision days. Without bolts they deal
  only weak melee damage and try to maintain distance while ammunition remains.
- Paid-tier daily pay: one gold per two survivors.
- Role: strong prepared ranged damage, low health, no shield-wall formation,
  and a deliberately vulnerable melee fallback.

### Footman company

- Source: completed Guardhouse; eight resident men.
- Kit: sidearms, small shields, and padded armor; configured provisions and pay
  are added by the world setting.
- Role: aggressive sustained melee that breaches ordinary spear lines and runs
  down exposed missile troops. Armor-piercing polearms counter them.

### Polearm company

- Source: completed Guardhouse; eight resident men.
- Kit: halberd/billhook-style long weapons and moderate armor, without shields.
- Role: high armor penetration, charge impact, and useful bracing. It punishes
  armored footmen and heavy spears but is exposed to missile fire.

### Bow company

- Source: completed Guardhouse; eight resident men in loose order.
- Ammunition: twenty-four arrows per man. Bows fire faster and cost less than
  crossbows, but pressure light targets rather than heavy armor.
- Role: anti-light missile support; footmen and Uskoks can run them down.

### Uskok border infantry

- Source: completed Guardhouse; eight resident men.
- Historical identity: Croatian frontier infantry inspired by the Senj/Klis
  Uskok tradition, not a fantasy unit and not restricted to Gorski Kotar. Their
  kit represents sidearms, axes/war-hammer techniques, some long weapons,
  and light protection. Configured provisions and professional pay are added by
  the world setting.
- Role: fastest local company, with strong armor penetration and pursuit of
  bow/crossbow ranks. Braced spears are their deliberate counter.

### Mercenary spear company

- Source: completed Town Hall.
- Roster: eight hired outsiders entering at the safest map edge with their own
  equipment. Edge candidates are scored against the completed town footprint
  and every active bandit camp.
- Cost: 96 Treasury gold. No resident labor or local equipment is consumed.
- Daily pay: one gold per surviving mercenary.
- Role: an immediate emergency spear formation. Ending the contract returns no
  kit to town, while battlefield casualties leave recoverable equipment.
- Duration: dismissal, unpaid wages, seven calendar days without a combat or
  camp-attack engagement, or the end of the twenty-one-day term puts the
  company into a leaving state once it is no longer actively engaged. Survivors
  stop taking orders and march from their current positions to their original
  arrival edge; pay and contract time stop while they are leaving. The company
  is removed only when its final survivor crosses the edge.
- Recall: until that final exit, the Town Hall roster remains selectable and
  offers a two-day retainer at two Treasury gold per surviving mercenary. Paying
  it restores control in place and begins a fresh twenty-one-day contract.
- Report: a Lord's report and toast announce the newly observed company. Initial
  save hydration does not create a false arrival report for existing companies.

## Counter web

- Spears: defensive reach and bracing stop charging footmen/Uskoks, though
  footmen win a prolonged unbraced close fight.
- Men-at-Arms: heavy sword-and-shield line holders that resist arrows and light
  infantry; polearms and crossbows break their armor.
- Footmen: breach ordinary spears and chase missiles; lose to polearms.
- Polearms: defeat heavy armor; no shield makes bow and crossbow fire their main threat.
- Bowmen: rapid anti-light fire; poor penetration and weak melee.
- Crossbows: slower armor-piercing volleys that punish dense spear, polearm, and armored
  foot formations; weak after an enemy closes.
- Uskoks: mobile flank/pursuit specialists; braced spears stop them.
- Militia: emergency mass, not a favorable specialist counter.

## Formation effects

- Line: balanced default frontage.
- Column: compact depth for coherent movement.
- Shield wall: reduced incoming close-combat damage for militia, spears,
  Men-at-Arms, mercenaries, and footmen; Men-at-Arms receive the greatest
  benefit. Crossbows cannot use it.
- Loose order: wider spacing and the crossbow default.

Formation offsets are authoritative, so a single company order preserves the
chosen shape instead of stacking every soldier on one destination point.
Movement combines the assigned goal with short-range separation and low-weight
company cohesion. Enemy choice is per soldier: distance carries a saturation
penalty so roughly two men engage one target before the rank spreads to the
next-nearest opponent. The player still orders only the atomic company.

## Upkeep, combat, and casualties

Full-upkeep and campaign-burden local companies draw Treasury pay once per
calendar day. Local non-militia companies consume one provision day only when
their setting enables rations. Missed configured pay and empty configured
provisions reduce morale and cohesion. Mercenaries always draw their independent
daily contract pay but do not consume local provisions. Movement and fighting
create fatigue, while safe holding slowly restores cohesion and morale. Health,
cohesion, fatigue, and enabled provisions all feed effective damage and readiness.

Local companies auto-attack both physical bandits and Ottoman raiders. Bow and
crossbow agents attack at range, consume individual/company ammunition, and
kite at close range. Every resident has a deterministic profile derived from
stable identity: maximum health, damage quality, armor, shield protection,
armor penetration, charge, bracing, and movement variation are individual.
Mixed Ottoman ranks expose light infantry, spears, armored infantry, and
missile profiles so the counter choice matters. The existing Ottoman raid
bookkeeping receives kills made by these persistent companies, preserving raid
casualty, rout, loot, arson, and report behavior.

When a resident soldier dies, his exact household loses one resident and gains
a violent-death record and corpse using the villager fall animation/death-audio
pipeline. Company morale and cohesion fall. His carried kit becomes a physical
reclamation site. The corpse remains for the burial system; the combat row is
removed after its downed presentation interval.

## Disbanding and return home

Disbandment is physical rather than a roster deletion:

1. the company stops accepting orders;
2. every living local soldier walks to the recruiting Town Hall or Guardhouse;
3. carried equipment becomes a recoverable stock pile at that return point;
4. the soldier walks to his original residence;
5. if that home is abandoned, destroyed, or full, the simulation transfers him
   to the nearest available active home before completing the return;
6. if no home exists, the military reservation is released into the unhoused
   population abstraction rather than leaving an immortal unit.

Mercenaries follow the same command and battlefield rules while contracted.
Dismissal, nonpayment, inactivity, or contract expiry changes them to an
uncontrollable leaving company whose survivors physically walk to their
original arrival edge. The player receives an urgent Lord's report linked to
the source Town Hall and may pay the displayed two-day retainer before the last
survivor exits. A successful recall restores the company at its current
position with a fresh contract; otherwise each survivor and his carried kit
leave the region at the edge, and the company disappears after the last exit.

## Player interface and presentation

The Town Hall inspector contains militia and mercenary recruitment plus attached
company rosters. The Guardhouse contains spear, Men-at-Arms, footman,
polearm, bow, crossbow, and Uskok
recruitment. Every roster shows state, survivors, formation, morale, cohesion,
fatigue, enabled provisions, and ammunition where relevant, with controls for formation,
resupply, and individual disbandment.

All military actions use a dedicated woodcut icon suite consistent with the
game’s existing inspector art. Resident soldiers keep their exact villager name,
appearance, household identity, and male model. Enlisted identities are hidden
from the civilian renderer until they return. Spear troops carry the existing
spear model; crossbow, bow, footman, polearm, and Men-at-Arms troops carry
lightweight procedural weapons and shields. Long orders use the authored run clip; short approaches
and formation correction use walk.

A leaving mercenary company remains world-selectable with an orange formation
circle, but right-click movement and attack orders are rejected by both client
and server. Selecting it opens its source Town Hall roster directly at the
retainer action; the matching urgent Lord's report links to the same roster.

Presentation keeps a hard budget of 72 authored animated rigs. Further visible
agents, up to the 1,024-person crowd ceiling, use three shared instanced body
layers. This bounds mixers, skinned submissions, allocations, and draw calls
while keeping every soldier visible at strategy-camera distance. The
individual bodies are presentation and casualty records inside a single RTS
company: the player sees one company-sized selection circle and cannot peel one
soldier away with an individual order.

## Explicit future boundary

No cavalry, siege weapons, crossbow production
building, equipment-repair queue, or additional military building is introduced.
Those systems should arrive only with the corresponding horse, fodder, tack,
ore, smithing, woodworking, training-time, repair, and transport economies.
