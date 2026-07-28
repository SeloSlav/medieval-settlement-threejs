import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { EnvironmentState } from '../src/world/seasonPolicy.ts';
import {
  precipitationPreviewEnvironment,
  precipitationProfile,
  roadWeatherProfile,
  standalonePrecipitationPreview,
} from '../src/weather/precipitationPolicy.ts';
import {
  applyVisualQaClock,
  applyVisualQaEnvironment,
  parseVisualQaConditions,
} from '../src/app/visualQaConditions.ts';
import { gameClockAtElapsedSeconds } from '../src/world/gameCalendar.ts';

function environment(
  weather: EnvironmentState['weather'],
  season: EnvironmentState['season'] = weather === 'frost'
    ? 'winter'
    : weather === 'drought'
      ? 'summer'
      : 'spring',
): EnvironmentState {
  return {
    season,
    weather,
    cropGrowthMultiplier: 1,
    firewoodDemandMultiplier: 1,
    pastureCapacityMultiplier: 1,
    freshFoodSpoilageFractionPerDay: 0,
    roadTravelSpeedMultiplier: 1,
  };
}

const fair = precipitationProfile(environment('fair'));
const rain = precipitationProfile(environment('rain'));
const snow = precipitationProfile(environment('frost'));
const drought = precipitationProfile(environment('drought'));

assert.equal(fair.kind, 'none');
assert.equal(fair.intensity, 0);
assert.equal(fair.wetness, 0);
assert.equal(rain.kind, 'rain');
assert.equal(rain.intensity, 0.78);
assert.equal(rain.wetness, 1);
assert.ok(rain.fallSpeed > snow.fallSpeed * 4);
assert.equal(rain.sunlightMultiplier, 0.32);
assert.equal(rain.fogDensityMultiplier, 1.38);
assert.equal(rain.saturationMultiplier, 0.74);
assert.equal(snow.kind, 'snow');
assert.equal(snow.intensity, 0.78);
assert.equal(snow.wetness, 0);
assert.equal(snow.sunlightMultiplier, 0.8);
assert.equal(snow.fogDensityMultiplier, 1.02);
assert.equal(snow.fogTint, 0xc6d4db);
assert.equal(snow.saturationMultiplier, 0.97);
assert.equal(rain.intensity, snow.intensity);
assert.ok(rain.fogDensityMultiplier > snow.fogDensityMultiplier);
assert.equal(drought.kind, 'none');
assert.ok(drought.sunlightMultiplier > 1);
assert.equal(precipitationPreviewEnvironment(environment('fair'), '?weather=rain').weather, 'rain');
assert.equal(precipitationPreviewEnvironment(environment('fair'), '?weather=snow').weather, 'frost');
assert.equal(
  precipitationPreviewEnvironment(environment('fair'), '?weather=autumn').season,
  'autumn',
);
assert.equal(precipitationPreviewEnvironment(environment('rain'), '?weather=clear').weather, 'fair');
assert.equal(standalonePrecipitationPreview('?weather=snow')?.season, 'winter');
assert.equal(standalonePrecipitationPreview('?weather=autumn')?.season, 'autumn');
assert.equal(standalonePrecipitationPreview('?weather=clear'), null);

const daylightQa = parseVisualQaConditions('?visualQa=daylight');
const moonlightQa = parseVisualQaConditions('?visualQa=moonlight');
const rainQa = parseVisualQaConditions('?visualQa=rain');
const winterQa = parseVisualQaConditions('?visualQa=winter');
assert.equal(parseVisualQaConditions('?visualQa=unknown'), null);
assert.ok(daylightQa);
assert.ok(moonlightQa);
assert.ok(rainQa);
assert.ok(winterQa);
assert.deepEqual(
  {
    season: applyVisualQaEnvironment(environment('frost'), daylightQa).season,
    weather: applyVisualQaEnvironment(environment('frost'), daylightQa).weather,
  },
  { season: 'summer', weather: 'fair' },
);
assert.deepEqual(
  {
    season: applyVisualQaEnvironment(environment('fair'), rainQa).season,
    weather: applyVisualQaEnvironment(environment('fair'), rainQa).weather,
  },
  { season: 'spring', weather: 'rain' },
);
assert.deepEqual(
  {
    season: applyVisualQaEnvironment(environment('rain'), winterQa).season,
    weather: applyVisualQaEnvironment(environment('rain'), winterQa).weather,
  },
  { season: 'winter', weather: 'frost' },
);
const daylightClock = applyVisualQaClock(gameClockAtElapsedSeconds(0), daylightQa);
const moonlightClock = applyVisualQaClock(gameClockAtElapsedSeconds(0), moonlightQa);
assert.deepEqual(
  [daylightClock.month, daylightClock.monthDay, daylightClock.hour, daylightClock.minute],
  [6, 15, 13, 0],
);
assert.deepEqual(
  [moonlightClock.month, moonlightClock.monthDay, moonlightClock.hour, moonlightClock.minute],
  [8, 15, 23, 0],
);
assert.equal(daylightClock.isWorkHours, true);
assert.equal(moonlightClock.isWorkHours, false);

