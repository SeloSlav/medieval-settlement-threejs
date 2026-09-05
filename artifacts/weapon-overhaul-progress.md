# Weapon overhaul — completed implementation and evidence

Completed 5 September 2026. All five attack families used by the nine military
kits now use authored weapon trajectories and anatomical hand contact solves.

- Spear/pike: retract at the waist, then extend both arms toward the target.
  Shield variants attack beside the shield. Halberds raise and chop forward.
- Swords: wind up beside the head, cut down with torso rotation, and recover
  continuously. Ranged fallback daggers use this new blade cycle.
- Bow: hold forward, draw to the right cheek, keep the arrow nock/string at the
  hooked fingers, and pass the arrow above/beside the bow grip.
- Crossbow: lower, span the cord, return to the release lever, raise and aim.
  The left palm supports the tiller throughout.
- Arm and neck twist joints follow the authored pose. Every owned joint and
  mount restores cleanly. Standards retain their left-hand grip during attacks.
- Both hands have four finger pairs and a thumb hinge. Original low-poly hand
  topology is retained and still determines the close-up knuckle detail.
- Rebuilt sword/crossbow silhouettes, fitted thinner polearm parts, blunt
  polearm butts, removed the fallback dagger's false raised fuller.

Final checks: TypeScript and diskless Vite production build pass. 2,727 actual
male/female/raider poses across nine kits pass contact (<2 mm), wrist (<30°),
adjacent-phase stability, cycle seam, forward thrust, right-cheek draw and arrow
clearance checks. Carry/neutral skin, combat events/ammo/hit ownership, geometry,
materials, weapon drops, standards/integration and authored skin batching pass.
Both added rig tests are registered in package.json. Broad CI discovery remains
blocked by other test files without package script entries;
the focused suites above were executed directly and passed.

Equipment stress: 216 mixed soldiers, 76 catalog draw-call ceiling, 794,064
exact equipment triangles, zero overflow. Mutable cords stay in shared line
streams. CPU attack overlay: 27 mixed rigs, median 1.54 ms / p95 2.06 ms after
warm-up (previous median 2.45 ms before avoiding repeated full-hierarchy updates).
These are overlay timings, not a full-game FPS benchmark.

Final visual evidence: `weapon-qa-final-cases.json`, images `weapon-qa/final-06-*`,
and `weapon-qa/weapon-qa-final-cases.webm`. The matching motion report records no
browser/renderer errors across all five moving attack families. Earlier
`review-03-*` captures cover the full phase/model matrix; `edge-04-*` covers
run/hit/fall, fallback daggers and standards. The fall preview retains attached
weapons; production detach/scatter is verified by the separate weapon-drop test.

Interactive review: `http://127.0.0.1:5175/artifacts/weapon-review.html`.
No save/schema changes, deployment or commits were required.

## Initial investigation log (superseded by the completed result above)

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

## Initial iteration

- Added `src/dev/weapon-review.ts`, `artifacts/weapon-review.html` and
  `scripts/captureWeaponQA.mts`. Review supports frozen clip/attack phase,
  model, weapon and view selections; actual production crowd/attachment batches.
- Own Vite review server on 5175, current exec session 24443. User's 5173 server
  is separate. CUA review tab 20 is open, variable `weaponReviewTab`.
- Automated capture MUST use installed Chrome (`channel: 'chrome'`). Bundled
  headless Chromium produced invalid GPU skinning; installed Chrome matches
  the in-app rendering. Captures in `artifacts/weapon-qa/`, JSON case files in
  artifacts. Run capture via approved escalated command prefix
  `node --import tsx scripts/captureWeaponQA.mts` to save files.
- Native PowerShell `ReadAllText`/`WriteAllText` edits existing source files
  successfully; apply_patch also works. Apply_patch sometimes partially applies
  and then reports a retry error: inspect before retrying.
- Baseline screenshots prove spears attack backwards, hands open, crossbow
  upside down. Prior pass is not sufficient for any attack state.
- Sword carry now near-straight arm; introduced a 45-degree diagonal hilt grip
  instead of forcing polearm hand orientation. Arm looks better in
  `carry-01-sword-side.png`. Full attack rewrite is still untouched.
- Polearm butts changed to flat ferrules; arrows now nock-up in quivers.
- New `militaryWeaponGeometry.ts` builds a slender crossbow and thin fuller
  sword blade / smaller realistic hilt. Connected model grip metadata and
  crossbow frame. Removed old crossbow and sword assembly functions (delegates
  call new builders). Steel/wood/leather normal and color variation reduced.
- Crossbow carry now uses +Y downrange, +Z top correctly (previously upside
  down). Ammo size updated, but animation/string lifecycle still old and wrong.
- Crossbow reference: https://www.metmuseum.org/art/collection/search/23336
  (slender tiller, long release lever, ~95.6 cm length /75.5 cm span).
- Latest QA `mesh-01-*` and `grip-02-*` show better silhouettes, BUT thumb
  penetration and finger wrap still wrong. Crossbow support hand floats below
  stock. Standalone weapon view is cut by ground at y=0; lift standalone group
  before accepting mesh QA. UI selectors don't yet reflect API changes.
- Added a thumb hinge, right hand now 3 extra bones. Current idea: replace the
  shared two-finger hinges with four separate finger pairs plus thumb, so pinky
  doesn't dangle and diagonal sword grip can close accurately. Unarmed pose
  preservation must be re-tested after this change.
- Typecheck passed after current geometry/carry changes. Other existing tests
  have stale grip constants / assumed 2 hinges and haven't been updated yet.

Initial status was in progress; the implementation and final evidence above
supersede this investigation log.
