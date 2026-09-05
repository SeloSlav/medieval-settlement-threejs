# Crossbow elbow correction

The crossbow trigger elbow keeps its outward firing placement and stops at
0.2 radians (11.5 degrees) of flexion when reaching for the string. The left
elbow uses one downward bend plane and a shared segment frame, reaching full
extension at fire without reversing its forearm twist. Support-wrist fitting
keeps the palm on the stock through loading and aiming.

The firing correction is confined to ranged crossbow poses. The subsequent
stock trim preserves weapon scale and grip positions, and the string endpoints
now meet the metal prod tips.

The lowered crossbow now has a shared right-arm hinge frame and neutral wrist.
The stock follows the fitted palm with its existing carry orientation. This
places the grip on the correct side without corkscrewing the elbow. Changes
are specific to crossbow carry; firing, dagger fallback and other weapons
retain their previous poses.

Validation:

- `testCustomWeaponAttacks.mts`: all 1,818 male-villager/male-raider weapon
  poses pass contact, wrist, restoration, and cycle-continuity checks. New
  checks enforce the trigger bend limit, downward support elbow, straight
  support arm at fire, and continuity of every owned joint and twist bone.
- `crossbow-pose-audit.mts`: 14,544 poses compared against the isolated
  earlier implementation; unrelated bones and weapon transforms differ by
  exactly zero, including crossbow carries and melee fallback.
- Hand-grip, combat-presentation, and 404-pose elbow-mesh checks pass.
- `tsc --noEmit` passed after the carry fix. The final rerun encountered
  unrelated concurrent `ResourceInspector.ts` edits (unused tooltip helpers
  and an unresolved `hudFoodResourceTooltip` reference).
- `testCrossbowCarry.mts`: 726 actual idle/walk/run clip samples on both male
  models, including a rotated/scaled root. Wrist bend stays below 0.003 degrees;
  adjacent right-arm joint changes stay below 5 degrees. Palm side, anatomical
  elbow bend and exact joint/mount restoration pass.
- The pre-carry reference audit compares 14,544 poses with exactly zero
  numeric change to firing, melee fallback, other weapons and unrelated bones.
  `crossbow-carry-after-cases.json` includes both male models and close views
  of the corrected grip and elbow, with no browser errors.

`crossbow-after-cases.json` records fixed seed/time/camera views of firing,
raising, string reach, both elbows, the raider, and a distant stress-seed
view. The WebGPU review renderer has no post-processing. Captures use
1280×1000 at DPR 1; the report includes camera and resource inventory.
Motion evidence is `weapon-qa/crossbow-after-cases.webm`. GPU timing was not
measured. Existing polygonal cuff seams remain visible in extreme close-up.
