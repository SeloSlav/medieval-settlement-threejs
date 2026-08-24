# Natural-surface material direction

## Approved runtime set — 2026-08-23

The approved PBR replacement set covers meadow, dense and dry grass; primary
and secondary forest litter; forest mossy rock; river stone; and quarry
limestone. Runtime-ready files live in versioned `gorski_*_v1` texture folders.
The original texture folders and raw PATINA review outputs remain intact.

Runtime normals are green-channel corrected, mean-centered, strength-limited,
and renormalized with an upward-facing Z component. Rotated grass UV families
also reorient their tangent normals before blending. Forest litter shares a
four-cell albedo/HRAO atlas (height, roughness, AO) so the terrain remains
within the portable WebGPU sampler budget.

Rock identity is ecological and semantic:

- mossy karst stone belongs only to sufficiently dense woodland;
- open-meadow stones retain the neutral legacy fallback;
- river stones are pale, water-worn and free of procedural moss tint;
- quarry deposits use pale fractured limestone and remain distinguished by
  angular clusters, quarry pads, map cues and depletion;
- constructed quarry masonry continues using its separate building-material
  library.

## Deferred final pass

Do not replace these materials yet:

- **Medieval compacted dirt road:** the next candidate should be lighter and
  more sun-baked grey, while retaining credible cart-wheel tracks, compacted
  ruts and irregular muddy variation. It must preserve the existing authored
  rut mask, weather response, road-edge feather and physical repeat scale.
- **Backyard garden-bed soil:** the next candidate should be darker, richer
  worked earth with restrained clods and hand-tool disturbance. It should read
  as medieval household cultivation rather than modern bagged topsoil or a
  machine-tilled field.

SeedThree crop and vegetable cards remain outside this material pass.
