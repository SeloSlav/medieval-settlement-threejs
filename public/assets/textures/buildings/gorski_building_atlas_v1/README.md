# Gorski building material atlas v1

Twenty seamless, physically coherent building surfaces generated with `fal-ai/patina/material`.
Every 512 px cell contains a 448 px repeating surface plus a 32 px wrapped gutter on all sides.
Runtime sampling uses fractional metric UVs constrained to the content rectangle so material repeats cannot bleed into neighboring cells.

- `building_albedo_atlas.png`: sRGB base color.
- `building_normal_atlas.png`: corrected OpenGL tangent-space normals.
- `building_material_atlas.png`: R roughness, G metalness, B AO, A centered height.
- `manifest.json`: tile identities, physical scale, response ranges, and source candidates.

Raw Patina results and request metadata remain under `artifacts/pbr-material-review/patina-candidates/building-*`.
