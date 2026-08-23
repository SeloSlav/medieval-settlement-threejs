import"./modulepreload-polyfill-P2Xu9kJm.js";import{a as e,n as t}from"./hamletFixtureConfig-C3TZITVC.js";var n=[{ordinal:`01`,file:`manor-lords-01.png`,source:`image-1.png`,width:2269,height:1309,bytes:4485664,sha256:`4514B9C63D2CF1619CB1728095315094990248A000935FC44298850115FBB5C3`},{ordinal:`02`,file:`manor-lords-02.png`,source:`image-2.png`,width:2559,height:1438,bytes:6382274,sha256:`3C897E6A28E5E9E82FC1EA554B4BFB6F916D5606BD8B9641A45A9086E1C91715`},{ordinal:`03`,file:`manor-lords-03.png`,source:`image-3.png`,width:2559,height:1438,bytes:7472372,sha256:`AB5EDEE0F29B3F04585CE89C089786D298E72A750F9AC746896F30122D854127`},{ordinal:`04`,file:`manor-lords-04.png`,source:`image-4.png`,width:2559,height:1438,bytes:6988951,sha256:`5C0F65919A9A332640E52C346409CA179CF64FDD63B4851662E5C95CE0B9A752`},{ordinal:`05`,file:`manor-lords-05.png`,source:`image-5.png`,width:2559,height:1438,bytes:5973443,sha256:`F40415B4B2813C4E2FEFAACADCDFBDA37CD13969DDDC8ECC6C1C163F4C61D333`},{ordinal:`06`,file:`manor-lords-06.png`,source:`image-6.png`,width:2559,height:1438,bytes:5383905,sha256:`4CA23CE351E4E54AC2577659D61FBC33F4D39E772A5532F0C81C45FEA2794F1D`},{ordinal:`07`,file:`manor-lords-07.png`,source:`image-7.png`,width:2559,height:1438,bytes:5519593,sha256:`381C67F850C725D0AE95CA149390984582585ED5577191E49EB994BFFDC8FE30`},{ordinal:`08`,file:`manor-lords-08.png`,source:`image-8.png`,width:1930,height:916,bytes:2925531,sha256:`D980389B6FA223434C563AA4D236AC681A407B405FE74271000D7775ACC3423C`},{ordinal:`09`,file:`manor-lords-09.png`,source:`image-9.png`,width:1762,height:978,bytes:2976818,sha256:`D09E45501268E8FEE792828937C29B75F94387999B79669C56F520C6DF821601`},{ordinal:`10`,file:`manor-lords-10.png`,source:`image-10.png`,width:904,height:925,bytes:1342684,sha256:`063D300CA3889069F7A844E01DB9EA2892366FD94C8E6D539BF388D5C12B6877`}],r=[{label:`Baseline daylight overview`,path:`artifacts/visual-qa/baseline-day-overview.png`,href:new URL(`/assets/baseline-day-overview-Bs0SzNsL.png`,``+import.meta.url).href},{label:`Baseline night overview`,path:`artifacts/visual-qa/baseline-night-overview.png`,href:new URL(`/assets/baseline-night-overview-ByoPq2uA.png`,``+import.meta.url).href},{label:`Historical world setup`,path:`artifacts/visual-qa/polished-world-setup.png`,href:new URL(`/assets/polished-world-setup-DeRsm0iT.png`,``+import.meta.url).href},{label:`Historical initial world`,path:`artifacts/visual-qa/polished-world-initial.png`,href:new URL(`/assets/polished-world-initial-Dgwluo8q.png`,``+import.meta.url).href},{label:`Historical daylight overview`,path:`artifacts/visual-qa/polished-day-overview.png`,href:new URL(`/assets/polished-day-overview-BPwbM4Q4.png`,``+import.meta.url).href},{label:`Historical close world`,path:`artifacts/visual-qa/polished-close-world.png`,href:new URL(`/assets/polished-close-world-Bgdr2nuG.png`,``+import.meta.url).href}],i=[{title:`Matched conditions`,target:`Fixed route, camera, 1280×720, renderer PR 1, weather, and time`,status:`unproven`,evidence:`Round 56 binds one dependency-closed archive, the fixed route, 1280x720 drawing buffer, renderer PR 1, exact cross-arm camera-pose signatures, and byte-identical prime/repeat frame captures. Weather and time are still not serialized, so the global matched-condition gate remains unproven.`},{title:`Median FPS`,target:`Hard pass: 60–90 FPS during the settled 30-second full-subsystem run`,status:`unproven`,evidence:`Round 56 records roughly 153 FPS mean throughput in both blind arms with direct rendering, post-processing disabled, and vegetation updates frozen after warmup. That diagnostic validates the forest-floor treatment comparison, not a normal full-system settlement run.`},{title:`1% low`,target:`Hard pass: at least 60 FPS in the same target run`,status:`unproven`,evidence:`Round 56 passes the sealed diagnostic bar at 81.10 FPS for the shadowed-ground treatment and 81.87 FPS for the existing-terrain control. Normal live vegetation updates and post-processing are outside that comparison, so the global target remains unproven rather than failed.`},{title:`>25 ms hitch count`,target:`Hard pass: exactly 0 frames during the 30-second trace`,status:`unproven`,evidence:`Both Round 56 arms record zero frames over 25 ms and maxima at or below 18.0 ms, but only under the sealed forest-floor diagnostic. A normal full-system run is still required.`},{title:`>50 ms hitch count`,target:`Hard pass: exactly 0 frames during the 30-second trace`,status:`verified`,evidence:`Every protocol-valid Round 14–24 trace records exactly 0 frames over 50 ms.`},{title:`LOD motion review`,target:`Fresh critic finds no discrete pop or blank band at normal playback or frame-step`,status:`unproven`,evidence:`Round 56 provides nine GPU-synchronized, pose-matched frame-step pairs with byte-identical prime/repeat captures, including 0276–0279. The fresh exhaustive critic found no vegetation, shadow, terrain-mask, or road-mask pop, but normal-playback review with all live systems remains outstanding.`},{title:`Residence roof progression`,target:`Wood unless that residence receives physical tiles and completes a consuming retrofit`,status:`unproven`,evidence:`The lifetime-global production unlock was rejected. Current residences remain wooden; the physical commodity, delivery, labor, consumption, and per-residence retrofit state are intentionally deferred.`}],a=[`window.__HAMLET_FIXTURE_MOTION_ROUTE__`,`window.__HAMLET_FIXTURE_MOTION_READY__`,`window.__HAMLET_FIXTURE_MOTION_STATE__`,`window.__HAMLET_FIXTURE_MOTION_SETTLED_START__()`,`window.__HAMLET_FIXTURE_START_MOTION__(elapsedMs?)`,`window.__HAMLET_FIXTURE_SEEK_MOTION__(elapsedMs)`,`window.__HAMLET_FIXTURE_STOP_MOTION__()`,`window.__HAMLET_FIXTURE_CAPTURE_VIEW__(viewId)`,`window.__HAMLET_FIXTURE_CAPTURE_MOTION__(elapsedMs)`,`window.__HAMLET_FIXTURE_CAPTURE_READY__(captureId?)`,`window.__HAMLET_FIXTURE_SYSTEMS__`];function o(e){let t=document.querySelector(e);if(!t)throw Error(`Visual gauntlet is missing ${e}.`);return t}function s(e){return`/visual-gauntlet/references/${e.file}`}function c(e){return new Intl.NumberFormat(`en-US`).format(e)}function l(){let e=o(`[data-reference-grid]`);e.innerHTML=n.map((e,t)=>`
        <button
          class="reference-thumb"
          type="button"
          data-reference-index="${t}"
          aria-pressed="${t===0}"
          aria-label="Show supplied reference ${e.ordinal}"
        >
          <img src="${s(e)}" alt="" loading="lazy" />
          <span>Reference ${e.ordinal}</span>
        </button>
      `).join(``)}function u(e){let t=n[e];if(!t)return;let r=s(t),i=o(`[data-reference-image]`);i.src=r,i.alt=`User-supplied Manor Lords visual reference ${t.ordinal} of ${n.length}`,o(`[data-reference-label]`).textContent=`Reference ${t.ordinal} of ${n.length}`,o(`[data-reference-path]`).textContent=`public/visual-gauntlet/references/${t.file}`,o(`[data-reference-meta]`).textContent=`${t.width} × ${t.height} · ${c(t.bytes)} bytes`,o(`[data-reference-hash]`).textContent=`SHA-256 ${t.sha256.slice(0,12)}…`;let a=o(`[data-reference-open]`);a.href=r,a.setAttribute(`aria-label`,`Open supplied reference ${t.ordinal} at original resolution`),document.querySelectorAll(`[data-reference-index]`).forEach(t=>{t.setAttribute(`aria-pressed`,String(Number(t.dataset.referenceIndex)===e))})}function d(){o(`[data-capture-grid]`).innerHTML=r.map(e=>`
        <a class="capture-card" href="${e.href}" target="_blank" rel="noopener">
          <div class="capture-card__image">
            <img src="${e.href}" alt="${e.label}" loading="lazy" />
            <span>Historical / insufficient</span>
          </div>
          <strong>${e.label}</strong>
          <code>${e.path}</code>
          <small>Open stored artifact</small>
        </a>
      `).join(``)}function f(e){switch(e){case`blocked`:return`Blocked`;case`failed`:return`Failed`;case`unproven`:return`Unproven`;case`unreviewed`:return`Unreviewed`;case`verified`:return`Verified`}}function p(){o(`[data-gates]`).innerHTML=i.map((e,t)=>`
        <article class="gate gate--${e.status}">
          <span class="gate__index">${String(t+1).padStart(2,`0`)}</span>
          <div>
            <div class="gate__heading">
              <strong>${e.title}</strong>
              <em>${f(e.status)}</em>
            </div>
            <p>${e.target}</p>
            <small>${e.evidence}</small>
          </div>
        </article>
      `).join(``)}function m(e){return`[${e.join(`, `)}]`}function h(){o(`[data-route-label]`).textContent=`${e.label} · ${e.id}`;let n=`/hamlet-fixture.html?route=${encodeURIComponent(e.id)}&clean=1&visualProfile=1`,r=o(`[data-route-open]`);r.href=n,r.textContent=`Open ${t}`;let i=e.settledStartPredicate;o(`[data-route-spec]`).innerHTML=`
    <article>
      <span>Configured duration</span>
      <strong>${e.durationMs.toLocaleString(`en-US`)} ms</strong>
      <small>Shorter than the required 30-second acceptance trace.</small>
    </article>
    <article>
      <span>Interpolation</span>
      <strong>${e.interpolation}</strong>
      <small>Easing: ${e.easing}</small>
    </article>
    <article>
      <span>Settled predicate</span>
      <strong>${i.id}</strong>
      <small>fixtureReady=${i.fixtureReady}; detailedTexturesReady=${i.detailedTexturesReady}; minimumRenderedFrames=${i.minimumRenderedFrames}; motionInactive=${i.motionInactive}</small>
    </article>
    <article>
      <span>Declared LOD bands</span>
      <strong>${e.lodBands.forest.id} · ${e.lodBands.groundcover.id} · ${e.lodBands.building.id}</strong>
      <small>Forest near ${e.lodBands.forest.nearDistanceMeters} m; groundcover transition/full ${e.lodBands.groundcover.transitionStartMeters}/${e.lodBands.groundcover.fullDetailMeters} m; buildings ${e.lodBands.building.settlementMeters}/${e.lodBands.building.roadEyeMeters} m.</small>
    </article>
  `,o(`[data-route-keyframes]`).innerHTML=e.keyframes.map(e=>`
          <li>
            <time>${(e.timeMs/1e3).toFixed(e.timeMs%1e3==0?0:1)}s</time>
            <strong>${e.id}</strong>
            <span>${e.distanceMeters} m · FOV ${e.fov}</span>
            <code>position ${m(e.position)}</code>
            <code>target ${m(e.target)}</code>
            <code>orientation ${m(e.orientation)}</code>
          </li>
        `).join(``),o(`[data-runtime-hooks]`).innerHTML=a.map(e=>`<code>${e}</code>`).join(``)}o(`[data-reference-grid]`).addEventListener(`click`,e=>{let t=e.target.closest(`[data-reference-index]`);t?.dataset.referenceIndex&&u(Number(t.dataset.referenceIndex))}),l(),u(0),d(),p(),h();