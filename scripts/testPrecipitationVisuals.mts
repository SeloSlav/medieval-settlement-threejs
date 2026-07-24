import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { EnvironmentState } from '../src/world/seasonPolicy.ts';
import {
  precipitationPreviewEnvironment,
  precipitationProfile,
} from '../src/weather/precipitationPolicy.ts';

function environment(weather: EnvironmentState['weather']): EnvironmentState {
  return {
    season: weather === 'frost' ? 'winter' : weather === 'drought' ? 'summer' : 'spring',
    weather,
    cropGrowthMultiplier: 1,
    firewoodDemandMultiplier: 1,
    pastureCapacityMultiplier: 1,
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
assert.equal(precipitationPreviewEnvironment(environment('rain'), '?weather=clear').weather, 'fair');

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const rendererSource = readFileSync(
  `${projectRoot}src/weather/PrecipitationRenderer.ts`,
  'utf8',
);
const sceneSource = readFileSync(`${projectRoot}src/scene/SceneManager.ts`, 'utf8');
const appSource = readFileSync(`${projectRoot}src/app/App.ts`, 'utf8');

assert.match(rendererSource, /Two identical vertical tiles prevent a visible empty band/);
assert.match(rendererSource, /depthWrite:\s*false/);
assert.match(rendererSource, /depthTest:\s*true/);
assert.match(rendererSource, /points\.frustumCulled\s*=\s*false/);
assert.doesNotMatch(
  rendererSource,
  /position\.needsUpdate/,
  'precipitation must animate layer transforms without per-frame particle-buffer uploads',
);
assert.match(sceneSource, /this\.precipitation\.update\(dt,\s*cameraDistance,\s*firstPersonActive\)/);
assert.match(sceneSource, /fog\.density\s*=\s*state\.fogDensity\s*\*\s*weather\.fogDensityMultiplier/);
assert.match(
  appSource,
  /this\.sceneManager\?\.setEnvironment\([\s\S]*precipitationPreviewEnvironment\(environment/,
);

console.log('precipitation visual tests passed');
