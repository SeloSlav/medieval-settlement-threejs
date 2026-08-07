# Vegetation card textures

`raspberry_patch_albedo.png` is the dedicated transparent alpha card for harvestable berry-resource patches. It replaces the former bilberry-card-plus-red-sphere treatment with raspberry canes whose aggregate fruit is part of the texture. Ordinary procedural juniper scrub continues to use SeedThree's original `juniper_scrub_*` texture set.

Generation prompt:

> Use case: stylized-concept. Asset type: square game vegetation alpha-card texture for a realistic Three.js medieval temperate landscape. Primary request: create one dense, botanically convincing wild European raspberry cane clump to replace the harvestable berry-patch foliage card. Scene/backdrop: perfectly flat solid #0000ff chroma-key background for local background removal. Subject: several slender thorny brown-green raspberry canes growing from one compact bottom-center root, with layered serrated compound raspberry leaves and many small natural raspberry fruits integrated among the leaves; fruit must read as irregular clustered drupelets, never smooth balls or detached floating spheres; include a restrained mix of ripe deep raspberry-red fruit, a few pale unripe berries, and small buds. Style/medium: realistic high-detail botanical game texture, slightly de-lit diffuse albedo suitable for repeated crossed foliage cards. Composition/framing: full clump seen from the side/front at natural eye level, rooted at the exact bottom center; broad leafy silhouette fills roughly 82% of the square; all stems and leaves remain inside frame; enough negative space between branches for a clean alpha cutout. Lighting/mood: soft even overcast daylight, minimal directional shading, no cast shadow. Color palette: natural forest greens, muted olive undersides, brown-green canes, deep raspberry reds; absolutely no blue in the plant. Materials/textures: crisp serrated leaves with visible veins, woody fibrous canes, matte aggregate raspberry drupelets. Constraints: background must be one perfectly uniform #0000ff with no gradients, texture, floor, horizon, reflections, shadow, or lighting variation; no blue anywhere in the plant; isolated single rooted clump; no text, border, watermark, basket, ground, landscape, insects, flowers, or extra objects. Avoid: smooth red orbs, spherical baubles, oversized fruit, floating fruit, juniper needles, juniper berries, blueberry foliage, plastic appearance, top-down view, clipped foliage.

`cattail_reed_card.png` is a transparent albedo card generated with the Codex built-in image generator, then chroma-keyed and resized locally for the SeedThree ground-cover renderer.

Generation prompt:

> Use case: stylized-concept. Asset type: game vegetation alpha-card texture for a realistic medieval temperate landscape. Create a natural clump of European common cattails (Typha latifolia) with long narrow green reed leaves and several distinct dark brown cylindrical cattail seed heads on slender upright stems. Use a perfectly flat solid #ff00ff chroma-key background. Render a realistic high-detail botanical game texture with soft diffuse overcast daylight. Keep the isolated full-height clump rooted at the exact bottom center with generous padding. Use olive and fresh reed greens, muted straw highlights, and dark warm brown cattail heads. No shadows, floor, water, landscape, text, watermark, flowers, wheat, bamboo, or pampas grass.

`rose_blossom_card.png` is a transparent blossom texture generated with the Codex built-in image generator, chroma-keyed locally, and resized to 1024×1024. The garden renderer layers it over the existing modeled rose petals so blossoms retain 3D depth while reading clearly as roses at gameplay distance.

Generation prompt:

> Use case: background-extraction. Asset type: game vegetation texture card for a rose blossom. Primary request: one botanically convincing old garden rose blossom viewed directly face-on, fully open, with many distinct layered petals curling naturally toward a dense center. Scene/backdrop: perfectly flat solid #00ff00 chroma-key background for local background removal. Subject: a single pale ivory rose with subtle blush-pink petal edges and warm natural shadow variation inside the blossom; no stem and no leaves. Style/medium: photorealistic botanical cutout suitable for a high-quality Three.js foliage card. Composition/framing: blossom centered, symmetrical overall but naturally irregular, fills about 82 percent of the square, crisp complete silhouette with generous clean padding. Lighting/mood: soft diffuse daylight with restrained internal petal shading; no cast shadow. Constraints: background must be one uniform #00ff00 color with no gradients, texture, floor, reflections, shadow, or lighting variation; do not use green anywhere in the flower; no stem, leaves, thorns, buds, vase, text, border, or watermark; crisp separated edges. Avoid: circular painted disk, simple five-petal flower, plastic appearance, orb shape, top-down bouquet, multiple blossoms.

