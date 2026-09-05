import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';

const root='water-gauntlet-evidence';
const profiles=['river','inland','coastal'];
const names={river:'River current',inland:'Sheltered pond',coastal:'Coastline'};
const rows=profiles.flatMap(profile=>['near','design','far'].map(view=>{
  const folder=profile==='coastal'?'world-coastal-release':'world-accepted';
  const [old,current]=JSON.parse(readFileSync(`${root}/${folder}/${profile}-${view}-paired.json`,'utf8'));
  return {profile,view,old,current,frameDeltaMs:1000/current.fps-1000/old.fps};
}));
const fmt=(n,d=2)=>Number(n).toFixed(d);
const matching=rows.filter(r=>Math.abs(r.frameDeltaMs)<0.05).length;
const worstDelta=Math.max(...rows.map(r=>r.frameDeltaMs));
if(worstDelta>0.11)throw new Error(`Water frame budget failed: ${worstDelta.toFixed(3)} ms median regression.`);
const budgetText=`${matching} of nine median frame intervals match; the remaining views differ by at most ${fmt(worstDelta,1)} ms, one timer step.`;
const table=rows.map(r=>`| ${names[r.profile]} / ${r.view} | ${fmt(r.old.fps)} | ${fmt(r.current.fps)} | ${fmt(r.frameDeltaMs,3)} | ${fmt(r.old.gpuMedianMs)} → ${fmt(r.current.gpuMedianMs)} + ${fmt(r.current.computeGpuMedianMs,3)} | ${fmt(r.old.medianCpuMs,1)} → ${fmt(r.current.medianCpuMs,1)} |`).join('\n');
const sources=['src/rivers/WaterOptics.ts','src/rivers/WaterHydraulics.ts','src/rivers/riverWaterShoreMaps.ts',
  'src/rivers/WaterSurfaceProfile.ts','src/rivers/WaterSurfaceNoise.ts','src/rivers/WaterSpectrumRuntime.ts',
  'src/rivers/SpectralWaterSimulation.ts','src/rivers/RiverWaterMaterial.ts','src/rivers/RiverWaterMesh.ts',
  'src/rivers/RiverSystem.ts','src/scene/SceneManager.ts','src/terrain/TerrainHorizonWorld.ts'];
