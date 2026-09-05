# Left elbow alignment review

Status: applied to the live male villager GLB after explicit user approval releasing the earlier bow/crossbow lock.

Open http://127.0.0.1:5175/artifacts/weapon-review.html?weapon=crossbow&mode=walk&view=left-front&play=1 through the development server. The earlier candidate-review link now forwards to this live preview.

The source left elbow pivot was approximately 7.5 cm farther forward than the mirrored right elbow at character scale. Its forearm segment was approximately 11% longer. The candidate mirrors the intact right elbow and wrist positions, retargets the affected left-arm animation channels, and preserves the mesh-space palm and finger references for weapon grips. The existing elbow closure remains to avoid opening holes; correcting the pivot reduces its stretched span by more than half. Seven brown sleeve triangles now sample the existing linen texture.

Validation:

- Source-alignment invariants pass: 1,635 unrelated animation tracks, animation timing, original mesh attributes, embedded textures, and palm/finger references are preserved.
- Longest closure edge in shield, bow and crossbow carries decreases from 104.1/105.9/92.6 mm to 43.1/39.6/38.3 mm.
- Focused bow/crossbow attack, crossbow carry, military hand grip, and bow hand grip checks pass for male villagers and male raiders.
- The full attack suite passed all nine worker weapon cases. The raider pike support-reach assertion also fails with the original model; the candidate does not alter the raider asset.
- The shield suite's raised-pose palm-direction assertion fails with both original and candidate models after concurrent melee changes. This is separate from the carry alignment correction.
- The separate browser preview is checked for moving frames and runtime errors in shield, bow and crossbow walking and attacks. See `weapon-qa/alignment-review-motion.json` and the corresponding screenshots.

The live replacement was initially blocked by automatic approval review. The user explicitly released the bow/crossbow lock and authorized completion while the separate soldier-attack task continues its melee work. Installation then succeeded after verifying both the reviewed candidate hash and the unchanged source-model hash.
