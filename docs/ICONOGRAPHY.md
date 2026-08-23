# Gorski Kotar Iconography

This is the visual language for map markers, the construction dock, contextual
build actions, and settlement resources.

## Character

The icons should feel made by the same hands as the game's illuminated building
cards: a practical late-Renaissance woodcut colored by a local manuscript
workshop. The reference is Gorski Kotar around 1550, not generic high fantasy.

- Use a near-black, visibly hand-inked contour.
- Favor one compact, unmistakable silhouette over decorative detail.
- Allow small irregularities in line and fill so the work feels printed and
  painted rather than digitally geometric.
- Use period objects and construction. Avoid modern tools, modern symbols,
  fantasy runes, glossy rendering, and beveled app-icon styling.
- Keep empty space around every silhouette. The interaction frame belongs to
  CSS, not to the painted asset.

## Palette

The art uses a deliberately small mineral and plant-pigment palette:

| Role | Color direction |
| --- | --- |
| Ink | Charcoal brown-black |
| Light body | Aged parchment and limestone |
| Warm body | Ochre, leather brown, muted vermilion |
| Cool accent | Dull lapis and iron gray |
| Plant accent | Muted olive only where the subject requires it |

Vermilion and lapis are accents, not fills for whole icons. Croatian visual
identity comes from the manuscript palette and historical object choices; a
checkerboard is not repeated across utility icons.

## Three detail tiers

### Map resources

- Rendered at 17–32 px.
- Strongest silhouette and heaviest contour.
- One subject only: quarry, stag, berries, mushrooms, or trout.
- The generated art sits in a parchment medallion supplied by CSS.
- Depletion changes opacity and saturation of the complete marker; it does not
  swap the underlying art.

### Construction and actions

- Rendered at 28–46 px.
- One period tool, structure, or natural emblem.
- The same hammer-and-nail image means both the build category and commit/build
  action. Reuse prevents two visual dialects for one verb.
- Hotkeys stay typographic and outside the painted icon.

### Settlement resources

- Rendered at 26 px.
- May use a pair or small bundle when quantity is part of the meaning.
- Materials distinguish close concepts: full logs vs split firewood, grain
  sheaf vs barley ears vs sprouted malt, flax bundle vs folded cloth.
- Resource value and label remain live text; never bake letters or numbers into
  art.

## Interaction rules

- `hover` and keyboard `focus`: brighten the art slightly and strengthen the
  CSS frame.
- `active`: keep the subject intact and change the surrounding button field.
- `disabled` or `depleted`: lower saturation and opacity.
- Do not encode state with color alone. Shape, frame, opacity, live label, and
  `aria-*` state continue to carry meaning.
- Generated spans are decorative and use `aria-hidden="true"`; the button or
  resource row owns the accessible name.

## Production assets

All shipped atlases are transparent PNGs under
`public/assets/ui/icons/`. Their grid is stable API: CSS background positions
depend on the order below.

| Atlas | Grid order |
| --- | --- |
| `map-resources.png` | stone, game, berries / mushrooms, fish, clay |
| `construction-actions.png` | road, hammer, agriculture / industry, defense, water / town hall, settings, camp |
| `hud-resources-core.png` | timber, stone, firewood / water, food, gold / population, housing, labor |
| `hud-resources-goods-a.png` | grain, barley, malt / flour, ale, preserved food / honey, wine, wool |
| `hud-resources-goods-b.png` | flax, cloth / ironwork, polearms |
| `hud-resources-foods.png` | bread, meat, fish, berries / mushrooms, milk, apples, cherries / vegetables, eggs, grapes, unused / cured meat, smoked fish, cheese, honey |

The generation sources used a flat magenta removal key. Only alpha-matted
atlases ship with the game.

Iron and salt map markers intentionally reuse their dedicated transparent
commodity silhouettes (`materials/iron.png` and `materials/salt.png`) rather
than recoloring the stone cell. The illustrated strategic map has a matching
normal/rich pair for every resource under `public/assets/ui/map-stamps/`.

Build-card illustrations are decorative: the containing button owns the full
accessible name, description, and cost. If a card or inspector illustration
cannot load or decode, the failed bitmap is removed and the labeled hammer or
inspector-symbol fallback remains visible; broken-image chrome is never shown.

## Generation brief

Use `map-resources.png` and the approved Hunter's Hall, Smithy, and Watermill
functional-emblem cards as style references. Ask for bold late-Renaissance
Croatian woodcut pictograms with hand-inked near-black carved contours,
restrained parchment/ochre/vermilion/lapis/iron fills, irregular artisan edges,
period accuracy, strong small-size silhouettes, equal cell weight, and generous
padding. Require a perfectly flat `#ff00ff` background with no shadows,
gradients, frames, medallions, text, scene, watermark, or magenta inside the
subjects. Generate the fixed atlas grid, remove the key to alpha, then validate
the result at its actual in-game size.
