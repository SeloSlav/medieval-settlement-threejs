import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeRoot = path.join(
  repositoryRoot,
  'public',
  'assets',
  'models',
  'buildings',
  'gorski',
);

const residence = readGlb('tier1_residence_retopo_v26.glb');
assert.equal(residence.json.nodes.length, 33, 'Tier 1 residence node count changed');
assert.equal(residence.json.meshes.length, 33, 'Tier 1 residence mesh count changed');
assert.equal(countTriangles(residence.json), 5_184, 'Tier 1 residence triangle count changed');
assert.ok(residence.bytes.length < 1_000_000, 'Tier 1 runtime GLB should stay below 1 MB');
assert.deepEqual(residence.json.images ?? [], [], 'Tier 1 must use the shared runtime atlas');
assert.equal(
  residence.json.asset.extras?.sourceGlb,
  'tier1_residence_retopo_v26.glb',
  'Tier 1 runtime source provenance is missing',
);
assertNames(residence.json, [
  'T1_Wall_Front_Door',
  'T1_Wall_Front_SquareHole_DarkInterior',
  'T1_RoofSkin_Left',
  'T1_RoofSkin_Right',
  'T1_Threshold_Steps',
]);
assert.ok(
  residence.json.materials.some(
    (material) => material.extras?.atlas_uv_mode === 'final tile coordinates baked into GK_UV0',
  ),
  'Tier 1 roof must retain its direct-atlas UV contract',
);
for (const material of residence.json.materials.filter(
  (candidate) => candidate.extras?.atlas_id === 'gorski-building-atlas-v1',
)) {
  assert.ok(
    Array.isArray(material.extras?.atlas_tint) && material.extras.atlas_tint.length === 3,
    `${material.name} must retain its authored atlas tint`,
  );
  assert.equal(
    typeof material.extras?.atlas_tint_strength,
    'number',
    `${material.name} must retain its authored atlas tint strength`,
  );
  assert.equal(
    typeof material.extras?.atlas_normal_strength,
    'number',
    `${material.name} must retain its authored normal strength`,
  );
}

const church = readGlb('tier1_church_delnice_v2.glb');
assert.equal(church.json.nodes.length, 85, 'Tier 1 church node count changed');
assert.equal(church.json.meshes.length, 84, 'Tier 1 church mesh count changed');
const churchTriangles = countTriangles(church.json);
assert.equal(churchTriangles, 13_764, 'Tier 1 church triangle count changed');
assert.ok(
  churchTriangles >= 12_000 && churchTriangles <= 16_000,
  'Tier 1 church must stay within its 12,000-16,000 triangle landmark budget',
);
assert.ok(church.bytes.length < 2_000_000, 'Tier 1 church runtime GLB should stay below 2 MB');
assert.equal(
  church.json.asset.extras?.sourceGlb,
  'tier1_church_delnice_v2.glb',
  'Tier 1 church runtime source provenance is missing',
);
assert.deepEqual(church.json.images ?? [], [], 'Tier 1 church must use the shared runtime atlas');
assertNames(church.json, [
  'TC_Main_West_Door',
  'TC_Main_West_Portal_Surround',
  'TC_West_Oculus',
  'TC_Tower_Belfry_Front',
  'TC_Belfry_Louver_Front',
  'TC_Belfry_Louver_Left',
  'TC_Belfry_Louver_Right',
  'TC_Nave_Left_Lancet_1',
  'TC_Nave_Right_Lancet_3',
  'TC_Delnice_Flared_Spire',
  'TC_Spire_Iron_Cross',
  'TC_Nave_Roof_Left',
  'TC_Nave_Roof_Right',
  'TC_Clock_Anchor',
]);
for (const [name, contract] of [
  ['TC_Nave_Left_Lancet_1', 'window_lancet'],
  ['TC_Nave_Right_Lancet_3', 'window_lancet'],
  ['TC_Belfry_Louver_Left', 'window_domestic'],
  ['TC_Belfry_Louver_Right', 'window_domestic'],
]) {
  const node = church.json.nodes.find((candidate) => candidate.name === name);
  assert.equal(node?.extras?.tc_aperture_contract, contract, `${name} lost its aperture contract`);
  assert.equal(typeof node?.extras?.tc_host_object, 'string', `${name} lost its host reference`);
}
const clockAnchor = church.json.nodes.find((node) => node.name === 'TC_Clock_Anchor');
assert.equal(clockAnchor?.mesh, undefined, 'The GLB clock anchor must not contain baked geometry');
assert.equal(
  clockAnchor?.extras?.runtime_owned,
  'simulation-driven parish clock face and hands',
  'The GLB clock anchor must retain its simulation ownership contract',
);
assert.doesNotMatch(
  (church.json.nodes ?? [])
    .filter((node) => Number.isInteger(node.mesh))
    .map((node) => node.name ?? '')
    .join('|'),
  /clock/i,
  'Clock face or hand geometry must not be baked into the Tier 1 church GLB',
);
const churchAtlasMaterials = (church.json.materials ?? []).filter(
  (material) => material.extras?.atlas_id === 'gorski-building-atlas-v1',
);
const churchAtlasTiles = new Set(
  churchAtlasMaterials.map((material) => material.extras?.atlas_tile),
);
for (const tile of ['lime-plaster', 'fieldstone-mortar', 'split-shingles', 'wrought-iron']) {
  assert.ok(churchAtlasTiles.has(tile), `Tier 1 church must retain ${tile}`);
}
for (const role of ['limewash', 'limewash_faded', 'limewash_damp', 'fieldstone', 'shingles', 'iron']) {
  assert.ok(
    churchAtlasMaterials.some((material) => material.extras?.surface_role === role),
    `Tier 1 church must retain its ${role} surface role`,
  );
}
for (const material of churchAtlasMaterials) {
  assert.equal(
    material.extras?.atlas_uv_mode,
    'final tile coordinates baked into GK_UV0',
    `${material.name} must not transform already-baked church UVs again`,
  );
}