const fairRoad = roadWeatherProfile(environment('fair'));
const rainRoad = roadWeatherProfile(environment('rain'));
const autumnRoad = roadWeatherProfile(environment('fair', 'autumn'));
const frostRoad = roadWeatherProfile(environment('frost'));
assert.deepEqual(fairRoad, { wetness: 0, frost: 0 });
assert.deepEqual(rainRoad, { wetness: 1, frost: 0 });
assert.ok(autumnRoad.wetness > 0 && autumnRoad.wetness < rainRoad.wetness);
assert.deepEqual(frostRoad, { wetness: 0, frost: 1 });

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const rendererSource = readFileSync(
  `${projectRoot}src/weather/PrecipitationRenderer.ts`,
  'utf8',
);
const rendererBackendSource = readFileSync(
  `${projectRoot}src/scene/RendererBackend.ts`,
  'utf8',
);
const sceneSource = readFileSync(`${projectRoot}src/scene/SceneManager.ts`, 'utf8');
const appSource = readFileSync(`${projectRoot}src/app/App.ts`, 'utf8');
const roadMaterialSource = readFileSync(
  `${projectRoot}src/roads/RoadSurfaceMaterial.ts`,
  'utf8',
);
const roadFactorySource = readFileSync(
  `${projectRoot}src/roads/RoadMaterialFactory.ts`,
  'utf8',
);
const terrainMaterialSource = readFileSync(
  `${projectRoot}src/terrain/TerrainGrassMaterial.ts`,
  'utf8',
);
const terrainSource = readFileSync(`${projectRoot}src/terrain/Terrain.ts`, 'utf8');
const roadEdgeMaterialSource = exportedFunctionSource(
  roadMaterialSource,
  'createRoadEdgeMaterial',
);
const riverBankMaterialSource = exportedFunctionSource(
  roadMaterialSource,
  'createRiverBankMaterial',
);
const roadEdgeOpacitySource = localFunctionSource(
  roadMaterialSource,
  'buildBankOpacityNode',
);
const riverBankOpacitySource = localFunctionSource(
  roadMaterialSource,
  'buildRiverBankOpacityNode',
);
const riverSystemSource = readFileSync(`${projectRoot}src/rivers/RiverSystem.ts`, 'utf8');

