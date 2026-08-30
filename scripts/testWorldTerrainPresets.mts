import assert from 'node:assert/strict';
import { createWorldLayout } from '../src/resources/WorldLayout.ts';
import { KUPA_HYDRAULIC_GRADE } from '../src/rivers/RiverLayout.ts';
import {
  sampleNaturalTerrainHeight,
  setActiveQuarryLayout,
  setActiveRiverLayout,
} from '../src/terrain/TerrainHeight.ts';
import { setDraftWorldGeneration } from '../src/world/worldGenerationContext.ts';
import {
  DEFAULT_WORLD_GENERATION_SETTINGS,
  MAP_SIZE_PRESETS,
  normalizeWorldGenerationSettings,
  resolveWorldDimensions,
} from '../src/world/worldGenerationSettings.ts';
import {
  applyTerrainPreset,
  seedForTerrainPreset,
  terrainPresetFromSeed,
  type WorldTerrainPreset,
} from '../src/world/worldTerrainPresets.ts';
import {
  createLicPoljeHydrologyAnchors,
  licPoljeTerrainDebugWeights,
  parseLicPoljeTerrainFieldDebugMode,
  sampleLicPoljeTerrainFields,
} from '../src/terrain/LicPoljeTerrainField.ts';

const authoredPresets = [
  'kupa_valley',
  'risnjak_pass',
  'delnice_meadow',
  'vinodol_coast',
  'lic_polje',
] as const;

for (const [mapSize, preset] of Object.entries(MAP_SIZE_PRESETS)) {
  const dimensions = resolveWorldDimensions(mapSize as keyof typeof MAP_SIZE_PRESETS);
  assert.equal(
    dimensions.playableSize,
    dimensions.terrainSize,
    `${mapSize} terrain must remain playable across its full visible footprint`,
  );
  assert.equal(dimensions.playableHalf, dimensions.terrainSize * 0.5);
  assert.deepEqual(dimensions, {
    playableSize: preset.playableSize,
    terrainSize: preset.terrainSize,
    playableHalf: preset.playableHalf,
    generationSize: preset.generationSize,
    generationHalf: preset.generationHalf,
  });
}

const smallDimensions = resolveWorldDimensions('small');
assert.deepEqual(smallDimensions, {
  playableSize: 817,
  terrainSize: 817,
  playableHalf: 408.5,
  generationSize: 620,
  generationHalf: 310,
});
for (const [mapSize, expectedAreaScale] of [
  ['medium', 4],
  ['large', 8],
] as const) {
  const dimensions = resolveWorldDimensions(mapSize);
  assert.ok(
    Math.abs((dimensions.playableSize / smallDimensions.playableSize) ** 2 - expectedAreaScale)
      < 1e-9,
    `${mapSize} playable area must equal ${expectedAreaScale} small maps`,
  );
  assert.ok(
    Math.abs((dimensions.generationSize / smallDimensions.generationSize) ** 2 - expectedAreaScale)
      < 1e-9,
    `${mapSize} generation area must equal ${expectedAreaScale} small maps`,
  );
}

for (const [index, preset] of authoredPresets.entries()) {
  const seed = seedForTerrainPreset(0x1234_5678 + index * 0x1111, preset);
  assert.equal(terrainPresetFromSeed(seed), preset);
  assert.equal(normalizeWorldGenerationSettings({ seed }).terrainPreset, preset);
}

const customSeed = seedForTerrainPreset(
  seedForTerrainPreset(0x1234_5678, 'kupa_valley'),
  'custom',
);
assert.equal(terrainPresetFromSeed(customSeed), 'custom');

const kupa = preparePreset('kupa_valley', 0x13d_4a21);
const kupaDimensions = resolveWorldDimensions(kupa.settings.mapSize);
const kupaWaterWidth = sampleWaterWidth(kupa.layout.riverLayout, 0, kupaDimensions.playableHalf);
assert.ok(
  kupaWaterWidth >= 24 && kupaWaterWidth <= 38,
  `Kupa water width should stay close to the Gusti Laz scale, got ${kupaWaterWidth.toFixed(1)} m`,
);
const kupaCenterline = kupa.layout.riverLayout.corridors[0].points;
const kupaSurfaceElevations = kupaCenterline.map((point) => {
  const depth = kupa.layout.riverLayout.getWaterColumnDepth(point.x, point.z);
  assert.ok(depth !== null);
  const surface = kupa.layout.riverLayout.getWaterSurfaceOverride(point.x, point.z);
  assert.ok(surface !== null);
  return surface;
});
for (let index = 1; index < kupaSurfaceElevations.length; index += 1) {
  assert.ok(
    kupaSurfaceElevations[index] < kupaSurfaceElevations[index - 1],
    `Kupa hydraulic surface must fall downstream at segment ${index}`,
  );
}
const kupaHydraulicFall = kupaSurfaceElevations[0]
  - kupaSurfaceElevations[kupaSurfaceElevations.length - 1];
