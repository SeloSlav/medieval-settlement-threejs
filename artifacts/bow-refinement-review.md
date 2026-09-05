# Bow draw and quiver refinement

The reach-only bow pose described below was superseded by
[the bow arm alignment correction](bow-arm-review.md).

The holding arm extends toward the existing aim direction as the bow is drawn.
Its full-draw reach is 99.8% of that rig's measured left arm length, leaving
a small elbow bend. The palm offset is included so the hand remains on the
bow. The drawing fingers retain their cheek anchor and arrow-nock contact.
The existing male elbow mesh repair is unchanged.

The ammunition container now has a slimmer brown leather shell, inner wall,
closed floor and simple base seam. The red backing strip, red bindings and
decorative metal fittings were removed. Stored arrow points converge inside
the container rather than crossing its wall or bottom. The shared crossbow
case receives the same simpler leather container.

## Evidence

- [Full draw](weapon-qa/bow-refined-draw-side.png)
- [Quiver from behind](weapon-qa/bow-refined-draw-back.png)
- [Half draw](weapon-qa/bow-refined-half-draw.png)
- [Elbow close-up](weapon-qa/bow-refined-elbow.png)
- [Motion capture](weapon-qa/bow-refinement-cases.webm)

The capture manifest is `bow-refinement-cases.json`. It covers male, female
and raider rigs, several draw phases, carry, close and far views. Captures
use the production WebGPU crowd renderer without post-processing, at
1280x1000, DPR 1, seed 431. Camera and memory data are in the capture report.
The recorded bow, spear, sword, halberd and crossbow sequences reported no
browser errors; GPU timings were not measured.

## Checks

- 2,727 actual-rig weapon poses: contacts, wrist alignment, continuous cycle
  boundaries and new full-draw elbow extension assertions pass.
- 404 male elbow deformation poses retain connected geometry.
- Combat presentation, ammunition loading/release and projectile checks pass.
- Equipment geometry and exact sharing checks pass: 95 optimized catalog
  meshes, 38,556 source triangles, 67 default visible identity batches.
  These decrease from 98 meshes, 39,660 triangles and 70 batches.
- The 216-soldier mounted attachment test passes with zero overflow.
- TypeScript and the production build pass.

The reach correction reuses scratch vectors and runs only while drawing;
it adds no per-frame allocations, skin bones, materials or render targets.
