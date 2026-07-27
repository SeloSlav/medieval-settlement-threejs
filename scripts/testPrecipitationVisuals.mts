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
assert.equal(rain.kind, 'rain');
assert.equal(rain.intensity, 0.9);
assert.ok(rain.fallSpeed > snow.fallSpeed * 4);
assert.equal(rain.sunlightMultiplier, 0.32);
assert.equal(rain.fogDensityMultiplier, 1.38);
assert.equal(rain.saturationMultiplier, 0.7);
assert.equal(snow.kind, 'snow');
assert.equal(snow.intensity, 0.78);
assert.equal(snow.fogDensityMultiplier, 1.08);
assert.equal(snow.saturationMultiplier, 0.8);
assert.ok(rain.intensity > snow.intensity);
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

assert.match(rendererSource, /Two identical vertical tiles prevent a visible empty band/);
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
assert.match(roadFactorySource, /roadWeatherProfile\(environment\)/);
assert.match(roadFactorySource, /1 - Math\.exp\(-Math\.max\(0,\s*dt\) \* 2\.8\)/);
assert.match(terrainMaterialSource, /float\(0\.26\)/);
assert.match(terrainMaterialSource, /float\(0\.48\)/);
assert.match(terrainMaterialSource, /vec3\(0\.64,\s*0\.72,\s*0\.67\)/);
assert.match(terrainMaterialSource, /float\(0\.56\)/);
assert.match(terrainMaterialSource, /weather\.wetness\.mul\(float\(0\.65\)/);
assert.match(terrainMaterialSource, /float\(0\.24\)/);
assert.match(terrainMaterialSource, /float\(0\.74\)/);
assert.match(terrainMaterialSource, /weather\.frost[\s\S]*?float\(0\.78\)/);
assert.doesNotMatch(
  roadFactorySource,
  /new THREE\.Mesh\(/,
  'road weather feedback must reuse shared materials without adding meshes or draw calls',
);

console.log('precipitation visual tests passed');
