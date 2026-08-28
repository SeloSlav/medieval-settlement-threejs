# Gorski camp canvas v1

Dedicated repeatable PBR surface for the Hunter's Camp sleeping tent. The
source is an OpenAI built-in image-generation material scan of used unbleached
linen/hemp canvas. `scripts/prepareCampHideMaterial.mjs` reconciles opposite
edges and derives tangent-space normal and packed material channels.

The geometry owns all large folds, hems, seams, tie-backs, and tension. This
texture supplies only fabric weave, restrained dirt, wear, and repairs.

- Scale: 1.25 m per tile
- `aged_canvas_albedo.png`: sRGB base color
- `aged_canvas_normal.png`: OpenGL tangent-space normal
- `aged_canvas_material.png`: R roughness, G metalness, B ambient occlusion,
  A centered height