const camp = readGlb('hunters_camp_textured_v10.glb');
assert.equal(camp.json.nodes.length, 15, 'Hunter camp node count changed');
assert.equal(camp.json.meshes.length, 15, 'Hunter camp mesh count changed');
const campTriangles = countTriangles(camp.json);
assert.equal(campTriangles, 3_856, 'Hunter camp triangle count changed');
assert.ok(
  campTriangles >= 3_000 && campTriangles <= 4_000,
  'Hunter camp must stay within its 3,000-4,000 triangle gameplay budget',
);
assert.ok(camp.bytes.length < 2_000_000, 'Hunter camp runtime GLB should stay below 2 MB');
assert.equal(
  camp.json.asset.extras?.sourceGlb,
  'hunters_camp_textured_v10.glb',
  'Hunter camp runtime source provenance is missing',
);
assert.deepEqual(
  (camp.json.images ?? []).map((image) => image.name).sort(),
  [
    'aged_canvas_albedo',
    'aged_canvas_normal',
    'stitched_hide_albedo',
    'stitched_hide_normal',
  ],
  'Hunter camp should keep only the authored canvas and hide maps',
);
for (const image of camp.json.images ?? []) {
  assert.ok(typeof image.uri === 'string', `${image.name} must be an external runtime texture`);
  assert.equal(image.bufferView, undefined, `${image.name} must not remain embedded`);
}
const campAtlasMaterials = (camp.json.materials ?? []).filter(
  (material) => material.extras?.atlas_id === 'gorski-building-atlas-v1',
);
assert.ok(campAtlasMaterials.length >= 7, 'Hunter camp building-atlas materials are missing');
for (const material of campAtlasMaterials) {
  assert.equal(
    material.extras?.atlas_uv_mode,
    'final tile coordinates baked into GK_UV0',
    `${material.name} must not transform already-baked atlas UVs again`,
  );
  assert.ok(
    Array.isArray(material.extras?.atlas_tint) && material.extras.atlas_tint.length === 3,
    `${material.name} must retain its authored natural-material tint`,
  );
  assert.ok(
    typeof material.extras?.atlas_tint_strength === 'number'
      && material.extras.atlas_tint_strength > 0,
    `${material.name} must retain a non-zero authored tint strength`,
  );
  assert.equal(
    typeof material.extras?.atlas_normal_strength,
    'number',
    `${material.name} must retain its authored normal strength`,
  );
}
const campAtlasTiles = new Set(
  campAtlasMaterials.map((material) => material.extras?.atlas_tile),
);
assert.ok(campAtlasTiles.has('quarry-stone'), 'Hunter hearth must use rough quarry stone');
assert.ok(campAtlasTiles.has('weathered-planks'), 'Hunter camp must retain weathered furnishing timber');
assert.ok(
  campAtlasMaterials.some((material) => material.extras?.surface_role === 'oak_dark'),
  'Hunter hearth and work furniture must retain their dark forest-oak material role',
);
assert.ok(
  !campAtlasTiles.has('fieldstone-mortar'),
  'Hunter hearth must not use the brick-like mortared fieldstone tile',
);
for (const role of ['canvas', 'leather']) {
  const material = (camp.json.materials ?? []).find(
    (candidate) => candidate.extras?.surface_role === role,
  );
  assert.ok(material, `Hunter camp ${role} material is missing`);
  assert.ok(
    Array.isArray(material.extras?.surface_tint) && material.extras.surface_tint.length === 3,
    `Hunter camp ${role} must retain its weathered surface tint`,
  );
}
assertNames(camp.json, [
  'HC_Sleeping_Tent',
  'HC_Processing_Hide_Fly',
  'HC_Hearth',
  'HC_Cooking_Tripod',
  'HC_Hunter_Tool_Rack',
]);
const campNames = (camp.json.nodes ?? []).map((node) => node.name ?? '').join('|');
assert.doesNotMatch(
  campNames,
  /bow|axe|hook|weapon|hanging/i,
  'Removed or extraneous hunter-camp props returned',
);

