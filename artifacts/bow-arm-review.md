# Bow arm alignment correction

The previous reach-only adjustment left the wrist rotating roughly 90 degrees
relative to the forearm and allowed the elbow to bend toward the torso.
The bow now uses a dedicated arm pose with a consistent shoulder, forearm and
hand orientation. Its elbow flexes downward during lowering, and the upper
arm and forearm become collinear at full draw. The hinge angle approaches
zero directly, without an IK reach clamp or singularity-driven elbow flip.

Full aim extends forward from the leading shoulder rather than across the
chest. The stance turns farther side-on and the drawing hand anchors farther
back at the right cheek. The torso turn, bow extension and string draw share
their timing so the drawing arm remains stable while loading and recovering.
The existing elbow mesh repair is preserved.

## Evidence

- [Full draw](weapon-qa/bow-refined-draw-side.png)
- [Full-draw elbow](weapon-qa/bow-refined-elbow.png)
- [Lowered bow](weapon-qa/bow-refined-nock-side.png)
- [Half draw](weapon-qa/bow-refined-half-draw.png)
- [Full cycle recording](weapon-qa/bow-refinement-cases.webm)

The manifest `bow-refinement-cases.json` includes three humanoid rigs, front,
side, back, grip and elbow views, loading, recovery, mid-draw and full draw.
The production WebGPU review renderer has no post-processing. Captures use
1280x1000, DPR 1 and seed 431. Camera and memory inventory are in the capture
report. The motion capture reported no browser errors.

## Validation

- All 2,727 actual-rig attack poses pass. Bow checks now cover straight full
  extension, forward shoulder alignment, downward elbow flex, no sideways
  kink, limited wrist twist, cheek anchoring, contact and cycle continuity.
- Maximum adjacent bow hand-rotation step across the sampled cycles is
  4.5 degrees (male), 3.5 (female) and 4.1 (raider).
- The 404-pose elbow mesh check and combat presentation checks pass.
- CPU overlay benchmark for 27 mixed attack rigs: median 1.39 ms,
  p95 1.61 ms. This is not a GPU or whole-game frame-time measurement.

The new pose uses existing scratch storage and the existing skeleton.
It adds no per-frame allocations, bones, materials or draw submissions.
