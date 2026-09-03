# Heraldry cloth palette

2026-09-03. Ten art-directed sRGB swatches for the 1500s Gorski Kotar setting.

These are plausible colors obtainable with period materials, not colorimetric reconstructions of surviving Croatian cloth. Evidence below establishes dye techniques in medieval and sixteenth-century Europe; it does not establish a particular village's supply, recipe, or price. The palette includes luxury cloth as well as ordinary materials. Actual shades varied with fiber, mordant, dye strength, processing, wear, and lighting.

## Full palette

| UI color | sRGB | Material interpretation |
| --- | --- | --- |
| Red | `#a44132` | Warm madder-root red. |
| Blue | `#355f83` | Clear woad-vat blue, replacing the former slate/teal cast. |
| Green | `#526b3d` | Weld yellow combined with woad blue; brighter and more legible than the former dark olive. |
| Black | `#272824` | Soft charcoal-black representing tannin/iron dyeing, not absolute screen black. |
| Purple | `#705574` | Subdued red/blue double-dyed purple, not a claim of imperial shellfish-purple cloth. |
| White | `#e2dac2` | Light undyed wool; warm white rather than bleached screen white. Cloth equivalent of Argent. |
| Yellow | `#c7a64e` | Weld yellow, not metallic glitter. Cloth equivalent of Or. |
| Crimson — new | `#862f46` | A deeper, cooler red inspired by costly kermes dye. |
| Russet — new | `#ae6638` | Warm madder orange-brown; distinct from both red and yellow. |
| Brown — new | `#735039` | Common-walnut brown (Juglans regia), not American black walnut. |

The last three are additional cloth-color choices, not an assertion that ten tinctures were customary in sixteenth-century Croatian heraldry. “Russet” here names a shade, not a claim about every historical fabric called russet. No synthetic dyes or New World dyestuffs are needed to justify these choices.

## Historical basis

Madder, woad, and weld are archaeologically attested medieval dye plants. Their colors also combine into greens, oranges, and purples. This supports retaining a genuinely varied palette instead of treating all old cloth as faded brown. [Institute of Natural Sciences: medieval dye-plant discoveries](https://www.naturalsciences.be/en/science/news/unique-medieval-dye-plants-discovered-in-brussels-and-mechelen).

The Met describes madder's range from pink through strong reds, purplish reds, and oranges, depending on mordants and combinations. This supports both our main red and the new warm russet. [The Met: Madder Red](https://blog.metmuseum.org/cloistersgardens/2013/03/08/madder-red/).

Kermes was identified in a fifteenth-/sixteenth-century knitted-cap study and was a costly sixteenth-century dye. Crimson therefore represents a luxury option, not cheap everyday red. [Nabais et al., 2023: Early modern knitted caps](https://www.nature.com/articles/s40494-023-01020-4).

Good black was possible, but not automatically easy: Renaissance recipes used red over blue, or tannins with iron salts. Rosetti's Venetian dye manual of 1548 includes numerous black recipes. This historical context stays in the research notes; in-game tooltips describe only the material and resulting color. [Refashioning the Renaissance: When black became the colour of fashion](https://refashioningrenaissance.eu/when-black-became-the-colour-of-fashion/).

The Met's analysis of an early fifteenth-century tapestry proposes common walnut as the source of reddish-brown yarns; the identification is proposed, not definitive. Common-walnut leaves and mature husks are independently documented sources of brown dye. [The Met, 2024: dye analysis, p. 134](https://cdn.sanity.io/files/cctd4ker/production/4ec58b18c89ab2e2d4de7c0ad26b2f67bacd5a6e.pdf), [World Agroforestry: Juglans regia](https://apps.worldagroforestry.org/treedb2/AFTPDFS/Juglans_regia.PDF).

## Implementation and verification

- One shared color map drives swatches and all fifteen presets. Existing arbitrary-color validation remains unchanged; no save migration or compatibility layer was added.
- All four rows have the same ten colors and dye-source tooltips, available on hover and keyboard focus.
- Only swatch distribution within the existing rows changes. Original row minimum widths and heights are preserved; the buttons share available width on narrower screens.
- Live before/after geometry checks: **zero changes** across 672 non-swatch descendants at each of 1600 × 900, 1280 × 720, and 820 × 900. Panels, labels, portraits, shields, patterns, charges, sliders, and navigation stay in place.
- All 40 browser color selections passed: each updates the intended shield color and leaves exactly one selected swatch in its row. Keyboard dye tooltip verified.
- All ten swatches remain inside each row at the three tested breakpoints. The chosen colors survive Heraldry → Map Generation → Heraldry without starting a world.
- Automated persistence coverage checks all ten colors in all four roles, rendered CSS values, fresh-session restoration, unique swatches, and preset membership.
- Passed `test:noble-profile-persistence`, `test:new-world-setup`, `testStartupCraft.mts`, and the production build (including TypeScript). The existing large-bundle warning remains.
