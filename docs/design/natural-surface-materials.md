# Natural-surface material direction

## Approved runtime set — 2026-08-23

The active generated PBR replacement set covers meadow, dense and dry grass
plus primary and secondary forest litter. Runtime-ready files live in
versioned `gorski_*_v1` texture folders. The original texture folders and raw
PATINA review outputs remain intact.

Runtime normals are green-channel corrected, mean-centered, strength-limited,
and renormalized with an upward-facing Z component. Rotated grass UV families
also reorient their tangent normals before blending. Forest litter shares a
four-cell albedo/HRAO atlas (height, roughness, AO) so the terrain remains
within the portable WebGPU sampler budget.

## Rock material override — 2026-08-24

All natural boulder and outcrop roles now use the established
`props/mossy_rock` albedo, normal and roughness set:

- forest and meadow rocks;
- river-bank stones;
- quarry-deposit boulders;
- isolated mineral/quarry lineup previews that use those runtime loaders.

The pale generated forest limestone, river stone and quarry limestone sets are
retained on disk as rejected/inactive candidates; no texture was deleted.
Role-owned texture instances remain separate so river and quarry teardown is
safe. Harvestable quarry deposits continue to be distinguished by their dense
angular clusters, quarry pads, map cues and depletion rather than by a white
surface. Constructed walls and building masonry remain separate authored
materials rather than natural boulder props.

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