const manifest={createdAt:new Date().toISOString(),resolution:[1280,720],dpr:1,
  gpu:'NVIDIA GeForce RTX 4070 Laptop GPU (8 GB)',browser:'Microsoft Edge / WebGPU',
  sourceHashes:Object.fromEntries(sources.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')])),
  reference:existsSync(`${root}/reference.mp4`)?{sha256:createHash('sha256').update(readFileSync(`${root}/reference.mp4`)).digest('hex'),durationSeconds:45.461333}:null,
  performance:rows.map(({profile,view,old,current,frameDeltaMs})=>({profile,view,oldFps:old.fps,newFps:current.fps,frameDeltaMs,oldGpuMs:old.gpuMedianMs,newGpuMs:current.gpuMedianMs,computeMs:current.computeGpuMedianMs})),
  scope:'Full production environment fixture; settlement entities, database and UI omitted.'};
writeFileSync(`${root}/manifest.json`,JSON.stringify(manifest,null,2));
writeFileSync(`${root}/README.md`,`# Water gauntlet evidence

Open [the comparison gallery](review.html) for the supplied reference, three new motion clips, the old/new surface captures and production-world screenshots. [Implementation and reproduction notes](../docs/water-rendering.md) describe the system and its limits.

## Accepted evidence

- **world-accepted/** (river/pond) and **world-coastal-release/** (sea): final production environment, identical loaded scene alternating old/new water in four short ABBA cycles, 45 measured frames per block and six discarded transition frames. Each variant has 360 frame samples. Full post-processing GPU bookends and separate compute timing are reported. Source hashes are in [manifest.json](manifest.json).
- **surface-release/**: near/design/far views of the production shader with game tree and stone assets on controlled fixture terrain; moving-water measurements follow shader warmup.
- **motion-release/**: final optical passes, rain/night, five-second videos, and adjacent frames across the 6.25-second advection reset. These are visual evidence; recording and screenshot costs invalidate performance measurements in these records.
- **stress-release/**: extra seeds and DPR 1.5/2, near and far views. Compilation/visibility/copy-budget checks, not matched performance comparisons.
- **production-baseline/**: original water shader on the same controlled production-asset fixture.
- **reference-0.png … reference-8.png**: sampled frames from the supplied 45.46-second video. The local review copy of the original video is excluded from Git.

## Paired rendering results

1280 × 720, DPR 1, Microsoft Edge WebGPU, RTX 4070 Laptop GPU. Values are medians. GPU figures encompass the full environment/post pass; compute is shown separately. ${budgetText} The new shader has a small additional GPU cost; these results establish the observed FPS band on this machine, not a promise for every GPU or settlement workload.

| View | Old FPS | New FPS | Frame Δ ms | Old → new GPU ms + compute | Old → new CPU ms |
| --- | ---: | ---: | ---: | ---: | ---: |
${table}

The fixture includes terrain, horizon, forest, grass, river details, sky, shadows, post processing and wildlife. Settlement entities, database and UI are omitted. Earlier standalone runs heated the laptop and changed GPU clocks, so they are not treated as controlled old/new comparisons. Even paired runs can have different absolute FPS under different thermal/background load; compare variants within a run.

## Visual judgement

The supplied clip sets the target for readable currents and boulder wakes. The new renderer adds contact-constrained split flow, downstream recirculation, visible bed transmission, real on-screen tree reflections, calmer pond motion, spectral sea waves, distinct shoreline response and weather/time-of-day response. The comparison remains a visual judgement; there is no objective score that proves one scene is universally “better”. The gallery exposes the actual output and reference rather than presenting an automated similarity score as proof.

The game currently has a steep, coarsely tessellated coastal bank. The water renderer follows that geometry; it cannot turn it into a gently sloped beach. Screen-space reflection misses and fine foliage disocclusions remain possible. Offscreen reflection uses sky colour. Full dynamic obstacles, underwater views, erosion, bathymetric fluid transport and terrain wetting are outside this rendering implementation.

## Validation

Numerical hydraulic/FFT/lifetime tests, river material tests, the Kupa geometry/presentation contract, the old sparse solver's conservation tests, TypeScript, and the four Edge browser water checks passed. Browser checks cover shader errors, bounded copies, paused compute, diagnostic restoration within one colour level, rain and night. Build results and temporal measurements are recorded alongside this index.

## Rejected and superseded iterations

- suite-02: compute was allocated but not dispatched; not an animated-spectrum result.
- suite-03: nested compute corrupted the active Three node frame; blank views rejected.
- suite-05 and moving-01: sampled-texture limit exceeded; blank coast rejected.
- world-01: MRT attachment mismatch; rejected.
- world-02: development reload interrupted collection; not final performance evidence.
- world-baseline/world-final/world-paired/world-budget: long separate or long-block runs affected by thermal drift; superseded.
- world-interleaved: identified repeated framebuffer capture cost; superseded by shared snapshot nodes.
- world-coastal-depth: actual seabed depth restored sea waves but a far-view frame-rate regression remained; superseded by the smaller fine-wave grid and shorter coastal reflection trace.
- The coastal records in world-accepted precede the seabed and horizon-join corrections; use world-coastal-release. Its conditions.json verifies exact production join coverage, and its rain/night screenshots exercise SceneManager weather integration.
- world-shared: first successful budget run; superseded by final world-accepted. Its per-variant copy counters inherited the last baseline block and must not be used as proof of the new renderer's copy budget.
- Other iteration, suite, moving, polished and production folders are intermediate visual development evidence. motion-final precedes the final stable mean-interface reflection adjustment; use motion-release.
`);

const descriptions={river:'Current slows at the bank, splits around the rocks and recirculates in their shelter.',inland:'A calm surface keeps readable reflections above a visible shallow bed, with small incoming ripples.',coastal:'Long swell, shorter surface waves and intermittent foam respond differently from sheltered inland water.'};
const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Water — reference and rendering review</title><style>
*{box-sizing:border-box}body{margin:0;background:#111f1d;color:#eee9d9;font:15px/1.55 system-ui,sans-serif}main{max-width:1500px;margin:auto;padding:40px 32px}header{display:flex;justify-content:space-between;align-items:end;gap:24px;margin-bottom:28px}h1{font:48px/1.1 Georgia,serif;margin:6px 0 14px}h2{font:27px Georgia,serif;margin:32px 0 14px}p{max-width:900px;color:#b6c6bf}a{color:#b2dfcd}.eyebrow{letter-spacing:.18em;text-transform:uppercase;font-size:11px;color:#9ac8b3}nav{display:flex;gap:8px;flex-wrap:wrap}button{font:inherit;padding:10px 18px;background:#1e3831;color:inherit;border:1px solid #4b675c;cursor:pointer;border-radius:3px}button[aria-pressed=true]{background:#cee4d4;color:#15382b}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0;background:#182b25;border:1px solid #2f493e}video,img{display:block;width:100%;aspect-ratio:16/9;object-fit:contain;background:#0b1513}figcaption{padding:10px 14px;color:#b7c9bf;font-size:13px}.links{display:flex;gap:22px;margin:16px 0}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:10px;border-bottom:1px solid #2c443b}th{color:#98beaa}summary{cursor:pointer;padding:14px;background:#20362d}details{margin-top:30px}.scroll{overflow:auto}.note{font-size:13px;color:#91aa9c}footer{margin-top:36px;border-top:1px solid #344b40;padding-top:18px}@media(max-width:800px){main{padding:24px 16px}header{display:block}h1{font-size:38px}.pair,.cards{grid-template-columns:1fr}nav{margin-top:22px}}
</style></head><body><main><header><div><div class="eyebrow">Selo · water rendering gauntlet</div><h1>Water, in motion.</h1><p>Reference footage and the implemented river, pond and sea renderer.</p></div><nav>${profiles.map((p,i)=>`<button data-profile="${p}" aria-pressed="${i===0}">${names[p]}</button>`).join('')}</nav></header>
<div class="pair"><figure><video controls muted loop preload="metadata" poster="reference-4.png" src="reference.mp4"></video><figcaption>Supplied reference · original 45-second clip</figcaption></figure><figure><video id="current" controls muted loop preload="metadata" poster="motion-release/river-wrap.png" src="motion-release/river.webm"></video><figcaption id="caption">${descriptions.river}</figcaption></figure></div>
<div class="links"><a id="interactive" href="/water-gauntlet.html?production=1&profile=river">Explore the water</a><a href="README.md">Evidence and measurements</a><a href="../docs/water-rendering.md">Rendering details</a></div>
<p class="note">The new clips use the production water and game vegetation/stone assets on controlled fixture terrain. Camera, lighting and environment differ from the supplied reference. Use the production-world views below to assess integration.</p>
<h2>Previous surface / implemented surface</h2><div class="pair"><figure><img id="old" loading="lazy" src="production-baseline/river-near.png"><figcaption>Previous water shader · controlled fixture</figcaption></figure><figure><img id="new" loading="lazy" src="surface-release/river-near.png"><figcaption>Implemented water shader · same camera and fixture</figcaption></figure></div>
<h2>Inside the production environment</h2><div class="cards">${['near','design','far'].map(v=>`<figure><a id="world-link-${v}" href="world-accepted/river-${v}.png"><img id="world-${v}" loading="lazy" src="world-accepted/river-${v}.png"></a><figcaption>${v==='near'?'Close view':v==='design'?'Design view':'Strategic view'}</figcaption></figure>`).join('')}</div>
<h2>Frame rate preserved within timer resolution</h2><p>${budgetText} Both versions were alternated in the same loaded scene. The additional GPU cost and complete measurements are shown below.</p><p class="note">RTX 4070 Laptop GPU · Edge WebGPU · 1280 × 720 · DPR 1 · production environment, excluding settlement entities/database/UI. Absolute FPS depends on scene and thermal/background load.</p>
<div class="scroll"><table><thead><tr><th>View</th><th>Previous FPS</th><th>Implemented FPS</th><th>Frame difference</th><th>Previous → implemented GPU + compute</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${names[r.profile]} / ${r.view}</td><td>${fmt(r.old.fps)}</td><td>${fmt(r.current.fps)}</td><td>${fmt(r.frameDeltaMs,3)} ms</td><td>${fmt(r.old.gpuMedianMs)} → ${fmt(r.current.gpuMedianMs)} + ${fmt(r.current.computeGpuMedianMs,3)} ms</td></tr>`).join('')}</tbody></table></div>
<details><summary>Optical passes, rain and night</summary><div class="cards" id="passes">${['normal','reflection','refraction','caustics','velocity','foam-field','shore','rain','night'].map(pass=>`<figure><img loading="lazy" data-pass="${pass}" src="motion-release/river-${pass}.png"><figcaption>${pass}</figcaption></figure>`).join('')}</div></details>
<footer><p class="note">The supplied video is a visual target, not a numerical quality score. Screen-space reflections cannot recover offscreen objects, and existing terrain geometry bounds the shoreline. The full evidence index records these limits and the rejected gauntlet iterations.</p></footer></main><script>
const descriptions=${JSON.stringify(descriptions)};
for(const button of document.querySelectorAll('[data-profile]'))button.onclick=()=>{
 const p=button.dataset.profile;
 for(const b of document.querySelectorAll('[data-profile]'))b.setAttribute('aria-pressed',String(b===button));
 const video=document.querySelector('#current');video.pause();video.src='motion-release/'+p+'.webm';video.poster='motion-release/'+p+'-wrap.png';video.load();
 document.querySelector('#caption').textContent=descriptions[p];
 document.querySelector('#interactive').href='/water-gauntlet.html?production=1&profile='+p;
 document.querySelector('#old').src='production-baseline/'+p+'-near.png';document.querySelector('#new').src='surface-release/'+p+'-near.png';
 for(const v of ['near','design','far']){const path=(p==='coastal'?'world-coastal-release':'world-accepted')+'/'+p+'-'+v+'.png';document.querySelector('#world-'+v).src=path;document.querySelector('#world-link-'+v).href=path;}
 for(const image of document.querySelectorAll('[data-pass]'))image.src='motion-release/'+p+'-'+image.dataset.pass+'.png';
};</script></body></html>`;
writeFileSync(`${root}/review.html`,html);
console.log('Water review, evidence index and source manifest written.');