const fishingCamp = readGlb('fishing_camp_textured_v4.glb');
assert.equal(fishingCamp.json.nodes.length, 59, 'Fishing camp node count changed');
assert.equal(fishingCamp.json.meshes.length, 59, 'Fishing camp mesh count changed');
const fishingCampTriangles = countTriangles(fishingCamp.json);
assert.equal(fishingCampTriangles, 4_396, 'Fishing camp triangle count changed');
assert.ok(
  fishingCampTriangles >= 2_500 && fishingCampTriangles <= 4_500,
  'Fishing camp must stay within its 2,500-4,500 triangle gameplay budget',
);
assert.ok(fishingCamp.bytes.length < 2_000_000, 'Fishing camp runtime GLB should stay below 2 MB');
assert.equal(
  fishingCamp.json.asset.extras?.sourceGlb,
  'fishing_camp_textured_v4.glb',
  'Fishing camp runtime source provenance is missing',
);
assert.deepEqual(fishingCamp.json.images ?? [], [], 'Fishing camp must use the shared runtime atlas');
const fishingAtlasMaterials = (fishingCamp.json.materials ?? []).filter(
  (material) => material.extras?.atlas_id === 'gorski-building-atlas-v1',
);
assert.ok(fishingAtlasMaterials.length >= 10, 'Fishing camp atlas materials are missing');
const fishingAtlasTiles = new Set(
  fishingAtlasMaterials.map((material) => material.extras?.atlas_tile),
);
for (const tile of [
  'fieldstone-mortar',
  'lime-plaster',
  'rough-hewn-timber',
  'weathered-planks',
  'split-shingles',
]) {
  assert.ok(fishingAtlasTiles.has(tile), `Fishing camp must retain ${tile}`);
}
assert.ok(
  !fishingAtlasTiles.has('linen-canvas'),
  'Fishing camp must not bake placeholder fish/catch material into the empty rack',
);
for (const material of fishingAtlasMaterials) {
  assert.equal(
    material.extras?.atlas_uv_mode,
    'final tile coordinates baked into GK_UV0',
    `${material.name} must not transform already-baked fishing-camp UVs again`,
  );
  assert.ok(
    Array.isArray(material.extras?.atlas_tint) && material.extras.atlas_tint.length === 3,
    `${material.name} must retain its authored fishing-camp tint`,
  );
}
assertNames(fishingCamp.json, [
  'FC_Main_Front_Door_Host',
  'FC_Shed_Service_Door',
  'FC_Main_Roof_Left',
  'FC_Shed_Roof_Right',
  'FC_Fish_Drying_Rack',
  'FC_Grounded_River_Dugout',
  'FC_Main_Front_Gable_Collar_Left',
  'FC_Main_Front_Gable_Collar_Right',
]);
assert.doesNotMatch(
  (fishingCamp.json.nodes ?? []).map((node) => node.name ?? '').join('|'),
  /FC_Fence_|FC_Open_Yard_Gate|FC_.*Gate/,
  'Fishing camp workyard must remain completely unenclosed',
);
const fishingRackNode = fishingCamp.json.nodes.find((node) => node.name === 'FC_Fish_Drying_Rack');
assert.ok(Number.isInteger(fishingRackNode?.mesh), 'Fishing camp drying-rack mesh is missing');
const fishingRackRoles = new Set(
  fishingCamp.json.meshes[fishingRackNode.mesh].primitives.map(
    (primitive) => fishingCamp.json.materials[primitive.material]?.extras?.surface_role,
  ),
);
assert.deepEqual(
  [...fishingRackRoles].sort(),
  ['oak_dark', 'timber_weathered'],
  'Fishing rack must remain an empty timber frame for separately authored catch models',
);