assert.ok(
  Math.abs(kupaHydraulicFall - kupaDimensions.terrainSize * KUPA_HYDRAULIC_GRADE) < 0.02,
  `Kupa hydraulic fall must match the authored grade, got ${kupaHydraulicFall.toFixed(3)} m`,
);
const kupaBenchRelief = sampleRelief(-45, 85, -55, 55, 13);
assert.ok(
  kupaBenchRelief <= 8,
  `Kupa village bench should remain buildable, got ${kupaBenchRelief.toFixed(1)} m relief`,
);
const kupaFloor = sampleNaturalTerrainHeight(35, 0);
const kupaWestMountain = sampleNaturalTerrainHeight(-kupaDimensions.generationHalf * 0.88, 0);
const kupaEastMountain = sampleNaturalTerrainHeight(kupaDimensions.generationHalf * 0.88, 0);
const kupaWestRise = kupaWestMountain - kupaFloor;
const kupaEastRise = kupaEastMountain - kupaFloor;
assert.ok(
  kupaWestRise >= 500,
  `Kupa west slope must rise at least 500 m above the valley floor, got ${kupaWestRise.toFixed(1)} m.`,
);
assert.ok(
  kupaEastRise >= 500,
  `Kupa east slope must rise at least 500 m above the valley floor, got ${kupaEastRise.toFixed(1)} m.`,
);
let kupaMinimumSideRise = Number.POSITIVE_INFINITY;
for (let index = 0; index < 12; index++) {
  const variation = preparePreset('kupa_valley', 0x23d_4a21 + index * 0x7919);
  const dimensions = resolveWorldDimensions(variation.settings.mapSize);
  const floor = sampleNaturalTerrainHeight(35, 0);
  const sideRise = Math.min(
    sampleNaturalTerrainHeight(-dimensions.generationHalf * 0.88, 0) - floor,
    sampleNaturalTerrainHeight(dimensions.generationHalf * 0.88, 0) - floor,
  );
  kupaMinimumSideRise = Math.min(kupaMinimumSideRise, sideRise);
}
assert.ok(
  kupaMinimumSideRise >= 500,
  `Kupa seeds must preserve 500 m valley walls, got a ${kupaMinimumSideRise.toFixed(1)} m minimum.`,
);

const customMountains = prepareCustom(100, 0x4d3a_91e7);
const customDimensions = resolveWorldDimensions(customMountains.settings.mapSize);
const customFloor = sampleNaturalTerrainHeight(0, 0);
const customShoulders = [
  sampleNaturalTerrainHeight(-customDimensions.generationHalf * 0.88, 0),
  sampleNaturalTerrainHeight(customDimensions.generationHalf * 0.88, 0),
  sampleNaturalTerrainHeight(0, -customDimensions.generationHalf * 0.88),
  sampleNaturalTerrainHeight(0, customDimensions.generationHalf * 0.88),
];
const customMountainRise = Math.max(...customShoulders) - customFloor;
assert.ok(
  customMountainRise >= 350,
  `Maximum custom topography must produce mountains at least 350 m above its central floor, got ${customMountainRise.toFixed(1)} m.`,
);

const risnjak = preparePreset('risnjak_pass', 0x7a2_1035);
const risnjakDimensions = resolveWorldDimensions(risnjak.settings.mapSize);
const passFloor = sampleNaturalTerrainHeight(0, 0);
const passShoulders = [
  sampleNaturalTerrainHeight(-risnjakDimensions.generationHalf * 0.82, 0),
  sampleNaturalTerrainHeight(risnjakDimensions.generationHalf * 0.82, 0),
  sampleNaturalTerrainHeight(0, -risnjakDimensions.generationHalf * 0.82),
  sampleNaturalTerrainHeight(0, risnjakDimensions.generationHalf * 0.82),
];
assert.ok(
  Math.max(...passShoulders) - passFloor >= 70,
  'Risnjak Pass must produce a materially higher mountain shoulder around its saddle.',
);
assert.ok(risnjak.layout.riverLayout.corridors.length >= 3, 'Risnjak Pass needs several headwaters.');

