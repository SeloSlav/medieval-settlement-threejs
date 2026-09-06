import type { BuildingKind } from '../../resources/types.ts';

export const PROCEDURAL_ARCHITECTURE_VERSION = 'gorski-1550-procedural-v1';

export type ProceduralArchitectureFamily =
  | 'founding-site'
  | 'forestry'
  | 'extraction'
  | 'craft'
  | 'service'
  | 'religious'
  | 'commerce'
  | 'civic'
  | 'defensive'
  | 'agricultural'
  | 'food-processing'
  | 'textile'
  | 'livestock';

export type ProceduralRoofForm =
  | 'none'
  | 'canvas-fly'
  | 'open-workyard'
  | 'steep-gable'
  | 'cross-gable'
  | 'hipped'
  | 'lean-to'
  | 'tower-cap'
  | 'spire'
  | 'industrial-hood';

export type ProceduralMaterialRole =
  | 'packed-earth'
  | 'fieldstone'
  | 'limestone-ashlar'
  | 'lime-plaster'
  | 'rough-timber'
  | 'weathered-boards'
  | 'stacked-logs'
  | 'split-shingles'
  | 'clay-tiles'
  | 'slate'
  | 'linen-canvas'
  | 'stitched-hide'
  | 'wicker'
  | 'wrought-iron';

export type ProceduralBuildingCatalogEntry = {
  readonly family: ProceduralArchitectureFamily;
  readonly status: 'site' | 'small' | 'standard' | 'major' | 'landmark';
  readonly roof: ProceduralRoofForm;
  readonly massing: readonly string[];
  readonly modules: readonly string[];
  readonly materials: readonly ProceduralMaterialRole[];
  readonly dynamicSlots: readonly string[];
  readonly triangleTarget: number;
  readonly triangleCeiling: number;
  readonly drawCallTarget: number;
  readonly historicalNote: string;
};

export type ProceduralBuildingPlan = ProceduralBuildingCatalogEntry & {
  readonly version: typeof PROCEDURAL_ARCHITECTURE_VERSION;
  readonly kind: BuildingKind;
  readonly seed: number;
  readonly developmentTier: 0 | 1 | 2 | 3 | 4;
  readonly region: 'Gorski Kotar and Croatian Littoral';
  readonly period: 'circa 1550';
  readonly source: 'threejs-procedural';
};

const commonWorkshop = {
  roof: 'steep-gable',
  massing: ['compact-workshop', 'deep-wet-climate-eaves'],
  modules: ['closed-fieldstone-footing', 'timber-wall-frame', 'true-openings', 'split-shingle-roof'],
  materials: ['fieldstone', 'lime-plaster', 'rough-timber', 'split-shingles', 'wrought-iron'],
  dynamicSlots: ['input-stock', 'output-stock', 'firewood'],
  triangleTarget: 5_500,
  triangleCeiling: 11_000,
  drawCallTarget: 7,
  historicalNote: 'Local timber-framed craft building on a moisture-resistant gathered-stone footing.',
} as const;

const commonRural = {
  roof: 'steep-gable',
  massing: ['low-rural-house', 'deep-wet-climate-eaves'],
  modules: ['closed-fieldstone-footing', 'boarded-or-daub-walls', 'true-openings', 'split-shingle-roof'],
  materials: ['fieldstone', 'lime-plaster', 'weathered-boards', 'rough-timber', 'split-shingles'],
  dynamicSlots: ['local-stock'],
  triangleTarget: 4_800,
  triangleCeiling: 9_500,
  drawCallTarget: 7,
  historicalNote: 'Compact upland vernacular structure using local fir, gathered stone, and restrained lime finish.',
} as const;