const waysideShrine = readGlb('wayside_shrine_textured_v1.glb');
assert.equal(waysideShrine.json.nodes.length, 9, 'Wayside shrine node count changed');
assert.equal(waysideShrine.json.meshes.length, 9, 'Wayside shrine mesh count changed');
const waysideShrineTriangles = countTriangles(waysideShrine.json);
assert.equal(waysideShrineTriangles, 1_108, 'Wayside shrine triangle count changed');
assert.ok(
  waysideShrineTriangles >= 1_000 && waysideShrineTriangles <= 1_800,
  'Wayside shrine must stay within its 1,000-1,800 triangle gameplay budget',
);
assert.ok(
  waysideShrine.bytes.length < 500_000,
  'Wayside shrine runtime GLB should stay below 500 KB',
);
assert.equal(
  waysideShrine.json.asset.extras?.sourceGlb,
  'wayside_shrine_textured_v1.glb',
  'Wayside shrine runtime source provenance is missing',
);
assert.deepEqual(
  waysideShrine.json.images ?? [],
  [],
  'Wayside shrine must use the shared runtime atlas',
);
assertNames(waysideShrine.json, [
  'WS_Worn_Stepped_Plinth',
  'WS_Limewashed_Stone_Niche',
  'WS_Limewashed_Rear_Closure',
  'WS_Facade_Half_Columns',
  'WS_Marian_Icon_And_Votives',
  'WS_Timber_Gable_Canopy',
  'WS_Split_Shingle_Gable_Roof',
  'WS_Forged_Iron_Ridge_Cross',
  'WS_Worn_Roadside_Step',
]);
const waysideSourceIds = new Set(
  waysideShrine.json.nodes.map((node) => node.extras?.source_component_id),
);
assert.deepEqual(
  [...waysideSourceIds].sort(),
  [
    'civic_shrine_canopy',
    'civic_shrine_half_column_pair',
    'civic_shrine_iron_cross',
    'civic_shrine_niche_stone',
    'civic_shrine_plinth_stone',
    'civic_shrine_rear_wall_limewash_1p5m',
    'foundation_steps_limestone_1',
    'opening_shrine_icon_insert',
    'roof_shingle_shrine_gable_1p5m',
  ],
  'Wayside shrine component provenance changed',
);
assert.ok(
  !waysideSourceIds.has('civic_shrine_votive_ledge'),
  'Wayside shrine must not duplicate the icon insert votive ledge',
);
const waysideAtlasMaterials = (waysideShrine.json.materials ?? []).filter(
  (material) => material.extras?.atlas_id === 'gorski-building-atlas-v1',
);
const waysideAtlasTiles = new Set(
  waysideAtlasMaterials.map((material) => material.extras?.atlas_tile),
);
for (const tile of [
  'lime-plaster',
  'limestone-ashlar',
  'fieldstone-mortar',
  'rough-hewn-timber',
  'sawn-planks',
  'split-shingles',
  'wrought-iron',
  'aged-brass',
  'linen-canvas',
]) {
  assert.ok(waysideAtlasTiles.has(tile), `Wayside shrine must retain ${tile}`);
}
for (const material of waysideAtlasMaterials) {
  assert.equal(
    material.extras?.atlas_uv_mode,
    'final tile coordinates baked into GK_UV0',
    `${material.name} must not transform already-baked shrine UVs again`,
  );
}