const delnice = preparePreset('delnice_meadow', 0x5d2_74b1);
const delniceDimensions = resolveWorldDimensions(delnice.settings.mapSize);
assert.equal(delnice.layout.riverLayout.corridors.length, 0, 'Delnice must not generate rivers.');
assert.equal(delnice.layout.riverLayout.inlandWaterBodies.length, 1);
assert.equal(delnice.layout.riverLayout.inlandWaterBodies[0]?.kind, 'pond');
const delniceWaterShare = sampleWaterShare(
  delnice.layout.riverLayout,
  delniceDimensions.playableHalf,
  161,
);
assert.ok(
  delniceWaterShare > 0 && delniceWaterShare < 0.01,
  `Delnice should have one small inland pond, got ${(delniceWaterShare * 100).toFixed(2)}% water.`,
);
assert.ok(
  delnice.layout.clayDepositLayout.sites.length >= 1,
  'Riverless Delnice must retain at least one physical upland clay source.',
);
assert.ok(
  delnice.layout.clayDepositLayout.sites.every((site) =>
    !delnice.layout.riverLayout.isWaterAt(site.x, site.z)
  ),
  'Delnice clay sources must remain dry instead of reintroducing hidden surface water.',
);
const delniceMeadowRelief = sampleRelief(-170, 170, -170, 170, 17);
assert.ok(
  delniceMeadowRelief <= 4,
  `Delnice's central meadow must stay broadly flat, got ${delniceMeadowRelief.toFixed(1)} m relief.`,
);
const delniceFloor = sampleNaturalTerrainHeight(0, 0);
const delniceBorderRise = Math.min(
  sampleNaturalTerrainHeight(-delniceDimensions.playableHalf * 0.92, 0) - delniceFloor,
  sampleNaturalTerrainHeight(delniceDimensions.playableHalf * 0.92, 0) - delniceFloor,
  sampleNaturalTerrainHeight(0, -delniceDimensions.playableHalf * 0.92) - delniceFloor,
  sampleNaturalTerrainHeight(0, delniceDimensions.playableHalf * 0.92) - delniceFloor,
);
assert.ok(
  delniceBorderRise >= 90,
  `Delnice needs mountains around every border, got a ${delniceBorderRise.toFixed(1)} m minimum rise.`,
);

const vinodol = preparePreset('vinodol_coast', 0x4b8_2c11);
const vinodolDimensions = resolveWorldDimensions(vinodol.settings.mapSize);
const coastalWaterShare = sampleWaterShare(
  vinodol.layout.riverLayout,
  vinodolDimensions.playableHalf,
  161,
);
assert.ok(
  coastalWaterShare >= 0.25 && coastalWaterShare <= 0.29,
  `Vinodol sea frontage should keep its authored share of the full map, got ${(coastalWaterShare * 100).toFixed(1)}%`,
);
const shoreline = vinodol.layout.riverLayout.getCoastalShoreX(0);
assert.notEqual(shoreline, null);
const seaX = (shoreline ?? 0) - 30;
assert.equal(vinodol.layout.riverLayout.getWaterSurfaceOverride(seaX, 0), -4.4);
assert.ok(
  sampleNaturalTerrainHeight(seaX, 0) < -5.5,
  'The Vinodol seabed must remain below the flat Adriatic water surface.',
);