## Gorski Kotar wildflower heads

The `wildflowers/` folder contains the transparent alpha-card heads used to build the streamed meadow atlas:

- `queen-annes-lace-head.png` — white Queen Anne's lace / wild-carrot umbel (`Daucus carota`)
- `clusius-gentian-head.png` — blue-violet Clusius gentian (`Gentiana clusii`)
- `grey-hawkbit-head.png` — yellow grey hawkbit (`Leontodon incanus`)
- `bulbiferous-lily-head.png` — orange bulbiferous lily (`Lilium bulbiferum`)
- `red-campion-head.png` — pink-red campion (`Silene dioica`)

The Codex built-in image generator produced each species separately on a solid green chroma-key background. The installed chroma-key helper removed the background and ImageMagick resized the validated RGBA outputs to 512×512. The streamed renderer places these images on lightweight cards attached to the existing modeled stems and leaves; it no longer builds procedural petal geometry for this meadow layer.

`gorski-kotar-wildflower-atlas-v2.png` packs the five runtime heads into a single
1280×256 runtime texture (five 256px cells in one row).
The streamed renderer selects a cell per instance, keeping the five-species
variation in one instanced mesh, one material, and one texture binding.

Shared generation prompt:

> Use case: background-extraction. Asset type: square game vegetation alpha-card texture for a high-quality Three.js wildflower head in a medieval Gorski Kotar mountain meadow. Scene/backdrop: perfectly flat solid #00ff00 chroma-key background for local removal. Style/medium: photorealistic botanical cutout, natural field specimen, diffuse albedo-like daylight. Composition/framing: exactly one flower head centered and viewed face-on along the bloom axis, fully open, complete silhouette, filling about 78% of the square with clean padding. Lighting/mood: soft even overcast daylight with restrained internal petal shading; no cast shadow. Constraints: the background must be one uniform #00ff00 with no gradients, texture, floor, horizon, reflections, shadow, or lighting variation; no green anywhere in the subject; flower head only with no stem, leaves, foliage, soil, vase, text, border, watermark, insects, extra buds, or additional blossoms; crisp separated edges; botanically credible, not decorative clip art.

Species-specific prompt suffixes:

- Queen Anne's lace: one nearly circular, gently irregular flat umbel made from dozens of tiny white five-petal florets, grouped into visible sub-clusters around a subtle pale-green center. Keep fine lacy gaps and a bold mip-safe silhouette; avoid a daisy shape, large individual petals, yellow disk centers, bouquets, and side views.
- Clusius gentian: one deep cobalt-to-violet-blue `Gentiana clusii` trumpet viewed straight into the flower, with five broad fused lobes, subtle darker pleats, and a small pale throat. Avoid iris, bellflower, separate flat petals, neon blue, and a green calyx.
- Grey hawkbit: one rich golden-yellow `Leontodon incanus` composite flower with many fine strap-shaped ray florets, naturally uneven tips, and a deeper ochre center. Avoid sunflower, seed heads, orange petals, and perfect circular icons.
- Bulbiferous lily: one natural burnt-orange `Lilium bulbiferum` cup with six broad pointed tepals, restrained dark-rust speckling, and clearly shaped central stamens. Avoid tiger-lily recurving, bouquets, extra blooms, and neon orange.
- Red campion: one muted magenta-pink `Silene dioica` bloom with five broad petals, each deeply notched into two lobes, a small pale center, and gently wrinkled texture. Avoid roses, carnations, phlox, neon purple, and a green calyx.
