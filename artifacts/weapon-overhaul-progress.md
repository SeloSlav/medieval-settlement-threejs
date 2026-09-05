# Weapon overhaul acceptance and evidence

Goal: rebuild the full military weapon presentation, including all nine kits,
fallback daggers, shields and standards interacting with grips. Check idle,
walking, running/fleeing, hit reactions, full melee/ranged attack cycles,
stance switches, death/drop and pooled reuse. Improve realistic silhouettes,
remove erroneous meshes and all pointed spear butt caps. Keep shared rendering
and ordinary villager animation intact.

## Initial evidence (5 September 2026)

- User's sword screenshot shows a kinked elbow/forearm; previous carry tests
  permitted wrist bends up to 48 degrees and did not prove anatomical roll.
- Carry and attack use different solvers; attacks reset wrists to reference
  after IK and do not apply the new closed finger grip.
- Right hand has two added curl hinges; thumb is untouched and grip placement
  is a fixed guessed point, so contact needs measurement and close QA.
- Crossbow has a bulky stock, tube-shaped prod, floating trigger/guard elements
  and ambiguous top/bottom orientation; it needs a complete assembly pass.
- Spear, pike and halberd have conical, pointed butt caps.
- Existing review page only plays walk/run; it cannot verify attack phases.

## Required completion evidence

- Repeated frozen-phase and moving QA for each kit and animation family.
- Front, outside, side and back hand views on male, female and raider models.
- Neutral wrist/forearm alignment, anatomical elbow plane, attached handle,
  fingers wrapping the handle without visible penetration or open-hand hover.
- Connected realistic weapon assemblies, blunt polearm butts, crossbow string,
  nut, tiller, prod, stirrup and bolt aligned through loading and firing.
- No regressions for unarmed people, standard bearers, hits/deaths, dropped
  weapons, ranged/melee fallback, pooled reuse and performance.
- Source tests and typecheck/build plus recorded visual evidence; green tests
  alone are not completion.

Status: in progress. No requirement is accepted from the previous turn alone.
