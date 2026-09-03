# Startup UI material pass

2026-09-03. Original finishing treatment for the Legacy, Heraldry, and Map Generation screens. References informed material weight, not layout or copied art.

## Integration

- Skin: `src/ui/startupCraft.css`, imported after existing skins in `src/main.ts`.
- Runtime assets: `public/assets/ui/startup-craft/` — ledger-leather.webp (421,450 bytes), smoked-oak.webp (420,226 bytes), iron-frame.svg, carved-rule.svg.
- Original generated PNGs: `artifacts/startup-ui/source/`. Archived outside public so builds ship only the compressed textures.
- WebP encoding: quality 88, effort 6, original 1254 × 1254 resolution retained. No cropping or content edits.
- The 96 × 96 original vector iron fitting is nine-sliced with a transparent center. Different frame widths are painted in pointer-transparent pseudo-elements; they never participate in layout. Portrait frames have an isolated stacking context so the shield stays in front.
- Fonts, text metrics, layout, padding, gaps, border widths, hit areas, existing image crops, responsive rules, background landscape, and game behavior are unchanged. Selected/disabled/hover and explicit keyboard-focus states are retained.

## Verification

Live before/after comparisons toggled only the finish stylesheet. Every descendant's x, y, width, height, font, padding, margin, and border width was compared on the same mounted screen. Hidden nodes were included; no DOM structure was added to the production panels.

| Screen | 1600 × 900 | 1280 × 720 | 820 × 900 |
| --- | --- | --- | --- |
| Legacy (700 elements) | 0 differences | 0 differences | 0 differences |
| Heraldry (700 elements) | 0 differences | 0 differences | 0 differences |
| Map (194 elements) | 0 differences | 0 differences | 0 differences |

The isolated development fixture in `.tmp/startup-ui-review.html` mounts the real panels without the game world; it is not shipped. Reviewed the screen images, portrait/shield layering, map size, landscape selection, difficulty arrows, and keyboard controls. Existing clipping at narrow/short breakpoints is not altered by this skin.

The real application was also checked through Legacy → Heraldry → Map → Heraldry without starting or resetting a world. Final 1600 × 900 preview: `heraldry-finished.jpg`.

Passed:

- `node --experimental-strip-types scripts/testStartupCraft.mts` — paint-only declaration guard, selector scope, decorative overlay safety, asset budget, and import ordering.
- `npm run test:new-world-setup`.
- `tsc --noEmit`.
- `npm run build` (existing large-chunk warning remains).

## Asset provenance and exact generation prompts

Both raster textures were generated with the built-in image-generation tool (not CLI). No reference screenshot was used as an edit target. The frame and rule are original code-native SVG fittings, not generated raster art.

### Ledger leather

Use case: stylized-concept. Asset type: seamless tileable game UI material texture, square 1024x1024. Primary request: an original aged charcoal-brown leather-bound estate ledger surface for a grounded 1500s Gorski Kotar Croatian frontier game. Perfectly flat orthographic top-down material scan filling the entire image edge to edge, NO objects or edges. Dense fine irregular vegetable-tanned leather grain, subtle hand-burnished rubbed areas, tiny dry pores, very fine scuffs, delicate smoky wax patina. Very dark desaturated peat-brown and warm graphite, approximate base #302c27, restrained midtone variation so ivory interface text will read clearly on top. Soft flat diffuse lighting, no shadows or directional lighting, no vignette. Tactile painterly realism, not plastic, not smooth noise. The material itself is the only subject. Seamless on all four edges. No frame, no border, no stitches, no lettering, no symbols, no ornament, no watermark.

### Smoked oak

Use case: stylized-concept. Asset type: seamless tileable material texture for handcrafted historical game UI frame rails and buttons, square 1024x1024. Primary request: close-up flat orthographic scan of deeply aged, dark smoked European oak, fitting a 1500s Gorski Kotar Croatian manor's carved chest. Fine horizontal wood grain flows from left to right across the entire image, shallow adze marks, dense narrow growth rings, tiny rubbed ridges, soft ingrained soot and natural dull wax. Deep desaturated walnut-brown and grey umber, average color approximately #514335 with occasional fine muted taupe highlights. Quiet even contrast and flat diffuse lighting. Material fills every edge; seamlessly repeatable both horizontally and vertically. No boards or plank seams, no nails, no cracks wider than hairlines, no frame, no border, no text, no symbols, no metal, no objects, no dramatic lighting, no vignette, no watermark. Tactile painted realism, not an artificial smooth gradient.