const lic = preparePreset('lic_polje', 0x2a6_8f31);
const licDimensions = resolveWorldDimensions(lic.settings.mapSize);
assert.equal(lic.layout.riverLayout.corridors.length, 1, 'Ličko Polje needs one ponornica.');
assert.equal(
  lic.layout.riverLayout.inlandWaterBodies.length,
  0,
  'The Ličanka-like stream must disappear into its ponor without a terminal lake.',
);
const licAnchors = createLicPoljeHydrologyAnchors(
  {
    minX: -licDimensions.terrainSize * 0.5,
    maxX: licDimensions.terrainSize * 0.5,
    minZ: -licDimensions.terrainSize * 0.5,
    maxZ: licDimensions.terrainSize * 0.5,
  },
  lic.layout.riverLayout.seed,
);
assert.deepEqual(lic.layout.riverLayout.drain, licAnchors.ponor);
const licCorridor = lic.layout.riverLayout.corridors[0];
const licStart = licCorridor.points[0];
const licEnd = licCorridor.points[licCorridor.points.length - 1];
assert.ok(Math.hypot(licStart.x - licAnchors.spring.x, licStart.z - licAnchors.spring.z) < 0.01);
assert.ok(Math.hypot(licEnd.x - licAnchors.ponor.x, licEnd.z - licAnchors.ponor.z) < 0.01);
assert.ok(licEnd.halfWidth < 1, 'The stream should taper visibly as it enters the ponor.');
const pastPonorScale = 26 / Math.hypot(licEnd.x - licStart.x, licEnd.z - licStart.z);
const pastPonorX = licEnd.x + (licEnd.x - licStart.x) * pastPonorScale;
const pastPonorZ = licEnd.z + (licEnd.z - licStart.z) * pastPonorScale;
assert.equal(
  lic.layout.riverLayout.isWaterAt(pastPonorX, pastPonorZ),
  false,
  'Surface water must stop after the ponor.',
);
const licFloorRelief = sampleRelief(-190, 190, -190, 190, 19);
assert.ok(
  licFloorRelief <= 9,
  `Ličko Polje needs a broadly buildable basin floor, got ${licFloorRelief.toFixed(1)} m relief.`,
);
const licFloor = sampleNaturalTerrainHeight(0, 0);
const licBorderRise = Math.min(
  sampleNaturalTerrainHeight(-licDimensions.playableHalf * 0.94, 0) - licFloor,
  sampleNaturalTerrainHeight(licDimensions.playableHalf * 0.94, 0) - licFloor,
  sampleNaturalTerrainHeight(0, -licDimensions.playableHalf * 0.94) - licFloor,
  sampleNaturalTerrainHeight(0, licDimensions.playableHalf * 0.94) - licFloor,
);
assert.ok(
  licBorderRise >= 95,
  `Ličko Polje needs a mountain rim around the basin, got ${licBorderRise.toFixed(1)} m.`,
);
let licMaximumFloorRelief = licFloorRelief;
let licMinimumSeededBorderRise = licBorderRise;
for (let index = 0; index < 8; index++) {
  const variation = preparePreset('lic_polje', 0x318_4f72 + index * 0x8d31);
  const dimensions = resolveWorldDimensions(variation.settings.mapSize);
  const floorRelief = sampleRelief(-190, 190, -190, 190, 19);
  const floor = sampleNaturalTerrainHeight(0, 0);
  const borderRise = Math.min(
    sampleNaturalTerrainHeight(-dimensions.playableHalf * 0.94, 0) - floor,
    sampleNaturalTerrainHeight(dimensions.playableHalf * 0.94, 0) - floor,
    sampleNaturalTerrainHeight(0, -dimensions.playableHalf * 0.94) - floor,
    sampleNaturalTerrainHeight(0, dimensions.playableHalf * 0.94) - floor,
  );
  licMaximumFloorRelief = Math.max(licMaximumFloorRelief, floorRelief);
  licMinimumSeededBorderRise = Math.min(licMinimumSeededBorderRise, borderRise);
  assert.equal(variation.layout.riverLayout.corridors.length, 1);
  assert.equal(variation.layout.riverLayout.inlandWaterBodies.length, 0);
}
assert.ok(
  licMaximumFloorRelief <= 9,
  `Ličko Polje seeds must preserve the buildable basin, got ${licMaximumFloorRelief.toFixed(1)} m relief.`,
);
assert.ok(
  licMinimumSeededBorderRise >= 95,
  `Ličko Polje seeds must preserve the mountain rim, got ${licMinimumSeededBorderRise.toFixed(1)} m.`,
);
const licFields = sampleLicPoljeTerrainFields(
  licAnchors.ponor.x,
  licAnchors.ponor.z,
  {
    minX: -licDimensions.terrainSize * 0.5,
    maxX: licDimensions.terrainSize * 0.5,
    minZ: -licDimensions.terrainSize * 0.5,
    maxZ: licDimensions.terrainSize * 0.5,
  },
  1,
  lic.layout.riverLayout.seed,
);
assert.ok(licFields.ponorBowl > 0.9, 'The shared terrain field must locate the ponor bowl.');
assert.equal(parseLicPoljeTerrainFieldDebugMode('?lic-polje-debug=ponor'), 'ponor');
assert.equal(parseLicPoljeTerrainFieldDebugMode('?lic-polje-debug=unknown'), 'final');
assert.notEqual(licPoljeTerrainDebugWeights(licFields, 'composite'), null);

