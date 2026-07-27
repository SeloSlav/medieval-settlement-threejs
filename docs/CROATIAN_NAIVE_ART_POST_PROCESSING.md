# Croatian naïve-art post-processing

The global scene treatment is a bespoke, screen-space interpretation of the
Hlebine-school visual language. It is intentionally implemented after the
scene render, so terrain, roads, water, vegetation, trees, agents, buildings,
particles, and sky all receive one consistent treatment without changing
their geometry or materials.

The reference direction is based on the supplied Mijo Kovačić and Ivan
Generalić paintings and two institutional descriptions of the tradition:

- [Hlebine school — Croatian Encyclopedia](https://www.enciklopedija.hr/clanak/hlebinska-slikarska-skola)
- [Croatian Museum of Naïve Art](https://hmnu.hr/)

The encyclopedia identifies open colour and reverse painting on glass among
the school's foundational principles. The shader translates those qualities
into a restrained real-time vocabulary rather than applying a generic
cartoon filter.

## Pipeline

The enabled preset adds a nine-sample, edge-aware neighbourhood kernel to the
existing post-processing grade. One sampling footprint supplies both the
colour simplification and the structural contour signal:

1. A luma-gated bilateral average quiets fine procedural texture while
   preserving silhouettes.
2. Broad luminance bands produce deliberately painted colour masses.
3. Increased local colour and the existing bloom pass create the luminous
   quality associated with reverse-painted glass.
4. Shadow underpainting shifts dark regions toward deep olive-brown without
   flattening them to neutral black.
5. A Sobel-style structural signal produces chromatic painted contours.
6. Very subtle, stable pigment variation prevents perfectly digital flats.

WebGPU/TSL and WebGL/GLSL use the same values from
`src/scene/naiveArtPostEffect.ts`. No additional geometry pass, per-object
material variant, temporal buffer, or model edit is involved. The feature
reuses the pre-existing bloom stage and adds nine colour reads in the final
screen-space grade.

## Global switch

There is deliberately no menu setting. Change this one constant and rebuild:

```ts
export const CROATIAN_NAIVE_ART_POST_PROCESSING_ENABLED = false;
```

It lives in `src/scene/naiveArtPostEffect.ts`. When false, the painterly
kernel is not constructed and the original bloom values and day/night grade
are retained.

## Tuning and limits

All art-direction values are grouped in `CROATIAN_NAIVE_ART_STYLE` beside the
flag. `filterRadiusPixels`, `painterlySmoothing`, `paletteStrength`,
`contourStrength`, `shadowUnderpaintStrength`, and the bloom values are the
main controls.

A screen-space pass can unify colour, value grouping, edge language, and
surface texture across the entire world. It cannot reproduce the paintings'
deliberately impossible perspective, hand-authored figures, or narrative
composition without changing the scene content. Those qualities remain the
responsibility of camera, layout, and asset design.

