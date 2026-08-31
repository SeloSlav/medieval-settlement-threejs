# Exact GPU agent animation

This path replaces per-visible-agent `AnimationMixer` traversal and CPU palette
uploads. It does not replace the authored models and is not an LOD system.

## Invariants

- Every visible actor uses its original indexed geometry, UVs, skin indices,
  skin weights, complete bone set, PBR materials and textures.
- Every authored key time and value remains 32-bit data. There is no sampled
  pose atlas, time quantization, reduced frame rate, shared pose, reduced bone
  set, proxy, silhouette, impostor, thinning or distance switch.
- Discrete tracks use exact predecessor lookup. Linear vector tracks use exact
  lerp. Linear quaternion tracks use Three.js-compatible shortest-path slerp.
- Unsupported track/deformation types fail during asset compilation instead of
  being resampled or silently omitted.

## Runtime data flow

`ExactGpuAnimationLibrary` compiles one immutable database per authored rig.
The current male-villager library is 1.08 MiB and the Ottoman-raider library is
0.90 MiB. Each database uses five read-only GPU storage buffers: track
descriptors, key times, key values, packed skeleton floats, and packed skeleton
metadata.

Each actor contributes one 32-byte state record:

1. primary clip index and exact time;
2. optional secondary clip index and exact time;
3. exact crossfade weight.

One compute invocation owns one actor and walks the complete skeleton in
topological order. It writes two full-float outputs:

- skin palettes for the authored body geometry;
- model-space bone matrices for swords, bows, shields, arrows, tools and other
  exact rigid attachments.

The compute contract uses exactly eight storage buffers, the guaranteed WebGPU
per-stage limit. For 512 actors the per-frame CPU upload is 16 KiB instead of
uploading roughly 1.28 MiB of 41-bone skin palettes. Both output palettes remain
GPU-resident and flow directly into body and attachment vertex shaders.

## Action and combat mapping

The gameplay scheduler remains authoritative. It advances only the small state
record and applies loop, one-shot/clamp and transition rules:

- locomotion and work actions select their authored clips normally;
- hit and fall select their full authored one-shot clips;
- a transition supplies primary/secondary clips and the fade weight;
- unique phase and time remain per actor, so animation is never synchronized or
  pose-shared for performance.

Flag cloth is CPU simulated and needs a hand transform. Only the one standard
bearer per company runs the library's exact CPU reference evaluator as a pose
observer. That does not submit a duplicate body. The measured reference cost for
32 flag bearers is approximately 0.3-2.5 ms on the development machine; ordinary
weapons and equipment consume GPU model-bone matrices with no readback.

## Integration boundary

1. Create one `ExactGpuAnimationLibrary` beside each loaded authored source.
2. Create and reserve an `ExactGpuAnimationStateBuffer` for the source batch.
3. Bind the library's five immutable inputs, the state buffer, and the two
   writable palettes to the compute contract returned by `buildComputeWgsl()`.
4. Dispatch `ceil(visibleActorCount / 64)` workgroups before shadow and color
   submissions.
5. Point exact body skinning at the GPU skin-palette buffer.
6. Point exact attachment transforms at the model-bone buffer plus the existing
   per-actor world transform.
7. Evaluate only active standard bearers through `evaluateReferenceInto()` for
   CPU flag physics.

The current production Tripo assets contain only supported discrete and linear
skeletal TRS tracks. If a future asset contains glTF cubic-spline, morph, or
additive animation, that exact mode must be implemented before accepting the
asset; it must not be converted into a lower-quality sampled approximation.

The reference suite also verifies exact palette and attachment-bone parity for
the current fish, deer, stag, bull, chicken, cow, pig and sheep rigs, including
their authored internal scale and coordinate-basis transforms.
