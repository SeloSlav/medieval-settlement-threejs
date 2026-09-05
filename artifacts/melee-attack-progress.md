# Melee attack review — 5 September 2026

Implementation, visual review and the final combined regression sweep passed.
The source-hashed verification result is `weapon-qa/melee-stress.json`.

The attack work covers both male combat rigs, all nine infantry equipment sets,
and the issued weapons of Hussars, Armored Lancers, Mounted Archers, Akıncı and
Sipahi. Bow and crossbow firing, approved carrying/idle/walk/run poses, and female
civilian animation paths retain their existing implementation.

- Sword, sidearm and fallback dagger attacks have distinct chambering,
  acceleration, contact, deceleration and recovery, with torso rotation and
  hip loading. Stationary infantry has a staggered stance with planted ankles.
- Spear/pike thrusts hold the shaft outside the ribs; halberd cuts keep the butt
  clear of the torso. Both hands solve to authored contacts without independent
  forearm roll flips. Mounted cuts/lances use separate clearance-aware paths.
- Melee finger/thumb fits use the actual bare hand and raider glove meshes.
  Different handle diameters, including the larger shielded spear, have their
  own profiles. Raised-shield fingers grip the rear handle; carrying retains
  its existing fits. The free hand has a neutral wrist and a relaxed guard.
- Shield defense faces the threat, with a lowered weapon and relaxed sword
  elbow. It is an explicit `combatDefending` renderer input, available as
  `defend` in the preview, and never emits an attack contact event.
- Every body/arm overlay restores its owned transforms before the next mixer
  update. Moving melee preserves locomotion legs; mounted attacks preserve
  riding legs. No database or save compatibility work was introduced.

Verification completed:

- Full live Chrome/WebGPU sweep: 126 equipment, model, height and facing
  scenarios, including three standard-bearer combinations. Attack joints are
  sampled at 201 phases; weapon rays check bodies, shields and actual horses.
  The final matrix has 0.096 mm maximum palm/contact error, 0.0005 mm
  maximum ankle drift and no sampled body/shield/horse crossings. Actual weapon
  vertices also stay above the ground across every tested attack and defense.
- Revised defense: all 33 height/facing scenarios passed, with minimum actual
  weapon vertex height 94 mm above world zero (preview ground is -20 mm).
- 1,782 overlay transitions restore every bone and hip translation exactly.
  Moving/riding lower-body poses and defensive event suppression pass.
- Surface grip tests cover both hands, all melee handles, shielded weapons,
  raised shields and defensive weapon grips. Vertex and triangle-center
  samples stay within 2 mm contact/penetration tolerance on the nominal rigs.
- Five mounted-unit presets pass equipment selection, authored/retargeted
  riding pose, attack playback, scrubbing, fall and return-to-infantry checks.
- Custom weapon attacks, military carrying/neutral skin, bow grip, shield arm,
  shield grip, combat events/projectiles, locomotion and standard tests pass.
  TypeScript and production build pass (existing chunk-size warning).
- These are sampled clearance and surface checks combined with visual
  inspection, not a claim of continuous all-triangle collision proof.

Review evidence:

- Live preview: http://127.0.0.1:5175/artifacts/weapon-review.html
- `melee-final-cases.json`: 28 attack combinations in six phases, plus shield
  defense views. Its attack contact sheets are `weapon-qa/melee-final-cases-sheet-1.png`
  through `-28.png`; `melee-final-cases.webm` records every attack in motion.
  This video predates the final lowered-elbow defense and shielded-spear finger
  refinements; use the following defense/grip captures for those details.
- `melee-inspect-cases.json`: side/rear chamber, contact and follow-through
  views for all 28 attack combinations; sheets 1–28 in `weapon-qa`.
- `melee-defense-cases.json`: final front/side/rear/close/far views and motion
  for all 11 shielded combinations, with `weapon-qa/melee-defense-cases.webm`.
- `melee-grip-cases.json`: near hand and shield diagnostics.
- `weapon-qa/melee-stress.json`: detailed regression metrics and SHA-256
  hashes of reviewed animation sources and both male GLBs.
- Reproduce with `npm run test:melee-hand-grip`,
  `npm run test:melee-pose-lifecycle`, and
  `node --experimental-strip-types scripts/testMeleeAttackBrowser.mts --stress`
  while Vite serves the preview. Browser scripts accept `WEAPON_REVIEW_URL`.
  The regression isolates Vite hot reload to keep concurrent workspace edits
  from interrupting an already-loaded review.

Shared-workspace provenance: another user-owned task applied the corrected
male elbow GLB and palm-origin compensation, and committed some early melee
work in 54dd9b8e. Those changes were preserved. Water/environment edits and
other concurrent work were left intact. This task did not create a commit.
