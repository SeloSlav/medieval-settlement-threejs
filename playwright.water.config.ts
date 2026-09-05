import {defineConfig} from '@playwright/test';
const port=Number(process.env.WATER_GAUNTLET_PORT??5200);
const origin=`http://127.0.0.1:${port}`;
export default defineConfig({
  testDir:'e2e',testMatch:/(?:water-gauntlet|river-lineup)\.spec\.ts/,workers:1,timeout:120000,
  use:{baseURL:origin,viewport:{width:1280,height:720},channel:process.platform==='win32'?'msedge':undefined,
    launchOptions:{args:['--enable-unsafe-webgpu']},screenshot:'only-on-failure'},
  webServer:{command:`node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${port} --strictPort`,
    url:`${origin}/water-gauntlet.html`,reuseExistingServer:!process.env.CI,env:{SELO_STABLE_CAPTURE:'1'}},
});