export const PROCEDURAL_BUILDING_CATALOG = {
  founders_camp: {
    family: 'founding-site', status: 'site', roof: 'canvas-fly',
    massing: ['open-stockyard', 'temporary-canvas-shelters'],
    modules: ['canvas-tents', 'open-hearth', 'timber-staging', 'founding-cart'],
    materials: ['packed-earth', 'linen-canvas', 'rough-timber', 'fieldstone', 'wrought-iron'],
    dynamicSlots: ['campfire', 'founding-stock', 'treasury', 'shelter-clearance'],
    triangleTarget: 8_000, triangleCeiling: 18_000, drawCallTarget: 10,
    historicalNote: 'Temporary work camp and open stockyard, not a permanent hall.',
  },
  salvage_pile: {
    family: 'founding-site', status: 'site', roof: 'none',
    massing: ['recoverable-demolition-pile'], modules: ['sorted-timber', 'sorted-stone', 'ironwork-crate'],
    materials: ['fieldstone', 'weathered-boards', 'wrought-iron'], dynamicSlots: ['reclamation-stock'],
    triangleTarget: 900, triangleCeiling: 2_000, drawCallTarget: 4,
    historicalNote: 'A logistics prop made from reusable structural material, not a building.',
  },
  lumber_mill: { ...commonWorkshop, family: 'forestry', status: 'major', massing: ['open-saw-shed', 'log-intake-yard'], modules: [...commonWorkshop.modules, 'weathered-board-saw-frame', 'log-ways'], materials: [...commonWorkshop.materials, 'weathered-boards'], triangleTarget: 7_500, triangleCeiling: 14_000, historicalNote: 'Water-independent hand-saw yard with a roofed working bay and open timber intake.' },
  reforester: { ...commonRural, family: 'forestry', status: 'small', massing: ['compact-forester-hut'], modules: [...commonRural.modules, 'tool-porch'], historicalNote: 'Small woodland work hut; living vegetation remains owned by SeedThree.' },
  woodcutters_lodge: { ...commonRural, family: 'forestry', status: 'standard', massing: ['low-woodland-lodge', 'covered-cutting-bay'], modules: [...commonRural.modules, 'iron-fitted-door', 'cutting-lean-to'], materials: [...commonRural.materials, 'wrought-iron'], dynamicSlots: ['firewood', 'timber-stock'] },
  stone_quarry: {
    family: 'extraction', status: 'site', roof: 'open-workyard',
    massing: ['shallow-mining-pit', 'timber-sort-bay'], modules: ['cut-face', 'access-ramp', 'sorting-trestles', 'tool-shelter'],
    materials: ['packed-earth', 'fieldstone', 'rough-timber', 'weathered-boards', 'split-shingles', 'linen-canvas', 'wrought-iron'], dynamicSlots: ['ore-stock', 'support-stock'],
    triangleTarget: 4_000, triangleCeiling: 8_000, drawCallTarget: 7,
    historicalNote: 'Unified shallow extraction pit for surface deposits; there is no standalone clay-pit building.',
  },
  large_quarry: {
    family: 'extraction', status: 'major', roof: 'open-workyard',
    massing: ['terraced-rock-cut', 'sorting-yard'], modules: ['quarry-benches', 'hoist-frame', 'sorting-shed', 'haul-ramp'],
    materials: ['packed-earth', 'fieldstone', 'rough-timber', 'weathered-boards', 'split-shingles', 'wrought-iron'], dynamicSlots: ['stone-stock', 'support-stock'],
    triangleTarget: 7_500, triangleCeiling: 15_000, drawCallTarget: 9,
    historicalNote: 'Expanded dimension-stone working with timber lifting gear and a roofed sorting shelter.',
  },
  mine: {
    family: 'extraction', status: 'major', roof: 'steep-gable',
    massing: ['shaft-headframe', 'ore-sorting-yard', 'service-shed'], modules: ['headframe', 'shaft-collar', 'windlass', 'sorting-tables', 'service-shed'],
    materials: ['packed-earth', 'fieldstone', 'rough-timber', 'weathered-boards', 'split-shingles', 'wrought-iron'], dynamicSlots: ['ore-stock', 'support-stock'],
    triangleTarget: 7_000, triangleCeiling: 14_000, drawCallTarget: 9,
    historicalNote: 'Timber shaft works and hand-powered haulage appropriate to a small sixteenth-century mine.',
  },
  charcoal_burner: { ...commonWorkshop, family: 'craft', status: 'site', roof: 'open-workyard', massing: ['charcoal-clamp-yard', 'small-weather-shelter'], modules: ['charcoal-clamp', 'earth-cover', 'fieldstone-hearth-edge', 'tool-shelter'], materials: ['packed-earth', 'fieldstone', 'rough-timber', 'split-shingles'], dynamicSlots: ['firewood', 'charcoal-stock', 'clamp-smoke'], triangleTarget: 3_200, triangleCeiling: 7_000 },
  smithy: { ...commonWorkshop, family: 'craft', status: 'standard', modules: [...commonWorkshop.modules, 'masonry-hearth', 'forge-hood', 'working-canopy'], historicalNote: 'Timber-and-daub smithy kept low and ventilated around a masonry hearth.' },
  weaponsmith_armorer: { ...commonWorkshop, family: 'craft', status: 'major', modules: [...commonWorkshop.modules, 'masonry-hearth', 'forge-hood', 'armorers-bench'], triangleTarget: 7_000, triangleCeiling: 13_000 },
  bowyer_fletcher: { ...commonWorkshop, family: 'craft', status: 'standard', modules: [...commonWorkshop.modules, 'seasoning-rack', 'long-workbench'], materials: [...commonWorkshop.materials, 'weathered-boards'], dynamicSlots: ['timber-stock', 'ironwork-stock', 'finished-arms'] },
  stone_mason: { ...commonWorkshop, family: 'craft', status: 'standard', roof: 'open-workyard', massing: ['roofed-banker-bays', 'open-stone-apron'], modules: ['braced-post-frame', 'banker-benches', 'lifting-shear', 'dressed-ashlar-stacks'], materials: ['rough-timber', 'split-shingles', 'fieldstone', 'limestone-ashlar', 'wrought-iron'], dynamicSlots: ['mason-raw-stone', 'mason-dressed-stone'], triangleTarget: 3500, triangleCeiling: 8000, historicalNote: 'Roofed stone bankers and an open delivery apron for chiselled ashlar masonry.' },
  potter_kiln: { ...commonWorkshop, family: 'craft', status: 'standard', roof: 'industrial-hood', massing: ['open-potters-yard', 'domed-kiln', 'weather-shelter'], modules: ['lime-rendered-shelter', 'domed-kiln', 'iron-fitted-door', 'firebox', 'drying-shelves', 'lean-to'], materials: ['packed-earth', 'fieldstone', 'lime-plaster', 'rough-timber', 'split-shingles', 'wrought-iron'], dynamicSlots: ['clay-stock', 'firewood', 'pottery-stock'], historicalNote: 'A detached fired-clay kiln and open drying yard, not a clay extraction building.' },
  well: {
    family: 'service', status: 'small', roof: 'tower-cap', massing: ['stone-well-head', 'open-weather-cap'],
    modules: ['lined-well-ring', 'windlass', 'weathered-board-four-sided-shingle-cap'], materials: ['fieldstone', 'rough-timber', 'weathered-boards', 'split-shingles', 'wrought-iron'], dynamicSlots: ['water-surface'],
    triangleTarget: 2_200, triangleCeiling: 4_500, drawCallTarget: 6,
    historicalNote: 'Lined village well with a timber windlass and steep rain cap.',
  },
  hunters_hall: {
    family: 'service', status: 'site', roof: 'canvas-fly', massing: ['temporary-sleeping-tent', 'open-processing-fly', 'hearth-yard'],
    modules: ['canvas-a-frame-tent', 'hide-processing-fly', 'stone-hearth', 'empty-tool-frame', 'work-table'],
    materials: ['packed-earth', 'linen-canvas', 'stitched-hide', 'rough-timber', 'weathered-boards', 'fieldstone', 'wicker'], dynamicSlots: ['food-stock', 'hearth-fire', 'smoke'],
    triangleTarget: 3_800, triangleCeiling: 6_500, drawCallTarget: 8,
    historicalNote: 'A mobile woodland hunting camp rather than a permanent lodge; game carcasses are runtime state.',
  },
  foragers_shed: { ...commonRural, family: 'service', status: 'small', massing: ['compact-gathering-shed', 'covered-sorting-porch'], modules: [...commonRural.modules, 'iron-fitted-door', 'sorting-porch'], materials: [...commonRural.materials, 'wrought-iron'], dynamicSlots: ['food-stock', 'remedy-stock'], historicalNote: 'Small woodland store and sorting porch; all living plants remain owned by SeedThree.' },
  fishing_camp: {
    family: 'service', status: 'standard', roof: 'steep-gable', massing: ['net-house', 'small-smoking-shed', 'open-workyard'],
    modules: ['boarded-net-house', 'small-service-shed', 'fish-drying-rack', 'pulled-up-boat'],
    materials: ['fieldstone', 'weathered-boards', 'rough-timber', 'split-shingles', 'wicker'], dynamicSlots: ['fish-stock', 'smoke'],
    triangleTarget: 6_500, triangleCeiling: 11_000, drawCallTarget: 9,
    historicalNote: 'Unfenced riverside work compound with separate clean circulation to both doors.',
  },
  chapel: {
    family: 'religious', status: 'landmark', roof: 'spire', massing: ['nave', 'roof-mounted-belfry', 'fenced-churchyard'],
    modules: ['true-arched-openings', 'nave-roof', 'roof-fitted-tower-base', 'four-post-belfry', 'regional-flared-spire', 'iron-cross', 'permanent-footprint-fence'],
    materials: ['fieldstone', 'limestone-ashlar', 'lime-plaster', 'rough-timber', 'weathered-boards', 'split-shingles', 'clay-tiles', 'wrought-iron'], dynamicSlots: ['clock', 'bell', 'devotional-light'],
    triangleTarget: 14_000, triangleCeiling: 24_000, drawCallTarget: 10,
    historicalNote: 'Tiered parish church progression based on compact Gorski Kotar forms and a restrained Delnice-like silhouette.',
  },
  wayside_shrine: {
    family: 'religious', status: 'small', roof: 'steep-gable', massing: ['masonry-niche-pier', 'protective-gabled-cap'],
    modules: ['fieldstone-plinth', 'limewashed-niche', 'limestone-niche-trim', 'shingle-cap', 'simple-iron-cross'],
    materials: ['fieldstone', 'limestone-ashlar', 'lime-plaster', 'rough-timber', 'split-shingles', 'wrought-iron'], dynamicSlots: ['devotional-candle'],
    triangleTarget: 1_400, triangleCeiling: 3_000, drawCallTarget: 6,
    historicalNote: 'A small road-edge devotional niche, materially tied to parish construction rather than fantasy statuary.',
  },
  marketplace: { ...commonRural, family: 'commerce', status: 'major', roof: 'open-workyard', massing: ['open-market-lane', 'modular-covered-stalls'], modules: ['timber-stalls', 'canvas-awnings', 'small-shingled-toll-shelters', 'central-access-lane'], materials: ['fieldstone', 'rough-timber', 'weathered-boards', 'split-shingles', 'linen-canvas', 'wicker'], dynamicSlots: ['market-stock', 'stall-occupancy'], triangleTarget: 9_000, triangleCeiling: 18_000, drawCallTarget: 12, historicalNote: 'An open periodic market assembled from reversible timber stalls, cloth awnings, and a few small rain shelters.' },
  trading_post: { ...commonRural, family: 'commerce', status: 'major', massing: ['secure-roadside-store', 'covered-loading-bay'], modules: [...commonRural.modules, 'iron-fitted-cart-portal', 'loading-canopy'], materials: [...commonRural.materials, 'wrought-iron'], dynamicSlots: ['trade-stock', 'cart-stage'] },
  town_hall: { ...commonRural, family: 'civic', status: 'landmark', roof: 'cross-gable', massing: ['two-storey-civic-house', 'front-council-porch'], modules: [...commonRural.modules, 'stone-ground-storey', 'weathered-board-service-roof', 'council-chamber', 'public-portal'], materials: ['fieldstone', 'limestone-ashlar', 'lime-plaster', 'rough-timber', 'weathered-boards', 'split-shingles', 'clay-tiles', 'wrought-iron'], triangleTarget: 14_000, triangleCeiling: 28_000, drawCallTarget: 10, historicalNote: 'A prosperous but compact civic house, not a later baroque town hall.' },
  stable: { ...commonRural, family: 'civic', status: 'standard', massing: ['long-stable-range', 'covered-bays'], modules: [...commonRural.modules, 'packed-earth-stall-floor', 'wide-stall-doors', 'vented-loft', 'covered-tie-rail'], materials: [...commonRural.materials, 'packed-earth'], dynamicSlots: ['ox-slots', 'fodder-stock'] },
  cavalry_yard: { ...commonRural, family: 'defensive', status: 'major', massing: ['timber-muster-hall', 'fenced-mounted-drill-yard', 'armory-and-campaign-store'], modules: [...commonRural.modules, 'equipment-issue-bays', 'mounted-drill-track', 'covered-hitching-rail', 'campaign-store'], materials: [...commonRural.materials, 'packed-earth', 'wrought-iron'], dynamicSlots: ['mustering-riders', 'equipment-stock', 'field-supply-stock', 'mounted-companies'], triangleTarget: 9_000, triangleCeiling: 18_000, historicalNote: 'A compact frontier military muster and equipment yard for Croatian-Hungarian light horse, armored lancers, and mounted archers. Horses visit for formation and drill but remain owned and housed by pastoral farmsteads.' },
  kennel: { ...commonRural, family: 'civic', status: 'standard', massing: ['low-kennel-range', 'fenced-yard'], modules: [...commonRural.modules, 'four-dog-bays', 'exercise-yard', 'water-trough'], materials: [...commonRural.materials, 'packed-earth'], dynamicSlots: ['guard-dog-slots'] },
  village_storehouse: { ...commonRural, family: 'civic', status: 'major', massing: ['raised-secure-store', 'covered-loading-apron'], modules: [...commonRural.modules, 'raised-floor', 'wide-loading-door'], dynamicSlots: ['bulk-stock'] },
  watchtower: { ...commonRural, family: 'defensive', status: 'major', roof: 'tower-cap', massing: ['tall-timber-watch-platform', 'enclosed-ground-store'], modules: ['stone-footing', 'braced-tower-frame', 'boarded-watch-gallery', 'covered-watch-platform'], materials: ['fieldstone', 'rough-timber', 'weathered-boards', 'split-shingles', 'wrought-iron'], dynamicSlots: ['guards'], triangleTarget: 6_000, triangleCeiling: 12_000, drawCallTarget: 8, historicalNote: 'A compact frontier timber watch post with explicit diagonal bracing and a weather cap.' },
  guardhouse: { ...commonRural, family: 'defensive', status: 'standard', massing: ['roadside-guard-room', 'covered-muster-porch'], modules: [...commonRural.modules, 'iron-fitted-door', 'muster-porch', 'arms-store'], materials: [...commonRural.materials, 'wrought-iron'], dynamicSlots: ['food-stock', 'arms-stock', 'guards'] },
  palisaded_refuge: { ...commonRural, family: 'defensive', status: 'landmark', roof: 'tower-cap', massing: ['compact-palisaded-enclosure', 'gatehouse', 'refuge-shelters'], modules: ['weathered-palisade-circuit', 'defended-gate', 'boarded-watch-platform', 'interior-shelters'], materials: ['packed-earth', 'fieldstone', 'rough-timber', 'weathered-boards', 'split-shingles', 'wrought-iron'], dynamicSlots: ['refuge-occupancy', 'guards'], triangleTarget: 18_000, triangleCeiling: 36_000, drawCallTarget: 12, historicalNote: 'A small timber refuge enclosure suited to a frontier settlement, not a masonry castle.' },
  threshing_barn: { ...commonRural, family: 'agricultural', status: 'major', massing: ['broad-ventilated-barn', 'central-threshing-floor'], modules: ['fieldstone-footing', 'boarded-barn-frame', 'opposed-cart-doors', 'split-shingle-roof'], materials: ['fieldstone', 'weathered-boards', 'rough-timber', 'split-shingles', 'wrought-iron'], dynamicSlots: ['grain-stock'] },
  pastoral_farmstead: { ...commonRural, family: 'livestock', status: 'major', massing: ['farmhouse-range', 'attached-animal-shelter'], modules: [...commonRural.modules, 'iron-fitted-door', 'stock-shelter', 'hay-bay'], materials: [...commonRural.materials, 'wrought-iron'], dynamicSlots: ['animals', 'fodder', 'salt-stock'] },
  swineherd: { ...commonRural, family: 'livestock', status: 'standard', massing: ['small-herdsman-hut', 'open-pig-shelter'], modules: [...commonRural.modules, 'iron-fitted-door', 'low-animal-shelter'], materials: [...commonRural.materials, 'wrought-iron'], dynamicSlots: ['animals', 'fodder'] },
  monastery: { ...commonRural, family: 'religious', status: 'landmark', roof: 'cross-gable', massing: ['courtyard-monastic-precinct', 'chapel-range', 'guest-and-work-ranges'], modules: ['stone-cloister-ranges', 'chapel', 'service-courtyard', 'boarded-work-ranges', 'guesthouse'], materials: ['fieldstone', 'limestone-ashlar', 'lime-plaster', 'rough-timber', 'weathered-boards', 'split-shingles', 'clay-tiles', 'wrought-iron'], dynamicSlots: ['food-stock', 'drink-stock', 'estate-extensions'], triangleTarget: 40_000, triangleCeiling: 110_000, drawCallTarget: 18, historicalNote: 'A compact regional religious estate assembled by ranges, without later monumental baroque language.' },
  brewery: { ...commonWorkshop, family: 'food-processing', status: 'standard', modules: [...commonWorkshop.modules, 'brewing-hearth', 'cooling-lean-to'], dynamicSlots: ['grain-stock', 'fuel-stock', 'ale-stock'] },
  tavern: { ...commonRural, family: 'commerce', status: 'major', massing: ['roadside-public-house', 'covered-entry-gallery'], modules: [...commonRural.modules, 'iron-fitted-door', 'public-room', 'cellar-access', 'entry-gallery'], materials: [...commonRural.materials, 'wrought-iron'], dynamicSlots: ['ale-stock', 'food-stock', 'patrons'], triangleTarget: 8_500, triangleCeiling: 16_000 },
  smokehouse: { ...commonWorkshop, family: 'food-processing', status: 'small', roof: 'industrial-hood', massing: ['sealed-smoking-house', 'service-lean-to'], modules: ['stone-firebox', 'stacked-log-smoking-chamber', 'boarded-service-work', 'vented-roof', 'service-lean-to'], materials: ['fieldstone', 'stacked-logs', 'weathered-boards', 'rough-timber', 'split-shingles', 'wrought-iron'], dynamicSlots: ['fresh-food', 'salt', 'firewood', 'preserved-food', 'smoke'], historicalNote: 'A compact detached smoking chamber whose fire and hanging goods remain runtime-owned.' },
  granary: { ...commonRural, family: 'food-processing', status: 'major', massing: ['raised-grain-store', 'covered-loading-bay'], modules: ['stone-staddle-base', 'sealed-timber-store', 'vented-gables', 'loading-platform'], dynamicSlots: ['grain-stock'], historicalNote: 'Raised, ventilated grain storage protected from ground moisture and vermin.' },
  bakery: { ...commonWorkshop, family: 'food-processing', status: 'standard', modules: [...commonWorkshop.modules, 'masonry-oven', 'cooling-porch'], dynamicSlots: ['grain-stock', 'firewood', 'bread-stock'] },
  apiary: { ...commonRural, family: 'agricultural', status: 'site', roof: 'lean-to', massing: ['open-apiary-stand', 'small-processing-shelter'], modules: ['fieldstone-footing', 'limewashed-processing-shelter', 'covered-hive-stand', 'processing-table', 'tool-chest'], materials: ['packed-earth', 'fieldstone', 'lime-plaster', 'rough-timber', 'split-shingles', 'wicker', 'wrought-iron'], dynamicSlots: ['honey-stock', 'bee-activity'], triangleTarget: 3_500, triangleCeiling: 7_500, historicalNote: 'Covered skeps and a small reversible work shelter; flowering vegetation remains owned by SeedThree.' },
  watermill: { ...commonWorkshop, family: 'food-processing', status: 'major', massing: ['streamside-mill-house', 'wheel-bay'], modules: [...commonWorkshop.modules, 'weathered-board-waterwheel', 'axle-house', 'mill-race-apron'], materials: [...commonWorkshop.materials, 'weathered-boards'], dynamicSlots: ['grain-stock', 'flour-stock', 'wheel'], triangleTarget: 10_000, triangleCeiling: 20_000 },
  windmill: { ...commonWorkshop, family: 'food-processing', status: 'major', roof: 'tower-cap', massing: ['compact-post-or-tower-mill', 'rotating-sail-front'], modules: ['stone-or-timber-mill-body', 'cap', 'sail-cross', 'tail-support'], dynamicSlots: ['grain-stock', 'flour-stock', 'sails'], triangleTarget: 9_000, triangleCeiling: 18_000 },
  carpenter: { ...commonWorkshop, family: 'craft', status: 'standard', massing: ['open-carpentry-shed', 'covered-bench-range'], modules: ['fieldstone-footing', 'braced-open-frame', 'split-shingle-roof', 'workbenches', 'timber-rack'], materials: ['packed-earth', 'fieldstone', 'rough-timber', 'weathered-boards', 'split-shingles', 'wrought-iron'], dynamicSlots: ['timber-stock', 'ironwork-stock', 'finished-tools'] },
  spinning_retting_house: { ...commonWorkshop, family: 'textile', status: 'major', massing: ['dry-spinning-house', 'separate-wet-retting-bay'], modules: [...commonWorkshop.modules, 'limestone-lined-retting-troughs', 'weathered-board-wet-service-bay', 'vented-loft'], materials: [...commonWorkshop.materials, 'limestone-ashlar', 'weathered-boards'], dynamicSlots: ['wool-stock', 'flax-stock', 'yarn-stock', 'linen-stock'] },
  weaver: { ...commonWorkshop, family: 'textile', status: 'standard', modules: [...commonWorkshop.modules, 'weathered-board-broad-lit-work-bay', 'cloth-drying-rail'], materials: [...commonWorkshop.materials, 'weathered-boards'], dynamicSlots: ['yarn-stock', 'linen-stock', 'cloth-stock'] },
  tannery: { ...commonWorkshop, family: 'craft', status: 'major', massing: ['open-wet-yard', 'covered-bark-and-hide-shed'], modules: ['lime-rendered-service-shed', 'weathered-board-tanning-vats', 'covered-working-bay', 'drying-frame'], materials: ['packed-earth', 'fieldstone', 'lime-plaster', 'rough-timber', 'weathered-boards', 'split-shingles', 'wicker', 'wrought-iron'], dynamicSlots: ['hide-stock', 'bark-stock', 'leather-stock'], historicalNote: 'A deliberately separated wet craft yard with open vats and a roofed dry-work bay.' },
  cobbler: { ...commonWorkshop, family: 'craft', status: 'small', massing: ['compact-shoemakers-shop'], modules: [...commonWorkshop.modules, 'lit-work-window', 'small-service-bench'], dynamicSlots: ['leather-stock', 'shoe-stock'] },
  chandlery: { ...commonWorkshop, family: 'craft', status: 'standard', massing: ['compact-chandlers-shop', 'vented-melting-bay'], modules: [...commonWorkshop.modules, 'weathered-board-openings', 'melt-hearth', 'vented-service-bay', 'cooling-racks'], materials: [...commonWorkshop.materials, 'weathered-boards'], dynamicSlots: ['wax-stock', 'wick-stock', 'candle-stock'] },
} as const satisfies Record<BuildingKind, ProceduralBuildingCatalogEntry>;

export function createProceduralBuildingPlan(
  kind: BuildingKind,
  options: {
    readonly seed?: number;
    readonly developmentTier?: 0 | 1 | 2 | 3 | 4;
  } = {},
): ProceduralBuildingPlan {
  return {
    ...PROCEDURAL_BUILDING_CATALOG[kind],
    ...(kind === 'chapel' && options.developmentTier === 4 ? {
      massing: ['high-nave', 'paired-bell-towers', 'side-aisles', 'bishop-choir', 'walled-precinct'],
      modules: ['pierced-clerestory', 'flying-buttress', 'rose-tracery', 'processional-portal', 'open-bell-stage', 'bishop-cathedra'],
      triangleTarget: 28_000, triangleCeiling: 36_000, drawCallTarget: 14,
    } : {}),
    version: PROCEDURAL_ARCHITECTURE_VERSION,
    kind,
    seed: options.seed ?? 1550,
    developmentTier: options.developmentTier ?? 0,
    region: 'Gorski Kotar and Croatian Littoral',
    period: 'circa 1550',
    source: 'threejs-procedural',
  };
}