const lumberMill = readGlb('lumber_mill_textured_v1.glb');
assert.equal(lumberMill.json.nodes.length, 49, 'Lumber mill node count changed');
assert.equal(lumberMill.json.meshes.length, 49, 'Lumber mill mesh count changed');
const lumberMillTriangles = countTriangles(lumberMill.json);
assert.equal(lumberMillTriangles, 3_632, 'Lumber mill triangle count changed');
assert.ok(
  lumberMillTriangles >= 3_200 && lumberMillTriangles <= 4_500,
  'Lumber mill must stay within its 3,200-4,500 triangle gameplay budget',
);
assert.ok(lumberMill.bytes.length < 500_000, 'Lumber mill runtime GLB should stay below 500 KB');
assert.equal(
  lumberMill.json.asset.extras?.sourceGlb,
  'lumber_mill_textured_v1.glb',
  'Lumber mill runtime source provenance is missing',
);
assert.deepEqual(lumberMill.json.images ?? [], [], 'Lumber mill must use the shared runtime atlas');
assertNames(lumberMill.json, [
  'LM_Front_West_Plank_Bay',
  'LM_Front_East_Plank_Bay',
  'LM_West_Six_Metre_Gable',
  'LM_East_King_Post_Truss',
  'LM_Front_Settled_Shingle_Slope',
  'LM_Rear_Settled_Shingle_Slope',
  'LM_Open_Intake_Canopy',
  'LM_Hand_Sawpit_And_Log_Frame',
  'LM_Sawyers_Tool_Rack',
  'LM_Timber_Transport_Cart',
]);
assert.equal(
  lumberMill.json.nodes.filter((node) => node.extras?.lm_collision === true).length,
  11,
  'Lumber mill collision-component count changed',
);
const lumberMillSourceIds = new Set(
  lumberMill.json.nodes.map((node) => node.extras?.source_component_id),
);
assert.deepEqual(
  [...lumberMillSourceIds].sort(),
  [
    'assembly_custom_settled_shingle_skin',
    'foundation_fieldstone_2m_h0p35m',
    'foundation_fieldstone_4m_h0p35m',
    'frame_beam_2m_s0p22m',
    'frame_beam_4m_s0p22m',
    'frame_gable_truss_6m',
    'frame_post_h3m_s0p22m',
    'gable_infill_timber_6m',
    'production_sawpit_frame',
    'prop_tool_rack_carpenter',
    'prop_two_wheel_cart',
    'site_canopy_timber_6m_d3m',
    'wall_plank_2m_h3m',
    'wall_plank_4m_h3m',
  ],
  'Lumber mill component provenance changed',
);
const lumberMillAtlasTiles = new Set(
  (lumberMill.json.materials ?? []).map((material) => material.extras?.atlas_tile),
);
for (const tile of [
  'fieldstone-mortar',
  'rough-hewn-timber',
  'weathered-planks',
  'sawn-planks',
  'split-shingles',
  'wrought-iron',
  'packed-earth',
]) {
  assert.ok(lumberMillAtlasTiles.has(tile), `Lumber mill must retain ${tile}`);
}
assert.doesNotMatch(
  (lumberMill.json.nodes ?? []).map((node) => node.name ?? '').join('|'),
  /circular|sawblade|TimberStockpile/i,
  'Lumber mill must not bake anachronistic machinery or runtime timber inventory',
);

const miningCamp = readGlb('mining_camp_textured_v1.glb');
assert.equal(miningCamp.json.nodes.length, 9, 'Mining Camp node count changed');
assert.equal(miningCamp.json.meshes.length, 9, 'Mining Camp mesh count changed');
const miningCampTriangles = countTriangles(miningCamp.json);
assert.equal(miningCampTriangles, 2_092, 'Mining Camp triangle count changed');
assert.ok(
  miningCampTriangles >= 1_900 && miningCampTriangles <= 2_600,
  'Mining Camp must stay within its 1,900-2,600 triangle gameplay budget',
);
assert.ok(miningCamp.bytes.length < 1_000_000, 'Mining Camp runtime GLB should stay below 1 MB');
assert.equal(
  miningCamp.json.asset.extras?.sourceGlb,
  'mining_camp_textured_v1.glb',
  'Mining Camp runtime source provenance is missing',
);
assert.deepEqual(
  (miningCamp.json.images ?? []).map((image) => image.name).sort(),
  ['aged_canvas_albedo', 'aged_canvas_normal'],
  'Mining Camp should keep only the dedicated aged-canvas albedo and normal maps',
);
for (const image of miningCamp.json.images ?? []) {
  assert.ok(typeof image.uri === 'string', `${image.name} must be an external runtime texture`);
  assert.equal(image.bufferView, undefined, `${image.name} must not remain embedded`);
}
assertNames(miningCamp.json, [
  'MiningCampDayShelter',
  'MiningCampSortingCanopy',
  'MiningCampSortingYard',
  'MiningCampSieveTable',
  'MiningCampHandcart',
  'MiningCampToolRack',
  'MiningCampWaterBuckets',
  'MiningCampSurveyStakes',
  'MiningCampSurveyStakesSecondary',
]);
assert.equal(
  miningCamp.json.nodes.filter((node) => node.extras?.mc_collision === true).length,
  5,
  'Mining Camp collision-component count changed',
);
const miningCampSourceIds = new Set(
  miningCamp.json.nodes.map((node) => node.extras?.source_component_id),
);
assert.deepEqual(
  [...miningCampSourceIds].sort(),
  [
    'extract_handcart',
    'extract_sieve_table',
    'extract_sorting_bench',
    'extract_survey_stakes',
    'prop_tool_rack_quarry',
    'prop_water_bucket_pair',
    'site_canopy_canvas_4m_d4m',
    'site_tent_a_frame_large',
  ],
  'Mining Camp component provenance changed',
);
const miningCampAtlasTiles = new Set(
  (miningCamp.json.materials ?? []).map((material) => material.extras?.atlas_tile),
);
for (const tile of [
  'aged-canvas',
  'linen-canvas',
  'rough-hewn-timber',
  'weathered-planks',
  'quarry-stone',
  'limestone-ashlar',
  'wrought-iron',
  'wicker-weave',
  'packed-earth',
]) {
  assert.ok(miningCampAtlasTiles.has(tile), `Mining Camp must retain ${tile}`);
}
assert.doesNotMatch(
  (miningCamp.json.nodes ?? []).map((node) => node.name ?? '').join('|'),
  /derrick|headframe|shaft|windlass|stockpile|segment|vegetation|crop/i,
  'Mining Camp must not bake deep-extraction machinery, inventory, or living vegetation',
);

