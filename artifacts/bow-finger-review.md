# Bow finger contact repair

The bow has a narrower oval leather handle, a matching waist in the wooden
stave, and bindings at the ends of the grip. The old bands crossed the fingers.
Dedicated poses fit the male villager's bare hand and raider glove: each has its own
palm offset, finger curls and thumb position, selected by measured hand size.

The bow follows the palm orientation during the draw and while carrying.
This preserves the fitted relationship when the arm tilts and avoids twisting
the glove webbing into the handle. The straight full-draw arm is preserved.

## Evidence

- [Front of the grip](weapon-qa/bow-fingers-man-front.png)
- [Inside of the hand](weapon-qa/bow-fingers-man-inside.png)
- [Back of the grip](weapon-qa/bow-fingers-man-back.png)
- [Carrying](weapon-qa/bow-fingers-man-carry.png)
- [Raider glove](weapon-qa/bow-fingers-raider-front.png)
- [Motion recording](weapon-qa/bow-finger-cases.webm)

The `bow-finger-cases.json` manifest records fixed close views on the two
production combatant rigs, including loading and carrying. Women have civilian
roles only; the earlier female combat captures are superseded and excluded
from the preview and regression manifests. The broader
`bow-refinement-cases.json` images were also refreshed. Captures use the
production WebGPU renderer without post-processing, 1280x1000, DPR 1 and
seed 431. Camera and render-memory data are in the capture reports. The
recorded weapon sequences reported no browser errors; GPU timings were
not measured.

## Validation

- `test:bow-hand-grip` checks 13,728 deformed finger/thumb vertices and face
  centers against the actual rendered leather mesh over attack phases and
  idle, walk, run and flee carry poses. No sampled penetration was measured;
  the assertion tolerance is 0.5 mm. Each finger must remain near the handle.
- All 1,818 custom attack poses pass, retaining arm extension, wrist
  alignment, string contact, cheek anchoring and cycle continuity.
- Military hand skinning, combat presentation, equipment geometry and exact
  sharing checks pass. The catalog retains 63 default visible identity batches.
- TypeScript and the production build pass.
- `test:combat-role-presentation` checks that the live preview admits only male
  combatants, while female civilians retain their 41-bone skeleton, work tools,
  movement and social actions without attack clips, weapons or combat rigs.

The fitted poses reuse the existing finger bones and shared equipment
materials. There is no runtime fitting search, added skin geometry or
per-frame allocation in the grip pose.
