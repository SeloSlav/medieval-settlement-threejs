# Matching ranged ammunition

The bow's nocked and fired arrows share the same complete geometry and material:
an ash shaft, forged point, dark nock, and three thin, tapered goose-feather vanes.
Two feathers are ivory and the cock feather is brown, with a subdued transverse
band. The closed feather surfaces remain visible from either side without alpha
cards, extra material passes, or texture sampling. Crossbow bolts use the same
construction with two smaller horizontal vanes that clear the bolt deck.

Quiver arrows use identical feather vertices and colors, eight staggered tails
in the bow quiver and five in the bolt case. Their concealed points are omitted
and their shafts end below the container mouth. The nock is now the shared
coordinate origin, so release does not jump the flying arrow ahead of the string.

## Visual evidence

- [Nocked arrow](weapon-qa/arrow-nock-close.png)
- [Matching quiver](weapon-qa/arrow-quiver-close.png)
- [Full draw](weapon-qa/arrow-draw-side.png)
- [Actual instanced projectile](weapon-qa/arrow-flight-isolated.png)
- [Raider draw](weapon-qa/arrow-raider-nock.png)
- [Movement recording](weapon-qa/ammunition-cases.webm)

The `ammunition-cases.json` manifest uses fixed views at 1280x1000, DPR 1,
seeds 431 and 9821, and the production WebGPU renderer without post-processing.
It covers close, full-body, distant, raider, and isolated projectile views.
The preview also has Nock, Quiver, and Projectile camera presets with orbit/zoom.
Captures and five weapon-motion sequences reported no browser errors. Camera,
render-call, geometry and renderer-memory counters are in the capture report.
Browser frame counts are recorded separately; GPU frame times were not measured.

## Geometry and checks

- Complete arrow: 140 triangles, one mesh/material. Stored arrow tail: 132 triangles.
- Complete bolt: 112 triangles. Stored bolt tail: 104 triangles.
- The equipment catalog drops from 34,590 to 31,814 triangles, 88 to 82 source
  meshes, and 63 to 57 default visible identity batches.
- Flying ammunition retains two instanced draw calls and the 96-projectile pool.
  Nocked ammunition now registers with the shared mounted-equipment batch too.
- `test:ranged-ammunition` checks identical feather surfaces/colors, bounds,
  nondegenerate triangles, winding, normals, production quiver batching, and
  shared-resource disposal while another owner remains active.
- Combat presentation verifies held/flying geometry and material identity,
  real-world ammunition scale, nock release origin, reload visibility and pooling.
- All 1,818 male/raider attack poses, equipment and sharing tests, the male-only
  browser regression, TypeScript, and production build pass.
- The broader live-attachment test still fails its legacy 12 cm crossbow mount
  threshold at 12.1944 cm. Running it with the unchanged HEAD combat/equipment
  modules reproduces exactly the same failure; ammunition does not change it.