console.log('world terrain preset tests passed', {
  kupaWaterWidth: Number(kupaWaterWidth.toFixed(1)),
  kupaHydraulicFall: Number(kupaHydraulicFall.toFixed(2)),
  kupaBenchRelief: Number(kupaBenchRelief.toFixed(1)),
  kupaWestRise: Number(kupaWestRise.toFixed(1)),
  kupaEastRise: Number(kupaEastRise.toFixed(1)),
  kupaMinimumSideRise: Number(kupaMinimumSideRise.toFixed(1)),
  customMountainRise: Number(customMountainRise.toFixed(1)),
  risnjakShoulderRise: Number((Math.max(...passShoulders) - passFloor).toFixed(1)),
  delniceMeadowRelief: Number(delniceMeadowRelief.toFixed(1)),
  delniceMinimumBorderRise: Number(delniceBorderRise.toFixed(1)),
  vinodolWaterPercent: Number((coastalWaterShare * 100).toFixed(1)),
  licFloorRelief: Number(licFloorRelief.toFixed(1)),
  licMinimumBorderRise: Number(licBorderRise.toFixed(1)),
  licMaximumSeededFloorRelief: Number(licMaximumFloorRelief.toFixed(1)),
  licMinimumSeededBorderRise: Number(licMinimumSeededBorderRise.toFixed(1)),
});

function preparePreset(preset: Exclude<WorldTerrainPreset, 'custom'>, variation: number) {
  const settings = applyTerrainPreset(
    {
      ...DEFAULT_WORLD_GENERATION_SETTINGS,
      seed: variation,
      mapSize: 'medium',
    },
    preset,
  );
  setDraftWorldGeneration(settings);
  const layout = createWorldLayout(settings);
  setActiveRiverLayout(layout.riverLayout);
  setActiveQuarryLayout(null);
  return { settings, layout };
}

function prepareCustom(topography: number, seed: number) {
  const settings = normalizeWorldGenerationSettings({
    ...DEFAULT_WORLD_GENERATION_SETTINGS,
    seed: seedForTerrainPreset(seed, 'custom'),
    mapSize: 'medium',
    topography,
  });
  setDraftWorldGeneration(settings);
  const layout = createWorldLayout(settings);
  setActiveRiverLayout(layout.riverLayout);
  setActiveQuarryLayout(null);
  return { settings, layout };
}

function sampleWaterWidth(
  layout: ReturnType<typeof createWorldLayout>['riverLayout'],
  z: number,
  playableHalf: number,
): number {
  const step = 0.5;
  let wetSamples = 0;
  for (let x = -playableHalf; x <= playableHalf; x += step) {
    if (layout.isWaterAt(x, z)) wetSamples += 1;
  }
  return wetSamples * step;
}

function sampleWaterShare(
  layout: ReturnType<typeof createWorldLayout>['riverLayout'],
  playableHalf: number,
  resolution: number,
): number {
  let wet = 0;
  let total = 0;
  for (let zi = 0; zi < resolution; zi++) {
    const z = -playableHalf + (zi / (resolution - 1)) * playableHalf * 2;
    for (let xi = 0; xi < resolution; xi++) {
      const x = -playableHalf + (xi / (resolution - 1)) * playableHalf * 2;
      if (layout.isWaterAt(x, z)) wet += 1;
      total += 1;
    }
  }
  return wet / total;
}

function sampleRelief(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  resolution: number,
): number {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let zi = 0; zi < resolution; zi++) {
    const z = minZ + (zi / (resolution - 1)) * (maxZ - minZ);
    for (let xi = 0; xi < resolution; xi++) {
      const x = minX + (xi / (resolution - 1)) * (maxX - minX);
      const height = sampleNaturalTerrainHeight(x, z);
      min = Math.min(min, height);
      max = Math.max(max, height);
    }
  }
  return max - min;
}
