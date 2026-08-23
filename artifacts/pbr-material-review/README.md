# PBR material replacement review

Generated with `fal-ai/patina/material`. This is a non-destructive review set: no runtime texture path or production material was changed.

## Candidate summary

| Surface | Priority | Initial recommendation | Candidate folder |
| --- | --- | --- | --- |
| Open meadow grass | High | Consider after an in-game scale test | `manor-grass-meadow` |
| Dense shaded grass | High | Consider after an in-game scale test | `manor-grass-dense` |
| Dry late-summer grass | High | Consider after an in-game scale test | `manor-grass-dry-v2` |
| Primary forest leaf litter | Highest | Strong replacement candidate | `forest-leaf-litter-primary` |
| Fine decomposed forest litter | Highest | Strong replacement candidate | `forest-leaf-litter-secondary` |
| Medieval compacted dirt road | High | Consider after road-width and tint tests | `medieval-dirt-road` |
| Cultivated garden-bed soil | Medium | Strong replacement candidate | `cultivated-garden-soil` |
| Forest mossy karst rock surface | Medium | Consider for a forest-only material | `forest-mossy-karst-rock-v3` |
| Clean water-worn river stone surface | Medium | Consider for a river-specific material | `clean-river-stone` |
| Clean freshly fractured quarry limestone | Medium | Consider for a quarry-specific material | `clean-quarry-limestone-v2` |

## Visual QA notes

| Candidate | What to watch before approval |
| --- | --- |
| Meadow grass | More organic and detailed, but it can read as flattened thatch; verify blade scale and normal strength in the terrain shader. |
| Dense grass | Strongest grass candidate. A few dark holes may form motifs; attenuate the raw normal response. |
| Dry grass v2 | Replaces the rejected hair-like v1 with shorter turf and a restrained palette grade; still verify that it remains distinct from meadow at game scale. |
| Primary leaf litter | Largest visual upgrade. It is darker and has a few memorable bright leaves/twigs, so test three-projection repetition under canopy. |
| Secondary litter | Excellent stochastic dark companion; intentionally reads as mixed humus with some needles rather than pure beech litter. |
| Dirt road | Cleaner and less swirled, but smoother/sandier than ideal. Test at the 5.8 m road repeat with the existing rut mask and shader tint. |
| Garden soil | Clear win: dark crumbly cultivated earth replaces a grey source with a visible tread/boot impression. |
| Forest mossy rock v3 | Correct forest identity, but large moss islands can repeat. Restrict it to woodland buckets and inspect lit normal/height seams. |
| River stone | Clean role-specific identity, though its broad diagonal bedding can read like an exposed slab. Test repetition and remove the current green tint. |
| Quarry limestone v2 | Motif-neutral and clean; it may read slightly concrete-like until paired with deliberately angular quarry geometry. |

## Full audit disposition

| Existing surface family | Production status | Review action |
| --- | --- | --- |
| `manor_grass_meadow`, `manor_grass_dense`, `manor_grass_dry` | Live terrain PBR | Generated three distinct candidates; retain the ecological blend and test physical scale in game. |
| `forest_leaf_litter`, `forest_leaf_litter_secondary` | Live albedos packed into the dry/snow/leaf atlas; standalone data maps are ignored | Generated two full candidates. Highest visual upside. Later integration should pack matching data-map atlases rather than add samplers. |
| `roads/medieval_dirt` | Live road, river-bank, shore, quarry-wear, and close-soil source | Generated one candidate without baked ruts or edges. Preserve the existing rut mask, edge fade, tint, and weather system. |
| `mammoth_terrain_dirt` | Live garden-bed soil | Generated a dedicated cultivated-soil candidate. SeedThree crop/vegetable textures were excluded. |
| `props/mossy_rock` | Live shared open-ground/forest, river, and quarry-deposit PBR | Generated three identities: woodland-only mossy stone, clean water-worn river stone, and clean freshly fractured quarry limestone. Open-meadow rocks need a neutral fallback because the current “forest” placement pass also emits rocks in low-forest-density areas. |
| `snow_ground` | Only its albedo is packed into the live atlas; standalone data maps are ignored | Keep for this round. Current snow reads well and a full replacement cannot be used without atlas/material work. |
| `roads/wood_logs` | Live UV-authored bridge/log surface | Keep. Its albedo encodes log layout, so a generic seamless PATINA tile is the wrong representation. |
| close meadow grass and forest-floor ivy | Live alpha cards, not tileable ground PBR | Keep. These require foliage-card generation with preserved alpha, not PATINA Material. |
| bilberry, fern, and juniper forest undergrowth | Live SeedThree albedo/normal/roughness/translucency cards | Keep. They already use coherent foliage-specific maps. |
| `manor_grass_blend`, `grass_ground`, `mammoth_grass_ground`, `mammoth_dead_grass_ground`, `mammoth_terrain_gravel` | Runtime-dead / archival | Audited, but no generation spend. |
| SeedThree vegetables and kitchen-crop cards | Live but explicitly excluded | No inspection-driven replacement and no generation calls. |

## Map handling

- PATINA returned `basecolor`, `normal`, `roughness`, `height`, and `metalness` at 1024×1024.
- PATINA's raw roughness predictions were systematically too glossy for these dry materials. Each candidate therefore includes a conservative high-range `roughness-runtime.png`; raw `roughness.png` remains untouched for inspection.
- Dry grass v2 includes a mild `basecolor-runtime.png` sRGB grade to restore the established straw/olive mean; its raw PATINA basecolor remains untouched.
- Natural ground and rock are dielectrics. The review retains the raw PATINA metalness for inspection and also provides an all-black `metalness-runtime.png`.
- PATINA does not return AO. `ao-derived.png` is a conservative, wrap-aware local derivation from the returned height map.
- Basecolor is the only sRGB map. Normal, roughness, height, metalness, and AO must remain linear/no-color-space.
- Height is included for completeness but is currently not sampled by the production grass or road materials.
- PATINA does not document its normal convention. These normals show a consistent negative-green bias relative to the current maps; verify Y orientation in a lit test, then flip/recenter and attenuate via normal scale if required.
- Earlier `manor-grass-dry`, `mossy-karst-rock`, `forest-mossy-karst-rock-v2`, and `clean-quarry-limestone` drafts are retained in `patina-candidates/` but excluded from the recommended gallery: dry grass v1 was too hair-like, the moss drafts were respectively too clean and too circular/repetitive, and the first quarry draft read as marble-veined.

## Rock identity integration caveats

- Forest and meadow rocks currently share one instanced material. Bucket by forest density before applying the mossy candidate; otherwise meadow stones will incorrectly become mossy.
- River-shore stones currently receive a procedural green/brown “moss” tint. Remove or neutralize that tint when testing the clean river candidate.
- Quarry resource deposits and river rocks currently receive the same shared texture objects. Load independent sets before either system disposes them.
- Constructed quarry buildings already use separate masonry PBR materials; do not retarget those.
- Texture identity supports the gameplay distinction, but quarry clusters, depressed quarry pads, angular geometry, map icons, and depletion remain the primary harvestability cues.

Open `index.html` for the gallery, `overview-current-vs-patina.png` for the compact old/new view, or `comparisons/` for one full channel sheet per surface.