assert.match(rendererSource, /Two identical vertical tiles prevent a visible empty band/);
assert.match(
  sceneSource,
  /this\.terrain\.mesh\.receiveShadow\s*=\s*true/,
  'terrain must receive the complete tree and building shadow atlas in every weather state',
);
assert.doesNotMatch(
  sceneSource,
  /receiveShadow\s*=\s*environment\.weather\s*!==\s*'rain'/,
  'rain must not disable the complete tree shadow system',
);
assert.match(
  rendererBackendSource,
  /renderer\.shadowMap\.type\s*=\s*THREE\.PCFSoftShadowMap/,
  'tree shadows must retain the original soft PCF filtering',
);
assert.match(
  riverSystemSource,
  /reedsGroup\.visible\s*=\s*firstPersonActive\s*===\s*true\s*\|\|\s*isReedZoomActive\(cameraDistance\)/,
  'the parent reed group must enforce close-or-first-person LOD',
);
assert.match(rendererSource, /const RAIN_BASE_PARTICLES = 1_800/);
assert.match(rendererSource, /const SNOW_BASE_PARTICLES = 1_400/);
assert.match(rendererSource, /const VOLUME_FORWARD_BIAS_FRACTION = 0\.32/);
assert.match(rendererSource, /const RAIN_NEAR_EXCLUSION_FRACTION = 0\.3/);
assert.match(rendererSource, /const SNOW_NEAR_EXCLUSION_FRACTION = 0\.18/);
assert.match(rendererSource, /const OVERVIEW_MIN_VOLUME_RADIUS = 60/);
assert.match(rendererSource, /const OVERVIEW_VOLUME_RADIUS_SCALE = 0\.78/);
assert.match(rendererSource, /const OVERVIEW_MAX_VOLUME_RADIUS = 185/);
assert.match(rendererSource, /const halfHeight = 0\.42/);
assert.match(rendererSource, /const halfWidth = 0\.06/);
assert.match(rendererSource, /alphaTest:\s*kind === 'rain' \? 0\.012 : 0\.035/);
assert.match(rendererSource, /distance \* distance\) \/ 0\.028/);
assert.match(rendererSource, /'Procedural rain streak sprite',\s*false/);
assert.match(rendererSource, /this\.camera\.getWorldDirection\(this\.horizontalCameraForward\)/);
assert.match(rendererSource, /this\.group\.rotation\.y = Math\.atan2/);
assert.match(rendererSource, /BASE_VOLUME_RADIUS \* VOLUME_FORWARD_BIAS_FRACTION/);
assert.match(rendererSource, /minimumNearDistance = BASE_VOLUME_RADIUS \* nearExclusion/);
assert.match(rendererSource, /0xa9c3d1,\s*0\.72,\s*0\.52/);
assert.match(rendererSource, /0xcbdde5,\s*1\.02,\s*0\.36/);
assert.match(rendererSource, /0xe6eef2,\s*0\.32,\s*0\.58/);
assert.match(rendererSource, /0xf1f5f6,\s*0\.43,\s*0\.4/);
assert.match(rendererSource, /radius \* radius\) \/ 0\.075/);
assert.match(rendererSource, /Math\.abs\(Math\.cos\(angle \* 3\)\), 18/);
assert.match(
  rendererSource,
  /texture\.minFilter = generateMipmaps\s*\?\s*THREE\.LinearMipmapLinearFilter\s*:\s*THREE\.LinearFilter/,
);
assert.equal(
  (rendererSource.match(/this\.createLayer\('rain'/g) ?? []).length,
  2,
  'rain must remain two instanced draw layers',
);
assert.equal(
  (rendererSource.match(/this\.createLayer\('snow'/g) ?? []).length,
  2,
  'snow must remain two instanced draw layers',
);
assert.match(rendererSource, /depthWrite:\s*false/);
assert.match(rendererSource, /depthTest:\s*true/);
assert.match(rendererSource, /mesh\.frustumCulled\s*=\s*false/);
assert.doesNotMatch(
  rendererSource,
  /position\.needsUpdate/,
  'precipitation must animate layer transforms without per-frame particle-buffer uploads',
);
assert.match(sceneSource, /this\.precipitation\.update\(dt,\s*cameraDistance,\s*firstPersonActive\)/);
assert.match(sceneSource, /this\.materials\.updateWeather\(dt\)/);
assert.match(sceneSource, /this\.materials\.setEnvironment\(environment\)/);
assert.doesNotMatch(
  sceneSource,
  /WeatherSurfaceMaterials|weatherSurfaceMaterials/,
  'weather must not fan out global standard-material shader variants',
);
assert.match(sceneSource, /fog\.density\s*=\s*state\.fogDensity\s*\*\s*weather\.fogDensityMultiplier/);
assert.match(sceneSource, /0\.00042,\s*0\.001,/);
assert.match(
  appSource,
  /precipitationPreviewEnvironment\(environment,\s*window\.location\.search\)/,
);
assert.match(
  appSource,
  /this\.sceneManager\?\.setEnvironment\(presentationEnvironment\)/,
);
assert.match(roadMaterialSource, /weather\.wetness/);
assert.match(roadMaterialSource, /weather\.frost/);
assert.match(roadMaterialSource, /applyRoadWeatherRoughness/);
assert.match(
  roadEdgeMaterialSource,
  /let opacity\s*=\s*buildBankOpacityNode\(textures\)/,
  'road-edge alpha masking must remain on its existing opacity-node path',
);
assert.doesNotMatch(
  riverBankMaterialSource,
  /material\.alphaMap/,
  'river-bank mud must not multiply its edge mask through a duplicate alphaMap path',
);
assert.match(
  riverBankMaterialSource,
  /material\.opacityNode\s*=\s*buildRiverBankOpacityNode\(\)/,
  'river-bank mud must retain its analytic radial opacity path',
);
assert.match(
  roadEdgeOpacitySource,
  /texture\(textures\.edgeMask,\s*uvNode\)/,
  'road-edge opacity must retain its textured edge mask',
);
assert.doesNotMatch(
  riverBankOpacitySource,
  /textures\.edgeMask|texture\(/,
  'independent river-bank quads must not repeat an edge-mask texture sample',
);
assert.match(
  riverBankOpacitySource,
  /smoothstep\(float\(0\)[\s\S]*?float\(0\.36\)[\s\S]*?uvNode\.x\)/,
  'river-bank opacity must retain its analytic bank-width feather',
);
assert.match(roadFactorySource, /roadWeatherProfile\(environment\)/);
assert.match(roadFactorySource, /1 - Math\.exp\(-Math\.max\(0,\s*dt\) \* 2\.8\)/);
assert.match(roadFactorySource, /readonly rainTerrain!:\s*THREE\.MeshStandardMaterial/);
assert.match(
  roadFactorySource,
  /const rainTerrain\s*=\s*new THREE\.MeshStandardMaterial\(\{/,
);
assert.match(roadFactorySource, /name:\s*'Overcast rain terrain'/);
assert.match(roadFactorySource, /const rainTerrainTexture = createRainTerrainAlbedoTexture\(\)/);
assert.match(roadFactorySource, /map:\s*rainTerrainTexture/);
assert.match(
  roadFactorySource,
  /this\.rainTerrainTexture\?\.dispose\(\)/,
  'the factory must release its generated rain albedo',
);
assert.match(roadFactorySource, /vertexColors:\s*true/);
assert.match(roadFactorySource, /function createRainTerrainAlbedoTexture/);
assert.match(roadFactorySource, /function tileableValueNoise/);
assert.match(roadFactorySource, /THREE\.RepeatWrapping/);
assert.match(roadFactorySource, /texture\.repeat\.set\(0\.14,\s*0\.14\)/);
assert.doesNotMatch(
  roadFactorySource.slice(
    roadFactorySource.indexOf('const rainTerrain ='),
    roadFactorySource.indexOf('const bridgeSupport ='),
  ),
  /normalMap|roughnessMap/,
  'rain overview terrain must not reintroduce high-frequency authored weave maps',
);
assert.match(
  roadFactorySource,
  /const materials\s*=\s*\[[\s\S]*?this\.terrain,[\s\S]*?this\.rainTerrain,[\s\S]*?this\.bridgeSupport/,
  'the factory must dispose its shared rain material',
);
const rainTerrainStart = roadFactorySource.indexOf('const rainTerrain =');
const rainTerrainEnd = roadFactorySource.indexOf('const bridgeSupport =', rainTerrainStart);
assert.ok(rainTerrainStart >= 0 && rainTerrainEnd > rainTerrainStart);
assert.doesNotMatch(
  roadFactorySource.slice(rainTerrainStart, rainTerrainEnd),
  /colorNode|normalNode|attribute\(|vertexColor\(/,
  'the stable rain terrain path must not inherit node or custom-attribute dependencies',
);
assert.match(
  sceneSource,
  /this\.fairTerrainMaterial\s*=\s*terrain\.mesh\.material as THREE\.Material/,
  'SceneManager must retain the generated fair-weather shore material',
);
assert.match(
  sceneSource,
  /this\.terrain\.setRainColorMode\(false\)/,
  'rain must not replace the authored grass and dirt color attributes',
);
assert.match(terrainSource, /private readonly rainColorAttr:\s*THREE\.BufferAttribute/);
assert.match(terrainSource, /function createRainColorAttribute/);
assert.match(terrainSource, /const lowToMiddle = rainSmoothStep/);
assert.match(terrainSource, /const middleToHigh = rainSmoothStep/);
assert.match(terrainSource, /const shoreBlend = Math\.sqrt/);
assert.match(
  terrainSource,
  /THREE\.MathUtils\.lerp\(r,\s*1\.35,\s*shoreBlend\)[\s\S]*?THREE\.MathUtils\.lerp\(g,\s*0\.72,\s*shoreBlend\)[\s\S]*?THREE\.MathUtils\.lerp\(b,\s*0\.25,\s*shoreBlend\)/,
  'rain shoreline colors must retain a distinct warm wet-bank family',
);
assert.match(
  sceneSource,
  /this\.terrain\.mesh\.material\s*=\s*this\.fairTerrainMaterial/,
  'rain must retain the authored zoom-responsive grass and dirt material',
);
assert.match(
  sceneSource,
  /this\.terrain\.mesh\.material\s*=\s*this\.fairTerrainMaterial;[\s\S]*?this\.terrain\.dispose\(\)/,
  'terrain disposal must restore and release its generated fair-weather material',
);
assert.match(terrainMaterialSource, /const stableColorNode = biomeBaseColor/);
assert.match(terrainMaterialSource, /const rainMoisture = smoothstep/);
assert.match(terrainMaterialSource, /const rainStableColorNode = rainMacroColor/);
assert.match(
  terrainMaterialSource,
  /TERRAIN_FULL_RAIN_ALBEDO_DETAIL_FLOOR = 1/,
);
assert.match(terrainMaterialSource, /float\(0\.1\)/);
assert.match(terrainMaterialSource, /float\(0\.32\)/);
assert.match(terrainMaterialSource, /buildTerrainWetMask\(weatherMoisture,\s*weather\)/);
assert.match(terrainMaterialSource, /vec3\(0\.78,\s*0\.82,\s*0\.78\)/);
assert.match(terrainMaterialSource, /const rainNormalVisibility = mix/);
assert.match(terrainMaterialSource, /const rainAoVisibility = mix/);
assert.match(terrainMaterialSource, /function applyTerrainRainHaze/);
assert.match(terrainMaterialSource, /float\(3600\)/);
assert.match(terrainMaterialSource, /float\(32400\)/);
assert.match(terrainMaterialSource, /float\(0\.72\)/);
assert.match(
  terrainMaterialSource,
  /TERRAIN_FULL_RAIN_ROUGHNESS_DETAIL_FLOOR = 0\.08/,
);
assert.match(terrainMaterialSource, /const rainDirtVisibility = mix/);
assert.match(
  terrainMaterialSource,
  /TERRAIN_FULL_RAIN_NORMAL_DETAIL_FLOOR = 0\.04/,
);
assert.match(
  terrainMaterialSource,
  /TERRAIN_FULL_RAIN_AO_DETAIL_FLOOR = 0\.04/,
);
assert.match(terrainMaterialSource, /const broadFrostExposure = smoothstep/);
assert.match(terrainMaterialSource, /const ecologicalShelter = max/);
assert.match(terrainMaterialSource, /TERRAIN_FROST_PATCH_MAX = 0\.86/);
assert.match(terrainMaterialSource, /TERRAIN_FROST_MASK_SCALE = 0\.82/);
assert.match(terrainMaterialSource, /TERRAIN_FROST_COLOR_BLEND = 0\.86/);
assert.match(
  terrainMaterialSource,
  /TERRAIN_FROST_COLOR_LIFT = \[0\.16,\s*0\.19,\s*0\.22\]/,
);
assert.match(terrainMaterialSource, /const shoreRainVisibility = sub/);
assert.match(
  terrainMaterialSource,
  /const weatherResolvedShoreBlend = shoreBlend\.mul\(shoreRainVisibility\)/,
);
assert.match(
  terrainMaterialSource,
  /shoreUndercoat = weatherResolvedShoreBlend\.mul\(float\(0\.58\)/,
);
assert.match(sceneSource, /weather\.kind === 'snow'[\s\S]*?\? 0\.18/);
assert.doesNotMatch(
  roadFactorySource,
  /new THREE\.Mesh\(/,
  'road weather feedback must reuse shared materials without adding meshes or draw calls',
);

console.log('precipitation visual tests passed');

function exportedFunctionSource(source: string, name: string): string {
  const start = source.indexOf(`export function ${name}`);
  assert.ok(start >= 0, `expected exported function ${name}`);
  const next = source.indexOf('\nexport function ', start + 1);
  return source.slice(start, next >= 0 ? next : source.length);
}

function localFunctionSource(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `expected local function ${name}`);
  const nextLocal = source.indexOf('\nfunction ', start + 1);
  const nextExported = source.indexOf('\nexport function ', start + 1);
  const boundaries = [nextLocal, nextExported].filter((index) => index >= 0);
  const end = boundaries.length > 0 ? Math.min(...boundaries) : source.length;
  return source.slice(start, end);
}
