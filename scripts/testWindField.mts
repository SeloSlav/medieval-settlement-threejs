import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  windSiteScore,
  windSiteThroughputMultiplier,
  windWeatherThroughputMultiplier,
  windmillThroughputMultiplier,
} from '../src/wind/windField.ts';
import { rasterizeWindExposure } from '../src/wind/WindOverlay.ts';

const seed = 0x071a2e0d;
assert.ok(Math.abs(windSiteScore(seed, 0, 0) - 0.8323350708295439) < 1e-12);
assert.ok(Math.abs(windSiteScore(seed, 120, -80) - 0.47308390384377874) < 1e-12);
assert.ok(Math.abs(windSiteScore(seed, -280, -210) - 0.5649333145139129) < 1e-12);

const neighboring = windSiteScore(seed, 0.25, 0.25);
assert.ok(Math.abs(windSiteScore(seed, 0, 0) - neighboring) < 0.03);
assert.ok(windSiteThroughputMultiplier(seed, 0, 0) > windSiteThroughputMultiplier(seed, 120, -80));
assert.ok(windWeatherThroughputMultiplier('rain') > windWeatherThroughputMultiplier('fair'));
assert.ok(windWeatherThroughputMultiplier('drought') < windWeatherThroughputMultiplier('fair'));
assert.ok(
  Math.abs(windmillThroughputMultiplier(seed, 120, -80, 'rain') - 1.1252371915362764) < 1e-12,
);

const raster = rasterizeWindExposure({
  seed,
  resolution: 16,
  bounds: { minX: -200, maxX: 200, minZ: -200, maxZ: 200 },
});
assert.equal(raster.length, 16 * 16 * 4);
assert.ok(new Set(Array.from(raster).filter((_, index) => index % 4 !== 3)).size > 24);

const toolbar = readFileSync(new URL('../src/ui/BuildToolbar.ts', import.meta.url), 'utf8');
assert.match(toolbar, /data-action="overlay-menu"/);
assert.match(toolbar, /data-overlay-mode="water"/);
assert.match(toolbar, /data-overlay-mode="wind"/);
assert.match(toolbar, /data-overlay-mode="fertility"/);
assert.match(toolbar, /FERTILITY_OVERLAY_CROPS/);

const serverPolicy = readFileSync(new URL('../server/src/wind_policy.rs', import.meta.url), 'utf8');
assert.match(serverPolicy, /windmill_throughput_multiplier/);
const simulation = readFileSync(new URL('../server/src/simulation/expanded_economy.rs', import.meta.url), 'utf8');
assert.match(simulation, /crate::wind_policy::windmill_throughput_multiplier/);

console.log('Wind field, overlay, and authoritative windmill integration tests passed.');
