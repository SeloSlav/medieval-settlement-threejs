# Melee attack review — 5 September 2026

## Follow-up: connected sword assemblies

Closed the physical gaps between the sidearm/longsword blades, guard collars
and leather grips. The blade base and grip now seat 2 mm inside a shared guard
dimension contract. The sidearm's peened pommel fittings now seat into its
actual flattened face instead of floating above it. The existing grip location,
handle dimensions, overall weapon length and attack poses are preserved.

Checked both male rigs with sidearm, sidearm-shield and sword-shield in 12
close-up renders (`sword-assembly-cases.json`; images and sheets in `weapon-qa`).
Measured blade/guard and guard/grip overlap at 2 mm for both models; the existing
grip/pommel overlap is 4 mm for the sidearm and 8 mm for the longsword. Existing
finger-contact checks, equipment geometry sharing and the production build pass.

## Follow-up: raised sword elbow and shield movement

The sidearm, sidearm-shield and sword-shield attack arms now rotate their
upper arm and forearm with the palm as the weapon rises. Previously the arm
kept its low-guard bend plane while the hand rotated, leaving roughly 40
degrees of wrist roll before the downstroke. The raised pose now has almost
zero wrist roll, preserves the anatomical elbow hinge, and retains a straight
arm through the downward cut. This applies to both male rigs, foot and mounted.

During sidearm-shield and sword-shield cuts, the shield hand eases about 10 cm
down and 11 cm toward the soldier's left, then returns during recovery. The
shield stays forward-facing, the wrist stays neutral, and the fingers stay
seated on its handle. Defensive and carrying poses retain their existing targets.

Verification: 63 targeted live browser scenarios passed for sidearms and
sword-shield, including mounted units, both male rigs, three sizes/facings,
defense and standard bearers. Sampled weapon/body/shield/horse intersections,
ground clearance, palm contact and leg stability passed. The 13,266-pose
anatomical test now guards raised palm/arm alignment and shield displacement;
2,562 shield poses and 1,782 exact overlay restorations passed. Affected
finger-surface checks remain within 2 mm; targeted custom attacks and the
TypeScript/production build passed.

Rendered evidence: `sword-elbow-shield-cases.json` and
`sword-elbow-motion-cases.json` produce 34 fixed-view captures plus six four-second
playback sequences, including hussars and akinci. Captures, contact sheets,
the video and motion reports are in `weapon-qa`. The current source-hashed
collision reports are `melee-stress-sidearm.json` and
`melee-stress-sword-shield.json`. Concurrent ranged changes were preserved.

## Follow-up: defensive swords, overhead halberd, straight sword cuts

The latest corrections cover three requests. Sidearm-shield and sword-shield
defense now use a relaxed anatomical right arm with an inward-facing palm;
the blade follows that hand and remains outside the thigh/rider. The halberd
has a rebuilt overhead chop: a quarter turn around its haft presents the axe
edge in the vertical strike plane. Its attack grips are near the butt, with
both elbows solved outward from their own shoulders. Those grip locations
apply only to attacks; carrying retains its original handles and poses.

Following the subsequent request, sidearm, sidearm-shield and sword-shield
cuts now extend the weapon arm before the downstroke and keep it straight
through contact and follow-through, on foot and mounted. The wrist stays
within 15 degrees of the forearm. Finger fits were updated for the changed
grips/arm postures and checked across attack and defense.

Verification: 13,266 anatomical pose checks; 69 targeted live browser scenarios
covering the new sword/sidearm/halberd attacks, defenses, mounted equipment,
standard bearers, both male rigs, sizes and facings; a separate 33-scenario
defense sweep; 1,782 exact overlay restores; all melee-only custom attack
checks; affected finger-surface checks; retained spear/pike posture checks;
TypeScript/production build. Blade/haft rays clear sampled bodies, shields
and horses, weapon vertices clear the ground, and planted feet/riding legs
remain stable. These are sampled checks plus rendered review, not continuous
all-triangle collision proof.

`npm run test:melee-arm-posture` explicitly asserts straight sword elbows on
the downstroke, natural defensive palms/elbows, an overhead halberd start,
downward edge-led travel, and a support elbow on its own side of the chest.
Current captures: `halberd-final-cases.json`, `sword-extension-cases.json`,
and `defensive-arm-cases.json`, with contact sheets and attack videos in
`weapon-qa`. The attack review camera includes overhead blades. Source-hashed
browser reports are `melee-stress-halberd.json`, `melee-stress-sidearm.json`,
`melee-stress-sword-shield.json`, and `melee-stress-shield-defense.json`.
Concurrent ranged edits and unrelated workspace changes were preserved.

## Follow-up: spear support arm

The user rejected the earlier spear pose despite its passing contact tests:
the left elbow crossed the chest and the hand appeared inverted. The infantry
spear/pike now has a dedicated support solve with a lowered, nearly straight
arm and a soft elbow. The shaft slides through the forward guiding hand while
the right arm and weapon trajectory remain unchanged. The villager's little
finger curl was adjusted to close its remaining contact gap.

Current checks: 2,412 support poses across both male rigs, three heights and
facings; 33 spear and six pike browser scenarios with sampled body/shield/horse
clearance; 1,782 exact overlay restores; all melee-only custom attacks; both
support-hand surface fits; TypeScript/production build. Support wrists remain
within 10 degrees of their forearms, palms within 0.054 mm of the shaft, and
the regression explicitly rejects raised/cross-chest or inverted elbows.
The full custom-attack suite currently stops at the crossbow full-extension
assertion; concurrent ranged skin-frame edits appeared in the shared source
during this follow-up. Those ranged edits were not reverted or changed here.

Review `spear-support-cases.json` and its images/video in `weapon-qa`, plus
`weapon-qa/melee-stress-spear.json` and `weapon-qa/melee-stress-pike.json`.
Run `npm run test:spear-support-arm` for the new posture regression.

## Earlier broad review

The earlier combined sweep is recorded in `weapon-qa/melee-stress.json`;
its spear screenshots predate the support-arm correction above.

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