const largeQuarry = readGlb('large_quarry_textured_v1.glb');
assert.equal(largeQuarry.json.nodes.length, 15, 'Large Quarry node count changed');
assert.equal(largeQuarry.json.meshes.length, 15, 'Large Quarry mesh count changed');
const largeQuarryTriangles = countTriangles(largeQuarry.json);
assert.equal(largeQuarryTriangles, 2_032, 'Large Quarry triangle count changed');
assert.ok(
  largeQuarryTriangles >= 1_900 && largeQuarryTriangles <= 2_200,
  'Large Quarry must stay within its 1,900-2,200 triangle gameplay budget',
);
assert.ok(largeQuarry.bytes.length < 500_000, 'Large Quarry runtime GLB should stay below 500 KB');
assert.equal(
  largeQuarry.json.asset.extras?.sourceGlb,
  'large_quarry_textured_v1.glb',
  'Large Quarry runtime source provenance is missing',
);
assert.deepEqual(largeQuarry.json.images ?? [], [], 'Large Quarry must use the shared runtime atlas');
assertNames(largeQuarry.json, [
  'LQ_Cut_Bench_Rear_West',
  'LQ_Cut_Bench_Rear_Centre',
  'LQ_Cut_Bench_Rear_East',
  'LQ_Cut_Bench_West_Return',
  'LQ_Cut_Bench_East_Return',
  'LQ_Large_Timber_Derrick',
  'LQ_Grounded_Hoist_Bucket',
  'LQ_Central_Plank_Causeway',
  'LQ_Access_Retaining_Wall_West',
  'LQ_Access_Retaining_Wall_East',
  'LQ_Shingle_Sorting_Canopy',
  'LQ_Stone_Sorting_Bench',
  'LQ_Stonecutters_Wedge_Rack',
  'LQ_Empty_Stone_Handcart',
  'LQ_Fixed_Quarry_Tool_Rack',
]);
assert.equal(
  largeQuarry.json.nodes.filter((node) => node.extras?.lq_collision === true).length,
  7,
  'Large Quarry collision-component count changed',
);
const largeQuarrySourceIds = new Set(
  largeQuarry.json.nodes.map((node) => node.extras?.source_component_id),
);
assert.deepEqual(
  [...largeQuarrySourceIds].sort(),
  [
    'extract_handcart',
    'extract_ore_bucket',
    'extract_quarry_bench_4m',
    'extract_quarry_derrick_large',
    'extract_quarry_wedge_rack',
    'extract_sorting_bench',
    'foundation_retaining_wall_4m',
    'prop_tool_rack_quarry',
    'site_canopy_timber_4m_d2m',
    'site_walkway_plank_4m',
  ],
  'Large Quarry component provenance changed',
);
const largeQuarryAtlasTiles = new Set(
  (largeQuarry.json.materials ?? []).map((material) => material.extras?.atlas_tile),
);
for (const tile of [
  'quarry-stone',
  'fieldstone-mortar',
  'limestone-ashlar',
  'rough-hewn-timber',
  'sawn-planks',
  'weathered-planks',
  'split-shingles',
  'wrought-iron',
  'packed-earth',
]) {
  assert.ok(largeQuarryAtlasTiles.has(tile), `Large Quarry must retain ${tile}`);
}
assert.doesNotMatch(
  (largeQuarry.json.nodes ?? []).map((node) => node.name ?? '').join('|'),
  /stockpile|segment|headframe|shaft|tunnel|mine.?portal|canvas|vegetation|crop/i,
  'Large Quarry must not bake runtime inventory, underground-mine vocabulary, canvas, or vegetation',
);

