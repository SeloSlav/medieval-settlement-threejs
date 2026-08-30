import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT_ROOT = join(ROOT, 'artifacts', 'pbr-material-review', 'patina-candidates');
const MODEL_ID = 'fal-ai/patina/material';
const QUEUE_ENDPOINT = `https://queue.fal.run/${MODEL_ID}`;
const POLL_INTERVAL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 20 * 60 * 1_000;
const REQUIRED_MAPS = ['basecolor', 'normal', 'roughness', 'metalness', 'height'];

const candidates = [
  {
    slug: 'rts-groundcover-meadow-v3',
    label: 'Open meadow groundcover v3',
    source: null,
    seed: 843111,
    promptExpansion: false,
    prompt: [
      'Flat orthographic seamless material of continuous low temperate meadow groundcover in Gorski Kotar, Croatia,',
      'designed specifically for a distant overhead RTS camera. Soft micro-moss cushions and compact tangled leaf flecks',
      'fuse into overlapping rounded organic clumps at 8 to 35 centimeter scale. Use a restrained medium-dark olive and',
      'sage-green palette with subtle cooler and warmer patches, a narrow luminance range, and no bright yellow.',
      'Favor broad cloud-like masses and granular breakup over recognizable individual plants or fine detail.',
      'The whole surface is densely filled, soft, matte, motif-neutral, and uniformly lit.',
      'Nothing elongated, directional, stringy, combed, or woven. No lichen, flowers, rosettes, stones, exposed soil, paths,',
      'directional lighting, cast shadows, perspective, horizon, borders, text, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'rts-groundcover-dense-v2',
    label: 'Dense shaded groundcover v2',
    source: null,
    seed: 843102,
    promptExpansion: false,
    prompt: [
      'Flat orthographic seamless material of lush shaded forest-edge groundcover in Gorski Kotar, Croatia,',
      'designed specifically for a distant overhead RTS camera. Thick velvety moss mats and compact tiny-leaf foliage',
      'merge into dense rounded organic clumps, with layered deep forest green, muted emerald, and olive variation',
      'without crushed blacks. Favor bold cushion-like masses and rich patch breakup over fine individual detail.',
      'Natural matte dielectric terrain with uniform neutral illumination and no dominant feature.',
      'No lines, fibers, filaments, strands, strokes, combed texture, fallen leaves, flowers, stones, exposed soil, paths,',
      'directional lighting, cast shadows, perspective, horizon, borders, text, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'rts-groundcover-dry-v4',
    label: 'Dry late-summer groundcover v4',
    source: null,
    seed: 843113,
    promptExpansion: false,
    prompt: [
      'Flat orthographic seamless material of continuous dry late-summer upland groundcover in Gorski Kotar, Croatia,',
      'designed specifically for a distant overhead RTS camera. Sun-faded compact moss cushions, tiny crumbled leaf matter,',
      'and dense low organic mats merge into overlapping rounded clumps at 8 to 35 centimeter scale. Use restrained dusty',
      'sage, muted olive, warm ochre, and straw-beige patches with a narrow natural luminance range and no pale highlights.',
      'Favor broad mottled masses and granular breakup over recognizable individual plants or fine detail.',
      'The whole surface is densely filled, dry, matte, motif-neutral, and uniformly lit.',
      'Nothing elongated, directional, stringy, combed, bundled, or woven. No hay, twigs, flowers, stones, exposed soil holes,',
      'paths, directional lighting, cast shadows, perspective, horizon, borders, text, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'forest-leaf-litter-primary',
    label: 'Primary forest leaf litter',
    source: null,
    seed: 431024,
    prompt: [
      'Flat top-down seamless temperate mountain forest-floor material from Gorski Kotar, Croatia.',
      'Overlapping dry beech, oak, and hornbeam leaf litter with recognizable but irregular broken leaves,',
      'random orientations, sparse hair-thin twigs, curled leaf edges, and dark brown humus visible between them,',
      'restrained ochre russet and deep earthy brown palette, physical features at 2 to 10 centimeter scale,',
      'matte dry dielectric surface for close-view game terrain.',
      'No living plants, mushrooms, pinecones, large branches, rocks, footprints, tire marks, woven or stamped patterns,',
      'directional lighting, cast shadows, perspective, horizon, borders, text, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'forest-leaf-litter-secondary',
    label: 'Fine decomposed forest litter',
    source: null,
    seed: 431025,
    prompt: [
      'Flat top-down seamless mature temperate forest-floor material from Gorski Kotar, Croatia.',
      'Fine decomposed beech leaf fragments and crumbly dark humus with a few intact small leaves,',
      'sparse slender fir needles and tiny twigs, random orientations, motif-neutral granular organic structure,',
      'muted umber chestnut and dark soil palette, physical features at 0.5 to 6 centimeter scale,',
      'matte dry dielectric surface designed as a stochastic companion to coarser leaf litter.',
      'No living plants, mushrooms, pinecones, large branches, rocks, footprints, tire marks, woven or stamped patterns,',
      'directional lighting, cast shadows, perspective, horizon, borders, text, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'medieval-dirt-road',
    label: 'Medieval compacted dirt road',
    source: 'public/assets/textures/roads/medieval_dirt/albedo.png',
    seed: 431026,
    strength: 0.55,
    prompt: [
      'Flat top-down seamless material of a compacted medieval rural dirt-road surface in Gorski Kotar, Croatia.',
      'Cool grey-brown and restrained ochre fine earth with embedded pea-sized gravel, tiny angular stones,',
      'subtle irregular compression and crumbly soil variation at millimeter to 4 centimeter scale,',
      'dry matte dielectric ground that can be tinted and weathered by a game shader.',
      'No road edges, wheel ruts, parallel tracks, puddles, mud gloss, grass clumps, footprints, large stones,',
      'directional lighting, cast shadows, perspective, horizon, borders, text, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'cultivated-garden-soil',
    label: 'Cultivated garden-bed soil',
    source: null,
    seed: 431027,
    prompt: [
      'Flat top-down seamless material of dark cultivated garden-bed soil in a cool Croatian mountain climate.',
      'Small irregular crumbly earth clods, fine organic matter, subtle moist dark-brown variation,',
      'a few tiny natural mineral grains, dense worked-soil structure at 2 millimeter to 4 centimeter scale,',
      'rough non-metallic ground suitable beneath close-view medieval kitchen-garden plants.',
      'No crop rows, furrows, roots, vegetables, leaves, seedlings, weeds, worms, tools, footprints, large stones,',
      'directional lighting, cast shadows, perspective, horizon, borders, text, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'field-soil-fresh-ploughed-v1',
    label: 'Freshly ploughed field soil',
    source: null,
    seed: 532101,
    promptExpansion: false,
    prompt: [
      'Flat top-down seamless PBR material of freshly ploughed mountain loam in inland Croatia around 1550.',
      'Deep umber and cool brown earth with irregular overturned clods from 1 to 9 centimeters, torn crumb faces,',
      'fine dark humus, sparse tiny mineral grains, and restrained moist patina in protected cavities.',
      'The material is rough and non-metallic; geometry in the game owns the large furrows and plough direction,',
      'so this tile must remain isotropic and motif-neutral under uniform neutral illumination.',
      'No furrow lines, parallel rows, grass, roots, crops, straw, leaves, footprints, stones larger than 2 centimeters,',
      'mud gloss, puddles, dramatic cracks, cast shadows, perspective, horizon, borders, text, or repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'field-soil-fine-seedbed-v1',
    label: 'Harrowed and sown seedbed soil',
    source: null,
    seed: 532102,
    promptExpansion: false,
    prompt: [
      'Flat top-down seamless PBR material of a freshly harrowed medieval seedbed in inland Croatia.',
      'Fine settled brown loam, small irregular crumbs from 2 millimeters to 2 centimeters, softly compressed clods,',
      'subtle dry dust between aggregates, faint organic flecks, and a restrained weathered farm-soil patina.',
      'The game geometry owns seed drills and row direction; keep the tile isotropic, matte, non-metallic, evenly lit,',
      'and free of dominant shapes so it can repeat across a large agricultural parcel.',
      'No rake lines, furrows, rows, visible seeds, sprouts, roots, grass, straw, footprints, wheel marks, large stones,',
      'puddles, deep cracks, directional lighting, cast shadows, perspective, borders, text, or repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'field-soil-weathered-fallow-v1',
    label: 'Weathered fallow field soil',
    source: null,
    seed: 532103,
    promptExpansion: false,
    prompt: [
      'Flat top-down seamless PBR material of weathered fallow agricultural soil in a cool Croatian mountain climate.',
      'Settled grey-brown and muted umber loam, softened old clods, fine humus, sparse decomposed pale straw fragments,',
      'minute dry leaf flecks, faint green-grey biological patina in a few shallow cavities, and modest mineral grit.',
      'The living volunteer cover is separate game geometry, so the soil tile remains mostly bare, rough, non-metallic,',
      'isotropic, motif-neutral, and evenly illuminated for large-scale repetition.',
      'No standing plants, grass blades, flowers, seedlings, crop rows, long straw stems, footprints, wheel tracks,',
      'large stones, puddles, deep polygonal cracks, cast shadows, perspective, borders, text, or repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'field-soil-dry-harvested-v1',
    label: 'Dry harvested field soil',
    source: null,
    seed: 532104,
    promptExpansion: false,
    prompt: [
      'Flat top-down seamless PBR material of a late-summer harvested cereal field surface in inland Croatia.',
      'Dry dusty warm brown loam with flattened small clods, pale chaff specks, tiny randomly oriented broken straw',
      'splinters under 4 centimeters, subtle compressed patches, and restrained sun-aged earthy patina.',
      'Cut stubble is separate game geometry; this tile must be isotropic, rough, non-metallic, uniformly lit, and',
      'motif-neutral so it can repeat below a ragged harvest front.',
      'No upright stalks, hay piles, crop rows, long fibers, footprints, wheel ruts, grass, leaves, large stones, puddles,',
      'deep cracks, directional lighting, cast shadows, perspective, borders, text, or repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'field-soil-dry-harvested-v2',
    label: 'Dry harvested field soil v2',
    source: null,
    seed: 532114,
    promptExpansion: false,
    prompt: [
      'Flat top-down seamless PBR micro-material of bare late-summer harvested field soil in inland Croatia.',
      'Dry dusty muted warm-brown loam, flattened crumbs from 2 millimeters to 3 centimeters, slight compacted patches,',
      'and only tiny pulverized pale chaff specks shorter than 4 millimeters scattered without direction.',
      'All standing stubble, cut stems, rows, and harvest structure are separate game geometry; the bitmap must show',
      'continuous bare isotropic soil, rough non-metallic response, uniform neutral illumination, and no dominant motif.',
      'Absolutely no upright stalks, stubble, straw fibers, straw lines, hay, crop rows, bands, footprints, wheel ruts,',
      'grass, leaves, large stones, puddles, cracks, directional light, cast shadows, perspective, borders, or text.',
    ].join(' '),
  },
  {
    slug: 'field-soil-dry-harvested-v3',
    label: 'Dry harvested field soil v3',
    source: 'artifacts/pbr-material-review/patina-candidates/field-soil-fine-seedbed-v1/basecolor.png',
    seed: 532124,
    strength: 0.38,
    promptExpansion: false,
    prompt: [
      'Preserve this seamless isotropic fine-soil structure while changing it into dry late-summer harvested-field earth.',
      'Use muted warm brown loam, slightly flattened fine crumbs, dusty compacted patches, and sparse pale chaff dust',
      'that reads only as tiny sub-centimeter speckles, never as recognizable straw or fibers.',
      'Keep the surface continuous, bare, rough, non-metallic, neutrally illuminated, directionless, and motif-neutral.',
      'Absolutely no tracks, tread marks, footprints, wheel ruts, lines, rows, bands, upright stalks, stubble, straw stems,',
      'hay, grass, leaves, large stones, puddles, cracks, cast shadows, perspective, borders, or text.',
    ].join(' '),
  },
  {
    slug: 'mossy-karst-rock',
    label: 'Forest mossy karst rock surface',
    source: null,
    seed: 431028,
    prompt: [
      'Flat orthographic seamless material of weathered pale grey-beige karst limestone from Gorski Kotar, Croatia.',
      'Fine porous mineral grain, shallow irregular pits and hairline mineral fissures, softened weathered edges,',
      'restrained scattered low dark-olive moss and faint lichen patches covering roughly fifteen percent of the surface,',
      'natural rough non-metallic stone detail at 1 millimeter to 12 centimeter scale for game rocks and boulders.',
      'No separate stones, pebbles, gravel bed, soil, leaves, plants, thick moss carpet, dramatic cracks, wet gloss,',
      'directional lighting, cast shadows, perspective, horizon, borders, text, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'clean-river-stone',
    label: 'Clean water-worn river stone surface',
    source: null,
    seed: 431029,
    prompt: [
      'Flat orthographic seamless material of clean water-worn karst limestone from a Croatian mountain river.',
      'Pale cool grey and warm grey-beige mineral color, fine dense stone grain, softly rounded shallow pitting,',
      'subtle smoothed abrasion and faint mineral staining at 1 millimeter to 10 centimeter scale,',
      'natural rough non-metallic boulder surface that remains readable when a game shader adds water wetness.',
      'No moss, lichen, algae, soil, leaves, separate pebbles, gravel bed, shells, dramatic cracks, wet gloss,',
      'directional lighting, cast shadows, perspective, horizon, borders, text, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'clean-quarry-limestone',
    label: 'Clean freshly fractured quarry limestone',
    source: null,
    seed: 431030,
    prompt: [
      'Flat orthographic seamless material of clean freshly fractured karst limestone from a Croatian quarry.',
      'Pale neutral grey-beige mineral body, crisp fine crystalline grain, small angular fracture steps,',
      'subtle calcite veins and fresh chalky break variation at 1 millimeter to 8 centimeter scale,',
      'dry rough non-metallic stone for deliberately placed harvestable quarry boulders and exposed faces.',
      'No moss, lichen, algae, soil, leaves, separate rocks, gravel bed, ore crystals, tool marks, wet gloss,',
      'directional lighting, cast shadows, perspective, horizon, borders, text, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'forest-mossy-karst-rock-v2',
    label: 'Forest mossy karst rock surface v2',
    source: null,
    seed: 431031,
    prompt: [
      'Flat orthographic seamless material of weathered grey-beige karst limestone in a damp shaded Gorski Kotar forest.',
      'Fine porous mineral grain and shallow weathered pits remain visible between clearly readable irregular moss patches.',
      'Low velvety dark-olive and forest-green moss cushions form branching organic islands over roughly thirty-five percent',
      'of the stone, with subtle pale lichen speckles and natural rough non-metallic response at 1 millimeter to 10 centimeter scale.',
      'Moss must be visibly green and patchy but thin enough to preserve stone identity.',
      'No soil, leaves, plants, roots, separate stones, gravel, thick continuous moss carpet, dramatic cracks, wet gloss,',
      'directional lighting, cast shadows, perspective, horizon, borders, text, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'clean-quarry-limestone-v2',
    label: 'Clean freshly fractured quarry limestone v2',
    source: null,
    seed: 431032,
    prompt: [
      'Flat orthographic seamless micro-material of clean freshly broken Gorski Kotar limestone from a working quarry.',
      'Warm pale grey-beige dense limestone, fine chalky crystalline grain, tiny angular chips, powdery break variation,',
      'and sparse subtle calcite flecks at 1 millimeter to 4 centimeter scale; dry rough non-metallic stone.',
      'The mesh geometry will own large fracture planes, cracks, edges, and silhouette, so keep this texture motif-neutral.',
      'No long veins, marble pattern, branching white cracks, large facets, moss, lichen, algae, soil, leaves, gravel, ore,',
      'tool marks, wet gloss, directional lighting, cast shadows, perspective, horizon, borders, text, or repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'forest-mossy-karst-rock-v3',
    label: 'Forest mossy karst rock surface v3',
    source: null,
    seed: 431033,
    prompt: [
      'Flat orthographic seamless material of weathered grey-beige karst limestone in a damp shaded Gorski Kotar forest.',
      'Fine porous stone and shallow weathered pits remain visible between low velvety dark-olive moss mats.',
      'Moss forms a few connected asymmetrical branching islands with feathery torn organic boundaries,',
      'covering roughly twenty-five percent of the stone, plus very sparse subtle pale lichen grain.',
      'The green moss is clearly readable but thin and irregular, with material detail at 1 millimeter to 12 centimeter scale.',
      'No round moss spots, circular colonies, dots, polka-dot pattern, bubbles, soil, leaves, roots, separate stones, gravel,',
      'thick continuous carpet, dramatic cracks, wet gloss, directional lighting, shadows, perspective, borders, text, or motifs.',
    ].join(' '),
  },
  {
    slug: 'manor-grass-dry-v2',
    label: 'Dry late-summer grass v2',
    source: 'public/assets/textures/terrain/manor_grass_dry/albedo.png',
    seed: 431034,
    strength: 0.35,
    prompt: [
      'Flat top-down seamless material of very short late-summer upland meadow turf in Gorski Kotar, Croatia.',
      'Dense ground-hugging brittle cropped blades and tiny broken thatch fragments from 0.5 to 3 centimeters long,',
      'mixed with sparse short muted sage-green grass, restrained straw beige olive and dusty green variation,',
      'fine isotropic matte dry dielectric detail suitable for medieval game terrain.',
      'No long continuous fibers, hair-like strands, loops, scribbles, hay mat, twigs, cut rows, flowers, stones, bare holes,',
      'paths, footprints, standing stalks, directional lighting, shadows, perspective, borders, text, or repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'building-lime-plaster',
    label: 'Hand-trowelled lime plaster',
    seed: 732001,
    prompt: [
      'Flat orthographic seamless medieval hand-trowelled lime plaster material from inland Croatia around 1550.',
      'Warm pale limestone-white limewash, fine sand aggregate, shallow overlapping trowel sweeps, tiny pores,',
      'restrained hairline age crazing and softly mottled mineral variation at 1 millimeter to 20 centimeter scale.',
      'Dry rough non-metallic wall surface, evenly lit and neutral enough for game-material tinting.',
      'No bricks, exposed stones, timber, ivy, moss, dirt bands, painted motifs, hard directional light, cast shadows,',
      'perspective, borders, labels, text, focal damage, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'building-limestone-ashlar',
    label: 'Limestone ashlar masonry',
    seed: 732002,
    prompt: [
      'Flat orthographic seamless wall material of hand-dressed pale karst limestone ashlar in inland Croatia around 1550.',
      'Irregular rectangular blocks from 20 to 55 centimeters wide, shallow recessed lime-mortar joints, chipped arrises,',
      'fine chalky pores, restrained warm grey-beige stone variation, sober church and civic masonry.',
      'Dry rough non-metallic surface under uniform neutral illumination.',
      'No modern saw cuts, repeating brick grid, huge cracks, carved ornament, moss carpet, ivy, soot, perspective,',
      'cast shadows, borders, text, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'building-fieldstone-mortar',
    label: 'Fieldstone and lime mortar wall',
    seed: 732003,
    prompt: [
      'Flat orthographic seamless medieval fieldstone wall material from Gorski Kotar around 1550.',
      'Closely fitted irregular fist-sized limestone pieces in broad pale lime mortar, mixed cool grey and warm beige stones,',
      'weather-softened faces, shallow joints and modest chips at 2 to 35 centimeter scale.',
      'Dry rough non-metallic foundation, well, enclosure, and humble church wall surface with uniform neutral illumination.',
      'No regular brick courses, large boulders, deep black gaps, ivy, heavy moss, ground plane, perspective, shadows,',
      'borders, text, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'building-quarry-stone',
    label: 'Rough quarry stone blocks',
    seed: 732004,
    prompt: [
      'Flat orthographic seamless material of roughly squared freshly quarried karst limestone blocks.',
      'Pale neutral grey-beige mineral body, broad hand-split faces, small angular chips, chalky dust, subtle calcite flecks,',
      'irregular block seams and tool-softened edges at 2 to 45 centimeter scale.',
      'Dry rough non-metallic construction stone for foundations, steps, wells, churches, quarries, and stockpiles.',
      'No marble veining, polished slabs, moss, soil, leaves, giant fractures, perspective, shadows, borders, text, or motifs.',
    ].join(' '),
  },
  {
    slug: 'building-rough-hewn-timber',
    label: 'Rough-hewn structural timber',
    seed: 732005,
    prompt: [
      'Flat orthographic seamless material of hand-hewn oak structural timber in Croatia around 1550.',
      'Long grain running vertically, shallow adze scallops, tight growth lines, occasional small knots and restrained splits,',
      'warm medium brown heartwood with natural lighter sap streaks at millimeter to meter scale.',
      'Dry rough non-metallic surface for beams, posts, fences, rails, benches, carts, handles, logs, and stacked timber.',
      'No separate boards, plank joints, bark sheets, cut log ends, nails, paint, deep black cracks, perspective, shadows,',
      'borders, text, or obvious repeated knot pattern.',
    ].join(' '),
  },
  {
    slug: 'building-sawn-planks',
    label: 'Sawn oak planks',
    seed: 732006,
    prompt: [
      'Flat orthographic seamless medieval sawn oak plank surface with boards running vertically.',
      'Boards 18 to 32 centimeters wide, narrow dark joints, restrained alternating grain, small knots, saw texture,',
      'slightly uneven edges and warm honey-brown variation suitable for doors, floors, tables, barrels, buckets, and wall boards.',
      'Dry rough non-metallic wood under uniform neutral illumination.',
      'No modern tongue-and-groove, glossy varnish, nails in a rigid grid, cut log ends, perspective, cast shadows,',
      'borders, text, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'building-weathered-planks',
    label: 'Weathered exterior planks',
    seed: 732007,
    prompt: [
      'Flat orthographic seamless surface of weathered medieval exterior oak planks with boards running vertically.',
      'Sun-greyed silver-brown grain, washed warm undertones, softened splinters, shallow checks, small knots,',
      'subtle moisture staining and uneven board edges at 1 millimeter to 35 centimeter scale.',
      'Dry rough non-metallic wood for sheds, porches, fences, well buckets, stockpiles, and outdoor props.',
      'No peeling modern paint, green pressure treatment, metal fasteners in a pattern, rot holes, perspective, shadows,',
      'borders, text, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'building-stacked-log-wall',
    label: 'Stacked timber wall',
    seed: 732008,
    prompt: [
      'Flat orthographic seamless medieval stacked-log wall material in inland Croatia.',
      'Horizontal courses of hand-peeled oak and fir logs 18 to 28 centimeters thick, irregular hewn faces, long grain,',
      'occasional knots, narrow moss-free clay-and-fiber chinking, naturally staggered course diameters and warm brown variation.',
      'Dry rough non-metallic wall surface for log sheds, timber stacks, palisades, and rustic outbuildings.',
      'No round cut ends facing camera, cabin corner notches, modern milled logs, deep black gaps, ivy, perspective, shadows,',
      'borders, text, or obvious repeating course sequence.',
    ].join(' '),
  },
  {
    slug: 'building-wicker-weave',
    label: 'Wattle and wicker weave',
    seed: 732009,
    prompt: [
      'Flat orthographic seamless medieval hazel wattle and wicker weave material.',
      'Slim flexible rods woven horizontally over irregular vertical stakes, tight practical weave, peeled tan and bark-brown rods,',
      'subtle fiber fuzz, small bends and restrained age variation at 3 millimeter to 12 centimeter scale.',
      'Dry rough non-metallic surface for baskets, fish traps, hurdles, fences, and infill panels.',
      'No basket silhouette, handles, holes, loose ends, cloth weave, modern rattan furniture, perspective, cast shadows,',
      'borders, text, or obvious repeating checker pattern.',
    ].join(' '),
  },
  {
    slug: 'building-split-shingles',
    label: 'Split wooden roof shingles',
    seed: 732010,
    prompt: [
      'Flat orthographic seamless medieval split-oak roof-shingle material viewed square to the roof plane.',
      'Short overlapping shingle courses, irregular 20 to 40 centimeter widths, staggered butt joints, hand-split vertical grain,',
      'slightly uneven lower edges, restrained silver-brown weathering and shallow course relief.',
      'Dry rough non-metallic roof surface under uniform neutral illumination.',
      'No broad modern boards, asphalt shingles, nails in a rigid grid, moss carpet, leaves, roof ridge, perspective, shadows,',
      'borders, text, or obvious repeating rows.',
    ].join(' '),
  },
  {
    slug: 'building-clay-roof-tiles',
    label: 'Handmade clay roof tiles',
    seed: 732011,
    prompt: [
      'Flat orthographic seamless medieval handmade fired-clay roof-tile material from inland Croatia around 1550.',
      'Overlapping rows of small uneven reddish terracotta tiles, gently rounded lower edges, shallow lime dust,',
      'subtle firing variation from muted brick red to warm sienna, hairline chips and convincing course relief.',
      'Dry mostly rough ceramic roof surface under uniform neutral illumination.',
      'No modern interlocking tiles, glossy glaze, black mold, moss carpet, broken holes, roof ridge, perspective, shadows,',
      'borders, text, or obvious repeating rows.',
    ].join(' '),
  },
  {
    slug: 'building-thatch-roof',
    label: 'Bundled reed thatch roof',
    seed: 732012,
    prompt: [
      'Flat orthographic seamless medieval bundled reed-thatch roof material viewed square to the slope.',
      'Dense short straw and reed fibers running vertically down slope, overlapping tied courses, broken fiber tips,',
      'weathered grey-straw and muted ochre variation, subtle bundle ridges at 2 millimeter to 30 centimeter scale.',
      'Very rough dry non-metallic roof surface under uniform neutral illumination.',
      'No loose hay pile, woven mat, long looping hairs, green grass, flowers, roof ridge, perspective, cast shadows,',
      'borders, text, or obvious repeated bands.',
    ].join(' '),
  },
  {
    slug: 'building-slate-roof',
    label: 'Hand-split slate roof',
    seed: 732013,
    prompt: [
      'Flat orthographic seamless medieval hand-split slate roof material from a mountain settlement.',
      'Overlapping irregular small slate plates, staggered courses, chipped hand-cut edges, fine layered mineral grain,',
      'muted charcoal-grey, blue-grey, and warm weathered variation with shallow readable relief.',
      'Dry rough non-metallic roof under uniform neutral illumination.',
      'No modern uniform rectangles, shiny wet reflections, snow, moss carpet, roof ridge, perspective, cast shadows,',
      'borders, text, or obvious repeating rows.',
    ].join(' '),
  },
  {
    slug: 'building-packed-earth',
    label: 'Packed workshop earth',
    seed: 732014,
    prompt: [
      'Flat top-down seamless medieval packed-earth floor and daub material from inland Croatia.',
      'Dense cool brown clay soil, fine straw fibers, compacted shallow scuffs, tiny gravel grains, subtle dry crumb texture,',
      'muted umber and grey-ochre variation at 1 millimeter to 8 centimeter scale.',
      'Dry rough non-metallic surface for workshop floors, clay infill, hearth surrounds, and construction props.',
      'No footprints, wheel ruts, puddles, grass, leaves, large stones, deep cracks, perspective, shadows, borders, text, or motifs.',
    ].join(' '),
  },
  {
    slug: 'building-linen-canvas',
    label: 'Heavy linen canvas',
    seed: 732015,
    prompt: [
      'Flat orthographic seamless medieval heavy linen and hemp canvas material.',
      'Coarse plain weave with irregular hand-spun thread thickness, tiny slubs, subtle creases, patched fiber variation,',
      'natural warm oatmeal-beige color and restrained weathering at sub-millimeter to 8 centimeter scale.',
      'Dry rough non-metallic cloth for tents, awnings, sacks, banners, and work covers under uniform neutral illumination.',
      'No folds casting large shadows, seams, embroidery, symbols, stains forming focal marks, perspective, borders, text, or motifs.',
    ].join(' '),
  },
  {
    slug: 'building-wrought-iron',
    label: 'Hand-forged wrought iron',
    seed: 732016,
    prompt: [
      'Flat orthographic seamless hand-forged wrought-iron material from a medieval Croatian settlement.',
      'Dense charcoal-black iron, subtle hammer scale, shallow forging dimples, fine linear slag grain, worn grey highlights,',
      'and extremely restrained reddish oxidation in recesses at 1 millimeter to 8 centimeter scale.',
      'Mostly metallic moderately rough surface for straps, tools, hinges, hoops, grates, nails, and fittings.',
      'No perforations, separate objects, heavy orange rust, polished chrome, reflections of a room, perspective, shadows,',
      'borders, text, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'building-aged-brass',
    label: 'Hammered aged brass',
    seed: 732017,
    prompt: [
      'Flat orthographic seamless hand-hammered aged brass material for a medieval church bell and civic fittings.',
      'Warm muted golden brass, fine hammer dimples, shallow casting waviness, rubbed brighter high points,',
      'restrained brown oxidation and tiny dark verdigris traces in recesses at 1 millimeter to 8 centimeter scale.',
      'Metallic moderately rough surface under uniform neutral illumination.',
      'No bell silhouette, engraving, letters, green patina carpet, mirror polish, modern brushed sheet, perspective, shadows,',
      'borders, text, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'building-fired-clay',
    label: 'Unglazed fired clay',
    seed: 732018,
    prompt: [
      'Flat orthographic seamless medieval unglazed fired-clay material.',
      'Fine porous terracotta body, subtle hand-smoothed arcs, tiny grit inclusions, small firing freckles,',
      'restrained warm red-orange, sienna, and dusty buff variation at 1 millimeter to 10 centimeter scale.',
      'Dry rough non-metallic ceramic for pots, kiln pieces, chimney caps, and clay construction details.',
      'No separate pottery objects, glaze, painted decoration, bricks, deep cracks, perspective, shadows, borders, text, or motifs.',
    ].join(' '),
  },
  {
    slug: 'building-mossy-surface',
    label: 'Thin roof and wall moss',
    seed: 732019,
    prompt: [
      'Flat orthographic seamless thin moss material for weathered medieval roofs and masonry in Gorski Kotar.',
      'Low velvety dark-olive and muted forest-green moss cushions, fine branching edges, tiny sporophyte flecks,',
      'subtle brown dead patches and dense micro-fiber detail without visible underlying soil.',
      'Very rough non-metallic organic covering under uniform neutral illumination.',
      'No stones, bark, leaves, flowers, long grass blades, round polka-dot colonies, thick lumpy carpet, perspective, shadows,',
      'borders, text, or obvious repeating motifs.',
    ].join(' '),
  },
  {
    slug: 'building-turf-roof',
    label: 'Short turf roof',
    seed: 732020,
    prompt: [
      'Flat top-down seamless medieval turf-roof material from a cool Croatian mountain climate.',
      'Dense very short rough grass, muted olive and sage blades, low moss between blades, fine dry thatch,',
      'subtle dark organic root mat visible in tiny gaps, evenly distributed detail at 2 millimeter to 8 centimeter scale.',
      'Rough non-metallic living roof covering under uniform neutral illumination.',
      'No flowers, broad leaves, stones, bare soil patches, long stalks, cut rows, perspective, cast shadows, borders, text, or motifs.',
    ].join(' '),
  },
];

function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

async function loadCredentials() {
  const localEnv = parseEnv(await readFile(join(ROOT, '.env.local'), 'utf8'));
  const credentials = process.env.FAL_API_KEY
    || process.env.FAL_KEY
    || localEnv.FAL_API_KEY
    || localEnv.FAL_KEY;
  if (!credentials) {
    throw new Error('Missing FAL_API_KEY (or FAL_KEY) in the environment or .env.local.');
  }
  return credentials;
}

function mimeTypeFor(path) {
  switch (extname(path).toLowerCase()) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    default: return 'image/png';
  }
}

async function sourceDataUri(relativePath) {
  const bytes = await readFile(join(ROOT, relativePath));
  return `data:${mimeTypeFor(relativePath)};base64,${bytes.toString('base64')}`;
}

async function falFetch(url, credentials, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: `Key ${credentials}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const bodyText = await response.text();
  let body;
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    body = { raw: bodyText };
  }
  if (!response.ok) {
    throw new Error(`fal request failed (${response.status} ${response.statusText}): ${JSON.stringify(body)}`);
  }
  return body;
}

async function submit(candidate, credentials) {
  const input = {
    prompt: candidate.prompt,
    image_size: 'square_hd',
    num_inference_steps: 8,
    seed: candidate.seed,
    num_images: 1,
    enable_prompt_expansion: candidate.promptExpansion ?? true,
    enable_safety_checker: true,
    tiling_mode: 'both',
    tile_size: 128,
    tile_stride: 64,
    maps: REQUIRED_MAPS,
    upscale_factor: 0,
    output_format: 'png',
  };
  if (candidate.source) {
    input.image_url = await sourceDataUri(candidate.source);
    input.strength = candidate.strength;
  }
  const response = await falFetch(QUEUE_ENDPOINT, credentials, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return { response, input };
}

async function waitForResult(candidate, submission, credentials) {
  const startedAt = Date.now();
  let lastStatus = '';
  while (Date.now() - startedAt < REQUEST_TIMEOUT_MS) {
    const status = await falFetch(`${submission.status_url}?logs=1`, credentials);
    if (status.status !== lastStatus) {
      console.log(`[${candidate.slug}] ${status.status}`);
      lastStatus = status.status;
    }
    if (status.status === 'COMPLETED') {
      if (status.error || status.error_type) {
        throw new Error(`[${candidate.slug}] ${status.error_type ?? 'fal error'}: ${status.error ?? 'unknown error'}`);
      }
      const result = await falFetch(submission.response_url, credentials);
      if (result.error || result.error_type) {
        throw new Error(`[${candidate.slug}] ${result.error_type ?? 'fal error'}: ${result.error ?? 'unknown error'}`);
      }
      return result;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, POLL_INTERVAL_MS));
  }
  throw new Error(`[${candidate.slug}] timed out after ${REQUEST_TIMEOUT_MS / 60_000} minutes`);
}

async function downloadFile(url, outputPath) {
  try {
    await access(outputPath);
    return;
  } catch {
    // Missing candidate output: download it below.
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`download failed (${response.status} ${response.statusText}): ${url}`);
  }
  await writeFile(outputPath, Buffer.from(await response.arrayBuffer()), { flag: 'wx' });
}

async function saveResult(candidate, requestInput, submission, result) {
  const candidateRoot = join(OUTPUT_ROOT, candidate.slug);
  await mkdir(candidateRoot, { recursive: true });
  const safeInput = { ...requestInput };
  if (safeInput.image_url) safeInput.image_url = `[data URI from ${candidate.source}]`;
  const metadata = {
    model: MODEL_ID,
    label: candidate.label,
    source: candidate.source,
    requestId: submission.request_id,
    requestedInput: safeInput,
    returnedSeed: result.seed,
    returnedPrompt: result.prompt,
    timings: result.timings,
    images: result.images,
    generatedAt: new Date().toISOString(),
  };
  let previewIndex = 0;
  for (const image of result.images ?? []) {
    const name = image.map_type ?? `generated-preview-${++previewIndex}`;
    const extension = image.content_type === 'image/jpeg' ? '.jpg'
      : image.content_type === 'image/webp' ? '.webp'
        : '.png';
    await downloadFile(image.url, join(candidateRoot, `${name}${extension}`));
  }
  const returnedMaps = new Set((result.images ?? []).map((image) => image.map_type).filter(Boolean));
  const missing = REQUIRED_MAPS.filter((map) => !returnedMaps.has(map));
  if (missing.length > 0) {
    throw new Error(`[${candidate.slug}] missing returned maps: ${missing.join(', ')}`);
  }
  await writeFile(
    join(candidateRoot, 'generation.json'),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
}

async function candidateComplete(candidate) {
  try {
    const metadata = JSON.parse(await readFile(
      join(OUTPUT_ROOT, candidate.slug, 'generation.json'),
      'utf8',
    ));
    const hasMetadata = REQUIRED_MAPS.every(
      (map) => metadata.images?.some((image) => image.map_type === map),
    );
    if (!hasMetadata) return false;
    await Promise.all(REQUIRED_MAPS.map((map) => access(
      join(OUTPUT_ROOT, candidate.slug, `${map}.png`),
    )));
    return true;
  } catch {
    return false;
  }
}

async function runCandidate(candidate, credentials) {
  if (await candidateComplete(candidate)) {
    console.log(`[${candidate.slug}] already complete; skipping`);
    return;
  }
  console.log(`[${candidate.slug}] submitting`);
  const { response: submission, input } = await submit(candidate, credentials);
  console.log(`[${candidate.slug}] queued as ${submission.request_id}`);
  const result = await waitForResult(candidate, submission, credentials);
  await saveResult(candidate, input, submission, result);
  console.log(`[${candidate.slug}] saved`);
}

async function main() {
  const onlyArgument = process.argv.find((argument) => argument.startsWith('--only='));
  const selectedSlugs = onlyArgument
    ? new Set(onlyArgument.slice('--only='.length).split(',').filter(Boolean))
    : null;
  const selected = selectedSlugs
    ? candidates.filter((candidate) => selectedSlugs.has(candidate.slug))
    : candidates;
  if (selected.length === 0) throw new Error('No matching candidates selected.');
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const credentials = await loadCredentials();
  const queue = [...selected];
  const workerCount = Math.min(3, queue.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length > 0) {
      const candidate = queue.shift();
      await runCandidate(candidate, credentials);
    }
  });
  await Promise.all(workers);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
