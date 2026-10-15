import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// Requires the owned loopback SP service on :3200 and the current trailer-feature
// WASM. These disposable databases never share names with an ordinary game.
const reports = [];
const sizes = process.argv.includes('--small-only') ? ['small'] : process.argv.includes('--large-only') ? ['large']
  : process.argv.includes('--small-first') ? ['small', 'large'] : ['large', 'small'];
for (const size of sizes) {
  const database = `selo-trailer-sp-matched-${size}`;
  const label = `singleplayer-matched-${size}-1080p`;
  const env = { ...process.env, REALM_TEST_URI: 'http://127.0.0.1:3200', REALM_TEST_DB: database,
    REALM_TEST_WASM: 'server/target-trailer/wasm32-unknown-unknown/release/medieval_road_system_server.wasm',
    SP_PROFILE_URI: 'http://127.0.0.1:3200', SP_PROFILE_DB: database,
    SP_PROFILE_SECONDS: process.env.SP_PROFILE_SECONDS || '15',
    SP_PROFILE_WARM_SECONDS: process.env.SP_PROFILE_WARM_SECONDS || '7' };
  console.log('COMPARISON', size, new Date().toISOString());
  const resume = process.argv.includes('--resume') || (size === 'large' && process.argv.includes('--resume-large'));
  if (!resume) execFileSync(process.execPath, ['scripts/publishLocalRealm.mjs', '--reset'], { env, stdio: 'inherit', windowsHide: true });
  try {
    execFileSync(process.execPath, ['scripts/profileSinglePlayerJourney.mjs', label, '--matched', '--comparison', '--layers',
      ...(size === 'small' ? ['--small'] : []), ...(resume ? ['--resume-complex'] : [])], { env, stdio: 'inherit', windowsHide: true });
  } catch (error) { console.log('MAP PROFILE FAILED', size, error.status); }
  reports.push(JSON.parse(readFileSync(`artifacts/city-performance/${label}/report.json`, 'utf8')));
}
mkdirSync('artifacts/city-performance/singleplayer-map-comparison', { recursive: true });
writeFileSync('artifacts/city-performance/singleplayer-map-comparison/report.json', JSON.stringify({ reports }, null, 2));
console.log('COMPARISON COMPLETE');
