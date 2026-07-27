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
assert.ok(rain.intensity > snow.intensity);
assert.ok(rain.fallSpeed > snow.fallSpeed * 4);
assert.ok(rain.sunlightMultiplier < fair.sunlightMultiplier);
assert.ok(rain.fogDensityMultiplier > 1);
assert.equal(snow.kind, 'snow');
assert.ok(snow.intensity > 0);
assert.ok(snow.fogDensityMultiplier > 1);
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

assert.match(rendererSource, /Two identical vertical tiles prevent a visible empty band/);
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
assert.doesNotMatch(
  roadFactorySource,
  /new THREE\.Mesh\(/,
  'road weather feedback must reuse shared materials without adding meshes or draw calls',
);

console.log('precipitation visual tests passed');
