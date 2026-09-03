import assert from 'node:assert/strict';
import { createWorldLayout } from '../src/resources/WorldLayout.ts';
import { KUPA_HYDRAULIC_GRADE, RiverLayout } from '../src/rivers/RiverLayout.ts';
import {
  sampleNaturalTerrainHeight,
  sampleWorldRawTerrainHeight,
  setActiveQuarryLayout,
  setActiveRiverLayout,
} from '../src/terrain/TerrainHeight.ts';
import { setDraftWorldGeneration } from '../src/world/worldGenerationContext.ts';
import {
  DEFAULT_WORLD_GENERATION_SETTINGS,
  MAP_SIZE_PRESETS,
  normalizeWorldGenerationSettings,
  resolveWorldDimensions,
  type WorldMapSize,
} from '../src/world/worldGenerationSettings.ts';
import {
  applyTerrainPreset,
  isTerrainPresetAvailableForMapSize,
  seedForTerrainPreset,
  terrainPresetFromSeed,
  SMALL_MAP_FALLBACK_TERRAIN_PRESET,
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
  'gomirje_meadows',
  'mrkopalj_polje',
] as const;

for (const preset of authoredPresets) {
  assert.equal(isTerrainPresetAvailableForMapSize(preset, 'medium'), true);
  assert.equal(isTerrainPresetAvailableForMapSize(preset, 'large'), true);
}
assert.equal(isTerrainPresetAvailableForMapSize('kupa_valley', 'small'), false);
assert.equal(isTerrainPresetAvailableForMapSize('vinodol_coast', 'small'), false);
assert.equal(isTerrainPresetAvailableForMapSize('risnjak_pass', 'small'), false);
for (const preset of ['gomirje_meadows', 'mrkopalj_polje', 'custom'] as const) {
  assert.equal(isTerrainPresetAvailableForMapSize(preset, 'small'), true);
}

for (const restrictedPreset of ['kupa_valley', 'vinodol_coast', 'risnjak_pass', 'delnice_meadow', 'lic_polje'] as const) {
  assert.equal(isTerrainPresetAvailableForMapSize(restrictedPreset, 'small'), false);
  const normalized = normalizeWorldGenerationSettings({
    seed: seedForTerrainPreset(0x1234_5678, restrictedPreset),
    mapSize: 'small',
  });
  assert.equal(normalized.terrainPreset, SMALL_MAP_FALLBACK_TERRAIN_PRESET);
  assert.equal(terrainPresetFromSeed(normalized.seed), SMALL_MAP_FALLBACK_TERRAIN_PRESET);
  assert.ok(normalized.topography <= 15, 'Small-map fallback must replace the mountain settings.');
}

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

