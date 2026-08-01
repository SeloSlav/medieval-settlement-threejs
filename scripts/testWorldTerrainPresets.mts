import assert from 'node:assert/strict';
import { createWorldLayout } from '../src/resources/WorldLayout.ts';
import {
  sampleNaturalTerrainHeight,
  setActiveQuarryLayout,
  setActiveRiverLayout,
} from '../src/terrain/TerrainHeight.ts';
import { setDraftWorldGeneration } from '../src/world/worldGenerationContext.ts';
import {
  DEFAULT_WORLD_GENERATION_SETTINGS,
  normalizeWorldGenerationSettings,
  resolveWorldDimensions,
} from '../src/world/worldGenerationSettings.ts';
import {
  applyTerrainPreset,
  seedForTerrainPreset,
  terrainPresetFromSeed,
  type WorldTerrainPreset,
} from '../src/world/worldTerrainPresets.ts';

const authoredPresets = ['kupa_valley', 'risnjak_pass', 'vinodol_coast'] as const;

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
const kupaBenchRelief = sampleRelief(-45, 85, -55, 55, 13);
assert.ok(
  kupaBenchRelief <= 8,
  `Kupa village bench should remain buildable, got ${kupaBenchRelief.toFixed(1)} m relief`,
);
const kupaFloor = sampleNaturalTerrainHeight(35, 0);
const kupaWestMountain = sampleNaturalTerrainHeight(-kupaDimensions.playableHalf * 0.88, 0);
const kupaEastMountain = sampleNaturalTerrainHeight(kupaDimensions.playableHalf * 0.88, 0);
assert.ok(kupaWestMountain - kupaFloor >= 55, 'Kupa west slope must enclose the valley floor.');
assert.ok(kupaEastMountain - kupaFloor >= 55, 'Kupa east slope must enclose the valley floor.');

const risnjak = preparePreset('risnjak_pass', 0x7a2_1035);
const risnjakDimensions = resolveWorldDimensions(risnjak.settings.mapSize);
const passFloor = sampleNaturalTerrainHeight(0, 0);
const passShoulders = [
  sampleNaturalTerrainHeight(-risnjakDimensions.playableHalf * 0.82, 0),
  sampleNaturalTerrainHeight(risnjakDimensions.playableHalf * 0.82, 0),
  sampleNaturalTerrainHeight(0, -risnjakDimensions.playableHalf * 0.82),
  sampleNaturalTerrainHeight(0, risnjakDimensions.playableHalf * 0.82),
];
assert.ok(
  Math.max(...passShoulders) - passFloor >= 70,
  'Risnjak Pass must produce a materially higher mountain shoulder around its saddle.',
);
assert.ok(risnjak.layout.riverLayout.corridors.length >= 3, 'Risnjak Pass needs several headwaters.');

const vinodol = preparePreset('vinodol_coast', 0x4b8_2c11);
const vinodolDimensions = resolveWorldDimensions(vinodol.settings.mapSize);
const coastalWaterShare = sampleWaterShare(
  vinodol.layout.riverLayout,
  vinodolDimensions.playableHalf,
  161,
);
assert.ok(
  coastalWaterShare >= 0.17 && coastalWaterShare <= 0.23,
  `Vinodol sea should cover about one fifth of the playable map, got ${(coastalWaterShare * 100).toFixed(1)}%`,
);
const shoreline = vinodol.layout.riverLayout.getCoastalShoreX(0);
assert.notEqual(shoreline, null);
const seaX = (shoreline ?? 0) - 30;
assert.equal(vinodol.layout.riverLayout.getWaterSurfaceOverride(seaX, 0), -4.4);
assert.ok(
  sampleNaturalTerrainHeight(seaX, 0) < -5.5,
  'The Vinodol seabed must remain below the flat Adriatic water surface.',
);

console.log('world terrain preset tests passed', {
  kupaWaterWidth: Number(kupaWaterWidth.toFixed(1)),
  kupaBenchRelief: Number(kupaBenchRelief.toFixed(1)),
  risnjakShoulderRise: Number((Math.max(...passShoulders) - passFloor).toFixed(1)),
  vinodolWaterPercent: Number((coastalWaterShare * 100).toFixed(1)),
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
