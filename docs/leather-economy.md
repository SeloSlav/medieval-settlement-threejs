# Leather and footwear economy

## Physical chain

`Backyard goats or game nodes → hides → Tannery → leather → Cobbler → shoes → Marketplace → Tier 3+ households`

- Goats retain hides at their animal pen until a connected Marketplace has room. Milk remains their frequent output; meat and hides only arrive on a cull.
- A Hunter's Hall collects one hide alongside each unit of game meat extracted from a game node. Hide collection does not reduce the meat yield.
- A staffed Tannery consumes `3 hides + 2 water + 1 firewood` per cycle and produces `2 leather`.
- A staffed Cobbler consumes `2 leather` per cycle and produces `2 shoes`.
- Free haulers and workshop carts conserve exact commodity identity through Marketplace, Storehouse, Trading Post, reclamation piles, and delivery trips.

## Household role

Shoes are a distinct household provision, not clothing. Tier 1-2 homes do not demand them. Tier 3 and Tier 4 homes keep a six-unit footwear buffer and consume shoes on a slow replacement interval. Promotion from Tier 2 requires a staffed, road-linked Cobbler; an empty depot cannot unlock the tier by itself.

## Trade and storage

Stable commodity codes are `58 hides`, `59 leather`, and `60 shoes`. All three can be gated at Storehouses, imported or exported through Trading Posts, recovered after demolition, and inspected in the settlement resource locator. Hides and leather can therefore bridge a missing local source or processing stage without bypassing physical logistics.

## Visual contract

- Tannery: long low grey-limewashed wet-work shed, deep yard roof, louvered drying loft, bark-liquor vats, hide frames, and typed hide/leather stock props.
- Cobbler: compact ochre-limewashed road workshop, deep work porch, broad window, cutting bench, shoe lasts, letterless boot sign, and typed leather/shoe stock props.
- Both meshes use the shared Gorski material palette, expose deterministic architecture metadata, and change their named stock segments with authoritative inventory.
- Menu and inspector cards live at `public/assets/ui/build-menu/cards/tannery.webp` and `cobbler.webp` as 320×480 generated WebP assets.