const flatlandMetrics: object[] = [];
for (const preset of ['gomirje_meadows', 'mrkopalj_polje'] as const) {
  for (const mapSize of ['small', 'medium', 'large'] as const) {
    for (const variation of [0, 0x714b2, 0xfffff]) {
      const { settings, layout } = preparePreset(preset, variation, mapSize);
      const dims = resolveWorldDimensions(mapSize);
      const water = layout.riverLayout;
      const label = [preset, mapSize, variation].join('/');
      const heightAt = (x: number, z: number) => sampleWorldRawTerrainHeight(x, z, settings, dims, water)
        - water.getValleyDepression(x, z);
      assert.deepEqual(RiverLayout.fromSerialized(water.serialize()).serialize(), water.serialize());
      assert.equal(water.isWaterAt(0, 0), false, label + ': founding centre must be dry');
      assert.equal(water.corridors.length, preset === 'gomirje_meadows' ? 1 : 0);
      assert.equal(water.inlandWaterBodies.length, preset === 'mrkopalj_polje' ? 1 : 0);
      const waterShare = sampleWaterShare(water, dims.playableHalf, 161);
      assert.ok(waterShare > 0 && waterShare < 0.035, label + ': water must leave the field open');
      let drySamples = 0;
      let gentleSamples = 0;
      let edgeSamples = 0;
      let gentleEdgeSamples = 0;
      let minHeight = Infinity;
      let maxHeight = -Infinity;
      const resolution = 81;
      for (let zi = 0; zi < resolution; zi++) {
        const z = -dims.playableHalf + zi / (resolution - 1) * dims.playableSize;
        for (let xi = 0; xi < resolution; xi++) {
          const x = -dims.playableHalf + xi / (resolution - 1) * dims.playableSize;
          if (water.isWaterAt(x, z)) continue;
          const height = heightAt(x, z);
          minHeight = Math.min(minHeight, height);
          maxHeight = Math.max(maxHeight, height);
          const grade = Math.hypot(
            (heightAt(x + 3, z) - heightAt(x - 3, z)) / 6,
            (heightAt(x, z + 3) - heightAt(x, z - 3)) / 6,
          );
          const gentle = grade < 0.08;
          drySamples++;
          if (gentle) gentleSamples++;
          if (Math.max(Math.abs(x), Math.abs(z)) >= dims.playableHalf * 0.8) {
            edgeSamples++;
            if (gentle) gentleEdgeSamples++;
          }
        }
      }
      assert.ok(maxHeight - minHeight < 7, label + ': entire field must have low relief');
      assert.ok(gentleSamples / drySamples > 0.97, label + ': at least 97% of dry ground must be gently graded');
      assert.ok(gentleEdgeSamples / edgeSamples > 0.97, label + ': map edges must remain gently graded');
      assert.ok(layout.foragingLayout.sites.some(site => site.kind === 'fish'), label + ': water needs fish');
      assert.equal(layout.clayDepositLayout.sites.length, layout.resourcePlan.ordinaryClayDepositCount + layout.resourcePlan.richClayDepositCount, label + ': all rolled clay deposits must be placed');
      for (const site of [...layout.clayDepositLayout.sites, ...layout.quarryLayout.sites, ...layout.mineralDepositLayout.sites]) {
        assert.equal(water.isWaterAt(site.x, site.z), false, label + ': deposits need dry ground');
        assert.ok(layout.resourceTerrainAccessibility.isAccessible(site.x, site.z), label + ': deposits must be reachable');
      }
      if (preset === 'gomirje_meadows') {
        const points = water.corridors[0].points;
        assert.ok(points[0].x < -dims.playableHalf && points.at(-1)!.x > dims.playableHalf);
        let previousSurface = Infinity;
        for (const point of points) {
          const surface = water.getWaterSurfaceOverride(point.x, point.z)!;
          assert.ok(surface < previousSurface, label + ': river must fall downstream');
          assert.ok(surface - heightAt(point.x, point.z) > 1.5, label + ': river bed must stay submerged');
          previousSurface = surface;
        }
      } else {
        const pond = water.inlandWaterBodies[0];
        assert.equal(pond.kind, 'pond');
        const surface = water.getWaterSurfaceOverride(pond.x, pond.z)!;
        for (const dx of [-8, 0, 8]) {
          for (const dz of [-8, 0, 8]) {
            assert.equal(water.getWaterSurfaceOverride(pond.x + dx, pond.z + dz), surface);
            assert.ok(surface - heightAt(pond.x + dx, pond.z + dz) > 1, label + ': pond bed must stay submerged');
          }
        }
      }
      flatlandMetrics.push({ preset, mapSize, variation,
        gentleDryPercent: +(gentleSamples / drySamples * 100).toFixed(2),
        gentleEdgePercent: +(gentleEdgeSamples / edgeSamples * 100).toFixed(2),
        relief: +(maxHeight - minHeight).toFixed(2),
        waterPercent: +(waterShare * 100).toFixed(2),
      });
    }
  }
}
console.table(flatlandMetrics);

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

function preparePreset(preset: Exclude<WorldTerrainPreset, 'custom'>, variation: number, mapSize: WorldMapSize = 'medium') {
  const settings = applyTerrainPreset(
    {
      ...DEFAULT_WORLD_GENERATION_SETTINGS,
      seed: variation,
      mapSize,
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
