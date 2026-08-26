# Building Card Art Direction

## Functional woodcut emblems

Building cards communicate **what happens at a place**, not what its building
looks like. Each card is a compact action emblem: one dominant period object or
process, supported by one or two attached cues, rendered in the same colored
woodcut language as the illustrated-map resource icons.

This direction supersedes the former architectural survey illustrations. The
3D building lineup remains the source of truth for in-world architecture, but
the cards intentionally use symbolic process art so they remain distinctive at
their actual `122x184` desktop display size.

### Locked visual contract

- Portrait `2:3`, shipped as `320x480` WebP.
- One centered, interlocked functional-emblem cluster filling roughly 68–72%
  of the canvas height. Keep essential details inside the central 82% so the
  inspector and circular category crops remain useful.
- Warm aged parchment continues uninterrupted to all four edges.
- Near-black hand-inked carved contours, deliberate woodcut hatching, flat
  transparent tempera washes, and subtly imperfect artisan registration.
- Small mineral-and-plant pigment palette: parchment ivory, charcoal, dark
  oak, muted ochre, moss olive, dull lapis, and restrained vermilion.
- Strong silhouette and restrained internal detail. The emblem must still read
  when reduced to the build menu's real `122x184` footprint.
- No people, human figures, faces, hands, or arms.
- No building portrait, room, landscape, horizon, or distant settlement.
  Essential functional structures such as a well curb, oven mouth, kiln mouth,
  wall section, devotional image, gate bar, or palisade stakes are allowed.
- No text, letters, numerals, labels, banners, logos, or watermarks.
- No border, frame, rounded panel, medallion, shield-shaped canvas,
  decorative margin, cartouche, vignette, heraldry, or card mockup. The card
  frame belongs to CSS.
- No modern machinery, modern symbols, generic fantasy ornament, or glossy
  app-icon rendering.

### Emblem grammar

1. Start with the verb: cutting, planting, lifting, firing, storing, trading,
   warning, sheltering, praying, or processing.
2. Choose one dominant object that carries the silhouette.
3. Attach at most two supporting cues so the result reads as one cluster, not
   a row of inventory icons.
4. Use material and action to separate neighboring concepts. A frame saw
   cutting a squared log is the Lumber Mill; an axe splitting a round on a
   stump is the Woodcutter. A hoist lifting stone is the Quarry; an ore tub,
   pick, and lamp is the Mine.
5. Do not add architecture merely to fill space. Clean parchment is part of
   the system.

### Shared generation prompt

```text
Use case: style-transfer
Asset type: portrait 2:3 medieval game building card
Input images: approved Hunter's Hall, Smithy, and Watermill functional-emblem
anchors control parchment, composition scale, line weight, simplicity,
saturation, and finish; the colored paper-map resource atlas reinforces the
pigment language
Primary request: create one compact functional emblem for <CARD>. Do not
depict the building. <SUBJECT BRIEF>
Scene/backdrop: uninterrupted warm aged parchment to all four edges, with only
a faint irregular pigment wash immediately beneath the emblem; no scene or
horizon
Style/medium: late-Renaissance Croatian colored woodcut; thick near-black
hand-inked carved contours; deliberate hatching; flat transparent tempera
washes; imperfect artisan registration; bold small-size readability
Composition/framing: vertical 2:3; one centered interlocked emblem cluster
filling 68–72% of the canvas height; generous parchment; essential details
inside the central 82%
Constraints: NO PEOPLE, HANDS, ARMS, OR FACES; no building portrait; no text,
letters, numerals, labels, logos, or watermark; no border, frame, medallion,
decorative margin, or card mockup; exactly one compact functional cluster
Avoid: disconnected inventory icons, architectural illustration, realistic
painting, sepia-only drawing, detailed scenery, fantasy ornament, UI chrome
```

### Active card briefs

