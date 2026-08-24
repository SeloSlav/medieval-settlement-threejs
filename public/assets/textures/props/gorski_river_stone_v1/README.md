# Approved natural-surface PBR material

- Review candidate: `clean-river-stone`
- Approved: 2026-08-23
- Runtime albedo source: `basecolor.png`
- Runtime normal: PATINA green channel flipped to match the project's existing
  normal convention, mean XY tilt removed, attenuated to
  `0.64`, then renormalized with a reconstructed
  upward-facing Z component to prevent grazing-angle spikes.
- Runtime roughness: conservative high-range review remap.
- Runtime AO: conservative height-derived review map.
- Runtime metalness: zero; this natural material is dielectric.

Raw PATINA output remains unchanged under
`artifacts/pbr-material-review/patina-candidates/clean-river-stone/`.