const mineworks = readGlb('mineworks_textured_v1.glb');
assert.equal(mineworks.json.nodes.length, 10, 'Mineworks node count changed');
assert.equal(mineworks.json.meshes.length, 10, 'Mineworks mesh count changed');
const mineworksTriangles = countTriangles(mineworks.json);
assert.equal(mineworksTriangles, 1_316, 'Mineworks triangle count changed');
assert.ok(
  mineworksTriangles >= 1_250 && mineworksTriangles <= 1_400,
  'Mineworks must stay within its 1,250-1,400 triangle gameplay budget',
);
assert.ok(mineworks.bytes.length < 250_000, 'Mineworks runtime GLB should stay below 250 KB');
assert.equal(
  mineworks.json.asset.extras?.sourceGlb,
  'mineworks_textured_v1.glb',
  'Mineworks runtime source provenance is missing',
);
assert.deepEqual(mineworks.json.images ?? [], [], 'Mineworks must use the shared runtime atlas');
assertNames(mineworks.json, [
  'MW_Deep_Square_Shaft_Collar',
  'MW_Tall_Timber_Winding_Headframe',
  'MW_Roadside_Shaft_Walkway',
  'MW_Grounded_Hoist_Bucket',
  'MW_Shingle_Ore_Sorting_Shelter',
  'MW_Hand_Sorting_Bench',
  'MW_Ore_And_Clay_Sieve',
  'MW_Empty_Ore_Handcart',
  'MW_Service_Water_Buckets',
  'MW_Fixed_Mining_Tool_Rack',
]);
assert.equal(
  mineworks.json.nodes.filter((node) => node.extras?.mw_collision === true).length,
  5,
  'Mineworks collision-component count changed',
);
const mineworksSourceIds = new Set(
  mineworks.json.nodes.map((node) => node.extras?.source_component_id),
);
assert.deepEqual(
  [...mineworksSourceIds].sort(),
  [
    'extract_handcart',
    'extract_headframe_large',
    'extract_ore_bucket',
    'extract_shaft_collar_square_large',
    'extract_sieve_table',
    'extract_sorting_bench',
    'prop_tool_rack_quarry',
    'prop_water_bucket_pair',
    'site_canopy_timber_6m_d3m',
    'site_walkway_plank_4m',
  ],
  'Mineworks component provenance changed',
);
const mineworksAtlasTiles = new Set(
  (mineworks.json.materials ?? []).map((material) => material.extras?.atlas_tile),
);
for (const tile of [
  'fieldstone-mortar',
  'quarry-stone',
  'limestone-ashlar',
  'rough-hewn-timber',
  'sawn-planks',
  'weathered-planks',
  'split-shingles',
  'wrought-iron',
  'packed-earth',
  'wicker-weave',
]) {
  assert.ok(mineworksAtlasTiles.has(tile), `Mineworks must retain ${tile}`);
}
assert.doesNotMatch(
  (mineworks.json.nodes ?? []).map((node) => node.name ?? '').join('|'),
  /stockpile|segment|quarry.?bench|derrick|canvas|motor|engine|steam|electric|vegetation|crop/i,
  'Mineworks must not bake runtime inventory, Quarry/mobile vocabulary, modern machinery, or vegetation',
);

const propsSource = readText('art-source/gorski-architecture-kit/kit/families/props.py');
const siteworksSource = readText('art-source/gorski-architecture-kit/kit/families/siteworks.py');
assert.match(propsSource, /field-cleaver/);
assert.match(propsSource, /def _rough_stump/);
assert.match(propsSource, /def _open_bucket/);
assert.match(siteworksSource, /def _hearth_rock/);
assert.match(siteworksSource, /Three thick, dark forest billets/);