| Asset | Functional emblem |
| --- | --- |
| `founders-camp.webp` | Vermilion-pennant pavilion sheltering a heavy locked treasury chest, backed by crossed survey stakes and a rolled map. |
| `residence.webp` | Lit household hearth interlocked with a large iron house key, split firewood, and a folded blanket. |
| `water-well.webp` | Bucket and rope on a timber windlass over a circular limestone curb with visible blue water. |
| `stable.webp` | Horned ox head fitted beneath a heavy timber yoke, with leather harness, iron chain, bell, and a small hay bed. |
| `town-hall.webp` | Open blank ledger, quill, wax seal, civic handbell, and a restrained stack of coins. |
| `market.webp` | Hanging balance scale interlocked with a produce basket, small barrel, and trade coins. |
| `trading-post.webp` | Packed merchant chest and tied cargo bale against a wagon wheel, finished with a sealing stamp. |
| `village-storehouse.webp` | Locked cluster of crate, barrel, and sack with stored timber and stone visible. |
| `granary.webp` | Lidded wooden grain bin, overflowing grain scoop, and tied cereal sheaves. |
| `lumber-mill.webp` | Stout frame saw visibly biting through a horizontal squared log with curled shavings. |
| `reforester.webp` | Rooted young fir sapling with a seed cone, planting dibble, and small protective wattle ring. |
| `stonecutters-camp.webp` | Mining Camp with an open sorting yard, hand tools, and mixed stone, iron, salt, and clay surface stock. |
| `large-quarry.webp` | Timber pulley and windlass lifting a huge pale cut-stone block from a dark circular shaft rim. |
| `iron-mine.webp` | Dark iron ore heaped in a period wooden ore tub with a pick and small oil lamp. |
| `clay-pit.webp` | Layered wet ochre and red clay bank with wooden spade and a small blue puddle. |
| `hunter-hall.webp` | Dressed deer haunch turning on a wooden spit over embers, backed by antlers and a hunting bow. |
| `foragers-hut.webp` | Wicker basket overflowing with mushrooms, berries, and herb bundles plus a small gathering knife. |
| `fishing-camp.webp` | Silver trout caught in a spread net, interlocked with a wicker fish trap and simple hook. |
| `threshing-barn.webp` | Crossed wooden flails striking a tied grain sheaf with a few bold chaff marks. |
| `apiary.webp` | Straw skep with bees, honeycomb, and a small honey jar. |
| `pastoral-farmstead.webp` | Milk pail and butter churn interlocked with a cowbell, wool fleece, and hay tuft. |
| `swineherd.webp` | Sturdy pig or boar head rooting into an acorn-filled wooden trough with oak leaves. |
| `watermill.webp` | Large oak waterwheel driven by a bold lapis water ribbon, with grain sheaf and open flour sack. |
| `windmill.webp` | Four lattice sails turning around a large hub, interlocked with a grain sheaf and flour sack. |
| `bakery.webp` | Round loaves on a long wooden peel emerging from a compact ember-lit masonry oven mouth. |
| `brewery.webp` | Copper brew kettle with steam, mash paddle, barley ears, and foaming wooden tankard. |
| `tavern.webp` | Two interlocked foaming wooden mugs with a loaf and small coin or key beneath. |
| `smokehouse.webp` | Cured meat and smoked fish hanging over smoldering split logs with bold curling smoke. |
| `woodcutters-lodge.webp` | Heavy axe actively splitting a round log on a stump with wedges and stacked firewood. |
| `carpenter.webp` | Wooden hand plane cutting a board with one large curled shaving, backed by a cartwheel and joinery square. |
| `spinning-retting-house.webp` | Large wooden spinning wheel interlocked with a low blue-water retting trough, flax drying rack, and small wool basket; the dry and wet routes must read as one compact process. |
| `weaver.webp` | Broad wooden shuttle crossing taut warp threads, with a Yarn skein and pale Linen hank feeding the loom and a rolled clothing edge emerging. |
| `tannery.webp` | Clean hide stretched on a timber frame, interlocked with a bark-liquor vat, bark strips, and scraper. |
| `cobbler.webp` | Leather boot on a wooden last with awl, thread, and pegs. |
| `charcoal-burner.webp` | Black charcoal in a wicker basket beside a compact smoldering earth clamp and billet ring. |
| `smithy-bloomery.webp` | Massive iron anvil, glowing billet, striking hammer, carved sparks, bellows, and forge flame. |
| `potter-kiln.webp` | Terracotta jug and roof tiles emerging from a compact flaming kiln mouth with a clay coil. |
| `chapel.webp` | Bronze bell, lit candle, simple cross, and prayer book with a blank cover. |
| `monastery.webp` | Prayer beads encircling a bound blank book, loaf, herb bundle, and honey jar. |
| `wayside-shrine.webp` | Small blue-robed Marian devotional image with halo, votive candle, and prayer beads. |
| `dry-stone-wall.webp` | Compact fitted limestone wall section with heavy coping stone and a mason's wooden mallet. |
| `watchtower.webp` | Warning bell interlocked with a flaming signal basket and curved alarm horn. |
| `guardhouse.webp` | Crossed period polearms behind a stout round shield and simple iron helmet. |
| `palisaded-refuge.webp` | Large protective shield and closed oak gate bar sheltering a locked chest, loaf, and folded blanket, backed by a short arc of stakes. |

### Textile identity contract

The Spinning & Retting House card depicts the process, while
`src/buildings/meshes/spinningRettingHouseMesh.ts` owns the in-world
architecture. Its deterministic two-mass workshop combines a dry fibre hall
with a wet lean-to, road-facing spoked wheel, blue retting troughs, flax drying
rack, and scutching bench. Wool, Flax, Yarn, and Linen stock props fill and clear
from authoritative onsite inventory. The adjacent Weaver instead exposes Yarn,
Linen, and finished clothing stock, so the two workshop silhouettes and their
physical handcart transfers remain readable without putting a building portrait
on either card.

The standalone `materials/yarn.png` and `materials/linen.png` icons use the
same carved-contour and restrained-pigment language as the card. In menus, the
Spinning & Retting House flow is Wool/Flax + Water → Yarn/Linen, and the Weaver
flow is Yarn/Linen → Clothing; arrows and resource labels remain UI text rather
than being painted into either illustration.

### Production pipeline

- Generate every distinct card with a separate built-in image-generation call.
- Use the approved `hunter-hall.webp`, `smithy-bloomery.webp`, and
  `watermill.webp` results as the primary style anchors, with
  `public/assets/ui/icons/map-resources.png` as pigment-language support.
- Generate at portrait high resolution, then resize to exactly `320x480`, strip
  metadata, and encode WebP at quality 88.
- Review a labeled contact sheet at both source size and the actual `122x184`
  build-menu footprint. Regenerate ambiguous, architectural, overly detailed,
  person-containing, framed, or duplicate-looking results.
- Preserve existing filenames when replacing a card. New buildings use their
  canonical kebab-case identifier; the textile preparation card therefore ships
  as `spinning-retting-house.webp` for build-menu and inspector mappings.
- Verify with `npm run test:building-art`, `npm run test:build-menus`,
  `npm run test:action-button-iconography`, and `npm run build`.