const integrationSource = readText('src/buildings/authoredArchitectureModels.ts');
assert.match(integrationSource, /applyBuildingMaterialAtlasDirectUv/);
assert.match(integrationSource, /readAuthoredAtlasTint/);
assert.match(integrationSource, /readAuthoredSurfaceTint/);
assert.match(integrationSource, /readAuthoredWeatheringProfile/);
assert.match(
  readText('src/buildings/buildingMaterialAtlas.ts'),
  /sub\(authoredUv\.y\)/,
  'Direct Blender atlas UVs must account for Three texture flipY during sampling',
);
assert.match(integrationSource, /HuntersFoodStockpile/);
assert.match(integrationSource, /fpCollisionChildrenOnly/);
assert.match(readText('src/residences/ResidenceMarkers.ts'), /createAuthoredTierOneResidenceShell/);
assert.match(readText('src/buildings/BuildingMeshes.ts'), /createAuthoredHuntersCampMesh/);
assert.match(readText('src/buildings/BuildingMeshes.ts'), /createAuthoredFishingCampMesh/);
assert.match(readText('src/buildings/BuildingMeshes.ts'), /createAuthoredTierOneChurchMesh/);
assert.match(readText('src/buildings/BuildingMeshes.ts'), /createAuthoredWaysideShrineMesh/);
assert.match(readText('src/buildings/BuildingMeshes.ts'), /createAuthoredLumberMillMesh/);
assert.match(readText('src/buildings/BuildingMeshes.ts'), /createAuthoredMiningCampMesh/);
assert.match(readText('src/buildings/BuildingMeshes.ts'), /createAuthoredLargeQuarryMesh/);
assert.match(readText('src/buildings/BuildingMeshes.ts'), /createAuthoredMineworksMesh/);
assert.match(integrationSource, /createLumberMillRuntimeStockpile/);
assert.match(integrationSource, /addMiningCampRuntimeState/);
assert.match(integrationSource, /addLargeQuarryRuntimeState/);
assert.match(integrationSource, /addMineworksRuntimeState/);
assert.match(integrationSource, /addTierOneChurchRuntimeClock/);
assert.match(readText('src/buildings/chapelRuntimeClock.ts'), /churchClockHandAngles/);
assert.match(readText('src/app/settlementSchedulePresentation.ts'), /setChapelTowerClock\(schedule\.clock\)/);
assert.match(readText('src/app/appBootstrap.ts'), /preloadAuthoredArchitectureModels/);

console.log('Authored architecture GLB contract passed.');
console.log(`  Tier 1 residence: ${formatKiB(residence.bytes.length)}, 33 meshes, 5,184 tris`);
console.log(`  Tier 1 church: ${formatKiB(church.bytes.length)}, 84 meshes, ${churchTriangles.toLocaleString('en-US')} tris`);
console.log(`  Hunter's camp: ${formatKiB(camp.bytes.length)}, 15 meshes, ${campTriangles.toLocaleString('en-US')} tris`);
console.log(`  Fishing camp: ${formatKiB(fishingCamp.bytes.length)}, 59 meshes, ${fishingCampTriangles.toLocaleString('en-US')} tris`);
console.log(`  Wayside shrine: ${formatKiB(waysideShrine.bytes.length)}, 9 meshes, ${waysideShrineTriangles.toLocaleString('en-US')} tris`);
console.log(`  Lumber mill: ${formatKiB(lumberMill.bytes.length)}, 49 meshes, ${lumberMillTriangles.toLocaleString('en-US')} tris`);
console.log(`  Mining Camp: ${formatKiB(miningCamp.bytes.length)}, 9 meshes, ${miningCampTriangles.toLocaleString('en-US')} tris`);
console.log(`  Large Quarry: ${formatKiB(largeQuarry.bytes.length)}, 15 meshes, ${largeQuarryTriangles.toLocaleString('en-US')} tris`);
console.log(`  Mineworks: ${formatKiB(mineworks.bytes.length)}, 10 meshes, ${mineworksTriangles.toLocaleString('en-US')} tris`);

function readGlb(filename) {
  const bytes = fs.readFileSync(path.join(runtimeRoot, filename));
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, `${filename} is not a GLB`);
  assert.equal(bytes.readUInt32LE(4), 2, `${filename} is not glTF 2.0`);
  const jsonLength = bytes.readUInt32LE(12);
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, `${filename} has no JSON chunk`);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8').trimEnd());
  return { bytes, json };
}

function countTriangles(json) {
  let triangles = 0;
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const accessorIndex = primitive.indices ?? primitive.attributes?.POSITION;
      const count = json.accessors?.[accessorIndex]?.count ?? 0;
      const mode = primitive.mode ?? 4;
      if (mode === 4) triangles += count / 3;
      else if (mode === 5 || mode === 6) triangles += Math.max(0, count - 2);
      else assert.fail(`Unsupported primitive mode ${mode}`);
    }
  }
  return triangles;
}

function assertNames(json, expectedNames) {
  const names = new Set((json.nodes ?? []).map((node) => node.name));
  for (const name of expectedNames) assert.ok(names.has(name), `Missing authored node ${name}`);
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
